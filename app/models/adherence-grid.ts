/**
 * Pure grid model for the Progress page's goal-adherence grid — no DB import,
 * no React, so it's unit-testable on its own (same split as `habit-strip.ts`,
 * which this deliberately mirrors in style).
 *
 * The grid is 13 whole Monday→Sunday columns ending in the week that contains
 * today. Each cell grades one day against the goals the user has actually
 * configured, and lands on a four-step sequential ramp: light = fewer goals
 * met, dark = every goal met.
 *
 * Two rules the rest of the app must not undo:
 *
 * 1. A goal that can't be assessed drops out of BOTH the numerator and the
 *    denominator. A day where carbs are known and met but protein is unknown
 *    scores 1 of 1, not 1 of 2 — the app never penalises someone for data it
 *    doesn't have, and never claims it graded a goal it couldn't.
 * 2. A missed goal is a LIGHTER STEP on the ramp, never a warning colour. This
 *    module never emits an "over"/"failed" state, because the grid has none —
 *    that is a product decision, not an oversight.
 *
 * The met/over verdicts come from `#app/lib/goal-progress` rather than being
 * re-derived here, so the same day can't read "met" on this grid and "over" in
 * the diary headline for the same number (that regression is exactly what
 * `isOverCarbGoal`'s doc comment exists to prevent).
 */
import { isOverCarbGoal, isOverKcalGoal, computeProteinGoalProgress } from '#app/lib/goal-progress';
import { startOfWeek } from '#app/lib/trend-week';
import { shiftDate } from '#app/lib/user-days';

/** Days in a Monday→Sunday week. */
const DAYS_PER_WEEK = 7;

/** Ramp steps in the grid. Fixed at 4 — the validated ramp has exactly four. */
const LEVEL_COUNT = 4;

/** The three daily goals the grid can grade. Order is display order everywhere. */
export type AdherenceGoalKey = 'netCarbs' | 'protein' | 'kcal';

/** Display order for the per-goal rows in a tooltip/caption. */
export const ADHERENCE_GOAL_KEYS: readonly AdherenceGoalKey[] = ['netCarbs', 'protein', 'kcal'];

/** Per-goal outcome for one day. `unknown` = configured, but the day's figure isn't computable. */
export type AdherenceGoalVerdict = 'met' | 'missed' | 'unknown';

/** Ramp step. 1 = palest (logged, none met) … 4 = darkest (every configured goal met). */
export type AdherenceLevel = 1 | 2 | 3 | 4;

/**
 * `adherence` — at least one goal configured; cells carry a level.
 * `activity`  — no goal configured; cells are binary logged/not.
 */
export type AdherenceMode = 'adherence' | 'activity';

/** A cell's paint class. `logged` only occurs in `activity` mode; `rated` only in `adherence`. */
export type AdherenceStatus = 'no-data' | 'logged' | 'unrated' | 'rated';

/** The configured goals, straight off `LocalProfileGoals`. A null (or non-positive) value means "not configured". */
export interface AdherenceGoals {
  netCarbsCeilingG: number | null;
  proteinFloorG: number | null;
  kcalTarget: number | null;
}

/** One windowed day's totals, fed into the grid. Order-independent, keyed by date. */
export interface AdherenceDayTotal {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** True when at least one entry was logged that day. */
  hasLogs: boolean;
  /** The day's net carbs, or null when nothing computable. */
  netCarbs: number | null;
  /** The day's protein, or null when nothing computable. */
  protein: number | null;
  /** The day's calories, or null when nothing computable. */
  kcal: number | null;
}

/** A resolved cell. */
export interface AdherenceDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** True for the user's current local day. */
  isToday: boolean;
  /** True for a date after today (trailing slots of the current week). Rendered as an empty spacer, never a cell. */
  isFuture: boolean;
  status: AdherenceStatus;
  /** Ramp step; null unless `status === 'rated'`. */
  level: AdherenceLevel | null;
  /** Per configured goal. A goal that isn't configured is absent from the record. */
  verdicts: Partial<Record<AdherenceGoalKey, AdherenceGoalVerdict>>;
  /** The day's raw figures, carried so the tooltip can lead with values. */
  totals: { netCarbs: number | null; protein: number | null; kcal: number | null };
  /** Count of configured goals with verdict `met`. */
  metCount: number;
  /** Count of configured goals with verdict `met` or `missed` (i.e. assessable). */
  ratedCount: number;
}

/** A month label anchored to the week column where its month first appears. */
export interface AdherenceMonthLabel {
  /** Index into `weeks`. */
  weekIndex: number;
  /** The Monday of that week, `YYYY-MM-DD` — the caller formats it with `Intl`. */
  weekStart: string;
}

