/**
 * Unit tests for `#app/lib/macro-ratio` — the pure percentage math behind the
 * diary hero's `MacroRatioBar` segment widths.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeMacroRatioPercentages, computeMacroShares, percentOfShare } from '../../app/lib/macro-ratio';
import type { MacroShares } from '../../app/lib/macro-ratio';

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

/** The percent of one macro in a share, failing the test if the macro has no segment. */
function percentOf(shares: MacroShares, key: 'carbs' | 'fiber' | 'protein' | 'fat'): number {
  const percent = percentOfShare({ shares, key });
  assert.ok(percent !== null, `${key} should have a segment on the ${shares.basis} basis`);
  return percent;
}

describe('computeMacroShares', () => {
  const HUNDRED_EACH = { carbs: 100, protein: 100, fat: 100, fiber: 0 };

  it('weighs 100 g of each macro by 4, 4 and 9 kcal on the calorie basis (24, 24, 53)', () => {
    const shares = computeMacroShares(HUNDRED_EACH, 'kcal');
    assert.ok(shares);
    assert.equal(Math.round(percentOf(shares, 'carbs')), 24);
    assert.equal(Math.round(percentOf(shares, 'protein')), 24);
    assert.equal(Math.round(percentOf(shares, 'fat')), 53);
  });

  it('control: the gram basis of the same day is a third each, so the two bases differ', () => {
    const shares = computeMacroShares(HUNDRED_EACH, 'grams');
    assert.ok(shares);
    assert.equal(Math.round(percentOf(shares, 'carbs')), 33);
    assert.equal(Math.round(percentOf(shares, 'protein')), 33);
    assert.equal(Math.round(percentOf(shares, 'fat')), 33);
  });

  it('draws three segments by calories and four by grams, in the diary order', () => {
    const kcal = computeMacroShares({ ...HUNDRED_EACH, fiber: 20 }, 'kcal');
    const grams = computeMacroShares({ ...HUNDRED_EACH, fiber: 20 }, 'grams');
    assert.ok(kcal && grams);
    assert.deepEqual(
      kcal.segments.map((segment) => segment.key),
      ['carbs', 'protein', 'fat'],
    );
    assert.deepEqual(
      grams.segments.map((segment) => segment.key),
      ['carbs', 'fiber', 'protein', 'fat'],
    );
  });

  it('leaves fibre out of the calorie share even when a lot of fibre was logged', () => {
    const lowFibre = computeMacroShares({ carbs: 50, protein: 25, fat: 10, fiber: 0 }, 'kcal');
    const highFibre = computeMacroShares({ carbs: 50, protein: 25, fat: 10, fiber: 45 }, 'kcal');
    assert.ok(lowFibre && highFibre);
    assert.deepEqual(highFibre, lowFibre);
    assert.equal(percentOfShare({ shares: highFibre, key: 'fiber' }), null);
    // Control: the gram basis DOES move with fibre, so the equality above is a finding.
    const gramsLow = computeMacroShares({ carbs: 50, protein: 25, fat: 10, fiber: 0 }, 'grams');
    const gramsHigh = computeMacroShares({ carbs: 50, protein: 25, fat: 10, fiber: 45 }, 'grams');
    assert.notDeepEqual(gramsHigh, gramsLow);
  });

  it('sums the calorie segments to 100', () => {
    const shares = computeMacroShares({ carbs: 12.4, protein: 31, fat: 18.2, fiber: 3 }, 'kcal');
    assert.ok(shares);
    const total = shares.segments.reduce((sum, segment) => sum + segment.percent, 0);
    assert.ok(Math.abs(total - 100) < 1e-9, `got ${total}`);
  });

  it('gives null when there is no energy, on both bases', () => {
    assert.equal(computeMacroShares({ carbs: 0, protein: 0, fat: 0, fiber: 0 }, 'kcal'), null);
    assert.equal(computeMacroShares({ carbs: 0, protein: 0, fat: 0, fiber: 0 }, 'grams'), null);
  });

  it('gives null by calories for a day of fibre alone, where grams still draw it', () => {
    assert.equal(computeMacroShares({ carbs: 0, protein: 0, fat: 0, fiber: 5 }, 'kcal'), null);
    assert.notEqual(computeMacroShares({ carbs: 0, protein: 0, fat: 0, fiber: 5 }, 'grams'), null);
  });
});
