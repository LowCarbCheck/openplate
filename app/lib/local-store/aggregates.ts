/**
 * Local aggregates — daily net-carb/macro totals, streaks, and trend series
 * computed entirely from the primary store (M117/01). Health reads no longer
 * round-trip to a server loader: the diary/trends views can be fed from here.
 *
 * The arithmetic is the pure functional core (reusing the app's existing
 * `computeDailyEntry`/`summarizeDay`/`buildHabitStrip` so local and server totals
 * agree to the gram); the only impure part is the thin store-reading wrappers at
 * the bottom, which fetch the local logs and hand them to the pure functions.
 * Logs are bucketed by their `dayKey` (the device-local calendar day recorded at
 * log time) — no timezone round-trip, because the local store IS the source of
 * truth for which day an entry belongs to.
 */
import type { Store } from 'tinybase';
import { isOverCarbGoal } from '#app/lib/goal-progress';
import { computeDailyEntry } from '#app/models/daily-totals';
import type { DailyTotals } from '#app/models/daily-totals';
import { buildHabitStrip } from '#app/models/habit-strip';
import type { HabitStripDay } from '#app/models/habit-strip';
import type { FoodLogMacroSnapshot } from '#app/models/food-log-summary';
import { enumerateDates } from '#app/lib/user-days';
import { NUTRIENT_KEYS, readNutrientPer100g } from '#app/lib/micronutrients';
import type { NutrientKey } from '#app/lib/micronutrients';
import { listLocalFoodLogs } from './primary-store';
import type { LocalFoodLog } from './schema';

/** One calendar day's totals, keyed by its local `YYYY-MM-DD` date. */
export interface LocalDailyTotals extends DailyTotals {
  date: string;
}

/** A single point on a net-carb trend series. */
export interface TrendPoint {
  date: string;
  /** The day's net carbs, or null on a gap day / an all-unknown day. */
  netCarbs: number | null;
}

/**
 * Scales a log's stored PER-100g authoritative net carbs onto its actual
 * serving, matching `FoodLogMacroSnapshot.netCarbs`'s per-serving basis (it
 * sits alongside the per-serving `macros`). Uses the same unrounded
 * `× grams / 100` arithmetic as `scaleMacrosPer100gToServing`, so the
 * authoritative figure and the macro parts scale identically.
 *
 * Preserves all three states of `LocalFoodLog.netCarbsPer100g` (see its doc):
 * absent stays absent (fall back to the parts), `null` stays `null` (upstream
 * genuinely unknown — never fabricate a 0), a number scales.
 */
function scaledNetCarbs(log: LocalFoodLog): number | null | undefined {
  if (log.netCarbsPer100g === undefined || log.netCarbsPer100g === null) return log.netCarbsPer100g;
  return (log.netCarbsPer100g * log.quantityGrams) / 100;
}

/**
 * Projects a local food log onto the macro snapshot the pure day-total math
 * consumes. THE single projection point: `computeDailyTotals`,
 * `computeDailyTotalsInRange` (and through them `computeStreak`, the trend
 * series, the habit strip and goal progress) and `diary.tsx`'s meal subtotals
 * and per-entry figures all flow through here. Keep it that way — a second,
 * hand-rolled copy of this mapping is exactly how the authoritative net-carbs
 * figure got dropped on the diary before (`diary.tsx` used to carry its own
 * `toMacroSnapshot`).
 */
export function localFoodLogToSnapshot(log: LocalFoodLog): FoodLogMacroSnapshot {
  return {
    carbs: log.macros.carbs,
    fiber: log.macros.fiber,
    sugars: log.macros.sugars,
    polyols: log.macros.polyols,
    protein: log.macros.protein,
    fat: log.macros.fat,
    kcal: log.macros.kcal,
    netCarbs: scaledNetCarbs(log),
    // Threaded through so `_entryNetCarbs`'s compute-from-parts fallback (used
    // when `netCarbs` above is absent) picks the right formula — see spec 13
    // and `LocalFoodLog.carbBasis`'s doc comment.
    carbBasis: log.carbBasis,
    aiEstimated: log.aiEstimated,
  };
}

