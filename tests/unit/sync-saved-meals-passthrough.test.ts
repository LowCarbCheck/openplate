/**
 * The saved-meals/sync boundary (M123/07 + M123/13 review finding 6):
 * `mergeSnapshots` must leave `savedMeals` EXACTLY as the local device holds
 * them, no matter what the remote payload says, the identical mechanism
 * `sync-fasts-merged.test.ts` pins the opposite stance for `fasts`, one
 * entity over: they were passed through beside saved meals until M240/01.
 *
 * Saved meals are deliberately absent from `SYNC_ENTITY_TYPES` and
 * `flattenSnapshot`, so they are never stamped, diffed, tombstoned or adopted
 * from another device. Unlike the fasts that used to share this stance there
 * is no hard cross-device invariant
 * blocking a real merge here, this is simply not built yet (see
 * `snapshot-sync.ts`'s comment above `mergeSnapshots`'s return).
 *
 * The failure mode this file exists to catch is silent: a bare
 * `savedMeals: []` in the merge result would EMPTY a device's saved meals on
 * the very first sync, with nothing else in the suite failing, the fasts had
 * exactly this test and saved meals did not, until this file.
 */
import {
  EVICTED_STORAGE,
  HEALTHY_STORAGE,
  NO_PASS_THROUGH_RECORD,
  NOTHING_TO_ACCOUNT_FOR,
  passThroughEvidence,
} from '../sync-integrity-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots, SYNC_ENTITY_TYPES, stampSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { SnapshotIntegrity } from '../../app/lib/sync/snapshot-sync';
import { FASTS_TABLE, SAVED_MEALS_TABLE } from '../../app/lib/local-store/schema';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalSavedMeal } from '../../app/lib/local-store/schema';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';

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

function snapshot(savedMeals: LocalSavedMeal[]): SyncedSnapshot {
  // `fasts` is a MERGED entity since M240/01, so an empty array here keeps it
  // out of the way: every assertion in this file is about `savedMeals`.
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals,
    pantryItems: [],
    activityMarks: [],
    awards: [],
    fastingSettings: null,
    privateStore: null,
  };
}

function payload(savedMeals: LocalSavedMeal[]): StampedSnapshot {
  return { snapshot: snapshot(savedMeals), meta: { perEntity: {}, tombstones: [] } };
}

