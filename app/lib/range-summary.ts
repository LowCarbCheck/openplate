/**
 * Pure range-level summary for the Overview tab's summary strip (M239/06):
 * the chosen chart range's days logged, and its average kcal/net carbs/protein
 * over LOGGED days, each compared against the same-length range immediately
 * before it.
 *
 * MIRRORS `computeWeeklyRecap`'s averaging rule (`#app/lib/trend-recap`)
 * rather than inventing a second one: a day with nothing logged is left out
 * of both the count and the mean, never counted as a zero, and every mean is
 * taken over the SAME population of days its own count describes. It does not
 * call that function directly, because `computeWeeklyRecap` is shaped around
 * a Monday to Sunday week: its `today`/`netCarbsCeiling`/`proteinFloor`
 * inputs drive `elapsedDays` and the goal-hit counts, fields this summary
 * strip doesn't show, and this summary's window is an arbitrary chart range,
 * not a week. Duplicating the "logged days only" filter and mean here is the
 * same judgment call as the Atwater factors and the net-carbs formula
 * elsewhere in this codebase: a handful of duplicated lines beats a shared
 * function whose parameters exist only for the OTHER caller.
 */
import type { TrendDay } from '#app/lib/trend-chart';

/** One metric's range average, and its change against the range before it. */
export interface RangeMetricSummary {
  /** Mean over the range's logged days, or null when none were logged. */
  average: number | null;
  /** `average` minus the previous range's average, or null when either side has no logged days. */
  change: number | null;
}

/** The overview summary strip's figures for one chart range. */
export interface RangeSummary {
  /** How many of the range's days have at least one logged entry. */
  loggedDays: number;
  kcal: RangeMetricSummary;
  netCarbs: RangeMetricSummary;
  protein: RangeMetricSummary;
}

/** A day whose macro summary is present (it has logs). */
type SummarizedDay = TrendDay & { summary: NonNullable<TrendDay['summary']> };

/** Narrows to a logged day, the same test `computeWeeklyRecap` applies. */
function _isSummarized(day: TrendDay): day is SummarizedDay {
  return day.summary !== null;
}

/** Arithmetic mean of a non-empty list. */
function _mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The mean of one summary field across a range's logged days, or null when none were logged. */
function _average(days: readonly TrendDay[], pick: (day: SummarizedDay) => number): number | null {
  const logged = days.filter(_isSummarized);
  return logged.length === 0 ? null : _mean(logged.map(pick));
}

/** One metric's average plus its change against the range before, or a null change when either side is null. */
function _metricSummary({ current, previous }: { current: number | null; previous: number | null }): RangeMetricSummary {
  return { average: current, change: current === null || previous === null ? null : current - previous };
}

/**
 * Aggregates one chart range against the same-length range immediately
 * before it.
 *
 * @param current - the chosen range's per-day totals.
 * @param previous - the same-length range immediately before it.
 * @returns the range's logged-day count and its three metric summaries.
 */
export function computeRangeSummary({
  current,
  previous,
}: {
  current: readonly TrendDay[];
  previous: readonly TrendDay[];
}): RangeSummary {
  return {
    loggedDays: current.filter(_isSummarized).length,
    kcal: _metricSummary({
      current: _average(current, (day) => day.summary.kcal),
      previous: _average(previous, (day) => day.summary.kcal),
    }),
    netCarbs: _metricSummary({
      current: _average(current, (day) => day.summary.netCarbs),
      previous: _average(previous, (day) => day.summary.netCarbs),
    }),
    protein: _metricSummary({
      current: _average(current, (day) => day.summary.protein),
      previous: _average(previous, (day) => day.summary.protein),
    }),
  };
}
