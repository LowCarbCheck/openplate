/**
 * `computeMacroEnergySplit` and `computeRangeEnergySplit`
 * (`app/lib/macro-energy-split.ts`), the "where your calories come from" card
 * on the Nutrition tab (M239/03).
 *
 * Every claim has a control that a plausible wrong version fails:
 *
 * - the factors are 4/4/9, so a split by GRAMS (the diary's ratio bar) gives
 *   different, checked numbers;
 * - carbs are TOTAL carbs, so a version that used net carbs gives a different,
 *   checked number on a fiber-heavy day;
 * - a partial day is `null`, and the same day without the flag is not;
 * - the range figure is POOLED, so a mean of the daily shares gives a
 *   different, checked number.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeMacroEnergySplit, computeRangeEnergySplit } from '../../app/lib/macro-energy-split';
import type { MacroEnergyShares } from '../../app/lib/macro-energy-split';
import type { DaySummary } from '../../app/models/food-log-summary';

/** A day summary with every macro at zero unless named. */
function summary(overrides: Partial<DaySummary> = {}): DaySummary {
  return {
    carbs: 0,
    fiber: 0,
    polyols: 0,
    netCarbs: 0,
    protein: 0,
    fat: 0,
    kcal: 0,
    hasUnknowns: false,
    hasEstimates: false,
    ...overrides,
  };
}

/** The three shares added up. */
function totalOf(shares: MacroEnergyShares): number {
  return shares.protein + shares.carbs + shares.fat;
}

/** Asserts a share within a hundredth of a percent. */
function assertShare(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.01, `expected ${expected}, got ${actual}`);
}

describe('computeMacroEnergySplit', () => {
  it('weighs grams by 4, 4 and 9 kcal, not by grams alone', () => {
    // 100 g protein = 400 kcal, 100 g carbs = 400 kcal, 100 g fat = 900 kcal.
    // By grams this would be a third each; by energy fat is 900 / 1700.
    const shares = computeMacroEnergySplit(summary({ protein: 100, carbs: 100, netCarbs: 100, fat: 100 }));

    assert.ok(shares !== null);
    assertShare(shares.fat, (900 / 1700) * 100);
    assertShare(shares.protein, (400 / 1700) * 100);
    assertShare(shares.carbs, (400 / 1700) * 100);
  });

  it('adds up to 100', () => {
    const shares = computeMacroEnergySplit(summary({ protein: 83.3, carbs: 17.1, netCarbs: 9, fat: 121.7 }));

    assert.ok(shares !== null);
    assertShare(totalOf(shares), 100);
  });

  it('counts total carbs, the figure the app derives calories from, not net carbs', () => {
    // 50 g carbs of which 40 g fiber: net carbs are 10 g. With total carbs the
    // carb energy is 200 kcal beside 200 kcal of protein, a 50/50 split; with
    // net carbs it would be 40 kcal, about 17 percent.
    const shares = computeMacroEnergySplit(summary({ protein: 50, carbs: 50, fiber: 40, netCarbs: 10 }));

    assert.ok(shares !== null);
    assertShare(shares.carbs, 50);
  });

  it('gives null for a day with missing macros, and a split for the same day without the flag', () => {
    const grams = { protein: 60, carbs: 20, netCarbs: 15, fat: 70 };

    assert.strictEqual(computeMacroEnergySplit(summary({ ...grams, hasUnknowns: true })), null);
    assert.notStrictEqual(computeMacroEnergySplit(summary(grams)), null);
  });

  it('gives null for a day with nothing logged', () => {
    assert.strictEqual(computeMacroEnergySplit(null), null);
  });

  it('gives null for a logged day whose macros carry no energy, and never divides by zero', () => {
    assert.strictEqual(computeMacroEnergySplit(summary()), null);
  });

  it('keeps an AI-estimated day, which is hedged elsewhere and not a missing macro', () => {
    assert.notStrictEqual(computeMacroEnergySplit(summary({ protein: 10, fat: 10, hasEstimates: true })), null);
  });
});

describe('computeRangeEnergySplit', () => {
  it('pools the energy of the range rather than averaging the daily shares', () => {
    // Day one: all protein, 400 kcal. Day two: all fat, 1800 kcal.
    // Pooled, protein is 400 / 2200, about 18 percent. The mean of the two
    // daily shares would be exactly 50 percent.
    const shares = computeRangeEnergySplit([summary({ protein: 100 }), summary({ fat: 200 })]);

    assert.ok(shares !== null);
    assertShare(shares.protein, (400 / 2200) * 100);
    assertShare(totalOf(shares), 100);
  });

  it('leaves out unlogged and partial days rather than counting them', () => {
    const withGaps = computeRangeEnergySplit([
      summary({ protein: 100 }),
      null,
      summary({ fat: 500, hasUnknowns: true }),
      summary({ fat: 200 }),
    ]);
    const without = computeRangeEnergySplit([summary({ protein: 100 }), summary({ fat: 200 })]);

    assert.deepStrictEqual(withGaps, without);
  });

  it('gives null when no day in the range has a split', () => {
    assert.strictEqual(computeRangeEnergySplit([null, summary({ fat: 10, hasUnknowns: true })]), null);
  });
});
