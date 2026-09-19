/**
 * Unit tests for `#app/lib/trend-chart` — the pure bar-geometry shaping. No DB.
 * The focus is the honesty rules: empty slots for unlogged days, hollow fills
 * for floors, and a shared "nice" vertical scale that also clears the goal line.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrendChart } from '../../app/lib/trend-chart';
import { goalDirectionFor, goalValueFor, resolveBarFill, selectMetricValue } from '../../app/lib/trend-chart';
import { bucketByWeek } from '../../app/lib/trend-buckets';
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

describe('buildTrendChart, a meal slot has no goal (M227/02)', () => {
  /** A ceiling every fixture day sits over, so a goal that survived would be visible. */
  const CEILING = 20;

  it('draws the goal line for the whole day, as it always did', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 40 }) });
    const { goalFraction } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: CEILING, slot: 'all' });

    assert.notStrictEqual(goalFraction, null);
  });

  it('defaults to the whole day when no slot is named at all', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 40 }) });
    const { goalFraction } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: CEILING });

    assert.notStrictEqual(goalFraction, null);
  });

  it('hides the goal line once a slot is chosen, because the goal is a whole-day figure', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 40 }) });
    const { goalFraction } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: CEILING, slot: 'snack' });

    assert.strictEqual(goalFraction, null);
  });

  it('stops flagging a slot bar as over goal, so no bar is painted against a line that is gone', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 40 }) });
    const overWholeDay = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: CEILING, slot: 'all' });
    const overSlot = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: CEILING, slot: 'snack' });

    // The control: the same day, the same ceiling, IS over when the whole day
    // is charted. Without this the assertion below would pass on any bar.
    assert.strictEqual(overWholeDay.bars[0].isOverGoal, true);
    assert.strictEqual(overSlot.bars[0].isOverGoal, false);
  });

  it('stops propping the axis top up with a goal no bar is measured against', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 4 }) });
    const wholeDay = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: 100, slot: 'all' });
    const slotOnly = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: 100, slot: 'snack' });

    assert.strictEqual(wholeDay.domainMax, 100);
    assert.strictEqual(slotOnly.domainMax, 4);
  });

  it('leaves the bar values themselves alone, the caller has already filtered the days', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 12 }) });
    const { bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: null, slot: 'lunch' });

    assert.strictEqual(bars[0].value, 12);
    assert.strictEqual(bars[0].fill, 'solid');
  });
});

/**
 * M239/03: protein, fat and fiber, and the ONE honesty rule they share with net
 * carbs. Each claim sits beside a control on the same fixture, so a version
 * that got the rule wrong in one direction fails here.
 */
describe('buildTrendChart, every gram metric follows the one honesty rule (M239/03)', () => {
  const gramMetrics = ['net-carbs', 'protein', 'fat', 'fiber'] as const;

  it('plots each macro off its own field of the day summary', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 25, protein: 40, fat: 20, fiber: 5 }) });
    const valueOf = (metric: (typeof gramMetrics)[number]) =>
      buildTrendChart({ days: [day], metric, goalValue: null }).bars[0].value;

    assert.deepStrictEqual(gramMetrics.map(valueOf), [25, 40, 20, 5]);
  });

  it('draws a day with unknown macros as a floor for every gram metric, and a known day as solid', () => {
    const partial = loggedDay('2026-07-13', { summary: makeSummary({ hasUnknowns: true }) });
    const known = loggedDay('2026-07-14', { summary: makeSummary({ hasUnknowns: false }) });

    for (const metric of gramMetrics) {
      const { bars } = buildTrendChart({ days: [partial, known], metric, goalValue: null });
      assert.strictEqual(bars[0].fill, 'incomplete', `${metric}: the partial day is a floor`);
      assert.strictEqual(bars[1].fill, 'solid', `${metric}: the known day is solid`);
    }
  });

  it('keeps an AI-estimated gram day solid, as net carbs always drew it, and hedges it instead', () => {
    const estimated = loggedDay('2026-07-13', { summary: makeSummary({ hasEstimates: true }), estimateShare: 1 });

    for (const metric of gramMetrics) {
      const [bar] = buildTrendChart({ days: [estimated], metric, goalValue: null }).bars;
      assert.strictEqual(bar.fill, 'solid', `${metric}: an estimate does not lighten the bar`);
      assert.strictEqual(bar.hasEstimate, true, `${metric}: the estimate is carried as the hedge`);
    }
  });

  it('draws an unlogged day as an empty slot for every gram metric', () => {
    for (const metric of gramMetrics) {
      const [bar] = buildTrendChart({ days: [emptyDay('2026-07-13')], metric, goalValue: null }).bars;
      assert.strictEqual(bar.fill, 'empty', metric);
      assert.strictEqual(bar.value, null, metric);
    }
  });
});

