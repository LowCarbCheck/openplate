/**
 * The saved-meals/sync boundary (M123/07 + M123/13 review finding 6):
 * `mergeSnapshots` must leave `savedMeals` EXACTLY as the local device holds
 * them, no matter what the remote payload says — the identical mechanism
 * `sync-fasts-passthrough.test.ts` already pins for `fasts`, one entity over.
 *
 * Saved meals are deliberately absent from `SYNC_ENTITY_TYPES` and
 * `flattenSnapshot`, so they are never stamped, diffed, tombstoned or adopted
 * from another device. Unlike fasts there is no hard cross-device invariant
 * blocking a real merge here — this is simply not built yet (see
 * `snapshot-sync.ts`'s comment above `mergeSnapshots`'s return).
 *
 * The failure mode this file exists to catch is silent: a bare
 * `savedMeals: []` in the merge result would EMPTY a device's saved meals on
 * the very first sync, with nothing else in the suite failing — `fasts` had
 * exactly this test and saved meals did not, until this file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots, SYNC_ENTITY_TYPES, stampSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalSavedMeal, LocalStoreSnapshot } from '../../app/lib/local-store/schema';

function savedMeal(id: string, overrides: Partial<LocalSavedMeal> = {}): LocalSavedMeal {
  return {
    id,
    name: `Meal ${id}`,
    items: [
      {
        name: 'Eggs',
        quantityGrams: 120,
        macros: { carbs: 1, fiber: 0, sugars: 0, polyols: null, protein: 12, fat: 10, kcal: 150 },
        source: 'manual',
        aiEstimated: false,
        curatedSource: null,
        foodId: null,
      },
    ],
    createdAt: 1000,
    ...overrides,
  };
}

function snapshot(savedMeals: LocalSavedMeal[]): LocalStoreSnapshot {
  // `fasts` rides through the same pass-through path as `savedMeals` (see
  // `snapshot-sync.ts`) — an empty array here is enough, since this file's
  // assertions are all about `savedMeals`, not fasts.
  return { foods: [], foodLogs: [], weightEntries: [], profile: null, fasts: [], savedMeals };
}

function payload(savedMeals: LocalSavedMeal[]): StampedSnapshot {
  return { snapshot: snapshot(savedMeals), meta: { perEntity: {}, tombstones: [] } };
}

describe('mergeSnapshots and savedMeals', () => {
  it('keeps the local saved meals when the remote payload has none', () => {
    const local = payload([savedMeal('mine')]);

    const merged = mergeSnapshots({ local, remote: payload([]) });

    assert.deepEqual(merged.snapshot.savedMeals, [savedMeal('mine')]);
  });

  it('ignores the remote saved meals entirely — nothing is adopted across devices', () => {
    const local = payload([savedMeal('mine')]);
    const remote = payload([savedMeal('theirs', { name: 'Their meal' })]);

    const merged = mergeSnapshots({ local, remote });

    assert.deepEqual(
      merged.snapshot.savedMeals.map((entry) => entry.id),
      ['mine'],
      "a peer's saved meal must never appear on this device",
    );
  });

  it('keeps an empty local list empty even when the remote is full', () => {
    const merged = mergeSnapshots({ local: payload([]), remote: payload([savedMeal('theirs')]) });

    assert.deepEqual(merged.snapshot.savedMeals, []);
  });

  it('is stable under repeated merges — no drift, no accumulation', () => {
    const local = payload([savedMeal('mine'), savedMeal('other', { name: 'Other meal' })]);
    const remote = payload([savedMeal('theirs')]);

    const once = mergeSnapshots({ local, remote });
    const twice = mergeSnapshots({ local: once, remote });

    assert.deepEqual(twice.snapshot.savedMeals, local.snapshot.savedMeals);
  });

  it('never stamps or tombstones a saved meal — no saved-meal id reaches the wire meta', () => {
    // `flattenSnapshot` is private, so this asserts the observable
    // consequence: stamping a snapshot that holds a saved meal produces no
    // entity key for it, and deleting it later therefore produces no
    // tombstone either.
    const stamped = stampSnapshot({
      snapshot: snapshot([savedMeal('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    assert.deepEqual(Object.keys(stamped.meta.perEntity), []);
    assert.deepEqual(stamped.meta.tombstones, []);

    const afterDelete = stampSnapshot({
      snapshot: snapshot([]),
      baseline: stamped.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(afterDelete.meta.tombstones, [], 'a removed saved meal must not produce a tombstone');
  });

  it('keeps saved meals out of the synced entity-type catalog', () => {
    assert.deepEqual(Object.values(SYNC_ENTITY_TYPES), ['personalFood', 'foodLog', 'weightEntry', 'profile']);
  });
});
