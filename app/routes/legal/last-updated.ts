/**
 * When the legal documents last changed, as ONE date in ONE place.
 *
 * It used to be typed into each page as English prose ("Last updated: July 28,
 * 2026"), which is two problems at once. Two documents drifted to different
 * dates, and a translated page would either carry an English date or a
 * hand-typed German one that nobody would think to update.
 *
 * Now it is an ISO date formatted for the reader's language, so "September 1,
 * 2026" and "1. September 2026" are the same fact rendered twice. Bump it when
 * you make a MATERIAL change to any of the three pages; both documents say the
 * reader can rely on this date, so a stale one is a small lie.
 */
export const LEGAL_LAST_UPDATED = '2026-09-01';

/** @param language - the active i18n language code; anything unknown falls back to `en`. */
export function formatLegalDate(isoDate: string, language: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(language || 'en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
