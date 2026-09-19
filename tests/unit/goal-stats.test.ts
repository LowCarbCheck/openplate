/**
 * `app/lib/goal-stats.ts` (M239/05): per-goal hit rate, average distance and
 * runs over the adherence grid's complete days, and `selectFastTargetShare`
 * from `app/models/fasting-stats.ts`, the Goals tab's fasting figure.
 *
 * Every claim is built through the real `buildAdherenceGrid`, so the verdicts
 * under test are the grid's own, and every claim carries a control that a
 * plausible wrong version would fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeGoalRuns, computeGoalStats } from '../../app/lib/goal-stats';
import type { GoalStat } from '../../app/lib/goal-stats';
import { selectFastTargetShare } from '../../app/models/fasting-stats';
import { buildAdherenceGrid } from '../../app/models/adherence-grid';
import type { AdherenceDayTotal, AdherenceGoalKey, AdherenceGoals } from '../../app/models/adherence-grid';
import type { LocalFast } from '../../app/lib/local-store/schema';

/** A Thursday, so the current week holds three complete days, today and three future slots. */
const TODAY = '2026-09-17';
const GRID_WEEKS = 13;

const NO_GOALS: AdherenceGoals = { netCarbsCeilingG: null, proteinFloorG: null, kcalTarget: null };

/** One logged day. A null figure is a macro the day could not work out. */
function loggedDay(
  date: string,
  figures: { netCarbs?: number | null; protein?: number | null; kcal?: number | null },
): AdherenceDayTotal {
  return {
    date,
    hasLogs: true,
    netCarbs: figures.netCarbs ?? null,
    protein: figures.protein ?? null,
    kcal: figures.kcal ?? null,
  };
}

/** The stats for a set of days graded against `goals`, with today fixed. */
function statsFor(days: readonly AdherenceDayTotal[], goals: AdherenceGoals): GoalStat[] {
  return computeGoalStats({ grid: buildAdherenceGrid({ today: TODAY, weeks: GRID_WEEKS, days, goals }), goals });
}

/** The one record for `key`, failing the test when it is absent. */
function statOf(stats: readonly GoalStat[], key: AdherenceGoalKey): GoalStat {
  const stat = stats.find((candidate) => candidate.key === key);
  assert.ok(stat, `no stat for ${key}`);
  return stat;
}

describe('computeGoalStats: which goals get a record', () => {
  it('returns nothing when no goal is set', () => {
    assert.deepEqual(statsFor([loggedDay('2026-09-15', { netCarbs: 10 })], NO_GOALS), []);
  });

  it('returns a record only for the goals that are set, in display order', () => {
    const goals = { ...NO_GOALS, netCarbsCeilingG: 50, kcalTarget: 2000 };
    const keys = statsFor([loggedDay('2026-09-15', { netCarbs: 10, kcal: 1500 })], goals).map((stat) => stat.key);
    assert.deepEqual(keys, ['netCarbs', 'kcal']);
  });
});

