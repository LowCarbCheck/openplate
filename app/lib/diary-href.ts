/**
 * Pure `/diary` URL normalization for a given calendar day. No DB, no React —
 * shared by the entry-detail loader (Back link, Delete redirect) and its
 * Undo-restore submit target, so every exit from an entry returns to the day
 * it actually lives on, never always "today".
 */

/**
 * The `/diary` URL for viewing `day`: bare `/diary` when `day` IS `today`
 * (clean URL, matching the add/scan flows' convention), else
 * `/diary?date=<day>`.
 *
 * @param day - the target calendar day, `YYYY-MM-DD`.
 * @param today - today's calendar day in the same time zone, `YYYY-MM-DD`.
 * @returns the normalized `/diary` URL for `day`.
 */
export function diaryHrefForDate(day: string, today: string): string {
  return day === today ? '/diary' : `/diary?date=${day}`;
}
