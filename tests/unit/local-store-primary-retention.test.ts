/**
 * Regression test for the M117/01 data-loss fix: the local store is now the
 * PRIMARY source of truth, so a write must NEVER evict older entries. Before the
 * inversion, `putDiarySnapshot` pruned the mirror to a 30-day window on every
 * write — promoting that onto primary storage would silently delete day-31+
 * data. These tests drive the primary-store CRUD against a REAL in-memory
 * TinyBase store (no IndexedDB persister) and assert that entries far older than
 * the former 30-day window survive any number of subsequent writes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Store } from 'tinybase';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { listLocalFoodLogs, listLocalFoodLogsForDay, putLocalFoodLog } from '../../app/lib/local-store/primary-store';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';
import { shiftDate } from '../../app/lib/user-days';

const TODAY = '2026-07-14';

/** A complete food log for `dayKey`; override any field per test. */
function log(id: string, dayKey: string, overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
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
    dayKey,
    loggedAt: Date.parse(`${dayKey}T12:00:00Z`),
    createdAt: Date.parse(`${dayKey}T12:00:00Z`),
    logBatchId: null,
    ...overrides,
  };
}

describe('primary store retention', () => {
  it('keeps entries far older than the former 30-day mirror window after a new write', async () => {
    const store = createPrimaryStore();
    await putLocalFoodLog(log('old-40', shiftDate(TODAY, -40)), { store });
    await putLocalFoodLog(log('old-90', shiftDate(TODAY, -90)), { store });

    // A fresh write for today must not evict either far-older entry.
    await putLocalFoodLog(log('today', TODAY), { store });

    const ids = (await listLocalFoodLogs({ store })).map((entry) => entry.id).toSorted();
    assert.deepEqual(ids, ['old-40', 'old-90', 'today']);
  });

  it('a write to one day never deletes another day’s entries (no window eviction)', async () => {
    const store = createPrimaryStore();
    const ancientDay = shiftDate(TODAY, -365);
    await putLocalFoodLog(log('ancient', ancientDay), { store });

    // Hammer many writes for the current day — the old day must be untouched.
    for (let index = 0; index < 50; index++) {
      await putLocalFoodLog(log(`t-${index}`, TODAY), { store });
    }

    const ancient = await listLocalFoodLogsForDay(ancientDay, { store });
    assert.equal(ancient.length, 1);
    assert.equal(ancient[0].id, 'ancient');
    assert.equal((await listLocalFoodLogsForDay(TODAY, { store })).length, 50);
  });

  it('reads a far-older entry back intact (lossless JSON round-trip through the store)', async () => {
    const store = createPrimaryStore();
    const original = log('old-60', shiftDate(TODAY, -60), {
      macros: { carbs: 12.5, fiber: null, sugars: null, polyols: 1.5, protein: 0, fat: null, kcal: 210 },
      curatedSource: 'lowcarbcheck:acerola',
      logBatchId: 'batch-1',
    });
    await putLocalFoodLog(original, { store });
    await putLocalFoodLog(log('today', TODAY), { store });

    const roundTripped = (await listLocalFoodLogs({ store })).find((entry) => entry.id === 'old-60');
    assert.deepEqual(roundTripped, original);
  });

  it('accepts an injected store so callers never touch IndexedDB in tests', async () => {
    // The store is injectable exactly so the pure retention behaviour is testable.
    const store: Store = createPrimaryStore();
    await putLocalFoodLog(log('a', TODAY), { store });
    assert.equal((await listLocalFoodLogs({ store })).length, 1);
  });
});
