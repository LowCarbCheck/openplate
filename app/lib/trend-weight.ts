/**
 * Pure weekly weight-change computation for the trends recap. DB-free and
 * unit-testable. This is deliberately the *raw* first→last delta within the
 * week (not a smoothed trend) — the recap labels it as noisy day-to-day scale
 * data. Smoothing (EWMA) is another module's job; this one must not invent it.
 */

/** The raw first→last weight delta over a week. */
export interface WeeklyWeightChange {
  /** The earliest weigh-in's weight (kg). */
  firstKg: number;
  /** The latest weigh-in's weight (kg). */
  lastKg: number;
  /** `lastKg - firstKg` (negative = weight down). */
  deltaKg: number;
  /** How many weigh-ins the week had. */
  entryCount: number;
}

/**
 * The raw first→last weight change across a week's weigh-ins. Returns null when
 * there are fewer than two entries — a single point (or none) has no "change" to
 * report, and fabricating a 0 delta would read as "no change" rather than "not
 * enough data".
 *
 * @param entries - the week's weigh-ins (`measuredAt` = `YYYY-MM-DD`, `weightKg`).
 * @returns the first→last delta, or null when there are under two entries.
 */
export function computeWeeklyWeightChange(
  entries: readonly { measuredAt: string; weightKg: number }[],
): WeeklyWeightChange | null {
  if (entries.length < 2) return null;
  const sorted = entries.toSorted((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    firstKg: first.weightKg,
    lastKg: last.weightKg,
    deltaKg: last.weightKg - first.weightKg,
    entryCount: sorted.length,
  };
}
