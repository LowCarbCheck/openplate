/**
 * The pantry/sync boundary (M233/02, pinned by the M233 review).
 *
 * `mergeSnapshots` leaves `pantryItems` EXACTLY as the local device holds
 * them, whatever the remote payload says. The mechanism is the one
 * `sync-fasts-passthrough.test.ts` and `sync-saved-meals-passthrough.test.ts`
 * already pin for their own collections, with ONE difference that is the
 * reason this file exists: the pantry has no `decidePassThrough` guard around
 * it.
 *
 * That guard refuses a local list that has lost ids the baseline recorded,
 * and it decides by reading the DELETE JOURNAL. The pantry writes no journal
 * rows on purpose (a working list, not a record of events), so the guard would
 * find nothing to read and refuse the local list on every ordinary cycle,
 * handing every second device the shelf photographed in the first one's
 * kitchen. A plain local pass-through is the honest answer for a working list.
 *
 * The failure mode this file exists to catch is silent: a bare
 * `pantryItems: []` in the merge result would EMPTY a device's pantry on the
 * very first sync, with nothing else in the suite failing.
 *
 * THE CONTROL IS THE TABLE BESIDE IT. Personal foods are a synced entity, so
 * the same merge with the same two payloads DOES adopt a peer's row. Without
 * it, "the local side wins" would pass against a merge that had stopped
 * reading the remote payload at all.
 */
import { HEALTHY_STORAGE, NOTHING_TO_ACCOUNT_FOR } from '../sync-integrity-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots, SYNC_ENTITY_TYPES } from '../../app/lib/sync/snapshot-sync';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalPantryItem, LocalPersonalFood } from '../../app/lib/local-store/schema';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';

const NOW = 1_700_000_000_000;

function pantryItem(id: string, overrides: Partial<LocalPantryItem> = {}): LocalPantryItem {
  return {
    id,
    name: `Item ${id}`,
    amount: null,
    unit: null,
    category: 'other',
    source: 'photo',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function food(id: string): LocalPersonalFood {
  return {
    id,
    name: `Food ${id}`,
    brand: null,
    macrosPer100g: { carbs: 1, fiber: 0, sugars: 0, polyols: null, protein: 12, fat: 10, kcal: 150 },
    source: 'user',
    createdAt: NOW,
  };
}

/** One side of a merge: a pantry, and the foods that are the control beside it. */
function snapshot(pantryItems: LocalPantryItem[], foods: LocalPersonalFood[] = []): SyncedSnapshot {
  return {
    foods,
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    pantryItems,
    fastingSettings: null,
    privateStore: null,
  };
}

function payload(pantryItems: LocalPantryItem[], foods: LocalPersonalFood[] = []): StampedSnapshot {
  return { snapshot: snapshot(pantryItems, foods), meta: { perEntity: {}, tombstones: [] } };
}

/** The ids the merge would write, sorted, so the order the merge chose is not asserted. */
function mergedPantryIds(local: StampedSnapshot, remote: StampedSnapshot): string[] {
  const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });
  return merged.snapshot.pantryItems.map((item) => item.id).toSorted();
}

describe('mergeSnapshots and pantryItems', () => {
  it('keeps the local pantry when the remote payload has none', () => {
    assert.deepEqual(mergedPantryIds(payload([pantryItem('mine')]), payload([])), ['mine']);
  });

  it('ignores the remote pantry entirely, nothing is adopted across devices', () => {
    assert.deepEqual(mergedPantryIds(payload([pantryItem('mine')]), payload([pantryItem('theirs')])), ['mine']);
  });

  it('keeps an empty local pantry empty even when the remote is full', () => {
    // A shelf somebody cleared is a shelf that is clear. This is also the
    // difference from `fasts` and `savedMeals`, which refuse an unaccounted-for
    // emptiness: the pantry writes no delete journal, so there is nothing to
    // account for and a working list is this device's own.
    assert.deepEqual(mergedPantryIds(payload([]), payload([pantryItem('on-the-account')])), []);
  });

  it('is stable under repeated merges, no drift, no accumulation', () => {
    const local = payload([pantryItem('mine'), pantryItem('other')]);
    const remote = payload([pantryItem('theirs')]);

    const once = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });
    const twice = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: once, remote });

    assert.deepEqual(twice.snapshot.pantryItems, local.snapshot.pantryItems);
  });

  it('THE CONTROL: the table beside it DOES merge, so the remote payload was read', () => {
    // Same call, same two sides. The peer's personal food is adopted while the
    // peer's pantry row is not, which is what makes every case above a claim
    // about the pantry rather than about a merge that ignores its remote.
    const local = payload([pantryItem('mine')], [food('my-food')]);
    const remote = payload([pantryItem('theirs')], [food('their-food')]);

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(
      merged.snapshot.foods.map((entry) => entry.id).toSorted(),
      ['my-food', 'their-food'],
      'a personal food must cross devices',
    );
    assert.deepEqual(
      merged.snapshot.pantryItems.map((entry) => entry.id),
      ['mine'],
      "a peer's pantry row must never appear on this device",
    );
  });

  it('keeps the pantry out of the synced entity-type catalog', () => {
    // Widened to plain strings so the absence can be asserted at all: the
    // catalog's own union does not contain the name being looked for, which is
    // the point.
    const synced: string[] = Object.values(SYNC_ENTITY_TYPES);

    assert.ok(!synced.includes('pantryItem'), 'the pantry became a stamped entity without this file being rewritten');
    // The control: the same probe finds a type that IS in the catalog.
    assert.ok(synced.includes('personalFood'), 'the probe cannot see the catalog at all');
  });
});
