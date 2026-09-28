/**
 * The dismissal behind the diary's "Save this as a meal?" hint (M227/03).
 *
 * The promise under test is "it stays gone": a dismissal written once is read
 * back by a later session. The browser tier proves the same thing across a
 * real reload; this file proves the storage rule itself, including the two
 * ways storage can fail a person without taking the diary with it.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  SAVE_MEAL_HINT_STORAGE_KEY,
  dismissSaveMealHint,
  readDismissedSaveMealHints,
  type SaveMealHintStorage,
} from '#app/lib/save-meal-hint';

/** A storage that remembers, the way a working browser does. */
function fakeStorage(initial: string | null = null): SaveMealHintStorage {
  let value = initial;
  return {
    getItem: (key) => (key === SAVE_MEAL_HINT_STORAGE_KEY ? value : null),
    setItem: (key, next) => {
      if (key === SAVE_MEAL_HINT_STORAGE_KEY) value = next;
    },
  };
}

/** A storage that refuses, the way a private-mode or full browser does. */
const REFUSING_STORAGE: SaveMealHintStorage = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
};

describe('readDismissedSaveMealHints', () => {
  test('a fresh device has dismissed nothing', () => {
    assert.equal(readDismissedSaveMealHints(fakeStorage()).size, 0);
  });

  test('reads back what was written', () => {
    const storage = fakeStorage();
    dismissSaveMealHint(storage, 'breakfast');
    assert.deepEqual([...readDismissedSaveMealHints(storage)], ['breakfast']);
  });

  test('CONTROL: dismissing one slot does not dismiss another', () => {
    const storage = fakeStorage();
    dismissSaveMealHint(storage, 'breakfast');
    assert.equal(readDismissedSaveMealHints(storage).has('dinner'), false);
  });

  test('keeps both slots when both are dismissed', () => {
    const storage = fakeStorage();
    dismissSaveMealHint(storage, 'breakfast');
    dismissSaveMealHint(storage, 'dinner');
    assert.deepEqual([...readDismissedSaveMealHints(storage)].toSorted(), ['breakfast', 'dinner']);
  });

  test('a value that is not a list reads as nothing dismissed', () => {
    assert.equal(readDismissedSaveMealHints(fakeStorage('"breakfast"')).size, 0);
  });

  test('a list holding something that is not a slot drops it', () => {
    assert.deepEqual([...readDismissedSaveMealHints(fakeStorage('["breakfast","elevenses"]'))], ['breakfast']);
  });

  test('corrupt JSON reads as nothing dismissed', () => {
    assert.equal(readDismissedSaveMealHints(fakeStorage('{not json')).size, 0);
  });

  test('a refusing storage reads as nothing dismissed, and writing to it does not throw', () => {
    assert.equal(readDismissedSaveMealHints(REFUSING_STORAGE).size, 0);
    assert.doesNotThrow(() => dismissSaveMealHint(REFUSING_STORAGE, 'breakfast'));
  });
});
