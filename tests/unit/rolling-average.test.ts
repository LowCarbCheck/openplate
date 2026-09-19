/**
 * `computeRollingAverage` (`app/lib/rolling-average.ts`), the 7-day line the
 * trends chart draws over its daily bars (M239/03).
 *
 * The claim with teeth is "averaged over LOGGED days". Each case that proves it
 * carries the number a divide-by-seven version would give, so that version
 * fails here rather than drawing a line that sags on every skipped day.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeRollingAverage, ROLLING_AVERAGE_DAYS, selectAverageFractions } from '../../app/lib/rolling-average';
import type { TrendDay } from '../../app/lib/trend-chart';

describe('computeRollingAverage', () => {
  it('uses a seven day window by default', () => {
    assert.strictEqual(ROLLING_AVERAGE_DAYS, 7);
  });

  it('averages a full window of logged days', () => {
    const values = [10, 20, 30, 40, 50, 60, 70];

    assert.strictEqual(computeRollingAverage({ values }).at(-1), 40);
  });

  it('leaves unlogged days out of the mean instead of counting them as zero', () => {
    // Two logged days in the window. Over logged days the mean is 30; a
    // version that divided by seven would give 60 / 7, about 8.6.
    const values = [null, 20, null, null, 40, null, null];

    assert.strictEqual(computeRollingAverage({ values }).at(-1), 30);
  });

  it('gives null where the window holds no logged day, and a value where it holds one', () => {
    const values = [null, null, 12, null];

    // Control: the window that reaches day three has a value.
    assert.deepStrictEqual(computeRollingAverage({ values }), [null, null, 12, 12]);
  });

  it('drops a day once it slides out of the trailing window', () => {
    // Day one (100) is inside the window at position six and outside it at
    // position seven, where only the six 10s remain.
    const values = [100, 10, 10, 10, 10, 10, 10, 10];
    const averages = computeRollingAverage({ values });

    assert.strictEqual(averages[6], 160 / 7);
    assert.strictEqual(averages[7], 10);
  });

  it('goes back to null after a whole window with nothing logged', () => {
    const values = [5, null, null, null, null, null, null, null];

    assert.strictEqual(computeRollingAverage({ values })[6], 5);
    assert.strictEqual(computeRollingAverage({ values })[7], null);
  });

  it('honours a shorter window', () => {
    assert.deepStrictEqual(computeRollingAverage({ values: [2, 4, 6], windowSize: 2 }), [2, 3, 5]);
  });

  it('refuses a window that is not a whole positive number of days', () => {
    assert.throws(() => computeRollingAverage({ values: [1], windowSize: 0 }), /whole number of days/);
    assert.throws(() => computeRollingAverage({ values: [1], windowSize: 2.5 }), /whole number of days/);
  });
});

/** A logged day whose every macro is `grams`. */
function day(date: string, grams: number | null): TrendDay {
  if (grams === null) {
    return { date, hasLogs: false, summary: null, kcal: { total: null, basis: 'none', derivedShare: 0 }, estimateShare: 0 };
  }
  return {
    date,
    hasLogs: true,
    summary: {
      carbs: grams,
      fiber: grams,
      polyols: 0,
      netCarbs: grams,
      protein: grams,
      fat: grams,
      kcal: grams,
      hasUnknowns: false,
      hasEstimates: false,
    },
    kcal: { total: grams, basis: 'reported', derivedShare: 0 },
    estimateShare: 0,
  };
}

describe('selectAverageFractions, the line the chart draws', () => {
  it('fills the first bar window from the lead days, then drops them', () => {
    const leadDays = [day('2026-07-10', 60), day('2026-07-11', null)];
    const days = [day('2026-07-12', 20), day('2026-07-13', null)];
    const withLead = selectAverageFractions({ leadDays, days, metric: 'protein', domainMax: 100 });
    const withoutLead = selectAverageFractions({ leadDays: [], days, metric: 'protein', domainMax: 100 });

    // With the lead day, the first window holds 60 and 20; without it, 20 alone.
    assert.deepStrictEqual(withLead, [0.4, 0.4]);
    assert.deepStrictEqual(withoutLead, [0.2, 0.2]);
  });

  it('caps a lead-driven average above the axis at the top of the plot', () => {
    const fractions = selectAverageFractions({ leadDays: [day('2026-07-11', 500)], days: [day('2026-07-12', 10)], metric: 'fat', domainMax: 20 });

    assert.deepStrictEqual(fractions, [1]);
  });

  it('refuses a non-positive axis', () => {
    assert.throws(() => selectAverageFractions({ leadDays: [], days: [], metric: 'fat', domainMax: 0 }), /axis must be positive/);
  });
});
