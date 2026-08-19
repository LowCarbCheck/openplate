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
  return { date: TODAY, ...computeDailyEntry([snapshot]) };
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
