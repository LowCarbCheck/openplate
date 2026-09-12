/**
 * ONE reader for the catch-up's inputs.
 *
 * `/catch-up` renders the words and `CatchUpWriter` stores them for the push
 * path, and the two must never disagree about what yesterday was. So the store
 * reads live here, once, and both callers go through this function.
 *
 * The imperative shell around `#app/models/catch-up`: this module talks to the
 * on-device store and reads the clock; the module it feeds does neither.
 */
import {
  computeDailyTotalsInRange,
  getLocalBodyMetrics,
  getLocalFastingSettings,
  getLocalProfileGoals,
  listLocalFasts,
  listLocalFoodLogs,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalFast, LocalFoodLog } from '#app/lib/local-store';
import { resolveAdherenceGoals } from '#app/lib/adherence-goals';
import { shiftDate, todayInTimezone } from '#app/lib/user-days';
import { formatFastDuration, resolveFastTimeline, selectCurrentFast } from '#app/models/fasting';
import type { Translate } from '#app/models/fasting';
import { resolveFallbackFoods } from '#app/models/catch-up';
import type { CatchUpDay, CatchUpFast, CatchUpFood, CatchUpInput } from '#app/models/catch-up';

/** Yesterday and the two days before it. The window the catch-up reads, and nothing wider. */
const CATCH_UP_DAYS = 3;

/**
 * How many of the person's most recent entries the nudge ranks foods from.
 *
 * A window rather than the whole history: a nudge names something they ate
 * recently, and a tuna salad from eleven months ago is not a suggestion.
 */
const RECENT_FOOD_WINDOW = 60;

const MINUTES_PER_HOUR = 60;

/** "20:00" from a minute after local midnight. Wall-clock, because a routine is a wall-clock habit. */
export function formatRoutineStartLabel(minute: number): string {
  const hours = Math.floor(minute / MINUTES_PER_HOUR);
  const minutes = minute % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Local midnight at the start of a `YYYY-MM-DD` day key, on the device's own clock. */
function localDayStartMs(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00`).getTime();
}

/**
 * Did a fast that actually RAN overlap `dayKey`?
 *
 * `scheduled` and `cancelled` are excluded: a plan is not a fasting day. An
 * `ended-early` fast is included, because the person did fast that day, just
 * not to their target, and "0 meals" would be as wrong for it as for any other.
 *
 * @param fasts - every fast on the device.
 * @param dayKey - the device-local day to test.
 * @param nowMs - the clock reading an open fast is measured against.
 */
function wasFastingDay({
  fasts,
  dayKey,
  nowMs,
}: {
  fasts: readonly LocalFast[];
  dayKey: string;
  nowMs: number;
}): boolean {
  const dayStart = localDayStartMs(dayKey);
  const dayEnd = localDayStartMs(shiftDate(dayKey, 1));
  return fasts.some((fast) => {
    const timeline = resolveFastTimeline(fast, nowMs);
    if (timeline.status === 'scheduled' || timeline.status === 'cancelled') return false;
    return timeline.startAt < dayEnd && (timeline.endAt ?? nowMs) > dayStart;
  });
}

/** One entry's per-100 g figure for a macro, or null when the entry carries no weight to scale by. */
function per100g(value: number | null, quantityGrams: number): number | null {
  if (value === null || quantityGrams <= 0) return null;
  return (value / quantityGrams) * 100;
}

/** The person's own foods, most recent first, with the two figures a nudge ranks on. */
function toRecentFoods(logs: readonly LocalFoodLog[]): CatchUpFood[] {
  return logs
    .toSorted((a, b) => b.loggedAt - a.loggedAt)
    .slice(0, RECENT_FOOD_WINDOW)
    .map((log) => ({
      name: log.name,
      proteinPer100g: per100g(log.macros.protein, log.quantityGrams),
      fiberPer100g: per100g(log.macros.fiber, log.quantityGrams),
    }));
}

/** What the fasting side has to say, with every label already formatted. */
function toCatchUpFast({
  fasts,
  routineStartMinute,
  yesterday,
  nowMs,
  t,
}: {
  fasts: readonly LocalFast[];
  routineStartMinute: number | null;
  yesterday: string;
  nowMs: number;
  t: Translate;
}): CatchUpFast {
  const coveredYesterday = wasFastingDay({ fasts, dayKey: yesterday, nowMs });
  const routineStartLabel = routineStartMinute === null ? undefined : formatRoutineStartLabel(routineStartMinute);
  const current = selectCurrentFast(fasts);
  if (current === null) return { status: 'none', routineStartLabel, coveredYesterday };

  const timeline = resolveFastTimeline(current, nowMs);
  if (timeline.status === 'scheduled') {
    return {
      status: 'scheduled',
      startsAtLabel: formatRoutineStartLabel(
        new Date(timeline.startAt).getHours() * MINUTES_PER_HOUR + new Date(timeline.startAt).getMinutes(),
      ),
      routineStartLabel,
      coveredYesterday,
    };
  }
  if (timeline.status === 'active') {
    return {
      status: 'active',
      elapsedLabel: formatFastDuration(timeline.elapsedMs, t),
      routineStartLabel,
      coveredYesterday,
    };
  }
  return { status: 'none', routineStartLabel, coveredYesterday };
}

/**
 * Everything `buildCatchUp` needs, read off this device.
 *
 * @param t - the caller's translator.
 * @param locale - the active UI language.
 * @param nowMs - the clock reading, passed in so a caller can pin it.
 * @returns the full input, ready for `buildCatchUp`.
 */
export async function loadCatchUpInput({
  t,
  locale,
  nowMs = Date.now(),
}: {
  t: Translate;
  locale: string;
  nowMs?: number;
}): Promise<CatchUpInput> {
  const profile = await getLocalProfileGoals();
  const today = todayInTimezone(resolveLocalTimezone(profile));
  const yesterday = shiftDate(today, -1);

  const allLogs = await listLocalFoodLogs();
  const totals = computeDailyTotalsInRange(allLogs, {
    fromDate: shiftDate(today, -CATCH_UP_DAYS),
    toDate: yesterday,
  });
  const days: CatchUpDay[] = totals.map((day) => ({
    dayKey: day.date,
    meals: day.entryCount,
    netCarbsG: day.summary?.netCarbs ?? 0,
    proteinG: day.summary?.protein ?? 0,
    kcal: day.kcal.total ?? 0,
    fiberG: day.summary?.fiber ?? 0,
  }));

  // The same resolver the dashboard and the diary grade a day with, so the
  // catch-up can never name a ceiling the budget rows do not.
  const bodyMetrics = await getLocalBodyMetrics();
  const { goals: adherenceGoals, kcalTarget } = resolveAdherenceGoals({
    goals: {
      netCarbsCeiling: profile?.goalNetCarbsCeilingG ?? null,
      proteinFloor: profile?.goalProteinFloorG ?? null,
      kcalTarget: profile?.goalKcalTarget ?? null,
    },
    bodyMetrics,
    today,
  });

  const fasts = await listLocalFasts();
  const fastingSettings = await getLocalFastingSettings();

  return {
    days,
    goals: {
      netCarbsCeiling: adherenceGoals.netCarbsCeilingG,
      proteinFloor: adherenceGoals.proteinFloorG,
      kcalTarget,
    },
    fast: toCatchUpFast({
      fasts,
      routineStartMinute: fastingSettings.routineStartMinute,
      yesterday,
      nowMs,
      t,
    }),
    recentFoods: toRecentFoods(allLogs),
    fallbackFoods: resolveFallbackFoods(t),
    today,
    locale,
    t,
  };
}
