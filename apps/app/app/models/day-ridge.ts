/**
 * Pure model for the Overview page's Budget Ridge (M216/01), the seven-day
 * tile that replaced the dense dot strip. No React, no DOM, no store read, so
 * it is unit-testable on its own (the same split `habit-strip.ts` and
 * `adherence-grid.ts` already use).
 *
 * One day is one short vertical bar. The bar's height is the day's headline
 * figure as a share of its goal, and `fraction === 1` is the 100 percent rule
 * the component draws across the tile. Which figure counts is decided by the
 * account's ONE lens (`lensForStyle`, M210), never by "whatever goal happens to
 * be set": a person tracking calories is graded on calories here exactly as
 * they are on the hero above.
 *
 * Two rules this file must keep:
 *
 * 1. Every met/over verdict comes from `#app/lib/goal-progress`. The trends
 *    adherence grid calls the same three functions, so the same day cannot read
 *    "met" on `/trends` and "over" on the Overview tile for the same number.
 *    That is the regression `isOverCarbGoal`'s own doc comment exists to stop.
 * 2. A lens whose goal is missing degrades to the NO-GOAL ridge, never to a
 *    guess. `dayVerdict` degrades the hero the same way, and for the same
 *    reason: a verdict is a claim about a goal the person actually set.
 */
import { isOverCarbGoal, isOverKcalGoal, computeProteinGoalProgress } from '#app/lib/goal-progress';
import type { EatingStyleLens } from '#app/lib/eating-style';
import type { LocalDailyTotals } from '#app/lib/local-store/aggregates';
import { shiftDate } from '#app/lib/user-days';

/**
 * How many logged entries make a full-height bar on the NO-GOAL ridge, where
 * there is no goal to divide against and bar height is the day's entry count.
 *
 * Five is a product judgement, not a measurement: three meals plus two snacks
 * is a fully logged day, so five entries reach the height a met goal would.
 * A busier day simply reaches the top; nothing above five is a failure, which
 * is why this is a scale and not a ceiling.
 */
export const ENTRIES_FOR_A_FULL_BAR = 5;

/**
 * A day's bar state:
 * - `none`: nothing logged that day (a stub on the baseline, never a bar).
 * - `logged`: logged, but not graded: no goal at all, or a figure the app
 *   cannot honestly compute for the graded metric.
 * - `met`: graded and inside the goal (at or under a ceiling, at or above a floor).
 * - `over`: graded and past a CEILING. A floor metric never produces this.
 */
export type RidgeState = 'none' | 'logged' | 'met' | 'over';

/** One day's bar. */
export interface RidgeDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** True for the right-most bar, the person's current local day. */
  isToday: boolean;
  state: RidgeState;
  /**
   * The day's figure as a share of its goal, or null when there is nothing to
   * divide (a gap day, or a graded day whose figure is not computable). NOT
   * clamped: 1.4 is a real 140 percent day, and the drawing area decides where
   * to clip it. Clamping here would make the aria-label agree with a clipped
   * bar instead of with the truth.
   */
  fraction: number | null;
  /**
   * The day's figure, ROUNDED to whole units, or null when there is none. It is
   * rounded here rather than in the component because `goal-progress` decides
   * met/over on the rounded value: an unrounded label beside a rounded verdict
   * is how "20 of 20 g" ended up next to "over by 0.4 g" before.
   *
   * On the no-goal ridge this is the day's logged ENTRY COUNT, which is what
   * that ridge's bars measure and what its aria-label reads out.
   */
  value: number | null;
}

/** Which figure the ridge grades, and which way the goal points. */
export interface RidgeMetric {
  key: 'netCarbs' | 'kcal' | 'protein';
  /** `ceiling`: staying under wins, going over is amber. `floor`: reaching it wins, and there is no amber. */
  direction: 'ceiling' | 'floor';
}

/** The configured goals, as the Overview loader already holds them. A null means "not set". */
export interface RidgeGoals {
  netCarbsCeiling: number | null;
  /** The target AS DISPLAYED, including any reproductive addition the loader applied. */
  kcalTarget: number | null;
  proteinFloor: number | null;
}

/** The whole tile: what is being graded, against what, over which days. */
export interface DayRidge {
  /** Null when the account has no goal for its lens: no rule is drawn and no bar is ever amber. */
  metric: RidgeMetric | null;
  /** The goal the rule stands for, rounded for display; null exactly when `metric` is null. */
  goal: number | null;
  /** Oldest first, today last. Always `dayCount` long. */
  days: RidgeDay[];
  /** Days in the window with at least one entry. */
  loggedDayCount: number;
}

