/**
 * The move, end to end: preflight, plan, escrow proofs, then either a report
 * (`dry-run`, the default) or the writes (`apply`).
 *
 * THE SOURCE IS NEVER WRITTEN, and Postgres enforces it rather than this file:
 * every source read happens inside one `REPEATABLE READ READ ONLY`
 * transaction, which refuses any write and gives the whole run one consistent
 * snapshot. A dry run holds the target the same way, `READ ONLY`, so a dry run
 * against production cannot write there either.
 *
 * `apply` REFUSES BEFORE ITS FIRST WRITE when anything in the preflight fails:
 * an unknown schema, a `--skip-email` that matches nobody, a moved account
 * whose escrow does not open under the source key, or a resident account
 * whose escrow does not open, re-seal and re-open. Then, in order:
 *
 *  1. the target's account-id sequence moves past the source's highest id, so
 *     a sign-up during or after the move can never take a moved account's id;
 *  2. each resident account is re-sealed in its own transaction, a
 *     compare-and-swap on the old escrow and verifier, proven after the write;
 *  3. each moving account is copied in its own transaction (`copy-account.ts`),
 *     ascending by id, and committed only if every comparison holds.
 *
 * A failed account is rolled back and reported, and the run goes on with the
 * next one; the exit status says whether everything planned happened.
 */
import { deriveServerSecrets, type ServerSecrets } from '../lib/server-secrets.js';
import { planMove, type AccountIdentity, type MovePlan, type SourceDecision } from './plan.js';
import {
  escrowHoldsUnder,
  proveResidentEscrow,
  proveSourceEscrow,
  type EscrowColumns,
  type ResidentEscrowProof,
  type SourceEscrowProof,
} from './escrow-proof.js';
import { checkSchemas, readSchemaColumns } from './schema-check.js';
import {
  copyAccount,
  countRows,
  readSourceAccountRows,
  readSourcePairRows,
  type CopyOutcome,
  type MovedStanding,
  type TableCount,
} from './copy-account.js';
import { connectVerbatim, singleText, textOf, type Cell, type VerbatimClient } from './verbatim-client.js';
import { describeDecision, describeSourceProof, formatCounts, formatLeftBehind, maskEmail } from './report.js';

export type MoveMode = 'dry-run' | 'apply';

export interface MoveOptions {
  readonly mode: MoveMode;
  readonly sourceDatabaseUrl: string;
  readonly targetDatabaseUrl: string;
  /** Beta's secret, and the target's secret after the switch. */
  readonly sourceServerSecret: string;
  /** The target's secret today, which its resident accounts are sealed under. */
  readonly targetOldServerSecret: string;
  /** Canonical addresses (`normalizeEmail`). */
  readonly skipEmails: readonly string[];
  readonly standing: MovedStanding;
}

export type ResidentOutcome =
  | { readonly kind: 'resealed' }
  | { readonly kind: 'already-resealed' }
  | { readonly kind: 'would-reseal' }
  | { readonly kind: 'failed'; readonly reason: string };

export interface SequenceStep {
  /** The highest id the sequence had handed out before the run. */
  readonly before: number;
  /** The highest id it has handed out after the run (or would have). */
  readonly after: number;
}

/** What a run did, for the exit status and for the tests; the printed lines say the same in words. */
export interface MoveResult {
  readonly status: 'ready' | 'applied' | 'refused' | 'incomplete';
  readonly problems: readonly string[];
  readonly decisions: readonly SourceDecision[];
  readonly residents: ReadonlyMap<number, ResidentOutcome>;
  readonly moved: ReadonlyMap<number, CopyOutcome>;
  readonly sequence: SequenceStep | null;
}

interface AccountRow extends AccountIdentity {
  readonly escrow: EscrowColumns;
}

const SELECT_ACCOUNT_ROWS =
  'SELECT "id"::text, "email", "verifier", "recovery_code_escrow", "recovery_verifier" FROM "accounts" ORDER BY "id"';

