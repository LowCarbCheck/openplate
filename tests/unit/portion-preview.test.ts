/**
 * Unit tests for `#app/lib/portion-preview` — the pure portion-scaling and
 * macro-preview core behind the scan confirm step. No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PORTION_SCALE_OPTIONS,
  computeMacroPreview,
  derivePortionMultiplier,
  scalePortionGrams,
  summarizeIncludedPortions,
} from '../../app/lib/portion-preview';
import type { Macros } from '../../app/lib/macros';

function makeMacros(overrides: Partial<Macros> = {}): Macros {
  return {
    carbs: 10,
    fiber: 2,
    sugars: null,
    polyols: null,
    protein: 8,
    fat: 4,
    kcal: 120,
    ...overrides,
  };
}

describe('PORTION_SCALE_OPTIONS', () => {
  it('offers exactly the four human-scale multipliers with a single default', () => {
    assert.deepStrictEqual(
      PORTION_SCALE_OPTIONS.map((option) => option.multiplier),
      [0.5, 1, 1.5, 2],
    );
    assert.strictEqual(PORTION_SCALE_OPTIONS.filter((option) => option.isDefault).length, 1);
    assert.strictEqual(PORTION_SCALE_OPTIONS.find((option) => option.isDefault)?.multiplier, 1);
  });
});

describe('scalePortionGrams', () => {
  it('scales the base estimate by the chip multiplier', () => {
    assert.strictEqual(scalePortionGrams(150, 0.5), 75);
    assert.strictEqual(scalePortionGrams(150, 1), 150);
    assert.strictEqual(scalePortionGrams(150, 1.5), 225);
    assert.strictEqual(scalePortionGrams(150, 2), 300);
  });

  it('rounds to one decimal', () => {
    assert.strictEqual(scalePortionGrams(65, 0.5), 32.5);
  });
});

describe('derivePortionMultiplier', () => {
  it('selects the chip whose scaled grams match the current grams', () => {
    assert.strictEqual(derivePortionMultiplier({ baseGrams: 150, currentGrams: 150 }), 1);
    assert.strictEqual(derivePortionMultiplier({ baseGrams: 150, currentGrams: 75 }), 0.5);
    assert.strictEqual(derivePortionMultiplier({ baseGrams: 150, currentGrams: 300 }), 2);
  });

  it('returns null when a manual grams edit matches no chip', () => {
    assert.strictEqual(derivePortionMultiplier({ baseGrams: 150, currentGrams: 200 }), null);
  });

  it('tolerates one-decimal rounding when matching', () => {
    // base 65 -> 0.5x = 32.5; a manually-typed 32.5 should still select the chip.
    assert.strictEqual(derivePortionMultiplier({ baseGrams: 65, currentGrams: 32.5 }), 0.5);
  });
});

describe('computeMacroPreview', () => {
  it('computes per-portion net carbs on the per-100g color basis', () => {
    const preview = computeMacroPreview({ macrosPer100g: makeMacros(), grams: 200 });
    assert.ok(preview);
    // net carbs/100g = 10 - 2 - 0 = 8 (used for the color)
    assert.strictEqual(preview.netCarbsPer100g, 8);
    // per portion (200g) = 8 * 200 / 100 = 16
    assert.strictEqual(preview.netCarbsForPortion, 16);
    assert.strictEqual(preview.proteinForPortion, 16);
    assert.strictEqual(preview.fatForPortion, 8);
    assert.strictEqual(preview.kcalForPortion, 240);
  });

  it('floors net carbs at zero (fiber + polyols exceeding carbs)', () => {
    const preview = computeMacroPreview({
      macrosPer100g: makeMacros({ carbs: 3, fiber: 4, polyols: 2 }),
      grams: 100,
    });
    assert.ok(preview);
    assert.strictEqual(preview.netCarbsPer100g, 0);
    assert.strictEqual(preview.netCarbsForPortion, 0);
  });

  it('keeps unknown macros null rather than fabricating 0', () => {
    const preview = computeMacroPreview({
      macrosPer100g: makeMacros({ protein: null, fat: null, kcal: null }),
      grams: 100,
    });
    assert.ok(preview);
    assert.strictEqual(preview.proteinForPortion, null);
    assert.strictEqual(preview.fatForPortion, null);
    assert.strictEqual(preview.kcalForPortion, null);
  });

  it('returns null when carbs are unknown (macros unknown — name only)', () => {
    const preview = computeMacroPreview({ macrosPer100g: makeMacros({ carbs: null }), grams: 100 });
    assert.strictEqual(preview, null);
  });

  describe('authoritativeNetCarbsPer100g override', () => {
    it('uses the authoritative figure instead of the local carbs-fiber-polyols formula (the almonds regression: bls/curated carbs are already fiber-exclusive)', () => {
      // A bls/curated-origin food reports fiber-EXCLUSIVE carbs already —
      // subtracting fiber again here would double-subtract it. `carbs: 6,
      // fiber: 12` mirrors real almonds-shaped data where the naive formula
      // (6 - 12, floored at 0) would wrongly render 0g net carbs on screen
      // while LCC's own origin-aware figure is 5g.
      const preview = computeMacroPreview({
        macrosPer100g: makeMacros({ carbs: 6, fiber: 12 }),
        grams: 100,
        authoritativeNetCarbsPer100g: 5,
      });
      assert.ok(preview);
      assert.strictEqual(preview.netCarbsPer100g, 5);
      assert.strictEqual(preview.netCarbsForPortion, 5);
      // Protein/fat/kcal still come from the actual macros, unaffected by the override.
      assert.strictEqual(preview.proteinForPortion, 8);
    });

    it('scales the authoritative figure to the requested portion, not just per-100g', () => {
      const preview = computeMacroPreview({
        macrosPer100g: makeMacros({ carbs: 6, fiber: 12 }),
        grams: 200,
        authoritativeNetCarbsPer100g: 5,
      });
      assert.ok(preview);
      assert.strictEqual(preview.netCarbsForPortion, 10);
    });

    it('treats an explicit null override as "unknown" — never fabricates 0 — even when carbs itself is known', () => {
      const preview = computeMacroPreview({
        macrosPer100g: makeMacros({ carbs: 6, fiber: 12 }),
        grams: 100,
        authoritativeNetCarbsPer100g: null,
      });
      assert.strictEqual(preview, null);
    });

    it('omitting the argument entirely preserves the original self-computed formula (personal/recent foods, AI estimates — no upstream figure exists)', () => {
      const preview = computeMacroPreview({ macrosPer100g: makeMacros(), grams: 100 });
      assert.ok(preview);
      // Same result as the very first test in this describe block, with no override supplied.
      assert.strictEqual(preview.netCarbsPer100g, 8);
    });
  });
});

describe('summarizeIncludedPortions', () => {
  it('counts and totals only the included items', () => {
    const result = summarizeIncludedPortions([
      { included: true, netCarbsForPortion: 5 },
      { included: false, netCarbsForPortion: 100 },
      { included: true, netCarbsForPortion: 2.5 },
    ]);
    assert.deepStrictEqual(result, { count: 2, netCarbs: 7.5 });
  });

  it('counts an included unknown-carb item without adding to net carbs', () => {
    const result = summarizeIncludedPortions([
      { included: true, netCarbsForPortion: null },
      { included: true, netCarbsForPortion: 4 },
    ]);
    assert.deepStrictEqual(result, { count: 2, netCarbs: 4 });
  });

  it('returns zeros when nothing is included', () => {
    const result = summarizeIncludedPortions([{ included: false, netCarbsForPortion: 9 }]);
    assert.deepStrictEqual(result, { count: 0, netCarbs: 0 });
  });
});
