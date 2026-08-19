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
 *
 * The component maps the returned 0..1 fractions onto SVG units and picks
 * colors; it never re-derives which bar is solid vs. hollow vs. empty vs. over.
 */
import type { DailyTotals, KcalBasis } from '#app/models/daily-totals';
import type { DaySummary } from '#app/models/food-log-summary';
import { computeCarbGoalProgress } from '#app/lib/goal-progress';

/** The two plottable series: the signature net-carbs metric and calories. */
export type TrendMetric = 'net-carbs' | 'calories';

/**
 * How a single bar should be drawn:
 * - `solid`: a trustworthy value (reported kcal, or fully-known net carbs).
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
   * Always `false` for the calories metric (which has no over/under coloring).
   */
  isOverGoal: boolean;
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
 * @returns the bars, shared domain, and goal-line fraction.
 */
export function buildTrendChart({
  days,
  metric,
  goalValue,
}: {
  days: readonly TrendDay[];
  metric: TrendMetric;
  goalValue: number | null;
}): TrendChartModel {
  const valued = days.map((day) => ({ day, ..._barValue(day, metric, goalValue) }));
  const domainMax = _computeDomainMax(
    valued.map((entry) => entry.value),
    goalValue,
  );
  const bars = valued.map(({ day, value, fill, isOverGoal }) => ({
    date: day.date,
    value,
    hasLogs: day.hasLogs,
    hasEstimate: day.estimateShare > 0,
    fill,
    isOverGoal,
    heightFraction: value !== null && value > 0 ? Math.min(value / domainMax, 1) : 0,
  }));
  const goalFraction = goalValue !== null && goalValue > 0 ? Math.min(goalValue / domainMax, 1) : null;
  return { bars, domainMax, goalFraction };
}

/** One day's plotted value and how to draw it. */
interface BarPlot {
  /** The plotted figure, or `null` for a day with nothing to plot. */
  value: number | null;
  fill: BarFill;
  isOverGoal: boolean;
}

/** A metric that can never be "over goal" plots without the flag. */
type UnboundedBarPlot = Omit<BarPlot, 'isOverGoal'>;

/** Resolves one day's plotted value, fill state, and over-goal flag for the chosen metric. */
function _barValue(day: TrendDay, metric: TrendMetric, goalValue: number | null): BarPlot {
  if (metric === 'calories') return { ..._caloriesBar(day), isOverGoal: false };
  return _netCarbsBar(day, goalValue);
}

/**
 * Net-carbs bar: empty when unlogged; hollow when the day mixes in unknown
 * macros. `isOverGoal` reuses `computeCarbGoalProgress` — the identical
 * comparison the diary's day summary runs — so this can never disagree with
 * the diary's amber "Over by X g" state for the same day.
 */
function _netCarbsBar(day: TrendDay, ceiling: number | null): BarPlot {
  if (!_isSummarized(day)) return { value: null, fill: 'empty', isOverGoal: false };
  const isOverGoal = ceiling !== null && computeCarbGoalProgress({ netCarbs: day.summary.netCarbs, ceiling }).isOver;
  return { value: day.summary.netCarbs, fill: day.summary.hasUnknowns ? 'incomplete' : 'solid', isOverGoal };
}

/** Calories bar: empty when unlogged; otherwise the fill mirrors the kcal `basis`. */
function _caloriesBar(day: TrendDay): UnboundedBarPlot {
  if (!day.hasLogs) return { value: null, fill: 'empty' };
  return { value: day.kcal.total, fill: _kcalFill(day.kcal.basis) };
}

/** Maps a day's kcal `basis` onto a fill state (`none` is a hollow, caption-only slot). */
function _kcalFill(basis: KcalBasis): BarFill {
  if (basis === 'reported') return 'solid';
  if (basis === 'partly-derived') return 'derived';
  return 'incomplete';
}

/** Narrows to a day whose macro summary is present (i.e. it has logs). */
function _isSummarized(day: TrendDay): day is SummarizedDay {
  return day.summary !== null;
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
