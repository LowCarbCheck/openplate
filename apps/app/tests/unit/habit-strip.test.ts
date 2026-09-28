/**
 * Unit tests for `#app/models/habit-strip` — the pure date-window/dot-mapping
 * helpers behind the diary's 7-day streak strip. No DB import, so these run
 * without a database (the diary loader feeds the per-day totals from
 * `getDailyTotalsInRange`, which is left untested per the no-DB convention).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildHabitStrip, countLoggedDays } from '../../app/models/habit-strip';
import type { HabitStripDayTotal } from '../../app/models/habit-strip';

/** Builds a window entry; net carbs default to a low value so a set ceiling reads "met" unless overridden. */
function day(date: string, hasLogs: boolean, netCarbs: number | null = hasLogs ? 0 : null): HabitStripDayTotal {
  return { date, hasLogs, netCarbs };
}

describe('buildHabitStrip', () => {
  it('builds a window of `dayCount` days ending on today, oldest first', () => {
    const strip = buildHabitStrip({ today: '2026-07-12', dayCount: 7, days: [], netCarbsCeiling: null });

    assert.deepStrictEqual(
      strip.map((entry) => entry.date),
      ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'],
    );
  });

  it('marks only the final day as today', () => {
    const strip = buildHabitStrip({ today: '2026-07-12', dayCount: 7, days: [], netCarbsCeiling: null });

    assert.deepStrictEqual(
      strip.map((entry) => entry.isToday),
      [false, false, false, false, false, false, true],
    );
  });

  it('crosses a month boundary correctly', () => {
    const strip = buildHabitStrip({ today: '2026-03-02', dayCount: 7, days: [], netCarbsCeiling: null });

    assert.deepStrictEqual(
      strip.map((entry) => entry.date),
      ['2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'],
    );
  });

  describe('two-state (no ceiling)', () => {
    it('marks logged days `logged` and empty days `none`, ignoring order and duplicates', () => {
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 7,
        days: [day('2026-07-12', true), day('2026-07-08', true), day('2026-07-08', true)],
        netCarbsCeiling: null,
      });

      const logged = strip.filter((entry) => entry.status === 'logged').map((entry) => entry.date);
      assert.deepStrictEqual(logged, ['2026-07-08', '2026-07-12']);
      assert.ok(strip.filter((entry) => entry.status === 'none').length === 5);
    });

    it('never emits met/over without a ceiling', () => {
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 7,
        days: [day('2026-07-12', true, 999)],
        netCarbsCeiling: null,
      });

      assert.ok(strip.every((entry) => entry.status === 'logged' || entry.status === 'none'));
    });

    it('ignores days outside the window', () => {
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 7,
        days: [day('2026-07-01', true), day('2026-08-01', true)],
        netCarbsCeiling: null,
      });

      assert.ok(strip.every((entry) => entry.status === 'none'));
    });
  });

  describe('three-state (ceiling set)', () => {
    it('splits logged days into met (≤ ceiling) and over (> ceiling)', () => {
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 7,
        days: [day('2026-07-10', true, 18), day('2026-07-11', true, 25), day('2026-07-12', true, 20)],
        netCarbsCeiling: 20,
      });

      const byDate = new Map(strip.map((entry) => [entry.date, entry.status]));
      assert.strictEqual(byDate.get('2026-07-10'), 'met'); // under
      assert.strictEqual(byDate.get('2026-07-12'), 'met'); // exactly at ceiling is met
      assert.strictEqual(byDate.get('2026-07-11'), 'over'); // over
    });

    it('rounds like the diary headline: sub-gram spillover reads met, not over (98.3 vs 98)', () => {
      // Regression for the dot disagreeing with the "98.3 of 98 g" headline on
      // the same screen — both must use the same rounded comparison.
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 1,
        days: [day('2026-07-12', true, 98.3)],
        netCarbsCeiling: 98,
      });

      assert.strictEqual(strip[0].status, 'met');
    });

    it('reads over once the rounded value exceeds the rounded ceiling (98.6 vs 98)', () => {
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 1,
        days: [day('2026-07-12', true, 98.6)],
        netCarbsCeiling: 98,
      });

      assert.strictEqual(strip[0].status, 'over');
    });

    it('keeps an empty day `none` even with a ceiling', () => {
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 7,
        days: [day('2026-07-12', false)],
        netCarbsCeiling: 20,
      });

      assert.strictEqual(strip.at(-1)?.status, 'none');
    });

    it('leaves a logged day with unknown net carbs as neutral `logged`, never met/over', () => {
      const strip = buildHabitStrip({
        today: '2026-07-12',
        dayCount: 7,
        days: [day('2026-07-12', true, null)],
        netCarbsCeiling: 20,
      });

      assert.strictEqual(strip.at(-1)?.status, 'logged');
    });
  });
});

describe('countLoggedDays', () => {
  it('counts every non-empty day regardless of met/over/logged', () => {
    const strip = buildHabitStrip({
      today: '2026-07-12',
      dayCount: 7,
      days: [day('2026-07-12', true, 5), day('2026-07-11', true, 30), day('2026-07-08', true, null)],
      netCarbsCeiling: 20,
    });

    assert.strictEqual(countLoggedDays(strip), 3);
  });

  it('returns 0 for a strip with no logged days', () => {
    const strip = buildHabitStrip({ today: '2026-07-12', dayCount: 7, days: [], netCarbsCeiling: null });

    assert.strictEqual(countLoggedDays(strip), 0);
  });
});
