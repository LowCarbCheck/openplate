/**
 * Pure weekly-recap aggregation for the trends card. DB-free (imports only the
 * pure chart/summary types) so it's directly unit-testable. Honesty-first:
 *
 * - Averages and hit-counts are computed over *logged* days only — a day with no
 *   logs is neither "under your ceiling" nor "over" it, it's simply absent. The
 *   numerator (`daysUnderCeiling`/`daysHitProteinFloor`) and its ratio's
 *   denominator (`loggedDays`) must describe the SAME population of days —
 *   pairing a logged-days numerator with an elapsed-days denominator would
 *   silently count an unlogged day as a failure.
 * - The week's estimate share is kcal-weighted (estimated calories ÷ total
 *   computable calories), so "~40% of this week's calories are AI-estimated"
 *   reflects energy mass, not a raw count of estimated entries.
 * - A goal-based stat is `null` (not 0) when that goal isn't set, so the UI can
 *   omit the line entirely rather than imply a target the user never chose.
 */
import { isOverCarbGoal } from '#app/lib/goal-progress';
import type { TrendDay } from '#app/lib/trend-chart';
import type { MacroRatioGrams } from '#app/lib/macro-ratio';
import type { DaySummary } from '#app/models/food-log-summary';

/** The aggregated stats for one Monday→Sunday week. */
export interface WeeklyRecap {
  /**
   * Days elapsed in the week window so far — i.e. `date <= today`. Informational
   * only (how far into the week we are) — it is deliberately NOT the ratio
   * denominator for `daysUnderCeiling`/`daysHitProteinFloor` below: a day the
   * user simply didn't log is neither a win nor a loss, so counting it against
   * those ratios would turn "didn't log" into "failed". Use `loggedDays` instead.
   */
  elapsedDays: number;
  /**
   * How many of those days have at least one logged entry — the correct ratio
   * denominator for `daysUnderCeiling`/`daysHitProteinFloor`, so both stats
   * describe the same population of days (the ones the user actually logged).
   */
  loggedDays: number;
  /** Mean net carbs across logged days, or null when nothing was logged. */
  avgNetCarbs: number | null;
  /** Logged days at or under the net-carb ceiling, or null when no ceiling is set. */
  daysUnderCeiling: number | null;
  /** Logged days at or above the protein floor, or null when no floor is set. */
  daysHitProteinFloor: number | null;
  /** Estimated share of the week's computable calories (0..1), or null when none are computable. */
  estimateShare: number | null;
  /**
   * Mean grams of each macro across LOGGED days — "what an average day looked
   * like" — or null when nothing was logged. Averaged over the same logged-days
   * population as `avgNetCarbs` for the same reason: dividing by elapsed days
   * would quietly shrink every macro by however many days the user skipped, and
   * report a composition nobody ate. Carbs here are TOTAL carbs with fiber
   * carried as its own figure alongside, matching how `MacroRatioBar` is fed on
   * the diary — the two bars must describe the same quantities.
   */
  avgMacroGrams: MacroRatioGrams | null;
}

/** A day whose macro summary is present (i.e. it has logs). */
type SummarizedDay = TrendDay & { summary: DaySummary };

/**
 * Aggregates one week of per-day totals into the recap stats.
 *
 * @param input.days - the week's per-day totals (any order; typically 7 days).
 * @param input.today - the caller's current local date (`YYYY-MM-DD`); days
 *   after this haven't happened yet and don't count toward `elapsedDays`.
 * @param input.netCarbsCeiling - the user's net-carb ceiling, or null when unset.
 * @param input.proteinFloor - the user's protein floor, or null when unset.
 * @returns the aggregated `WeeklyRecap`.
 */
export function computeWeeklyRecap({
  days,
  today,
  netCarbsCeiling,
  proteinFloor,
}: {
  days: readonly TrendDay[];
  today: string;
  netCarbsCeiling: number | null;
  proteinFloor: number | null;
}): WeeklyRecap {
  const logged = days.filter(_isSummarized);
  const netCarbs = logged.map((day) => day.summary.netCarbs);
  const elapsedDays = days.filter((day) => day.date <= today).length;
  return {
    elapsedDays,
    loggedDays: logged.length,
    avgNetCarbs: netCarbs.length === 0 ? null : _mean(netCarbs),
    daysUnderCeiling:
      netCarbsCeiling === null
        ? null
        : logged.filter((day) => !isOverCarbGoal({ netCarbs: day.summary.netCarbs, ceiling: netCarbsCeiling }))
            .length,
    daysHitProteinFloor:
      proteinFloor === null ? null : logged.filter((day) => day.summary.protein >= proteinFloor).length,
    estimateShare: _weekEstimateShare(days),
    avgMacroGrams: _avgMacroGrams(logged),
  };
}

/** Per-macro mean across the week's logged days, or null when there were none. */
function _avgMacroGrams(logged: readonly SummarizedDay[]): MacroRatioGrams | null {
  if (logged.length === 0) return null;
  return {
    carbs: _mean(logged.map((day) => day.summary.carbs)),
    protein: _mean(logged.map((day) => day.summary.protein)),
    fat: _mean(logged.map((day) => day.summary.fat)),
    fiber: _mean(logged.map((day) => day.summary.fiber)),
  };
}

/** Narrows to a logged day (macro summary present). */
function _isSummarized(day: TrendDay): day is SummarizedDay {
  return day.summary !== null;
}

/** The kcal-weighted estimate share across days that have a positive computable total. */
function _weekEstimateShare(days: readonly TrendDay[]): number | null {
  let estimatedKcal = 0;
  let totalKcal = 0;
  for (const day of days) {
    const total = day.kcal.total;
    if (total === null || total <= 0) continue;
    estimatedKcal += day.estimateShare * total;
    totalKcal += total;
  }
  if (totalKcal <= 0) return null;
  return estimatedKcal / totalKcal;
}

/** Arithmetic mean of a non-empty list. */
function _mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
