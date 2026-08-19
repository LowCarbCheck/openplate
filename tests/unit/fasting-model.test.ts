/**
 * Unit tests for `#app/models/fasting` — the pure model behind `/fasting` and
 * the Overview strip (M132).
 *
 * What this file pins, in one sentence each:
 *
 * - **A scheduled fast auto-activates by the passage of time, with ZERO
 *   writes.** That is the property that lets the whole feature exist with no
 *   background job and no notification, and it is invisible in any screenshot.
 * - **The model is TOTAL.** A stepped device clock, a restored backup with two
 *   open fasts, a row with neither start field, a zero target — each has a
 *   defined, renderable answer instead of a `NaN`, an `Infinity`, or a throw.
 * - **Elapsed truncates and never claims an unfinished minute**, and `progress`
 *   is returned UNCLAMPED so the caller can cap the arc while the figure keeps
 *   counting past the goal.
 * - **Nothing invents a bound**: `parseLocalDateTimeInput` refuses a partial
 *   date rather than parsing "2026" into a real instant eight months ago.
 */
process.env.TZ = 'UTC';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  customHoursToMs,
  defaultPlannedStartLocal,
  fastTargetLabel,
  formatFastClock,
  formatFastDuration,
  formatFastOvertime,
  isOpenFast,
  isValidCustomHours,
  parseLocalDateTimeInput,
  protocolTargetMs,
  resolveFastTimeline,
  selectCurrentFast,
  selectFastHistory,
  selectRecentlyEndedFast,
  toLocalDateTimeInputValue,
  validateStartInstant,
  type Translate,
} from '../../app/models/fasting';
import type { LocalFast } from '../../app/lib/local-store/schema';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
const T = Date.parse('2026-08-06T20:00:00Z');
const SIXTEEN = 16 * HOUR;

/**
 * A fake translator, so the duration assertions below check REAL strings
 * without booting an i18n instance — the same device `hero-stat.test.ts` uses.
 */
const t: Translate = (key, params = {}) =>
  key === 'fasting.duration.hoursMinutes' ? `${params.hours}h ${params.minutes}m`
  : key === 'fasting.duration.hoursOnly' ? `${params.hours}h`
  : key === 'fasting.duration.minutesOnly' ? `${params.minutes}m`
  : key;

/** A 16:8 fast that has neither started nor been planned; override per case. */
function fast(overrides: Partial<LocalFast> = {}): LocalFast {
  return {
    id: 'fast-1',
    protocolId: '16:8',
    targetDurationMs: SIXTEEN,
    plannedStartAt: null,
    startedAt: null,
    endedAt: null,
    createdAt: T,
    ...overrides,
  };
}

describe('resolveFastTimeline — running fasts', () => {
  it('reports a half-way fast as active, elapsed and remaining balanced', () => {
    const timeline = resolveFastTimeline(fast({ startedAt: T }), T + 8 * HOUR);

    assert.equal(timeline.status, 'active');
    assert.equal(timeline.elapsedMs, 8 * HOUR);
    assert.equal(timeline.remainingMs, 8 * HOUR);
    assert.equal(timeline.overtimeMs, 0);
    assert.equal(timeline.progress, 0.5);
    assert.equal(timeline.hasReachedTarget, false);
  });

  it('stays ACTIVE at exactly the target — reaching the goal is not ending the fast', () => {
    const timeline = resolveFastTimeline(fast({ startedAt: T }), T + 16 * HOUR);

    assert.equal(timeline.status, 'active');
    assert.equal(timeline.remainingMs, 0);
    assert.equal(timeline.overtimeMs, 0);
    assert.equal(timeline.progress, 1);
    assert.equal(timeline.hasReachedTarget, true);
  });

  it('keeps counting past the target and leaves progress UNCLAMPED', () => {
    // The caller clamps for the arc; the model must not, or the overtime figure
    // and the ring would disagree about what the timestamps say.
    const timeline = resolveFastTimeline(fast({ startedAt: T }), T + 18 * HOUR);

    assert.equal(timeline.status, 'active');
    assert.equal(timeline.overtimeMs, 2 * HOUR);
    assert.equal(timeline.remainingMs, 0);
    assert.equal(timeline.progress, 1.125);
  });

  it('counts from `startedAt` when both start fields are set', () => {
    const timeline = resolveFastTimeline(fast({ startedAt: T, plannedStartAt: T - 5 * HOUR }), T + HOUR);

    assert.equal(timeline.startAt, T);
    assert.equal(timeline.elapsedMs, HOUR);
  });
});

