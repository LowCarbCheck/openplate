/**
 * How long ago something was, in the words the admin lists use.
 *
 * The clock is fixed (`NOW`) and every boundary is read from both sides: 23.9
 * hours is "today" and 24 hours is "yesterday". A test that only checked the
 * middle of each range would pass on an off-by-one in every edge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ageInDays, bandOf, describeDayAge, formatShortDate, MS_PER_DAY } from '../../app/lib/admin/people-age';

const NOW = new Date('2026-10-11T12:00:00.000Z');

function ago(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

test('an age is fractional days, a future instant is zero and one that does not parse is infinitely old', () => {
  assert.equal(ageInDays({ iso: ago(2.5), now: NOW }), 2.5);
  assert.equal(ageInDays({ iso: ago(-3), now: NOW }), 0, 'a clock that runs ahead of the server is "now"');
  assert.equal(ageInDays({ iso: 'garbage', now: NOW }), Number.POSITIVE_INFINITY);
  // CONTROL: an ordinary instant is not zero or infinite.
  assert.notEqual(ageInDays({ iso: ago(1), now: NOW }), 0);
});

test('the day phrase changes exactly at 24 hours, 48 hours and the horizon', () => {
  const describe = (days: number, relativeUntilDays = 7) =>
    describeDayAge({ iso: ago(days), now: NOW, relativeUntilDays });

  assert.deepEqual(describe(0), { kind: 'today' });
  assert.deepEqual(describe(0.99), { kind: 'today' });
  assert.deepEqual(describe(1), { kind: 'yesterday' });
  assert.deepEqual(describe(1.99), { kind: 'yesterday' });
  assert.deepEqual(describe(2), { kind: 'days-ago', days: 2 });
  assert.deepEqual(describe(6.99), { kind: 'days-ago', days: 6 });
  assert.deepEqual(describe(7), { kind: 'date', iso: ago(7) });
  // The horizon is the caller's: a last sign-in stays relative for two weeks.
  assert.deepEqual(describe(13.99, 14), { kind: 'days-ago', days: 13 });
  assert.deepEqual(describe(14, 14), { kind: 'date', iso: ago(14) });
});

test('a sign-up falls in this week below seven days, this month below thirty, and earlier after that', () => {
  const band = (days: number) => bandOf({ createdAt: ago(days), now: NOW });
  assert.equal(band(0), 'week');
  assert.equal(band(6.99), 'week');
  assert.equal(band(7), 'month');
  assert.equal(band(29.99), 'month');
  assert.equal(band(30), 'earlier');
  assert.equal(bandOf({ createdAt: 'garbage', now: NOW }), 'earlier');
});

test('a short date carries no year this year and the year in any other', () => {
  const sameYear = formatShortDate({ iso: '2026-03-03T12:00:00.000Z', now: NOW, language: 'en' });
  const otherYear = formatShortDate({ iso: '2025-03-03T12:00:00.000Z', now: NOW, language: 'en' });
  assert.match(sameYear, /3 Mar/);
  assert.doesNotMatch(sameYear, /2026/);
  assert.match(otherYear, /2025/);
});

test("a short date is in the reader's language, and an unreadable one is printed as it came", () => {
  const german = formatShortDate({ iso: '2026-03-03T12:00:00.000Z', now: NOW, language: 'de' });
  const english = formatShortDate({ iso: '2026-03-03T12:00:00.000Z', now: NOW, language: 'en' });
  assert.notEqual(german, english);
  assert.match(german, /^3\. Mär/);
  assert.equal(formatShortDate({ iso: 'garbage', now: NOW, language: 'en' }), 'garbage');
});