describe('computeGoalStats: the rate', () => {
  const goals = { ...NO_GOALS, netCarbsCeilingG: 50, proteinFloorG: 100 };

  it('leaves an unknown protein day out of the rate, and counts it apart', () => {
    const stats = statsFor(
      [
        loggedDay('2026-09-14', { netCarbs: 20, protein: 120 }),
        // Protein could not be worked out on this day: net carbs still rate it.
        loggedDay('2026-09-15', { netCarbs: 20, protein: null }),
      ],
      goals,
    );
    const protein = statOf(stats, 'protein');
    assert.equal(protein.ratedDays, 1);
    assert.equal(protein.metDays, 1);
    assert.equal(protein.unknownDays, 1);
    assert.equal(protein.hitRate, 1);
    // CONTROL: the same day is rated for net carbs, so it is in that goal's denominator.
    assert.equal(statOf(stats, 'netCarbs').ratedDays, 2);
  });

  it('meets a floor from above and misses a ceiling from above', () => {
    // 120 g of protein against a 100 g floor; 80 g of net carbs against a 50 g ceiling.
    const stats = statsFor([loggedDay('2026-09-15', { netCarbs: 80, protein: 120 })], goals);
    assert.equal(statOf(stats, 'protein').metDays, 1);
    assert.equal(statOf(stats, 'protein').direction, 'min');
    assert.equal(statOf(stats, 'netCarbs').metDays, 0);
    assert.equal(statOf(stats, 'netCarbs').ratedDays, 1);
    assert.equal(statOf(stats, 'netCarbs').direction, 'max');
  });

  it('has a null rate, not zero, when no day could be rated', () => {
    const stats = statsFor([loggedDay('2026-09-15', { netCarbs: 20, protein: null })], goals);
    assert.equal(statOf(stats, 'protein').hitRate, null);
    assert.equal(statOf(stats, 'protein').averageDifference, null);
    // CONTROL: net carbs on the same day has a rate.
    assert.equal(statOf(stats, 'netCarbs').hitRate, 1);
  });

  it('reads 1 of 2 for one day under and one over the ceiling', () => {
    const stats = statsFor(
      [loggedDay('2026-09-14', { netCarbs: 30 }), loggedDay('2026-09-15', { netCarbs: 70 })],
      { ...NO_GOALS, netCarbsCeilingG: 50 },
    );
    const netCarbs = statOf(stats, 'netCarbs');
    assert.equal(netCarbs.metDays, 1);
    assert.equal(netCarbs.ratedDays, 2);
    assert.equal(netCarbs.hitRate, 0.5);
  });

  it('averages the signed distance from the goal over the rated days', () => {
    // -20 and +40 around a 50 g ceiling: on average 10 g over.
    const stats = statsFor(
      [loggedDay('2026-09-14', { netCarbs: 30 }), loggedDay('2026-09-15', { netCarbs: 90 })],
      { ...NO_GOALS, netCarbsCeilingG: 50 },
    );
    assert.equal(statOf(stats, 'netCarbs').averageDifference, 10);
  });

  it('never counts today or a future slot', () => {
    const stats = statsFor(
      [loggedDay('2026-09-16', { netCarbs: 20 }), loggedDay(TODAY, { netCarbs: 90 }), loggedDay('2026-09-18', { netCarbs: 90 })],
      { ...NO_GOALS, netCarbsCeilingG: 50 },
    );
    const netCarbs = statOf(stats, 'netCarbs');
    assert.equal(netCarbs.ratedDays, 1);
    assert.equal(netCarbs.metDays, 1);
  });
});