describe('resolveFastTimeline — scheduled fasts auto-activate', () => {
  const scheduled = fast({ plannedStartAt: T + 3 * HOUR });

  it('reports a future planned start as scheduled, with a countdown and no elapsed', () => {
    const timeline = resolveFastTimeline(scheduled, T);

    assert.equal(timeline.status, 'scheduled');
    assert.equal(timeline.startsInMs, 3 * HOUR);
    assert.equal(timeline.elapsedMs, 0);
    assert.equal(timeline.startAt, T + 3 * HOUR);
  });

  it('flips to active at the exact planned instant, with ZERO writes', () => {
    const before = JSON.stringify(scheduled);
    const timeline = resolveFastTimeline(scheduled, T + 3 * HOUR);

    assert.equal(timeline.status, 'active');
    assert.equal(
      JSON.stringify(scheduled),
      before,
      'auto-activation must not mutate the row — nothing writes anything to make it true',
    );
  });

  it('counts an auto-activated fast from the planned start, not from `createdAt`', () => {
    const timeline = resolveFastTimeline(scheduled, T + 5 * HOUR);

    assert.equal(timeline.elapsedMs, 2 * HOUR);
    assert.equal(timeline.remainingMs, 14 * HOUR);
    assert.equal(timeline.progress, 0.125);
  });
});

describe('resolveFastTimeline — ended fasts', () => {
  it('reports a fast ended at its target as completed, independently of the clock', () => {
    const ended = fast({ startedAt: T, endedAt: T + 16 * HOUR });
    const soon = resolveFastTimeline(ended, T + 17 * HOUR);
    const muchLater = resolveFastTimeline(ended, T + 400 * HOUR);

    assert.equal(soon.status, 'completed');
    assert.equal(soon.elapsedMs, 16 * HOUR);
    assert.equal(soon.endAt, T + 16 * HOUR);
    assert.deepEqual(muchLater, soon, 'an ended fast is a fact, not a function of now');
  });

  it('reports a fast ended before its target as ended-early, keeping both figures', () => {
    const timeline = resolveFastTimeline(fast({ startedAt: T, endedAt: T + 9 * HOUR }), T + 20 * HOUR);

    assert.equal(timeline.status, 'ended-early');
    assert.equal(timeline.elapsedMs, 9 * HOUR);
    assert.equal(timeline.remainingMs, 7 * HOUR);
  });

  it('reports a plan ended at its own planned instant as cancelled', () => {
    const timeline = resolveFastTimeline(fast({ plannedStartAt: T + 3 * HOUR, endedAt: T + 3 * HOUR }), T + 4 * HOUR);

    assert.equal(timeline.status, 'cancelled');
    assert.equal(timeline.elapsedMs, 0);
  });

  it('reports an end BEFORE the start as cancelled too — the `<=` absorbs both', () => {
    const timeline = resolveFastTimeline(fast({ plannedStartAt: T + 3 * HOUR, endedAt: T + HOUR }), T + 4 * HOUR);

    assert.equal(timeline.status, 'cancelled');
  });
});

describe('resolveFastTimeline — totality on rows the app cannot produce', () => {
  it('floors everything at zero when the device clock steps backwards', () => {
    const timeline = resolveFastTimeline(fast({ startedAt: T }), T - 2 * HOUR);

    assert.equal(timeline.status, 'active');
    assert.equal(timeline.elapsedMs, 0);
    assert.equal(timeline.progress, 0);
    assert.equal(timeline.overtimeMs, 0);
    assert.ok(timeline.remainingMs >= 0);
  });

  it('treats a row with neither start field as active from `createdAt`, rather than throwing', () => {
    const timeline = resolveFastTimeline(fast({ createdAt: T }), T + HOUR);

    assert.equal(timeline.status, 'active');
    assert.equal(timeline.startAt, T);
    assert.equal(timeline.elapsedMs, HOUR);
  });

  it('returns progress 0 for a zero target — never Infinity, never NaN', () => {
    const timeline = resolveFastTimeline(fast({ startedAt: T, targetDurationMs: 0 }), T + HOUR);

    assert.equal(timeline.progress, 0);
    assert.ok(Number.isFinite(timeline.progress));
    assert.equal(timeline.remainingMs, 0);
    assert.equal(timeline.overtimeMs, HOUR);
  });
});

