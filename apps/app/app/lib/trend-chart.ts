/**
 * Pure chart-shaping for the trends bar chart, kept DB-free (imports only the
 * pure daily-totals/summary types) so it's directly unit-testable. It turns a
 * range of per-day totals into per-bar geometry states plus a shared vertical
 * scale — the honesty rules live here, not in the SVG component:
 *
 * - A day with no logs becomes an `empty` slot (no bar) — "no data", never a
 *   zero bar that reads as "you failed".
 * - Calories bars carry the day's `basis` as a `fill` state so the component can
 *   render reported totals solid, Atwater-derived ones lighter, and floors
 *   (incomplete / not computable) as a hollow outline.
 * - Net-carbs bars are solid when fully known and hollow when the day mixes in
 *   entries with unknown macros (the sum is a floor, not a precise value).
 * - A net-carbs day that exceeds the ceiling is flagged `isOverGoal` using the
 *   SAME comparison (`computeCarbGoalProgress`) the diary's day summary uses,
 *   so a day can never read "over" on /diary and "fine" on /trends.
 * - M239/03: ONE honesty rule for every metric (`resolveBarFill`). A floor
 *   ("at least") beats a derived value, which beats a solid one. Every gram
 *   metric (net carbs, protein, fat, fiber) reads its floor off the day's
 *   `hasUnknowns`; calories read theirs off the kcal `basis`, whose
 *   Atwater-derived state is the only `derived` source. AI estimates do NOT
 *   lighten a gram bar: net carbs never did, and the refactor must not change
 *   what net carbs draw, so an estimate stays the `hasEstimate` hedge
 *   ("partly estimated") for every metric alike.
 * - M239/03: each goal has a direction (`goalDirection`). Net carbs and calories
 *   are ceilings, protein is a floor, fat and fiber have no goal at all.
 *
 * The component maps the returned 0..1 fractions onto SVG units and picks
 * colors; it never re-derives which bar is solid vs. hollow vs. empty vs. over.
 */
import type { DailyTotals, KcalBasis } from '#app/models/daily-totals';
import type { DaySummary } from '#app/models/food-log-summary';
import { computeCarbGoalProgress, computeProteinGoalProgress } from '#app/lib/goal-progress';
import type { MealType } from '#types/enums';

/** The plottable series: the signature net-carbs metric, calories, and three more macros (M239/03). */
export type TrendMetric = 'net-carbs' | 'calories' | 'protein' | 'fat' | 'fiber';

/** Every metric, in the order the metric control lists them. */
export const TREND_METRICS = [
  'net-carbs',
  'calories',
  'protein',
  'fat',
  'fiber',
] as const satisfies readonly TrendMetric[];

/** The metric the chart opens on when the URL names none. */
export const DEFAULT_TREND_METRIC: TrendMetric = 'net-carbs';

/**
 * Which side of a goal is the win: `max` is a ceiling (stay under it), `min`
 * is a floor (reach it). A named direction rather than a sign, so a comparison
 * can never be flipped by a stray minus.
 */
export type GoalDirection = 'max' | 'min';

/**
 * The goal direction per metric, or `null` for a metric with no goal line.
 * Net carbs and calories are ceilings; protein is a floor (M200: a protein
 * floor off height). Fat and fiber have no stored goal.
 */
const METRIC_GOAL_DIRECTION = {
  'net-carbs': 'max',
  calories: 'max',
  protein: 'min',
  fat: null,
  fiber: null,
} as const satisfies Record<TrendMetric, GoalDirection | null>;

/**
 * The goal direction of one metric.
 *
 * @param metric - the plotted series.
 * @returns `max` for a ceiling, `min` for a floor, `null` for no goal.
 */
export function goalDirectionFor(metric: TrendMetric): GoalDirection | null {
  return METRIC_GOAL_DIRECTION[metric];
}

/** The day-level goals the chart can draw a line for. */
export interface TrendGoals {
  netCarbsCeiling: number | null;
  kcalTarget: number | null;
  proteinFloor: number | null;
}

/**
 * The goal figure a metric is measured against, or `null` when the metric has
 * no goal or the person set none.
 *
 * @param input.metric - the plotted series.
 * @param input.goals - the person's day-level goals.
 * @returns the goal value for that metric.
 */
export function goalValueFor({ metric, goals }: { metric: TrendMetric; goals: TrendGoals }): number | null {
  if (metric === 'net-carbs') return goals.netCarbsCeiling;
  if (metric === 'calories') return goals.kcalTarget;
  if (metric === 'protein') return goals.proteinFloor;
  return null;
}

