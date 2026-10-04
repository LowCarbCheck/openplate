/**
 * One account's rows: read from the source, written to the target inside ONE
 * transaction, read back inside that same transaction and compared, and
 * committed only if every comparison holds.
 *
 * WHAT "HOLDS" MEANS. For every table: the same number of rows, and a SHA-256
 * over the rows as read back from the target equal to the one over the rows
 * as read from the source, every cell compared as Postgres text or as bytes.
 * For the blobs, additionally, Postgres itself hashes each ciphertext on both
 * sides (`SELECT_BLOB_HASHES`), so the blob check does not rest on this
 * module's own read path. For the account row, the copied columns compare the
 * same way and the set columns must read back as exactly what the move meant.
 * Any difference rolls the account back and names the table, never a value.
 *
 * SHARES AND CONTRIBUTIONS move with the SECOND of their two accounts, when
 * both ends are on the target. `movedPartnerIds` is the set of accounts that
 * are on the target as moved accounts at the moment this one is copied.
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import {
  INSERT_ACCOUNT,
  OWNED_TABLES,
  PAIR_TABLES,
  SELECT_BLOB_HASHES,
  SELECT_SOURCE_ACCOUNT,
  SELECT_TARGET_ACCOUNT,
  SELECT_TARGET_STANDING,
  type OwnedTable,
  type PairTable,
} from './tables.js';
import { singleText, type CellRow, type VerbatimClient } from './verbatim-client.js';

/** The standing every moved account is given. */
export interface MovedStanding {
  /** The standing free grant each moved account gets (2026-09-30); its paid limit is `0`. */
  readonly freeDailyAiLimit: number;
  readonly label: string;
}

/** How many rows of one table one account has, or had copied. */
export interface TableCount {
  readonly table: string;
  readonly rows: number;
}

/** Everything read from the source for one account, before any pair table. */
export interface SourceAccountRows {
  readonly id: number;
  readonly account: CellRow;
  readonly owned: readonly { readonly table: OwnedTable; readonly rows: readonly CellRow[] }[];
  readonly blobHashes: readonly CellRow[];
}

/** The pair-table rows of one account whose other end is already moved, and the ones left behind. */
export interface SourcePairRows {
  readonly copied: readonly { readonly table: PairTable; readonly rows: readonly CellRow[] }[];
  readonly leftBehind: readonly TableCount[];
}

export type CopyOutcome =
  | { readonly kind: 'committed'; readonly counts: readonly TableCount[]; readonly blobHashes: number }
  | { readonly kind: 'rolled-back'; readonly reason: string };

/** A row digest that compares text as text and bytes as bytes, never one as the other. */
function digestRows(rows: readonly CellRow[]): string {
  const hash = createHash('sha256');
  for (const row of rows) {
    for (const cell of row) {
      if (cell === null) hash.update('n;');
      else if (Buffer.isBuffer(cell)) hash.update(`b${cell.byteLength}:`).update(cell).update(';');
      else
        hash
          .update(`t${Buffer.byteLength(cell)}:`)
          .update(cell, 'utf8')
          .update(';');
    }
    hash.update('|');
  }
  return hash.digest('hex');
}

export async function readSourceAccountRows(input: { source: VerbatimClient; id: number }): Promise<SourceAccountRows> {
  const [account] = await input.source.rows({ text: SELECT_SOURCE_ACCOUNT, values: [input.id] });
  if (account === undefined) throw new Error(`source account ${input.id} vanished during the run`);
  const owned: { table: OwnedTable; rows: CellRow[] }[] = [];
  for (const table of OWNED_TABLES) {
    owned.push({ table, rows: await input.source.rows({ text: table.select, values: [input.id] }) });
  }
  const blobHashes = await input.source.rows({ text: SELECT_BLOB_HASHES, values: [input.id] });
  return { id: input.id, account, owned, blobHashes };
}

export async function readSourcePairRows(input: {
  source: VerbatimClient;
  id: number;
  movedPartnerIds: readonly number[];
  eventualPartnerIds: readonly number[];
}): Promise<SourcePairRows> {
  const copied: { table: PairTable; rows: CellRow[] }[] = [];
  const leftBehind: TableCount[] = [];
  for (const table of PAIR_TABLES) {
    const rows = await input.source.rows({ text: table.select, values: [input.id, input.movedPartnerIds] });
    copied.push({ table, rows });
    const touching = Number(singleText(await input.source.rows({ text: table.countTouching, values: [input.id] })));
    // Rows whose other end moves LATER in this run are copied with that
    // account, so only rows whose other end never moves are left behind.
    const willTravel = await input.source.rows({ text: table.select, values: [input.id, input.eventualPartnerIds] });
    leftBehind.push({ table: table.name, rows: touching - willTravel.length });
  }
  return { copied, leftBehind };
}

