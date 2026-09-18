/**
 * The backfill migration (M235/05).
 *
 * A person who has kept a diary for two years must not open the build that
 * ships this milestone and read a streak of 1. Nothing recorded a mark before
 * this build existed, so the past is rebuilt from the rows that ARE there.
 *
 * ONLY FOUR SIGNALS ARE DERIVABLE, and the other three are deliberately not
 * invented. A food log says a person logged food, a food log the AI estimated
 * says they scanned something, a weight entry says they weighed themselves,
 * and a fast says they fasted on every local day it covered. Nothing in the
 * diary records that somebody repeated a meal, edited a shelf or exported a
 * backup, so those three badges are earned the next time the person does the
 * thing. The record starting today is honest for facts the diary never held.
 *
 * TWO PROPERTIES ARE LOAD BEARING:
 *
 * - EVERY BACKFILLED AWARD IS ALREADY SEEN. `seenAt` is set equal to
 *   `earnedAt`, so the first run of the new build fires no note at all,
 *   however long the history is. `app/lib/celebration.ts` is the precedent:
 *   a device that imports a backup must not be congratulated for its first
 *   log. Being told about a badge earned eighteen months ago is the same
 *   failure wearing a nicer hat.
 * - THE DERIVATION IS A PURE FUNCTION OF THE ROWS. No clock is read here, and
 *   no device fact enters. Two devices holding the same diary derive the same
 *   marks byte for byte, so the merge has nothing to resolve and the migration
 *   can run per device instead of needing a coordinated one.
 *
 * That second property is why a RUNNING fast is credited to its start day only
 * and not up to "now": crediting it to now would give a phone and a tablet
 * different marks for the same fast, and the days it goes on to cover are
 * recorded by the live recorder anyway (`record.ts`).
 */
import { isOverCarbGoal } from '#app/lib/goal-progress';
import { enumerateDates, todayInTimezone } from '#app/lib/user-days';
import {
  computeDailyTotalsInRange,
  putLocalActivityMark,
  putLocalAward,
  getLocalProfileGoals,
  listLocalFasts,
  listLocalFoodLogs,
  listLocalWeightEntries,
  readLocalSchemaVersion,
  resolveLocalTimezone,
  stampLocalSchemaVersion,
} from '#app/lib/local-store';
import type {
  LocalActivityMark,
  LocalAward,
  LocalDailyTotals,
  LocalFast,
  LocalFoodLog,
  LocalProfileGoals,
  LocalStoreHandle,
  LocalStoreSnapshot,
  LocalWeightEntry,
} from '#app/lib/local-store';

import { AWARDS, signalCountsTowardActive } from './catalog';
import type { ActivitySignal, AwardDefinition } from './catalog';
import { markId } from './marks';

/**
 * The schema version that introduced the two tables.
 *
 * A store below this has never held a mark, because the tables did not exist,
 * so its history has never been derived. A store at or above it has, and
 * re-deriving would read a whole diary to write nothing: every put is
 * write-once by key.
 */
export const GAMIFICATION_BACKFILL_SCHEMA_VERSION = 23;

/** The zone a backup's own rows are read in when the file carries no profile. See {@link backfillSnapshotHistory}. */
const FALLBACK_BACKUP_TIME_ZONE = 'UTC';

/** The rows a backfill derived, in the order they were written. */
export interface GamificationBackfill {
  /** Every mark the history implies, sorted by id. */
  marks: LocalActivityMark[];
  /** Every award that history already earned, in catalog order, each already seen. */
  awards: LocalAward[];
}

/** The history a derivation reads, and the zone its days are measured in. */
export interface DeriveMarksInput {
  foodLogs: readonly LocalFoodLog[];
  weightEntries: readonly LocalWeightEntry[];
  fasts: readonly LocalFast[];
  /** IANA zone the person's calendar days are measured in. */
  timeZone: string;
}

/** Everything the award derivation needs. Nothing here is read from a clock or a singleton. */
export interface DeriveAwardsInput {
  /** The derived marks, as {@link deriveMarksFromHistory} returns them. */
  marks: readonly LocalActivityMark[];
  /** Per-day totals across the whole history, oldest first, as `computeDailyTotalsInRange` returns them. */
  dailyTotals: readonly LocalDailyTotals[];
  /** The person's net-carb ceiling, or null when they have set none. Null silences the whole on-plan family. */
  netCarbsCeiling: number | null;
  /** The person's current local day, `YYYY-MM-DD`. No award may be dated after it. */
  today: string;
}

/** One immutable mark row. A named builder rather than a spread, so every field is written down once. */
function markRow(dayKey: string, signal: ActivitySignal): LocalActivityMark {
  return { id: markId(dayKey, signal), dayKey, signal };
}

