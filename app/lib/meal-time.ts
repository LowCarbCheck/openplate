/**
 * Maps a time of day to a default meal type for the quick-add flow (/add). Pure
 * — no DB, no React, directly unit-testable. The `/add` portion step seeds its
 * meal select from the user's LOCAL time of day so the common case (log lunch
 * around noon) needs zero taps.
 *
 * Windows (local wall clock):
 *  - breakfast 04:00–10:59
 *  - lunch     11:00–14:59
 *  - dinner    17:00–21:59
 *  - snack     everything else (the mid-afternoon and late-night gaps)
 */
import type { MealType } from '#types/enums';

/** Minutes in one hour — avoids the `* 60` magic number below. */
const MINUTES_PER_HOUR = 60;

/** Inclusive breakfast start (04:00) as minutes since local midnight. */
const BREAKFAST_START_MIN = 4 * MINUTES_PER_HOUR;
/** Exclusive breakfast end / lunch start (11:00) — 10:59 is the last breakfast minute. */
const LUNCH_START_MIN = 11 * MINUTES_PER_HOUR;
/** Exclusive lunch end (15:00) — 14:59 is the last lunch minute. */
const LUNCH_END_MIN = 15 * MINUTES_PER_HOUR;
/** Inclusive dinner start (17:00). */
const DINNER_START_MIN = 17 * MINUTES_PER_HOUR;
/** Exclusive dinner end (22:00) — 21:59 is the last dinner minute. */
const DINNER_END_MIN = 22 * MINUTES_PER_HOUR;

/** Matches a 24-hour `HH:mm` wall-clock string. */
const HHMM_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * Classifies a minutes-since-local-midnight value into a default meal type.
 * The single source of truth for the window boundaries.
 *
 * @param minutesSinceMidnight - local minutes since midnight, in `[0, 1440)`.
 * @returns the default meal type for that time.
 */
export function mealTypeForMinutes(minutesSinceMidnight: number): MealType {
  if (minutesSinceMidnight >= BREAKFAST_START_MIN && minutesSinceMidnight < LUNCH_START_MIN) return 'breakfast';
  if (minutesSinceMidnight >= LUNCH_START_MIN && minutesSinceMidnight < LUNCH_END_MIN) return 'lunch';
  if (minutesSinceMidnight >= DINNER_START_MIN && minutesSinceMidnight < DINNER_END_MIN) return 'dinner';
  return 'snack';
}

/** Parses a `HH:mm` string into minutes since midnight, rejecting malformed/out-of-range input. */
function parseHHmm(value: string): number {
  const match = HHMM_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid HH:mm time: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid HH:mm time: ${value}`);
  return hours * MINUTES_PER_HOUR + minutes;
}

/** Reads the local wall-clock minutes of `at` in `timezone` via `Intl` (throws on an invalid zone). */
function localMinutesInTimezone(at: Date, timezone: string): number {
  // Locale fixed on purpose: the hour/minute parts are read back as NUMBERS to
  // pick a meal window — nothing is rendered. Following the UI language would
  // make the meal defaults locale-dependent. Do NOT "translate" this.
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(at);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * MINUTES_PER_HOUR + minute;
}

/**
 * The default meal type for a time of day, accepting either a `HH:mm` local
 * wall-clock string or an instant plus the IANA zone to read it in.
 *
 * @param input - a `HH:mm` string, or `{ at, timezone }` to resolve the local wall clock.
 * @returns the default meal type.
 * @throws if a `HH:mm` string is malformed or the time zone is invalid.
 */
export function mealTypeForTime(input: string | { at: Date; timezone: string }): MealType {
  const minutes =
    input instanceof Object ? localMinutesInTimezone(input.at, input.timezone) : parseHHmm(input);
  return mealTypeForMinutes(minutes);
}

/**
 * Display label for a meal — "Breakfast" … "Snack", and "No meal" for an entry
 * with none. Shared so the diary's meal-group headers and the add-toast's
 * "To ⟨meal⟩ —" clause can never drift apart (M129/03).
 *
 * @param mealType - the meal, or null when the entry has none.
 * @returns the label to render.
 */
export function mealLabel(mealType: MealType | null): string {
  if (mealType === null) return 'No meal';
  return mealType.charAt(0).toUpperCase() + mealType.slice(1);
}