function bytesOrNull(cell: Cell | undefined): Buffer | null {
  if (cell === undefined || cell === null) return null;
  if (!Buffer.isBuffer(cell)) throw new Error('expected bytes from a bytea column');
  return cell;
}

async function readAccountRows(client: VerbatimClient): Promise<AccountRow[]> {
  const rows = await client.rows({ text: SELECT_ACCOUNT_ROWS });
  return rows.map((row) => ({
    id: Number(textOf(row[0])),
    email: textOf(row[1]),
    verifier: textOf(row[2]),
    escrow: {
      sealed: bytesOrNull(row[3]),
      recoveryVerifier: row[4] === null || row[4] === undefined ? null : textOf(row[4]),
    },
  }));
}

/** Refuses a source and target that are the same database, whatever their URLs say. */
async function checkDistinctDatabases(input: { source: VerbatimClient; target: VerbatimClient }): Promise<string[]> {
  const identity = "SELECT current_database() || ' started ' || pg_postmaster_start_time()::text";
  const source = singleText(await input.source.rows({ text: identity }));
  const target = singleText(await input.target.rows({ text: identity }));
  return source === target ? ['SOURCE_DATABASE_URL and TARGET_DATABASE_URL reach the same database'] : [];
}

async function readSequence(input: { target: VerbatimClient; highestSourceId: number }): Promise<{
  name: string;
  step: SequenceStep;
}> {
  const name = singleText(await input.target.rows({ text: "SELECT pg_get_serial_sequence('accounts', 'id')" }));
  // The name comes back from Postgres already quoted and schema-qualified, and
  // a sequence cannot be read through a parameter.
  const [row] = await input.target.rows({ text: `SELECT last_value::text, is_called::text FROM ${name}` });
  const lastValue = Number(textOf(row?.[0]));
  const handedOut = textOf(row?.[1]) === 'true' ? lastValue : lastValue - 1;
  return { name, step: { before: handedOut, after: Math.max(handedOut, input.highestSourceId) } };
}

function secretsOf(options: MoveOptions) {
  return {
    source: deriveServerSecrets(options.sourceServerSecret),
    targetOld: deriveServerSecrets(options.targetOldServerSecret),
  };
}

interface Preflight {
  readonly problems: string[];
  readonly plan: MovePlan;
  readonly sourceById: ReadonlyMap<number, AccountRow>;
  readonly sourceProofs: ReadonlyMap<number, SourceEscrowProof>;
  readonly residentProofs: ReadonlyMap<number, ResidentEscrowProof>;
  readonly sequence: { name: string; step: SequenceStep };
}

async function preflight(input: {
  source: VerbatimClient;
  target: VerbatimClient;
  options: MoveOptions;
  write: (line: string) => void;
}): Promise<Preflight | { problems: string[] }> {
  const distinct = await checkDistinctDatabases(input);
  if (distinct.length > 0) return { problems: distinct };
  const schemaProblems = checkSchemas({
    source: await readSchemaColumns(input.source),
    target: await readSchemaColumns(input.target),
  });
  if (schemaProblems.length > 0) return { problems: schemaProblems };

  const secrets = secretsOf(input.options);
  const sourceRows = await readAccountRows(input.source);
  const targetRows = await readAccountRows(input.target);
  const plan = planMove({ source: sourceRows, target: targetRows, skipEmails: input.options.skipEmails });
  const problems = plan.unmatchedSkipEmails.map(
    (email) => `--skip-email ${maskEmail(email)} matches no source account`,
  );

  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const targetById = new Map(targetRows.map((row) => [row.id, row]));
  const sourceProofs = new Map<number, SourceEscrowProof>();
  for (const decision of plan.decisions.filter((candidate) => candidate.kind === 'move')) {
    const row = sourceById.get(decision.id);
    if (row === undefined) continue;
    const proof = proveSourceEscrow({ escrow: row.escrow, source: secrets.source });
    sourceProofs.set(decision.id, proof);
    if (proof.kind === 'fails') problems.push(`source account ${decision.id}: ${proof.reason}`);
  }
  const residentProofs = new Map<number, ResidentEscrowProof>();
  for (const id of plan.residentTargetIds) {
    const row = targetById.get(id);
    if (row === undefined) continue;
    const proof = proveResidentEscrow({ escrow: row.escrow, previous: secrets.targetOld, next: secrets.source });
    residentProofs.set(id, proof);
    if (proof.kind === 'fails') problems.push(`target account ${id}: ${proof.reason}`);
  }
  const sequence = await readSequence({ target: input.target, highestSourceId: plan.highestSourceId });
  return { problems, plan, sourceById, sourceProofs, residentProofs, sequence };
}