/** The local day an instant falls on. The only place the zone is applied. */
function dayKeyOf(instantMs: number, timeZone: string): string {
  return todayInTimezone(timeZone, new Date(instantMs));
}

/**
 * The local days a fast ran across, oldest first.
 *
 * The span is `startedAt ?? plannedStartAt` to `endedAt`, and the end is read
 * one millisecond short so a fast that ended at local midnight credits the day
 * it was actually fasted in rather than the one after, which is the half-open
 * intersection `fasting-stats.ts` already performs against each day's real
 * bounds.
 *
 * TWO ROWS CREDIT NOTHING. A fast that was only ever PLANNED (no start was
 * declared and it never ended) did not happen, and a row whose end is at or
 * before its start is the `cancelled` case a restored backup or a stepped
 * clock can produce. Neither is something a person did, and a migration that
 * guessed otherwise would hand somebody a streak day for a plan they dropped.
 */
function fastRunDays(fast: LocalFast, timeZone: string): string[] {
  const startMs = fast.startedAt ?? fast.plannedStartAt;
  if (startMs === null) return [];
  if (fast.endedAt === null) {
    // Still running. Only the start day is derivable without a clock, and the
    // days it goes on to cover are marked as they happen.
    return fast.startedAt === null ? [] : [dayKeyOf(startMs, timeZone)];
  }
  if (fast.endedAt <= startMs) return [];
  return enumerateDates(dayKeyOf(startMs, timeZone), dayKeyOf(fast.endedAt - 1, timeZone));
}

/**
 * Every mark the diary implies, sorted by id, each listed once.
 *
 * Pure and deterministic: the same rows in any order produce the same list, in
 * the same order, on any device. That is what lets this run per device rather
 * than as a coordinated migration, since two devices deriving the same rows
 * write the same ids and the merge has nothing to contend over.
 *
 * @param input - the diary rows and the zone its days are measured in.
 * @returns the marks, sorted by id, ready for the store.
 */
