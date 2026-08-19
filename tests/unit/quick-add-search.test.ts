/**
 * Unit tests for `#app/lib/quick-add-search` — the pure per-serving →
 * per-100g un-scaling shared by the local-store-backed quick add. No DB,
 * network, or React.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { snapshotToPer100gAtGrams } from '../../app/lib/quick-add-search';
import type { Macros } from '../../app/lib/macros';

function makeMacros(overrides: Partial<Macros> = {}): Macros {
  return { carbs: 5, fiber: 1, sugars: null, polyols: null, protein: 20, fat: 3, kcal: 130, ...overrides };
}

describe('snapshotToPer100gAtGrams', () => {
  it('recovers the per-100g basis from a per-serving snapshot', () => {
    const per100g = snapshotToPer100gAtGrams({
      snapshot: makeMacros({ carbs: 15, protein: 45, fat: 6, kcal: 240, fiber: 3 }),
      grams: 150,
    });
    assert.strictEqual(per100g.carbs, 10);
    assert.strictEqual(per100g.protein, 30);
    assert.strictEqual(per100g.fat, 4);
    assert.strictEqual(per100g.kcal, 160);
    assert.strictEqual(per100g.fiber, 2);
  });

  it('keeps null snapshot fields null (never fabricates 0)', () => {
    const per100g = snapshotToPer100gAtGrams({
      snapshot: makeMacros({ carbs: null, sugars: null }),
      grams: 100,
    });
    assert.strictEqual(per100g.carbs, null);
    assert.strictEqual(per100g.sugars, null);
  });

  it('returns all-null macros for a non-positive serving size (can not un-scale)', () => {
    const per100g = snapshotToPer100gAtGrams({ snapshot: makeMacros(), grams: 0 });
    assert.deepStrictEqual(per100g, {
      carbs: null,
      fiber: null,
      sugars: null,
      polyols: null,
      protein: null,
      fat: null,
      kcal: null,
    });
  });
});