export interface AdherenceGrid {
  mode: AdherenceMode;
  /** How many of the three goals are configured (0–3). */
  goalCount: number;
  /** Week columns, oldest first. Each is exactly 7 entries, index 0 = Monday. */
  weeks: AdherenceDay[][];
  /** Every day, oldest first — the same objects as in `weeks`, flattened. */
  days: AdherenceDay[];
  monthLabels: AdherenceMonthLabel[];
  /** Days in the window with at least one log (excludes future slots). */
  loggedDayCount: number;
  /** Days in the window with `level === 4` (every configured goal met). 0 in activity mode. */
  perfectDayCount: number;
  /** Non-future slots in the window — the honest denominator for the activity summary. */
  elapsedDayCount: number;
  /** True when any day in the window is `unrated` — gates the legend's third key. */
  hasUnratedDays: boolean;
}

/** A goal is configured only when it holds a positive number — a null or a 0 is "not set". */
function isConfigured(value: number | null): value is number {
  return value !== null && value > 0;
}

/**
 * How many of the three goals are configured (non-null and positive).
 *
 * @param goals - the user's daily goals.
 * @returns the count, 0–3.
 */
export function countConfiguredGoals(goals: AdherenceGoals): number {
  return [goals.netCarbsCeilingG, goals.proteinFloorG, goals.kcalTarget].filter(isConfigured).length;
}

/**
 * Maps the share of assessable goals met onto the 4-step ramp. A day with logs
 * is ALWAYS on the ramp (level 1 at worst) — logging is the thing being
 * recorded, and a logged day must never look like an empty one. Level 4 always
 * means "every goal I could check, you met", regardless of how many goals are
 * configured, so the darkest square carries one meaning across every profile.
 *
 * Ties round half UP (`Math.round`), so 1 of 2 goals lands on level 3.
 *
 * @param metCount - configured goals met.
 * @param ratedCount - configured goals that could be assessed at all.
 * @returns the ramp step, 1–4.
 * @throws if nothing was assessable (the caller must use `unrated` for that).
 */
function levelForShare(metCount: number, ratedCount: number): AdherenceLevel {
  if (ratedCount <= 0) throw new Error('levelForShare requires at least one rated goal');
  const step = 1 + Math.round((metCount / ratedCount) * (LEVEL_COUNT - 1));
  // SAFETY: `metCount / ratedCount` is in [0, 1] (a met goal is always a rated one), so
  // `step` is an integer in [1, LEVEL_COUNT] — exactly the `AdherenceLevel` ramp, whose
  // `unrated` case the `ratedCount <= 0` guard above has already rejected.
  return step as AdherenceLevel;
}

/** The verdict for one goal: `unknown` when the day carries no computable figure for it. */
function verdictFor(key: AdherenceGoalKey, total: AdherenceDayTotal, goals: AdherenceGoals): AdherenceGoalVerdict {
  if (key === 'netCarbs') {
    const ceiling = goals.netCarbsCeilingG;
    if (total.netCarbs === null || !isConfigured(ceiling)) return 'unknown';
    return isOverCarbGoal({ netCarbs: total.netCarbs, ceiling }) ? 'missed' : 'met';
  }
  if (key === 'protein') {
    const floor = goals.proteinFloorG;
    if (total.protein === null || !isConfigured(floor)) return 'unknown';
    return computeProteinGoalProgress({ protein: total.protein, floor }).isMet ? 'met' : 'missed';
  }
  const target = goals.kcalTarget;
  if (total.kcal === null || !isConfigured(target)) return 'unknown';
  return isOverKcalGoal({ kcal: total.kcal, target }) ? 'missed' : 'met';
}

/** An empty cell — no logs, or a slot for a day that hasn't happened yet. */
function emptyDay({ date, isToday, isFuture }: { date: string; isToday: boolean; isFuture: boolean }): AdherenceDay {
  return {
    date,
    isToday,
    isFuture,
    status: 'no-data',
    level: null,
    verdicts: {},
    totals: { netCarbs: null, protein: null, kcal: null },
    metCount: 0,
    ratedCount: 0,
  };
}

/**
 * Resolves one day's cell from its totals and the configured goals. Exported
 * for direct unit testing.
 *
 * @param total - the day's totals, or undefined when the window has no entry for it.
 * @param goals - the user's configured daily goals.
 * @param isToday - whether this is the user's current local day.
 * @param isFuture - whether this date is after today (a trailing slot of the current week).
 * @returns the resolved cell.
 */
