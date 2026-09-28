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
import {
  computeDailyTotalsInRange,
  computeSlotTotalsInRange,
  computeStreak,
} from '../../app/lib/local-store/aggregates';
import type { LocalDailyTotals } from '../../app/lib/local-store/aggregates';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';
import type { MealType } from '../../types/enums';

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

/** The same minimal log, in a named meal slot. */
function mealLog(id: string, dayKey: string, carbs: number, mealType: MealType): LocalFoodLog {
  return { ...foodLog(id, dayKey, carbs), mealType };
}

/** A day's totals: logged with `netCarbs` when given, else a gap day — for streak fixtures. */
function dailyTotal(date: string, netCarbs: number | null): LocalDailyTotals {
  if (netCarbs === null) return { date, entryCount: 0, ...computeDailyEntry([]) };
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
  return { date, entryCount: 1, ...computeDailyEntry([snapshot]) };
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

describe('computeSlotTotalsInRange', () => {
  /** The window every case below is read over. */
  const WINDOW = { fromDate: '2026-07-01', toDate: '2026-07-03' };

  it('counts only the entries in the chosen slot on a day that mixes two', () => {
    const logs = [
      mealLog('snack', '2026-07-01', 30, 'snack'),
      mealLog('dinner', '2026-07-01', 10, 'dinner'),
    ];

    const snacks = computeSlotTotalsInRange(logs, WINDOW, 'snack');
    const wholeDay = computeDailyTotalsInRange(logs, WINDOW);

    // The control: the same logs, unfiltered, DO add up to 40. Without it the
    // assertion below would pass against an aggregator that counted nothing.
    assert.equal(wholeDay[0].summary?.netCarbs, 40);
    assert.equal(snacks[0].summary?.netCarbs, 30);
    assert.equal(snacks[0].entryCount, 1);
  });

  it('reads a day with entries in OTHER slots only as empty, and keeps it in the series', () => {
    const logs = [mealLog('dinner', '2026-07-02', 10, 'dinner')];

    const snacks = computeSlotTotalsInRange(logs, WINDOW, 'snack');

    // Present, not omitted: three days in, three days out.
    assert.equal(snacks.length, 3);
    assert.equal(snacks[1].date, '2026-07-02');
    assert.equal(snacks[1].hasLogs, false);
    assert.equal(snacks[1].entryCount, 0);
    assert.equal(snacks[1].summary, null);
  });

  it('never counts an entry that was logged with no meal at all', () => {
    // `foodLog` leaves `mealType` null, which is "this entry has no meal".
    const snacks = computeSlotTotalsInRange([foodLog('loose', '2026-07-01', 30)], WINDOW, 'snack');

    assert.equal(snacks[0].hasLogs, false);
  });

  it('keeps the same day bucketing as the whole-day aggregate, boundaries included', () => {
    const logs = [
      mealLog('first', '2026-07-01', 5, 'lunch'),
      mealLog('last', '2026-07-03', 7, 'lunch'),
      mealLog('outside', '2026-07-04', 9, 'lunch'),
    ];

    const lunches = computeSlotTotalsInRange(logs, WINDOW, 'lunch');

    assert.deepEqual(
      lunches.map((day) => day.summary?.netCarbs ?? null),
      [5, null, 7],
    );
  });
});
