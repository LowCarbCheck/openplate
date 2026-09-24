/**
 * Unit tests for `#app/lib/user-days` — Intl-based IANA calendar-day math.
 * No DB import; pure functions, so these run without a database. DST-transition
 * days (Europe/Berlin 2026-03-29 spring-forward, 2026-10-25 fall-back) are
 * covered explicitly to prove day spans are 23h/25h, not a fixed 24h.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidTimeZone,
  todayInTimezone,
  dayBoundsInTimezone,
  instantOnDate,
  instantAtWallClock,
  parseDateParam,
  shiftDate,
  enumerateDates,
} from '../../app/lib/user-days';

const HOUR_MS = 60 * 60 * 1000;

describe('isValidTimeZone', () => {
  it('accepts real IANA names', () => {
    assert.strictEqual(isValidTimeZone('UTC'), true);
    assert.strictEqual(isValidTimeZone('Europe/Berlin'), true);
    assert.strictEqual(isValidTimeZone('America/Los_Angeles'), true);
    assert.strictEqual(isValidTimeZone('Pacific/Auckland'), true);
  });

  it('rejects garbage and empty input', () => {
    assert.strictEqual(isValidTimeZone('Not/AZone'), false);
    assert.strictEqual(isValidTimeZone('Mars/Olympus'), false);
    assert.strictEqual(isValidTimeZone(''), false);
  });
});

describe('todayInTimezone', () => {
  it('resolves the local date in UTC', () => {
    assert.strictEqual(todayInTimezone('UTC', new Date('2026-07-13T12:00:00Z')), '2026-07-13');
  });

  it('rolls a late-evening UTC instant forward in Pacific/Auckland (UTC+12 in July)', () => {
    // 22:30Z is already 10:30 the next morning in Auckland.
    assert.strictEqual(todayInTimezone('Pacific/Auckland', new Date('2026-07-13T22:30:00Z')), '2026-07-14');
  });

  it('holds an early-morning UTC instant on the previous day in America/Los_Angeles (UTC-7 in July)', () => {
    // 01:00Z is 18:00 the previous evening in Los Angeles.
    assert.strictEqual(todayInTimezone('America/Los_Angeles', new Date('2026-07-13T01:00:00Z')), '2026-07-12');
  });

  it('applies the CEST offset for Europe/Berlin', () => {
    assert.strictEqual(todayInTimezone('Europe/Berlin', new Date('2026-07-12T23:30:00Z')), '2026-07-13');
  });

  it('throws on an invalid time zone', () => {
    assert.throws(() => todayInTimezone('Not/AZone', new Date('2026-07-13T12:00:00Z')));
  });
});

describe('dayBoundsInTimezone', () => {
  it('bounds a UTC day as an exact 24h window at midnight', () => {
    const { start, end } = dayBoundsInTimezone('2026-07-13', 'UTC');
    assert.strictEqual(start.toISOString(), '2026-07-13T00:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-07-14T00:00:00.000Z');
    assert.strictEqual((end.getTime() - start.getTime()) / HOUR_MS, 24);
  });

  it('bounds a Europe/Berlin summer day at UTC+2 (CEST)', () => {
    const { start, end } = dayBoundsInTimezone('2026-07-13', 'Europe/Berlin');
    assert.strictEqual(start.toISOString(), '2026-07-12T22:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-07-13T22:00:00.000Z');
    assert.strictEqual((end.getTime() - start.getTime()) / HOUR_MS, 24);
  });

  it('bounds a Europe/Berlin winter day at UTC+1 (CET)', () => {
    const { start, end } = dayBoundsInTimezone('2026-01-15', 'Europe/Berlin');
    assert.strictEqual(start.toISOString(), '2026-01-14T23:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-01-15T23:00:00.000Z');
  });

  it('makes the Europe/Berlin spring-forward day 23h long (2026-03-29)', () => {
    const { start, end } = dayBoundsInTimezone('2026-03-29', 'Europe/Berlin');
    assert.strictEqual(start.toISOString(), '2026-03-28T23:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-03-29T22:00:00.000Z');
    assert.strictEqual((end.getTime() - start.getTime()) / HOUR_MS, 23);
  });

  it('makes the Europe/Berlin fall-back day 25h long (2026-10-25)', () => {
    const { start, end } = dayBoundsInTimezone('2026-10-25', 'Europe/Berlin');
    assert.strictEqual(start.toISOString(), '2026-10-24T22:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-10-25T23:00:00.000Z');
    assert.strictEqual((end.getTime() - start.getTime()) / HOUR_MS, 25);
  });

  it('bounds an America/Los_Angeles summer day at UTC-7 (PDT)', () => {
    const { start, end } = dayBoundsInTimezone('2026-07-13', 'America/Los_Angeles');
    assert.strictEqual(start.toISOString(), '2026-07-13T07:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-07-14T07:00:00.000Z');
  });

  it('bounds a Pacific/Auckland winter day at UTC+12 (NZST)', () => {
    const { start, end } = dayBoundsInTimezone('2026-07-13', 'Pacific/Auckland');
    assert.strictEqual(start.toISOString(), '2026-07-12T12:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-07-13T12:00:00.000Z');
  });

  it('throws on an invalid date', () => {
    assert.throws(() => dayBoundsInTimezone('2026-02-30', 'UTC'));
    assert.throws(() => dayBoundsInTimezone('not-a-date', 'UTC'));
  });
});

describe('instantOnDate', () => {
  it('returns the reference instant unchanged when the date is already today', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    assert.strictEqual(instantOnDate('2026-07-13', 'UTC', now).getTime(), now.getTime());
  });

  it('preserves the wall-clock time-of-day onto a past UTC day', () => {
    // 14:30 into the current UTC day → 14:30 on the target UTC day.
    const now = new Date('2026-07-13T14:30:00Z');
    assert.strictEqual(instantOnDate('2026-07-10', 'UTC', now).toISOString(), '2026-07-10T14:30:00.000Z');
  });

  it('preserves the local wall-clock offset across a zoned day (Europe/Berlin, CEST)', () => {
    // now is 14:00 in Berlin (UTC+2 in July); the target keeps 14:00 local → 12:00Z.
    const now = new Date('2026-07-13T12:00:00Z');
    assert.strictEqual(instantOnDate('2026-07-06', 'Europe/Berlin', now).toISOString(), '2026-07-06T12:00:00.000Z');
  });

  it('clamps to one ms before the target day end on a short DST day (Berlin spring-forward, 23h)', () => {
    // 23:30 local (23.5h offset) overflows the 23h 2026-03-29 day → clamp to its last ms.
    const now = new Date('2026-01-15T22:30:00Z');
    assert.strictEqual(instantOnDate('2026-03-29', 'Europe/Berlin', now).toISOString(), '2026-03-29T21:59:59.999Z');
  });

  it('throws on an invalid target date', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    assert.throws(() => instantOnDate('2026-13-40', 'UTC', now));
    assert.throws(() => instantOnDate('not-a-date', 'UTC', now));
  });

  it('throws on an invalid time zone', () => {
    assert.throws(() => instantOnDate('2026-07-10', 'Not/AZone', new Date('2026-07-13T12:00:00Z')));
  });
});

describe('parseDateParam', () => {
  it('returns the value unchanged for a real calendar date', () => {
    assert.strictEqual(parseDateParam('2026-07-12'), '2026-07-12');
    assert.strictEqual(parseDateParam('2026-02-28'), '2026-02-28');
  });

  it('returns null for impossible, malformed, unpadded, empty, or null input', () => {
    assert.strictEqual(parseDateParam('2026-13-40'), null);
    assert.strictEqual(parseDateParam('2026-02-30'), null);
    assert.strictEqual(parseDateParam('abc'), null);
    assert.strictEqual(parseDateParam('2026-1-2'), null);
    assert.strictEqual(parseDateParam(''), null);
    assert.strictEqual(parseDateParam(null), null);
  });
});

describe('shiftDate', () => {
  it('adds and subtracts days across month and year boundaries', () => {
    assert.strictEqual(shiftDate('2026-07-13', 1), '2026-07-14');
    assert.strictEqual(shiftDate('2026-03-01', -1), '2026-02-28');
    assert.strictEqual(shiftDate('2026-12-31', 1), '2027-01-01');
    assert.strictEqual(shiftDate('2026-07-13', 0), '2026-07-13');
  });

  it('throws on an invalid date', () => {
    assert.throws(() => shiftDate('2026-13-01', 1));
  });
});

describe('enumerateDates', () => {
  it('lists inclusive dates oldest first', () => {
    assert.deepStrictEqual(enumerateDates('2026-07-11', '2026-07-13'), ['2026-07-11', '2026-07-12', '2026-07-13']);
  });

  it('returns a single day for an equal range', () => {
    assert.deepStrictEqual(enumerateDates('2026-07-13', '2026-07-13'), ['2026-07-13']);
  });

  it('crosses a month boundary', () => {
    assert.deepStrictEqual(enumerateDates('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('returns an empty list when from is after to', () => {
    assert.deepStrictEqual(enumerateDates('2026-07-13', '2026-07-11'), []);
  });
});

/** Epoch ms of a Berlin wall-clock reading. */
function berlinInstant(date: string, hour: number, minute: number): number {
  return instantAtWallClock({ date, time: { hour, minute, second: 0 }, timeZone: 'Europe/Berlin' }).getTime();
}

