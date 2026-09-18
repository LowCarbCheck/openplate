/**
 * The backfill migration (M235/05).
 *
 * TWO CLAIMS ARE WORTH A TEST FILE, and the rest of this file exists to keep
 * them honest.
 *
 * The first is the one the milestone is FOR: somebody who has logged every day
 * for two years must read two years when they open the build that ships the
 * streak, not "1". Nothing recorded a mark before this build, so the number can
 * only come from the diary they already have.
 *
 * The second is the one that decides whether the first is a gift or an assault.
 * A two-year diary earns six badges at once, and a build that announced all six
 * on first launch would be congratulating a person for opening the app. Every
 * backfilled award is therefore stamped as already seen, and the control for
 * that assertion lives here too: an award earned TODAY, by an act, through the
 * real evaluation, still arrives unseen and still fires.
 *
 * The determinism test is the third leg. The marks are written per device
 * rather than by a coordinated migration, so a phone and a tablet holding the
 * same diary have to derive the same rows down to the byte, or the merge would
 * have something to argue about that no design here ever resolves.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shiftDate } from '../../app/lib/user-days';
import { createPrimaryStore, SCHEMA_VERSION_VALUE } from '../../app/lib/local-store/store';
import {
  listLocalActivityMarks,
  listLocalAwards,
  putLocalFoodLog,
  putLocalProfileGoals,
  putLocalWeightEntry,
  readLocalSchemaVersion,
} from '../../app/lib/local-store/primary-store';
import type {
  LocalAward,
  LocalFast,
  LocalFoodLog,
  LocalProfileGoals,
  LocalStoreHandle,
  LocalWeightEntry,
} from '../../app/lib/local-store';
import {
  backfillGamification,
  deriveAwardsFromHistory,
  deriveMarksFromHistory,
} from '../../app/lib/gamification/backfill';
import { evaluateAwards } from '../../app/lib/gamification/evaluate';
import { activeDayKeys, computeActiveStreak } from '../../app/lib/gamification/streak';

/** The day every case below is anchored on. Fixed, so the suite reads the same in every zone and every month. */
const TODAY = '2026-09-18';

/** How long the person in the first test has been keeping their diary. */
const HISTORY_DAYS = 730;

/** A fixed instant for the rows that need one. Nothing here derives a day from it. */
const NOW = 1_789_000_000_000;

/** UTC midnight of a day key, the instant a backfilled award is stamped with. */
function dayStartUtcMs(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** A profile whose only load-bearing field is the zone, so a day key never follows the runner's machine. */
function utcProfile(goalNetCarbsCeilingG: number | null): LocalProfileGoals {
  return {
    timezone: 'UTC',
    goalNetCarbsCeilingG,
    goalProteinFloorG: null,
    goalKcalTarget: null,
    targetWeightKg: null,
    trackingFocus: null,
    onboardingCompletedAt: null,
    updatedAt: NOW,
  };
}

/** One ordinary diary entry on `dayKey`. `netCarbs` is what the on-plan walk reads. */
function foodLog(id: string, dayKey: string, { netCarbs = 5, aiEstimated = false } = {}): LocalFoodLog {
  return {
    id,
    name: 'Acerola',
    quantityGrams: 100,
    macros: { carbs: netCarbs, fiber: 0, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
    mealType: 'snack',
    source: 'manual',
    aiEstimated,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: NOW,
    createdAt: NOW,
    logBatchId: null,
  };
}

/** One weigh-in on `dayKey`. */
function weightEntry(id: string, dayKey: string): LocalWeightEntry {
  return { id, dayKey, weightKg: 74.2, loggedAt: NOW, createdAt: NOW };
}

/** A finished fast, spanning `startMs` to `endMs`. */
function fast(id: string, startMs: number, endMs: number | null): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 16 * 60 * 60 * 1000,
    plannedStartAt: null,
    startedAt: startMs,
    endedAt: endMs,
    createdAt: startMs,
  };
}

/** A diary logged every day for `days` days, ending on `TODAY`. */
function everyDayFor(days: number): LocalFoodLog[] {
  const logs: LocalFoodLog[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const dayKey = shiftDate(TODAY, -back);
    logs.push(foodLog(`log-${dayKey}`, dayKey));
  }
  return logs;
}

/** The marks a food-log-only diary implies. The zone is irrelevant to a log, which carries its own day key. */
function marksFor(foodLogs: readonly LocalFoodLog[]) {
  return deriveMarksFromHistory({ foodLogs, weightEntries: [], fasts: [], timeZone: 'UTC' });
}

/** The current activity streak the derived marks produce, read through the real walk. */
function streakFor(foodLogs: readonly LocalFoodLog[]): number {
  return computeActiveStreak({ activeDays: activeDayKeys(marksFor(foodLogs)), today: TODAY });
}