function printPlan(input: { checked: Preflight; write: (line: string) => void }): void {
  const { checked, write } = input;
  write(`plan: ${checked.plan.decisions.length} source accounts`);
  for (const decision of checked.plan.decisions) {
    const email = checked.sourceById.get(decision.id)?.email ?? '';
    const hint = decision.kind === 'move' || decision.kind === 'already-moved' ? '' : `  ${maskEmail(email)}`;
    const escrow = describeSourceProof(checked.sourceProofs.get(decision.id));
    write(`  account ${decision.id}: ${describeDecision(decision)}${escrow}${hint}`);
  }
  write(`target accounts that stay: ${checked.plan.residentTargetIds.length}`);
  for (const id of checked.plan.residentTargetIds) {
    const proof = checked.residentProofs.get(id);
    if (proof?.kind === 'reseal') {
      write(
        `  account ${id}: escrow opens under TARGET_OLD_SERVER_SECRET, re-seals and re-opens under SOURCE_SERVER_SECRET; ` +
          'recovery verifier matches today and is recomputed; the password cannot be re-keyed: ONE MAILED RESET after the switch',
      );
    }
    if (proof?.kind === 'already-resealed')
      write(`  account ${id}: already re-sealed under SOURCE_SERVER_SECRET by an earlier run`);
  }
  const { before, after } = checked.sequence.step;
  write(
    after > before
      ? `account id sequence: moves from ${before} to ${after}, past the highest source id`
      : `account id sequence: already at ${before}, past the highest source id ${checked.plan.highestSourceId}`,
  );
}

/** Ids that are on the target as moved accounts before this run touches anything. */
function alreadyMovedIds(plan: MovePlan): number[] {
  return plan.decisions.filter((decision) => decision.kind === 'already-moved').map((decision) => decision.id);
}

function movingIds(plan: MovePlan): number[] {
  return plan.decisions.filter((decision) => decision.kind === 'move').map((decision) => decision.id);
}

async function dryRunCounts(input: {
  source: VerbatimClient;
  checked: Preflight;
  write: (line: string) => void;
}): Promise<void> {
  const moving = movingIds(input.checked.plan);
  const eventual = [...alreadyMovedIds(input.checked.plan), ...moving];
  const totals = new Map<string, number>();
  input.write('would copy:');
  for (const [index, id] of moving.entries()) {
    const account = await readSourceAccountRows({ source: input.source, id });
    const movedPartnerIds = [...alreadyMovedIds(input.checked.plan), ...moving.slice(0, index)];
    const pairs = await readSourcePairRows({ source: input.source, id, movedPartnerIds, eventualPartnerIds: eventual });
    const counts = countRows({ account, pairs });
    for (const count of counts) totals.set(count.table, (totals.get(count.table) ?? 0) + count.rows);
    input.write(`  account ${id}: ${formatCounts(counts)}${formatLeftBehind(pairs.leftBehind)}`);
  }
  const totalCounts: TableCount[] = [...totals].map(([table, rows]) => ({ table, rows }));
  input.write(`would copy in total: ${formatCounts(totalCounts)}`);
}