/** The chart's "every meal" setting, i.e. no slot filter at all. */
export const ALL_MEALS = 'all';

/**
 * The chart's meal dimension (M227/02): one slot across the days, or the whole
 * day. The days handed in are already filtered by the caller; this is here so
 * the model knows a bar is a PART of a day and can drop the goal accordingly.
 */
export type TrendSlot = MealType | typeof ALL_MEALS;

/**
 * How a single bar should be drawn:
 * - `solid`: a trustworthy value (reported kcal, or fully-known grams).
 * - `derived`: a value softened by Atwater-derivation (calories only) — lighter.
 * - `incomplete`: a floor — a value built on missing data, or a logged day with
 *   nothing computable at all — drawn as a hollow outline.
 * - `empty`: no logs that day — a hairline slot, not a bar.
 */
export type BarFill = 'solid' | 'derived' | 'incomplete' | 'empty';

/** One day's totals keyed by its local calendar date — the chart's input row. */
export type TrendDay = DailyTotals & { date: string };

/** The per-bar geometry the SVG component consumes. */
export interface BarGeometry {
  /** The bar's local calendar date, `YYYY-MM-DD` (also its `/diary?date=` link). */
  date: string;
  /** The plotted value, or null for a no-data / not-computable bar. */
  value: number | null;
  /** True when the day has at least one log entry. */
  hasLogs: boolean;
  /** True when the day includes any AI-estimated entry — drives the hedge marker. */
  hasEstimate: boolean;
  /** Which fill state to render (see `BarFill`). */
  fill: BarFill;
  /**
   * True when this day's net carbs exceed the user's ceiling — the same
   * `computeCarbGoalProgress` comparison the diary uses, so this can never
   * disagree with the diary's amber "Over by X g" state for the same day.
   * Always `false` for every other metric (calories have no over/under coloring).
   */
  isOverGoal: boolean;
  /**
   * True when this day's protein is below the user's floor, decided by the
   * same `computeProteinGoalProgress` comparison the diary uses. Never set on a
   * floor ("at least") bar: a minimum below the goal does not prove the day
   * missed it. Worded neutrally and never painted in a warning hue.
   */
  isUnderGoal: boolean;
  /**
   * Net carbs only: the day's TOTAL carbs as a fraction 0..1 of the plot, drawn
   * as an outline behind the bar so fiber and sugar alcohols show as the gap.
   * The axis is still set by net carbs alone, so a tall total is capped at the
   * top of the plot rather than rescaling every bar. `null` for other metrics.
   */
  outlineFraction: number | null;
  /** Net carbs only: the day's total carbs in grams, which the outline is drawn at. `null` for other metrics. */
  totalCarbs: number | null;
  /** Bar height as a fraction 0..1 of the plot area; 0 for empty / null-value bars. */
  heightFraction: number;
}

/** The whole chart model: bars, the shared vertical domain, and the goal line. */
export interface TrendChartModel {
  bars: BarGeometry[];
  /** Top of the vertical axis (a "nice" ceiling ≥ every value and the goal). */
  domainMax: number;
  /** The goal line as a fraction 0..1 of the plot height, or null when unset. */
  goalFraction: number | null;
}

/** A day whose macro summary is known — net-carbs / protein reads are safe. */
type SummarizedDay = TrendDay & { summary: DaySummary };

/**
 * Builds the full chart model for one metric over a range of days.
 *
 * @param input.days - the per-day totals, oldest day first.
 * @param input.metric - which series to plot.
 * @param input.goalValue - the relevant goal (net-carb ceiling or kcal target), or null.
 * @param input.slot - the meal slot the days were filtered to, or `ALL_MEALS` (the default) for whole days.
 * @returns the bars, shared domain, and goal-line fraction.
 */