/**
 * The awards that would still fire a note.
 *
 * THE ONE PREDICATE both the claim and its control are measured with, so
 * neither can drift into asking a different question from the other.
 */
function stillFires(awards: readonly LocalAward[]): LocalAward[] {
  return awards.filter((award) => award.seenAt === null);
}

/**
 * A store carrying a profile and nothing else, stamped as a device that last
 * ran the build BEFORE this one.
 *
 * THE STAMP IS THE FIXTURE, not a convenience. Every store verb records the
 * current schema version as it writes, so seeding a device through the real
 * verbs produces a store that says it has already been migrated, and the
 * migration under test would correctly decline to run on it. A real device
 * arriving at this build has its rows from an older one and the older number
 * on disk, which is what this line reproduces.
 */
async function deviceFromTheOldBuild(ceiling: number | null = null): Promise<LocalStoreHandle> {
  const store = createPrimaryStore();
  await putLocalProfileGoals(utcProfile(ceiling), { store });
  store.setValue(SCHEMA_VERSION_VALUE, 22);
  return store;
}

describe('the backfill', () => {
  it('rebuilds the real streak from a two-year diary', () => {
    assert.equal(streakFor(everyDayFor(HISTORY_DAYS)), HISTORY_DAYS);

    // THE CONTROL FOR THE NUMBER. Without it the assertion above would pass
    // just as happily against a walk that returned the mark COUNT, or the day
    // span, or anything else that happens to be 730 for an unbroken diary. A
    // diary with one day missing in the middle must read as the run since the
    // gap, and nothing longer.
    const withAGap = everyDayFor(HISTORY_DAYS).filter((log) => log.dayKey !== shiftDate(TODAY, -9));
    assert.equal(streakFor(withAGap), 9, 'a gap did not break the run, so the number is not a streak');
  });

  it('fires no note for a past award, however long the history is', () => {
    const foodLogs = everyDayFor(HISTORY_DAYS);
    const marks = marksFor(foodLogs);

    const awards = deriveAwardsFromHistory({ marks, dailyTotals: [], netCarbsCeiling: null, today: TODAY });

    assert.deepEqual(
      awards.map((award) => award.key),
      [
        'explorer.log.food',
        'streak.active.3',
        'streak.active.7',
        'streak.active.14',
        'streak.active.30',
        'streak.active.100',
      ],
      'two years of daily logging earned a different set than the catalog says it should',
    );
    assert.deepEqual(stillFires(awards), [], 'a backfilled award would announce itself on the first run');
    for (const award of awards) {
      assert.equal(award.seenAt, award.earnedAt, `${award.key} was seen at a different instant from its earning`);
    }
  });

  it('dates a past award to the day it was actually earned, never to today', () => {
    const foodLogs = everyDayFor(HISTORY_DAYS);

    const awards = deriveAwardsFromHistory({
      marks: marksFor(foodLogs),
      dailyTotals: [],
      netCarbsCeiling: null,
      today: TODAY,
    });
    const threeDays = awards.find((award) => award.key === 'streak.active.3');

    // The third day of the diary, which is 727 days ago, not today.
    const earnedOnDay = shiftDate(TODAY, -(HISTORY_DAYS - 3));
    assert.deepEqual(threeDays, {
      key: 'streak.active.3',
      earnedAt: dayStartUtcMs(earnedOnDay),
      earnedOnDay,
      seenAt: dayStartUtcMs(earnedOnDay),
    });
  });

  it('control: a fresh award fires, because an act TODAY is not history', () => {
    // THE CONTROL FOR THE TWO TESTS ABOVE, run through the real evaluation
    // rather than a hand-built row. If `stillFires` had quietly become a
    // predicate that matches nothing, this line would go red: an award earned
    // by an act right now is exactly the one that must still reach the person.
    const fresh = evaluateAwards({
      marks: [{ id: `${TODAY}#weight.log`, dayKey: TODAY, signal: 'weight.log' }],
      activeStreak: 1,
      onPlanStreak: null,
      earnedKeys: [],
      today: TODAY,
      now: NOW,
    });

    assert.deepEqual(
      stillFires(fresh).map((award) => award.key),
      ['explorer.weight.log'],
    );
  });

  it('is deterministic: the same rows in any order derive the same bytes', () => {
    const foodLogs = everyDayFor(30);
    const weightEntries = [weightEntry('w-1', shiftDate(TODAY, -3))];
    const fasts = [fast('f-1', Date.UTC(2026, 8, 10, 20), Date.UTC(2026, 8, 13, 20))];

    const forward = deriveMarksFromHistory({ foodLogs, weightEntries, fasts, timeZone: 'UTC' });
    const backward = deriveMarksFromHistory({
      foodLogs: foodLogs.toReversed(),
      weightEntries,
      fasts,
      timeZone: 'UTC',
    });

    assert.equal(JSON.stringify(backward), JSON.stringify(forward), 'two devices would derive different marks');
    // The control for the comparison: the fixture really does carry all four
    // derivable signals, so a stringify that matched on two empty lists would
    // not be what just passed.
    assert.deepEqual([...new Set(forward.map((mark) => mark.signal))].toSorted(), [
      'fast.run',
      'log.food',
      'weight.log',
    ]);
  });

  it('credits every local day a fast crossed, and nothing to a fast still running', () => {
    const crossed = deriveMarksFromHistory({
      foodLogs: [],
      weightEntries: [],
      // 20:00 on the 10th to 20:00 on the 13th: 72 hours, four local days
      // touched, which is the intersection the fasting screen already reports.
      fasts: [fast('f-1', Date.UTC(2026, 8, 10, 20), Date.UTC(2026, 8, 13, 20))],
      timeZone: 'UTC',
    });

    assert.deepEqual(
      crossed.map((mark) => mark.dayKey),
      ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'],
    );

    // A fast that has not ended has no derivable end, so it credits the day it
    // began and no more. The days it goes on to cover are recorded as they
    // happen, by the recorder.
    const running = deriveMarksFromHistory({
      foodLogs: [],
      weightEntries: [],
      fasts: [fast('f-2', Date.UTC(2026, 8, 10, 20), null)],
      timeZone: 'UTC',
    });
    assert.deepEqual(
      running.map((mark) => mark.dayKey),
      ['2026-09-10'],
    );
  });

  it('derives only the four signals the diary records', () => {
    const marks = deriveMarksFromHistory({
      foodLogs: [foodLog('log-1', TODAY, { aiEstimated: true })],
      weightEntries: [weightEntry('w-1', TODAY)],
      fasts: [fast('f-1', Date.UTC(2026, 8, 18, 6), Date.UTC(2026, 8, 18, 18))],
      timeZone: 'UTC',
    });

    assert.deepEqual(
      marks.map((mark) => mark.signal).toSorted(),
      ['fast.run', 'log.food', 'log.scan', 'weight.log'],
      'the diary records four things a person did, and the migration must invent no fifth',
    );
  });
});

