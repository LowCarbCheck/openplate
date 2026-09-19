/**
 * Pure per-slot statistics for the Meals tab (M239/04): per-slot averages, the
 * per-day/week split of a metric across the four slots (plus every log with
 * no meal chosen at all), and the most-logged foods at one slot. No store, no
 * clock, no React — plain logs and a date range in, plain rows out, the same
 * split `trend-buckets.ts` and `macro-energy-split.ts` already use.
 *
 * NO GOAL LINE AND NO MET/MISSED WORDING lives here or in anything built from
 * this module. Every goal this app stores is a whole-day figure, and a slot is
 * a part of a day, the same reason `buildTrendChart` drops the goal for a
 * chosen slot (`#app/lib/trend-chart`).
 */
import { startOfWeek } from '#app/lib/trend-week';
import { enumerateDates } from '#app/lib/user-days';
import { computeSlotTotalsInRange, localFoodLogToSnapshot } from '#app/lib/local-store/aggregates';
import type { LocalDailyTotals } from '#app/lib/local-store/aggregates';
import type { LocalFoodLog } from '#app/lib/local-store/schema';
import { summarizeDay } from '#app/models/food-log-summary';
import { MEAL_TYPES } from '#app/lib/meal-choice';
import type { MealType } from '#types/enums';

/** An inclusive `YYYY-MM-DD` window, the shape every range-bound selector here takes. */
export interface DateRange {
  fromDate: string;
  toDate: string;
}

// ---------------------------------------------------------------------------
// Slot averages
// ---------------------------------------------------------------------------

/** One slot's mean figures over the days IT was logged, plus how many days that was. */
export interface SlotAverages {
  /** Days in the range this slot has at least one entry on. */
  loggedDays: number;
  /** Days in the whole range, logged at this slot or not, "N of M". */
  totalDays: number;
  /** Mean kcal over the logged days, or null when none of them had a computable total. */
  averageKcal: number | null;
  averageNetCarbs: number | null;
  averageProtein: number | null;
  averageFat: number | null;
}

/** Every slot's averages over one range, the closed four-slot contract `computeSlotAverages` returns. */
export interface SlotAveragesBySlot {
  breakfast: SlotAverages;
  lunch: SlotAverages;
  dinner: SlotAverages;
  snack: SlotAverages;
}

/**
 * Every slot's averages over a range.
 *
 * Delegates to `computeSlotTotalsInRange` for the per-day figures rather than
 * re-deriving them, so a slot's average agrees to the gram with the chart
 * that already draws it: a day with entries in OTHER slots is a gap for this
 * one, never a zero, exactly as that function's own doc states.
 *
 * @param logs - every local food log, any order.
 * @param range - the inclusive window to average over.
 * @returns each of the four slots' averages.
 */
export function computeSlotAverages({ logs, range }: { logs: readonly LocalFoodLog[]; range: DateRange }): SlotAveragesBySlot {
  const forSlot = (slot: MealType): SlotAverages => _averagesFor(computeSlotTotalsInRange(logs, range, slot));
  return {
    breakfast: forSlot('breakfast'),
    lunch: forSlot('lunch'),
    dinner: forSlot('dinner'),
    snack: forSlot('snack'),
  };
}

/** The mean of one slot's figures over the days it has logs, from its per-day totals. */
function _averagesFor(days: readonly LocalDailyTotals[]): SlotAverages {
  const logged = days.filter((day) => day.hasLogs);
  return {
    loggedDays: logged.length,
    totalDays: days.length,
    averageKcal: _meanOrNull(logged.flatMap((day) => (day.kcal.total === null ? [] : [day.kcal.total]))),
    averageNetCarbs: _meanOrNull(logged.flatMap((day) => (day.summary === null ? [] : [day.summary.netCarbs]))),
    averageProtein: _meanOrNull(logged.flatMap((day) => (day.summary === null ? [] : [day.summary.protein]))),
    averageFat: _meanOrNull(logged.flatMap((day) => (day.summary === null ? [] : [day.summary.fat]))),
  };
}

/** Arithmetic mean, or null for an empty list (never a fabricated zero). */
function _meanOrNull(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Slot shares: which slot a day's (or week's) kcal / net carbs came from
// ---------------------------------------------------------------------------

/** The metrics the share bar can split. */
export type SlotShareMetric = 'kcal' | 'net-carbs';

/**
 * One day's (or week's) total, split five ways: the four slots, plus every
 * log with no meal chosen at all (`mealType: null`). The fifth bucket is what
 * keeps this an honest partition — a slot-only split would silently drop those
 * entries' share of the day, which is exactly the bug M227/02 left standing
 * for every slot filter it added.
 */
