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
 * ── The two collections that changed sides ──────────────────────────────
 *
 * `fasts` and `pantryItems` were both on the "must never push" side of this
 * line, and neither is any more. M240/01 (ADR-0014) made a fast a merged
 * entity and M240/02 (ADR-0015) did the same for the pantry, so starting a
 * fast and photographing a shelf each push on their own. The two tests at the
 * end of this file said the opposite and are now inverted; the collections
 * they are about have their own files, `sync-fasts-merged.test.ts` and
 * `sync-pantry-merged.test.ts`.
 *
 * `savedMeals` is the only pass-through collection left in the app.
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
 * Nothing is stamped, because nothing here needs to be: a saved meal owns no
 * `meta.perEntity` key, so an empty meta is exactly what a device holding them
 * and nothing else produces. A FAST owns one since M240/01 and a PANTRY ROW
 * since M240/02, and the two tests below that hold one leave it unstamped on
 * purpose: they assert that the SNAPSHOT half of the comparison sees it, with
 * no stamp to carry the difference.
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

describe('payloadsEqual and the two collections that changed sides', () => {
  it('a FAST that started IS a difference now, so it reaches the account on its own', () => {
    // THE INVERSION (M240/01, ADR-0014). This test asserted the opposite for
    // the whole of M132's life, on the ground that a fast told the account
    // nothing. It tells the account everything now, and a fast that did not
    // push is a fast that dies with the phone it was started on.
    const account = payload({ savedMeals: [savedMeal('chili')] });
    const device = payload({ savedMeals: [savedMeal('chili')], fasts: [fast('running-now')] });

    assert.equal(payloadsEqual(device, account), false, 'starting a fast must make this device push');
  });

  it('a PANTRY ROW IS a difference now, so a photographed shelf reaches the account', () => {
    // THE SECOND INVERSION (M240/02, ADR-0015). M233/02 held that
    // photographing a fridge is not news for the account, so a pantry row must
    // never burn a blob version. The owner reversed it: a shopping list that is
    // only on the phone you left at home is not a shopping list.
    const account = payload({ savedMeals: [savedMeal('chili')] });
    const device = payload({ savedMeals: [savedMeal('chili')], pantryItems: [pantryItem('courgette')] });

    assert.equal(payloadsEqual(device, account), false, 'photographing a shelf must make this device push');
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