describe('resolveBarFill, the shared rule itself (M239/03)', () => {
  it('lets a floor win over a derived value, and a derived value over solid', () => {
    assert.strictEqual(resolveBarFill({ isFloor: true, isDerived: true }), 'incomplete');
    assert.strictEqual(resolveBarFill({ isFloor: false, isDerived: true }), 'derived');
    assert.strictEqual(resolveBarFill({ isFloor: false, isDerived: false }), 'solid');
  });
});

describe('buildTrendChart, goalDirection per metric (M239/03)', () => {
  const FLOOR = 100;

  it('names net carbs and calories as ceilings, protein as a floor, fat and fiber as goalless', () => {
    assert.strictEqual(goalDirectionFor('net-carbs'), 'max');
    assert.strictEqual(goalDirectionFor('calories'), 'max');
    assert.strictEqual(goalDirectionFor('protein'), 'min');
    assert.strictEqual(goalDirectionFor('fat'), null);
    assert.strictEqual(goalDirectionFor('fiber'), null);
  });

  it('flags a protein day below the floor, and not a day above it', () => {
    const below = loggedDay('2026-07-13', { summary: makeSummary({ protein: 60 }) });
    const above = loggedDay('2026-07-14', { summary: makeSummary({ protein: 130 }) });
    const { bars } = buildTrendChart({ days: [below, above], metric: 'protein', goalValue: FLOOR });

    assert.strictEqual(bars[0].isUnderGoal, true);
    assert.strictEqual(bars[1].isUnderGoal, false);
    // A floor is never "over": protein above the goal is the win.
    assert.strictEqual(bars[1].isOverGoal, false);
  });

  it('flags net carbs the other way round on the same two numbers', () => {
    const low = loggedDay('2026-07-13', { summary: makeSummary({ netCarbs: 60 }) });
    const high = loggedDay('2026-07-14', { summary: makeSummary({ netCarbs: 130 }) });
    const { bars } = buildTrendChart({ days: [low, high], metric: 'net-carbs', goalValue: FLOOR });

    assert.strictEqual(bars[0].isOverGoal, false);
    assert.strictEqual(bars[1].isOverGoal, true);
    assert.strictEqual(bars[0].isUnderGoal, false);
  });

  it('reads protein at the floor as met, by the diary rounding', () => {
    const atFloor = loggedDay('2026-07-13', { summary: makeSummary({ protein: 99.6 }) });

    assert.strictEqual(buildTrendChart({ days: [atFloor], metric: 'protein', goalValue: FLOOR }).bars[0].isUnderGoal, false);
  });

  it('never flags a protein floor bar as under, since the real value may have reached the goal', () => {
    const partialLow = loggedDay('2026-07-13', { summary: makeSummary({ protein: 60, hasUnknowns: true }) });
    const knownLow = loggedDay('2026-07-14', { summary: makeSummary({ protein: 60 }) });
    const { bars } = buildTrendChart({ days: [partialLow, knownLow], metric: 'protein', goalValue: FLOOR });

    assert.strictEqual(bars[0].isUnderGoal, false);
    assert.strictEqual(bars[1].isUnderGoal, true);
  });

  it('draws the protein goal line, and none for fat or fiber even when a figure is handed in', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ protein: 60, fat: 60, fiber: 60 }) });

    assert.notStrictEqual(buildTrendChart({ days: [day], metric: 'protein', goalValue: FLOOR }).goalFraction, null);
    assert.strictEqual(buildTrendChart({ days: [day], metric: 'fat', goalValue: FLOOR }).goalFraction, null);
    assert.strictEqual(buildTrendChart({ days: [day], metric: 'fiber', goalValue: FLOOR }).goalFraction, null);
  });

  it('drops the protein goal and its flag once a slot is chosen', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ protein: 20 }) });
    const wholeDay = buildTrendChart({ days: [day], metric: 'protein', goalValue: FLOOR });
    const slotOnly = buildTrendChart({ days: [day], metric: 'protein', goalValue: FLOOR, slot: 'lunch' });

    assert.strictEqual(wholeDay.bars[0].isUnderGoal, true);
    assert.strictEqual(slotOnly.bars[0].isUnderGoal, false);
    assert.strictEqual(slotOnly.goalFraction, null);
  });

  it('picks each metric its own goal figure', () => {
    const goals = { netCarbsCeiling: 20, kcalTarget: 1800, proteinFloor: 100 };

    assert.strictEqual(goalValueFor({ metric: 'net-carbs', goals }), 20);
    assert.strictEqual(goalValueFor({ metric: 'calories', goals }), 1800);
    assert.strictEqual(goalValueFor({ metric: 'protein', goals }), 100);
    assert.strictEqual(goalValueFor({ metric: 'fat', goals }), null);
    assert.strictEqual(goalValueFor({ metric: 'fiber', goals }), null);
  });
});