export interface SlotShareBucket {
  breakfast: number;
  lunch: number;
  dinner: number;
  snack: number;
  /** The share belonging to logs with `mealType: null`, "no meal set". */
  noSlot: number;
}

/** The five bucket keys, in the order the bar and its legend draw them. */
export const SLOT_SHARE_KEYS = [...MEAL_TYPES, 'noSlot'] as const satisfies readonly (keyof SlotShareBucket)[];

/** One row of the share bar: a day or a week, and its split when it has one. */
export interface SlotShareRow {
  date: string;
  hasLogs: boolean;
  /** Percentages of the five buckets, summing to 100 within rounding, or null for a day/week with no split. */
  shares: SlotShareBucket | null;
}

/** Which `DaySummary` field each share metric reads. */
const METRIC_FIELD = { kcal: 'kcal', 'net-carbs': 'netCarbs' } as const satisfies Record<SlotShareMetric, 'kcal' | 'netCarbs'>;

/**
 * The share of a metric (kcal or net carbs) each meal slot contributed: one
 * row per day, or one row per Monday→Sunday week at `isWeekly` — the SAME week
 * rule `trend-buckets.ts`'s `bucketByWeek` uses: a week is averaged over the
 * days it was actually logged, and a week with none logged is a gap, never a
 * zero. Not built from `bucketByWeek` directly (its fold is specific to a
 * single whole-day total), but it follows the identical rule on this module's
 * own five-bucket rows.
 *
 * @param logs - every local food log, any order.
 * @param range - the inclusive window to chart.
 * @param metric - which total the shares are of.
 * @param isWeekly - true at the wide ranges, where each row is a week.
 * @returns one row per day (or week), oldest first.
 */
export function computeSlotShares({
  logs,
  range,
  metric,
  isWeekly,
}: {
  logs: readonly LocalFoodLog[];
  range: DateRange;
  metric: SlotShareMetric;
  isWeekly: boolean;
}): SlotShareRow[] {
  const days = _dailySlotValues({ logs, range, metric });
  return isWeekly ? _bucketSlotValuesByWeek(days) : days.map(_toShareRow);
}

/** One day's raw (pre-percentage) bucket totals, and whether it was logged at all. */
interface DaySlotValues {
  date: string;
  hasLogs: boolean;
  values: SlotShareBucket;
}

/** Every day in the range, gaps included, with its five raw bucket totals. */
function _dailySlotValues({
  logs,
  range,
  metric,
}: {
  logs: readonly LocalFoodLog[];
  range: DateRange;
  metric: SlotShareMetric;
}): DaySlotValues[] {
  const byDay = new Map<string, LocalFoodLog[]>();
  for (const log of logs) {
    if (log.dayKey < range.fromDate || log.dayKey > range.toDate) continue;
    const bucket = byDay.get(log.dayKey);
    if (bucket) bucket.push(log);
    else byDay.set(log.dayKey, [log]);
  }
  return enumerateDates(range.fromDate, range.toDate).map((date) => {
    const dayLogs = byDay.get(date) ?? [];
    return { date, hasLogs: dayLogs.length > 0, values: _slotValuesFor(dayLogs, metric) };
  });
}

/**
 * Splits one day's logs into the five buckets and reads each bucket's total
 * off `summarizeDay`, the SAME projection `computeDailyTotals` builds a whole
 * day's total from (via `localFoodLogToSnapshot`), so the five bucket totals
 * always add back up to the day's own total: both are sums of the identical
 * per-entry figures, just partitioned differently.
 */
function _slotValuesFor(dayLogs: readonly LocalFoodLog[], metric: SlotShareMetric): SlotShareBucket {
  const field = METRIC_FIELD[metric];
  const valueOf = (predicate: (log: LocalFoodLog) => boolean): number => {
    const matching = dayLogs.filter(predicate).map(localFoodLogToSnapshot);
    return matching.length === 0 ? 0 : summarizeDay(matching)[field];
  };
  return {
    breakfast: valueOf((log) => log.mealType === 'breakfast'),
    lunch: valueOf((log) => log.mealType === 'lunch'),
    dinner: valueOf((log) => log.mealType === 'dinner'),
    snack: valueOf((log) => log.mealType === 'snack'),
    // A log with no meal chosen at all still carries kcal / net carbs; leaving
    // it out here would make the day's five segments undercount its own total.
    noSlot: valueOf((log) => log.mealType === null),
  };
}

function _toShareRow(day: DaySlotValues): SlotShareRow {
  return { date: day.date, hasLogs: day.hasLogs, shares: day.hasLogs ? _sharesOf(day.values) : null };
}

