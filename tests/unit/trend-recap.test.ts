/**
 * Unit tests for `#app/lib/trend-recap` — weekly aggregation. No DB. The focus
 * is honesty: logged-day-only averages/counts, null (not 0) for unset goals,
 * a kcal-weighted week estimate share, and an elapsed-days (not full-week)
 * ratio denominator for the in-progress current week.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeWeeklyRecap } from '../../app/lib/trend-recap';
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
  return {
    date,
    hasLogs: false,
    summary: null,
    kcal: { total: null, basis: 'none', derivedShare: 0 },
    estimateShare: 0,
  };
}

function loggedDay(
  date: string,
  {
    summary = makeSummary(),
    kcalTotal = 500,
    estimateShare = 0,
  }: {
    summary?: DaySummary;
    kcalTotal?: number | null;
    estimateShare?: number;
  } = {},
): TrendDay {
  return {
    date,
    hasLogs: true,
    summary,
    kcal: { total: kcalTotal, basis: 'reported', derivedShare: 0 },
    estimateShare,
  };
}

describe('computeWeeklyRecap', () => {
  it('averages net carbs over logged days only, ignoring empty days', () => {
    const recap = computeWeeklyRecap({
      days: [
        loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 20 }) }),
        loggedDay('2026-07-14', { summary: makeSummary({ netCarbs: 30 }) }),
        emptyDay('2026-07-15'),
      ],
      today: '2026-07-15',
      netCarbsCeiling: null,
      proteinFloor: null,
    });

    assert.strictEqual(recap.loggedDays, 2);
    assert.strictEqual(recap.avgNetCarbs, 25);
    assert.strictEqual(recap.elapsedDays, 3);
  });

  it('returns a null average when nothing was logged', () => {
    const recap = computeWeeklyRecap({
      days: [emptyDay('2026-07-13'), emptyDay('2026-07-14')],
      today: '2026-07-14',
      netCarbsCeiling: 20,
      proteinFloor: 90,
    });

    assert.strictEqual(recap.avgNetCarbs, null);
    assert.strictEqual(recap.daysUnderCeiling, 0);
    assert.strictEqual(recap.daysHitProteinFloor, 0);
    assert.strictEqual(recap.estimateShare, null);
  });

  it('counts days under the ceiling and at/above the protein floor', () => {
    const recap = computeWeeklyRecap({
      days: [
        loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 18, protein: 100 }) }),
        loggedDay('2026-07-14', { summary: makeSummary({ netCarbs: 20, protein: 80 }) }),
        loggedDay('2026-07-15', { summary: makeSummary({ netCarbs: 40, protein: 95 }) }),
      ],
      today: '2026-07-15',
      netCarbsCeiling: 20,
      proteinFloor: 90,
    });

    // 18 and 20 are ≤ 20; 40 is over.
    assert.strictEqual(recap.daysUnderCeiling, 2);
    // 100 and 95 are ≥ 90; 80 is under.
    assert.strictEqual(recap.daysHitProteinFloor, 2);
  });

  it('rounds like the diary headline: sub-gram spillover counts as under, not over (98.3 vs 98)', () => {
    // Regression for the recap counting a day as "over" that the diary itself
    // reports as under — both must use the same rounded ceiling comparison.
    const recap = computeWeeklyRecap({
      days: [loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 98.3 }) })],
      today: '2026-07-13',
      netCarbsCeiling: 98,
      proteinFloor: null,
    });

    assert.strictEqual(recap.daysUnderCeiling, 1);
  });

  it('counts a day as over once the rounded value exceeds the rounded ceiling (98.6 vs 98)', () => {
    const recap = computeWeeklyRecap({
      days: [loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 98.6 }) })],
      today: '2026-07-13',
      netCarbsCeiling: 98,
      proteinFloor: null,
    });

    assert.strictEqual(recap.daysUnderCeiling, 0);
  });

  it('reports goal-based stats as null when the goal is unset', () => {
    const recap = computeWeeklyRecap({
      days: [loggedDay('2026-07-13')],
      today: '2026-07-13',
      netCarbsCeiling: null,
      proteinFloor: null,
    });

    assert.strictEqual(recap.daysUnderCeiling, null);
    assert.strictEqual(recap.daysHitProteinFloor, null);
  });

  it('weights the week estimate share by computable calories', () => {
    const recap = computeWeeklyRecap({
      days: [
        loggedDay('2026-07-13', { kcalTotal: 100, estimateShare: 1 }),
        loggedDay('2026-07-14', { kcalTotal: 300, estimateShare: 0 }),
      ],
      today: '2026-07-14',
      netCarbsCeiling: null,
      proteinFloor: null,
    });

    // 100 estimated of 400 total = 25%.
    assert.strictEqual(recap.estimateShare, 100 / 400);
  });

  it('counts only elapsed days, not the full week window, when the week is in progress', () => {
    // A Monday-start window with today = Monday: only 1 of the 7 days has
    // actually happened, even though all 7 slots exist (gaps included).
    const days = [
      loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 15 }) }), // Monday, today
      emptyDay('2026-07-14'), // Tuesday — hasn't happened yet
      emptyDay('2026-07-15'),
      emptyDay('2026-07-16'),
      emptyDay('2026-07-17'),
      emptyDay('2026-07-18'),
      emptyDay('2026-07-19'), // Sunday
    ];

    const recap = computeWeeklyRecap({ days, today: '2026-07-13', netCarbsCeiling: 20, proteinFloor: null });

    assert.strictEqual(recap.elapsedDays, 1);
    assert.strictEqual(recap.daysUnderCeiling, 1);
  });

  it('counts every day as elapsed for a week that has fully passed', () => {
    const days = [
      loggedDay('2026-07-06', { summary: makeSummary({ netCarbs: 15 }) }),
      emptyDay('2026-07-07'),
      emptyDay('2026-07-08'),
      emptyDay('2026-07-09'),
      emptyDay('2026-07-10'),
      emptyDay('2026-07-11'),
      emptyDay('2026-07-12'),
    ];

    // "Today" is the following Monday — the whole window above is in the past.
    const recap = computeWeeklyRecap({ days, today: '2026-07-13', netCarbsCeiling: null, proteinFloor: null });

    assert.strictEqual(recap.elapsedDays, 7);
  });
});

/**
 * M129/04: the recap card gained the spec-01 `MacroRatioBar` ("an average
 * day"), which needs per-macro means. Same logged-days-only population as
 * `avgNetCarbs` — averaging over elapsed days would shrink every macro by
 * however many days the user skipped and report a composition nobody ate.
 */
describe('computeWeeklyRecap — average-day macro composition', () => {
  it('averages each macro over logged days only', () => {
    const recap = computeWeeklyRecap({
      days: [
        loggedDay('2026-07-13', { summary: makeSummary({ carbs: 40, fiber: 10, protein: 100, fat: 60 }) }),
        loggedDay('2026-07-14', { summary: makeSummary({ carbs: 20, fiber: 6, protein: 80, fat: 40 }) }),
        emptyDay('2026-07-15'),
      ],
      today: '2026-07-15',
      netCarbsCeiling: null,
      proteinFloor: null,
    });

    assert.deepEqual(recap.avgMacroGrams, { carbs: 30, fiber: 8, protein: 90, fat: 50 });
  });

  it('is null when nothing was logged — the card omits the bar rather than drawing an empty one', () => {
    const recap = computeWeeklyRecap({
      days: [emptyDay('2026-07-13'), emptyDay('2026-07-14')],
      today: '2026-07-15',
      netCarbsCeiling: null,
      proteinFloor: null,
    });

    assert.equal(recap.avgMacroGrams, null);
  });
});
