/**
 * Unit tests for `#app/lib/day-key-date` — the diary date-picker's
 * dayKey<->Date conversion. The load-bearing property under test is that
 * round-tripping through a `Date` never shifts the day, which is exactly
 * what a `toISOString()`-based implementation would get wrong outside UTC.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { dayKeyToLocalDate, localDateToDayKey } from '../../app/lib/day-key-date';

describe('dayKeyToLocalDate', () => {
  it('parses a day key into a Date at local midnight on that day', () => {
    const date = dayKeyToLocalDate('2026-07-31');
    assert.strictEqual(date.getFullYear(), 2026);
    assert.strictEqual(date.getMonth(), 6);
    assert.strictEqual(date.getDate(), 31);
    assert.strictEqual(date.getHours(), 0);
    assert.strictEqual(date.getMinutes(), 0);
  });

  it('throws on a malformed day key', () => {
    assert.throws(() => dayKeyToLocalDate('31-07-2026'));
    assert.throws(() => dayKeyToLocalDate('not-a-date'));
  });

  it('throws on an impossible calendar date', () => {
    assert.throws(() => dayKeyToLocalDate('2026-02-30'));
    assert.throws(() => dayKeyToLocalDate('2026-13-01'));
  });
});

describe('localDateToDayKey', () => {
  it('formats a Date back to YYYY-MM-DD using its local fields', () => {
    assert.strictEqual(localDateToDayKey(new Date(2026, 6, 31)), '2026-07-31');
  });

  it('pads single-digit months and days', () => {
    assert.strictEqual(localDateToDayKey(new Date(2026, 0, 5)), '2026-01-05');
  });
});

describe('round-trip', () => {
  it('never shifts the day, regardless of month boundaries', () => {
    const dayKeys = ['2026-01-01', '2026-02-28', '2026-07-31', '2026-12-31', '2028-02-29'];
    for (const dayKey of dayKeys) {
      assert.strictEqual(localDateToDayKey(dayKeyToLocalDate(dayKey)), dayKey);
    }
  });
});
