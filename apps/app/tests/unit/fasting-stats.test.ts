/**
 * Unit tests for `#app/models/fasting-stats`, the four practice-level figures
 * on `/fasting`: fasts finished, longest, current streak, hours this week.
 *
 * What this file pins, in one sentence each:
 *
 * - **A day is credited by INTERSECTION, not by the day the fast started.** A
 *   16:8 fast from 20:00 to 12:00 counts on both days, which is the whole
 *   reason overnight fasting can hold a streak at all.
 * - **The streak may end on yesterday.** Opening the app at 07:00 with no
 *   fasted minutes yet today must not read zero.
 * - **A gap day ends it**, and a fast under an hour is no day at all.
 * - **The rolling week is a window, not a bucket**: a fast that straddles the
 *   window's start contributes only the part inside it.
 * - **The zone comes from the argument.** The runtime zone below is set to New
 *   York on purpose, and every expectation is written in Europe/Berlin.
 */
process.env.TZ = 'America/New_York';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { selectFastingStats } from '../../app/models/fasting-stats';
import type { LocalFast } from '../../app/lib/local-store/schema';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const BERLIN = 'Europe/Berlin';

/**
 * Every instant below is written with an explicit `+02:00`, which is Berlin's
 * offset for the whole of September 2026 (CEST). Writing the offset out means a
 * fixture never quietly depends on the runner's own zone.
 */
function at(iso: string): number {
  const ms = Date.parse(iso);
  assert.ok(!Number.isNaN(ms), `unparseable fixture instant: ${iso}`);
  return ms;
}

let nextId = 0;

interface FastFixture {
  startedAt?: number | null;
  plannedStartAt?: number | null;
  endedAt?: number | null;
  targetDurationMs?: number;
}

function makeFast({
  startedAt = null,
  plannedStartAt = null,
  endedAt = null,
  targetDurationMs = 16 * HOUR,
}: FastFixture): LocalFast {
  nextId += 1;
  return {
    id: `fast-${nextId}`,
    protocolId: 'custom',
    targetDurationMs,
    plannedStartAt,
    startedAt,
    endedAt,
    createdAt: startedAt ?? plannedStartAt ?? 0,
  };
}

function statsFor(fasts: readonly LocalFast[], nowIso: string) {
  return selectFastingStats({ fasts, nowMs: at(nowIso), timezone: BERLIN });
}

describe('an empty history', () => {
  it('is four zeros, not four blanks', () => {
    assert.deepEqual(statsFor([], '2026-09-12T09:00:00+02:00'), {
      completedCount: 0,
      longestMs: 0,
      currentStreakDays: 0,
      hoursLast7Days: 0,
    });
  });
});

describe('a 72 hour fast that ended this morning', () => {
  // 09 Sep 08:00 -> 12 Sep 08:00 Berlin. The local days it covers are
  // 09 Sep (16h), 10 Sep (24h), 11 Sep (24h) and 12 Sep (8h): four days, each
  // well over the one hour floor.
  const fast = makeFast({
    startedAt: at('2026-09-09T08:00:00+02:00'),
    endedAt: at('2026-09-12T08:00:00+02:00'),
    targetDurationMs: 72 * HOUR,
  });
  const stats = statsFor([fast], '2026-09-12T09:00:00+02:00');

  it('counts four streak days, the two whole ones and the two part days', () => {
    assert.equal(stats.currentStreakDays, 4);
  });

  it('counts as one completed fast and as the longest', () => {
    assert.equal(stats.completedCount, 1);
    assert.equal(stats.longestMs, 72 * HOUR);
  });

  it('puts all 72 hours in the week figure', () => {
    assert.equal(stats.hoursLast7Days, 72);
  });
});

describe('a 16:8 fast across midnight', () => {
  const fast = makeFast({
    startedAt: at('2026-09-10T20:00:00+02:00'),
    endedAt: at('2026-09-11T12:00:00+02:00'),
    targetDurationMs: 16 * HOUR,
  });
  const stats = statsFor([fast], '2026-09-11T13:00:00+02:00');

  it('counts both local days it covered', () => {
    assert.equal(stats.currentStreakDays, 2);
  });

  it('counts its sixteen hours once', () => {
    assert.equal(stats.hoursLast7Days, 16);
    assert.equal(stats.completedCount, 1);
    assert.equal(stats.longestMs, 16 * HOUR);
  });
});