export function buildTrendChart({
  days,
  metric,
  goalValue,
  slot = ALL_MEALS,
}: {
  days: readonly TrendDay[];
  metric: TrendMetric;
  goalValue: number | null;
  slot?: TrendSlot;
}): TrendChartModel {
  // A SLOT HAS NO GOAL. Every goal this app stores is a WHOLE-day figure, and
  // nothing in the schema says how much of a day's ceiling belongs to lunch, so
  // the goal is dropped here, at the model, rather than hidden at the renderer.
  // Hiding only the line would leave `isOverGoal` painting a snack amber against
  // a ceiling the chart no longer draws, and would leave the axis top propped up
  // by a figure no bar is being measured against.
  // A metric with no goal direction (fat, fiber) has no goal line either, even
  // if a caller hands a figure in.
  const effectiveGoal = slot === ALL_MEALS && goalDirectionFor(metric) !== null ? goalValue : null;
  const valued = days.map((day) => ({ day, ..._barValue(day, metric, effectiveGoal) }));
  const domainMax = _computeDomainMax(
    valued.map((entry) => entry.value),
    effectiveGoal,
  );
  const bars = valued.map(({ day, value, fill, isOverGoal, isUnderGoal }) => {
    const totalCarbs = metric === 'net-carbs' && _isSummarized(day) ? day.summary.carbs : null;
    return {
      date: day.date,
      value,
      hasLogs: day.hasLogs,
      hasEstimate: day.estimateShare > 0,
      fill,
      isOverGoal,
      isUnderGoal,
      heightFraction: _fractionOf({ value, domainMax }),
      outlineFraction: totalCarbs === null ? null : _fractionOf({ value: totalCarbs, domainMax }),
      totalCarbs,
    };
  });
  const goalFraction = effectiveGoal !== null && effectiveGoal > 0 ? Math.min(effectiveGoal / domainMax, 1) : null;
  return { bars, domainMax, goalFraction };
}

/** One day's plotted value and how to draw it. */
interface BarPlot {
  /** The plotted figure, or `null` for a day with nothing to plot. */
  value: number | null;
  fill: BarFill;
  isOverGoal: boolean;
  isUnderGoal: boolean;
}

/** A bar's value and caveats before any goal is applied. */
interface BarReading {
  value: number | null;
  fill: BarFill;
}

/** The two caveats a bar can carry, whatever its metric. */
interface BarCaveats {
  /** The value is a minimum: part of the day could not be counted. */
  isFloor: boolean;
  /** The value was worked out from other figures rather than reported. */
  isDerived: boolean;
}

/**
 * THE honesty rule, shared by every metric: a floor is drawn as `incomplete`
 * ("at least"), else a derived value as `derived`, else `solid`. The metrics
 * differ only in where they read the two caveats from.
 *
 * @param caveats - whether the value is a floor and whether it was derived.
 * @returns the fill for a logged day's bar.
 */
export function resolveBarFill({ isFloor, isDerived }: BarCaveats): Exclude<BarFill, 'empty'> {
  if (isFloor) return 'incomplete';
  if (isDerived) return 'derived';
  return 'solid';
}

/** The plain value of one gram metric off a day's summary. */
const GRAM_VALUE = {
  'net-carbs': (summary: DaySummary) => summary.netCarbs,
  protein: (summary: DaySummary) => summary.protein,
  fat: (summary: DaySummary) => summary.fat,
  fiber: (summary: DaySummary) => summary.fiber,
} satisfies Record<Exclude<TrendMetric, 'calories'>, (summary: DaySummary) => number>;

/**
 * The value a day plots for one metric, or `null` when there is nothing to
 * plot (an unlogged day, or calories that could not be worked out). The same
 * number the bar is drawn from, so a line derived from it (the rolling average)
 * can never disagree with the bars under it.
 *
 * @param input.day - the day (or week) row.
 * @param input.metric - the plotted series.
 * @returns the plotted value.
 */
export function selectMetricValue({ day, metric }: { day: TrendDay; metric: TrendMetric }): number | null {
  return _readBar(day, metric).value;
}

/** Resolves one day's plotted value, fill state, and goal flags for the chosen metric. */
function _barValue(day: TrendDay, metric: TrendMetric, goalValue: number | null): BarPlot {
  const reading = _readBar(day, metric);
  return {
    ...reading,
    isOverGoal: metric === 'net-carbs' && _isOverCeiling({ reading, ceiling: goalValue }),
    isUnderGoal: metric === 'protein' && _isUnderFloor({ reading, floor: goalValue }),
  };
}

/** A day's value and fill for one metric, before any goal. */
function _readBar(day: TrendDay, metric: TrendMetric): BarReading {
  if (metric === 'calories') return _caloriesBar(day);
  if (!_isSummarized(day)) return { value: null, fill: 'empty' };
  return {
    value: GRAM_VALUE[metric](day.summary),
    fill: resolveBarFill({ isFloor: day.summary.hasUnknowns, isDerived: false }),
  };
}

/**
 * Whether a net-carbs bar is over the ceiling. Reuses `computeCarbGoalProgress`,
 * the identical comparison the diary's day summary runs, so this can never
 * disagree with the diary's amber "Over by X g" state for the same day. A floor
 * bar over the ceiling IS over: the real value is at least that high.
 */
function _isOverCeiling({ reading, ceiling }: { reading: BarReading; ceiling: number | null }): boolean {
  if (ceiling === null || reading.value === null) return false;
  return computeCarbGoalProgress({ netCarbs: reading.value, ceiling }).isOver;
}

