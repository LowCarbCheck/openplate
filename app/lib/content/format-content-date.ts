/**
 * A content page's `updated` date, written out for the reader's language.
 *
 * The file carries an ISO date (`2026-09-21`) and nothing else, so
 * "September 21, 2026" and "21. September 2026" are the same fact drawn twice,
 * and no translated page can carry a hand-typed date of its own.
 *
 * @param input.isoDate - `YYYY-MM-DD`, already checked by the parser.
 * @param input.language - the UI language code; an empty one falls back to English.
 */
export function formatContentDate(input: { isoDate: string; language: string }): string {
  const parsed = new Date(`${input.isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(input.language || 'en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
