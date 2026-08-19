/**
 * Unit tests for `#app/lib/portions/default-portion` — resolving the "most
 * natural" default portion for a food (upstream `portionSize` > built-in
 * household table > plain-grams fallback).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_PORTION_GRAMS,
  defaultPortionGrams,
  resolveDefaultPortion,
} from '../../app/lib/portions/default-portion';

describe('resolveDefaultPortion', () => {
  it('prefers the upstream portionSize over the household table when a unit name matches', () => {
    const portion = resolveDefaultPortion({ name: 'Egg', portionSizeGrams: 55 });
    assert.deepStrictEqual(portion, { unit: 'egg', quantity: 1, gramsPerUnit: 55 });
  });

  it('falls back to the household table’s own reference weight when portionSize is unknown', () => {
    const portion = resolveDefaultPortion({ name: 'Egg', portionSizeGrams: null });
    assert.deepStrictEqual(portion, { unit: 'egg', quantity: 1, gramsPerUnit: 50 });
  });

  it('falls back to a generic "1 serving" sized by portionSize when no unit name matches', () => {
    const portion = resolveDefaultPortion({ name: 'Acerola', portionSizeGrams: 150 });
    assert.deepStrictEqual(portion, { unit: 'serving', quantity: 1, gramsPerUnit: 150 });
  });

  it('returns null when neither a unit name nor a portionSize is available (no defensible unit)', () => {
    const portion = resolveDefaultPortion({ name: 'Acerola', portionSizeGrams: null });
    assert.equal(portion, null);
  });

  it('ignores a non-positive portionSize when no unit name matches (never a zero/negative serving)', () => {
    assert.equal(resolveDefaultPortion({ name: 'Acerola', portionSizeGrams: 0 }), null);
    assert.equal(resolveDefaultPortion({ name: 'Acerola', portionSizeGrams: -5 }), null);
  });
});

describe('defaultPortionGrams', () => {
  it('returns the resolved portion’s total grams', () => {
    assert.equal(defaultPortionGrams({ name: 'Banana', portionSizeGrams: null }), 118);
    assert.equal(defaultPortionGrams({ name: 'Acerola', portionSizeGrams: 150 }), 150);
  });

  it(`falls back to FALLBACK_PORTION_GRAMS (${FALLBACK_PORTION_GRAMS}) when no unit can be resolved`, () => {
    assert.equal(defaultPortionGrams({ name: 'Acerola', portionSizeGrams: null }), FALLBACK_PORTION_GRAMS);
    assert.equal(FALLBACK_PORTION_GRAMS, 100);
  });
});
