/**
 * `bucketByWeek` (`app/lib/trend-buckets.ts`), the weekly fold the trends chart
 * uses at 30 and 90 days (M239/01).
 *
 * Each claim has a control that fails a plausible wrong version:
 *
 * - the average is over LOGGED days, so a week with two logged days out of
 *   seven must read as their mean, and dividing by seven gives a different,
 *   checked number;
 * - an unlogged week is a GAP, checked through the real chart model, where a
 *   gap is `empty` with no value and a zero would be a `solid` bar of 0;
 * - a floor day makes the week a floor, and a week with no floor day beside it
 *   in the same fixture must stay solid.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bucketByWeek } from '../../app/lib/trend-buckets';
import { buildTrendChart } from '../../app/lib/trend-chart';
import type { TrendDay } from '../../app/lib/trend-chart';
import { enumerateDates, shiftDate } from '../../app/lib/user-days';
import type { KcalBasis } from '../../app/models/daily-totals';
import type { DaySummary } from '../../app/models/food-log-summary';

/** A day nobody logged. */
function gapDay(date: string): TrendDay {
  return {
    date,
    hasLogs: false,
    summary: null,
    kcal: { total: null, basis: 'none', derivedShare: 0 },
    estimateShare: 0,
  };
}

/** A logged day with `netCarbs` and `kcal`, every other macro fixed. */
function loggedDay({
  date,
  netCarbs,
  kcal = 1000,
  basis = 'reported',
  hasUnknowns = false,
}: {
  date: string;
  netCarbs: number;
  kcal?: number | null;
  basis?: KcalBasis;
  hasUnknowns?: boolean;
}): TrendDay {
  const summary: DaySummary = {
    carbs: netCarbs,
    fiber: 0,
    polyols: 0,
    netCarbs,
    protein: 50,
    fat: 40,
    kcal: kcal ?? 0,
    hasUnknowns,
    hasEstimates: false,
  };
  return {
    date,
    hasLogs: true,
    summary,
    kcal: { total: kcal, basis: kcal === null ? 'none' : basis, derivedShare: 0 },
    estimateShare: 0,
  };
}

/** Every day from `from` to `to` as a gap, with `logged` swapped in on its own date. */
function daysWith({ from, to, logged }: { from: string; to: string; logged: readonly TrendDay[] }): TrendDay[] {
  return enumerateDates(from, to).map((date) => logged.find((day) => day.date === date) ?? gapDay(date));
}

describe('bucketByWeek', () => {
  it('averages a week over its logged days, not over seven', () => {
    // 2026-07-06 is a Monday. Two logged days, five skipped.
    const days = daysWith({
      from: '2026-07-06',
      to: '2026-07-12',
      logged: [
        loggedDay({ date: '2026-07-07', netCarbs: 10 }),
        loggedDay({ date: '2026-07-10', netCarbs: 30 }),
      ],
    });

    const [week] = bucketByWeek(days);

    assert.equal(week.summary?.netCarbs, 20);
    // The control: the divide-by-seven reading this rule exists to prevent.
    assert.notEqual(week.summary?.netCarbs, 40 / 7);
    assert.equal(week.kcal.total, 1000);
  });

  it('leaves a week with no logged day as a gap, which the chart draws as no data', () => {
    const days = daysWith({
      from: '2026-07-06',
      to: '2026-07-19',
      logged: [loggedDay({ date: '2026-07-08', netCarbs: 25 })],
    });

    const weeks = bucketByWeek(days);
    assert.deepEqual(
      weeks.map((week) => [week.date, week.hasLogs]),
      [
        ['2026-07-06', true],
        ['2026-07-13', false],
      ],
    );
    assert.equal(weeks[1].summary, null);

    const bars = buildTrendChart({ days: weeks, metric: 'net-carbs', goalValue: null }).bars;
    // The control is the logged week beside it: a real bar with a value.
    assert.deepEqual(
      bars.map((bar) => [bar.fill, bar.value]),
      [
        ['solid', 25],
        ['empty', null],
      ],
    );
  });

  it('keys each week by its Monday, even when the range starts mid-week', () => {
    // Wednesday to the Tuesday two weeks later: a part week at each end.
    const days = daysWith({ from: '2026-07-08', to: '2026-07-21', logged: [] });

    assert.deepEqual(
      bucketByWeek(days).map((week) => week.date),
      ['2026-07-06', '2026-07-13', '2026-07-20'],
    );
  });

  it('draws 13 weeks for a 90-day range ending on a Sunday, and 14 for one ending on a Monday', () => {
    const weeksEnding = (today: string): number =>
      bucketByWeek(daysWith({ from: shiftDate(today, -89), to: today, logged: [] })).length;

    // 2026-09-20 is a Sunday: the window opens on Tuesday 2026-06-23, inside
    // the week of Monday 2026-06-22, and 13 Mondays cover it.
    assert.equal(weeksEnding('2026-09-20'), 13);
    // One day later the window opens on a Wednesday and closes on a new Monday.
    assert.equal(weeksEnding('2026-09-21'), 14);
  });

  it('marks a week incomplete when any of its logged days is a floor', () => {
    const days = daysWith({
      from: '2026-07-06',
      to: '2026-07-19',
      logged: [
        loggedDay({ date: '2026-07-06', netCarbs: 20 }),
        loggedDay({ date: '2026-07-07', netCarbs: 20, hasUnknowns: true }),
        // The control week: every logged day fully known.
        loggedDay({ date: '2026-07-13', netCarbs: 20 }),
        loggedDay({ date: '2026-07-14', netCarbs: 20 }),
      ],
    });

    const bars = buildTrendChart({ days: bucketByWeek(days), metric: 'net-carbs', goalValue: null }).bars;
    assert.deepEqual(
      bars.map((bar) => bar.fill),
      ['incomplete', 'solid'],
    );
  });

  it('carries the weakest calorie basis in the week onto the week', () => {
    const week = (logged: readonly TrendDay[], monday: string): TrendDay =>
      bucketByWeek(daysWith({ from: monday, to: shiftDate(monday, 6), logged }))[0];

    const reported = week(
      [
        loggedDay({ date: '2026-07-06', netCarbs: 10 }),
        loggedDay({ date: '2026-07-07', netCarbs: 10 }),
      ],
      '2026-07-06',
    );
    const derived = week(
      [
        loggedDay({ date: '2026-07-06', netCarbs: 10 }),
        loggedDay({ date: '2026-07-07', netCarbs: 10, basis: 'partly-derived' }),
      ],
      '2026-07-06',
    );
    // A logged day with nothing computable leaves the mean short of the week.
    const floor = week(
      [
        loggedDay({ date: '2026-07-06', netCarbs: 10 }),
        loggedDay({ date: '2026-07-07', netCarbs: 10, kcal: null }),
      ],
      '2026-07-06',
    );

    assert.equal(reported.kcal.basis, 'reported');
    assert.equal(derived.kcal.basis, 'partly-derived');
    assert.equal(floor.kcal.basis, 'incomplete');
    // The mean is taken over the day that HAD a total, not halved by the one that did not.
    assert.equal(floor.kcal.total, 1000);
  });
});
