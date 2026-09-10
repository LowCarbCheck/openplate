/**
 * Cross-surface consistency check for "is this day over the carb goal?".
 *
 * Regression coverage for a bug where the diary headline (`goal-progress`),
 * the diary habit-strip dot (`habit-strip`), the profile streak
 * (`local-store/aggregates`), and the weekly recap (`trend-recap`) each ran
 * their own comparison — three raw, one rounded — so the SAME day's net
 * carbs could read "met" on one part of a screen and "over" on another
 * (98.3 g against a 98 g ceiling: not over on the headline, over on the habit
 * dot next to it). All four now delegate to `isOverCarbGoal`
 * (`#app/lib/goal-progress`); this test drives each call site with identical
 * boundary inputs and asserts they agree.
 *
 * The second suite below extends the same guarantee to the Overview page's
 * Budget Ridge (M216/01): the ridge and the `/trends` adherence grid are given
 * the same days and the same goals, and every day's verdict has to match on
 * all three metrics. The two surfaces are drawn from different models, so
 * nothing but this test stops one of them from growing its own comparison.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeCarbGoalProgress } from '../../app/lib/goal-progress';
import { buildHabitStrip } from '../../app/models/habit-strip';
import { computeDailyEntry } from '../../app/models/daily-totals';
import type { LocalDailyTotals } from '../../app/lib/local-store/aggregates';
import { computeStreak } from '../../app/lib/local-store/aggregates';
import { computeWeeklyRecap } from '../../app/lib/trend-recap';
import type { TrendDay } from '../../app/lib/trend-chart';
import { buildAdherenceGrid } from '../../app/models/adherence-grid';
import type { AdherenceDayTotal, AdherenceGoalKey, AdherenceGoals } from '../../app/models/adherence-grid';
import { buildDayRidge } from '../../app/models/day-ridge';
import type { RidgeGoals } from '../../app/models/day-ridge';
import { computeDailyEntry as computeDay } from '../../app/models/daily-totals';
import type { EatingStyleLens } from '../../app/lib/eating-style';

const TODAY = '2026-07-15';
const CEILING = 98;

/** A single day's `LocalDailyTotals` carrying exactly `netCarbs` (fiber/polyols zeroed). */
function dailyTotal(netCarbs: number): LocalDailyTotals {
  const snapshot = {
    carbs: netCarbs,
    fiber: 0,
    sugars: null,
    polyols: 0,
    protein: 0,
    fat: 0,
    kcal: null,
    aiEstimated: false,
  };
  return { date: TODAY, entryCount: 1, ...computeDailyEntry([snapshot]) };
}

/** Whether each of the four surfaces reads `netCarbs` against `CEILING` as "over". */
type SurfaceVerdicts = { headline: boolean; habitDot: boolean; streak: boolean; recap: boolean };

function verdicts(netCarbs: number): SurfaceVerdicts {
  const headline = computeCarbGoalProgress({ netCarbs, ceiling: CEILING }).isOver;

  const strip = buildHabitStrip({
    today: TODAY,
    dayCount: 1,
    days: [{ date: TODAY, hasLogs: true, netCarbs }],
    netCarbsCeiling: CEILING,
  });
  const habitDot = strip[0].status === 'over';

  // A single-day series: over-goal breaks the streak (0), met keeps it (1).
  const streak = computeStreak([dailyTotal(netCarbs)], { netCarbsCeiling: CEILING }) === 0;

  const trendDay: TrendDay = {
    date: TODAY,
    hasLogs: true,
    summary: {
      carbs: netCarbs,
      fiber: 0,
      polyols: 0,
      netCarbs,
      protein: 0,
      fat: 0,
      kcal: 0,
      hasUnknowns: false,
      hasEstimates: false,
    },
    kcal: { total: 100, basis: 'reported', derivedShare: 0 },
    estimateShare: 0,
  };
  const weeklyRecap = computeWeeklyRecap({
    days: [trendDay],
    today: TODAY,
    netCarbsCeiling: CEILING,
    proteinFloor: null,
  });
  const recap = weeklyRecap.daysUnderCeiling === 0;

  return { headline, habitDot, streak, recap };
}

describe('over-carb-goal verdict agrees across every surface', () => {
  const cases: Array<{ label: string; netCarbs: number; expectedOver: boolean }> = [
    { label: 'just under the ceiling (97 vs 98)', netCarbs: 97, expectedOver: false },
    { label: 'exactly at the ceiling (98 vs 98)', netCarbs: 98, expectedOver: false },
    { label: 'just over the ceiling (99 vs 98)', netCarbs: 99, expectedOver: true },
    { label: 'sub-gram spillover that rounds down (98.3 vs 98)', netCarbs: 98.3, expectedOver: false },
    { label: 'sub-gram spillover that rounds up (98.6 vs 98)', netCarbs: 98.6, expectedOver: true },
  ];

  for (const { label, netCarbs, expectedOver } of cases) {
    it(`all four surfaces agree ${label}`, () => {
      const { headline, habitDot, streak, recap } = verdicts(netCarbs);
      assert.strictEqual(headline, expectedOver, `headline (goal-progress) mismatch for ${label}`);
      assert.strictEqual(habitDot, expectedOver, `habit-strip dot mismatch for ${label}`);
      assert.strictEqual(streak, expectedOver, `streak (aggregates) mismatch for ${label}`);
      assert.strictEqual(recap, expectedOver, `weekly recap mismatch for ${label}`);
    });
  }
});