describe('instantAtWallClock', () => {
  it('reads a winter reading at UTC+1 and a summer reading at UTC+2', () => {
    // 08:15 CET is 07:15Z; 08:15 CEST is 06:15Z. The control is the pair: one offset for both would fail one of them.
    assert.strictEqual(berlinInstant('2026-01-15', 8, 15), Date.UTC(2026, 0, 15, 7, 15));
    assert.strictEqual(berlinInstant('2026-07-15', 8, 15), Date.UTC(2026, 6, 15, 6, 15));
  });

  it('uses the offset at the reading, not at midnight, on a spring-forward day', () => {
    // 2026-03-29 local midnight is still CET, so midnight plus 8h15m would read 07:15Z (09:15 CEST).
    const midnightPlusElapsed =
      dayBoundsInTimezone('2026-03-29', 'Europe/Berlin').start.getTime() + 8 * HOUR_MS + 15 * 60 * 1000;
    assert.strictEqual(berlinInstant('2026-03-29', 8, 15), Date.UTC(2026, 2, 29, 6, 15));
    assert.notStrictEqual(berlinInstant('2026-03-29', 8, 15), midnightPlusElapsed);
  });

  it('moves a reading inside the spring-forward gap forward by the gap', () => {
    // 02:30 does not exist on 2026-03-29 in Berlin; it lands on 03:30 CEST, 01:30Z.
    assert.strictEqual(berlinInstant('2026-03-29', 2, 30), Date.UTC(2026, 2, 29, 1, 30));
  });

  it('takes the second occurrence of a fall-back hour', () => {
    // 02:30 happens twice on 2026-10-25: 00:30Z (CEST) and 01:30Z (CET).
    assert.strictEqual(berlinInstant('2026-10-25', 2, 30), Date.UTC(2026, 9, 25, 1, 30));
  });

  it('throws on an impossible time, date or zone', () => {
    assert.throws(() =>
      instantAtWallClock({ date: '2026-01-15', time: { hour: 24, minute: 0, second: 0 }, timeZone: 'UTC' }),
    );
    assert.throws(() =>
      instantAtWallClock({ date: '2026-02-30', time: { hour: 8, minute: 0, second: 0 }, timeZone: 'UTC' }),
    );
    assert.throws(() =>
      instantAtWallClock({ date: '2026-01-15', time: { hour: 8, minute: 0, second: 0 }, timeZone: 'Mars/Base' }),
    );
    // Control: the same call with valid parts does not throw.
    assert.strictEqual(
      instantAtWallClock({ date: '2026-01-15', time: { hour: 8, minute: 0, second: 0 }, timeZone: 'UTC' }).getTime(),
      Date.UTC(2026, 0, 15, 8, 0),
    );
  });
});
