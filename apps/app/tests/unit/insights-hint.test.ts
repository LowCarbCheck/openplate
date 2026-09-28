/**
 * The dismissal behind the dashboard's one-time door to Insights (M239/06).
 *
 * The promise under test is "it stays gone": a dismissal written once is read
 * back by a later session. The browser tier proves the same thing across a
 * real reload; this file proves the storage rule itself, including the two
 * ways storage can fail a person without taking the dashboard with it.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  INSIGHTS_HINT_STORAGE_KEY,
  dismissInsightsHint,
  isInsightsHintDismissed,
  type InsightsHintStorage,
} from '#app/lib/insights-hint';

/** A storage that remembers, the way a working browser does. */
function fakeStorage(initial: string | null = null): InsightsHintStorage {
  let value = initial;
  return {
    getItem: (key) => (key === INSIGHTS_HINT_STORAGE_KEY ? value : null),
    setItem: (key, next) => {
      if (key === INSIGHTS_HINT_STORAGE_KEY) value = next;
    },
  };
}

/** A storage that refuses, the way a private-mode or full browser does. */
const REFUSING_STORAGE: InsightsHintStorage = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
};

describe('isInsightsHintDismissed', () => {
  test('a fresh device has not dismissed the hint', () => {
    assert.equal(isInsightsHintDismissed(fakeStorage()), false);
  });

  test('reads back what was written', () => {
    const storage = fakeStorage();
    dismissInsightsHint(storage);
    assert.equal(isInsightsHintDismissed(storage), true);
  });

  test('CONTROL: a separate device is unaffected by another device dismissing the hint', () => {
    const deviceA = fakeStorage();
    const deviceB = fakeStorage();
    dismissInsightsHint(deviceA);
    assert.equal(isInsightsHintDismissed(deviceA), true);
    assert.equal(isInsightsHintDismissed(deviceB), false);
  });

  test('a refusing storage reads as not dismissed, and writing to it does not throw', () => {
    assert.equal(isInsightsHintDismissed(REFUSING_STORAGE), false);
    assert.doesNotThrow(() => dismissInsightsHint(REFUSING_STORAGE));
  });
});
