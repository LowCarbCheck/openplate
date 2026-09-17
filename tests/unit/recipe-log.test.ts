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

import { buildRecipeLogEntry, RECIPE_SERVING_NOMINAL_GRAMS } from '../../app/lib/recipe-log';
import type { RecipeProposal } from '../../app/services/vision/recipe-schema';

const RECIPE: RecipeProposal = {
  title: 'Spinach omelette',
  servings: 2,
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

function build(slot: 'breakfast' | 'lunch' | 'dinner' | 'snack', dayKey = '2026-09-17') {
  return buildRecipeLogEntry({ recipe: RECIPE, slot, dayKey, now: NOW, ids: IDS });
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

  it('logs ONE serving, with the per-serving macros the card showed', () => {
    const { food, log } = build('lunch');

    assert.equal(log.quantityGrams, RECIPE_SERVING_NOMINAL_GRAMS);
    assert.deepEqual(log.portion, { unit: 'serving', quantity: 1, gramsPerUnit: RECIPE_SERVING_NOMINAL_GRAMS });
    assert.equal(log.macros.kcal, 320);
    assert.equal(log.macros.protein, 22);
    assert.equal(log.macros.fat, 24);
    // Net carbs plus fibre, so every reader's compute-from-parts fallback
    // lands back on the model's own net figure of 4.
    assert.equal(log.macros.carbs, 6);
    assert.equal(log.macros.fiber, 2);
    // The serving IS the 100 g, so the food carries the same figures.
    assert.equal(food.macrosPer100g.kcal, 320);
    // Never fabricated: nothing here knows the sugars or the polyols.
    assert.equal(log.macros.sugars, null);
    assert.equal(log.macros.polyols, null);
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