async function insertRows(input: {
  target: VerbatimClient;
  account: SourceAccountRows;
  pairs: SourcePairRows;
  standing: MovedStanding;
}): Promise<void> {
  await input.target.execute({
    text: INSERT_ACCOUNT,
    values: [...input.account.account, input.standing.freeDailyAiLimit, input.standing.label],
  });
  for (const { table, rows } of input.account.owned) {
    for (const row of rows) {
      const values = table.insertTakesAccountId ? [...row, input.account.id] : [...row];
      const inserted = await input.target.execute({ text: table.insert, values });
      if (inserted !== 1) throw new Error(`${table.name}: an insert wrote ${inserted} rows instead of 1`);
    }
  }
  for (const { table, rows } of input.pairs.copied) {
    for (const row of rows) {
      const inserted = await input.target.execute({ text: table.insert, values: [...row] });
      if (inserted !== 1) throw new Error(`${table.name}: an insert wrote ${inserted} rows instead of 1`);
    }
  }
}

/** Every difference between what was read from the source and what the target now holds, by table name only. */
async function compareWithSource(input: {
  target: VerbatimClient;
  account: SourceAccountRows;
  pairs: SourcePairRows;
  standing: MovedStanding;
  movedPartnerIds: readonly number[];
}): Promise<string[]> {
  const { target, account } = input;
  const differences: string[] = [];

  const accountBack = await target.rows({ text: SELECT_TARGET_ACCOUNT, values: [account.id] });
  if (digestRows(accountBack) !== digestRows([account.account])) differences.push('accounts: copied columns differ');
  const standing = await target.rows({ text: SELECT_TARGET_STANDING, values: [account.id] });
  const expectedStanding = [
    '0',
    String(input.standing.freeDailyAiLimit),
    'true',
    'true',
    '0',
    'true',
    input.standing.label,
    'true',
  ];
  if (digestRows(standing) !== digestRows([expectedStanding])) differences.push('accounts: set columns differ');

  for (const { table, rows } of account.owned) {
    const back = await target.rows({ text: table.select, values: [account.id] });
    if (back.length !== rows.length) differences.push(`${table.name}: ${back.length} rows instead of ${rows.length}`);
    else if (digestRows(back) !== digestRows(rows)) differences.push(`${table.name}: row digest differs`);
  }
  for (const { table, rows } of input.pairs.copied) {
    const back = await target.rows({ text: table.select, values: [account.id, input.movedPartnerIds] });
    if (back.length !== rows.length) differences.push(`${table.name}: ${back.length} rows instead of ${rows.length}`);
    else if (digestRows(back) !== digestRows(rows)) differences.push(`${table.name}: row digest differs`);
  }
  const blobHashes = await target.rows({ text: SELECT_BLOB_HASHES, values: [account.id] });
  if (digestRows(blobHashes) !== digestRows(account.blobHashes))
    differences.push('sync_blobs: ciphertext hashes differ');
  return differences;
}

/** The counts one account moves (or would move), `accounts` first. */
export function countRows(input: { account: SourceAccountRows; pairs: SourcePairRows }): TableCount[] {
  return [
    { table: 'accounts', rows: 1 },
    ...input.account.owned.map(({ table, rows }) => ({ table: table.name, rows: rows.length })),
    ...input.pairs.copied.map(({ table, rows }) => ({ table: table.name, rows: rows.length })),
  ];
}

/** Why a failed statement failed, by SQLSTATE and constraint, never by the values it carried. */
function describeFailure(cause: unknown): string {
  if (!(cause instanceof pg.DatabaseError)) {
    return cause instanceof Error ? `the copy stopped: ${cause.message}` : 'the copy stopped';
  }
  if (cause.code === '23505') {
    return `a unique constraint refused a row (${cause.constraint ?? 'unnamed'}): the id or the address was taken during the run`;
  }
  return `a statement failed with SQLSTATE ${cause.code ?? 'unknown'}${cause.constraint ? ` on ${cause.constraint}` : ''}`;
}

/**
 * Copies one account in one target transaction, compares, and commits or
 * rolls back. Never throws for a data problem; an unreachable target does.
 */
export async function copyAccount(input: {
  target: VerbatimClient;
  account: SourceAccountRows;
  pairs: SourcePairRows;
  standing: MovedStanding;
  movedPartnerIds: readonly number[];
}): Promise<CopyOutcome> {
  await input.target.execute({ text: 'BEGIN' });
  try {
    await insertRows(input);
    const differences = await compareWithSource(input);
    if (differences.length > 0) {
      await input.target.execute({ text: 'ROLLBACK' });
      return { kind: 'rolled-back', reason: differences.join('; ') };
    }
    await input.target.execute({ text: 'COMMIT' });
    return { kind: 'committed', counts: countRows(input), blobHashes: input.account.blobHashes.length };
  } catch (cause) {
    await input.target.execute({ text: 'ROLLBACK' });
    return { kind: 'rolled-back', reason: describeFailure(cause) };
  }
}
