/**
 * The pure parts of the account move (`src/move-accounts/`), with no database:
 * the table classification against `db/schema.ts`, the plan, the escrow proofs,
 * the schema drift check and the command line. The database half, and the
 * sign-in after the switch, are `tests/integration/move-accounts.test.ts`.
 *
 * Every positive assertion has a control beside it that must fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../src/db/schema.js';
import {
  ACCOUNT_COPIED_COLUMNS,
  ACCOUNT_SET_COLUMNS,
  isClassifiedTable,
  OWNED_TABLES,
  PAIR_TABLES,
} from '../../src/move-accounts/tables.js';
import { planMove, type AccountIdentity } from '../../src/move-accounts/plan.js';
import { proveResidentEscrow, proveSourceEscrow } from '../../src/move-accounts/escrow-proof.js';
import { checkSchemas, type SchemaColumns } from '../../src/move-accounts/schema-check.js';
import {
  DEFAULT_MOVE_FREE_DAILY_AI_LIMIT,
  DEFAULT_MOVE_LABEL,
  parseMoveCommand,
} from '../../src/move-accounts/options.js';
import { maskEmail } from '../../src/move-accounts/report.js';
import { deriveServerSecrets } from '../../src/lib/server-secrets.js';
import { openRecoveryCode, sealRecoveryCode } from '../../src/lib/escrow.js';
import { computeRecoveryVerifier } from '../../src/lib/recovery-auth.js';

/** Every table `db/schema.ts` defines, by name, with its column names. */
function schemaTables(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    tables.set(config.name, new Set(config.columns.map((column) => column.name)));
  }
  return tables;
}

test('every table in db/schema.ts is either moved or skipped, and a new one would not be', () => {
  const names = [...schemaTables().keys()];
  assert.ok(names.length >= 22, 'the walk over db/schema.ts found the tables');
  assert.deepEqual(
    names.filter((name) => !isClassifiedTable(name)),
    [],
  );
  // Control: a table nobody classified is caught.
  assert.equal(isClassifiedTable('a_table_added_next_month'), false);
});

test('the column lists the move copies are exactly the columns db/schema.ts defines', () => {
  const tables = schemaTables();
  for (const table of [...OWNED_TABLES, ...PAIR_TABLES]) {
    assert.deepEqual([...table.columns].toSorted(), [...(tables.get(table.name) ?? [])].toSorted(), table.name);
  }
  const accountColumns: readonly string[] = [...ACCOUNT_COPIED_COLUMNS, ...ACCOUNT_SET_COLUMNS];
  assert.deepEqual([...accountColumns].toSorted(), [...(tables.get('accounts') ?? [])].toSorted());
  // Control: a column list one short would differ.
  assert.notDeepEqual(accountColumns.slice(1).toSorted(), [...(tables.get('accounts') ?? [])].toSorted());
});

function identity(id: number, email: string, verifier = `v-${id}`): AccountIdentity {
  return { id, email, verifier };
}

test('the plan moves free slots only, recognises its own work, and refuses the rest', () => {
  const source = [
    identity(1, 'owner@example.org'),
    identity(2, 'anna@example.org'),
    identity(3, 'ben@example.org'),
    identity(4, 'skipped@example.org'),
    identity(5, 'clash@example.org'),
    identity(6, 'twin@example.org'),
  ];
  const target = [
    identity(1, 'owner@example.org', 'a-different-verifier'),
    identity(3, 'ben@example.org'),
    identity(5, 'resident@example.org'),
    identity(8, 'twin@example.org'),
  ];
  const plan = planMove({ source, target, skipEmails: ['skipped@example.org', 'nobody@example.org'] });
  assert.deepEqual(
    plan.decisions.map((decision) => `${decision.id}:${decision.kind}`),
    ['1:email-taken', '2:move', '3:already-moved', '4:skipped-by-flag', '5:id-taken', '6:email-taken'],
  );
  assert.deepEqual(plan.residentTargetIds, [1, 5, 8], 'target account 3 is a moved account, not a resident');
  assert.equal(plan.highestSourceId, 6);
  assert.deepEqual(plan.unmatchedSkipEmails, ['nobody@example.org']);

  // Control: the same address and id with a DIFFERENT verifier is not "already moved".
  const other = planMove({ source, target: [identity(3, 'ben@example.org', 'another-verifier')], skipEmails: [] });
  assert.equal(other.decisions.find((decision) => decision.id === 3)?.kind, 'email-taken');
  // Control: --skip-email wins over every other rule.
  const skipped = planMove({ source, target, skipEmails: ['owner@example.org'] });
  assert.equal(skipped.decisions[0]?.kind, 'skipped-by-flag');
});

