/**
 * The 13-week window the goal-adherence grid is drawn over, selected once.
 *
 * The grid ships on TWO screens: `/trends`, where it has always lived, and
 * Overview (`app/routes/dashboard.tsx`) since 2026-09-10. Both build it with
 * `buildAdherenceGrid`, and both have to agree about which days are in the
 * window, so the selection lives here rather than being written twice. A
 * second copy would drift the moment one screen's window moved.
 *
 * Pure: the caller passes the logs and the day key it already read, so no
 * clock and no store reach this module.
 */
import { computeDailyTotalsInRange } from '#app/lib/local-store';
import type { LocalFoodLog } from '#app/lib/local-store/schema';
import { startOfWeek } from '#app/lib/trend-week';
import { shiftDate } from '#app/lib/user-days';
import type { DailyTotals } from '#app/models/daily-totals';
import type { AdherenceDayTotal } from '#app/models/adherence-grid';

/** Days in a Monday→Sunday week. */
const DAYS_PER_WEEK = 7;

/** Week columns in the grid. One quarter, which is what the card's copy promises. */
export const GRID_WEEKS = 13;

/**
 * The per-day totals for `weeks` whole Monday→Sunday columns ending in the
 * week that contains `today`, oldest first. Whole weeks at both ends, so the
 * grid never draws a ragged part-week; the trailing days after `today` come
 * back as unlogged slots and `buildAdherenceGrid` renders them as spacers.
 *
 * @param allLogs - every local food log; days outside the window are ignored.
 * @param today - the person's current local day, `YYYY-MM-DD`.
 * @param weeks - how many week columns to select.
 * @returns one entry per day in the window, oldest first, gaps included.
 */
export function selectAdherenceGridDays({
  allLogs,
  today,
  weeks,
}: {
  allLogs: readonly LocalFoodLog[];
  today: string;
  weeks: number;
}): AdherenceDayTotal[] {
  const gridWeekStart = startOfWeek(today);
  return computeDailyTotalsInRange(allLogs, {
    fromDate: shiftDate(gridWeekStart, -(weeks - 1) * DAYS_PER_WEEK),
    toDate: shiftDate(gridWeekStart, DAYS_PER_WEEK - 1),
  }).map((day) => toAdherenceDayTotal(day.date, day));
}

/**
 * Converts one day's local totals into the grid's `AdherenceDayTotal` shape,
 * the one mapping shared by `selectAdherenceGridDays` (a whole contiguous
 * window, gaps included) and `selectCalendarDayLevels`
 * (`#app/lib/calendar-day-levels`, every logged day, no window). Both read
 * their totals differently, but neither may carry its own copy of THIS
 * conversion, which is exactly the drift `localFoodLogToSnapshot`'s doc
 * warns about, one level up the same call chain.
 *
 * @param date - the day's local `YYYY-MM-DD` key.
 * @param totals - that day's totals, from either `computeDailyTotals` or one
 *   entry of `computeDailyTotalsInRange`.
 * @returns the day in the shape `resolveAdherenceDay` grades.
 */
export function toAdherenceDayTotal(date: string, totals: DailyTotals): AdherenceDayTotal {
  return {
    date,
    hasLogs: totals.hasLogs,
    netCarbs: totals.summary?.netCarbs ?? null,
    protein: totals.summary?.protein ?? null,
    kcal: totals.kcal.total,
  };
}
