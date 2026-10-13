/**
 * A day that mixes the two printed-panel conventions (operator report,
 * 2026-10-13): "Was du gegessen hast" read 7 % carbs, 19 % protein and 74 % fat
 * for a day of 74 g protein, 126.5 g fat, 7.6 g net carbs and 28 g fibre.
 *
 * The cause was `DaySummary.carbs`, a plain sum of the printed carb figures. An
 * `available` (EU) entry prints carbs WITHOUT fibre and a `total` (US), unknown
 * or AI-estimated entry prints carbs WITH it, so the sum left out the fibre of
 * every EU-panel food. This file pins the normalised total, the one calorie
 * rule (net carbs at 4 kcal per gram, fibre at 2, protein at 4, fat at 9), and
 * that the diary's ratio bar and the Insights split read that rule alike.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeMacroEnergySplit, computeRangeEnergySplit } from '../../app/lib/macro-energy-split';
import { computeMacroShares, percentOfShare } from '../../app/lib/macro-ratio';
import type { MacroRatioGrams } from '../../app/lib/macro-ratio';
import { computeDailyEntry } from '../../app/models/daily-totals';
import { summarizeDay } from '../../app/models/food-log-summary';
import type { DaySummary, FoodLogMacroSnapshot } from '../../app/models/food-log-summary';

function makeLog(overrides: Partial<FoodLogMacroSnapshot>): FoodLogMacroSnapshot {
  return {
    carbs: 0,
    fiber: 0,
    sugars: null,
    polyols: 0,
    protein: 0,
    fat: 0,
    kcal: null,
    aiEstimated: false,
    ...overrides,
  };
}

/** The EU-panel food of the reported day: its carbs exclude the 8.6 g of fibre. */
const EU_FOOD = makeLog({ carbBasis: 'available', carbs: 6, fiber: 8.6, protein: 40, fat: 80 });
/** The US-panel food of the reported day: its 21 g of carbs include the 19.4 g of fibre. */
const US_FOOD = makeLog({ carbBasis: 'total', carbs: 21, fiber: 19.4, protein: 34, fat: 46.5 });