async function resealResident(input: {
  target: VerbatimClient;
  id: number;
  proof: ResidentEscrowProof;
  next: ServerSecrets;
}): Promise<ResidentOutcome> {
  if (input.proof.kind === 'already-resealed') return { kind: 'already-resealed' };
  if (input.proof.kind === 'fails') return { kind: 'failed', reason: input.proof.reason };
  const { next, previous } = input.proof;
  await input.target.execute({ text: 'BEGIN' });
  try {
    const updated = await input.target.execute({
      text:
        'UPDATE "accounts" SET "recovery_code_escrow" = $1, "recovery_verifier" = $2, "updated_at" = now() ' +
        'WHERE "id" = $3 AND "recovery_code_escrow" = $4 AND "recovery_verifier" = $5',
      values: [next.sealed, next.recoveryVerifier, input.id, previous.sealed, previous.recoveryVerifier],
    });
    const [row] = await input.target.rows({
      text: 'SELECT "recovery_code_escrow", "recovery_verifier" FROM "accounts" WHERE "id" = $1',
      values: [input.id],
    });
    const readBack: EscrowColumns = {
      sealed: bytesOrNull(row?.[0]),
      recoveryVerifier: row?.[1] === undefined || row[1] === null ? null : textOf(row[1]),
    };
    if (updated !== 1 || !escrowHoldsUnder({ escrow: readBack, secrets: input.next })) {
      await input.target.execute({ text: 'ROLLBACK' });
      return {
        kind: 'failed',
        reason: 'the row changed during the run, or the new seal did not read back; rolled back',
      };
    }
    await input.target.execute({ text: 'COMMIT' });
    return { kind: 'resealed' };
  } catch (cause) {
    await input.target.execute({ text: 'ROLLBACK' });
    return {
      kind: 'failed',
      reason: `the re-seal stopped and was rolled back: ${cause instanceof Error ? cause.message : 'unknown'}`,
    };
  }
}

async function applyMove(input: {
  source: VerbatimClient;
  target: VerbatimClient;
  checked: Preflight;
  options: MoveOptions;
  write: (line: string) => void;
}): Promise<{ residents: Map<number, ResidentOutcome>; moved: Map<number, CopyOutcome> }> {
  const { checked, write } = input;
  const { step, name } = checked.sequence;
  if (step.after > step.before) {
    await input.target.execute({ text: 'SELECT setval($1::regclass, $2, true)', values: [name, step.after] });
    write(`account id sequence: moved from ${step.before} to ${step.after}`);
  }

  const next = deriveServerSecrets(input.options.sourceServerSecret);
  const residents = new Map<number, ResidentOutcome>();
  for (const [id, proof] of checked.residentProofs) {
    const outcome = await resealResident({ target: input.target, id, proof, next });
    residents.set(id, outcome);
    if (outcome.kind === 'resealed') {
      write(
        `target account ${id}: escrow re-sealed and recovery verifier recomputed; needs ONE MAILED RESET after the switch`,
      );
    }
    if (outcome.kind === 'failed') write(`target account ${id}: NOT re-sealed: ${outcome.reason}`);
  }

  const moving = movingIds(checked.plan);
  const eventual = [...alreadyMovedIds(checked.plan), ...moving];
  const movedPartnerIds = alreadyMovedIds(checked.plan);
  const moved = new Map<number, CopyOutcome>();
  for (const id of moving) {
    const account = await readSourceAccountRows({ source: input.source, id });
    const pairs = await readSourcePairRows({ source: input.source, id, movedPartnerIds, eventualPartnerIds: eventual });
    const outcome = await copyAccount({
      target: input.target,
      account,
      pairs,
      standing: input.options.standing,
      movedPartnerIds,
    });
    moved.set(id, outcome);
    if (outcome.kind === 'committed') {
      movedPartnerIds.push(id);
      write(
        `  account ${id}: moved, ${formatCounts(outcome.counts)}; ${outcome.blobHashes} blob hashes match${formatLeftBehind(pairs.leftBehind)}`,
      );
    } else {
      write(`  account ${id}: ROLLED BACK, ${outcome.reason}`);
    }
  }
  return { residents, moved };
}

