/**
 * The run detector behind the diary's "Save this as a meal?" hint (M227/03).
 *
 * EVERY CASE HERE IS A PAIR. The run that qualifies is asserted beside a
 * control that differs by one thing and must NOT qualify, because a detector
 * that answered "yes" to everything would pass a file full of positive
 * assertions and put the hint on every meal group in the app.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import type { MealType } from '#types/enums';
import {
  REPEAT_RUN_DAYS,
  mealGroupFingerprint,
  selectRepeatedMealSlots,
  type RepeatedMealEntry,
} from '#app/lib/repeated-meal';

/** The viewed day and the two before it. */
const TODAY = '2026-09-14';
const YESTERDAY = '2026-09-13';
const TWO_DAYS_AGO = '2026-09-12';
const THREE_DAYS_AGO = '2026-09-11';

/**
 * One entry, with the three fields a caller usually varies.
 *
 * @param dayKey - the day it was filed under.
 * @param mealType - the slot, or null for the "no meal" bucket.
 * @param name - the food's name.
 * @param quantityGrams - the portion, defaulting to a round 100 g.
 * @returns the entry.
 */
function entry(
  dayKey: string,
  mealType: MealType | null,
  name: string,
  quantityGrams = 100,
): RepeatedMealEntry {
  return { dayKey, mealType, name, quantityGrams };
}

/** The same one-food breakfast on each of the given days. */
function porridgeOn(days: readonly string[], grams = 100): RepeatedMealEntry[] {
  return days.map((day) => entry(day, 'breakfast', 'Porridge', grams));
}

describe('REPEAT_RUN_DAYS', () => {
  test('is three, because two days is a coincidence', () => {
    assert.equal(REPEAT_RUN_DAYS, 3);
  });
});

describe('mealGroupFingerprint', () => {
  test('ignores the order the foods were logged in', () => {
    const morning = [entry(TODAY, 'breakfast', 'Coffee'), entry(TODAY, 'breakfast', 'Porridge')];
    const reversed = [...morning].toReversed();
    assert.equal(mealGroupFingerprint(morning), mealGroupFingerprint(reversed));
  });

  test('ignores capitals and stray whitespace in the name', () => {
    assert.equal(
      mealGroupFingerprint([entry(TODAY, 'breakfast', '  porridge ')]),
      mealGroupFingerprint([entry(TODAY, 'breakfast', 'Porridge')]),
    );
  });

  test('CONTROL: one gram of difference is a different meal', () => {
    assert.notEqual(
      mealGroupFingerprint([entry(TODAY, 'breakfast', 'Porridge', 100)]),
      mealGroupFingerprint([entry(TODAY, 'breakfast', 'Porridge', 101)]),
    );
  });

  test('an empty slot fingerprints as the empty string', () => {
    assert.equal(mealGroupFingerprint([]), '');
  });
});

describe('selectRepeatedMealSlots', () => {
  test('names the slot eaten identically on three days running', () => {
    const logs = porridgeOn([TWO_DAYS_AGO, YESTERDAY, TODAY]);
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), ['breakfast']);
  });

  test('CONTROL: two days running is not a run', () => {
    const logs = porridgeOn([YESTERDAY, TODAY]);
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), []);
  });

  test('CONTROL: one gram of difference on one day breaks the run', () => {
    const logs = [...porridgeOn([TWO_DAYS_AGO, YESTERDAY]), ...porridgeOn([TODAY], 101)];
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), []);
  });

  test('CONTROL: a food added on the third day breaks the run', () => {
    const logs = [...porridgeOn([TWO_DAYS_AGO, YESTERDAY, TODAY]), entry(TODAY, 'breakfast', 'Coffee')];
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), []);
  });

  test('CONTROL: the same food in another slot is another meal', () => {
    const logs = [
      ...porridgeOn([TWO_DAYS_AGO, YESTERDAY]),
      entry(TODAY, 'dinner', 'Porridge'),
    ];
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), []);
  });

  test('grades each slot on its own, so one run does not carry another', () => {
    const logs = [
      ...porridgeOn([TWO_DAYS_AGO, YESTERDAY, TODAY]),
      entry(YESTERDAY, 'dinner', 'Stew'),
      entry(TODAY, 'dinner', 'Stew'),
    ];
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), ['breakfast']);
  });

  test('reads the run back from the viewed day, not from today', () => {
    const logs = porridgeOn([THREE_DAYS_AGO, TWO_DAYS_AGO, YESTERDAY]);
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: YESTERDAY }), ['breakfast']);
    // CONTROL for that line: the same entries do not make TODAY a run, since
    // today's breakfast is empty.
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), []);
  });

  test('three unfiled days are never a run', () => {
    const logs = [TWO_DAYS_AGO, YESTERDAY, TODAY].map((day) => entry(day, null, 'Porridge'));
    assert.deepEqual(selectRepeatedMealSlots({ logs, date: TODAY }), []);
  });

  test('an empty device names no slot at all', () => {
    assert.deepEqual(selectRepeatedMealSlots({ logs: [], date: TODAY }), []);
  });
});