////////////////////////////////////////////////////////////////////////////////
// The Overview ridge grades a day exactly as the /trends grid does
////////////////////////////////////////////////////////////////////////////////

/** The three lenses the ridge can grade by, paired with the grid's key for the same goal. */
const GRADED_METRICS: Array<{ lens: EatingStyleLens; key: AdherenceGoalKey; goal: number }> = [
  { lens: 'carb', key: 'netCarbs', goal: 98 },
  { lens: 'kcal', key: 'kcal', goal: 1800 },
  { lens: 'protein', key: 'protein', goal: 90 },
];

/** One day's figures, fed to BOTH surfaces so neither can be reading different numbers. */
interface Figures {
  date: string;
  netCarbs: number;
  protein: number;
  kcal: number;
}

/** The same figures as the ridge's input row. */
function ridgeRow(figures: Figures): LocalDailyTotals {
  const snapshot = {
    carbs: figures.netCarbs,
    fiber: 0,
    sugars: null,
    polyols: 0,
    protein: figures.protein,
    fat: 0,
    kcal: figures.kcal,
    aiEstimated: false,
  };
  return { date: figures.date, entryCount: 1, ...computeDay([snapshot]) };
}

/** The same figures as the adherence grid's input row. */
function gridRow(figures: Figures): AdherenceDayTotal {
  return {
    date: figures.date,
    hasLogs: true,
    netCarbs: figures.netCarbs,
    protein: figures.protein,
    kcal: figures.kcal,
  };
}

/** The ridge's goals, with only the graded metric configured. */
function ridgeGoalsFor(key: AdherenceGoalKey, goal: number): RidgeGoals {
  return {
    netCarbsCeiling: key === 'netCarbs' ? goal : null,
    kcalTarget: key === 'kcal' ? goal : null,
    proteinFloor: key === 'protein' ? goal : null,
  };
}

/** The very same goals in the grid's own shape, so neither surface is graded against a different number. */
function gridGoalsFor(key: AdherenceGoalKey, goal: number): AdherenceGoals {
  const ridge = ridgeGoalsFor(key, goal);
  return {
    netCarbsCeilingG: ridge.netCarbsCeiling,
    proteinFloorG: ridge.proteinFloor,
    kcalTarget: ridge.kcalTarget,
  };
}

describe('the Overview ridge and the /trends adherence grid grade the same day the same way', () => {
  // Boundary figures for each metric: one under, one exactly at the goal, and
  // one just past it, plus the sub-unit spillover that broke the four surfaces
  // above. Every case is run against all three metrics.
  const offsets = [-1, -0.4, 0, 0.4, 0.6, 1];

  for (const { lens, key, goal } of GRADED_METRICS) {
    for (const offset of offsets) {
      it(`agrees on ${key} at goal ${offset >= 0 ? '+' : ''}${offset}`, () => {
        const figures: Figures = {
          date: TODAY,
          netCarbs: key === 'netCarbs' ? goal + offset : 0,
          protein: key === 'protein' ? goal + offset : 0,
          kcal: key === 'kcal' ? goal + offset : 0,
        };
        const ridge = buildDayRidge({
          dailyTotals: [ridgeRow(figures)],
          today: TODAY,
          dayCount: 1,
          lens,
          goals: ridgeGoalsFor(key, goal),
        });
        const grid = buildAdherenceGrid({
          today: TODAY,
          weeks: 1,
          days: [gridRow(figures)],
          goals: gridGoalsFor(key, goal),
        });

        const gridDay = grid.days.find((day) => day.date === TODAY);
        assert.ok(gridDay, 'the grid must carry the day under test');
        const gridMet = gridDay.verdicts[key] === 'met';
        const ridgeMet = ridge.days[0].state === 'met';

        assert.equal(ridge.metric?.key, key, 'the lens must select the metric the grid graded');
        assert.equal(ridgeMet, gridMet, `${key} at ${goal + offset} against ${goal}`);
      });
    }
  }

  it('would notice a disagreement: a floor read as a ceiling flips exactly one of them', () => {
    // The control for the loop above. Protein 40 against a 90 g floor is
    // MISSED on both surfaces; the same numbers read as a carb ceiling are met.
    // If the assertion could not tell those apart, the loop proves nothing.
    const missed = buildDayRidge({
      dailyTotals: [ridgeRow({ date: TODAY, netCarbs: 0, protein: 40, kcal: 0 })],
      today: TODAY,
      dayCount: 1,
      lens: 'protein',
      goals: { netCarbsCeiling: null, kcalTarget: null, proteinFloor: 90 },
    });
    const met = buildDayRidge({
      dailyTotals: [ridgeRow({ date: TODAY, netCarbs: 40, protein: 0, kcal: 0 })],
      today: TODAY,
      dayCount: 1,
      lens: 'carb',
      goals: { netCarbsCeiling: 90, kcalTarget: null, proteinFloor: null },
    });

    assert.notEqual(missed.days[0].state, 'met');
    assert.equal(met.days[0].state, 'met');
  });
});