function residentsFromProofs(proofs: ReadonlyMap<number, ResidentEscrowProof>): Map<number, ResidentOutcome> {
  const outcomes = new Map<number, ResidentOutcome>();
  for (const [id, proof] of proofs) {
    if (proof.kind === 'reseal') outcomes.set(id, { kind: 'would-reseal' });
    if (proof.kind === 'already-resealed') outcomes.set(id, { kind: 'already-resealed' });
    if (proof.kind === 'fails') outcomes.set(id, { kind: 'failed', reason: proof.reason });
  }
  return outcomes;
}

async function runWithClients(input: {
  source: VerbatimClient;
  target: VerbatimClient;
  options: MoveOptions;
  write: (line: string) => void;
}): Promise<MoveResult> {
  const { options, write } = input;
  const refused = (problems: string[], decisions: readonly SourceDecision[] = []): MoveResult => {
    for (const problem of problems) write(`REFUSED: ${problem}`);
    return { status: 'refused', problems, decisions, residents: new Map(), moved: new Map(), sequence: null };
  };

  const checked = await preflight(input);
  if (!('plan' in checked)) return refused(checked.problems);
  printPlan({ checked, write });
  if (checked.problems.length > 0) return refused(checked.problems, checked.plan.decisions);

  if (options.mode === 'dry-run') {
    await dryRunCounts({ source: input.source, checked, write });
    write('result: every proof holds; nothing was written. Run again with --apply to move.');
    return {
      status: 'ready',
      problems: [],
      decisions: checked.plan.decisions,
      residents: residentsFromProofs(checked.residentProofs),
      moved: new Map(),
      sequence: checked.sequence.step,
    };
  }

  write('applying:');
  const { residents, moved } = await applyMove({ ...input, checked });
  const failures = [
    ...[...residents]
      .filter(([, outcome]) => outcome.kind === 'failed')
      .map(([id]) => `target account ${id} was not re-sealed`),
    ...[...moved]
      .filter(([, outcome]) => outcome.kind === 'rolled-back')
      .map(([id]) => `source account ${id} was rolled back`),
  ];
  const committed = [...moved.values()].filter((outcome) => outcome.kind === 'committed').length;
  write(
    failures.length === 0
      ? `result: ${committed} accounts moved, ${residents.size} target accounts handled. Run again to confirm nothing is left.`
      : `result: INCOMPLETE, ${failures.join('; ')}. Fix the cause and run --apply again; finished accounts are skipped.`,
  );
  return {
    status: failures.length === 0 ? 'applied' : 'incomplete',
    problems: failures,
    decisions: checked.plan.decisions,
    residents,
    moved,
    sequence: checked.sequence.step,
  };
}

/** Connects, runs, and always closes both connections. */
export async function runMove(input: { options: MoveOptions; write: (line: string) => void }): Promise<MoveResult> {
  const { options, write } = input;
  const source = await connectVerbatim({ connectionString: options.sourceDatabaseUrl });
  try {
    const target = await connectVerbatim({ connectionString: options.targetDatabaseUrl });
    try {
      await source.execute({ text: 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' });
      if (options.mode === 'dry-run') await target.execute({ text: 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' });
      write(options.mode === 'dry-run' ? 'move-accounts: DRY RUN, nothing is written' : 'move-accounts: APPLY');
      const result = await runWithClients({ source, target, options, write });
      if (options.mode === 'dry-run') await target.execute({ text: 'ROLLBACK' });
      await source.execute({ text: 'ROLLBACK' });
      return result;
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}