describe('a gap day', () => {
  const stats = statsFor(
    [
      makeFast({
        startedAt: at('2026-09-09T08:00:00+02:00'),
        endedAt: at('2026-09-09T12:00:00+02:00'),
        targetDurationMs: 4 * HOUR,
      }),
      makeFast({
        startedAt: at('2026-09-11T08:00:00+02:00'),
        endedAt: at('2026-09-11T12:00:00+02:00'),
        targetDurationMs: 4 * HOUR,
      }),
    ],
    '2026-09-11T13:00:00+02:00',
  );

  it('ends the streak at one day, the earlier day is not reachable', () => {
    assert.equal(stats.currentStreakDays, 1);
  });

  it('still counts both fasts and both days of hours', () => {
    assert.equal(stats.completedCount, 2);
    assert.equal(stats.hoursLast7Days, 8);
  });
});

describe('a morning check with nothing fasted yet today', () => {
  const stats = statsFor(
    [
      makeFast({
        startedAt: at('2026-09-10T20:00:00+02:00'),
        endedAt: at('2026-09-11T12:00:00+02:00'),
      }),
    ],
    '2026-09-12T07:00:00+02:00',
  );

  it('reads the streak that is still standing, not zero', () => {
    assert.equal(stats.currentStreakDays, 2);
  });
});

describe('a fast that is still running', () => {
  const stats = statsFor(
    [makeFast({ startedAt: at('2026-09-12T06:00:00+02:00') })],
    '2026-09-12T09:00:00+02:00',
  );

  it('counts today, so the streak is alive before the fast ends', () => {
    assert.equal(stats.currentStreakDays, 1);
  });

  it('is not a completed fast but can already be the longest', () => {
    assert.equal(stats.completedCount, 0);
    assert.equal(stats.longestMs, 3 * HOUR);
  });

  it('contributes the hours it has actually run', () => {
    assert.equal(stats.hoursLast7Days, 3);
  });
});

describe('a 30 minute fast', () => {
  const stats = statsFor(
    [
      makeFast({
        startedAt: at('2026-09-12T06:00:00+02:00'),
        endedAt: at('2026-09-12T06:30:00+02:00'),
      }),
    ],
    '2026-09-12T09:00:00+02:00',
  );

  it('is no completed fast, no longest and no streak day', () => {
    assert.equal(stats.completedCount, 0);
    assert.equal(stats.longestMs, 0);
    assert.equal(stats.currentStreakDays, 0);
  });

  it('still contributes its real half hour to the week figure', () => {
    assert.equal(stats.hoursLast7Days, 0.5);
  });
});

describe('a fast scheduled for tonight', () => {
  const stats = statsFor(
    [makeFast({ plannedStartAt: at('2026-09-12T20:00:00+02:00') })],
    '2026-09-12T09:00:00+02:00',
  );

  it('counts nowhere, because it has not happened', () => {
    assert.deepEqual(stats, {
      completedCount: 0,
      longestMs: 0,
      currentStreakDays: 0,
      hoursLast7Days: 0,
    });
  });
});

describe('the rolling week window', () => {
  const now = '2026-09-12T09:00:00+02:00';

  it('counts a 16 hour fast that sits fully inside it', () => {
    const fast = makeFast({
      startedAt: at('2026-09-06T20:00:00+02:00'),
      endedAt: at('2026-09-07T12:00:00+02:00'),
    });
    assert.equal(statsFor([fast], now).hoursLast7Days, 16);
  });

  it('counts only the inside part of a fast that straddles the window start', () => {
    // 05 Sep 20:00 -> 06 Sep 12:00, and the window opens at 06 Sep 00:00, so
    // twelve of the sixteen hours are inside it.
    const fast = makeFast({
      startedAt: at('2026-09-05T20:00:00+02:00'),
      endedAt: at('2026-09-06T12:00:00+02:00'),
    });
    const stats = statsFor([fast], now);
    assert.equal(stats.hoursLast7Days, 12);
    assert.equal(stats.longestMs, 16 * HOUR, 'the fast itself is still 16 hours long');
  });

  it('drops a fast that ended before the window opened', () => {
    const fast = makeFast({
      startedAt: at('2026-09-04T20:00:00+02:00'),
      endedAt: at('2026-09-05T12:00:00+02:00'),
    });
    assert.equal(statsFor([fast], now).hoursLast7Days, 0);
  });

  it('rounds to one decimal', () => {
    const fast = makeFast({
      startedAt: at('2026-09-12T06:00:00+02:00'),
      endedAt: at('2026-09-12T07:37:00+02:00'),
      targetDurationMs: 2 * HOUR,
    });
    // 97 minutes is 1.6166… hours.
    assert.equal(statsFor([fast], now).hoursLast7Days, 1.6);
    assert.equal(statsFor([fast], now).longestMs, 97 * MINUTE);
  });
});