export function resolveAdherenceDay({
  total,
  goals,
  isToday,
  isFuture,
}: {
  total: AdherenceDayTotal | undefined;
  goals: AdherenceGoals;
  isToday: boolean;
  isFuture: boolean;
}): AdherenceDay {
  const date = total?.date ?? '';
  if (isFuture || total === undefined || !total.hasLogs) return emptyDay({ date, isToday, isFuture });

  const totals = { netCarbs: total.netCarbs, protein: total.protein, kcal: total.kcal };
  const base = { date, isToday, isFuture, totals };

  // No goal configured: there is no magnitude to encode, so the cell is binary.
  if (countConfiguredGoals(goals) === 0) {
    return { ...base, status: 'logged', level: null, verdicts: {}, metCount: 0, ratedCount: 0 };
  }

  const verdicts: Partial<Record<AdherenceGoalKey, AdherenceGoalVerdict>> = {};
  for (const key of ADHERENCE_GOAL_KEYS) {
    const configured =
      key === 'netCarbs' ? isConfigured(goals.netCarbsCeilingG)
      : key === 'protein' ? isConfigured(goals.proteinFloorG)
      : isConfigured(goals.kcalTarget);
    if (configured) verdicts[key] = verdictFor(key, total, goals);
  }

  const assessed = Object.values(verdicts).filter((verdict) => verdict !== 'unknown');
  const metCount = assessed.filter((verdict) => verdict === 'met').length;
  const ratedCount = assessed.length;
  // Logged, goals set, but nothing computable to check them against — its own
  // neutral state, never a "you missed" step on the ramp.
  if (ratedCount === 0) return { ...base, status: 'unrated', level: null, verdicts, metCount: 0, ratedCount: 0 };

  return { ...base, status: 'rated', level: levelForShare(metCount, ratedCount), verdicts, metCount, ratedCount };
}

/**
 * Builds `weeks` whole Monday→Sunday columns ending in the week containing
 * `today`, assigning each day a cell state.
 *
 * @param today - the user's current local day, `YYYY-MM-DD`.
 * @param weeks - number of week columns (13).
 * @param days - one entry per windowed day (order-independent, keyed by date).
 * @param goals - the user's configured daily goals.
 * @returns the grid model, oldest week first, each week Monday-first.
 */
export function buildAdherenceGrid({
  today,
  weeks,
  days,
  goals,
}: {
  today: string;
  weeks: number;
  days: readonly AdherenceDayTotal[];
  goals: AdherenceGoals;
}): AdherenceGrid {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const goalCount = countConfiguredGoals(goals);
  const gridStart = shiftDate(startOfWeek(today), -(weeks - 1) * DAYS_PER_WEEK);

  const weekColumns = Array.from({ length: weeks }, (_unused, weekIndex) =>
    Array.from({ length: DAYS_PER_WEEK }, (_unusedDay, dayIndex) => {
      const date = shiftDate(gridStart, weekIndex * DAYS_PER_WEEK + dayIndex);
      // A gap day is a real, present slot with nothing in it — passing the
      // synthesised empty total (rather than `undefined`) keeps the cell's
      // `date` sourced from one place.
      const total = byDate.get(date) ?? { date, hasLogs: false, netCarbs: null, protein: null, kcal: null };
      return resolveAdherenceDay({ total, goals, isToday: date === today, isFuture: date > today });
    }),
  );

  const flat = weekColumns.flat();
  return {
    mode: goalCount > 0 ? 'adherence' : 'activity',
    goalCount,
    weeks: weekColumns,
    days: flat,
    monthLabels: _monthLabels(weekColumns),
    loggedDayCount: flat.filter((day) => !day.isFuture && day.status !== 'no-data').length,
    perfectDayCount: flat.filter((day) => day.level === LEVEL_COUNT).length,
    elapsedDayCount: flat.filter((day) => !day.isFuture).length,
    hasUnratedDays: flat.some((day) => day.status === 'unrated'),
  };
}

/** One label per month boundary: the first column always, then every column whose Monday starts a new month. */
function _monthLabels(weeks: AdherenceDay[][]): AdherenceMonthLabel[] {
  return weeks.flatMap((week, weekIndex) => {
    const weekStart = week[0].date;
    if (weekIndex > 0 && _monthOf(weekStart) === _monthOf(weeks[weekIndex - 1][0].date)) return [];
    return [{ weekIndex, weekStart }];
  });
}

/** The `YYYY-MM` a calendar date falls in. */
function _monthOf(date: string): string {
  return date.slice(0, 7);
}
