/**
 * `app/lib/slot-stats.ts`'s three pure selectors (M239/04): `computeSlotAverages`,
 * `computeSlotShares` and `topFoodsForSlot`. Each claim below carries a control
 * that fails a plausible wrong version, the same discipline `trend-buckets.test.ts`
 * and `local-aggregates.test.ts` already follow.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeSlotAverages, computeSlotShares, topFoodsForSlot } from '../../app/lib/slot-stats';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';
import type { MealType } from '../../types/enums';

let nextId = 0;

/** One log with sane defaults, overridable per field. */
function foodLog(overrides: Partial<LocalFoodLog> & { dayKey: string }): LocalFoodLog {
  nextId += 1;
  return {
    id: `log-${nextId}`,
    name: overrides.name ?? `food-${nextId}`,
    quantityGrams: 100,
    macros: { carbs: 0, fiber: 0, sugars: null, polyols: 0, protein: 0, fat: 0, kcal: 100 },
    mealType: null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    loggedAt: Date.parse(`${overrides.dayKey}T12:00:00Z`),
    createdAt: Date.parse(`${overrides.dayKey}T12:00:00Z`),
    logBatchId: null,
    ...overrides,
  };
}

/** A log at one slot, with only `carbs` set (fiber/polyols zeroed, so net carbs === carbs). */
function slotLog({
  dayKey,
  mealType,
  carbs,
  kcal = 100,
  name = 'a food',
  foodId = null,
  loggedAt,
}: {
  dayKey: string;
  mealType: MealType | null;
  carbs: number;
  kcal?: number;
  name?: string;
  foodId?: string | null;
  loggedAt?: number;
}): LocalFoodLog {
  const overrides: Partial<LocalFoodLog> & { dayKey: string } = {
    dayKey,
    mealType,
    name,
    foodId,
    macros: { carbs, fiber: 0, sugars: null, polyols: 0, protein: carbs, fat: carbs, kcal },
  };
  if (loggedAt !== undefined) overrides.loggedAt = loggedAt;
  return foodLog(overrides);
}

describe('computeSlotAverages', () => {
  it('does not let a day with only another slot logged lower this slot’s average', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'breakfast', carbs: 20 }),
      slotLog({ dayKey: '2026-07-02', mealType: 'dinner', carbs: 999 }), // no breakfast at all
      slotLog({ dayKey: '2026-07-03', mealType: 'breakfast', carbs: 30 }),
    ];

    const averages = computeSlotAverages({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-03' } });

    // THE CLAIM: the gap day (dinner only) is skipped, not averaged in as a zero.
    assert.equal(averages.breakfast.averageNetCarbs, 25);
    assert.equal(averages.breakfast.loggedDays, 2);
    assert.equal(averages.breakfast.totalDays, 3);
    // THE CONTROL: dividing by every day in the range (including the gap) would read differently.
    assert.notEqual(averages.breakfast.averageNetCarbs, (20 + 30) / 3);

    // Dinner's count is "2 of 3" too, but its average is its own day's carbs, not breakfast's.
    assert.equal(averages.dinner.loggedDays, 1);
    assert.equal(averages.dinner.averageNetCarbs, 999);
  });

  it('reports null averages and zero logged days for a slot never logged in the range', () => {
    const logs = [slotLog({ dayKey: '2026-07-01', mealType: 'lunch', carbs: 10 })];
    const averages = computeSlotAverages({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-01' } });

    assert.deepEqual(averages.snack, {
      loggedDays: 0,
      totalDays: 1,
      averageKcal: null,
      averageNetCarbs: null,
      averageProtein: null,
      averageFat: null,
    });
    // Control: the slot that WAS logged is not also null.
    assert.notEqual(averages.lunch.averageNetCarbs, null);
  });
});

describe('computeSlotShares', () => {
  it('gives a log with no meal chosen its own "no meal set" segment, not a drop', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'breakfast', carbs: 20 }),
      slotLog({ dayKey: '2026-07-01', mealType: null, carbs: 20 }),
    ];
    const [row] = computeSlotShares({
      logs,
      range: { fromDate: '2026-07-01', toDate: '2026-07-01' },
      metric: 'net-carbs',
      isWeekly: false,
    });

    assert.ok(row.shares);
    assert.equal(row.shares?.breakfast, 50);
    // THE CLAIM: the unclassified log is counted, under its own name.
    assert.equal(row.shares?.noSlot, 50);
    // THE CONTROL: a version that dropped it would have breakfast read 100.
    assert.notEqual(row.shares?.breakfast, 100);
  });

  it('sums a logged day’s shares to 100 within rounding, no meal set included', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'breakfast', carbs: 7 }),
      slotLog({ dayKey: '2026-07-01', mealType: 'lunch', carbs: 11 }),
      slotLog({ dayKey: '2026-07-01', mealType: 'dinner', carbs: 13 }),
      slotLog({ dayKey: '2026-07-01', mealType: 'snack', carbs: 3 }),
      slotLog({ dayKey: '2026-07-01', mealType: null, carbs: 5 }),
    ];
    const [row] = computeSlotShares({
      logs,
      range: { fromDate: '2026-07-01', toDate: '2026-07-01' },
      metric: 'net-carbs',
      isWeekly: false,
    });

    assert.ok(row.shares);
    const total = row.shares ? Object.values(row.shares).reduce((sum, value) => sum + value, 0) : 0;
    assert.ok(Math.abs(total - 100) < 0.01, `expected ~100, got ${total}`);
  });

  it('gives an unlogged day a null split, never a zeroed one', () => {
    const [row] = computeSlotShares({
      logs: [],
      range: { fromDate: '2026-07-01', toDate: '2026-07-01' },
      metric: 'net-carbs',
      isWeekly: false,
    });
    assert.equal(row.hasLogs, false);
    assert.equal(row.shares, null);
  });

  it('averages a week over its logged days only, and treats an unlogged week as a gap', () => {
    // 2026-07-06 is a Monday.
    const logs = [
      slotLog({ dayKey: '2026-07-06', mealType: 'snack', carbs: 20, kcal: 200 }),
      slotLog({ dayKey: '2026-07-06', mealType: 'dinner', carbs: 20, kcal: 200 }),
      slotLog({ dayKey: '2026-07-09', mealType: 'dinner', carbs: 20, kcal: 200 }),
      // 2026-07-09 has no snack at all: the control day for the week's average.
    ];
    const rows = computeSlotShares({
      logs,
      range: { fromDate: '2026-07-06', toDate: '2026-07-19' },
      metric: 'kcal',
      isWeekly: true,
    });

    assert.deepEqual(
      rows.map((row) => [row.date, row.hasLogs]),
      [
        ['2026-07-06', true],
        ['2026-07-13', false],
      ],
    );
    // THE CLAIM: the week's raw kcal is averaged over the LOGGED days first
    // (200+200)/2 for dinner, (200+0)/2 for snack, matching `trend-buckets.ts`'s
    // own rule, and the share is read off THAT averaged total (300), not
    // divided by all seven days of the week and not a mean of each day's own
    // percentage (which would read 25, the control below).
    assert.ok(Math.abs((rows[0].shares?.snack ?? 0) - 100 / 3) < 0.01);
    assert.notEqual(rows[0].shares?.snack, 25);
    assert.equal(rows[1].shares, null);
  });
});

