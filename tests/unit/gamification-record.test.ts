/**
 * The recording seam (M235/04).
 *
 * THE ONE DEFECT THIS FILE EXISTS TO CATCH. A sync pull ends in
 * `applyMergedSnapshot`, which calls `importBackup`, which is why
 * `importSnapshot` passes `origin: 'restore'` on every food log it writes. Had
 * the recorder been hooked into the store layer instead of into the acts, every
 * pull would mark today active on a device nobody touched, and the streak would
 * be a lie on the one screen that asks a person to trust a number. So the first
 * test drives a REAL restore into a REAL store and asserts that nothing was
 * recorded, and carries its control in the same test, on the same store: the
 * action path, run straight afterwards, DOES write the mark. Without that
 * control the first half would pass just as happily against a recorder that had
 * stopped working altogether.
 *
 * The other two claims are the ones that keep the feature cheap and harmless: a
 * repeated signal changes no bytes, so a person who opens the app ten times a
 * day pushes no churn at a peer, and a recorder that throws costs them nothing,
 * because a badge must never cost somebody their food log.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup, importBackup } from '../../app/lib/local-store/backup';
import {
  listLocalActivityMarks,
  listLocalAwards,
  listLocalFoodLogs,
  putLocalFoodLog,
  putLocalProfileGoals,
} from '../../app/lib/local-store/primary-store';
import type { LocalFoodLog, LocalProfileGoals, LocalStoreHandle } from '../../app/lib/local-store';
import { noteActivity, recordActivity } from '../../app/lib/gamification/record';
import { setErrorReporter } from '../../app/lib/report-error';

/**
 * What the swallow reported, as text.
 *
 * SWALLOWED IS NOT SILENT. The call sites must never see a failure here, but a
 * badge that quietly stopped working on every device would be invisible
 * forever, so the wrapper reports before it returns and this is where the
 * proof of that lives.
 */
const reported: string[] = [];
setErrorReporter((cause) => {
  reported.push(String(cause));
});

/**
 * A fixed instant, and the day it falls on in UTC.
 *
 * The profile below pins the zone to UTC for exactly this reason: the day key
 * follows the PROFILE's zone, so a machine running this suite in Los Angeles
 * would otherwise land on the day before and the assertion would be about the
 * runner rather than about the code.
 */
const NOW = 1_763_000_000_000;
const TODAY = '2025-11-13';

/** A profile whose only load-bearing field is the zone. */
const UTC_PROFILE: LocalProfileGoals = {
  timezone: 'UTC',
  goalNetCarbsCeilingG: null,
  goalProteinFloorG: null,
  goalKcalTarget: null,
  targetWeightKg: null,
  trackingFocus: null,
  onboardingCompletedAt: null,
  updatedAt: NOW,
};

/** One ordinary diary entry, the thing a restore carries and a recorder must not react to. */
function foodLog(id: string, dayKey: string): LocalFoodLog {
  return {
    id,
    name: 'Acerola',
    quantityGrams: 50,
    macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
    mealType: 'snack',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: NOW,
    createdAt: NOW,
    logBatchId: null,
  };
}

/** A recorder that always fails, standing in for a store write that went wrong. */
const broken: typeof recordActivity = () => Promise.reject(new Error('the store is on fire'));

/** A store with a UTC profile and nothing else. */
async function emptyDevice(): Promise<LocalStoreHandle> {
  const store = createPrimaryStore();
  await putLocalProfileGoals(UTC_PROFILE, { store });
  return store;
}

describe('the recording seam', () => {
  it('a restore writes no mark, and its control: the action path writes it', async () => {
    // A backup file with a year of dinners in it, built by the real exporter so
    // the envelope is the real shape rather than a hand-written guess.
    const source = createPrimaryStore();
    await putLocalFoodLog(foodLog('log-1', '2025-11-11'), { store: source });
    await putLocalFoodLog(foodLog('log-2', '2025-11-12'), { store: source });
    const envelope = await exportBackup({ store: source });
    assert.equal(envelope.data.foodLogs.length, 2, 'the fixture must carry logs or the restore proves nothing');
    assert.deepEqual(envelope.data.activityMarks, [], 'the file itself must carry no mark for this to be a fair test');

    const device = await emptyDevice();
    await importBackup(envelope, { store: device });

    assert.deepEqual(await listLocalActivityMarks({ store: device }), []);
    assert.equal((await listLocalFoodLogs({ store: device })).length, 2, 'the restore did happen');

    // The control, on the same store, one line later. The restore above wrote
    // two diary days and no mark; this single act writes one mark.
    await noteActivity({ store: device, signal: 'log.food', now: NOW });
    assert.deepEqual(await listLocalActivityMarks({ store: device }), [
      { id: `${TODAY}#log.food`, dayKey: TODAY, signal: 'log.food' },
    ]);
  });

  it('a second call writes nothing', async () => {
    const device = await emptyDevice();
    await noteActivity({ store: device, signal: 'log.food', now: NOW });
    const afterFirst = JSON.stringify(device.getTables());

    await noteActivity({ store: device, signal: 'log.food', now: NOW + 60_000 });
    assert.equal(JSON.stringify(device.getTables()), afterFirst, 'a repeated signal changed bytes');

    // The control that makes the comparison mean something: a DIFFERENT signal
    // on the same day is a different fact, a different row id, and must move.
    await noteActivity({ store: device, signal: 'weight.log', now: NOW });
    assert.notEqual(JSON.stringify(device.getTables()), afterFirst, 'a new signal changed nothing');
  });

  it('a throwing recorder does not fail the log', async () => {
    const device = await emptyDevice();
    // The act the person performed. It is already written when the recorder
    // runs, which is the whole reason the recorder is allowed to be silent.
    await putLocalFoodLog(foodLog('log-1', TODAY), { store: device });

    reported.length = 0;
    const written = await noteActivity({ store: device, signal: 'log.food', now: NOW, record: broken });

    assert.deepEqual(written, [], 'the throw reached the caller');
    assert.equal((await listLocalFoodLogs({ store: device })).length, 1, 'a badge cost somebody their food log');
    assert.deepEqual(reported, ['Error: the store is on fire'], 'the failure was swallowed AND hidden');

    // The control: the injected recorder really does throw, so the assertions
    // above are about the swallow and not about a recorder that quietly worked.
    await assert.rejects(() => broken({ signal: 'log.food', dayKey: TODAY, now: NOW }));
  });

  it('records the explorer award the first time a signal arrives', async () => {
    const device = await emptyDevice();
    const written = await noteActivity({ store: device, signal: 'pantry.edit', now: NOW });

    assert.deepEqual(
      written.map((award) => award.key),
      ['explorer.pantry.edit'],
    );
    assert.deepEqual(await listLocalAwards({ store: device }), [
      { key: 'explorer.pantry.edit', earnedAt: NOW, earnedOnDay: TODAY, seenAt: null },
    ]);
  });
});
