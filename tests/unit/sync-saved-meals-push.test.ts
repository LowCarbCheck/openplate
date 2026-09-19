/**
 * WHETHER A SAVED MEAL CAN MAKE THE DEVICE PUSH.
 *
 * `payloadsEqual` is the orchestrator's one question before it skips a cycle,
 * and `canonicalize` behind it decides what counts as a difference. Saved
 * meals were absent from that list while `mergeSnapshots` was busy publishing
 * them through `decidePassThrough`, so the account was meant to hold them and
 * no change to one could ever be the reason a cycle sent anything. Creating,
 * renaming or deleting a saved meal produced two payloads that canonicalized
 * identically; the device waited for an unrelated food log to push the blob
 * and carry the meal along, and on a phone that was erased or lost first the
 * meal was gone.
 *
 * `sync-saved-meals-passthrough.test.ts` one file over pins WHICH SIDE'S list
 * survives a merge. This file pins the question after it: given the list that
 * survived, may this cycle send it.
 *
 * ── The trap on the other side ───────────────────────────────────────────
 *
 * A push trigger that is not STABLE is worse than none: every boot writes a
 * new blob version, forever, burning the 5-version retention window. So every
 * claim below has its control, two identical lists compare equal, and so do
 * two lists holding the same meals in a different order, which is the exact
 * shape an unsorted comparison would fail on.
 * `tests/integration/sync-saved-meal-pushes-once.test.ts` makes the same claim
 * against the real cycle and a real blob store.
 *
 * ── The two collections that must stay out ───────────────────────────────
 *
 * `fasts` are not synced at all (M132), and the pantry is a local working list
 * this device's own fridge fills (M233/02). Neither may make a device push,
 * and the last two tests here are what keeps those two designs intact while
 * the collection between them changed sides.
 */
import { HEALTHY_STORAGE, NOTHING_TO_ACCOUNT_FOR } from '../sync-integrity-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots, payloadsEqual } from '../../app/lib/sync/snapshot-sync';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalFast, LocalPantryItem, LocalSavedMeal } from '../../app/lib/local-store/schema';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';

const T = Date.parse('2026-09-18T09:00:00Z');
const HOUR = 60 * 60 * 1000;

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
    createdAt: T,
    ...overrides,
  };
}

function fast(id: string, overrides: Partial<LocalFast> = {}): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 16 * HOUR,
    plannedStartAt: null,
    startedAt: T,
    endedAt: null,
    createdAt: T,
    ...overrides,
  };
}