describe('formatFastDuration', () => {
  it('renders hours and minutes together', () => {
    assert.equal(formatFastDuration(16 * HOUR + 4 * MINUTE, t), '16h 4m');
  });

  it('drops zero minutes — a preset target reads "16h", never "16h 0m"', () => {
    assert.equal(formatFastDuration(16 * HOUR, t), '16h');
  });

  it('renders a sub-hour duration in minutes only', () => {
    assert.equal(formatFastDuration(42 * MINUTE, t), '42m');
  });

  it('renders a just-started fast as "0m", not "0h 0m"', () => {
    assert.equal(formatFastDuration(30_000, t), '0m');
  });

  it('floors a negative duration at zero', () => {
    assert.equal(formatFastDuration(-5_000, t), '0m');
  });

  it('truncates rather than rounds — it never claims a minute that has not finished', () => {
    assert.equal(formatFastDuration(16 * HOUR + 59_999, t), '16h');
  });
});

describe('formatFastClock', () => {
  it('renders H:MM:SS with the hours unpadded', () => {
    assert.equal(formatFastClock(16 * HOUR + 4 * MINUTE + 12_000), '16:04:12');
  });

  it('renders zero as 0:00:00', () => {
    assert.equal(formatFastClock(0), '0:00:00');
  });

  it('never wraps the hours at 24 or truncates them to two digits', () => {
    assert.equal(formatFastClock(100 * HOUR), '100:00:00');
  });
});

describe('formatFastOvertime', () => {
  it('signs the duration and stays at minute resolution', () => {
    assert.equal(formatFastOvertime(2 * HOUR + 14 * MINUTE, t), '+2h 14m');
  });
});

describe('fastTargetLabel', () => {
  it('uses the protocol id for a preset', () => {
    assert.equal(fastTargetLabel(fast({ protocolId: '16:8' }), t), '16:8');
  });

  it('uses the formatted duration for a custom target — never an invented protocol name', () => {
    assert.equal(fastTargetLabel(fast({ protocolId: 'custom', targetDurationMs: 9 * HOUR }), t), '9h');
  });
});

describe('custom hours and protocol targets', () => {
  it('accepts only whole hours inside the bounds', () => {
    assert.equal(isValidCustomHours(1), true);
    assert.equal(isValidCustomHours(72), true);
    assert.equal(isValidCustomHours(0), false);
    assert.equal(isValidCustomHours(73), false);
    assert.equal(isValidCustomHours(12.5), false);
    assert.equal(isValidCustomHours(Number.NaN), false);
  });

  it('converts hours to milliseconds', () => {
    assert.equal(customHoursToMs(24), 24 * HOUR);
  });

  it('resolves a preset to its window and returns null for custom', () => {
    assert.equal(protocolTargetMs('18:6'), 18 * HOUR);
    assert.equal(protocolTargetMs('20:4'), 20 * HOUR);
    assert.equal(protocolTargetMs('custom'), null);
  });
});

describe('parseLocalDateTimeInput', () => {
  it('parses a full datetime-local value', () => {
    assert.equal(parseLocalDateTimeInput('2026-08-06T20:00'), Date.parse('2026-08-06T20:00'));
  });

  it('refuses a partial or malformed value — the regex guard is the whole point', () => {
    // Without it `Date.parse('2026')` returns a real UTC-midnight instant, and
    // the fast would be silently scheduled eight months ago.
    assert.equal(parseLocalDateTimeInput('2026'), null);
    assert.equal(parseLocalDateTimeInput('2026-08-06'), null);
    assert.equal(parseLocalDateTimeInput(''), null);
    assert.equal(parseLocalDateTimeInput('nonsense'), null);
  });

  it('round-trips through `toLocalDateTimeInputValue`', () => {
    const at = Date.parse('2026-08-06T20:04');
    assert.equal(toLocalDateTimeInputValue(at), '2026-08-06T20:04');
    assert.equal(parseLocalDateTimeInput(toLocalDateTimeInputValue(at)), at);
  });
});

