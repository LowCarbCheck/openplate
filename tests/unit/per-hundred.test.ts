/**
 * Unit tests for `#app/lib/per-hundred` — reconstructing a per-100g macro basis
 * from a per-serving snapshot. No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { reconstructPer100g } from '../../app/lib/per-hundred';
import type { Macros } from '../../app/lib/macros';

function makeMacros(overrides: Partial<Macros> = {}): Macros {
  return {
    carbs: 10,
    fiber: 2,
    sugars: 5,
    polyols: 1,
    protein: 8,
    fat: 4,
    kcal: 120,
    ...overrides,
  };
}

describe('reconstructPer100g', () => {
  it('scales a snapshot up to a per-100g basis', () => {
    const basis = reconstructPer100g(makeMacros(), 50);
    assert.deepStrictEqual(basis, {
      carbs: 20,
      fiber: 4,
      sugars: 10,
      polyols: 2,
      protein: 16,
      fat: 8,
      kcal: 240,
    });
  });

  it('is the identity when the snapshot is already for 100 g', () => {
    const snapshot = makeMacros();
    assert.deepStrictEqual(reconstructPer100g(snapshot, 100), snapshot);
  });

  it('keeps unknown (null) macro fields null — never fabricates 0', () => {
    const basis = reconstructPer100g(makeMacros({ fiber: null, protein: null }), 50);
    assert.strictEqual(basis?.fiber, null);
    assert.strictEqual(basis?.protein, null);
    assert.strictEqual(basis?.carbs, 20);
  });

  it('returns null when carbs are unknown but preserves other fields otherwise', () => {
    const basis = reconstructPer100g(makeMacros({ carbs: null }), 50);
    // carbs null stays null; the basis object itself is still returned.
    assert.strictEqual(basis?.carbs, null);
    assert.strictEqual(basis?.protein, 16);
  });

  it('returns a null basis for zero grams (division is undefined)', () => {
    assert.strictEqual(reconstructPer100g(makeMacros(), 0), null);
  });

  it('returns a null basis for negative or non-finite grams', () => {
    assert.strictEqual(reconstructPer100g(makeMacros(), -30), null);
    assert.strictEqual(reconstructPer100g(makeMacros(), Number.NaN), null);
    assert.strictEqual(reconstructPer100g(makeMacros(), Number.POSITIVE_INFINITY), null);
  });

  it('returns an all-null basis (not null) for an all-unknown snapshot at valid grams', () => {
    const allUnknown: Macros = {
      carbs: null,
      fiber: null,
      sugars: null,
      polyols: null,
      protein: null,
      fat: null,
      kcal: null,
    };
    assert.deepStrictEqual(reconstructPer100g(allUnknown, 80), allUnknown);
  });
});
