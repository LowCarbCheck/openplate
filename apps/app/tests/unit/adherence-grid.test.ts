/**
 * Unit tests for `#app/models/adherence-grid` — the pure model behind the
 * Progress page's 13-week goal grid. No DB import, so these run without a
 * database (the loader feeds the per-day totals from
 * `computeDailyTotalsInRange`, which is left untested per the no-DB
 * convention).
 *
 * The cases below are the spec's worked examples E1–E16. The two that matter
 * most are the ones about honesty rather than arithmetic: a goal that can't be
 * assessed must leave BOTH the numerator and the denominator (E7, E8), and a
 * logged day where nothing went right is still ON the ramp (E5) rather than
 * looking identical to a day the user never opened the app.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildAdherenceGrid, countConfiguredGoals, resolveAdherenceDay } from '../../app/models/adherence-grid';
import type { AdherenceDayTotal, AdherenceGoals } from '../../app/models/adherence-grid';

/** The fixture goals used unless a case states otherwise (all three configured). */
const GOALS: AdherenceGoals = { netCarbsCeilingG: 20, proteinFloorG: 100, kcalTarget: 1800 };

/** A windowed day's totals; every macro defaults to null (nothing computable). */
function total(overrides: Partial<AdherenceDayTotal> = {}): AdherenceDayTotal {
  return { date: '2026-07-14', hasLogs: true, netCarbs: null, protein: null, kcal: null, ...overrides };
}

/** Resolves one day against `goals`, as a non-today, non-future cell. */
function resolve(day: AdherenceDayTotal, goals: AdherenceGoals = GOALS) {
  return resolveAdherenceDay({ total: day, goals, isToday: false, isFuture: false });
}

describe('countConfiguredGoals', () => {
  it('counts only positive numbers — a null or a 0 is "not set"', () => {
    assert.equal(countConfiguredGoals(GOALS), 3);
    assert.equal(countConfiguredGoals({ netCarbsCeilingG: 20, proteinFloorG: null, kcalTarget: 0 }), 1);
    assert.equal(countConfiguredGoals({ netCarbsCeilingG: null, proteinFloorG: null, kcalTarget: null }), 0);
  });
});

describe('resolveAdherenceDay', () => {
  it('E1: an unlogged day is no-data, off the ramp', () => {
    const day = resolve(total({ hasLogs: false }));

    assert.equal(day.status, 'no-data');
    assert.equal(day.level, null);
    assert.equal(day.metCount, 0);
    assert.equal(day.ratedCount, 0);
  });

  it('E2: every goal met is level 4', () => {
    const day = resolve(total({ netCarbs: 18, protein: 112, kcal: 1740 }));

    assert.equal(day.status, 'rated');
    assert.deepEqual(day.verdicts, { netCarbs: 'met', protein: 'met', kcal: 'met' });
    assert.equal(day.metCount, 3);
    assert.equal(day.ratedCount, 3);
    assert.equal(day.level, 4);
  });

  it('E3: two of three met is level 3', () => {
    const day = resolve(total({ netCarbs: 26, protein: 112, kcal: 1740 }));

    assert.deepEqual(day.verdicts, { netCarbs: 'missed', protein: 'met', kcal: 'met' });
    assert.equal(day.metCount, 2);
    assert.equal(day.ratedCount, 3);
    assert.equal(day.level, 3);
  });

  it('E4: one of three met is level 2', () => {
    const day = resolve(total({ netCarbs: 26, protein: 60, kcal: 1740 }));

    assert.equal(day.metCount, 1);
    assert.equal(day.ratedCount, 3);
    assert.equal(day.level, 2);
  });

  it('E5: a logged day that met nothing is still ON the ramp at level 1, never no-data', () => {
    const day = resolve(total({ netCarbs: 26, protein: 60, kcal: 2400 }));

    assert.equal(day.status, 'rated');
    assert.equal(day.metCount, 0);
    assert.equal(day.ratedCount, 3);
    assert.equal(day.level, 1);
  });

  it('E6: logged but nothing computable is `unrated`, not a missed day', () => {
    const day = resolve(total());

    assert.equal(day.status, 'unrated');
    assert.deepEqual(day.verdicts, { netCarbs: 'unknown', protein: 'unknown', kcal: 'unknown' });
    assert.equal(day.level, null);
    assert.equal(day.ratedCount, 0);
  });

  it('E7: an unknown goal leaves BOTH the numerator and the denominator', () => {
    const day = resolve(total({ netCarbs: 18 }));

    assert.equal(day.status, 'rated');
    assert.deepEqual(day.verdicts, { netCarbs: 'met', protein: 'unknown', kcal: 'unknown' });
    assert.equal(day.metCount, 1);
    assert.equal(day.ratedCount, 1);
    assert.equal(day.level, 4, '1 of 1 is "every goal I could check" — the darkest step');
  });

  it('E8: an unconfigured goal is absent from the verdicts, and a 1-of-2 tie rounds UP', () => {
    const day = resolve(total({ netCarbs: 18, protein: 60, kcal: 1740 }), {
      netCarbsCeilingG: 20,
      proteinFloorG: 100,
      kcalTarget: null,
    });

    assert.equal('kcal' in day.verdicts, false);
    assert.equal(day.metCount, 1);
    assert.equal(day.ratedCount, 2);
    assert.equal(day.level, 3);
  });

  it('E9: with no goal configured a logged day is binary, with no verdicts and no level', () => {
    const day = resolve(total({ netCarbs: 18, protein: 112, kcal: 1740 }), {
      netCarbsCeilingG: null,
      proteinFloorG: null,
      kcalTarget: null,
    });

    assert.equal(day.status, 'logged');
    assert.equal(day.level, null);
    assert.deepEqual(day.verdicts, {});
  });

  it('E10/E11: the carb ceiling is decided on the DISPLAYED (rounded) grams', () => {
    assert.equal(resolve(total({ netCarbs: 20.4 })).verdicts.netCarbs, 'met');
    assert.equal(resolve(total({ netCarbs: 20.6 })).verdicts.netCarbs, 'missed');
  });

  it('E12: the protein floor rounds the same way', () => {
    assert.equal(resolve(total({ protein: 99.6 })).verdicts.protein, 'met');
  });

  it('E13: exactly at the calorie target is met, not over', () => {
    assert.equal(resolve(total({ kcal: 1800 })).verdicts.kcal, 'met');
    assert.equal(resolve(total({ kcal: 1801 })).verdicts.kcal, 'missed');
  });

  it('a future slot is an empty spacer, never a "no entry" accusation', () => {
    const day = resolveAdherenceDay({
      total: total({ netCarbs: 18 }),
      goals: GOALS,
      isToday: false,
      isFuture: true,
    });

    assert.equal(day.isFuture, true);
    assert.equal(day.status, 'no-data');
    assert.equal(day.level, null);
  });

  it('rates today exactly like any other day — it gets a ring, not a special state', () => {
    const day = resolveAdherenceDay({
      total: total({ netCarbs: 18, protein: 112, kcal: 1740 }),
      goals: GOALS,
      isToday: true,
      isFuture: false,
    });

    assert.equal(day.isToday, true);
    assert.equal(day.status, 'rated');
    assert.equal(day.level, 4);
  });
});

