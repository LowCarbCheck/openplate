/**
 * A Postgres connection that reads every value VERBATIM: Postgres's own text
 * form for every type except `bytea`, which arrives as the bytes themselves.
 *
 * WHY NOT DRIZZLE, which every store in this service uses. Drizzle maps a
 * `timestamp` to a JavaScript `Date`, which holds milliseconds, and most
 * timestamps here are `timestamp(6)`. A copy through `Date` would move every
 * microsecond tail to zero and then report success. Read as text and written
 * back as a parameter, whose type Postgres takes from the column it lands in,
 * a value arrives exactly as it left, and the comparison after the copy can be
 * a comparison of text.
 *
 * THE SESSION IS PINNED to UTC and ISO dates on both connections, so a
 * `timestamptz` or a `date` renders identically on the source and the target
 * whatever the server defaults are.
 */
import pg from 'pg';

/** One value as the tool reads it: text, bytes, or `NULL`. */
export type Cell = string | Buffer | null;

/** A row, its cells in the order the statement selected them. */
export type CellRow = readonly Cell[];

/** A parameter the tool binds: a cell, or the account-id list of a pair-table read. */
export type Parameter = Cell | number | readonly number[];

const BYTEA = pg.types.builtins.BYTEA;

/** Returns the text form for every type but `bytea`, see the header. */
function verbatimParser(oid: number, format?: 'text' | 'binary'): (value: string) => Cell {
  if (oid === BYTEA) return pg.types.getTypeParser(oid, format);
  return (value: string) => value;
}

/**
 * Checks a value the driver returned against {@link Cell}. With the parser
 * above installed it always holds; the check is what turns a parser that
 * stopped applying (a driver upgrade) into a loud failure instead of a silent
 * `Date` in the copy.
 */
function assertCell(value: Cell): Cell {
  if (value === null || Buffer.isBuffer(value)) return value;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- boundary decoder over driver output; see the header.
  if (typeof value === 'string') return value;
  throw new Error('the Postgres driver returned a value that is neither text, bytes nor NULL');
}

export interface VerbatimClient {
  /** Runs one statement and returns its rows as cells. */
  rows(input: { text: string; values?: readonly Parameter[] }): Promise<CellRow[]>;
  /** Runs one statement and returns how many rows it touched. */
  execute(input: { text: string; values?: readonly Parameter[] }): Promise<number>;
  close(): Promise<void>;
}

/** Opens one connection, pins its session, and wraps it. */
export async function connectVerbatim(input: { connectionString: string }): Promise<VerbatimClient> {
  const client = new pg.Client({
    connectionString: input.connectionString,
    types: { getTypeParser: verbatimParser },
  });
  // An idle connection dropped by the server must fail the statement that
  // needed it, not take the process down as an unhandled 'error' event.
  client.on('error', () => undefined);
  await client.connect();
  await client.query("SET TimeZone = 'UTC'");
  await client.query("SET DateStyle = 'ISO, YMD'");
  // A long lock on the target is a live instance holding a row; waiting for
  // it forever would leave the operator watching a silent terminal.
  await client.query("SET lock_timeout = '10s'");
  await client.query("SET statement_timeout = '120s'");

  return {
    async rows({ text, values }) {
      // The generic names what the parser above makes true; `assertCell`
      // checks it on every value rather than trusting it.
      const result = await client.query<Cell[]>({
        text,
        values: values === undefined ? [] : [...values],
        rowMode: 'array',
      });
      return result.rows.map((row) => row.map(assertCell));
    },
    async execute({ text, values }) {
      const result = await client.query({ text, values: values === undefined ? [] : [...values] });
      return result.rowCount ?? 0;
    },
    async close() {
      await client.end();
    },
  };
}

/** A cell that must be text (an id, a name, a count cast to text). Throws on `NULL`, bytes or a missing cell. */
export function textOf(cell: Cell | undefined): string {
  if (cell === undefined || cell === null || Buffer.isBuffer(cell)) {
    throw new Error('expected a text value from the database');
  }
  return cell;
}

/** The first cell of the first row as text, for the one-value reads (`count(*)::text`, a name). */
export function singleText(rows: readonly CellRow[]): string {
  return textOf(rows[0]?.[0]);
}
