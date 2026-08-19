/**
 * Unit tests for the local aggregates' pure functions
 * (`app/lib/local-store/aggregates`): `computeDailyTotalsInRange`'s day
 * bucketing (range boundaries + a gap day in the middle) and `computeStreak`'s
 * break conditions (empty range, all-gap-days, today-not-yet-logged, a ceiling
 * breach). Both operate on plain arrays — no store, no browser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeDailyEntry } from '../../app/models/daily-totals';
import { computeDailyTotalsInRange, computeStreak } from '../../app/lib/local-store/aggregates';
import type { LocalDailyTotals } from '../../app/lib/local-store/aggregates';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

/** A minimal food log on `dayKey`; fiber/polyols zeroed so `netCarbs === carbs`. */
function foodLog(id: string, dayKey: string, carbs: number): LocalFoodLog {
  return {
    id,
    name: id,
    quantityGrams: 100,
    macros: { carbs, fiber: 0, sugars: null, polyols: 0, protein: 0, fat: 0, kcal: null },
    mealType: null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: Date.parse(`${dayKey}T12:00:00Z`),
    createdAt: Date.parse(`${dayKey}T12:00:00Z`),
    logBatchId: null,
  };
}

/** A day's totals: logged with `netCarbs` when given, else a gap day — for streak fixtures. */
function dailyTotal(date: string, netCarbs: number | null): LocalDailyTotals {
  if (netCarbs === null) return { date, ...computeDailyEntry([]) };
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
  return { date, ...computeDailyEntry([snapshot]) };
}

describe('computeDailyTotalsInRange', () => {
  it('buckets an entry exactly on the range-start boundary', () => {
    const result = computeDailyTotalsInRange([foodLog('start', '2026-07-01', 10)], {
      fromDate: '2026-07-01',
      toDate: '2026-07-03',
    });
    assert.equal(result[0].date, '2026-07-01');
    assert.equal(result[0].hasLogs, true);
    assert.equal(result[0].summary?.netCarbs, 10);
  });

  it('buckets an entry exactly on the range-end boundary', () => {
    const result = computeDailyTotalsInRange([foodLog('end', '2026-07-03', 20)], {
      fromDate: '2026-07-01',
      toDate: '2026-07-03',
    });
    assert.equal(result[2].date, '2026-07-03');
    assert.equal(result[2].hasLogs, true);
    assert.equal(result[2].summary?.netCarbs, 20);
  });

  it('reports a gap day in the middle of the range as hasLogs: false with a null summary', () => {
    const logs = [foodLog('a', '2026-07-01', 10), foodLog('b', '2026-07-03', 20)];
    const result = computeDailyTotalsInRange(logs, { fromDate: '2026-07-01', toDate: '2026-07-03' });

    const middle = result.find((day) => day.date === '2026-07-02');
    assert.ok(middle);
    assert.equal(middle.hasLogs, false);
    assert.equal(middle.summary, null);
  });

  it('excludes entries strictly outside the range on either side', () => {
    const logs = [
      foodLog('before', '2026-06-30', 5),
      foodLog('inside', '2026-07-01', 10),
      foodLog('after', '2026-07-02', 15),
    ];
    const result = computeDailyTotalsInRange(logs, { fromDate: '2026-07-01', toDate: '2026-07-01' });

    assert.equal(result.length, 1);
    assert.equal(result[0].summary?.netCarbs, 10);
  });

  it('returns an all-gap-day series for a range with no logs at all', () => {
    const result = computeDailyTotalsInRange([], { fromDate: '2026-07-01', toDate: '2026-07-03' });
    assert.equal(result.length, 3);
    assert.ok(result.every((day) => day.hasLogs === false));
  });

  it('sums multiple entries logged on the same day into one bucket', () => {
    const logs = [foodLog('a', '2026-07-01', 10), foodLog('b', '2026-07-01', 5)];
    const result = computeDailyTotalsInRange(logs, { fromDate: '2026-07-01', toDate: '2026-07-01' });
    assert.equal(result[0].summary?.netCarbs, 15);
  });
});

describe('computeStreak', () => {
  it('returns 0 for an empty range', () => {
    assert.equal(computeStreak([]), 0);
  });

  it('returns 0 when every day in the range is a gap (all-gap-days)', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03'].map((date) => dailyTotal(date, null));
    assert.equal(computeStreak(days), 0);
  });

  it('returns 0 when the last day (today) has not been logged yet, even after a prior streak', () => {
    const days = [dailyTotal('2026-07-01', 5), dailyTotal('2026-07-02', 5), dailyTotal('2026-07-03', null)];
    assert.equal(computeStreak(days), 0);
  });

  it('counts consecutive logged days ending at the last day, breaking at the first gap (break condition)', () => {
    const days = [
      dailyTotal('2026-07-01', 5),
      dailyTotal('2026-07-02', null),
      dailyTotal('2026-07-03', 5),
      dailyTotal('2026-07-04', 5),
    ];
    assert.equal(computeStreak(days), 2);
  });

  it('breaks the streak at a day over the net-carb ceiling, even though that day has logs', () => {
    const days = [
      dailyTotal('2026-07-01', 5),
      dailyTotal('2026-07-02', 50),
      dailyTotal('2026-07-03', 5),
      dailyTotal('2026-07-04', 5),
    ];
    assert.equal(computeStreak(days, { netCarbsCeiling: 30 }), 2);
  });

  it('counts every logged day when no ceiling is set, regardless of net-carb magnitude', () => {
    const days = [dailyTotal('2026-07-01', 5), dailyTotal('2026-07-02', 500), dailyTotal('2026-07-03', 5)];
    assert.equal(computeStreak(days), 3);
  });

  it('a day at exactly the ceiling still counts (breach is strictly over, not at)', () => {
    const days = [dailyTotal('2026-07-01', 30), dailyTotal('2026-07-02', 30)];
    assert.equal(computeStreak(days, { netCarbsCeiling: 30 }), 2);
  });

  it('rounds like the diary headline: sub-gram spillover does not break the streak (98.3 vs 98)', () => {
    // Regression for the streak breaking on a day the diary itself reports as
    // "under" — both must use the same rounded ceiling comparison.
    const days = [dailyTotal('2026-07-01', 98.3)];
    assert.equal(computeStreak(days, { netCarbsCeiling: 98 }), 1);
  });

  it('breaks the streak once the rounded value exceeds the rounded ceiling (98.6 vs 98)', () => {
    const days = [dailyTotal('2026-07-01', 98.6)];
    assert.equal(computeStreak(days, { netCarbsCeiling: 98 }), 0);
  });
});
