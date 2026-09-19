/**
 * Folds a run of per-day chart rows into one row per Monday→Sunday week, for
 * the wide trend ranges (M239/01). Ninety daily bars do not fit a phone, so at
 * 30 and 90 days the chart draws one bar per week instead.
 *
 * Pure, like `trend-week.ts` and `trend-recap.ts`: plain rows in, plain rows
 * out, no store and no clock.
 *
 * THE HONESTY RULES CARRY OVER FROM THE DAILY CHART.
 *
 * - A week is averaged over the days somebody LOGGED, the rule
 *   `computeWeeklyRecap` already uses. Dividing by seven would turn every
 *   skipped day into a day of eating nothing and shrink the bar.
 * - A week with no logged day is a gap, the same unlogged row a day with no
 *   logs is, never a zero bar.
 * - A floor stays a floor. If any logged day in the week has unknown macros,
 *   the week's average is a minimum too, so the week is marked incomplete. The
 *   same holds for calories: one day with an uncomputable entry makes the
 *   week's kcal `incomplete`, and one derived day makes it `partly-derived`.
 */
import type { TrendDay } from '#app/lib/trend-chart';
import { startOfWeek } from '#app/lib/trend-week';
import type { DayKcal, KcalBasis } from '#app/models/daily-totals';
import type { DaySummary } from '#app/models/food-log-summary';

/** A day whose macro summary is present, which is to say a logged day. */
type SummarizedDay = TrendDay & { summary: DaySummary };

/** The calorie figures of one logged day whose total could be computed. */
interface KcalMass {
  total: number;
  derivedShare: number;
  estimateShare: number;
}

/**
 * One row per Monday→Sunday week touched by `days`, oldest first. Each row is
 * dated with its Monday, even when the range starts mid-week, so two ranges
 * that share a week also share that week's key.
 *
 * @param days - per-day rows, oldest first, gaps included.
 * @returns one row per week, oldest first, averaged over that week's logged days.
 */
export function bucketByWeek(days: readonly TrendDay[]): TrendDay[] {
  const weeks = new Map<string, TrendDay[]>();
  for (const day of days) {
    const monday = startOfWeek(day.date);
    const week = weeks.get(monday) ?? [];
    week.push(day);
    weeks.set(monday, week);
  }
  return [...weeks.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([monday, weekDays]) => summarizeWeek({ monday, days: weekDays }));
}

/** One week's row, averaged over its logged days, or a gap when none were logged. */
function summarizeWeek({ monday, days }: { monday: string; days: readonly TrendDay[] }): TrendDay {
  const logged = days.filter(isSummarized);
  if (logged.length === 0) {
    return {
      date: monday,
      hasLogs: false,
      summary: null,
      kcal: { total: null, basis: 'none', derivedShare: 0 },
      estimateShare: 0,
    };
  }
  return {
    date: monday,
    hasLogs: true,
    summary: averageSummary(logged),
    kcal: averageKcal(logged),
    estimateShare: weekEstimateShare(logged),
  };
}

/** The mean of every macro over the logged days; either caveat on any day raises it for the week. */
function averageSummary(logged: readonly SummarizedDay[]): DaySummary {
  const mean = (pick: (summary: DaySummary) => number): number => meanOf(logged.map((day) => pick(day.summary)));
  return {
    carbs: mean((summary) => summary.carbs),
    fiber: mean((summary) => summary.fiber),
    polyols: mean((summary) => summary.polyols),
    netCarbs: mean((summary) => summary.netCarbs),
    protein: mean((summary) => summary.protein),
    fat: mean((summary) => summary.fat),
    kcal: mean((summary) => summary.kcal),
    hasUnknowns: logged.some((day) => day.summary.hasUnknowns),
    hasEstimates: logged.some((day) => day.summary.hasEstimates),
  };
}

/**
 * The week's calories: the mean over the logged days that had a computable
 * total. A logged day WITHOUT one still counts against the basis, because the
 * mean then leaves part of the week out and is a floor.
 */
function averageKcal(logged: readonly SummarizedDay[]): DayKcal {
  const computable = kcalMasses(logged);
  if (computable.length === 0) return { total: null, basis: 'none', derivedShare: 0 };
  const totalMass = computable.reduce((sum, day) => sum + day.total, 0);
  const derivedMass = computable.reduce((sum, day) => sum + day.derivedShare * day.total, 0);
  return {
    total: totalMass / computable.length,
    basis: weekBasis(logged.map((day) => day.kcal.basis)),
    derivedShare: totalMass > 0 ? derivedMass / totalMass : 0,
  };
}

/** The weakest basis in the week wins: a logged day with nothing computable counts as incomplete. */
function weekBasis(bases: readonly KcalBasis[]): KcalBasis {
  if (bases.some((basis) => basis === 'incomplete' || basis === 'none')) return 'incomplete';
  if (bases.includes('partly-derived')) return 'partly-derived';
  return 'reported';
}

/**
 * The share of the week that was AI-estimated: kcal-weighted over the days
 * with a positive total, like `computeWeeklyRecap`, else the plain mean of the
 * logged days' own shares.
 */
function weekEstimateShare(logged: readonly SummarizedDay[]): number {
  const weighted = kcalMasses(logged).filter((day) => day.total > 0);
  if (weighted.length === 0) return meanOf(logged.map((day) => day.estimateShare));
  const totalMass = weighted.reduce((sum, day) => sum + day.total, 0);
  return weighted.reduce((sum, day) => sum + day.estimateShare * day.total, 0) / totalMass;
}

/** Narrows to a logged day. */
function isSummarized(day: TrendDay): day is SummarizedDay {
  return day.summary !== null;
}

/** The calorie figures of the days whose total was computable; the rest are left out. */
function kcalMasses(days: readonly TrendDay[]): KcalMass[] {
  return days.flatMap(({ kcal, estimateShare }) =>
    kcal.total === null ? [] : [{ total: kcal.total, derivedShare: kcal.derivedShare, estimateShare }],
  );
}

/** Arithmetic mean of a non-empty list. */
function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
