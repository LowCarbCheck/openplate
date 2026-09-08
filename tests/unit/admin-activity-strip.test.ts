/**
 * The daily strip's arithmetic, which is the whole of the decision a square
 * makes about itself.
 *
 * The rule under test is the one the feature exists for: a day that happened
 * and was quiet is LEVEL 0 AND IS STILL A SQUARE. If zero ever became "draw
 * nothing", the strip would put a hole exactly where a person stopped using
 * the app, and an operator would read it as a day the server has no answer
 * for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activityLevel, activityTotal, orderByRecentActivity } from '../../app/lib/admin/activity-strip';
import type { AdminAccountView } from '../../app/lib/admin/admin-wire';

test('a quiet day is level zero, which is a square and not an absence', () => {
  assert.equal(activityLevel(0), 0);
  // The paint for level 0 is an outline; the component pins that. What is
  // pinned here is that zero is a level at all, with a level above it for one
  // single photo, so the two cannot collapse into each other.
  assert.equal(activityLevel(1), 1);
});

test('the buckets climb with the count and stop at the top one', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 9, 10, 400].map(activityLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('the buckets are absolute, so two people can be compared', () => {
  // A relative scale would paint a person whose busiest day was 2 exactly like
  // one whose busiest day was 200, and the strips would look comparable while
  // meaning nothing to each other.
  assert.equal(activityLevel(2), activityLevel(2));
  assert.notEqual(activityLevel(2), activityLevel(200));
});

test('a count below zero is treated as quiet rather than thrown on', () => {
  // It cannot arrive: the schema takes an integer and the service stores a
  // counter. This function decides how dark a square is, which is not worth an
  // operator's page.
  assert.equal(activityLevel(-1), 0);
});

test('the total is everything read in the window, and an all-zero window totals zero', () => {
  assert.equal(
    activityTotal([
      { day: '2026-09-05', count: 4 },
      { day: '2026-09-06', count: 0 },
      { day: '2026-09-07', count: 1 },
    ]),
    5,
  );
  assert.equal(activityTotal([{ day: '2026-09-07', count: 0 }]), 0);
  assert.equal(activityTotal([]), 0);
});

// ---------------------------------------------------------------------------
// The activity page's ordering
// ---------------------------------------------------------------------------

/**
 * "Is this study participant still using it" is a question about ORDER, not
 * about a square. The two rules worth pinning are that the most recently
 * active person is first, and that somebody who never arrived is last rather
 * than first, which is what a naive comparison over a nullable timestamp does.
 */
test('the activity page lists the most recently active first, and the never-arrived last', () => {
  const rows = orderByRecentActivity({
    people: [
      quietPerson({ id: 1, email: 'old@example.org', lastSeenAt: '2026-06-01T09:00:00.000Z' }),
      quietPerson({ id: 2, email: 'never@example.org', lastSeenAt: null }),
      quietPerson({ id: 3, email: 'recent@example.org', lastSeenAt: '2026-09-07T09:00:00.000Z' }),
    ],
    activity: null,
  });

  assert.deepEqual(
    rows.map((row) => row.account.id),
    [3, 1, 2],
  );
});

test('an unparseable last-seen instant sorts with the never-arrived rather than throwing', () => {
  const rows = orderByRecentActivity({
    people: [
      quietPerson({ id: 1, email: 'broken@example.org', lastSeenAt: 'not a date' }),
      quietPerson({ id: 2, email: 'fine@example.org', lastSeenAt: '2026-09-07T09:00:00.000Z' }),
    ],
    activity: null,
  });

  assert.deepEqual(
    rows.map((row) => row.account.id),
    [2, 1],
  );
});

test('a strip nobody sent is null on the row, and is not an empty one', () => {
  const people = [
    quietPerson({ id: 1, email: 'seen@example.org', lastSeenAt: '2026-09-07T09:00:00.000Z' }),
    quietPerson({ id: 2, email: 'unseen@example.org', lastSeenAt: '2026-09-06T09:00:00.000Z' }),
  ];
  const rows = orderByRecentActivity({
    people,
    activity: new Map([[1, [{ day: '2026-09-07', count: 2 }]]]),
  });

  assert.deepEqual(rows[0]?.days, [{ day: '2026-09-07', count: 2 }]);
  assert.equal(rows[1]?.days, null, 'an account the batch answer skipped gets no strip, never a quiet one');
});

test('a whole failed read leaves every row without a strip, and still lists everybody', () => {
  const rows = orderByRecentActivity({
    people: [quietPerson({ id: 1, email: 'a@example.org', lastSeenAt: null })],
    activity: null,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.days, null);
});

/** An account with only the fields the ordering reads. The rest are filled with values that say nothing. */
function quietPerson(overrides: { id: number; email: string; lastSeenAt: string | null }): AdminAccountView {
  return {
    displayName: null,
    role: 'member',
    dailyAiLimit: 200,
    aiUsedToday: 0,
    suspendedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}
