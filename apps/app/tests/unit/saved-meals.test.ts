/**
 * Saved-meal create/re-log round-trip (M123/07 item 1) — pure coverage of
 * `buildSavedMealFromLogs`/`buildLogsFromSavedMeal` (`#app/lib/local-store/
 * saved-meals`). No store, no browser: every impure input (ids, "now") is
 * passed in, mirroring `copy-day.test.ts`'s own precedent for the sibling
 * "bring entries forward" feature.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildLogsFromSavedMeal, buildSavedMealFromLogs } from '../../app/lib/local-store/saved-meals';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

const DAY = '2026-08-24';

/** A complete food log for `DAY`; override any field per test. */
function log(id: string, overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id,
    name: id,
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal: 120 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: DAY,
    loggedAt: Date.parse(`${DAY}T12:00:00Z`),
    createdAt: Date.parse(`${DAY}T12:00:00Z`),
    logBatchId: null,
    ...overrides,
  };
}

describe('buildSavedMealFromLogs', () => {
  it('snapshots every entry into an item, preserving order and the whole field set a re-log needs', () => {
    const eggs = log('eggs', {
      name: 'Eggs',
      quantityGrams: 120,
      macros: { carbs: 1, fiber: 0, sugars: 0, polyols: null, protein: 12, fat: 10, kcal: 150 },
      source: 'manual',
      curatedSource: 'lowcarbcheck:eggs',
      foodId: 'food-eggs',
      attribution: 'lowcarbcheck.org',
      netCarbsPer100g: 0.8,
      // M123/13 review finding 6: `saved-meals.ts` already carries these
      // three fields through (see `buildSavedMealFromLogs`), but nothing
      // asserted it — so a future edit dropping any one of them, the exact
      // class of bug findings 1-4 were, would pass this file silently.
      portion: { unit: 'egg', quantity: 2, gramsPerUnit: 60 },
      carbBasis: 'available',
      micronutrientsPer100g: {
        vitamins: {
          betaCarotene: null,
          vitaminA: 140,
          vitaminC: null,
          vitaminD: 1.8,
          vitaminE: null,
          vitaminB1: null,
          vitaminB2: null,
          vitaminB6: null,
          vitaminB9: null,
          vitaminB12: 0.9,
        },
        minerals: {
          nacl: null,
          potassium: null,
          sodium: 124,
          calcium: null,
          magnesium: null,
          zinc: null,
          phosphorus: null,
          iron: null,
        },
      },
    });
    const toast = log('toast', {
      name: 'Toast',
      quantityGrams: 60,
      macros: { carbs: 20, fiber: 2, sugars: 1, polyols: null, protein: 4, fat: 2, kcal: 130 },
    });

    const meal = buildSavedMealFromLogs({ logs: [eggs, toast], name: 'Sunday breakfast', id: 'meal-1', createdAtMs: 1000 });

    assert.equal(meal.id, 'meal-1');
    assert.equal(meal.name, 'Sunday breakfast');
    assert.equal(meal.createdAt, 1000);
    assert.equal(meal.items.length, 2);

    // Order preserved.
    assert.deepEqual(
      meal.items.map((item) => item.name),
      ['Eggs', 'Toast'],
    );

    // Every field a re-log needs travelled through, unchanged.
    const eggsItem = meal.items[0];
    assert.ok(eggsItem);
    assert.equal(eggsItem.quantityGrams, 120);
    assert.deepEqual(eggsItem.macros, eggs.macros);
    assert.equal(eggsItem.curatedSource, 'lowcarbcheck:eggs');
    assert.equal(eggsItem.foodId, 'food-eggs');
    assert.equal(eggsItem.attribution, 'lowcarbcheck.org');
    assert.equal(eggsItem.netCarbsPer100g, 0.8);
    assert.deepEqual(eggsItem.portion, { unit: 'egg', quantity: 2, gramsPerUnit: 60 });
    assert.equal(eggsItem.carbBasis, 'available');
    assert.deepEqual(eggsItem.micronutrientsPer100g, eggs.micronutrientsPer100g);
  });

  it('carries no placement — an item has no dayKey/loggedAt/mealType/logBatchId of its own', () => {
    const meal = buildSavedMealFromLogs({ logs: [log('a')], name: 'Snack', id: 'meal-2', createdAtMs: 0 });
    const item = meal.items[0];
    assert.ok(item);
    assert.equal(Object.hasOwn(item, 'dayKey'), false);
    assert.equal(Object.hasOwn(item, 'loggedAt'), false);
    assert.equal(Object.hasOwn(item, 'mealType'), false);
    assert.equal(Object.hasOwn(item, 'logBatchId'), false);
  });
});

