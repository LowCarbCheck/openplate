/**
 * Which days `/nutrients` reads, and how another screen links into it.
 *
 * Two kinds of window, both in the URL so a link can name one:
 *
 * - `?range=7|14|30`: the last N days ending today, the screen's own picker.
 * - `?day=YYYY-MM-DD`: one day on its own, the diary's deep link. It wins over
 *   `range` when both are given, and the picker's links carry only `range`, so
 *   picking a range drops the day.
 *
 * Anything unreadable falls back to the 7-day default: a malformed day, an
 * impossible one, and a day after today, which has nothing logged and nothing
 * to show (the diary bounces a future `?date=` for the same reason).
 *
 * Pure: `today` is a parameter, never a clock read.
 */
import { parseDateParam, shiftDate } from '#app/lib/user-days';

/** The windows `/nutrients` offers, in days. The first three `/trends` offers, so the two screens agree on what a window is. */
export const NUTRIENT_RANGES = [7, 14, 30] as const;

export type NutrientRange = (typeof NUTRIENT_RANGES)[number];

/** The window with no (valid) parameter. */
export const DEFAULT_NUTRIENT_RANGE: NutrientRange = 7;

/** The longest window offered. */
const LARGEST_NUTRIENT_RANGE: NutrientRange = NUTRIENT_RANGES[2];

/** One day on its own. */
export interface NutrientDayWindow {
  kind: 'day';
  day: string;
  fromDate: string;
  toDate: string;
}

/** The last `range` days, ending today. */
export interface NutrientRangeWindow {
  kind: 'range';
  range: NutrientRange;
  fromDate: string;
  toDate: string;
}

export type NutrientWindow = NutrientDayWindow | NutrientRangeWindow;

/**
 * Reads an explicit `range` search parameter.
 *
 * @param raw - the parameter, or null when absent.
 * @returns the range, or the default for anything that is not an offered window.
 */
export function parseNutrientRange(raw: string | null): NutrientRange {
  const value = Number(raw);
  return NUTRIENT_RANGES.find((allowed) => allowed === value) ?? DEFAULT_NUTRIENT_RANGE;
}

/**
 * The window a `/nutrients` URL asks for.
 *
 * @param input - the raw `day` and `range` parameters, and the person's local today.
 * @returns the single day when `day` is a real date no later than today, else the range window.
 */
export function resolveNutrientWindow({
  day,
  range,
  today,
}: {
  day: string | null;
  range: string | null;
  today: string;
}): NutrientWindow {
  const parsedDay = parseDateParam(day);
  if (parsedDay !== null && parsedDay <= today) {
    return { kind: 'day', day: parsedDay, fromDate: parsedDay, toDate: parsedDay };
  }
  const parsedRange = parseNutrientRange(range);
  return { kind: 'range', range: parsedRange, fromDate: shiftDate(today, -(parsedRange - 1)), toDate: today };
}

/**
 * The `/nutrients` window that answers another screen's range of `days`: the
 * smallest offered window that contains it, else the largest one. `/trends`
 * offers 90 days, and `/nutrients` stops at 30, so 90 maps to 30.
 *
 * @param days - the other screen's range, in days.
 * @returns the window to read and to link to.
 */
export function nutrientRangeFor(days: number): NutrientRange {
  return NUTRIENT_RANGES.find((range) => range >= days) ?? LARGEST_NUTRIENT_RANGE;
}

/**
 * The deep link for one day.
 *
 * @param day - a `YYYY-MM-DD` date.
 * @returns the path, with no trailing slash.
 */
export function nutrientsDayHref(day: string): string {
  return `/nutrients?day=${day}`;
}

/**
 * The deep link for a window of days.
 *
 * @param range - an offered window.
 * @returns the path, with no trailing slash.
 */
export function nutrientsRangeHref(range: NutrientRange): string {
  return `/nutrients?range=${range}`;
}