/** Raw bucket totals turned into percentages of their own sum, or null when the sum is not positive. */
function _sharesOf(values: SlotShareBucket): SlotShareBucket | null {
  const total = SLOT_SHARE_KEYS.reduce((sum, key) => sum + values[key], 0);
  if (total <= 0) return null;
  const shareOf = (key: keyof SlotShareBucket): number => (values[key] / total) * 100;
  return {
    breakfast: shareOf('breakfast'),
    lunch: shareOf('lunch'),
    dinner: shareOf('dinner'),
    snack: shareOf('snack'),
    noSlot: shareOf('noSlot'),
  };
}

/** Folds the daily bucket rows into one row per Monday→Sunday week, the `bucketByWeek` grouping rule. */
function _bucketSlotValuesByWeek(days: readonly DaySlotValues[]): SlotShareRow[] {
  const weeks = new Map<string, DaySlotValues[]>();
  for (const day of days) {
    const monday = startOfWeek(day.date);
    const week = weeks.get(monday) ?? [];
    week.push(day);
    weeks.set(monday, week);
  }
  return [...weeks.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([monday, weekDays]) => _summarizeWeekShares(monday, weekDays));
}

/** One week's row: the mean of each bucket over the week's LOGGED days, or a gap when none were logged. */
function _summarizeWeekShares(monday: string, weekDays: readonly DaySlotValues[]): SlotShareRow {
  const logged = weekDays.filter((day) => day.hasLogs);
  if (logged.length === 0) return { date: monday, hasLogs: false, shares: null };
  const meanOf = (key: keyof SlotShareBucket): number => logged.reduce((sum, day) => sum + day.values[key], 0) / logged.length;
  const averaged: SlotShareBucket = {
    breakfast: meanOf('breakfast'),
    lunch: meanOf('lunch'),
    dinner: meanOf('dinner'),
    snack: meanOf('snack'),
    noSlot: meanOf('noSlot'),
  };
  return { date: monday, hasLogs: true, shares: _sharesOf(averaged) };
}

// ---------------------------------------------------------------------------
// Top foods at one slot ("Your usual <slot>")
// ---------------------------------------------------------------------------

/** How many foods `topFoodsForSlot` returns at most. */
export const TOP_FOODS_LIMIT = 5;

/** One food's showing at a slot: how many times it was logged, ready to display. */
export interface SlotFood {
  /** The grouping key: the food id when the logs carry one, else a normalised name. Not for display. */
  key: string;
  /** The most recently logged display name under this key. */
  name: string;
  /** How many entries at this slot, in the range, were grouped under this key. */
  logCount: number;
}

/** Case-insensitive, whitespace-collapsed grouping key for a food with no `foodId`. */
function _nameKey(name: string): string {
  return name.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
}

/** One grouped food's accumulating evidence while scanning the logs. */
interface FoodGroup {
  name: string;
  logCount: number;
  latestLoggedAt: number;
}

/**
 * The most-logged foods at one slot in a range, for "Your usual {{meal}}".
 *
 * Grouped by `foodId` when the logs carry one (the same personal food,
 * re-logged, is one row), else by a normalised name, because an AI-estimated
 * or hand-typed entry carries no `foodId` at all, and "Oatmeal" / "oatmeal "
 * must still count as one food rather than two entries with one log each.
 *
 * @param logs - every local food log, any order.
 * @param range - the inclusive window to count.
 * @param slot - the meal slot to rank.
 * @returns the top foods, most-logged first, at most `TOP_FOODS_LIMIT`.
 */
export function topFoodsForSlot({
  logs,
  range,
  slot,
}: {
  logs: readonly LocalFoodLog[];
  range: DateRange;
  slot: MealType;
}): SlotFood[] {
  const groups = new Map<string, FoodGroup>();
  for (const log of logs) {
    if (log.mealType !== slot) continue;
    if (log.dayKey < range.fromDate || log.dayKey > range.toDate) continue;
    const key = log.foodId ?? `name:${_nameKey(log.name)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { name: log.name, logCount: 1, latestLoggedAt: log.loggedAt });
      continue;
    }
    existing.logCount += 1;
    // The MOST RECENT casing wins, so a food typed inconsistently still shows
    // under the spelling the person used last.
    if (log.loggedAt >= existing.latestLoggedAt) {
      existing.latestLoggedAt = log.loggedAt;
      existing.name = log.name;
    }
  }
  return [...groups.entries()]
    .toSorted(([, left], [, right]) => right.logCount - left.logCount || right.latestLoggedAt - left.latestLoggedAt)
    .slice(0, TOP_FOODS_LIMIT)
    .map(([key, group]) => ({ key, name: group.name, logCount: group.logCount }));
}