/** The totals for a single day (`dayKey`) from a flat list of local logs. Pure. */
export function computeDailyTotals(logs: readonly LocalFoodLog[], dayKey: string): DailyTotals {
  const forDay = logs.filter((log) => log.dayKey === dayKey).map(localFoodLogToSnapshot);
  return computeDailyEntry(forDay);
}

/**
 * One totals entry per calendar day in `[fromDate, toDate]` (inclusive, gaps
 * included), oldest first — the local-store counterpart to
 * `getDailyTotalsInRange`. Pure: buckets the given logs by `dayKey`.
 */
export function computeDailyTotalsInRange(
  logs: readonly LocalFoodLog[],
  { fromDate, toDate }: { fromDate: string; toDate: string },
): LocalDailyTotals[] {
  const buckets = new Map<string, FoodLogMacroSnapshot[]>();
  for (const log of logs) {
    if (log.dayKey < fromDate || log.dayKey > toDate) continue;
    const bucket = buckets.get(log.dayKey);
    if (bucket) bucket.push(localFoodLogToSnapshot(log));
    else buckets.set(log.dayKey, [localFoodLogToSnapshot(log)]);
  }
  return enumerateDates(fromDate, toDate).map((date) => {
    const totals = computeDailyEntry(buckets.get(date) ?? []);
    return {
      date,
      hasLogs: totals.hasLogs,
      summary: totals.summary,
      kcal: totals.kcal,
      estimateShare: totals.estimateShare,
    };
  });
}

// ---------------------------------------------------------------------------
// Per-nutrient daily micronutrients (M135) — intake AND its coverage, always
// together. Sits at the same choke point as `computeDailyTotals` above so
// nothing can bypass it.
// ---------------------------------------------------------------------------

/**
 * Below this share of a day's logged mass carrying a real figure for a
 * nutrient, the day's intake for that nutrient is reported as "not enough
 * data" rather than as a number.
 *
 * 0.6 is a product judgement, not a measurement: under it, a "total" is more
 * gap than measurement, and a number the person reads as their intake would
 * mostly be describing the foods we happen to know about. The exact bar belongs
 * to the surfaces that render this, so every entry point takes an override —
 * but the DEFAULT is deliberately strict, because the failure mode of a
 * too-lax bar (quietly under-reporting an intake and calling it a gap in the
 * person's diet) is the one this whole milestone exists to prevent.
 */
export const DEFAULT_MIN_COVERAGE_FRACTION = 0.6;

/**
 * How much of a day's intake this nutrient's figure actually describes.
 *
 * Weighted by GRAMS CONSUMED, not by entry count and not by kcal:
 *  - Entry count would let one 5 g garnish with a full vitamin profile make a
 *    600 g plate look covered.
 *  - kcal is itself nullable on `Macros` (it is routinely unknown), so a
 *    kcal-weighted coverage would need its own coverage measure to be
 *    trustworthy — a measure with gaps in it is worse than no measure.
 *  - `quantityGrams` is non-null on every `LocalFoodLog` by construction, so a
 *    gram-weighted share is always exactly computable.
 */
export interface NutrientCoverage {
  /** `coveredGrams / totalGrams`, in `0..1`. `0` when nothing was logged. */
  coveredFraction: number;
  /** Grams of food logged that day which carried a real figure for this nutrient. */
  coveredGrams: number;
  /** Total grams of food logged that day, covered or not. */
  totalGrams: number;
  /** Entries that carried a real figure for this nutrient. */
  contributingEntries: number;
  /** Entries logged that day, covered or not. */
  totalEntries: number;
}

/**
 * One nutrient's result for one day. A DISCRIMINATED UNION on `hasEnoughData`,
 * deliberately: `amount` is only ever a `number` on the branch that also
 * asserts the coverage bar was cleared, so the compiler will not let a consumer
 * read an intake figure without first acknowledging its coverage. Rendering a
 * bare number is not something a caller can do by accident here.
 *
 * `amount` is the intake from COVERED entries only, in the nutrient's own unit
 * (µg or mg per LCC's `content_nutrients.unit`), scaled from per-100 g onto the
 * grams actually eaten. Uncovered entries contribute NOTHING to it — they are
 * never summed as zero — and instead push `coveredFraction` down, which is the
 * whole point of returning the two together.
 */
