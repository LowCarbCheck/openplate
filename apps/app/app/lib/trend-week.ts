/**
 * Calendar-week helpers for the trends recap. Pure date-string arithmetic
 * (no DB, no timezone assumptions beyond the already-local `YYYY-MM-DD` input),
 * so they're directly unit-testable — same split as `user-days.ts`. Weeks run
 * Monday→Sunday, matching how the recap card compares "this week" to "last week".
 */
import { shiftDate } from '#app/lib/user-days';

/** Days in a Monday→Sunday week. */
const DAYS_PER_WEEK = 7;

/**
 * The Monday (`YYYY-MM-DD`) of the week containing `date`. The input is already
 * a local calendar date, so the weekday is read as a UTC field (no zone shift):
 * `getUTCDay()` returns 0=Sunday…6=Saturday, remapped so Monday is the anchor.
 *
 * @param date - a local calendar date, `YYYY-MM-DD`.
 * @returns the Monday that starts that week, `YYYY-MM-DD`.
 * @throws if `date` is not a valid `YYYY-MM-DD` (via `shiftDate`).
 */
export function startOfWeek(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysFromMonday = (weekday + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
  return shiftDate(date, -daysFromMonday);
}
