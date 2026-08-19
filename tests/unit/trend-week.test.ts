/**
 * Unit tests for `#app/lib/trend-week` — Monday-anchored week math. Pure string
 * date arithmetic, no DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startOfWeek } from '../../app/lib/trend-week';

describe('startOfWeek', () => {
  it('returns the same date when it is already a Monday', () => {
    // 2026-07-13 is a Monday.
    assert.strictEqual(startOfWeek('2026-07-13'), '2026-07-13');
  });

  it('walks back to Monday from midweek', () => {
    // 2026-07-15 is a Wednesday.
    assert.strictEqual(startOfWeek('2026-07-15'), '2026-07-13');
  });

  it('treats Sunday as the last day of its week, not the first', () => {
    // 2026-07-19 is a Sunday — its week still starts on 2026-07-13.
    assert.strictEqual(startOfWeek('2026-07-19'), '2026-07-13');
  });

  it('crosses a month boundary correctly', () => {
    // 2026-08-01 is a Saturday → Monday of that week is 2026-07-27.
    assert.strictEqual(startOfWeek('2026-08-01'), '2026-07-27');
  });

  it('throws on a malformed date', () => {
    assert.throws(() => startOfWeek('not-a-date'));
  });
});
