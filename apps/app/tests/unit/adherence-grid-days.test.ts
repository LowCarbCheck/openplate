/**
 * Unit tests for `#app/lib/adherence-grid-days`, the ONE selection of the
 * 13-week window that both `/trends` and Overview draw their goal grid over.
 *
 * The window is the whole point of the seam: `buildAdherenceGrid` derives its
 * own columns from `today` and `weeks`, so a selection that hands back a
 * different span silently produces a grid with holes at one end. What is
 * pinned here is the span itself: exactly `weeks * 7` days, Monday first,
 * ending on the Sunday of the week that contains `today`, with today's own logs
 * inside the last column.
 *
 * Sunday is the interesting `today`. Weeks run Monday to Sunday, so on a Sunday
 * the containing week ENDS on today, and a selection that reached six days past
 * today (or that treated Sunday as the start of a week) would run a week long.
 * Each case below states the value that would break it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GRID_WEEKS, selectAdherenceGridDays } from '../../app/lib/adherence-grid-days';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

/** Days in a Monday to Sunday week. */
const DAYS_PER_WEEK = 7;

/** 2026-08-06 is a Thursday: a mid-week `today`, the ordinary case. */
const THURSDAY = '2026-08-06';
/** 2026-08-09 is a Sunday: the last day of its own week, the boundary case. */
const SUNDAY = '2026-08-09';
/** 2026-08-10 is the Monday after `SUNDAY`: the first day of the NEXT week. */
const MONDAY = '2026-08-10';

/** 0 = Sunday … 6 = Saturday, read as a UTC field off an already-local `YYYY-MM-DD`. */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** A complete food log on `dayKey`; only `dayKey` and the macros matter here. */
function log(dayKey: string): LocalFoodLog {
  return {
    id: `log-${dayKey}`,
    name: 'eggs',
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal: 120 },
    mealType: 'lunch',
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

describe('selectAdherenceGridDays', () => {
  it('selects exactly weeks * 7 days, whatever the week count', () => {
    for (const weeks of [1, 4, GRID_WEEKS]) {
      const days = selectAdherenceGridDays({ allLogs: [], today: THURSDAY, weeks });
      assert.equal(
        days.length,
        weeks * DAYS_PER_WEEK,
        `${weeks} whole weeks is ${weeks * DAYS_PER_WEEK} days, never a ragged part-week`,
      );
    }
    // Control: the assertion is not vacuous. A 13-week grid fed a 12-week
    // window would be 84 days, which is not 91.
    assert.notEqual(selectAdherenceGridDays({ allLogs: [], today: THURSDAY, weeks: 12 }).length, GRID_WEEKS * 7);
  });

  it('starts on a Monday and ends on a Sunday', () => {
    const days = selectAdherenceGridDays({ allLogs: [], today: THURSDAY, weeks: GRID_WEEKS });

    assert.equal(weekdayOf(days[0].date), 1, 'the first column opens on a Monday');
    assert.equal(weekdayOf(days[days.length - 1].date), 0, 'the last column closes on a Sunday');
  });

  it('ends on the Sunday of the week that CONTAINS today, not seven days after today', () => {
    // Thursday 2026-08-06 sits in the week 2026-08-03 (Mon) to 2026-08-09 (Sun).
    const midWeek = selectAdherenceGridDays({ allLogs: [], today: THURSDAY, weeks: GRID_WEEKS });
    assert.equal(midWeek[midWeek.length - 1].date, SUNDAY);

    // The boundary: on a Sunday the containing week ENDS today. A selection that
    // ran to `today + 6` would answer 2026-08-15, a week too far; one that read
    // Sunday as a week START would answer 2026-08-16.
    const onSunday = selectAdherenceGridDays({ allLogs: [], today: SUNDAY, weeks: GRID_WEEKS });
    assert.equal(onSunday[onSunday.length - 1].date, SUNDAY, 'a Sunday today closes its own week');
    assert.equal(onSunday.length, GRID_WEEKS * DAYS_PER_WEEK);

    // Control: the very next day IS a new week, so its window moves on by seven.
    const onMonday = selectAdherenceGridDays({ allLogs: [], today: MONDAY, weeks: GRID_WEEKS });
    assert.equal(onMonday[onMonday.length - 1].date, '2026-08-16');
    assert.notEqual(onMonday[onMonday.length - 1].date, onSunday[onSunday.length - 1].date);
  });

  it('lands a log made TODAY in the last week column', () => {
    const days = selectAdherenceGridDays({ allLogs: [log(THURSDAY)], today: THURSDAY, weeks: GRID_WEEKS });
    const lastWeek = days.slice(-DAYS_PER_WEEK);

    const todayCell = lastWeek.find((day) => day.date === THURSDAY);
    assert.ok(todayCell !== undefined, "today must be a slot in the grid's last column");
    assert.equal(todayCell.hasLogs, true, "today's log must reach the cell");
    // Control: only that one day is logged, so a window that mislaid it would
    // leave the whole selection empty rather than quietly moving it.
    assert.equal(
      days.filter((day) => day.hasLogs).length,
      1,
      'exactly the one logged day is marked, and it is inside the window',
    );
  });

  it('carries the day figures the grid grades, and null where nothing is computable', () => {
    const days = selectAdherenceGridDays({ allLogs: [log(THURSDAY)], today: THURSDAY, weeks: 1 });
    const todayCell = days.find((day) => day.date === THURSDAY);
    assert.ok(todayCell !== undefined);

    assert.equal(todayCell.kcal, 120);
    assert.equal(todayCell.protein, 5);
    assert.equal(todayCell.netCarbs, 8);

    const emptyCell = days.find((day) => day.date !== THURSDAY);
    assert.ok(emptyCell !== undefined);
    assert.deepEqual(
      { hasLogs: emptyCell.hasLogs, netCarbs: emptyCell.netCarbs, protein: emptyCell.protein },
      { hasLogs: false, netCarbs: null, protein: null },
    );
  });

  it('fixes the shared week count at 13, so the two screens draw one quarter', () => {
    assert.equal(GRID_WEEKS, 13);
  });
});
