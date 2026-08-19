/**
 * Unit tests for `#app/lib/macro-ratio` — the pure percentage math behind the
 * diary hero's `MacroRatioBar` segment widths.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeMacroRatioPercentages } from '../../app/lib/macro-ratio';

describe('computeMacroRatioPercentages', () => {
  it('splits grams into percentages of the total, summing to 100', () => {
    const result = computeMacroRatioPercentages({ carbs: 50, protein: 25, fat: 15, fiber: 10 });
    assert.ok(result);
    assert.equal(result.carbs, 50);
    assert.equal(result.protein, 25);
    assert.equal(result.fat, 15);
    assert.equal(result.fiber, 10);
    assert.equal(result.carbs + result.protein + result.fat + result.fiber, 100);
  });

  it('handles an uneven split without losing precision beyond floating point', () => {
    const result = computeMacroRatioPercentages({ carbs: 1, protein: 1, fat: 1, fiber: 0 });
    assert.ok(result);
    assert.equal(Math.round(result.carbs), 33);
    assert.equal(Math.round(result.protein), 33);
    assert.equal(Math.round(result.fat), 33);
    assert.equal(result.fiber, 0);
  });

  it('returns null when every value is zero (nothing to ratio)', () => {
    assert.equal(computeMacroRatioPercentages({ carbs: 0, protein: 0, fat: 0, fiber: 0 }), null);
  });

  it('returns null when totals are negative (guarded, never a negative-width segment)', () => {
    assert.equal(computeMacroRatioPercentages({ carbs: -5, protein: 0, fat: 0, fiber: 0 }), null);
  });

  it('gives a single macro its full 100% share when it is the only one logged', () => {
    const result = computeMacroRatioPercentages({ carbs: 40, protein: 0, fat: 0, fiber: 0 });
    assert.ok(result);
    assert.equal(result.carbs, 100);
    assert.equal(result.protein, 0);
    assert.equal(result.fat, 0);
    assert.equal(result.fiber, 0);
  });
});
