/**
 * Converts between the app's `YYYY-MM-DD` day keys (see `#app/lib/user-days`)
 * and the plain JS `Date` objects `react-day-picker`'s `Calendar` works with.
 *
 * Both directions are LOCAL-date arithmetic only — never `toISOString()` or
 * any other UTC-normalizing path. `toISOString()` shifts by the runtime's UTC
 * offset, so `new Date(2026, 6, 31)` (midnight local, e.g. UTC-5) serializes
 * as `"2026-07-31T05:00:00.000Z"` and slicing that string back to a day key
 * silently rolls the date forward or backward depending on the sign of the
 * offset. `localDateToDayKey` instead reads the `Date`'s own local
 * year/month/day fields (`getFullYear`/`getMonth`/`getDate`), and
 * `dayKeyToLocalDate` constructs a `Date` from those same local fields
 * (`new Date(y, m - 1, d)`) — so a day key round-trips through a `Date` and
 * back to the identical day key, regardless of the browser's time zone.
 */

/** Matches a bare `YYYY-MM-DD` calendar date. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a `YYYY-MM-DD` day key into a `Date` at local midnight on that
 * calendar day — the shape `react-day-picker`'s `selected`/`month` props
 * expect.
 *
 * @param dayKey - the calendar date as `YYYY-MM-DD`.
 * @returns a `Date` at local midnight on `dayKey`.
 * @throws if `dayKey` is not a valid `YYYY-MM-DD` string.
 */
export function dayKeyToLocalDate(dayKey: string): Date {
  const match = DATE_PATTERN.exec(dayKey);
  if (!match) throw new Error(`Invalid date (expected YYYY-MM-DD): ${dayKey}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid date: ${dayKey}`);
  }
  return date;
}

/**
 * Serializes a `Date`'s LOCAL calendar fields back to a `YYYY-MM-DD` day key
 * — the inverse of `dayKeyToLocalDate`. Deliberately reads
 * `getFullYear`/`getMonth`/`getDate` (local) rather than `toISOString()`
 * (UTC) — see this module's header for why the UTC path is a bug magnet
 * here.
 *
 * @param date - any `Date` (typically a day the user picked in the calendar).
 * @returns the local calendar date as `YYYY-MM-DD`.
 */
export function localDateToDayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
