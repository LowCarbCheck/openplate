/**
 * `buildRecipeLogEntry` (M233/04), the two rows one "Log this" writes.
 *
 * THE SLOT AND THE BATCH ID are what this pins. Both are facts about the tap
 * rather than about the recipe, and both have a history in this repo of
 * reaching zero rows while every type check passed: the scan confirm wrote a
 * hardcoded `mealType: null` for a whole milestone, and a batch id that does
 * not reach both rows makes undo act on half a tap.
 *
 * Each assertion has a control: the slot is paired with the same recipe logged
 * into a different one, and the shared batch id with the two ids that must
 * NOT be shared.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildRecipeLogEntry } from '../../app/lib/recipe-log';
import type { RecipeProposal } from '../../app/services/vision/recipe-schema';

/** The weight one serving of the fixture is estimated at. Inside the servable range. */
const SERVING_GRAMS = 350;

const RECIPE: RecipeProposal = {
  title: 'Spinach omelette',
  servings: 2,
  servingGrams: SERVING_GRAMS,
  ingredients: [
    { name: 'Eggs', amount: 3, unit: 'piece', fromPantry: true },
    { name: 'Olive oil', amount: 1, unit: 'tbsp', fromPantry: false },
  ],
  steps: ['Beat the eggs.', 'Cook them.'],
  perServing: { kcal: 320, proteinG: 22, carbsG: 4, fiberG: 2, fatG: 24 },
  whyItFits: 'High in protein, which is what is still open today.',
  prepMinutes: 10,
};

const IDS = { foodId: 'food-1', logId: 'log-1', logBatchId: 'batch-1' };
const NOW = 1_757_000_000_000;

function build(slot: 'breakfast' | 'lunch' | 'dinner' | 'snack', dayKey = '2026-09-17', servingsEaten = 1) {
  return buildRecipeLogEntry({ recipe: RECIPE, servingsEaten, slot, dayKey, now: NOW, ids: IDS });
}

describe('buildRecipeLogEntry', () => {
  it('writes a food and a log sharing one batch id', () => {
    const { food, log } = build('dinner');

    assert.equal(log.logBatchId, IDS.logBatchId);
    assert.equal(log.foodId, food.id);
    // The control: the two row ids are NOT the batch id, so "they share one
    // id" is a claim about the batch rather than about everything being equal.
    assert.notEqual(food.id, log.id);
    assert.notEqual(log.id, log.logBatchId);
  });

  it('lands in the requested slot on the requested day', () => {
    const dinner = build('dinner');
    assert.equal(dinner.log.mealType, 'dinner');
    assert.equal(dinner.log.dayKey, '2026-09-17');

    // THE CONTROL. The same recipe asked for a different slot and a different
    // day answers differently, so the slot is threaded rather than constant.
    const breakfast = build('breakfast', '2026-09-18');
    assert.equal(breakfast.log.mealType, 'breakfast');
    assert.equal(breakfast.log.dayKey, '2026-09-18');
  });

  it('logs ONE serving at its estimated weight, with the macros the card showed', () => {
    const { food, log } = build('lunch');

    assert.equal(log.quantityGrams, SERVING_GRAMS);
    assert.deepEqual(log.portion, { unit: 'serving', quantity: 1, gramsPerUnit: SERVING_GRAMS });
    assert.equal(log.macros.kcal, 320);
    assert.equal(log.macros.protein, 22);
    assert.equal(log.macros.fat, 24);
    // Net carbs plus fibre, so every reader's compute-from-parts fallback
    // lands back on the model's own net figure of 4.
    assert.equal(log.macros.carbs, 6);
    assert.equal(log.macros.fiber, 2);
    // THE FOOD IS PER 100 G AND THE LOG IS PER SERVING, and they are no longer
    // the same number: 320 kcal in 350 g is 91.4 per 100 g. That difference is
    // the whole point of M233/06, so it is asserted rather than assumed.
    assert.equal(food.macrosPer100g.kcal, 91.4);
    assert.notEqual(food.macrosPer100g.kcal, log.macros.kcal);
    // Never fabricated: nothing here knows the sugars or the polyols.
    assert.equal(log.macros.sugars, null);
    assert.equal(log.macros.polyols, null);
  });

  it('scales the weight, the portion and the macros by the servings eaten', () => {
    const { food, log } = build('lunch', '2026-09-17', 1.5);

    assert.equal(log.quantityGrams, SERVING_GRAMS * 1.5);
    assert.deepEqual(log.portion, { unit: 'serving', quantity: 1.5, gramsPerUnit: SERVING_GRAMS });
    assert.equal(log.macros.kcal, 480);
    assert.equal(log.macros.protein, 33);
    // THE FOOD ROW DOES NOT MOVE. It describes 100 g of the dish, which is the
    // same dish however much of it somebody ate, and a per-100 g row that
    // scaled with the portion would double-count on every read.
    assert.equal(food.macrosPer100g.kcal, 91.4);

    // THE CONTROL. One whole serving answers with the unscaled figures, so
    // every assertion above is about the count being threaded rather than
    // about a constant that happens to read 1.5.
    const one = build('lunch');
    assert.equal(one.log.quantityGrams, SERVING_GRAMS);
    assert.equal(one.log.portion?.quantity, 1);
    assert.equal(one.log.macros.kcal, 320);
  });

  it('declares itself an estimate, the way a scanned plate does', () => {
    const { food, log } = build('lunch');

    assert.equal(food.source, 'plate_ai');
    assert.equal(log.source, 'plate_ai');
    assert.equal(log.aiEstimated, true);
    assert.equal(log.curatedSource, null);
    assert.equal(food.brand, null);
    // No upstream source committed to a net-carb figure, so none is claimed.
    assert.equal(log.netCarbsPer100g, undefined);
    assert.equal(food.netCarbsPer100g, undefined);
  });

  it('stamps one instant on every row: this is one act', () => {
    const { food, log } = build('snack');
    assert.equal(food.createdAt, NOW);
    assert.equal(log.createdAt, NOW);
    assert.equal(log.loggedAt, NOW);
  });

  it('names the food after the recipe', () => {
    const { food, log } = build('dinner');
    assert.equal(food.name, RECIPE.title);
    assert.equal(log.name, RECIPE.title);
  });
});
