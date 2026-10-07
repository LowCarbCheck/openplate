/**
 * Refuses to run against a schema this build does not know.
 *
 * The copy in `tables.ts` names every column it moves. A source with a column
 * the tool does not name would lose that column's data SILENTLY, and a target
 * missing one would fail halfway through an account. Both are checked before
 * the first read of user data, against `information_schema` on each side:
 *
 *  - every table on either side is classified (`MOVED_TABLES` or `SKIPPED_TABLES`);
 *  - every moved table has exactly the columns `tables.ts` names, on both sides;
 *  - `accounts` may lack `label`, `free_daily_ai_limit`, `capabilities` and
 *    `ai_limit_period` on the SOURCE only (a source older than migrations
 *    0024, 0026, 0031 and 0034), because the move sets all four and never
 *    reads them. The TARGET must have all four: deploy the core that carries
 *    migration 0034 to the target before the move.
 */
import {
  ACCOUNT_COLUMNS_ABSENT_FROM_OLDER_SOURCES,
  ACCOUNT_COPIED_COLUMNS,
  ACCOUNT_SET_COLUMNS,
  isClassifiedTable,
  OWNED_TABLES,
  PAIR_TABLES,
} from './tables.js';
import { textOf, type VerbatimClient } from './verbatim-client.js';

/** Table name to its column names, as one side's `public` schema holds them. */
export type SchemaColumns = ReadonlyMap<string, ReadonlySet<string>>;

export async function readSchemaColumns(client: VerbatimClient): Promise<SchemaColumns> {
  const rows = await client.rows({
    text:
      'SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ' +
      'ON t.table_schema = c.table_schema AND t.table_name = c.table_name ' +
      "WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name, c.ordinal_position",
  });
  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = textOf(row[0]);
    const existing = columns.get(name) ?? new Set<string>();
    existing.add(textOf(row[1]));
    columns.set(name, existing);
  }
  return columns;
}

function describeDifference(input: {
  side: string;
  table: string;
  actual: ReadonlySet<string>;
  expected: readonly string[];
}): string | null {
  const missing = input.expected.filter((column) => !input.actual.has(column));
  const unknown = [...input.actual].filter((column) => !input.expected.includes(column));
  if (missing.length === 0 && unknown.length === 0) return null;
  const parts = [
    missing.length > 0 ? `lacks ${missing.join(', ')}` : null,
    unknown.length > 0 ? `has columns this build does not copy: ${unknown.join(', ')}` : null,
  ].filter((part) => part !== null);
  return `${input.side} ${input.table} ${parts.join('; ')}`;
}

function checkClassified(input: { side: string; schema: SchemaColumns }): string[] {
  return [...input.schema.keys()]
    .filter((table) => !isClassifiedTable(table))
    .map((table) => `${input.side} has a table this build does not know how to move: ${table}`);
}

function checkMovedTables(input: { side: string; schema: SchemaColumns }): string[] {
  const problems: string[] = [];
  for (const table of [...OWNED_TABLES, ...PAIR_TABLES]) {
    const actual = input.schema.get(table.name);
    if (actual === undefined) {
      problems.push(`${input.side} has no table ${table.name}`);
      continue;
    }
    const difference = describeDifference({ side: input.side, table: table.name, actual, expected: table.columns });
    if (difference !== null) problems.push(difference);
  }
  return problems;
}

function checkAccounts(input: { side: 'source' | 'target'; schema: SchemaColumns }): string[] {
  const actual = input.schema.get('accounts');
  if (actual === undefined) return [`${input.side} has no table accounts`];
  const everyColumn: readonly string[] = [...ACCOUNT_COPIED_COLUMNS, ...ACCOUNT_SET_COLUMNS];
  const optional: readonly string[] = input.side === 'source' ? ACCOUNT_COLUMNS_ABSENT_FROM_OLDER_SOURCES : [];
  const expected = everyColumn.filter((column) => !optional.includes(column) || actual.has(column));
  const difference = describeDifference({ side: input.side, table: 'accounts', actual, expected });
  if (difference === null) return [];
  if (input.side === 'target' && !actual.has('label')) {
    return [`${difference}. Deploy the core that carries migration 0024 (accounts.label) to the target first`];
  }
  if (input.side === 'target' && !actual.has('free_daily_ai_limit')) {
    return [
      `${difference}. Deploy the core that carries migration 0028 (accounts.free_daily_ai_limit) to the target first`,
    ];
  }
  if (input.side === 'target' && !actual.has('capabilities')) {
    return [`${difference}. Deploy the core that carries migration 0031 (accounts.capabilities) to the target first`];
  }
  if (input.side === 'target' && !actual.has('ai_limit_period')) {
    return [
      `${difference}. Deploy the core that carries migration 0034 (accounts.ai_limit_period) to the target first`,
    ];
  }
  return [difference];
}

/** Every reason the two schemas cannot be moved between, or none. */
export function checkSchemas(input: { source: SchemaColumns; target: SchemaColumns }): string[] {
  return [
    ...checkClassified({ side: 'source', schema: input.source }),
    ...checkClassified({ side: 'target', schema: input.target }),
    ...checkAccounts({ side: 'source', schema: input.source }),
    ...checkAccounts({ side: 'target', schema: input.target }),
    ...checkMovedTables({ side: 'source', schema: input.source }),
    ...checkMovedTables({ side: 'target', schema: input.target }),
  ];
}
