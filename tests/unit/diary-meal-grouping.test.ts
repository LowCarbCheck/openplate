/**
 * Focused coverage for `groupLogsByMeal` (M123/07 item 1): a mixed-meal-type
 * log set groups correctly AND each group's subtotal is computed from only
 * that group's own entries — the defect class this test targets is a
 * subtotal that accidentally sums across meal boundaries (e.g. reusing the
 * day-level total, or carrying a running sum forward between groups).
 *
 * `diary-route.test.ts` already covers `groupLogsByMeal`'s ordering/empty-
 * group/preserved-order behaviour; this file's job is the specific claim the
 * M123/07 spec checklist names — correct PER-MEAL SUBTOTALS from a set that
 * spans every meal type in one day — with a scenario deliberately larger than
 * one entry per meal, so a subtotal bug that only shows up with 2+ entries in
 * a group has somewhere to hide.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { groupLogsByMeal } from '../../app/routes/diary';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

const DAY = '2026-08-24';

/** A complete food log for `DAY`; override any field per test. */
function log(id: string, overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id,
    name: id,
    quantityGrams: 100,
    macros: { carbs: 0, fiber: 0, sugars: 0, polyols: null, protein: 0, fat: 0, kcal: 0 },
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

/** Shorthand for a log whose only load-bearing field for this file is its net-carb-contributing macros. */
function withCarbs(id: string, mealType: LocalFoodLog['mealType'], carbs: number, fiber = 0): LocalFoodLog {
  return log(id, {
    mealType,
    macros: { carbs, fiber, sugars: 0, polyols: null, protein: 0, fat: 0, kcal: carbs * 4 },
  });
}

describe('groupLogsByMeal — per-meal subtotals from a mixed-meal-type set', () => {
  it('sums each meal group\'s net carbs from only its own entries, across all five buckets', () => {
    const logs: LocalFoodLog[] = [
      // Breakfast: two entries, 10 + 15 net carbs = 25.
      withCarbs('b1', 'breakfast', 10),
      withCarbs('b2', 'breakfast', 15),
      // Lunch: one entry with fibre — net carbs is carbs minus fibre.
      withCarbs('l1', 'lunch', 40, 8),
      // Dinner: three entries, 5 + 5 + 5 = 15.
      withCarbs('d1', 'dinner', 5),
      withCarbs('d2', 'dinner', 5),
      withCarbs('d3', 'dinner', 5),
      // Snack: one entry.
      withCarbs('s1', 'snack', 3),
      // No meal set: one entry, its own bucket.
      withCarbs('n1', null, 7),
    ];

    const groups = groupLogsByMeal(logs);

    // Structure: every bucket present, in the fixed breakfast → … → no-meal order.
    assert.deepEqual(
      groups.map((group) => group.mealType),
      ['breakfast', 'lunch', 'dinner', 'snack', null],
    );

    // Each entry landed in the right bucket — a mis-grouped entry would
    // silently corrupt a neighbouring subtotal without failing a naive count.
    assert.deepEqual(
      groups.find((group) => group.mealType === 'breakfast')?.logs.map((entry) => entry.id),
      ['b1', 'b2'],
    );
    assert.deepEqual(
      groups.find((group) => group.mealType === 'dinner')?.logs.map((entry) => entry.id),
      ['d1', 'd2', 'd3'],
    );

    // The actual claim: each group's subtotal reflects ONLY its own entries.
    assert.equal(groups.find((group) => group.mealType === 'breakfast')?.subtotal.netCarbs, 25);
    assert.equal(groups.find((group) => group.mealType === 'lunch')?.subtotal.netCarbs, 32); // 40 - 8 fibre
    assert.equal(groups.find((group) => group.mealType === 'dinner')?.subtotal.netCarbs, 15);
    assert.equal(groups.find((group) => group.mealType === 'snack')?.subtotal.netCarbs, 3);
    assert.equal(groups.find((group) => group.mealType === null)?.subtotal.netCarbs, 7);

    // The defect this test exists to catch: the single-entry snack bucket's
    // subtotal is NOT the day total (25 + 32 + 15 + 3 + 7 = 82) — a running
    // sum accidentally carried forward between groups would fail this.
    assert.notEqual(groups.find((group) => group.mealType === 'snack')?.subtotal.netCarbs, 82);
  });
});
