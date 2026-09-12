/**
 * THE TWO PASS-THROUGH DELETE VERBS WRITE THE JOURNAL TOO, and they had to
 * start.
 *
 * `deleteLocalFood` and its two siblings journal because a tombstone needs
 * evidence. Fasts and saved meals carry no tombstone at all, so for a long time
 * a `delRow` looked like enough. It is the opposite of enough: nothing on the
 * wire describes their removals, so the whole local list either stands against
 * the account's or is replaced by it, and the journal is the ONLY thing that
 * can tell "she cleared her saved meals" from "this browser evicted the
 * database". Without a row here, `mergeSnapshots` refuses the shorter list and
 * the deleted fast comes back on the next sync.
 *
 * `delete-journal-single-writer.test.ts` beside this file reads the SOURCE, to
 * pin who may remove a row without recording it. This file drives the REAL
 * store on `fake-indexeddb` instead, because the claim is about what the verb
 * writes, and a source sweep cannot see a transaction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import {
  deleteLocalFast,
  deleteLocalSavedMeal,
  listDeletedEntityKeys,
  listLocalFasts,
  listLocalSavedMeals,
  putLocalFast,
  putLocalSavedMeal,
} from '../../app/lib/local-store';
import type { LocalFast, LocalSavedMeal } from '../../app/lib/local-store';

const T = 1_770_000_000_000;

function fast(id: string): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 57_600_000,
    plannedStartAt: null,
    startedAt: T,
    endedAt: T + 3_600_000,
    createdAt: T,
  };
}

function savedMeal(id: string): LocalSavedMeal {
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
  };
}

describe('the pass-through delete verbs and the journal', () => {
  it('deleteLocalFast records `fast:<id>` beside the removal', async () => {
    const store = createPrimaryStore();
    await putLocalFast(fast('fast-one'), { store });
    await putLocalFast(fast('fast-two'), { store });

    // NON-VACUITY: both rows really were there, so the journal below is about a
    // removal rather than about a write that never happened.
    assert.equal((await listLocalFasts({ store })).length, 2);
    assert.deepEqual(await listDeletedEntityKeys({ store }), [], 'and nothing was recorded before the delete');

    await deleteLocalFast('fast-two', { store });

    assert.deepEqual(
      (await listLocalFasts({ store })).map((entry) => entry.id),
      ['fast-one'],
      'the row must be gone',
    );
    assert.deepEqual(
      await listDeletedEntityKeys({ store }),
      ['fast:fast-two'],
      'and the removal must be written down, or the merge cannot tell it from an eviction',
    );
  });

  it('deleteLocalSavedMeal records `savedMeal:<id>` beside the removal', async () => {
    const store = createPrimaryStore();
    await putLocalSavedMeal(savedMeal('meal-one'), { store });
    await putLocalSavedMeal(savedMeal('meal-two'), { store });

    assert.equal((await listLocalSavedMeals({ store })).length, 2);
    assert.deepEqual(await listDeletedEntityKeys({ store }), []);

    await deleteLocalSavedMeal('meal-one', { store });

    assert.deepEqual(
      (await listLocalSavedMeals({ store })).map((entry) => entry.id),
      ['meal-two'],
    );
    assert.deepEqual(await listDeletedEntityKeys({ store }), ['savedMeal:meal-one']);
  });

  it('uses a tag of its own for each collection, so a fast and a meal that share an id do not collide', async () => {
    // The namespacing the journal key exists for. Both entities are called
    // `same-id`, and deleting one must not read as having deleted the other.
    const store = createPrimaryStore();
    await putLocalFast(fast('same-id'), { store });
    await putLocalSavedMeal(savedMeal('same-id'), { store });

    await deleteLocalFast('same-id', { store });

    assert.deepEqual(await listDeletedEntityKeys({ store }), ['fast:same-id']);
    assert.equal((await listLocalSavedMeals({ store })).length, 1, 'the saved meal beside it is untouched');
  });
});