function pantryItem(id: string, overrides: Partial<LocalPantryItem> = {}): LocalPantryItem {
  return {
    id,
    name: `Item ${id}`,
    amount: 1,
    unit: 'piece',
    category: 'produce',
    source: 'manual',
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

/**
 * A payload holding only the three collections this file is about.
 *
 * Nothing is stamped, because nothing here needs to be: saved meals, fasts and
 * pantry items own no `meta.perEntity` key, so an empty meta is exactly what a
 * device holding them and nothing else produces.
 */
function payload({
  savedMeals = [],
  fasts = [],
  pantryItems = [],
}: {
  savedMeals?: LocalSavedMeal[];
  fasts?: LocalFast[];
  pantryItems?: LocalPantryItem[];
}): StampedSnapshot {
  const snapshot: SyncedSnapshot = {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts,
    savedMeals,
    pantryItems,
    activityMarks: [],
    awards: [],
    fastingSettings: null,
    privateStore: null,
  };
  return { snapshot, meta: { perEntity: {}, tombstones: [] } };
}

describe('payloadsEqual and a saved meal that changed', () => {
  it('a CREATED saved meal makes the two payloads differ, so the cycle pushes', () => {
    const account = payload({});
    const device = payload({ savedMeals: [savedMeal('sunday-breakfast')] });

    assert.equal(payloadsEqual(device, account), false, 'a meal that exists on one side only is a difference');
  });

  it('a RENAMED saved meal makes the two payloads differ, so the cycle pushes', () => {
    const account = payload({ savedMeals: [savedMeal('sunday-breakfast')] });
    const device = payload({ savedMeals: [savedMeal('sunday-breakfast', { name: 'Sunday brunch' })] });

    assert.equal(payloadsEqual(device, account), false, 'the same id with a new name is a difference');
  });

  it('a DELETED saved meal makes the two payloads differ, so the cycle pushes', () => {
    const account = payload({ savedMeals: [savedMeal('sunday-breakfast')] });
    const device = payload({});

    assert.equal(payloadsEqual(device, account), false, 'a meal the account holds and the device does not is a difference');
  });

  it("an EDITED item inside a saved meal differs too, the comparison is not just the meal's name", () => {
    const account = payload({ savedMeals: [savedMeal('sunday-breakfast')] });
    const edited = savedMeal('sunday-breakfast');
    const device = payload({
      savedMeals: [{ ...edited, items: [{ ...edited.items[0]!, quantityGrams: 180 }] }],
    });

    assert.equal(payloadsEqual(device, account), false, 'a changed portion inside the bundle is a change to the bundle');
  });
});

describe('payloadsEqual and a saved meal that did not change', () => {
  it('THE CONTROL: two identical lists compare equal, so an idle cycle sends nothing', () => {
    // Without this, every assertion above passes against a `canonicalize` that
    // simply never compares equal, which would write a new blob version on
    // every boot of every device forever.
    const account = payload({ savedMeals: [savedMeal('sunday-breakfast'), savedMeal('chili')] });
    const device = payload({ savedMeals: [savedMeal('sunday-breakfast'), savedMeal('chili')] });

    assert.equal(payloadsEqual(device, account), true);
  });

  it('THE CONTROL: the same meals in a DIFFERENT ORDER compare equal', () => {
    // The precise failure an unsorted comparison would have: TinyBase hands
    // back the rows in whatever order it holds them, so two devices, or the
    // same device after a reload, can read one list two ways. Sorting by id is
    // what stops a re-read from reading as an edit.
    const account = payload({ savedMeals: [savedMeal('chili'), savedMeal('sunday-breakfast')] });
    const device = payload({ savedMeals: [savedMeal('sunday-breakfast'), savedMeal('chili')] });

    assert.equal(payloadsEqual(device, account), true, 'the order a list is read in is not a change');
  });
});

describe('payloadsEqual and the two collections that still must not push', () => {
  it('a FAST that started is not a difference, fasts are not synced at all', () => {
    // M132: fasts ride in the blob so a device keeps its own, and the
    // cross-device "at most one open fast" question is still open. A fast
    // starting or ending must not burn a blob version.
    const account = payload({ savedMeals: [savedMeal('chili')] });
    const device = payload({ savedMeals: [savedMeal('chili')], fasts: [fast('running-now')] });

    assert.equal(payloadsEqual(device, account), true, 'a fast must never be the reason a device pushes');
  });

  it('a PANTRY ROW is not a difference either, the pantry is this device’s own shelf', () => {
    // M233/02: the pantry passes through from the local side with no
    // `decidePassThrough` around it, because it writes no delete-journal rows.
    // Photographing a fridge is not news for the account.
    const account = payload({ savedMeals: [savedMeal('chili')] });
    const device = payload({ savedMeals: [savedMeal('chili')], pantryItems: [pantryItem('courgette')] });

    assert.equal(payloadsEqual(device, account), true, 'a pantry row must never be the reason a device pushes');
  });

  it('and the merge still refuses to adopt a peer’s saved meal, the pass-through has not moved', () => {
    // The boundary this change did NOT cross. Weighing saved meals in the
    // comparison says "this device may send its list"; it does not say "this
    // device may take another device's". A merge that started adopting them
    // would hand everybody every meal anybody ever saved.
    const local = payload({ savedMeals: [savedMeal('mine')] });
    const remote = payload({ savedMeals: [savedMeal('theirs')] });

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(
      merged.snapshot.savedMeals.map((entry) => entry.id),
      ['mine'],
    );
  });
});