describe('mergeSnapshots and savedMeals', () => {
  it('keeps the local saved meals when the remote payload has none', () => {
    const local = payload([savedMeal('mine')]);

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote: payload([]) });

    assert.deepEqual(merged.snapshot.savedMeals, [savedMeal('mine')]);
  });

  it('ignores the remote saved meals entirely, nothing is adopted across devices', () => {
    const local = payload([savedMeal('mine')]);
    const remote = payload([savedMeal('theirs', { name: 'Their meal' })]);

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(
      merged.snapshot.savedMeals.map((entry) => entry.id),
      ['mine'],
      "a peer's saved meal must never appear on this device",
    );
  });

  it('keeps an empty local list empty even when the remote is full', () => {
    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: payload([]), remote: payload([savedMeal('theirs')]) });

    assert.deepEqual(merged.snapshot.savedMeals, []);
  });

  it('is stable under repeated merges, no drift, no accumulation', () => {
    const local = payload([savedMeal('mine'), savedMeal('other', { name: 'Other meal' })]);
    const remote = payload([savedMeal('theirs')]);

    const once = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });
    const twice = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: once, remote });

    assert.deepEqual(twice.snapshot.savedMeals, local.snapshot.savedMeals);
  });

  it('never stamps or tombstones a saved meal, no saved-meal id reaches the wire meta', () => {
    // `flattenSnapshot` is private, so this asserts the observable
    // consequence: stamping a snapshot that holds a saved meal produces no
    // entity key for it, and deleting it later therefore produces no
    // tombstone either.
    const stamped = stampSnapshot({
    integrity: HEALTHY_STORAGE,
      snapshot: snapshot([savedMeal('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    assert.deepEqual(Object.keys(stamped.meta.perEntity), []);
    assert.deepEqual(stamped.meta.tombstones, []);

    const afterDelete = stampSnapshot({
    integrity: HEALTHY_STORAGE,
      snapshot: snapshot([]),
      baseline: stamped.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(afterDelete.meta.tombstones, [], 'a removed saved meal must not produce a tombstone');
  });

  it('keeps saved meals out of the synced entity-type catalog', () => {
    assert.deepEqual(Object.values(SYNC_ENTITY_TYPES), [
      'personalFood',
      'foodLog',
      'weightEntry',
      'profile',
      // A FAST joined the merged side in M240/01 (ADR-0014) and the pantry in
      // M240/02, and saved meals still have not, so this file is now the last
      // one pinning the pass-through stance. A saved meal is a merge nobody
      // has built yet, not a decision that it should not travel.
      'fast',
      // AND THE PANTRY joined in M240/02 (ADR-0015), which leaves this file
      // pinning the LAST pass-through collection in the app.
      'pantryItem',
      // The fasting ROUTINE is in the catalog, and saved meals still are not.
      'fastingSettings',
      // The marks and the awards joined the merged side in M235/03, and saved
      // meals still have not: both of those tables are written once per row id
      // and never updated, which is what makes a merge enough for them.
      'activityMark',
      'award',
      'privateStore',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The boundary of the pass-through: a device that cannot vouch for its storage
// ---------------------------------------------------------------------------

/** A device whose saved-meals table did NOT finish loading, while everything else about the store is fine. */
const SAVED_MEALS_TABLE_NOT_LOADED: SnapshotIntegrity = {
  hasPersistedDatabase: true,
  isTableLoaded: { [SAVED_MEALS_TABLE]: false },
  isCompartmentKnown: true,
  // Nothing here is about the compartment either: these fixtures reach
  // `mergeSnapshots`, which never weighs the seal.
  isCompartmentHeld: false,
  isCompartmentUnpublished: false,
  // Nothing here is about a delete: these fixtures test the PASS-THROUGH
  // collection, which carries no tombstones and therefore no journal rows.
  deletedEntityKeys: new Set(),
};

/**
 * A device whose FASTS table did not load, while the saved meals loaded
 * perfectly. Any other table would do; the point is that one broken table
 * says nothing about the one beside it.
 */
const ONLY_THE_FASTS_TABLE_NOT_LOADED: SnapshotIntegrity = {
  hasPersistedDatabase: true,
  isTableLoaded: { [FASTS_TABLE]: false },
  isCompartmentKnown: true,
  // Nothing here is about the compartment either: these fixtures reach
  // `mergeSnapshots`, which never weighs the seal.
  isCompartmentHeld: false,
  isCompartmentUnpublished: false,
  // Nothing here is about a delete: these fixtures test the PASS-THROUGH
  // collection, which carries no tombstones and therefore no journal rows.
  deletedEntityKeys: new Set(),
};

describe('mergeSnapshots, savedMeals, and what the device can prove', () => {
  it('does NOT let an evicted device empty the account: the remote saved meals survive', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: EVICTED_STORAGE,
      local: payload([]),
      remote: payload([savedMeal('on-the-account')]),
    });

    assert.deepEqual(
      merged.snapshot.savedMeals.map((entry) => entry.id),
      ['on-the-account'],
      'a device with no storage must not be the side that decides the list is empty',
    );
  });

  it('THE CONTROL: a HEALTHY device with no saved meals keeps the list empty', () => {
    // Without this, the case above passes against a merge that always prefers
    // the remote, which would resurrect every saved meal anybody ever deleted.
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([savedMeal('on-the-account')]),
    });

    assert.deepEqual(merged.snapshot.savedMeals, [], 'zero saved meals on a healthy device is a real state');
  });

  it('reads the saved-meals TABLE, so a partial load that dropped only that table is caught too', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: SAVED_MEALS_TABLE_NOT_LOADED,
      local: payload([savedMeal('the-one-that-loaded')]),
      remote: payload([savedMeal('the-one-that-loaded'), savedMeal('the-one-memory-missed')]),
    });

    assert.deepEqual(
      merged.snapshot.savedMeals.map((entry) => entry.id).toSorted(),
      ['the-one-memory-missed', 'the-one-that-loaded'],
      'a half-read table must not be the side that decides what the account holds',
    );
  });

  it('is PER TABLE: another table that did not load leaves the saved meals alone', () => {
    // The sharp end of choosing the per-table signal over the whole-database
    // one. A merge that reached for `hasPersistedDatabase` alone, or that
    // treated any unloaded table as a broken store, would hand the account's
    // saved meals back here and silently undo a deletion the person made.
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: ONLY_THE_FASTS_TABLE_NOT_LOADED,
      local: payload([]),
      remote: payload([savedMeal('on-the-account')]),
    });

    assert.deepEqual(merged.snapshot.savedMeals, [], 'one broken table says nothing about the one beside it');
  });
});

// ---------------------------------------------------------------------------
// The second half of the pass-through rule, the shape the fasts used to share
// ---------------------------------------------------------------------------

describe('mergeSnapshots, savedMeals, and accounting for the ids the baseline named', () => {
  it('refuses a local list that dropped a saved meal with nothing recorded', () => {
    // The storage says healthy, because a primed empty database always does.
    // The baseline names a meal the local list has lost and the journal is
    // empty, so nothing here is a deletion anybody performed.
    const merged = mergeSnapshots({
      ...passThroughEvidence({ savedMeals: ['on-the-account'] }),
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([savedMeal('on-the-account')]),
    });

    assert.deepEqual(
      merged.snapshot.savedMeals.map((entry) => entry.id),
      ['on-the-account'],
      'an unaccounted-for id must not be published as gone',
    );
    assert.deepEqual(merged.passThrough.refused, [SAVED_MEALS_TABLE]);
  });

  it('lets it stand once the removal is in the delete journal', () => {
    const merged = mergeSnapshots({
      ...passThroughEvidence({ savedMeals: ['on-the-account'], journal: ['savedMeal:on-the-account'] }),
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([savedMeal('on-the-account')]),
    });

    assert.deepEqual(merged.snapshot.savedMeals, [], 'a recorded removal must reach the account');
    assert.deepEqual(merged.passThrough.published, ['savedMeal:on-the-account']);
    assert.deepEqual(merged.passThrough.refused, []);
  });

  it('treats a baseline from before the ids were kept as accounting for nothing', () => {
    const merged = mergeSnapshots({
      ...NO_PASS_THROUGH_RECORD,
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([savedMeal('on-the-account')]),
    });

    assert.deepEqual(
      merged.snapshot.savedMeals.map((entry) => entry.id),
      ['on-the-account'],
      'the migration hands one cycle to the account, and the next cycle is ordinary',
    );
  });
});
