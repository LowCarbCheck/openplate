/**
 * Unit tests for `#app/lib/portions/serving-macros` — package-label macro
 * entry: typing macros per 100 g OR per the label's own serving size
 * ("per serving (30 g): 120 kcal"), converted internally to per-100g.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveMacrosPer100gFromEntry } from '../../app/lib/portions/serving-macros';
import type { Macros } from '../../app/lib/macros';

function makeMacros(overrides: Partial<Macros> = {}): Macros {
  return { carbs: 12, fiber: 3, sugars: 5, polyols: null, protein: 3, fat: 6, kcal: 120, ...overrides };
}

describe('resolveMacrosPer100gFromEntry', () => {
  it('passes per-100g entries straight through, unchanged', () => {
    const macros = makeMacros();
    assert.deepStrictEqual(resolveMacrosPer100gFromEntry({ basis: 'per100g', macros, servingGrams: 30 }), macros);
  });

  it('converts a per-serving label entry ("per serving (30 g): 120 kcal") to its per-100g basis', () => {
    // Label reads: per serving (30 g): 12g carbs, 3g fiber, 3g protein, 6g fat, 120 kcal.
    const per100g = resolveMacrosPer100gFromEntry({
      basis: 'perServing',
      macros: makeMacros(),
      servingGrams: 30,
    });
    assert.equal(per100g.carbs, 40);
    assert.equal(per100g.fiber, 10);
    assert.equal(per100g.protein, 10);
    assert.equal(per100g.fat, 20);
    assert.equal(per100g.kcal, 400);
  });

  it('keeps unknown macro fields null rather than fabricating a value', () => {
    const per100g = resolveMacrosPer100gFromEntry({
      basis: 'perServing',
      macros: makeMacros({ sugars: null, polyols: null }),
      servingGrams: 30,
    });
    assert.equal(per100g.sugars, null);
    assert.equal(per100g.polyols, null);
  });

  it('degrades to all-null macros for a non-positive serving size (never divides by zero)', () => {
    const per100g = resolveMacrosPer100gFromEntry({ basis: 'perServing', macros: makeMacros(), servingGrams: 0 });
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
