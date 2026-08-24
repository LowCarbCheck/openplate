/**
 * Regression tests for the durable "this device has had data before" marker
 * (M123 spec 01, item 2).
 *
 * The failure this marker exists to detect: the load/autosave race in
 * `persist.ts` empties the primary store's TABLES partition (`t`) while the
 * VALUES partition (`v`) survives. A `t`-empty store is therefore ambiguous —
 * either a device that never onboarded, or one that just lost its tables — and
 * `_personal.tsx` today reads zero food logs and shows the first-run screen to
 * both. The marker lives in `v` precisely so it outlives the wipe and can tell
 * them apart.
 *
 * So the properties under test are the ones that make it a trustworthy
 * invariant rather than a constant that happens to exist:
 *  1. A device that has never been written to has NO marker (otherwise a
 *     genuinely new device gets misread as a data-loss victim).
 *  2. The FIRST food-log/profile write stamps it, and a later write neither
 *     duplicates nor resets it (it records the first moment, not the last).
 *  3. It is readable with the tables partition emptied — proven against a REAL
 *     `fake-indexeddb`-backed `createIndexedDbPersister` whose `t` object store
 *     is cleared out from underneath it, which is the incident's exact shape.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { createStore } from 'tinybase';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import { createPrimaryStore, HAD_DATA_MARKER_VALUE } from '../../app/lib/local-store/store';
import {
  getFirstDataAt,
  hasEverHadData,
  markDeviceHasData,
  markDeviceHasDataForTable,
  marksDeviceHasData,
} from '../../app/lib/local-store/had-data';
import {
  listLocalFoodLogs,
  patchLocalProfileGoals,
  putLocalFood,
  putLocalFoodLog,
  upsertLocalWeightEntryForDay,
} from '../../app/lib/local-store/primary-store';
import { readPersistedTableRowCounts, totalRowCount } from '../../app/lib/local-store/persist';
import type { LocalFoodLog, LocalPersonalFood } from '../../app/lib/local-store/schema';

const DAY_KEY = '2026-08-24';

/** A complete food log; override any field per test. */
function log(id: string, overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id,
    name: id,
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal: 120 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: DAY_KEY,
    loggedAt: Date.parse(`${DAY_KEY}T12:00:00Z`),
    createdAt: Date.parse(`${DAY_KEY}T12:00:00Z`),
    logBatchId: null,
    ...overrides,
  };
}

/** A complete personal food — one of the writes that deliberately does NOT stamp the marker. */
function food(id: string): LocalPersonalFood {
  return {
    id,
    name: id,
    brand: null,
    macrosPer100g: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal: 120 },
    source: 'user',
    createdAt: Date.parse(`${DAY_KEY}T12:00:00Z`),
  };
}

/**
 * Empties the persisted TABLES object store (`t`) while leaving VALUES (`v`)
 * untouched — the observed shape of the load/autosave clobber, reproduced
 * directly against the real database rather than simulated with a double.
 */
async function emptyPersistedTables(dbName: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(new Error(`open("${dbName}") failed`)));
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('t', 'readwrite');
    transaction.objectStore('t').clear();
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(new Error(`clearing "t" in "${dbName}" failed`)));
  });
  db.close();
}

describe('marksDeviceHasData (pure — which writes count as "this device has data")', () => {
  it('counts a food-log write', () => {
    assert.equal(marksDeviceHasData('foodLogs'), true);
  });

  it('counts a profile/goals write', () => {
    assert.equal(marksDeviceHasData('profileGoals'), true);
  });

  it('does not count writes only reachable from behind those two', () => {
    assert.equal(marksDeviceHasData('personalFoods'), false);
    assert.equal(marksDeviceHasData('weightEntries'), false);
    assert.equal(marksDeviceHasData('fasts'), false);
  });
});

describe('markDeviceHasData (write-once, on a real Store)', () => {
  it('stamps the marker on a store that has never been marked', () => {
    const store = createPrimaryStore();
    markDeviceHasData(store, { now: () => 1_000 });
    assert.equal(store.getValue(HAD_DATA_MARKER_VALUE), 1_000);
  });

  it('never moves the stamp forward on a later call — it records the FIRST moment', () => {
    const store = createPrimaryStore();
    markDeviceHasData(store, { now: () => 1_000 });
    markDeviceHasData(store, { now: () => 9_999 });
    assert.equal(store.getValue(HAD_DATA_MARKER_VALUE), 1_000);
  });

  it('issues no store write at all once the marker is present (idempotent and cheap)', () => {
    const store = createPrimaryStore();
    markDeviceHasData(store, { now: () => 1_000 });
    let writesAfterFirstMark = 0;
    store.addValueListener(HAD_DATA_MARKER_VALUE, () => {
      writesAfterFirstMark += 1;
    });
    markDeviceHasData(store, { now: () => 2_000 });
    markDeviceHasData(store, { now: () => 3_000 });
    assert.equal(writesAfterFirstMark, 0);
  });

  it('leaves a non-marking table alone', () => {
    const store = createPrimaryStore();
    markDeviceHasDataForTable(store, 'personalFoods', { now: () => 1_000 });
    assert.equal(store.getValue(HAD_DATA_MARKER_VALUE), undefined);
  });
});