describe('validateStartInstant', () => {
  it('accepts the exact backdating and scheduling bounds, and refuses one ms past either', () => {
    const options = { nowMs: T, allowFuture: true };

    assert.equal(validateStartInstant(T - 48 * HOUR, options), null);
    assert.equal(validateStartInstant(T - 48 * HOUR - 1, options), 'too-far-back');
    assert.equal(validateStartInstant(T + 7 * DAY, options), null);
    assert.equal(validateStartInstant(T + 7 * DAY + 1, options), 'too-far-ahead');
  });

  it('refuses a future start when adjusting a running fast', () => {
    const options = { nowMs: T, allowFuture: false };

    assert.equal(validateStartInstant(T + 1, options), 'in-future');
    assert.equal(validateStartInstant(T, options), null);
  });
});

describe('defaultPlannedStartLocal', () => {
  it('offers tonight at 20:00 when the evening is still ahead', () => {
    assert.equal(defaultPlannedStartLocal(Date.parse('2026-08-06T14:00')), '2026-08-06T20:00');
  });

  it('rolls to tomorrow once the evening has passed', () => {
    assert.equal(defaultPlannedStartLocal(Date.parse('2026-08-06T21:30')), '2026-08-07T20:00');
  });

  it('treats exactly 20:00 as already passed', () => {
    assert.equal(defaultPlannedStartLocal(Date.parse('2026-08-06T20:00')), '2026-08-07T20:00');
  });
});

describe('selection', () => {
  const openNow = fast({ id: 'open-now', startedAt: T });
  const openEarlier = fast({ id: 'open-earlier', startedAt: T - 5 * HOUR, createdAt: T - 5 * HOUR });
  const done = fast({ id: 'done', startedAt: T - 30 * HOUR, endedAt: T - 14 * HOUR, createdAt: T - 30 * HOUR });

  it('knows an open fast from an ended one', () => {
    assert.equal(isOpenFast(openNow), true);
    assert.equal(isOpenFast(done), false);
  });

  it('returns null on an empty list, and the only open fast otherwise', () => {
    assert.equal(selectCurrentFast([]), null);
    assert.equal(selectCurrentFast([done, openNow])?.id, 'open-now');
    assert.equal(selectCurrentFast([done]), null, 'an ended fast is never current');
  });

  it('picks the LATEST effective start when a restore has left two open fasts', () => {
    // Rather than inventing an end instant for the loser, which would write a
    // duration into the person's history that they never declared.
    assert.equal(selectCurrentFast([openEarlier, openNow])?.id, 'open-now');
    assert.equal(selectCurrentFast([openNow, openEarlier])?.id, 'open-now');
  });

  it('lists history newest-first, excluding the current fast but INCLUDING a restore orphan', () => {
    const history = selectFastHistory([done, openEarlier, openNow]);

    assert.deepEqual(
      history.map((entry) => entry.id),
      ['open-earlier', 'done'],
      'the second open fast must stay visible, so the person can remove it',
    );
  });

  it('surfaces a just-ended fast for the summary window, then stops', () => {
    const justEnded = fast({ id: 'just-ended', startedAt: T - 16 * HOUR, endedAt: T - MINUTE });

    assert.equal(selectRecentlyEndedFast([justEnded], T)?.id, 'just-ended');
    assert.equal(selectRecentlyEndedFast([justEnded], T + 11 * MINUTE), null);
  });

  it('never surfaces a cancelled plan — there is nothing to report about a fast that never ran', () => {
    const cancelled = fast({ id: 'cancelled', plannedStartAt: T + 3 * HOUR, endedAt: T + 3 * HOUR });

    assert.equal(selectRecentlyEndedFast([cancelled], T + 3 * HOUR + MINUTE), null);
  });
});
