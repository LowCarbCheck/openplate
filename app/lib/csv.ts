/**
 * Tiny dependency-free CSV encoder. Pure and side-effect-free (no I/O, no DB),
 * so it unit-tests directly — see `tests/unit/csv.test.ts`. Backs the data-export
 * route, which turns a user's owner-scoped rows into a downloadable file.
 *
 * Two jobs beyond plain string-joining:
 *  1. RFC 4180 quoting — a cell containing a quote, comma, or line break is
 *     wrapped in double quotes with inner quotes doubled.
 *  2. Spreadsheet formula-injection hardening — a cell starting with `= + - @`
 *     is prefixed with a single quote so Excel/Sheets treat it as text, not a
 *     live formula (a food name like `=cmd|...` must never execute on open).
 *
 * `null`/`undefined` render as an EMPTY cell, never `0` — unknown macros stay
 * blank rather than fabricating a value the source data doesn't have.
 */

/** A single CSV cell. `null`/`undefined` render as an empty cell (never `0`). */
export type CsvCell = string | number | boolean | null | undefined;

/** One CSV record: an ordered list of cells lining up with the header columns. */
export type CsvRow = readonly CsvCell[];

/** First-character triggers that make a spreadsheet interpret a cell as a formula. */
const FORMULA_TRIGGERS: ReadonlySet<string> = new Set(['=', '+', '-', '@']);

/** RFC 4180 record separator (CRLF). */
const RECORD_SEPARATOR = '\r\n';

/** Renders a cell to its raw (pre-escaping) string; null/undefined become empty. */
function _stringifyCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell === true) return 'true';
  if (cell === false) return 'false';
  return String(cell);
}

/** Prefixes a single quote when the value would otherwise be read as a formula. */
function _hardenAgainstFormulaInjection(value: string): string {
  const firstChar = value[0];
  if (firstChar !== undefined && FORMULA_TRIGGERS.has(firstChar)) return `'${value}`;
  return value;
}

/** True when the value must be double-quoted per RFC 4180. */
function _needsQuoting(value: string): boolean {
  return value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r');
}

/** Hardens then RFC-4180-escapes a single cell into its final field text. */
function _escapeCell(cell: CsvCell): string {
  const hardened = _hardenAgainstFormulaInjection(_stringifyCell(cell));
  if (!_needsQuoting(hardened)) return hardened;
  return `"${hardened.replaceAll('"', '""')}"`;
}

/**
 * Encodes a header row plus data rows into an RFC-4180 CSV string (CRLF-separated,
 * no trailing newline). Formula-injection hardening is applied to every cell.
 *
 * @param table - the ordered `header` column names and the `rows` of cells.
 * @returns the encoded CSV document.
 */
export function encodeCsv({ header, rows }: { header: readonly string[]; rows: readonly CsvRow[] }): string {
  const lines: string[] = [header.map(_escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(_escapeCell).join(','));
  }
  return lines.join(RECORD_SEPARATOR);
}