const SOURCE = deriveServerSecrets('unit-source-root-secret-long-enough!!');
const TARGET_OLD = deriveServerSecrets('unit-TARGET-old-root-secret-long-enough');
const CODE = 'MAB0KYA3C9HWD50P5BBG3V6R0QZY3MR5';

test('a moved escrow must open under the source secret', () => {
  const sealed = sealRecoveryCode({ code: CODE, escrowKey: SOURCE.escrowKey });
  const recoveryVerifier = computeRecoveryVerifier({ code: CODE, pepper: SOURCE.verifierPepper });
  assert.deepEqual(proveSourceEscrow({ escrow: { sealed, recoveryVerifier }, source: SOURCE }), {
    kind: 'opens',
    recoveryVerifierMatches: true,
  });
  // Controls: under another key it fails, and a verifier from another pepper is reported.
  assert.equal(proveSourceEscrow({ escrow: { sealed, recoveryVerifier }, source: TARGET_OLD }).kind, 'fails');
  const foreign = computeRecoveryVerifier({ code: CODE, pepper: TARGET_OLD.verifierPepper });
  assert.deepEqual(proveSourceEscrow({ escrow: { sealed, recoveryVerifier: foreign }, source: SOURCE }), {
    kind: 'opens',
    recoveryVerifierMatches: false,
  });
  assert.equal(proveSourceEscrow({ escrow: { sealed: null, recoveryVerifier }, source: SOURCE }).kind, 'fails');
});

test('a resident escrow re-seals from the old secret to the new one, and a second pass sees it done', () => {
  const sealed = sealRecoveryCode({ code: CODE, escrowKey: TARGET_OLD.escrowKey });
  const recoveryVerifier = computeRecoveryVerifier({ code: CODE, pepper: TARGET_OLD.verifierPepper });
  const proof = proveResidentEscrow({ escrow: { sealed, recoveryVerifier }, previous: TARGET_OLD, next: SOURCE });
  assert.equal(proof.kind, 'reseal');
  if (proof.kind !== 'reseal') return;
  assert.equal(openRecoveryCode({ sealed: proof.next.sealed, escrowKey: SOURCE.escrowKey }), CODE);
  assert.equal(proof.next.recoveryVerifier, computeRecoveryVerifier({ code: CODE, pepper: SOURCE.verifierPepper }));
  assert.deepEqual(proof.previous, { sealed, recoveryVerifier });

  const again = proveResidentEscrow({ escrow: proof.next, previous: TARGET_OLD, next: SOURCE });
  assert.equal(again.kind, 'already-resealed');

  // Controls: a stored verifier that does not match the code refuses, and so
  // does an escrow neither key opens.
  const wrongVerifier = computeRecoveryVerifier({ code: CODE, pepper: SOURCE.verifierPepper });
  assert.equal(
    proveResidentEscrow({ escrow: { sealed, recoveryVerifier: wrongVerifier }, previous: TARGET_OLD, next: SOURCE })
      .kind,
    'fails',
  );
  const stranger = deriveServerSecrets('a-third-root-secret-that-is-long-enough');
  const foreignSeal = sealRecoveryCode({ code: CODE, escrowKey: stranger.escrowKey });
  assert.equal(
    proveResidentEscrow({ escrow: { sealed: foreignSeal, recoveryVerifier }, previous: TARGET_OLD, next: SOURCE }).kind,
    'fails',
  );
});

function columnsOf(entries: [string, readonly string[]][]): SchemaColumns {
  return new Map(entries.map(([table, columns]) => [table, new Set(columns)]));
}

function currentSchema(): Map<string, Set<string>> {
  return schemaTables();
}

test('the drift check accepts a source without accounts.label and refuses a target without it', () => {
  const full = currentSchema();
  const withoutLabel = new Map(full);
  withoutLabel.set('accounts', new Set([...(full.get('accounts') ?? [])].filter((column) => column !== 'label')));
  assert.deepEqual(checkSchemas({ source: withoutLabel, target: full }), []);
  assert.deepEqual(checkSchemas({ source: full, target: full }), []);

  const refused = checkSchemas({ source: full, target: withoutLabel });
  assert.equal(refused.length, 1);
  assert.match(refused[0] ?? '', /migration 0024/);
});

test('the drift check accepts a source without accounts.free_daily_ai_limit and refuses a target without it', () => {
  const full = currentSchema();
  const withoutFree = new Map(full);
  withoutFree.set(
    'accounts',
    new Set([...(full.get('accounts') ?? [])].filter((column) => column !== 'free_daily_ai_limit')),
  );
  assert.deepEqual(checkSchemas({ source: withoutFree, target: full }), []);

  const refused = checkSchemas({ source: full, target: withoutFree });
  assert.equal(refused.length, 1);
  assert.match(refused[0] ?? '', /migration 0028/);
});