export function deriveMarksFromHistory({
  foodLogs,
  weightEntries,
  fasts,
  timeZone,
}: DeriveMarksInput): LocalActivityMark[] {
  const byId = new Map<string, LocalActivityMark>();
  const add = (dayKey: string, signal: ActivitySignal): void => {
    const mark = markRow(dayKey, signal);
    byId.set(mark.id, mark);
  };
  for (const log of foodLogs) {
    add(log.dayKey, 'log.food');
    if (log.aiEstimated) add(log.dayKey, 'log.scan');
  }
  for (const entry of weightEntries) add(entry.dayKey, 'weight.log');
  for (const fast of fasts) {
    for (const dayKey of fastRunDays(fast, timeZone)) add(dayKey, 'fast.run');
  }
  // Sorted by id, the order `listLocalActivityMarks` reads them back in, so a
  // derived list and a stored list compare directly.
  return [...byId.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

/** The earliest day each signal was seen on, so an explorer badge is dated to the day it was actually earned. */
function firstDayBySignal(marks: readonly LocalActivityMark[], today: string): Map<string, string> {
  const first = new Map<string, string>();
  for (const mark of marks) {
    if (mark.dayKey > today) continue;
    const held = first.get(mark.signal);
    if (held === undefined || mark.dayKey < held) first.set(mark.signal, mark.dayKey);
  }
  return first;
}

/**
 * The first day each threshold was reached, walking a run of consecutive days
 * forward.
 *
 * ONE FORWARD WALK ANSWERS EVERY THRESHOLD, because a run only ever grows by a
 * day at a time: the day the run reaches 7 is the day the 7-day badge was
 * earned, and it is the first such day by construction. A threshold reached
 * again after a break keeps its FIRST date, which is what "never revoked"
 * means when it is written down as a date.
 */
function firstDayByThreshold(days: readonly string[], isOn: (day: string) => boolean): Map<number, string> {
  const reached = new Map<number, string>();
  let run = 0;
  for (const day of days) {
    run = isOn(day) ? run + 1 : 0;
    if (run > 0 && !reached.has(run)) reached.set(run, day);
  }
  return reached;
}

/** The days a derived history spans, oldest first, ending at `today`. Empty when there is no history at all. */
function historyDays(
  marks: readonly LocalActivityMark[],
  dailyTotals: readonly LocalDailyTotals[],
  today: string,
): string[] {
  const first = [...marks.map((mark) => mark.dayKey), ...dailyTotals.map((totals) => totals.date)]
    .filter((day) => day <= today)
    .toSorted()[0];
  return first === undefined ? [] : enumerateDates(first, today);
}

/** The days that carried a signal counting toward the activity streak, as a set. */
function activeDaySet(marks: readonly LocalActivityMark[]): ReadonlySet<string> {
  const active = new Set<string>();
  for (const mark of marks) {
    if (signalCountsTowardActive(mark.signal)) active.add(mark.dayKey);
  }
  return active;
}

/** The days at or under the net-carb ceiling, as a set. A day with no logs, or with no net-carb figure, is not one. */
function onPlanDaySet(dailyTotals: readonly LocalDailyTotals[], netCarbsCeiling: number): ReadonlySet<string> {
  const onPlan = new Set<string>();
  for (const day of dailyTotals) {
    if (!day.hasLogs) continue;
    const netCarbs = day.summary?.netCarbs ?? null;
    if (netCarbs === null) continue;
    if (isOverCarbGoal({ netCarbs, ceiling: netCarbsCeiling })) continue;
    onPlan.add(day.date);
  }
  return onPlan;
}

/** The day an award was earned, or null when the history never earned it. */
function earnedDayFor(
  award: AwardDefinition,
  {
    explorerDays,
    streakDays,
    onPlanDays,
  }: { explorerDays: Map<string, string>; streakDays: Map<number, string>; onPlanDays: Map<number, string> | null },
): string | null {
  if (award.kind === 'explorer') {
    return award.signal === undefined ? null : (explorerDays.get(award.signal) ?? null);
  }
  if (award.threshold === undefined) return null;
  if (award.kind === 'streak') return streakDays.get(award.threshold) ?? null;
  return onPlanDays?.get(award.threshold) ?? null;
}

/**
 * Local midnight of a day, in UTC, as the instant a backfilled award is
 * stamped with.
 *
 * The real instant was never recorded, so one is derived from the day itself
 * rather than read from a clock. Reading a clock would stamp two devices
 * differently for the same award and make the merge flip between them; using
 * the zone would make the stamp depend on a device fact. The DAY is the truth
 * here, and `earnedOnDay` carries it; this number exists to sort by.
 */
function dayStartUtcMs(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** One earned award row, stamped as already seen. A named builder, so `seenAt` is impossible to forget. */
function backfilledAwardRow(key: string, earnedOnDay: string): LocalAward {
  const earnedAt = dayStartUtcMs(earnedOnDay);
  // `seenAt` EQUALS `earnedAt`, and this line is the whole point of the
  // migration. A null here would fire a note for every badge a two-year diary
  // earned, all at once, on a person who did nothing but open the app.
  return { key, earnedAt, earnedOnDay, seenAt: earnedAt };
}

/**
 * The awards a derived history already earned, in catalog order, each dated to
 * the day it was actually earned and each already seen.
 *
 * Nothing is dated to today unless it really was earned today, and nothing is
 * dated after today at all. The on-plan family is silent when no ceiling is
 * set: with no ceiling there is nothing to be on plan with, and a person who
 * never set one is told nothing about it.
 *
 * @param input - the derived marks, the daily totals, the ceiling and the day.
 * @returns the award rows to write, in catalog order.
 */
export function deriveAwardsFromHistory({
  marks,
  dailyTotals,
  netCarbsCeiling,
  today,
}: DeriveAwardsInput): LocalAward[] {
  const days = historyDays(marks, dailyTotals, today);
  const active = activeDaySet(marks);
  const onPlan = netCarbsCeiling === null ? null : onPlanDaySet(dailyTotals, netCarbsCeiling);
  const found = {
    explorerDays: firstDayBySignal(marks, today),
    streakDays: firstDayByThreshold(days, (day) => active.has(day)),
    onPlanDays: onPlan === null ? null : firstDayByThreshold(days, (day) => onPlan.has(day)),
  };
  const earned: LocalAward[] = [];
  for (const award of AWARDS) {
    const earnedOnDay = earnedDayFor(award, found);
    if (earnedOnDay === null) continue;
    earned.push(backfilledAwardRow(award.key, earnedOnDay));
  }
  return earned;
}

/** An inclusive `YYYY-MM-DD` window, as `computeDailyTotalsInRange` takes one. */
interface TotalsRange {
  fromDate: string;
  toDate: string;
}

/** The window the daily totals are read over: the whole diary, ending at `today`. */
function totalsRange(foodLogs: readonly LocalFoodLog[], today: string): TotalsRange {
  const earliest = foodLogs.map((log) => log.dayKey).toSorted()[0];
  return { fromDate: earliest === undefined || earliest > today ? today : earliest, toDate: today };
}

/** The net-carb ceiling a profile row sets, or null. */
function ceilingOf(profile: LocalProfileGoals | null): number | null {
  return profile?.goalNetCarbsCeilingG ?? null;
}

/**
 * Fills a snapshot's two tables from the diary it already carries (the
 * BACKUP half of the migration).
 *
 * Called from `migrateEnvelopeForward` for an envelope below
 * {@link GAMIFICATION_BACKFILL_SCHEMA_VERSION}, so a file exported by an older
 * build arrives on a fresh device with the history it implies rather than with
 * two empty tables.
 *
 * TWO INPUTS THE STORE PATH READS FROM THE DEVICE ARE READ FROM THE FILE HERE,
 * because a pure migration may read neither a clock nor a device setting: the
 * zone comes from the file's own profile row and falls back to UTC, and "today"
 * is the last day the file has anything on. An award cannot have been earned
 * after the last day the diary records, so bounding the walk there costs
 * nothing and keeps the function total.
 *
 * @param snapshot - the migrated payload, with both tables still empty.
 * @returns the same payload with the derived marks and awards in place.
 */
export function backfillSnapshotHistory(snapshot: LocalStoreSnapshot): LocalStoreSnapshot {
  const timeZone = snapshot.profile?.timezone ?? FALLBACK_BACKUP_TIME_ZONE;
  const marks = deriveMarksFromHistory({
    foodLogs: snapshot.foodLogs,
    weightEntries: snapshot.weightEntries,
    fasts: snapshot.fasts,
    timeZone,
  });
  const lastDay = marks[marks.length - 1]?.dayKey;
  if (lastDay === undefined) return snapshot;
  const { fromDate, toDate } = totalsRange(snapshot.foodLogs, lastDay);
  const awards = deriveAwardsFromHistory({
    marks,
    dailyTotals: computeDailyTotalsInRange(snapshot.foodLogs, { fromDate, toDate }),
    netCarbsCeiling: ceilingOf(snapshot.profile),
    today: lastDay,
  });
  return { ...snapshot, activityMarks: marks, awards };
}

/**
 * Derives the past into the store, once (the STORE half of the migration).
 *
 * Runs only while the store is still below
 * {@link GAMIFICATION_BACKFILL_SCHEMA_VERSION}, and stamps the version on the
 * way out so a device whose diary yields no marks at all does not ask the same
 * question on every boot for ever. Every put is write-once by key, so even a
 * second run over the same rows writes nothing new.
 *
 * MAY THROW. The call site swallows, the way every other gamification call
 * site does: a badge must never cost somebody their diary.
 *
 * @param options.store - the store to read and write, the primary store by default.
 * @param options.today - the person's current local day, `YYYY-MM-DD`, in the profile's zone.
 * @returns the rows this call wrote, both lists empty when the store is already at the current version.
 */
export async function backfillGamification({
  store,
  today,
}: {
  store?: LocalStoreHandle;
  today: string;
}): Promise<GamificationBackfill> {
  const version = await readLocalSchemaVersion({ store });
  if (version !== null && version >= GAMIFICATION_BACKFILL_SCHEMA_VERSION) return { marks: [], awards: [] };
  const [foodLogs, weightEntries, fasts, profile] = await Promise.all([
    listLocalFoodLogs({ store }),
    listLocalWeightEntries({ store }),
    listLocalFasts({ store }),
    getLocalProfileGoals({ store }),
  ]);
  const marks = deriveMarksFromHistory({
    foodLogs,
    weightEntries,
    fasts,
    timeZone: resolveLocalTimezone(profile),
  });
  const { fromDate, toDate } = totalsRange(foodLogs, today);
  const awards = deriveAwardsFromHistory({
    marks,
    dailyTotals: computeDailyTotalsInRange(foodLogs, { fromDate, toDate }),
    netCarbsCeiling: ceilingOf(profile),
    today,
  });
  for (const mark of marks) await putLocalActivityMark({ store, mark });
  for (const award of awards) await putLocalAward({ store, award });
  await stampLocalSchemaVersion({ store });
  return { marks, awards };
}

/**
 * {@link backfillGamification} with the day resolved from the store it is
 * given, for the one caller that has a store but no day: the primary store's
 * own after-load hook (`local-store/persist.ts`).
 *
 * THE STORE IS REQUIRED HERE, not optional. This runs while the singleton's
 * promise is still resolving, so a call that fell back to the singleton would
 * wait on the promise it is part of and hang the whole app on boot.
 *
 * The version is checked before the profile is read, so the boot after this
 * migration costs one store VALUE read and nothing else.
 *
 * @param store - the just-loaded store, passed explicitly.
 * @returns the rows this call wrote, both lists empty when there was nothing to do.
 */
export async function backfillGamificationOnLoad(store: LocalStoreHandle): Promise<GamificationBackfill> {
  const version = await readLocalSchemaVersion({ store });
  if (version !== null && version >= GAMIFICATION_BACKFILL_SCHEMA_VERSION) return { marks: [], awards: [] };
  const timeZone = resolveLocalTimezone(await getLocalProfileGoals({ store }));
  return backfillGamification({ store, today: todayInTimezone(timeZone) });
}
