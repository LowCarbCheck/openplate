/**
 * Unit tests for `#app/lib/trend-chart` — the pure bar-geometry shaping. No DB.
 * The focus is the honesty rules: empty slots for unlogged days, hollow fills
 * for floors, and a shared "nice" vertical scale that also clears the goal line.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrendChart } from '../../app/lib/trend-chart';
import type { TrendDay } from '../../app/lib/trend-chart';
import { summarizeDay } from '../../app/models/food-log-summary';
import type { DaySummary, FoodLogMacroSnapshot } from '../../app/models/food-log-summary';
import type { KcalBasis } from '../../app/models/daily-totals';

function makeLog(overrides: Partial<FoodLogMacroSnapshot> = {}): FoodLogMacroSnapshot {
  return {
    carbs: 10,
    fiber: 2,
    sugars: 3,
    polyols: 0,
    protein: 20,
    fat: 5,
    kcal: 150,
    aiEstimated: false,
    ...overrides,
  };
}

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
    basis = 'reported',
    estimateShare = 0,
  }: { summary?: DaySummary; kcalTotal?: number | null; basis?: KcalBasis; estimateShare?: number } = {},
): TrendDay {
  return { date, hasLogs: true, summary, kcal: { total: kcalTotal, basis, derivedShare: 0 }, estimateShare };
}

describe('buildTrendChart — net-carbs', () => {
  it('renders unlogged days as empty slots with no value', () => {
    const { bars } = buildTrendChart({ days: [emptyDay('2026-07-13')], metric: 'net-carbs', goalValue: null });

    assert.strictEqual(bars[0].fill, 'empty');
    assert.strictEqual(bars[0].value, null);
    assert.strictEqual(bars[0].heightFraction, 0);
    assert.strictEqual(bars[0].hasLogs, false);
  });

  it('renders a fully-known day as a solid bar carrying net carbs', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 25 }) });
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: null });

    assert.strictEqual(bars[0].fill, 'solid');
    assert.strictEqual(bars[0].value, 25);
  });

  it('renders a day with unknown macros as a hollow (incomplete) floor', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 25, hasUnknowns: true }) });
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: null });

    assert.strictEqual(bars[0].fill, 'incomplete');
    assert.strictEqual(bars[0].value, 25);
  });
});

describe('buildTrendChart — calories', () => {
  it('mirrors the kcal basis onto the fill state', () => {
    const days = [
      loggedDay('2026-07-13', { kcalTotal: 500, basis: 'reported' }),
      loggedDay('2026-07-14', { kcalTotal: 500, basis: 'partly-derived' }),
      loggedDay('2026-07-15', { kcalTotal: 500, basis: 'incomplete' }),
      loggedDay('2026-07-16', { kcalTotal: null, basis: 'none' }),
    ];
    const { bars } = buildTrendChart({ days, metric: 'calories', goalValue: null });

    assert.strictEqual(bars[0].fill, 'solid');
    assert.strictEqual(bars[1].fill, 'derived');
    assert.strictEqual(bars[2].fill, 'incomplete');
    assert.strictEqual(bars[3].fill, 'incomplete');
    assert.strictEqual(bars[3].value, null);
  });
});

describe('buildTrendChart — scale and markers', () => {
  it('rounds the domain up to a nice ceiling above every value', () => {
    const days = [
      loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 34 }) }),
      loggedDay('2026-07-14', { summary: makeSummary({ netCarbs: 12 }) }),
    ];
    const { domainMax, bars } = buildTrendChart({ days, metric: 'net-carbs', goalValue: null });

    // 34 snaps to 40, not the old coarse 50 — see `NICE_FRACTIONS`. The wider
    // ladder is what stopped the chart wasting a third of its height.
    assert.strictEqual(domainMax, 40);
    assert.strictEqual(bars[0].heightFraction, 34 / 40);
  });

  it('keeps the goal within the domain and reports it as a fraction', () => {
    const days = [loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 8 }) })];
    const { domainMax, goalFraction } = buildTrendChart({ days, metric: 'net-carbs', goalValue: 20 });

    // The goal (20) drives the domain up to a nice 20, so the line sits at the top.
    assert.strictEqual(domainMax, 20);
    assert.strictEqual(goalFraction, 1);
  });

  it('falls back to a unit domain when nothing is plottable', () => {
    const { domainMax, goalFraction } = buildTrendChart({
      days: [emptyDay('2026-07-13')],
      metric: 'net-carbs',
      goalValue: null,
    });

    assert.strictEqual(domainMax, 1);
    assert.strictEqual(goalFraction, null);
  });

  it('flags days that include AI estimates', () => {
    const days = [loggedDay('2026-07-13', { estimateShare: 0.4 }), loggedDay('2026-07-14', { estimateShare: 0 })];
    const { bars } = buildTrendChart({ days, metric: 'net-carbs', goalValue: null });

    assert.strictEqual(bars[0].hasEstimate, true);
    assert.strictEqual(bars[1].hasEstimate, false);
  });

  it('falls back to a unit domain for a logged-but-all-zero week (no goal set)', () => {
    // Every day is logged (not empty) but nets to 0 g — e.g. carbs === fiber
    // every day post-clamp. Must not crash or produce a non-positive domain.
    const days = [
      loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 0 }) }),
      loggedDay('2026-07-14', { summary: makeSummary({ netCarbs: 0 }) }),
    ];
    const { domainMax, bars } = buildTrendChart({ days, metric: 'net-carbs', goalValue: null });

    assert.strictEqual(domainMax, 1);
    assert.strictEqual(bars[0].fill, 'solid');
    assert.strictEqual(bars[0].heightFraction, 0);
    assert.strictEqual(bars[1].heightFraction, 0);
  });
});

describe('buildTrendChart — isOverGoal agrees with the diary (bug fix: opposite verdicts on the same day)', () => {
  it('flags a net-carbs day over the ceiling using the same comparison the diary uses', () => {
    // Mirrors the reported bug: 94.9 g logged against a 20 g ceiling reads
    // amber/over on the diary — the chart must never show it as fine.
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 94.9 }) });
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: 20 });

    assert.strictEqual(bars[0].isOverGoal, true);
  });

  it('does not flag a net-carbs day at or under the ceiling', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 20 }) });
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: 20 });

    assert.strictEqual(bars[0].isOverGoal, false);
  });

  it('never flags a day as over-goal when no ceiling is set', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 94.9 }) });
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: null });

    assert.strictEqual(bars[0].isOverGoal, false);
  });

  it('never flags an empty (unlogged) day as over-goal', () => {
    const { bars } = buildTrendChart({ days: [emptyDay('2026-07-13')], metric: 'net-carbs', goalValue: 20 });

    assert.strictEqual(bars[0].isOverGoal, false);
  });

  it('flags an over-ceiling day even when it also mixes in unknown macros (incomplete fill)', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 94.9, hasUnknowns: true }) });
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: 20 });

    assert.strictEqual(bars[0].fill, 'incomplete');
    assert.strictEqual(bars[0].isOverGoal, true);
  });

  it('never flags the calories metric as over-goal — the diary has no over/under coloring for kcal targets', () => {
    const day = loggedDay('2026-07-13', { kcalTotal: 5000, basis: 'reported' });
    const { bars } = buildTrendChart({ days: [day], metric: 'calories', goalValue: 1800 });

    assert.strictEqual(bars[0].isOverGoal, false);
  });
});

describe('buildTrendChart — corrected hasUnknowns semantics (fix 3) flow through to fill', () => {
  it('renders a day with only a null-polyols entry as solid, not incomplete', () => {
    // Regression for the "fires on virtually every food" bug: a food with only
    // polyols unreported must not paint the whole day's bar as a hollow floor.
    const day: TrendDay = {
      date: '2026-07-13',
      hasLogs: true,
      summary: summarizeDay([makeLog({ carbs: 10, fiber: 2, polyols: null })]),
      kcal: { total: 150, basis: 'reported', derivedShare: 0 },
      estimateShare: 0,
    };
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: null });

    assert.strictEqual(bars[0].fill, 'solid');
  });

  it('renders a day with a genuinely unknown carbs entry as incomplete', () => {
    const day: TrendDay = {
      date: '2026-07-13',
      hasLogs: true,
      summary: summarizeDay([makeLog({ carbs: null })]),
      kcal: { total: null, basis: 'none', derivedShare: 0 },
      estimateShare: 0,
    };
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: null });

    assert.strictEqual(bars[0].fill, 'incomplete');
  });
});

/**
 * M129/04: the axis-top ladder. The old 1/2/5/10 mantissas rounded a 34 g week
 * to a 50 g axis and a 72 g week to 100 g, leaving up to a third of the plot as
 * dead space above the tallest bar. The wider ladder keeps every step a round,
 * readable number while tracking the data far more closely.
 */
describe('buildTrendChart — the axis top tracks the data closely', () => {
  const domainFor = (netCarbs: number) =>
    buildTrendChart({
      days: [loggedDay('2026-07-13', { summary: makeSummary({ netCarbs }) })],
      metric: 'net-carbs',
      goalValue: null,
    }).domainMax;

  it('never rounds more than a third above the tallest value', () => {
    for (const value of [3, 12, 21, 34, 47, 58, 72, 96, 140, 260]) {
      const domain = domainFor(value);
      assert.ok(domain >= value, `${domain} must clear ${value}`);
      assert.ok(domain <= value * 1.34, `${domain} wastes too much plot above ${value}`);
    }
  });

  it('still snaps to round numbers a person can read off the goal tag', () => {
    assert.strictEqual(domainFor(34), 40);
    assert.strictEqual(domainFor(72), 80);
    assert.strictEqual(domainFor(21), 25);
    assert.strictEqual(domainFor(1800), 2000);
  });
});