test('the drift check refuses an unknown table and an unknown column on either side', () => {
  const full = currentSchema();
  const withTable = new Map(full);
  withTable.set('a_table_added_next_month', new Set(['id']));
  assert.match(
    checkSchemas({ source: withTable, target: full }).join('\n'),
    /source has a table this build does not know/,
  );

  const withColumn = new Map(full);
  withColumn.set('sync_blobs', new Set([...(full.get('sync_blobs') ?? []), 'a_new_column']));
  assert.match(
    checkSchemas({ source: full, target: withColumn }).join('\n'),
    /target sync_blobs has columns this build does not copy: a_new_column/,
  );
  assert.match(checkSchemas({ source: columnsOf([]), target: full }).join('\n'), /source has no table accounts/);
});

const ENVIRONMENT = {
  SOURCE_DATABASE_URL: 'postgres://reader@db/source',
  TARGET_DATABASE_URL: 'postgres://writer@db/target',
  SOURCE_SERVER_SECRET: 's'.repeat(40),
  TARGET_OLD_SERVER_SECRET: 't'.repeat(40),
};

test('the command line defaults to a dry run with the owner-decided standing', () => {
  const command = parseMoveCommand({ argv: ['--skip-email', ' Owner@Example.org '], env: ENVIRONMENT });
  assert.equal(command.kind, 'run');
  if (command.kind !== 'run') return;
  assert.equal(command.options.mode, 'dry-run');
  assert.deepEqual(command.options.standing, {
    freeDailyAiLimit: DEFAULT_MOVE_FREE_DAILY_AI_LIMIT,
    label: DEFAULT_MOVE_LABEL,
  });
  assert.equal(DEFAULT_MOVE_FREE_DAILY_AI_LIMIT, 10);
  assert.equal(DEFAULT_MOVE_LABEL, 'Beta supporter');
  assert.deepEqual(command.options.skipEmails, ['owner@example.org'], 'addresses are canonicalised like account rows');
  // Control: --apply is the only way to write.
  const applying = parseMoveCommand({ argv: ['--apply'], env: ENVIRONMENT });
  assert.equal(applying.kind === 'run' ? applying.options.mode : null, 'apply');
});

test('the command line refuses what would make a move ambiguous or unsafe', () => {
  const refusals: [readonly string[], NodeJS.ProcessEnv, RegExp][] = [
    [['--dry-run', '--apply'], ENVIRONMENT, /exclude each other/],
    [['--label', ''], ENVIRONMENT, /--label must be one line of 1 to 40/],
    [['--label', 'x'.repeat(41)], ENVIRONMENT, /--label must be one line of 1 to 40/],
    [['--label', 'Beta\nsupporter'], ENVIRONMENT, /--label must be one line of 1 to 40/],
    [['--free-daily-ai-limit', '-1'], ENVIRONMENT, /--free-daily-ai-limit/],
    [['--free-daily-ai-limit', '10001'], ENVIRONMENT, /--free-daily-ai-limit/],
    // The first move's flag wrote a paid limit with no date; it is gone.
    [['--daily-ai-limit', '10'], ENVIRONMENT, /Unknown option/],
    [['--skip-email', 'not-an-address'], ENVIRONMENT, /--skip-email/],
    [['--token', 'x'], ENVIRONMENT, /Unknown option/],
    [[], { ...ENVIRONMENT, TARGET_OLD_SERVER_SECRET: '' }, /TARGET_OLD_SERVER_SECRET is not set/],
    [[], { ...ENVIRONMENT, SOURCE_SERVER_SECRET: 'short' }, /SOURCE_SERVER_SECRET is shorter/],
    [[], { ...ENVIRONMENT, TARGET_DATABASE_URL: ENVIRONMENT.SOURCE_DATABASE_URL }, /are the same/],
  ];
  for (const [argv, env, reason] of refusals) {
    const command = parseMoveCommand({ argv, env });
    assert.equal(command.kind, 'usage-error', argv.join(' '));
    assert.match(command.kind === 'usage-error' ? command.reason : '', reason);
  }
  // Control: the same environment with nothing wrong runs.
  assert.equal(parseMoveCommand({ argv: [], env: ENVIRONMENT }).kind, 'run');
});

test('an address is shown masked: first character and top-level domain only', () => {
  assert.equal(maskEmail('owner@example.org'), 'o***@***.org');
  assert.ok(!maskEmail('owner@example.org').includes('example'));
});
