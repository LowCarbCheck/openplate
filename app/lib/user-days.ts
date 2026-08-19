/**
 * IANA-timezone calendar-day math, built on `Intl.DateTimeFormat` only — no
 * dependencies, no DB, fully client-safe and directly unit-testable. Every
 * "which calendar day is this?" and "what UTC instants bound this local day?"
 * question in the food tracker routes through here so the answer is consistent
 * (and DST-correct) across the diary, habit strip, and trends.
 *
 * Day boundaries are derived from the zone's offset at the relevant instant
 * (never a fixed 24h), so a spring-forward day is 23h and a fall-back day is
 * 25h — the honest length, not a rounded one.
 */

/** Matches a bare `YYYY-MM-DD` calendar date. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `timeZone` is a valid IANA name accepted by `Intl.DateTimeFormat`.
 * Empty/blank input is invalid.
 *
 * @param timeZone - candidate IANA time-zone name.
 * @returns whether the name is usable.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    // Locale fixed on purpose: nothing here is rendered — the formatter is
    // constructed solely to see whether `timeZone` is accepted.
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date (`YYYY-MM-DD`) that `now` falls on in `timeZone`.
 *
 * @param timeZone - IANA time-zone name.
 * @param now - the instant to resolve (defaults to the current instant).
 * @returns the local calendar date as `YYYY-MM-DD`.
 * @throws if `timeZone` is not a valid IANA name.
 */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid IANA time zone: ${timeZone}`);
  // Locale fixed on purpose: this output is a machine day KEY (`YYYY-MM-DD`),
  // never shown to anyone. It must not follow the UI language — a locale that
  // numbers years differently, or orders the fields differently, would change
  // every stored key. Do NOT "translate" this.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = _partsToMap(formatter.formatToParts(now));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The UTC instants that bound a local calendar day in `timeZone`: `start` is
 * that day's local midnight and `end` is the next day's local midnight. The two
 * may be 23h or 25h apart across a DST transition — the span is derived, never
 * assumed.
 *
 * @param date - the local calendar day as `YYYY-MM-DD`.
 * @param timeZone - IANA time-zone name.
 * @returns the half-open `[start, end)` UTC bounds of the local day.
 * @throws if `date` is not a valid `YYYY-MM-DD` or `timeZone` is invalid.
 */
export interface DayBounds {
  /** Inclusive UTC instant the local day starts at. */
  start: Date;
  /** Exclusive UTC instant the local day ends at. */
  end: Date;
}

export function dayBoundsInTimezone(date: string, timeZone: string): DayBounds {
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid IANA time zone: ${timeZone}`);
  const start = _zonedMidnightUtc(date, timeZone);
  const end = _zonedMidnightUtc(shiftDate(date, 1), timeZone);
  return { start, end };
}

/**
 * The UTC instant on `date` (in `timeZone`) that carries the same time-of-day
 * offset-from-local-midnight as `now` has within ITS current local day. Lets the
 * add/scan flows stamp an entry onto a day the user is browsing (not "today")
 * while keeping a sensible wall-clock time, so a back-dated log lands mid-day
 * rather than at midnight.
 *
 * When `date` is already today in `timeZone`, `now` is returned unchanged. When
 * the offset would overflow a shorter target day (a 23h DST spring-forward day),
 * it is clamped to one millisecond before the target day's end so the instant
 * always stays inside the intended calendar day.
 *
 * @param date - the target local calendar day as `YYYY-MM-DD`.
 * @param timeZone - IANA time-zone name.
 * @param now - the reference instant whose time-of-day is preserved (defaults to the current instant).
 * @returns the mapped instant on the target day.
 * @throws if `date` is not a valid `YYYY-MM-DD` or `timeZone` is invalid.
 */
export function instantOnDate(date: string, timeZone: string, now: Date = new Date()): Date {
  const today = todayInTimezone(timeZone, now);
  if (date === today) return now;
  const todayStart = dayBoundsInTimezone(today, timeZone).start.getTime();
  const offsetFromStart = now.getTime() - todayStart;
  const target = dayBoundsInTimezone(date, timeZone);
  const maxOffset = target.end.getTime() - target.start.getTime() - 1;
  const clampedOffset = Math.min(offsetFromStart, maxOffset);
  return new Date(target.start.getTime() + clampedOffset);
}