describe('buildLogsFromSavedMeal', () => {
  it('re-logs to the correct set of new log entries — one per item, fresh ids, shared placement and batch id', () => {
    const eggs = log('eggs', { name: 'Eggs', quantityGrams: 120 });
    const toast = log('toast', { name: 'Toast', quantityGrams: 60 });
    const meal = buildSavedMealFromLogs({ logs: [eggs, toast], name: 'Sunday breakfast', id: 'meal-1', createdAtMs: 1000 });

    let nextId = 0;
    const makeId = () => `fresh-${nextId++}`;
    const loggedAtMs = Date.parse('2026-08-25T08:00:00Z');

    const relogged = buildLogsFromSavedMeal({
      meal,
      makeId,
      dayKey: '2026-08-25',
      loggedAtMs,
      mealType: 'breakfast',
      logBatchId: 'batch-1',
      createdAtMs: loggedAtMs,
    });

    // Correct COUNT — one entry per saved-meal item.
    assert.equal(relogged.length, 2);

    // Correct SET — names/quantities preserved, in the meal's own item order.
    assert.deepEqual(
      relogged.map((entry) => [entry.name, entry.quantityGrams]),
      [
        ['Eggs', 120],
        ['Toast', 60],
      ],
    );

    // Fresh ids — never the original logs' ids, never each other's.
    assert.deepEqual(
      relogged.map((entry) => entry.id),
      ['fresh-0', 'fresh-1'],
    );
    for (const entry of relogged) {
      assert.notEqual(entry.id, 'eggs');
      assert.notEqual(entry.id, 'toast');
    }

    // Shared placement: every entry lands on the same day/time/meal.
    for (const entry of relogged) {
      assert.equal(entry.dayKey, '2026-08-25');
      assert.equal(entry.loggedAt, loggedAtMs);
      assert.equal(entry.mealType, 'breakfast');
      assert.equal(entry.createdAt, loggedAtMs);
    }

    // Shared batch id — so the whole re-log undoes as one unit, the same
    // `logBatchId` contract copy-yesterday's batches already rely on.
    assert.deepEqual(
      relogged.map((entry) => entry.logBatchId),
      ['batch-1', 'batch-1'],
    );
  });

  it('is a template, not a live reference — the same saved meal re-logs identically twice', () => {
    const meal = buildSavedMealFromLogs({ logs: [log('a', { name: 'Oats' })], name: 'Breakfast', id: 'meal-3', createdAtMs: 0 });

    let counter = 0;
    const makeId = () => `id-${counter++}`;

    const first = buildLogsFromSavedMeal({
      meal,
      makeId,
      dayKey: '2026-08-24',
      loggedAtMs: 1_000,
      mealType: 'breakfast',
      logBatchId: 'batch-a',
      createdAtMs: 1_000,
    });
    const second = buildLogsFromSavedMeal({
      meal,
      makeId,
      dayKey: '2026-08-25',
      loggedAtMs: 2_000,
      mealType: 'lunch',
      logBatchId: 'batch-b',
      createdAtMs: 2_000,
    });

    assert.equal(first[0]?.name, 'Oats');
    assert.equal(second[0]?.name, 'Oats');
    assert.notEqual(first[0]?.id, second[0]?.id);
    assert.notEqual(first[0]?.dayKey, second[0]?.dayKey);
  });
});
