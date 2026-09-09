/**
 * Pregnancy and lactation, derived from a DATE rather than from a picked stage
 * (M206/01). A person who picks "second trimester" is right on the day they
 * pick it and wrong a month later, with nothing in the store to say which; a
 * due date is right forever and the stage falls out of it.
 *
 * Every function here takes `today` as a `YYYY-MM-DD` parameter and reads no
 * clock of its own, the same rule `app/models/fasting.ts` follows with `nowMs`.
 * That is what makes the whole module unit-testable at any point in a pregnancy
 * without moving a system clock, and it is what lets a caller in a user's own
 * time zone (`todayInTimezone`) decide which calendar day "today" is.
 *
 * Dates are compared as UTC calendar days. Nothing here builds a local `Date`
 * from a day key, so a browser west of UTC and a browser east of it agree on
 * the week count for the same two day keys.
 */
import { parseDateParam, shiftDate } from '#app/lib/user-days';

/** Which third of the pregnancy a gestation week falls in. */
export type Trimester = 1 | 2 | 3;

/** How far along a pregnancy is on a given day. */
export interface Gestation {
  /** Completed gestation weeks, 1 or more (see `resolveGestation` for the clamp). */
  week: number;
  trimester: Trimester;
}

/**
 * The furthest ahead a due date may sit and still describe a pregnancy: 42
 * weeks, two more than full term. Anything beyond that is a typo (a year
 * mistyped, a date picked in the wrong month) rather than a very early
 * pregnancy, and `resolveGestation` refuses it instead of reporting week 1.
 */
export const MAX_WEEKS_AHEAD = 42;

/** Full term in weeks, the zero point the gestation week is counted back from. */
const FULL_TERM_WEEKS = 40;

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

/**
 * The UTC midnight instant of a `YYYY-MM-DD` day key, or `null` when the value
 * is missing or is not a real calendar date. `parseDateParam` owns the
 * validation, so an impossible date like `2026-13-40` is rejected here exactly
 * as it is on the `?date=` params.
 */
function utcDayMs(date: string | null | undefined): number | null {
  const valid = parseDateParam(date ?? null);
  if (valid === null) return null;
  const [year, month, day] = valid.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** The trimester a gestation week belongs to: 1-13, 14-27, 28 and up. */
function trimesterForWeek(week: number): Trimester {
  if (week <= 13) return 1;
  if (week <= 27) return 2;
  return 3;
}

/**
 * How far along a pregnancy is on `today`, from the expected date of birth.
 *
 * The week is `40 - weeksUntilDueDate`, where the weeks remaining are counted
 * with `Math.ceil`, a due date 183 days out is 27 weeks away, not 26.14, so
 * the person is in week 13 until the day the 26-week mark is reached exactly.
 * The result is clamped to week 1, so a date near `MAX_WEEKS_AHEAD` reports the
 * first week rather than a negative one.
 *
 * @param input.dueDate - the expected date of birth as `YYYY-MM-DD`, or `null`.
 * @param input.today - the day to resolve against, as `YYYY-MM-DD`.
 * @returns the gestation week and trimester, or `null` when there is no usable
 *   stage: no date, an unparseable date, a date more than `MAX_WEEKS_AHEAD`
 *   ahead, or a due date already past. A passed due date is a real state and it
 *   is deliberately NOT a stage, the app asks about it (spec 04) rather than
 *   quietly reporting week 41.
 */
export function resolveGestation(input: { dueDate: string | null | undefined; today: string }): Gestation | null {
  const dueMs = utcDayMs(input.dueDate);
  const todayMs = utcDayMs(input.today);
  if (dueMs === null || todayMs === null) return null;

  const daysUntilDue = (dueMs - todayMs) / MS_PER_DAY;
  if (daysUntilDue < 0) return null;

  const weeksUntilDue = Math.ceil(daysUntilDue / DAYS_PER_WEEK);
  if (weeksUntilDue > MAX_WEEKS_AHEAD) return null;

  const week = Math.max(1, FULL_TERM_WEEKS - weeksUntilDue);
  return { week, trimester: trimesterForWeek(week) };
}

/**
 * Whole months of lactation on `today`, counted from the birth date, calendar
 * months, so the 15th of March against a 15th of January start is two months
 * and the 14th is one.
 *
 * @param input.startDate - the birth date as `YYYY-MM-DD`, or `null`.
 * @param input.today - the day to resolve against, as `YYYY-MM-DD`.
 * @returns the month count (0 in the first month), or `null` when there is no
 *   date, the date is unparseable, or it lies in the future.
 */
export function resolveLactationMonths(input: { startDate: string | null | undefined; today: string }): number | null {
  const start = parseDateParam(input.startDate ?? null);
  const today = parseDateParam(input.today);
  if (start === null || today === null) return null;
  if (today < start) return null;

  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const wholeMonths = (todayYear - startYear) * 12 + (todayMonth - startMonth);
  if (todayDay < startDay) return wholeMonths - 1;
  return wholeMonths;
}

/**
 * The due date implied by "I am N weeks along today", the inverse of
 * `resolveGestation`'s week, for a settings form that asks the easier question.
 * A person who knows they are 20 weeks along gets a stored date, and the date is
 * what advances afterwards.
 *
 * @param input.weeks - the gestation week the person is in today.
 * @param input.today - the day that claim is made, as `YYYY-MM-DD`.
 * @returns the implied due date as `YYYY-MM-DD`.
 * @throws if `today` is not a valid `YYYY-MM-DD`.
 */
export function dueDateFromWeeksAlong(input: { weeks: number; today: string }): string {
  return shiftDate(input.today, (FULL_TERM_WEEKS - input.weeks) * DAYS_PER_WEEK);
}
