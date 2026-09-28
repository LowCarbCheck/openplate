/**
 * Client-side "what day is it" — pure. When the diary is served offline the
 * server can't tell us the user's calendar day, so we fall back to the device's
 * local date. Online this is never consulted (the loader's tz-aware day wins);
 * offline it is a deliberate approximation, honest for the single-user case.
 */

/** The device-local calendar day as `YYYY-MM-DD`. */
export function clientTodayKey(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
