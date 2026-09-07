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

import { activityLevel, activityTotal } from '../../app/lib/admin/activity-strip';

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