describe('the marker across the primary-store write paths', () => {
  it('a device that has never written anything has no marker', async () => {
    const store = createPrimaryStore();
    assert.equal(await hasEverHadData({ store }), false);
    assert.equal(await getFirstDataAt({ store }), null);
  });

  it('a personal-food or weight write alone does not mark the device', async () => {
    const store = createPrimaryStore();
    await putLocalFood(food('food-1'), { store });
    await upsertLocalWeightEntryForDay({ dayKey: DAY_KEY, weightKg: 70 }, { store });
    assert.equal(await hasEverHadData({ store }), false);
  });

  it('the FIRST food-log write stamps the marker', async () => {
    const store = createPrimaryStore();
    const before = Date.now();
    await putLocalFoodLog(log('log-1'), { store });
    const after = Date.now();

    assert.equal(await hasEverHadData({ store }), true);
    const firstDataAt = await getFirstDataAt({ store });
    assert.notEqual(firstDataAt, null);
    assert.ok(
      firstDataAt !== null && firstDataAt >= before && firstDataAt <= after,
      "the stamp must be the wall-clock instant of the write, not the log's own createdAt",
    );
  });

  it('a later food-log write neither duplicates nor resets the stamp', async () => {
    const store = createPrimaryStore();
    // Pre-stamp with a sentinel so the assertion is exact rather than
    // millisecond-granularity-dependent.
    markDeviceHasData(store, { now: () => 1_000 });
    await putLocalFoodLog(log('log-1'), { store });
    await putLocalFoodLog(log('log-2'), { store });
    await putLocalFoodLog(log('log-1', { name: 'edited' }), { store });

    assert.equal(await getFirstDataAt({ store }), 1_000);
    assert.equal((await listLocalFoodLogs({ store })).length, 2);
  });

  it('a profile write stamps the marker too — completing onboarding is data', async () => {
    const store = createPrimaryStore();
    await patchLocalProfileGoals({ onboardingCompletedAt: Date.now() }, { store });
    assert.equal(await hasEverHadData({ store }), true);
  });
});

describe('the marker survives a tables wipe (real fake-indexeddb + createIndexedDbPersister)', () => {
  it('is still readable after the "t" object store is emptied and "v" is not', async () => {
    const dbName = `had-data-marker-${Math.random()}`;
    const writer = createStore();
    await putLocalFoodLog(log('log-1'), { store: writer });
    const writerPersister = createIndexedDbPersister(writer, dbName);
    await writerPersister.save();
    await writerPersister.destroy();

    assert.ok(
      totalRowCount(await readPersistedTableRowCounts(dbName)) > 0,
      'precondition: the food log reached the persisted tables partition',
    );

    await emptyPersistedTables(dbName);
    assert.equal(
      totalRowCount(await readPersistedTableRowCounts(dbName)),
      0,
      'precondition: the tables partition is now empty, exactly as the clobber leaves it',
    );

    const reader = createStore();
    const readerPersister = createIndexedDbPersister(reader, dbName);
    await readerPersister.load();
    await readerPersister.destroy();

    assert.equal((await listLocalFoodLogs({ store: reader })).length, 0, 'the tables really are gone');
    assert.equal(
      await hasEverHadData({ store: reader }),
      true,
      'this is a device that LOST its tables, not a device that never had data',
    );
    assert.notEqual(await getFirstDataAt({ store: reader }), null);
  });

  it('a device that genuinely never wrote reads as unmarked through the same path', async () => {
    const dbName = `had-data-marker-fresh-${Math.random()}`;
    const writer = createStore();
    // A store that exists and has been persisted, but was never written to by
    // a user — the case that must NOT be mistaken for data loss.
    const writerPersister = createIndexedDbPersister(writer, dbName);
    await writerPersister.save();
    await writerPersister.destroy();

    const reader = createStore();
    const readerPersister = createIndexedDbPersister(reader, dbName);
    await readerPersister.load();
    await readerPersister.destroy();

    assert.equal(await hasEverHadData({ store: reader }), false);
  });
});
