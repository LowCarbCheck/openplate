/**
 * Pure weight-progress stats for the Progress page's weight card — latest
 * weigh-in, smoothed change across the window, distance to target, and whether
 * the target was just crossed. No DB, no React, so it's directly unit-testable
 * (same split as `trend-weight.ts`).
 *
 * Everything stays in kilograms; converting to the reader's display unit is the
 * caller's job. The at-target verdicts compare values ROUNDED for display
 * (`roundWeightForDisplay`), for the same reason `goal-progress.ts` rounds its
 * gram comparisons: a tile must never say "0.0 kg to go" next to "not there
 * yet" for the same number.
 *
 * Deliberately NOT here: any projection ("at this rate you'll reach 70 kg
 * on…"). The EWMA is a smoother, not a forecaster, and a date it can't support
 * would be a claim the data doesn't make.
 */
import { exponentialMovingAverage, type DatedValue } from '#app/lib/ewma';
import { roundWeightForDisplay } from '#app/lib/weight-units';

/** Which way the user is working. Inferred once from the window's first weigh-in vs the target. */
export type WeightDirection = 'down' | 'up';

export interface WeightProgress {
  /** Most recent raw weigh-in in the window (what the scale said), or null. */
  latestKg: number | null;
  /** Its date, `YYYY-MM-DD`, or null. */
  latestDate: string | null;
  /** Last EWMA value — the emphasis series' endpoint, or null. */
  trendKg: number | null;
  /** Trend last − trend first across the window; null with fewer than 2 weigh-ins. */
  changeKg: number | null;
  /** Distance still to travel toward the target (negative once past it); null without a target or a weigh-in. */
  toTargetKg: number | null;
  /** Null when no target is set. */
  direction: WeightDirection | null;
  /** True when the latest weigh-in is at or past the target in `direction`. */
  hasReachedTarget: boolean;
  /**
   * True when the LATEST weigh-in reached the target and the one before it had
   * not — a genuine crossing, not a standing state. This, not
   * `hasReachedTarget`, is what arms the celebration.
   */
  crossedTargetOnLatest: boolean;
}

/** Whether a weigh-in is at or past `target` in `direction`, decided on display-rounded values. */
function isAtOrPastTarget({
  weightKg,
  targetWeightKg,
  direction,
}: {
  weightKg: number;
  targetWeightKg: number;
  direction: WeightDirection;
}): boolean {
  const weight = roundWeightForDisplay(weightKg);
  const target = roundWeightForDisplay(targetWeightKg);
  return direction === 'down' ? weight <= target : weight >= target;
}

/**
 * The stats the weight tiles render.
 *
 * @param entries - weigh-ins in the window, ascending by date.
 * @param targetWeightKg - the user's target, or null.
 * @returns the stats, all in kilograms.
 */
export function computeWeightProgress({
  entries,
  targetWeightKg,
}: {
  entries: readonly DatedValue[];
  targetWeightKg: number | null;
}): WeightProgress {
  const empty: WeightProgress = {
    latestKg: null,
    latestDate: null,
    trendKg: null,
    changeKg: null,
    toTargetKg: null,
    direction: null,
    hasReachedTarget: false,
    crossedTargetOnLatest: false,
  };
  if (entries.length === 0) return empty;

  const latest = entries[entries.length - 1];
  const trend = exponentialMovingAverage([...entries]);
  const changeKg = trend.length >= 2 ? roundWeightForDisplay(trend[trend.length - 1].value - trend[0].value) : null;

  if (targetWeightKg === null) {
    return {
      ...empty,
      latestKg: latest.value,
      latestDate: latest.date,
      trendKg: trend[trend.length - 1].value,
      changeKg,
    };
  }

  // Inferred from the window's FIRST weigh-in, not from the series' movement:
  // a weight-loss user who gained during the window is still working downward,
  // and a movement-derived direction would tell them they were at their target.
  const direction: WeightDirection = entries[0].value > targetWeightKg ? 'down' : 'up';
  const hasReachedTarget = isAtOrPastTarget({ weightKg: latest.value, targetWeightKg, direction });
  const previous = entries.length >= 2 ? entries[entries.length - 2] : null;
  const wasAlreadyThere =
    previous !== null && isAtOrPastTarget({ weightKg: previous.value, targetWeightKg, direction });
  const remaining = direction === 'down' ? latest.value - targetWeightKg : targetWeightKg - latest.value;

  return {
    latestKg: latest.value,
    latestDate: latest.date,
    trendKg: trend[trend.length - 1].value,
    changeKg,
    toTargetKg: roundWeightForDisplay(remaining),
    direction,
    hasReachedTarget,
    crossedTargetOnLatest: hasReachedTarget && previous !== null && !wasAlreadyThere,
  };
}