/** Asserts two figures agree to a thousandth, so a sum of decimals is not compared with `===`. */
function assertClose(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

/** The grams the diary hands its ratio bar, built the way `WhatYouAte` builds them. */
function gramsOf(summary: DaySummary): MacroRatioGrams {
  return {
    carbs: summary.carbs,
    netCarbs: summary.netCarbs,
    protein: summary.protein,
    fat: summary.fat,
    fiber: summary.fiber,
  };
}

/** The diary's calorie shares as whole percents, carbs then protein then fat. */
function diaryKcalPercents(summary: DaySummary): number[] {
  const shares = computeMacroShares(gramsOf(summary), 'kcal');
  assert.ok(shares);
  return (['carbs', 'protein', 'fat'] as const).map((key) => Math.round(percentOfShare({ shares, key }) ?? NaN));
}

describe('DaySummary.carbs is total carbs on one basis', () => {
  it("adds an available-basis entry's fibre back to its printed carbs", () => {
    const summary = summarizeDay([makeLog({ carbBasis: 'available', carbs: 6, fiber: 20 })]);

    assert.strictEqual(summary.carbs, 26);
    assert.strictEqual(summary.netCarbs, 6);
    assert.strictEqual(summary.fiber, 20);
  });

  it('takes a total-basis entry as printed', () => {
    const summary = summarizeDay([makeLog({ carbBasis: 'total', carbs: 26, fiber: 20 })]);

    assert.strictEqual(summary.carbs, 26);
    assert.strictEqual(summary.netCarbs, 6);
  });

  it('takes an entry with no basis as printed, unknown meaning total', () => {
    const summary = summarizeDay([makeLog({ carbs: 26, fiber: 20 })]);

    assert.strictEqual(summary.carbs, 26);
    assert.strictEqual(summary.netCarbs, 6);
  });

  it('control: the same entry on the two bases differs by exactly its fibre, so the basis is read', () => {
    const available = summarizeDay([makeLog({ carbBasis: 'available', carbs: 10, fiber: 4 })]);
    const total = summarizeDay([makeLog({ carbBasis: 'total', carbs: 10, fiber: 4 })]);

    assert.strictEqual(available.carbs - total.carbs, 4);
  });

  it('counts an unknown fibre as nothing on an available-basis entry', () => {
    const summary = summarizeDay([makeLog({ carbBasis: 'available', carbs: 6, fiber: null })]);

    assert.strictEqual(summary.carbs, 6);
    assert.strictEqual(summary.hasUnknowns, true);
  });

  it('leaves an entry with unknown carbs out of the total, as before', () => {
    const summary = summarizeDay([makeLog({ carbBasis: 'available', carbs: null, fiber: 4 })]);

    assert.strictEqual(summary.carbs, 0);
  });

  it('sums the two conventions of the reported day to 35.6 g of total carbs, where the printed figures summed to 27', () => {
    const summary = summarizeDay([EU_FOOD, US_FOOD]);

    assertClose(summary.carbs, 35.6, 'total carbs');
    assertClose(summary.netCarbs, 7.6, 'net carbs');
    assertClose(summary.fiber, 28, 'fibre');
    assertClose(summary.protein, 74, 'protein');
    assertClose(summary.fat, 126.5, 'fat');
    // Control: net carbs plus fibre is the total carbs on any mix of the bases.
    assertClose(summary.netCarbs + summary.fiber, summary.carbs, 'net carbs + fibre');
    // Control: the old figure, the printed carbs summed as they came.
    assertClose((EU_FOOD.carbs ?? 0) + (US_FOOD.carbs ?? 0), 27, 'the old sum');
  });
});

describe('the calorie share of the reported day', () => {
  it('reads 6 / 19 / 75 in the diary, where the old inputs read 7 / 19 / 74', () => {
    const summary = summarizeDay([EU_FOOD, US_FOOD]);

    assert.deepEqual(diaryKcalPercents(summary), [6, 19, 75]);
    // Control: the bar fed the old carb figure (27 g, counted at 4 kcal per gram) is the report.
    const old = computeMacroShares({ ...gramsOf(summary), carbs: 27, netCarbs: 27, fiber: 0 }, 'kcal');
    assert.ok(old);
    assert.deepEqual(
      (['carbs', 'protein', 'fat'] as const).map((key) => Math.round(percentOfShare({ shares: old, key }) ?? NaN)),
      [7, 19, 74],
    );
  });

  it('is the same share on the Insights split, for one day and pooled over three alike days', () => {
    const summary = summarizeDay([EU_FOOD, US_FOOD]);
    const insights = computeMacroEnergySplit(summary, 'kcal');
    const pooled = computeRangeEnergySplit([summary, summary, summary], 'kcal');

    assert.ok(insights && pooled);
    for (const shares of [insights, pooled]) {
      assert.deepEqual([shares.carbs, shares.protein, shares.fat].map(Math.round), [6, 19, 75]);
    }
    const diary = computeMacroShares(gramsOf(summary), 'kcal');
    assert.ok(diary);
    assert.strictEqual(percentOfShare({ shares: diary, key: 'carbs' }), insights.carbs);
    assert.strictEqual(percentOfShare({ shares: diary, key: 'protein' }), insights.protein);
    assert.strictEqual(percentOfShare({ shares: diary, key: 'fat' }), insights.fat);
  });

  it('counts carbs as 4 x net carbs + 2 x fibre: 86.4 kcal of 1520.9', () => {
    const summary = summarizeDay([EU_FOOD, US_FOOD]);
    const insights = computeMacroEnergySplit(summary, 'kcal');

    assert.ok(insights);
    assertClose(insights.carbs, (86.4 / 1520.9) * 100, 'carb share');
    assertClose(insights.protein, (296 / 1520.9) * 100, 'protein share');
    assertClose(insights.fat, (1138.5 / 1520.9) * 100, 'fat share');
  });

  it('keeps the gram basis on total carbs, in the diary and on Insights', () => {
    const summary = summarizeDay([EU_FOOD, US_FOOD]);
    const grams = computeMacroShares(gramsOf(summary), 'grams');
    const insights = computeMacroEnergySplit(summary, 'grams');

    assert.ok(grams && insights);
    // 35.6 g of carbs, 28 g of fibre, 74 g of protein and 126.5 g of fat: 264.1 g.
    assertClose(percentOfShare({ shares: grams, key: 'carbs' }) ?? NaN, (35.6 / 264.1) * 100, 'diary carb grams');
    // Insights has three segments by grams: 35.6 + 74 + 126.5 = 236.1 g.
    assertClose(insights.carbs, (35.6 / 236.1) * 100, 'Insights carb grams');
  });
});

describe('the kcal fallback of an entry with no reported kcal', () => {
  it('derives net carbs at 4, fibre at 2, protein at 4 and fat at 9 for an available-basis entry', () => {
    const summary = summarizeDay([makeLog({ carbBasis: 'available', carbs: 6, fiber: 8.6, protein: 40, fat: 80 })]);

    // 4 x 6 + 2 x 8.6 + 4 x 40 + 9 x 80 = 24 + 17.2 + 160 + 720.
    assertClose(summary.kcal, 921.2, 'available-basis kcal');
  });

  it('derives the same kcal for the same food printed on the total basis', () => {
    const available = summarizeDay([makeLog({ carbBasis: 'available', carbs: 6, fiber: 8.6, protein: 40, fat: 80 })]);
    const total = summarizeDay([makeLog({ carbBasis: 'total', carbs: 14.6, fiber: 8.6, protein: 40, fat: 80 })]);

    assertClose(total.kcal, available.kcal, 'kcal of one food on two bases');
    // Control: the old rule (printed carbs at 4) gave the two bases different answers.
    assert.notStrictEqual(4 * 6 + 4 * 40 + 9 * 80, 4 * 14.6 + 4 * 40 + 9 * 80);
  });

  it('is shared with the daily entry, which reports the same total and marks it derived', () => {
    const logs = [EU_FOOD, US_FOOD];
    const entry = computeDailyEntry(logs);

    assert.ok(entry.summary);
    assertClose(entry.kcal.total ?? NaN, 1520.9, 'day kcal');
    assertClose(entry.summary.kcal, 1520.9, 'summary kcal');
    assert.strictEqual(entry.kcal.basis, 'partly-derived');
    assert.strictEqual(entry.kcal.derivedShare, 1);
  });

  it('still makes an entry with unknown carbs, protein or fat uncomputable', () => {
    for (const unknown of ['carbs', 'protein', 'fat'] as const) {
      const entry = computeDailyEntry([makeLog({ carbs: 10, protein: 5, fat: 2, [unknown]: null })]);
      assert.strictEqual(entry.kcal.total, null, `${unknown} unknown`);
    }
    // Control: with all three known the same entry is computable.
    assert.notStrictEqual(computeDailyEntry([makeLog({ carbs: 10, protein: 5, fat: 2 })]).kcal.total, null);
  });

  it("clamps a fibre-heavy entry's net carbs at zero before it counts the fibre", () => {
    // Printed carbs 3 g, fibre 5 g on the total basis: net would be -2, which is 0.
    const summary = summarizeDay([makeLog({ carbBasis: 'total', carbs: 3, fiber: 5, protein: 0, fat: 0 })]);

    assert.strictEqual(summary.kcal, 10);
  });
});
