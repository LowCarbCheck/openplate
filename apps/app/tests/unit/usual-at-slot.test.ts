/**
 * `scaleSavedMealItem` (`#app/lib/usual-at-slot`), the pure half of the
 * confirm dialog's portion stepper. No store, no browser, no clock: an item
 * goes in, a scaled item comes out, mirroring `saved-meals.test.ts`'s own
 * precedent for the sibling "items in, entries out" builders.
 *
 * EVERY SCALING ASSERTION IS PAIRED WITH A CONTROL that would fail if the
 * scale were silently a no-op (this repo's rule): each `it` that checks a
 * scaled figure also checks the SAME figure is no longer the recorded one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scaleSavedMealItem } from '../../app/lib/usual-at-slot';
import type { LocalSavedMealItem } from '../../app/lib/local-store/schema';

/** A complete saved-meal item at its recorded (100%) amount; override any field per test. */
function item(overrides: Partial<LocalSavedMealItem> & { name: string }): LocalSavedMealItem {
  return {
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal: 120 },
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    // Per-100g figures — a scale must NEVER touch these, they are the control
    // every "did it scale too much" assertion below checks against.
    netCarbsPer100g: 8,
    carbBasis: 'total',
    ...overrides,
  };
}

describe('scaleSavedMealItem', () => {
  it('scales quantityGrams and every macro by the percent, leaving per-100g fields untouched', () => {
    const eggs = item({ name: 'Eggs' });

    const scaled = scaleSavedMealItem(eggs, 150);

    assert.equal(scaled.quantityGrams, 150);
    assert.deepEqual(scaled.macros, {
      carbs: 15,
      fiber: 3,
      sugars: 4.5,
      polyols: null,
      protein: 7.5,
      fat: 6,
      kcal: 180,
    });
    // CONTROL: a scale that silently no-opped would leave these at the input.
    assert.notEqual(scaled.quantityGrams, eggs.quantityGrams);
    assert.notDeepEqual(scaled.macros, eggs.macros);
    // The density fields stay EXACTLY as recorded — scaling them would be the
    // opposite bug, a food that gets "more concentrated" the more of it you log.
    assert.equal(scaled.netCarbsPer100g, eggs.netCarbsPer100g);
    assert.equal(scaled.carbBasis, eggs.carbBasis);
  });

  it('preserves a null macro as null, never fabricating a zero', () => {
    const toast = item({
      name: 'Toast',
      macros: { carbs: 20, fiber: null, sugars: 1, polyols: null, protein: 4, fat: 2, kcal: 140 },
    });

    const scaled = scaleSavedMealItem(toast, 50);

    assert.equal(scaled.macros.fiber, null);
    assert.equal(scaled.macros.polyols, null);
    // CONTROL: the fields that ARE numbers actually moved.
    assert.equal(scaled.macros.carbs, 10);
    assert.notEqual(scaled.macros.carbs, toast.macros.carbs);
  });

  it('is a no-op at 100%, keeping the exact recorded amount and the display portion', () => {
    const porridge = item({
      name: 'Porridge',
      portion: { unit: 'cup', quantity: 1, gramsPerUnit: 158 },
    });

    const scaled = scaleSavedMealItem(porridge, 100);

    assert.equal(scaled.quantityGrams, porridge.quantityGrams);
    assert.deepEqual(scaled.macros, porridge.macros);
    assert.deepEqual(scaled.portion, porridge.portion);
  });

  it('drops the display portion once the scale moves off 100%', () => {
    const eggs = item({
      name: 'Eggs',
      portion: { unit: 'egg', quantity: 2, gramsPerUnit: 50 },
    });

    const scaledUp = scaleSavedMealItem(eggs, 150);
    const scaledDown = scaleSavedMealItem(eggs, 50);

    assert.equal(scaledUp.portion, null);
    assert.equal(scaledDown.portion, null);
    // CONTROL, paired with the "is a no-op at 100%" case above: only a
    // NON-100% scale clears it, a portion is not simply dropped on every call.
  });

  it('scales every item of a bundle independently, by the same percent', () => {
    const eggs = item({
      name: 'Eggs',
      quantityGrams: 120,
      macros: { carbs: 1, fiber: 0, sugars: 0, polyols: null, protein: 12, fat: 10, kcal: 150 },
    });
    const toast = item({
      name: 'Toast',
      quantityGrams: 60,
      macros: { carbs: 27, fiber: 3, sugars: 2, polyols: null, protein: 4, fat: 1, kcal: 140 },
    });

    const [scaledEggs, scaledToast] = [eggs, toast].map((bundleItem) => scaleSavedMealItem(bundleItem, 125));

    assert.equal(scaledEggs?.quantityGrams, 150);
    assert.equal(scaledToast?.quantityGrams, 75);
    // CONTROL: the two items started at different grams and stayed different
    // after scaling, so this is not one shared figure applied to both rows.
    assert.notEqual(scaledEggs?.quantityGrams, scaledToast?.quantityGrams);
  });
});