export type NutrientDayIntake =
  | ({ hasEnoughData: true; amount: number } & NutrientCoverage)
  | ({ hasEnoughData: false; amount: null } & NutrientCoverage);

/** One calendar day's per-nutrient intake and coverage. */
export interface DailyMicronutrients {
  /** The local `YYYY-MM-DD` day these totals belong to. */
  date: string;
  /** Entries logged that day. `0` for a gap day. */
  totalEntries: number;
  /** Total grams logged that day — the denominator behind every nutrient's coverage. */
  totalGrams: number;
  /**
   * One entry PER NUTRIENT, never a single day-wide figure. Coverage is not a
   * property of the day, it is a property of (day, nutrient): in the curated
   * corpus magnesium is 100% covered while vitamin D is ~10%, so one global
   * number would misdescribe both.
   */
  byNutrient: Record<NutrientKey, NutrientDayIntake>;
}

/**
 * One nutrient's intake + coverage across a day's entries. THE place the
 * zero-vs-unknown rule is enforced: an entry whose reading is not `measured`
 * is skipped entirely — it adds nothing to the sum and its grams land in
 * `totalGrams` but not `coveredGrams`. A `measured` `0` takes the opposite
 * path: it adds `0` to the sum AND counts as covered, because a measured zero
 * is data.
 */
function computeNutrientDayIntake(
  logs: readonly LocalFoodLog[],
  key: NutrientKey,
  minCoverageFraction: number,
): NutrientDayIntake {
  let amount = 0;
  let coveredGrams = 0;
  let totalGrams = 0;
  let contributingEntries = 0;

  for (const log of logs) {
    totalGrams += log.quantityGrams;
    const reading = readNutrientPer100g(log.micronutrientsPer100g, key);
    // `no-block` (AI-estimated plates, manual entries, BLS/FDC-origin matches)
    // and `no-value` (the source has this dimension but no figure for THIS
    // nutrient) both land here. Neither contributes — deliberately not even a 0.
    if (reading.state !== 'measured') continue;
    coveredGrams += log.quantityGrams;
    contributingEntries += 1;
    amount += (reading.value * log.quantityGrams) / 100;
  }

  const coverage: NutrientCoverage = {
    coveredFraction: totalGrams > 0 ? coveredGrams / totalGrams : 0,
    coveredGrams,
    totalGrams,
    contributingEntries,
    totalEntries: logs.length,
  };
  if (contributingEntries === 0 || coverage.coveredFraction < minCoverageFraction) {
    return { hasEnoughData: false, amount: null, ...coverage };
  }
  return { hasEnoughData: true, amount, ...coverage };
}

function computeMicronutrientsForLogs(
  logs: readonly LocalFoodLog[],
  date: string,
  minCoverageFraction: number,
): DailyMicronutrients {
  // SAFETY: the loop immediately below assigns EVERY member of `NUTRIENT_KEYS`
  // (the exhaustive `NutrientKey` list) before `byNutrient` is read or returned,
  // so no key is missing by the time it escapes this function.
  const byNutrient = {} as Record<NutrientKey, NutrientDayIntake>;
  for (const key of NUTRIENT_KEYS) {
    byNutrient[key] = computeNutrientDayIntake(logs, key, minCoverageFraction);
  }
  return {
    date,
    totalEntries: logs.length,
    totalGrams: logs.reduce((sum, log) => sum + log.quantityGrams, 0),
    byNutrient,
  };
}

/**
 * The per-nutrient intake and coverage for a single day (`dayKey`) from a flat
 * list of local logs. Pure — the micronutrient counterpart of
 * `computeDailyTotals`, at the same choke point.
 *
 * @param logs - every local food log, any order.
 * @param dayKey - the device-local `YYYY-MM-DD` day to aggregate.
 * @param options.minCoverageFraction - the "enough data" bar (see `DEFAULT_MIN_COVERAGE_FRACTION`).
 * @returns each nutrient's intake alongside the coverage that qualifies it.
 */
