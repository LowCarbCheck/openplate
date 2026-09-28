/**
 * Pure per-goal statistics for the Goals tab (M239/05): how often each daily
 * goal was met, by how much the days usually sat under or over it, and the
 * current and best run of met days. No store, no clock, no React: the resolved
 * adherence grid and the goals it was graded against come in, plain numbers
 * go out.
 *
 * ONE SOURCE OF VERDICTS. Every met/missed/unknown here is the grid's own
 * per-day verdict (`buildAdherenceGrid`), never re-derived, so a day cannot
 * read "met" in the grid and "missed" on a goal card for the same number.
 * The goal DIRECTION (ceiling or floor) is read from `goalDirectionFor` in
 * `#app/lib/trend-chart`, the one direction model the chart already uses.
 *
 * THE WINDOW is the grid's 13 weeks, COMPLETE days only: never a future slot
 * of the current week and never today. The grid marks today "still going",
 * and a protein floor at nine in the morning is not a missed goal, it is an
 * unfinished day. The headline sentence is the grid's own summary and keeps
 * the grid's own counts, so it is not computed here.
 *
 * THE RATE. `hitRate` is met days over RATED days. A day whose figure for a
 * goal is unknown (logged, but the macro could not be worked out) is left out
 * of both sides and counted in `unknownDays` instead: the app never scores a
 * goal on data it does not have. With no rated day the rate is null, not 0.
 *
 * THE RUNS. Walked oldest to newest over the complete days:
 *
 * - a met day extends the run by one;
 * - a missed day restarts it at zero;
 * - a day with NOTHING logged breaks it, back to zero, because a run of met
 *   days is a run of days, and an empty day was not one of them;
 * - an UNKNOWN day neither extends nor breaks it, it is skipped. Missing
 *   detail is not a miss, and it is not a met day either.
 *
 * `currentRun` is the run standing at the end of yesterday, the last complete
 * day. `bestRun` is the longest run anywhere in the window.
 */
import { goalDirectionFor } from '#app/lib/trend-chart';
import type { GoalDirection, TrendMetric } from '#app/lib/trend-chart';
import { ADHERENCE_GOAL_KEYS } from '#app/models/adherence-grid';
import type { AdherenceDay, AdherenceGoalKey, AdherenceGoals, AdherenceGrid } from '#app/models/adherence-grid';

/** The chart metric each grid goal is plotted as, so the direction comes from the one model. */
const GOAL_METRIC = {
  netCarbs: 'net-carbs',
  protein: 'protein',
  kcal: 'calories',
} as const satisfies Record<AdherenceGoalKey, TrendMetric>;

/** The run of met days standing at the end of a walk, and the longest one in it. */
export interface GoalRuns {
  currentRun: number;
  bestRun: number;
}

/** One configured goal's record over the complete days of the window. */
export interface GoalStat {
  key: AdherenceGoalKey;
  /** `max` for a ceiling (net carbs, calories), `min` for a floor (protein). */
  direction: GoalDirection;
  /** The goal value the days were graded against, in grams or kcal. */
  goal: number;
  /** Complete days whose verdict for this goal was `met`. */
  metDays: number;
  /** Complete days whose verdict was `met` or `missed`. */
  ratedDays: number;
  /** Logged complete days whose figure for this goal could not be worked out. */
  unknownDays: number;
  /** `metDays / ratedDays`, or null when no day could be rated. */
  hitRate: number | null;
  /**
   * The mean of (day value minus goal) over the rated days, in grams or kcal,
   * or null when no day could be rated. Positive reads "over", negative
   * "under", whichever side the goal's direction counts as met.
   */
  averageDifference: number | null;
  /** Consecutive met days ending with yesterday (see the header for the rules). */
  currentRun: number;
  /** The longest run of met days in the window. */
  bestRun: number;
}

/** A day that has finished: in the window, not a future slot, not today. */
function isCompleteDay(day: AdherenceDay): boolean {
  return !day.isFuture && !day.isToday;
}

/** The configured value for one goal, or null when it is not set (a null or non-positive number). */
function goalValueOf({ key, goals }: { key: AdherenceGoalKey; goals: AdherenceGoals }): number | null {
  const value =
    key === 'netCarbs' ? goals.netCarbsCeilingG
    : key === 'protein' ? goals.proteinFloorG
    : goals.kcalTarget;
  return value !== null && value > 0 ? value : null;
}

/** The goal direction for one grid goal, from the chart's model. Every grid goal has one. */
function directionOf(key: AdherenceGoalKey): GoalDirection {
  const direction = goalDirectionFor(GOAL_METRIC[key]);
  if (direction === null) throw new Error(`goal ${key} has no direction in the trend chart model`);
  return direction;
}

/**
 * The current and the best run of met days for one goal.
 *
 * @param options.days - the complete days, oldest first.
 * @param options.key - the goal to walk.
 * @returns the run ending with the last day, and the longest run.
 */
export function computeGoalRuns({
  days,
  key,
}: {
  days: readonly AdherenceDay[];
  key: AdherenceGoalKey;
}): GoalRuns {
  let run = 0;
  let bestRun = 0;
  for (const day of days) {
    if (day.status === 'no-data') {
      run = 0;
      continue;
    }
    const verdict = day.verdicts[key];
    if (verdict === undefined || verdict === 'unknown') continue;
    run = verdict === 'met' ? run + 1 : 0;
    bestRun = Math.max(bestRun, run);
  }
  return { currentRun: run, bestRun };
}

/** One goal's record over the complete days. */
function statForGoal({ key, goal, days }: { key: AdherenceGoalKey; goal: number; days: readonly AdherenceDay[] }): GoalStat {
  let metDays = 0;
  let unknownDays = 0;
  const differences: number[] = [];
  for (const day of days) {
    const verdict = day.verdicts[key];
    if (verdict === undefined) continue;
    if (verdict === 'unknown') {
      unknownDays += 1;
      continue;
    }
    if (verdict === 'met') metDays += 1;
    const value = day.totals[key];
    // A rated verdict is only ever given to a day with a figure (`verdictFor`).
    if (value === null) throw new Error(`day ${day.date} was rated on ${key} without a figure`);
    differences.push(value - goal);
  }
  const ratedDays = differences.length;
  return {
    key,
    direction: directionOf(key),
    goal,
    metDays,
    ratedDays,
    unknownDays,
    hitRate: ratedDays === 0 ? null : metDays / ratedDays,
    averageDifference: ratedDays === 0 ? null : differences.reduce((sum, value) => sum + value, 0) / ratedDays,
    ...computeGoalRuns({ days, key }),
  };
}

/**
 * Every configured goal's record over the grid's complete days, in the grid's
 * display order. A goal that is not set is absent, so an empty list means
 * "no goal set" and the tab shows its invitation instead of empty tiles.
 *
 * @param options.grid - the resolved 13-week adherence grid.
 * @param options.goals - the goals that grid was graded against.
 * @returns one record per configured goal.
 */
export function computeGoalStats({ grid, goals }: { grid: AdherenceGrid; goals: AdherenceGoals }): GoalStat[] {
  const days = grid.days.filter(isCompleteDay);
  return ADHERENCE_GOAL_KEYS.flatMap((key) => {
    const goal = goalValueOf({ key, goals });
    return goal === null ? [] : [statForGoal({ key, goal, days })];
  });
}