describe('buildAdherenceGrid', () => {
  /** E14's window: today is Wednesday 2026-08-05. */
  const TODAY = '2026-08-05';

  function build(days: AdherenceDayTotal[] = [], goals: AdherenceGoals = GOALS) {
    return buildAdherenceGrid({ today: TODAY, weeks: 13, days, goals });
  }

  it('E14: builds 13 whole Monday→Sunday columns ending in the week containing today', () => {
    const grid = build();

    assert.equal(grid.weeks.length, 13);
    assert.equal(grid.days.length, 91);
    assert.equal(grid.weeks[0][0].date, '2026-05-11');
    assert.equal(grid.weeks[12][0].date, '2026-08-03', 'the last column opens on Monday');
    assert.equal(grid.weeks[12][2].isToday, true);
    assert.deepEqual(
      grid.weeks[12].slice(3).map((day) => day.isFuture),
      [true, true, true, true],
    );
  });

  it('E15: labels the first column and every column whose Monday opens a new month', () => {
    const grid = build();

    assert.deepEqual(grid.monthLabels, [
      { weekIndex: 0, weekStart: '2026-05-11' },
      { weekIndex: 3, weekStart: '2026-06-01' },
      { weekIndex: 8, weekStart: '2026-07-06' },
      { weekIndex: 12, weekStart: '2026-08-03' },
    ]);
  });

  it('E16: counts elapsed days honestly — the future slots are not in the denominator', () => {
    const grid = build([
      total({ date: '2026-08-03', netCarbs: 18, protein: 112, kcal: 1740 }),
      total({ date: '2026-08-04', netCarbs: 26, protein: 112, kcal: 1740 }),
    ]);

    // 91 slots minus the four that haven't happened yet: today is a Wednesday,
    // so Thu–Sun of the last column are still ahead (E14 pins the same four).
    assert.equal(grid.elapsedDayCount, 87);
    assert.equal(grid.loggedDayCount, 2);
    assert.equal(grid.perfectDayCount, 1, 'only the level-4 day counts as perfect');
  });

  it('flattens `days` in the same column-major order the grid renders', () => {
    const grid = build();

    assert.deepEqual(grid.days.slice(0, 7), grid.weeks[0]);
    assert.equal(grid.days[7], grid.weeks[1][0]);
  });

  it('ignores days outside the window and tolerates unordered input', () => {
    const grid = build([total({ date: '2026-01-01' }), total({ date: '2027-01-01' })]);

    assert.equal(grid.loggedDayCount, 0);
  });

  it('switches to activity mode when nothing is configured', () => {
    const grid = build([total({ date: '2026-08-04', netCarbs: 18 })], {
      netCarbsCeilingG: null,
      proteinFloorG: null,
      kcalTarget: null,
    });

    assert.equal(grid.mode, 'activity');
    assert.equal(grid.goalCount, 0);
    assert.equal(grid.perfectDayCount, 0, 'activity mode has no ramp, so no day is "perfect"');
    assert.equal(grid.loggedDayCount, 1);
  });

  it('flags an ungradeable day so the legend can explain its neutral colour', () => {
    assert.equal(build([total({ date: '2026-08-04' })]).hasUnratedDays, true);
    assert.equal(build().hasUnratedDays, false);
  });
});