/**
 * Shifts a `YYYY-MM-DD` calendar date by `days` (may be negative), returning
 * another `YYYY-MM-DD`. Pure calendar arithmetic — independent of any zone.
 *
 * @param date - the calendar date as `YYYY-MM-DD`.
 * @param days - the number of days to add (negative to subtract).
 * @returns the shifted calendar date as `YYYY-MM-DD`.
 * @throws if `date` is not a valid `YYYY-MM-DD`.
 */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = _parseDateParts(date);
  return _formatUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/**
 * Inclusive list of calendar dates from `from` to `to` (both `YYYY-MM-DD`),
 * oldest first. Returns `[]` when `from` is after `to`.
 *
 * @param from - inclusive range start, `YYYY-MM-DD`.
 * @param to - inclusive range end, `YYYY-MM-DD`.
 * @returns the dates in `[from, to]` as `YYYY-MM-DD` strings.
 * @throws if either bound is not a valid `YYYY-MM-DD`.
 */
export function enumerateDates(from: string, to: string): string[] {
  _parseDateParts(from);
  _parseDateParts(to);
  if (from > to) return [];
  const dates: string[] = [];
  let current = from;
  while (current <= to) {
    dates.push(current);
    current = shiftDate(current, 1);
  }
  return dates;
}

/**
 * Narrows a raw query-string value to a real `YYYY-MM-DD` calendar date, or
 * `null` when it's absent, malformed, or an impossible date (e.g. `2026-13-40`).
 * The non-throwing counterpart to `_parseDateParts`, used to sanitize the
 * `?date=` param on the /add and /scan flows before it reaches a schema.
 *
 * @param value - the candidate value (a raw search param, possibly `null`).
 * @returns the value unchanged when it is a valid `YYYY-MM-DD`, else `null`.
 */
export function parseDateParam(value: string | null): string | null {
  if (value === null) return null;
  try {
    _parseDateParts(value);
    return value;
  } catch {
    return null;
  }
}

/** Collapses `Intl` date parts into a `{ type: value }` map, dropping literals. */
function _partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
}

/**
 * The offset (local wall clock minus UTC, in ms) of `timeZone` at `instant`.
 * Positive east of UTC. Derived by reading the instant's wall clock in the zone
 * and diffing it against the same reading interpreted as UTC.
 */
function _offsetMs(instant: Date, timeZone: string): number {
  // Locale fixed on purpose: the parts below are read back as NUMBERS to
  // compute a UTC offset — nothing is rendered. Following the UI language here
  // would let a locale's own calendar/numbering shift every day boundary in
  // the app. Do NOT "translate" this.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = _partsToMap(formatter.formatToParts(instant));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * The UTC instant of local midnight for `date` in `timeZone`. Iterates the
 * zone offset once so DST-transition days land on the correct instant (the
 * offset at the naive guess can differ from the offset at the true midnight).
 */
function _zonedMidnightUtc(date: string, timeZone: string): Date {
  const [year, month, day] = _parseDateParts(date);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset0 = _offsetMs(new Date(utcGuess), timeZone);
  const candidate = utcGuess - offset0;
  const offset1 = _offsetMs(new Date(candidate), timeZone);
  if (offset1 === offset0) return new Date(candidate);
  return new Date(utcGuess - offset1);
}

/** Parses `YYYY-MM-DD` into `[year, month, day]`, rejecting malformed or impossible dates. */
function _parseDateParts(date: string): [number, number, number] {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    throw new Error(`Invalid date: ${date}`);
  }
  return [year, month, day];
}

/** Formats a `Date`'s UTC fields as `YYYY-MM-DD`. */
function _formatUtcDate(instant: Date): string {
  const year = String(instant.getUTCFullYear()).padStart(4, '0');
  const month = String(instant.getUTCMonth() + 1).padStart(2, '0');
  const day = String(instant.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
