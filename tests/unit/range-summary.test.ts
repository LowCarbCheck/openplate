/**
 * Unit tests for `#app/lib/range-summary`, the Overview tab's summary strip.
 * Mirrors `computeWeeklyRecap`'s averaging rule: logged-day-only means, and
 * null (never zero) when a range, or the range before it, logged nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeRangeSummary } from '../../app/lib/range-summary';
import type { TrendDay } from '../../app/lib/trend-chart';
import type { DaySummary } from '../../app/models/food-log-summary';

function makeSummary(overrides: Partial<DaySummary> = {}): DaySummary {
  return {
    carbs: 30,
    fiber: 5,
    polyols: 0,
    netCarbs: 25,
    protein: 40,
    fat: 20,
    kcal: 500,
    hasUnknowns: false,
    hasEstimates: false,
    ...overrides,
  };
}

function emptyDay(date: string): TrendDay {
  return { date, hasLogs: false, summary: null, kcal: { total: null, basis: 'none', derivedShare: 0 }, estimateShare: 0 };
}

function loggedDay(date: string, overrides: Partial<DaySummary> = {}): TrendDay {
  const summary = makeSummary(overrides);
  return { date, hasLogs: true, summary, kcal: { total: summary.kcal, basis: 'reported', derivedShare: 0 }, estimateShare: 0 };
}

describe('computeRangeSummary', () => {
  it('averages kcal, net carbs and protein over logged days only, ignoring empty days', () => {
    const summary = computeRangeSummary({
      current: [
        loggedDay('2026-07-01', { kcal: 400, netCarbs: 20, protein: 30 }),
        loggedDay('2026-07-02', { kcal: 600, netCarbs: 40, protein: 50 }),
        emptyDay('2026-07-03'),
      ],
      previous: [],
    });

    assert.strictEqual(summary.loggedDays, 2);
    assert.strictEqual(summary.kcal.average, 500);
    assert.strictEqual(summary.netCarbs.average, 30);
    assert.strictEqual(summary.protein.average, 40);
  });

  it('THE CONTROL: a range with zero logged days returns null averages, never zeros', () => {
    const summary = computeRangeSummary({
      current: [emptyDay('2026-07-01'), emptyDay('2026-07-02')],
      previous: [],
    });

    assert.strictEqual(summary.loggedDays, 0);
    // A naive `reduce(...) / days.length` over the whole range, empty days
    // included, would read 0 here, not null, and that failing mutant is
    // exactly what this control catches.
    assert.strictEqual(summary.kcal.average, null);
    assert.strictEqual(summary.netCarbs.average, null);
    assert.strictEqual(summary.protein.average, null);
  });

  it('gives a null change when the previous range logged nothing, but still reports the average', () => {
    const summary = computeRangeSummary({
      current: [loggedDay('2026-07-08', { kcal: 500, netCarbs: 30, protein: 40 })],
      previous: [emptyDay('2026-07-01')],
    });

    assert.strictEqual(summary.kcal.average, 500);
    assert.strictEqual(summary.kcal.change, null);
    assert.strictEqual(summary.netCarbs.change, null);
    assert.strictEqual(summary.protein.change, null);
  });

  it('computes a signed change against the previous range when both sides logged something', () => {
    const summary = computeRangeSummary({
      current: [loggedDay('2026-07-08', { netCarbs: 40 })],
      previous: [loggedDay('2026-07-01', { netCarbs: 30 })],
    });

    assert.strictEqual(summary.netCarbs.change, 10);
  });

  it('CONTROL: a lower current average against the same previous average gives a negative change', () => {
    const summary = computeRangeSummary({
      current: [loggedDay('2026-07-08', { protein: 30 })],
      previous: [loggedDay('2026-07-01', { protein: 50 })],
    });

    assert.strictEqual(summary.protein.change, -20);
  });
});