describe('topFoodsForSlot', () => {
  it('groups a food with no foodId by a trimmed, lower-cased name', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'breakfast', carbs: 10, name: 'Oatmeal' }),
      slotLog({ dayKey: '2026-07-02', mealType: 'breakfast', carbs: 10, name: 'oatmeal ' }),
    ];

    const top = topFoodsForSlot({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-02' }, slot: 'breakfast' });

    // THE CLAIM: "Oatmeal" and "oatmeal " collapse to one food.
    assert.equal(top.length, 1);
    assert.equal(top[0]?.logCount, 2);
  });

  it('collapses inner whitespace when grouping by name, without merging genuinely different names', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'breakfast', carbs: 10, name: 'Oat Meal' }),
      slotLog({ dayKey: '2026-07-02', mealType: 'breakfast', carbs: 10, name: 'Oat  Meal' }), // double inner space
      // The control: no space at all is a different word, not the same food.
      slotLog({ dayKey: '2026-07-03', mealType: 'breakfast', carbs: 10, name: 'Oatmeal' }),
    ];

    const top = topFoodsForSlot({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-03' }, slot: 'breakfast' });

    assert.equal(top.length, 2);
    const oatMeal = top.find((food) => food.name === 'Oat  Meal');
    assert.equal(oatMeal?.logCount, 2);
    const oatmeal = top.find((food) => food.name === 'Oatmeal');
    assert.equal(oatmeal?.logCount, 1);
  });

  it('counts distinct names as distinct foods (the control for the grouping claim)', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'breakfast', carbs: 10, name: 'Oatmeal' }),
      slotLog({ dayKey: '2026-07-02', mealType: 'breakfast', carbs: 10, name: 'oatmeal ' }),
      slotLog({ dayKey: '2026-07-03', mealType: 'breakfast', carbs: 10, name: 'Toast' }),
    ];

    const top = topFoodsForSlot({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-03' }, slot: 'breakfast' });

    assert.equal(top.length, 2);
    const oatmeal = top.find((food) => food.name.toLowerCase().includes('oatmeal'));
    assert.equal(oatmeal?.logCount, 2);
    // Displays the MOST RECENT casing, the second log's.
    assert.equal(oatmeal?.name, 'oatmeal ');
  });

  it('groups by foodId when present, over the name', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'lunch', carbs: 10, name: 'Chicken Salad', foodId: 'food-1' }),
      slotLog({ dayKey: '2026-07-02', mealType: 'lunch', carbs: 10, name: 'Chicken Salad (leftovers)', foodId: 'food-1' }),
    ];

    const top = topFoodsForSlot({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-02' }, slot: 'lunch' });

    assert.equal(top.length, 1);
    assert.equal(top[0]?.logCount, 2);
  });

  it('never counts a log at another slot or outside the range', () => {
    const logs = [
      slotLog({ dayKey: '2026-07-01', mealType: 'dinner', carbs: 10, name: 'Steak' }),
      slotLog({ dayKey: '2026-08-01', mealType: 'breakfast', carbs: 10, name: 'Way outside range' }),
    ];

    const top = topFoodsForSlot({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-31' }, slot: 'breakfast' });
    assert.deepEqual(top, []);
  });

  it('ranks most-logged first and caps at five', () => {
    const logs = Array.from({ length: 6 }, (_, index) =>
      Array.from({ length: index + 1 }, (__, occurrence) =>
        slotLog({
          dayKey: `2026-07-${String(occurrence + 1).padStart(2, '0')}`,
          mealType: 'snack',
          carbs: 1,
          name: `food-${index}`,
        }),
      ),
    ).flat();

    const top = topFoodsForSlot({ logs, range: { fromDate: '2026-07-01', toDate: '2026-07-06' }, slot: 'snack' });

    assert.equal(top.length, 5);
    // Most-logged (food-5, six entries) first.
    assert.equal(top[0]?.name, 'food-5');
    assert.equal(top[0]?.logCount, 6);
    // food-0 (one entry) is squeezed out by the cap.
    assert.ok(!top.some((food) => food.name === 'food-0'));
  });
});
