/**
 * The trailing rolling average the trends chart draws as a line over its daily
 * bars (M239/03). Pure: plain numbers in, plain numbers out, no store and no
 * clock.
 *
 * THE HONESTY RULE CARRIES OVER FROM THE BARS. A day with nothing logged is
 * `null`, and a `null` is left out of the window, never counted as a zero.
 * Dividing by the window's full length would turn every skipped day into a day
 * of eating nothing and drag the line down, the same mistake `bucketByWeek`
 * and `computeWeeklyRecap` refuse to make.
 */
import { selectMetricValue } from '#app/lib/trend-chart';
import type { TrendDay, TrendMetric } from '#app/lib/trend-chart';

/** The trailing window the chart's line averages over, in days. */
export const ROLLING_AVERAGE_DAYS = 7;

/**
 * For each position, the mean of the non-null values in the trailing window
 * that ends there (the position itself and the `windowSize - 1` before it).
 * A window that holds no value at all gives `null`: no logged day, no line.
 *
 * The caller passes the days BEFORE the chart's first bar too, when it has
 * them, and drops them from the result: otherwise the first bars' windows
 * would be cut short at the chart's left edge.
 *
 * @param input.values - one value per consecutive day, oldest first; `null` for a day with nothing to count.
 * @param input.windowSize - the window length in days, `ROLLING_AVERAGE_DAYS` unless a test says otherwise.
 * @returns one average per input position, or `null` where the window was empty.
 */
export function computeRollingAverage({
  values,
  windowSize = ROLLING_AVERAGE_DAYS,
}: {
  values: readonly (number | null)[];
  windowSize?: number;
}): (number | null)[] {
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new Error(`A rolling window must be a whole number of days, got ${windowSize}`);
  }
  return values.map((_, index) => averageOfLogged(values.slice(Math.max(0, index - windowSize + 1), index + 1)));
}

/** The mean of the non-null values, or `null` when there are none. */
function averageOfLogged(window: readonly (number | null)[]): number | null {
  const logged = window.filter((value): value is number => value !== null);
  if (logged.length === 0) return null;
  return logged.reduce((sum, value) => sum + value, 0) / logged.length;
}

/**
 * The chart's average line as height fractions, one per bar. Each day counts
 * the same figure its bar is drawn from (`selectMetricValue`), so the line and
 * the bars can never disagree about a day. The `leadDays` before the first bar
 * fill that bar's window and are then dropped, so the line does not start
 * artificially short at the chart's left edge.
 *
 * @param input.leadDays - the days just before the first bar, oldest first (up to `ROLLING_AVERAGE_DAYS - 1`).
 * @param input.days - the charted days, oldest first, one per bar.
 * @param input.metric - the plotted series.
 * @param input.domainMax - the chart's axis top; a fraction above 1 is capped at the top of the plot.
 * @returns one fraction 0..1 per bar, or `null` where the window held no logged day.
 */
export function selectAverageFractions({
  leadDays,
  days,
  metric,
  domainMax,
}: {
  leadDays: readonly TrendDay[];
  days: readonly TrendDay[];
  metric: TrendMetric;
  domainMax: number;
}): (number | null)[] {
  if (domainMax <= 0) throw new Error(`The chart axis must be positive, got ${domainMax}`);
  const values = [...leadDays, ...days].map((day) => selectMetricValue({ day, metric }));
  return computeRollingAverage({ values })
    .slice(leadDays.length)
    .map((average) => (average === null ? null : Math.min(average / domainMax, 1)));
}
