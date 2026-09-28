/**
 * The bounded food-log read (`listLocalFoodLogsInRange`) and the earliest-day
 * read (`getEarliestLocalFoodLogDayKey`), both answered from the in-memory
 * day index in `app/lib/local-store/primary-store.ts` (M239/01).
 *
 * THE CONTROLS SIT ONE DAY OUTSIDE EACH END. A read that ignored its bounds,
 * or that was off by one at either end, returns one of them, so every range
 * assertion below compares the WHOLE id list rather than asking whether the
 * wanted rows are present.
 *
 * THE INDEX IS BUILT ONCE AND THEN KEPT CURRENT. A lazily built index that
 * only saw the rows present at its first read would pass the first test and
 * still show a stale diary, so the second test writes, moves and deletes rows
 * AFTER the first read and reads again.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from 'tinybase';

import {
  deleteLocalFoodLog,
  getEarliestLocalFoodLogDayKey,
  listLocalFoodLogs,
  listLocalFoodLogsInRange,
  putLocalFoodLog,
} from '../../app/lib/local-store/primary-store';
import { FOOD_LOGS_TABLE, PRIMARY_ENTITY_CELL } from '../../app/lib/local-store/store';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

/** The window every range test reads. */
const RANGE = { fromDate: '2026-07-10', toDate: '2026-07-12' };

/** A minimal food log on `dayKey`, created at `createdAt` so the order is known. */
function foodLog({ id, dayKey, createdAt }: { id: string; dayKey: string; createdAt: number }): LocalFoodLog {
  return {
    id,
    name: id,
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 0, sugars: null, polyols: 0, protein: 0, fat: 0, kcal: null },
    mealType: null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: createdAt,
    createdAt,
    logBatchId: null,
  };
}

/** Writes logs through the real put, as a restore, so no pulse is reported from a test. */
async function seed(store: ReturnType<typeof createStore>, logs: readonly LocalFoodLog[]): Promise<void> {
  for (const log of logs) await putLocalFoodLog(log, { store, origin: 'restore' });
}

/** The ids a bounded read returns, in its order. */
async function idsInRange(store: ReturnType<typeof createStore>): Promise<string[]> {
  return (await listLocalFoodLogsInRange(RANGE, { store })).map((log) => log.id);
}

describe('listLocalFoodLogsInRange', () => {
  it('returns both boundary days and neither control one day outside', async () => {
    const store = createStore();
    await seed(store, [
      foodLog({ id: 'before', dayKey: '2026-07-09', createdAt: 1 }),
      foodLog({ id: 'first', dayKey: '2026-07-10', createdAt: 2 }),
      foodLog({ id: 'middle', dayKey: '2026-07-11', createdAt: 3 }),
      foodLog({ id: 'last', dayKey: '2026-07-12', createdAt: 4 }),
      foodLog({ id: 'after', dayKey: '2026-07-13', createdAt: 5 }),
    ]);

    assert.deepEqual(await idsInRange(store), ['first', 'middle', 'last']);
    // The unbounded read still sees the controls, so their absence above is the
    // bound at work and not a seed that never landed.
    assert.equal((await listLocalFoodLogs({ store })).length, 5);
  });

  it('keeps the order the whole read uses, oldest created first, across days', async () => {
    const store = createStore();
    // Written out of day order and out of creation order on purpose.
    await seed(store, [
      foodLog({ id: 'late-created-early-day', dayKey: '2026-07-10', createdAt: 30 }),
      foodLog({ id: 'early-created-late-day', dayKey: '2026-07-12', createdAt: 10 }),
      foodLog({ id: 'middle', dayKey: '2026-07-11', createdAt: 20 }),
    ]);

    const whole = (await listLocalFoodLogs({ store })).map((log) => log.id);
    assert.deepEqual(await idsInRange(store), whole);
  });

  it('follows writes, moves and deletes made after the index was first built', async () => {
    const store = createStore();
    await seed(store, [
      foodLog({ id: 'stays', dayKey: '2026-07-10', createdAt: 1 }),
      foodLog({ id: 'moves-out', dayKey: '2026-07-11', createdAt: 2 }),
      foodLog({ id: 'deleted', dayKey: '2026-07-12', createdAt: 3 }),
      foodLog({ id: 'moves-in', dayKey: '2026-07-20', createdAt: 4 }),
    ]);
    assert.deepEqual(await idsInRange(store), ['stays', 'moves-out', 'deleted']);

    await seed(store, [
      foodLog({ id: 'moves-out', dayKey: '2026-07-13', createdAt: 2 }),
      foodLog({ id: 'moves-in', dayKey: '2026-07-11', createdAt: 4 }),
      foodLog({ id: 'new', dayKey: '2026-07-12', createdAt: 5 }),
    ]);
    await deleteLocalFoodLog('deleted', { store });

    assert.deepEqual(await idsInRange(store), ['stays', 'moves-in', 'new']);
  });

  it('skips a corrupt row the way the whole read skips it', async () => {
    const store = createStore();
    await seed(store, [foodLog({ id: 'good', dayKey: '2026-07-11', createdAt: 1 })]);
    store.setRow(FOOD_LOGS_TABLE, 'corrupt', { [PRIMARY_ENTITY_CELL]: '{not json' });

    assert.deepEqual(await idsInRange(store), ['good']);
    assert.deepEqual(
      (await listLocalFoodLogs({ store })).map((log) => log.id),
      ['good'],
    );
  });
});

describe('getEarliestLocalFoodLogDayKey', () => {
  it('is null for a diary with no logs', async () => {
    assert.equal(await getEarliestLocalFoodLogDayKey({ store: createStore() }), null);
  });

  it('names the oldest day, whatever order the logs were written in, and moves when it is deleted', async () => {
    const store = createStore();
    await seed(store, [
      foodLog({ id: 'middle', dayKey: '2026-03-15', createdAt: 1 }),
      foodLog({ id: 'oldest', dayKey: '2025-11-02', createdAt: 2 }),
      foodLog({ id: 'newest', dayKey: '2026-07-01', createdAt: 3 }),
    ]);
    assert.equal(await getEarliestLocalFoodLogDayKey({ store }), '2025-11-02');

    await deleteLocalFoodLog('oldest', { store });
    assert.equal(await getEarliestLocalFoodLogDayKey({ store }), '2026-03-15');
  });
});
