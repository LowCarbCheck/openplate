/**
 * The recording seam (M235/04).
 *
 * Every other module under `app/lib/gamification/` is pure. This one is the
 * imperative shell around them: it writes the mark, runs the evaluation and
 * writes whatever the evaluation says is newly true.
 *
 * WHERE IT MAY BE CALLED FROM, and why the rule is this sharp. A sync pull
 * ends in `applyMergedSnapshot`, which calls `importBackup`, which is why
 * `importSnapshot` passes `origin: 'restore'` on every food log it writes. A
 * recorder wired into `primary-store.ts` would therefore mark today active on
 * a device nobody touched, once per pull, and the streak would stop meaning
 * what it says. So this module is called from route `clientAction` code and
 * from confirmed user acts, and from nothing in `app/lib/local-store/` or
 * `app/lib/sync/`. A verification command greps both directories for the name.
 *
 * {@link reconcileAwards} is the one thing a pull MAY run, because pulled
 * marks can complete a threshold this device has not noticed yet. It writes no
 * mark, so it makes no claim about what happened here today.
 *
 * NO CLOCK IS READ HERE. `dayKey` and `now` both arrive as arguments, which
 * keeps the directory's "every clock is an argument" rule (M235/01) intact and
 * lets a test stamp a deterministic day. {@link noteActivity} is the one place
 * a day key is derived, and it derives it from the PROFILE's zone, never the
 * device's, so two devices belonging to one person agree on where a day ends.
 */
import { shiftDate, todayInTimezone } from '#app/lib/user-days';
import {
  computeStreak,
  getLocalDailyTotalsInRange,
  getLocalProfileGoals,
  listLocalActivityMarks,
  listLocalAwards,
  putLocalActivityMark,
  putLocalAward,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalAward, LocalStoreHandle } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';

import type { ActivitySignal } from './catalog';
import { evaluateAwards } from './evaluate';
import { markId } from './marks';
import { activeDayKeys, computeActiveStreak } from './streak';

/**
 * How far back the on-plan walk reads the diary.
 *
 * The longest `onplan` threshold is 100 days, so the window has to cover that
 * run and a little more, and nothing is gained by reading a decade of logs on
 * every food entry. A run longer than the window is simply reported as the
 * window, which is still above every threshold in the catalog.
 */
const ON_PLAN_LOOKBACK_DAYS = 120;

/** What the two writing verbs share: which device store, and which day it is. */
interface ActivityDay {
  /** The store to write into. Omitted everywhere but a test, where it is the whole point. */
  store?: LocalStoreHandle;
  /** The person's current local day, `YYYY-MM-DD`, in the profile's zone. */
  dayKey: string;
  /** The caller's clock reading, epoch milliseconds, stamped on anything newly earned. */
  now: number;
}

/**
 * The current run of days at or under the net-carb ceiling, or null.
 *
 * Null when no ceiling is set, and the log read is skipped entirely in that
 * case: with no ceiling there is nothing to be on plan with, the whole
 * `onplan` family stays silent, and a person who never set one pays nothing
 * for it on every entry they log.
 */
async function readOnPlanStreak({
  store,
  dayKey,
  netCarbsCeiling,
}: {
  store?: LocalStoreHandle;
  dayKey: string;
  netCarbsCeiling: number | null;
}): Promise<number | null> {
  if (netCarbsCeiling === null) return null;
  const dailyTotals = await getLocalDailyTotalsInRange({
    fromDate: shiftDate(dayKey, -ON_PLAN_LOOKBACK_DAYS),
    toDate: dayKey,
    store,
  });
  return computeStreak(dailyTotals, { netCarbsCeiling });
}

/**
 * Runs the award evaluation and writes what is newly earned. Writes NO mark.
 *
 * Called after a sync pull completes, because a pull can be what completes a
 * streak: the marks that finish a run may have been made on a phone, and the
 * tablet that receives them has to be able to notice.
 *
 * The on-plan walk ends on `dayKey` whether or not `dayKey` has logs yet, so a
 * run whose last day is not logged reads one short until it is. That direction
 * is chosen deliberately. An award is never revoked, so an over-count is
 * permanent and unfixable, while an under-count corrects itself the moment the
 * day is logged, which is the same act that calls this function again.
 *
 * @param options.store - the store to write into, the primary store by default.
 * @param options.dayKey - the person's current local day, `YYYY-MM-DD`.
 * @param options.now - the caller's clock reading, epoch milliseconds.
 * @returns the awards this call wrote, in catalog order, empty when nothing is new.
 */