describe('computeGoalStats: the runs', () => {
  const goals = { ...NO_GOALS, netCarbsCeilingG: 50, proteinFloorG: 100 };

  it('restarts the run at zero after one missed day', () => {
    const stats = statsFor(
      [
        loggedDay('2026-09-12', { netCarbs: 20 }),
        loggedDay('2026-09-13', { netCarbs: 20 }),
        loggedDay('2026-09-14', { netCarbs: 20 }),
        loggedDay('2026-09-15', { netCarbs: 80 }),
        loggedDay('2026-09-16', { netCarbs: 20 }),
      ],
      goals,
    );
    const netCarbs = statOf(stats, 'netCarbs');
    assert.equal(netCarbs.currentRun, 1);
    assert.equal(netCarbs.bestRun, 3);
  });

  it('breaks the run on a day with nothing logged', () => {
    const stats = statsFor(
      [loggedDay('2026-09-13', { netCarbs: 20 }), loggedDay('2026-09-14', { netCarbs: 20 }), loggedDay('2026-09-16', { netCarbs: 20 })],
      goals,
    );
    const netCarbs = statOf(stats, 'netCarbs');
    assert.equal(netCarbs.currentRun, 1);
    assert.equal(netCarbs.bestRun, 2);
  });

  it('skips an unknown day: it neither extends nor breaks the run', () => {
    const stats = statsFor(
      [
        loggedDay('2026-09-14', { netCarbs: 20, protein: 120 }),
        loggedDay('2026-09-15', { netCarbs: 20, protein: null }),
        loggedDay('2026-09-16', { netCarbs: 20, protein: 120 }),
      ],
      goals,
    );
    assert.equal(statOf(stats, 'protein').currentRun, 2);
    // CONTROL: net carbs was known and met on all three days.
    assert.equal(statOf(stats, 'netCarbs').currentRun, 3);
  });

  it('ends the current run with yesterday, so a met today does not extend it', () => {
    const grid = buildAdherenceGrid({
      today: TODAY,
      weeks: GRID_WEEKS,
      days: [loggedDay('2026-09-16', { netCarbs: 20 }), loggedDay(TODAY, { netCarbs: 20 })],
      goals,
    });
    const completeDays = grid.days.filter((day) => !day.isFuture && !day.isToday);
    assert.equal(computeGoalRuns({ days: completeDays, key: 'netCarbs' }).currentRun, 1);
    // CONTROL: fed today too, the walk would count it.
    const withToday = grid.days.filter((day) => !day.isFuture);
    assert.equal(computeGoalRuns({ days: withToday, key: 'netCarbs' }).currentRun, 2);
  });
});

////////////////////////////////////////////////////////////////////////////////
// selectFastTargetShare
////////////////////////////////////////////////////////////////////////////////

const HOUR = 3_600_000;
const BERLIN = 'Europe/Berlin';
const NOW_MS = Date.parse('2026-09-17T12:00:00+02:00');

let nextFastId = 0;

/** A fast that started at `startIso` and ran `hours` against a `targetHours` target, or is still running. */
function fast({ startIso, hours, targetHours = 16 }: { startIso: string; hours: number | null; targetHours?: number }): LocalFast {
  nextFastId += 1;
  const startedAt = Date.parse(startIso);
  return {
    id: `fast-${nextFastId}`,
    protocolId: 'custom',
    targetDurationMs: targetHours * HOUR,
    plannedStartAt: null,
    startedAt,
    endedAt: hours === null ? null : startedAt + hours * HOUR,
    createdAt: startedAt,
  };
}

describe('selectFastTargetShare', () => {
  it('counts each finished fast against its own target', () => {
    const share = selectFastTargetShare({
      fasts: [
        fast({ startIso: '2026-09-10T20:00:00+02:00', hours: 16, targetHours: 16 }),
        fast({ startIso: '2026-09-11T20:00:00+02:00', hours: 14, targetHours: 16 }),
        // 14 hours reaches a 12-hour target: the row's own target, not the other rows'.
        fast({ startIso: '2026-09-12T20:00:00+02:00', hours: 14, targetHours: 12 }),
      ],
      fromDate: '2026-06-22',
      nowMs: NOW_MS,
      timezone: BERLIN,
    });
    assert.deepEqual(share, { finishedCount: 3, reachedCount: 2 });
  });

  it('leaves out a running fast, a false start and a fast that ended before the window', () => {
    const share = selectFastTargetShare({
      fasts: [
        fast({ startIso: '2026-09-17T08:00:00+02:00', hours: null }),
        fast({ startIso: '2026-09-15T08:00:00+02:00', hours: 0.5 }),
        fast({ startIso: '2026-06-01T20:00:00+02:00', hours: 16 }),
        fast({ startIso: '2026-09-14T20:00:00+02:00', hours: 16 }),
      ],
      fromDate: '2026-06-22',
      nowMs: NOW_MS,
      timezone: BERLIN,
    });
    // CONTROL: the one fast inside the window that finished is still counted.
    assert.deepEqual(share, { finishedCount: 1, reachedCount: 1 });
  });
});