/**
 * Whether a protein bar is under the floor, by the diary's own
 * `computeProteinGoalProgress`. A floor ("at least") bar is never flagged: the
 * real value may well have reached the goal.
 */
function _isUnderFloor({ reading, floor }: { reading: BarReading; floor: number | null }): boolean {
  if (floor === null || reading.value === null || reading.fill === 'incomplete') return false;
  return !computeProteinGoalProgress({ protein: reading.value, floor }).isMet;
}

/** Calories bar: empty when unlogged; otherwise the fill mirrors the kcal `basis`. */
function _caloriesBar(day: TrendDay): BarReading {
  if (!day.hasLogs) return { value: null, fill: 'empty' };
  return { value: day.kcal.total, fill: resolveBarFill(_kcalCaveats(day.kcal.basis)) };
}

/** Reads the two caveats off a day's kcal `basis` (`none` is a floor with no value). */
function _kcalCaveats(basis: KcalBasis): BarCaveats {
  return {
    isFloor: basis === 'incomplete' || basis === 'none',
    isDerived: basis === 'partly-derived',
  };
}

/** A value as a fraction 0..1 of the plot height; 0 for a missing or non-positive value. */
function _fractionOf({ value, domainMax }: { value: number | null; domainMax: number }): number {
  return value !== null && value > 0 ? Math.min(value / domainMax, 1) : 0;
}

/** Narrows to a day whose macro summary is present (i.e. it has logs). */
function _isSummarized(day: TrendDay): day is SummarizedDay {
  return day.summary !== null;
}

/** How many equal bands the labelled axis aims to cut the plot into. */
const AXIS_BANDS = 4;

/** The mantissas a gridline step may take, so an axis reads 25, 50, 75 and never 33.3. */
const AXIS_STEP_MANTISSAS = [1, 2, 2.5, 5, 10] as const;

/**
 * The labelled gridlines of the vertical axis, from the lowest above zero up to
 * the last one that fits under `domainMax`. Zero is the baseline the chart
 * already draws, so it is not in the list.
 *
 * The step comes from `AXIS_STEP_MANTISSAS`, the smallest one that keeps the
 * plot to at most `AXIS_BANDS` bands, so every label is a round number on every
 * scale (15 gives 5, 10, 15; 40 gives 10, 20, 30, 40; 1500 gives 500, 1000, 1500).
 * The top of the axis is not always a gridline: a 25 g axis is labelled 10 and
 * 20, because 25 is not a multiple of the step, and the goal tag or the bar
 * tooltip is what carries the exact figure.
 *
 * @param domainMax - the axis top from `buildTrendChart`.
 * @returns the values to label and to draw a gridline at, ascending; empty for a non-positive axis.
 */
export function chartAxisTicks(domainMax: number): number[] {
  if (!(domainMax > 0)) return [];
  const rough = domainMax / AXIS_BANDS;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step =
    (AXIS_STEP_MANTISSAS.find((mantissa) => mantissa * magnitude >= rough - Number.EPSILON) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let index = 1; index * step <= domainMax + step * 1e-9; index++) ticks.push(Number((index * step).toFixed(6)));
  return ticks;
}

/** The vertical axis top: a nice ceiling above every positive value and the goal. */
function _computeDomainMax(values: readonly (number | null)[], goalValue: number | null): number {
  const positives = values.filter((value): value is number => value !== null && value > 0);
  const goalFloor = goalValue !== null && goalValue > 0 ? goalValue : 0;
  const rawMax = Math.max(0, goalFloor, ...positives);
  return rawMax > 0 ? _niceCeil(rawMax) : 1;
}

/** Rounds `value` up to the next "nice" mantissa × 10ⁿ so the axis top reads cleanly. */
function _niceCeil(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / magnitude;
  return _niceFraction(fraction) * magnitude;
}

/**
 * The mantissa ladder the axis top snaps to (M129/04 widened it from a bare
 * 1/2/5/10). That coarse ladder was the reason the chart looked half-empty: a
 * 34 g week rounded to a 50 g axis and a 72 g week to a 100 g one, so up to a
 * third of the plot was permanently dead space above the tallest bar and every
 * bar was drawn a third shorter than it needed to be. These steps are still all
 * round, readable numbers — nobody reads the axis top as a figure here, but the
 * goal tag sits on this scale and "40" must not become "39.6".
 */
const NICE_FRACTIONS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

/** The smallest ladder step ≥ `fraction` (a mantissa in [1, 10)). */
function _niceFraction(fraction: number): number {
  return NICE_FRACTIONS.find((step) => fraction <= step) ?? 10;
}