/** The metric a lens grades, paired with the goal it needs, or null when that goal is missing. */
function resolveMetric(lens: EatingStyleLens, goals: RidgeGoals): { metric: RidgeMetric; goal: number } | null {
  if (lens === 'carb' && goals.netCarbsCeiling !== null && goals.netCarbsCeiling > 0) {
    return { metric: { key: 'netCarbs', direction: 'ceiling' }, goal: goals.netCarbsCeiling };
  }
  if (lens === 'kcal' && goals.kcalTarget !== null && goals.kcalTarget > 0) {
    return { metric: { key: 'kcal', direction: 'ceiling' }, goal: goals.kcalTarget };
  }
  if (lens === 'protein' && goals.proteinFloor !== null && goals.proteinFloor > 0) {
    return { metric: { key: 'protein', direction: 'floor' }, goal: goals.proteinFloor };
  }
  return null;
}

/** The day's figure for a metric, or null when the day has no computable one. */
function figureFor(totals: LocalDailyTotals | undefined, key: RidgeMetric['key']): number | null {
  if (!totals || !totals.hasLogs || !totals.summary) return null;
  if (key === 'netCarbs') return totals.summary.netCarbs;
  if (key === 'protein') return totals.summary.protein;
  return totals.kcal.total;
}

/** Whether a graded day is inside its goal, through `#app/lib/goal-progress` and nothing else. */
function isInsideGoal({ metric, goal, figure }: { metric: RidgeMetric; goal: number; figure: number }): boolean {
  if (metric.key === 'netCarbs') return !isOverCarbGoal({ netCarbs: figure, ceiling: goal });
  if (metric.key === 'kcal') return !isOverKcalGoal({ kcal: figure, target: goal });
  return computeProteinGoalProgress({ protein: figure, floor: goal }).isMet;
}

/** One graded day. A floor metric never returns `over`: falling short is under the rule, not past it. */
function gradedDay({
  date,
  isToday,
  totals,
  metric,
  goal,
}: {
  date: string;
  isToday: boolean;
  totals: LocalDailyTotals;
  metric: RidgeMetric;
  goal: number;
}): RidgeDay {
  const figure = figureFor(totals, metric.key);
  // Logged, but the figure the lens grades is not computable. It is never
  // called met or over: the app does not grade data it does not have.
  if (figure === null) return { date, isToday, state: 'logged', fraction: null, value: null };

  const inside = isInsideGoal({ metric, goal, figure });
  const state: RidgeState =
    inside ? 'met'
    : metric.direction === 'ceiling' ? 'over'
    : 'logged';
  return { date, isToday, state, fraction: figure / goal, value: Math.round(figure) };
}

/** One day on the no-goal ridge: teal, sized by entry count, never amber. */
function trackedDay({ date, isToday, totals }: { date: string; isToday: boolean; totals: LocalDailyTotals }): RidgeDay {
  return {
    date,
    isToday,
    state: 'logged',
    fraction: totals.entryCount / ENTRIES_FOR_A_FULL_BAR,
    value: totals.entryCount,
  };
}

/**
 * Builds the ridge: `dayCount` days ending on `today`, oldest first.
 *
 * @param dailyTotals - one entry per windowed day, order-independent, keyed by date.
 * @param today - the current local day as `YYYY-MM-DD` (the right-most bar).
 * @param dayCount - how many bars the tile draws.
 * @param lens - the account's single grading lens (M210).
 * @param goals - the configured goals, as the Overview loader holds them.
 * @returns the metric, the goal, and one `RidgeDay` per day.
 */
export function buildDayRidge({
  dailyTotals,
  today,
  dayCount,
  lens,
  goals,
}: {
  dailyTotals: readonly LocalDailyTotals[];
  today: string;
  dayCount: number;
  lens: EatingStyleLens;
  goals: RidgeGoals;
}): DayRidge {
  const graded = resolveMetric(lens, goals);
  const byDate = new Map(dailyTotals.map((day) => [day.date, day]));

  const days = Array.from({ length: dayCount }, (_unused, index) => {
    const offset = dayCount - 1 - index;
    const date = shiftDate(today, -offset);
    const isToday = offset === 0;
    const totals = byDate.get(date);
    if (!totals || !totals.hasLogs) return { date, isToday, state: 'none' as const, fraction: null, value: null };
    if (!graded) return trackedDay({ date, isToday, totals });
    return gradedDay({ date, isToday, totals, metric: graded.metric, goal: graded.goal });
  });

  return {
    metric: graded?.metric ?? null,
    goal: graded ? Math.round(graded.goal) : null,
    days,
    loggedDayCount: days.reduce((total, day) => total + (day.state === 'none' ? 0 : 1), 0),
  };
}
