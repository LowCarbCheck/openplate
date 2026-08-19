/**
 * Pure "eating window" computation for the trends recap. DB-free and
 * unit-testable. The eating window is the first→last logged-meal span within a
 * day; the recap reports the *median* span across the week's logged days so a
 * single unusual day (a very early snack, a late-night one) doesn't skew it.
 *
 * Honesty guard: with fewer than `minLoggedDays` logged days there isn't enough
 * signal to claim a habit, so the caller is told to skip the line (null return)
 * rather than show a median built on one or two days.
 */

/** Minutes in an hour — span math is done in milliseconds, reported in minutes. */
const MS_PER_MINUTE = 60_000;

/** Default: at least three logged days before an eating-window median is meaningful. */
const DEFAULT_MIN_LOGGED_DAYS = 3;

/** The median eating-window span across a week's logged days. */
export interface EatingWindow {
  /** Median first→last-meal span, in whole-ish minutes (may be fractional). */
  medianSpanMinutes: number;
  /** How many logged days contributed a span. */
  loggedDayCount: number;
}

/**
 * The median first→last-meal span across the week's logged days.
 *
 * @param input.days - per-day lists of log timestamps (epoch ms), one entry per day.
 * @param input.minLoggedDays - minimum logged days required to report a window.
 * @returns the median span + logged-day count, or null when too few days logged.
 */
export function computeEatingWindow({
  days,
  minLoggedDays = DEFAULT_MIN_LOGGED_DAYS,
}: {
  days: readonly { loggedAtMs: readonly number[] }[];
  minLoggedDays?: number;
}): EatingWindow | null {
  const spans: number[] = [];
  for (const day of days) {
    if (day.loggedAtMs.length === 0) continue;
    const earliest = Math.min(...day.loggedAtMs);
    const latest = Math.max(...day.loggedAtMs);
    spans.push((latest - earliest) / MS_PER_MINUTE);
  }
  if (spans.length < minLoggedDays) return null;
  return { medianSpanMinutes: _median(spans), loggedDayCount: spans.length };
}

/** Median of a non-empty list (mean of the two middles when the count is even). */
function _median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}