describe('buildTrendChart, the total-carbs outline behind net carbs (M239/03)', () => {
  it('draws total carbs above the net-carbs bar, so the fiber is the gap', () => {
    // A taller day sets the axis at 60, so neither figure below is capped.
    const tall = loggedDay('2026-07-12', { summary: makeSummary({ carbs: 60, fiber: 0, netCarbs: 60 }) });
    const day = loggedDay('2026-07-13', { summary: makeSummary({ carbs: 30, fiber: 10, netCarbs: 20 }) });
    const [, bar] = buildTrendChart({ days: [tall, day], metric: 'net-carbs', goalValue: null }).bars;

    assert.strictEqual(bar.heightFraction, 20 / 60);
    assert.strictEqual(bar.outlineFraction, 30 / 60);
  });

  it('keeps the axis on net carbs and caps a tall total at the top of the plot', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ carbs: 90, netCarbs: 20 }) });
    const { domainMax, bars } = buildTrendChart({ days: [day], metric: 'net-carbs', goalValue: null });

    assert.strictEqual(domainMax, 20);
    assert.strictEqual(bars[0].outlineFraction, 1);
  });

  it('draws no outline for any other metric, or for an unlogged day', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ carbs: 30, netCarbs: 20 }) });

    assert.strictEqual(buildTrendChart({ days: [day], metric: 'protein', goalValue: null }).bars[0].outlineFraction, null);
    assert.strictEqual(
      buildTrendChart({ days: [emptyDay('2026-07-13')], metric: 'net-carbs', goalValue: null }).bars[0].outlineFraction,
      null,
    );
  });
});

describe('buildTrendChart, weekly bars keep the rule for the new metrics (M239/03)', () => {
  it('marks a week with one partial day as a protein floor, and a clean week as solid', () => {
    const cleanWeek = ['2026-07-06', '2026-07-07'].map((date) => loggedDay(date));
    const partialWeek = [
      loggedDay('2026-07-13'),
      loggedDay('2026-07-14', { summary: makeSummary({ protein: 10, hasUnknowns: true }) }),
    ];
    const weeks = bucketByWeek([...cleanWeek, ...partialWeek]);
    const { bars } = buildTrendChart({ days: weeks, metric: 'protein', goalValue: null });

    assert.deepStrictEqual(
      bars.map((bar) => [bar.date, bar.fill]),
      [
        ['2026-07-06', 'solid'],
        ['2026-07-13', 'incomplete'],
      ],
    );
    // The week is the mean over its logged days: (40 + 10) / 2.
    assert.strictEqual(bars[1].value, 25);
  });
});

describe('selectMetricValue, the figure the bars and the average line share (M239/03)', () => {
  it('returns the bar value, and null for a day with nothing to plot', () => {
    const day = loggedDay('2026-07-13', { summary: makeSummary({ fiber: 7 }) });

    assert.strictEqual(selectMetricValue({ day, metric: 'fiber' }), 7);
    assert.strictEqual(selectMetricValue({ day: emptyDay('2026-07-14'), metric: 'fiber' }), null);
    assert.strictEqual(selectMetricValue({ day: loggedDay('2026-07-15', { kcalTotal: null, basis: 'none' }), metric: 'calories' }), null);
  });
});