export function computeDailyMicronutrients(
  logs: readonly LocalFoodLog[],
  dayKey: string,
  { minCoverageFraction = DEFAULT_MIN_COVERAGE_FRACTION }: { minCoverageFraction?: number } = {},
): DailyMicronutrients {
  return computeMicronutrientsForLogs(
    logs.filter((log) => log.dayKey === dayKey),
    dayKey,
    minCoverageFraction,
  );
}

/**
 * One `DailyMicronutrients` per calendar day in `[fromDate, toDate]`
 * (inclusive, gaps included), oldest first — the micronutrient counterpart of
 * `computeDailyTotalsInRange`. Pure.
 */
export function computeDailyMicronutrientsInRange(
  logs: readonly LocalFoodLog[],
  { fromDate, toDate }: { fromDate: string; toDate: string },
  { minCoverageFraction = DEFAULT_MIN_COVERAGE_FRACTION }: { minCoverageFraction?: number } = {},
): DailyMicronutrients[] {
  const buckets = new Map<string, LocalFoodLog[]>();
  for (const log of logs) {
    if (log.dayKey < fromDate || log.dayKey > toDate) continue;
    const bucket = buckets.get(log.dayKey);
    if (bucket) bucket.push(log);
    else buckets.set(log.dayKey, [log]);
  }
  return enumerateDates(fromDate, toDate).map((date) =>
    computeMicronutrientsForLogs(buckets.get(date) ?? [], date, minCoverageFraction),
  );
}

/**
 * One WINDOW's per-nutrient intake and coverage — the whole range treated as a
 * single bucket rather than a series of days.
 *
 * A separate shape from `DailyMicronutrients` because a reference intake is a
 * DAILY amount, so a window has to be reduced to a per-day figure before it can
 * be compared to one, and `loggedDays` is the only honest denominator for that:
 * dividing by the calendar length of the window would under-report someone who
 * logged three days out of seven, while dividing by the number of ENTRIES is
 * not a day at all.
 */
export interface WindowMicronutrients {
  fromDate: string;
  toDate: string;
  /** Days in `[fromDate, toDate]` carrying at least one entry — the per-day denominator. */
  loggedDays: number;
  /** Entries logged across the window. */
  totalEntries: number;
  /** Total grams logged across the window. */
  totalGrams: number;
  /** One entry per nutrient, same `hasEnoughData` guarantee as the daily shape. */
  byNutrient: Record<NutrientKey, NutrientDayIntake>;
}

/**
 * The per-nutrient intake and coverage across `[fromDate, toDate]` as ONE
 * aggregate. Pure.
 *
 * Deliberately computed from the window's logs directly rather than by folding
 * `computeDailyMicronutrientsInRange`'s output: below the coverage bar a day's
 * `amount` is `null` by design, so a fold could only ever sum the days that
 * happened to clear it — silently re-introducing the "count what we know, drop
 * what we don't" bias this module exists to prevent. Coverage is evaluated once,
 * against the whole window.
 *
 * @param logs - every local food log, any order.
 * @param range - the inclusive `YYYY-MM-DD` window.
 * @param options.minCoverageFraction - the "enough data" bar (see `DEFAULT_MIN_COVERAGE_FRACTION`).
 * @returns the window's per-nutrient intake alongside the coverage that qualifies it.
 */
export function computeMicronutrientsInWindow(
  logs: readonly LocalFoodLog[],
  { fromDate, toDate }: { fromDate: string; toDate: string },
  { minCoverageFraction = DEFAULT_MIN_COVERAGE_FRACTION }: { minCoverageFraction?: number } = {},
): WindowMicronutrients {
  const inWindow = logs.filter((log) => log.dayKey >= fromDate && log.dayKey <= toDate);
  const totals = computeMicronutrientsForLogs(inWindow, toDate, minCoverageFraction);
  return {
    fromDate,
    toDate,
    loggedDays: new Set(inWindow.map((log) => log.dayKey)).size,
    totalEntries: totals.totalEntries,
    totalGrams: totals.totalGrams,
    byNutrient: totals.byNutrient,
  };
}