export async function reconcileAwards({ store, dayKey, now }: ActivityDay): Promise<LocalAward[]> {
  const [marks, held, profile] = await Promise.all([
    listLocalActivityMarks({ store }),
    listLocalAwards({ store }),
    getLocalProfileGoals({ store }),
  ]);
  const earned = evaluateAwards({
    marks,
    activeStreak: computeActiveStreak({ activeDays: activeDayKeys(marks), today: dayKey }),
    onPlanStreak: await readOnPlanStreak({
      store,
      dayKey,
      netCarbsCeiling: profile?.goalNetCarbsCeilingG ?? null,
    }),
    earnedKeys: held.map((award) => award.key),
    today: dayKey,
    now,
  });
  for (const award of earned) await putLocalAward({ store, award });
  return earned;
}

/**
 * Records that `dayKey` carried `signal`, then evaluates the awards.
 *
 * The mark write is write-once by id in the store, so a person who fires the
 * same signal ten times in one day writes it once and the nine repeats change
 * no bytes. The evaluation still runs on every call, because it is byte-neutral
 * when nothing is new and because a mark pulled from another device between two
 * calls can be what makes something true.
 *
 * MAY THROW. Every call site wraps it, {@link noteActivity} is that wrapper.
 *
 * @param options.store - the store to write into, the primary store by default.
 * @param options.signal - the act the person just performed.
 * @param options.dayKey - the person's current local day, `YYYY-MM-DD`.
 * @param options.now - the caller's clock reading, epoch milliseconds.
 * @returns the awards this call wrote, so the caller can show a note.
 */
export async function recordActivity({
  store,
  signal,
  dayKey,
  now,
}: ActivityDay & { signal: ActivitySignal }): Promise<LocalAward[]> {
  await putLocalActivityMark({ store, mark: { id: markId(dayKey, signal), dayKey, signal } });
  return reconcileAwards({ store, dayKey, now });
}

/** Today in the profile's zone, falling back to the device's when no profile zone is set. */
async function resolveActivityDayKey({ store, now }: { store?: LocalStoreHandle; now: number }): Promise<string> {
  return todayInTimezone(resolveLocalTimezone(await getLocalProfileGoals({ store })), new Date(now));
}

/**
 * The seam the seven call sites use: derive today, record, and never let any of
 * it reach the person.
 *
 * A BADGE MUST NEVER COST SOMEBODY THEIR FOOD LOG. Everything here runs after
 * the act it observes has already been written, so a failure is reported and
 * swallowed rather than thrown back into an action that has nothing left to
 * undo.
 *
 * NAMED WITHOUT THE WORD "record" ON PURPOSE. The pull-side sibling below is
 * called from `app/lib/sync/`, and a shared prefix would eventually carry the
 * banned name into a directory a verification command greps.
 *
 * @param options.store - the store to write into, the primary store by default.
 * @param options.signal - the act the person just performed.
 * @param options.now - the caller's clock reading, epoch milliseconds.
 * @param options.record - the recorder, injected only by the test that proves a throw here is harmless.
 * @returns the awards newly earned, or an empty list when anything at all went wrong.
 */
export async function noteActivity({
  store,
  signal,
  now,
  record = recordActivity,
}: {
  store?: LocalStoreHandle;
  signal: ActivitySignal;
  now: number;
  record?: typeof recordActivity;
}): Promise<LocalAward[]> {
  try {
    return await record({ store, signal, dayKey: await resolveActivityDayKey({ store, now }), now });
  } catch (error) {
    reportError(error, { boundary: 'gamification-note-activity', signal });
    return [];
  }
}

/**
 * The same evaluation after a sync pull, derived day and all, equally silent.
 *
 * A cycle that pulled a peer's marks and then failed on a badge would be a sync
 * failure reported for something that is not sync, so this swallows for the
 * same reason {@link noteActivity} does.
 *
 * @param options.store - the store to write into, the primary store by default.
 * @param options.now - the caller's clock reading, epoch milliseconds.
 * @returns the awards newly earned, or an empty list when anything at all went wrong.
 */
export async function reconcileAwardsQuietly({
  store,
  now,
}: {
  store?: LocalStoreHandle;
  now: number;
}): Promise<LocalAward[]> {
  try {
    return await reconcileAwards({ store, dayKey: await resolveActivityDayKey({ store, now }), now });
  } catch (error) {
    reportError(error, { boundary: 'gamification-reconcile-awards' });
    return [];
  }
}
