/**
 * The days an AI limit counts over, and when it resets (2026-10-07). The week
 * is an ISO week in UTC: Monday 00:00 UTC to the next Monday 00:00 UTC. Every
 * week case has a day control, because a helper that answered "today" for
 * both would pass any test that looked at one instant only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotaWindowOf } from '../../src/ai/quota-window.js';
import { nextUtcMonday, utcWeekStartDayKey } from '../../src/lib/utc-day.js';

/** A window with its reset written as the ISO string a client reads. */
interface WindowAsWire {
  fromDay: string;
  day: string;
  resetsAt: string;
}

function windowAt(input: { period: 'day' | 'week'; iso: string }): WindowAsWire {
  const window = quotaWindowOf({ period: input.period, now: new Date(input.iso) });
  return { fromDay: window.fromDay, day: window.day, resetsAt: window.resetsAt.toISOString() };
}

test('a week window mid-week counts from Monday and resets the next Monday at 00:00 UTC', () => {
  assert.deepEqual(windowAt({ period: 'week', iso: '2026-10-07T12:00:00.000Z' }), {
    fromDay: '2026-10-05',
    day: '2026-10-07',
    resetsAt: '2026-10-12T00:00:00.000Z',
  });
  // THE CONTROL: the day window at the same instant is today alone.
  assert.deepEqual(windowAt({ period: 'day', iso: '2026-10-07T12:00:00.000Z' }), {
    fromDay: '2026-10-07',
    day: '2026-10-07',
    resetsAt: '2026-10-08T00:00:00.000Z',
  });
});

test('Monday at 00:00:00.000 UTC is the first instant of a new week', () => {
  assert.deepEqual(windowAt({ period: 'week', iso: '2026-10-12T00:00:00.000Z' }), {
    fromDay: '2026-10-12',
    day: '2026-10-12',
    resetsAt: '2026-10-19T00:00:00.000Z',
  });
  // THE CONTROL: one millisecond earlier is still the old week, with one millisecond left.
  assert.deepEqual(windowAt({ period: 'week', iso: '2026-10-11T23:59:59.999Z' }), {
    fromDay: '2026-10-05',
    day: '2026-10-11',
    resetsAt: '2026-10-12T00:00:00.000Z',
  });
});

test('a week across a year boundary starts on the Monday of the old year', () => {
  // 2027-01-01 is a Friday.
  assert.deepEqual(windowAt({ period: 'week', iso: '2027-01-01T08:00:00.000Z' }), {
    fromDay: '2026-12-28',
    day: '2027-01-01',
    resetsAt: '2027-01-04T00:00:00.000Z',
  });
});

test('every day of one week names the same Monday and the same reset', () => {
  const days = ['05', '06', '07', '08', '09', '10', '11'].map((day) => new Date(`2026-10-${day}T18:30:00.000Z`));
  assert.deepEqual(new Set(days.map((day) => utcWeekStartDayKey(day))), new Set(['2026-10-05']));
  assert.deepEqual(new Set(days.map((day) => nextUtcMonday(day).toISOString())), new Set(['2026-10-12T00:00:00.000Z']));
  // THE CONTROL: the next Monday names itself.
  assert.equal(utcWeekStartDayKey(new Date('2026-10-12T18:30:00.000Z')), '2026-10-12');
});