/**
 * The current logging streak: consecutive days ending at the series' last day
 * that were logged. With a `netCarbsCeiling`, only days at/under the ceiling
 * count (an over-goal day breaks the streak); without one, any logged day
 * counts. The breach check uses `isOverCarbGoal` — the same rounded
 * comparison the diary headline uses — so a day can't break the profile
 * streak while reading "met" everywhere else. Expects `dailyTotals`
 * oldest-first, as `computeDailyTotalsInRange` returns.
 */
export function computeStreak(
  dailyTotals: readonly LocalDailyTotals[],
  { netCarbsCeiling }: { netCarbsCeiling: number | null } = { netCarbsCeiling: null },
): number {
  let streak = 0;
  for (let index = dailyTotals.length - 1; index >= 0; index--) {
    const day = dailyTotals[index];
    if (!day.hasLogs) break;
    if (netCarbsCeiling !== null) {
      const netCarbs = day.summary?.netCarbs ?? null;
      if (netCarbs === null || isOverCarbGoal({ netCarbs, ceiling: netCarbsCeiling })) break;
    }
    streak += 1;
  }
  return streak;
}

/** The net-carb trend series over a range — one point per day, gaps as null. Pure. */
export function computeNetCarbTrendSeries(dailyTotals: readonly LocalDailyTotals[]): TrendPoint[] {
  return dailyTotals.map((day) => ({
    date: day.date,
    netCarbs: day.hasLogs ? (day.summary?.netCarbs ?? null) : null,
  }));
}

/** The 7-/N-day habit strip built from local daily totals (oldest → today). */
export function computeLocalHabitStrip({
  dailyTotals,
  today,
  dayCount,
  netCarbsCeiling,
}: {
  dailyTotals: readonly LocalDailyTotals[];
  today: string;
  dayCount: number;
  netCarbsCeiling: number | null;
}): HabitStripDay[] {
  return buildHabitStrip({
    today,
    dayCount,
    days: dailyTotals.map((day) => ({
      date: day.date,
      hasLogs: day.hasLogs,
      netCarbs: day.summary?.netCarbs ?? null,
    })),
    netCarbsCeiling,
  });
}

// ---------------------------------------------------------------------------
// Store-reading wrappers (imperative shell — read the local store, then compute)
// ---------------------------------------------------------------------------

/** Daily totals for one local day, read from the primary store. */
export async function getLocalDailyTotals(dayKey: string, { store }: { store?: Store } = {}): Promise<DailyTotals> {
  return computeDailyTotals(await listLocalFoodLogs({ store }), dayKey);
}

/** Per-day totals across a range, read from the primary store. */
export async function getLocalDailyTotalsInRange({
  fromDate,
  toDate,
  store,
}: {
  fromDate: string;
  toDate: string;
  store?: Store;
}): Promise<LocalDailyTotals[]> {
  return computeDailyTotalsInRange(await listLocalFoodLogs({ store }), { fromDate, toDate });
}

/** Per-nutrient intake + coverage for one local day, read from the primary store. */
export async function getLocalDailyMicronutrients(
  dayKey: string,
  { store, minCoverageFraction }: { store?: Store; minCoverageFraction?: number } = {},
): Promise<DailyMicronutrients> {
  return computeDailyMicronutrients(await listLocalFoodLogs({ store }), dayKey, { minCoverageFraction });
}

/** Per-nutrient intake + coverage across a range, read from the primary store. */
export async function getLocalDailyMicronutrientsInRange({
  fromDate,
  toDate,
  store,
  minCoverageFraction,
}: {
  fromDate: string;
  toDate: string;
  store?: Store;
  minCoverageFraction?: number;
}): Promise<DailyMicronutrients[]> {
  return computeDailyMicronutrientsInRange(
    await listLocalFoodLogs({ store }),
    { fromDate, toDate },
    { minCoverageFraction },
  );
}
