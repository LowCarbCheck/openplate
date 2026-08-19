/**
 * Unit tests for `#app/lib/meal-time` — the pure time-of-day → default meal
 * mapping behind the quick-add portion step. No DB/React. Every window boundary
 * is pinned (a one-minute slip either way changes the meal), plus the Date+zone
 * form and malformed-input rejection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mealTypeForMinutes, mealTypeForTime } from '../../app/lib/meal-time';

describe('mealTypeForTime (HH:mm boundaries)', () => {
  const cases: [string, string][] = [
    ['03:59', 'snack'],
    ['04:00', 'breakfast'],
    ['08:00', 'breakfast'],
    ['10:59', 'breakfast'],
    ['11:00', 'lunch'],
    ['12:30', 'lunch'],
    ['14:59', 'lunch'],
    ['15:00', 'snack'],
    ['16:59', 'snack'],
    ['17:00', 'dinner'],
    ['19:30', 'dinner'],
    ['21:59', 'dinner'],
    ['22:00', 'snack'],
    ['00:00', 'snack'],
    ['23:59', 'snack'],
  ];

  for (const [time, expected] of cases) {
    it(`maps ${time} → ${expected}`, () => {
      assert.strictEqual(mealTypeForTime(time), expected);
    });
  }
});

describe('mealTypeForMinutes', () => {
  it('classifies the same boundaries by minutes since midnight', () => {
    assert.strictEqual(mealTypeForMinutes(4 * 60), 'breakfast');
    assert.strictEqual(mealTypeForMinutes(11 * 60 - 1), 'breakfast');
    assert.strictEqual(mealTypeForMinutes(11 * 60), 'lunch');
    assert.strictEqual(mealTypeForMinutes(15 * 60 - 1), 'lunch');
    assert.strictEqual(mealTypeForMinutes(15 * 60), 'snack');
    assert.strictEqual(mealTypeForMinutes(17 * 60), 'dinner');
    assert.strictEqual(mealTypeForMinutes(22 * 60 - 1), 'dinner');
    assert.strictEqual(mealTypeForMinutes(22 * 60), 'snack');
  });
});

describe('mealTypeForTime (Date + IANA zone)', () => {
  const noonUtc = new Date('2026-07-13T12:30:00Z');

  it('reads the wall clock in the given zone', () => {
    // 12:30 UTC → lunch in UTC, breakfast in New York (UTC-4 in July), dinner in Tokyo (UTC+9).
    assert.strictEqual(mealTypeForTime({ at: noonUtc, timezone: 'UTC' }), 'lunch');
    assert.strictEqual(mealTypeForTime({ at: noonUtc, timezone: 'America/New_York' }), 'breakfast');
    assert.strictEqual(mealTypeForTime({ at: noonUtc, timezone: 'Asia/Tokyo' }), 'dinner');
  });

  it('crosses local midnight into the snack window', () => {
    // 02:00 UTC is 22:00 the previous day in New York → snack.
    assert.strictEqual(
      mealTypeForTime({ at: new Date('2026-07-13T02:00:00Z'), timezone: 'America/New_York' }),
      'snack',
    );
  });
});

describe('mealTypeForTime (invalid input)', () => {
  it('throws on a malformed HH:mm string', () => {
    assert.throws(() => mealTypeForTime('abc'), /Invalid HH:mm time/);
    assert.throws(() => mealTypeForTime('1230'), /Invalid HH:mm time/);
  });

  it('throws on an out-of-range HH:mm string', () => {
    assert.throws(() => mealTypeForTime('25:00'), /Invalid HH:mm time/);
    assert.throws(() => mealTypeForTime('12:60'), /Invalid HH:mm time/);
  });
});