describe('the backfill over a real store', () => {
  it('writes the history once, and a second run writes nothing', async () => {
    const device = await deviceFromTheOldBuild();
    for (const log of everyDayFor(10)) await putLocalFoodLog(log, { store: device });
    await putLocalWeightEntry(weightEntry('w-1', shiftDate(TODAY, -2)), { store: device });
    device.setValue(SCHEMA_VERSION_VALUE, 22);

    const first = await backfillGamification({ store: device, today: TODAY });
    assert.equal(first.marks.length, 11, 'ten logged days and one weigh-in');
    assert.deepEqual(stillFires(await listLocalAwards({ store: device })), [], 'a stored award would fire a note');
    assert.equal(await readLocalSchemaVersion({ store: device }), 23, 'the store was not stamped as migrated');

    const afterFirst = JSON.stringify(device.getTables());
    const second = await backfillGamification({ store: device, today: TODAY });

    assert.deepEqual(second, { marks: [], awards: [] }, 'the second run derived the history all over again');
    assert.equal(JSON.stringify(device.getTables()), afterFirst, 'the second run changed bytes');
    // The control: the first run really did write, so the byte comparison above
    // is about a migration that ran once and not about one that never ran.
    assert.equal((await listLocalActivityMarks({ store: device })).length, 11);
  });

  it('earns an on-plan award only when a ceiling is set', async () => {
    const onPlanKeys = async (ceiling: number | null): Promise<string[]> => {
      const device = await deviceFromTheOldBuild(ceiling);
      for (const log of everyDayFor(10)) await putLocalFoodLog(log, { store: device });
      device.setValue(SCHEMA_VERSION_VALUE, 22);
      const { awards } = await backfillGamification({ store: device, today: TODAY });
      return awards.filter((award) => award.key.startsWith('onplan.')).map((award) => award.key);
    };

    assert.deepEqual(await onPlanKeys(20), ['onplan.7'], 'ten days at 5 g against a 20 g ceiling earned nothing');
    // A person who set no ceiling has nothing to be on plan with, and is told
    // nothing about it.
    assert.deepEqual(await onPlanKeys(null), []);
  });

  it('leaves a store that is already at the current version alone', async () => {
    const device = await deviceFromTheOldBuild();
    // Writing a log stamps the current schema version, which is what a device
    // that has already run this build looks like.
    await putLocalFoodLog(foodLog('log-1', TODAY), { store: device });

    const written = await backfillGamification({ store: device, today: TODAY });

    assert.deepEqual(written, { marks: [], awards: [] });
    assert.deepEqual(await listLocalActivityMarks({ store: device }), []);
  });
});
