/**
 * Unit tests for the pure helpers exported from `app/routes/trends.tsx`.
 *
 * `pickDefaultRange`, the "week one shouldn't look broken" fix. A brand-new
 * account (first log within the last week) gets the narrow 7-day chart window
 * instead of the usual 14, so the chart isn't a dozen empty "no entry" slots
 * around a single bar.
 *
 * `_parseTab` (M239/02), the `?tab=` search param parser for the four
 * Insights sections, mirroring `_parseSlot`'s "a bad value reads as the
 * safest tab" rule.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pickDefaultRange, _parseMetric, _parseTab } from '../../app/routes/trends';

describe('pickDefaultRange', () => {
  it('defaults to the full 14-day window when there are no logs yet', () => {
    assert.strictEqual(pickDefaultRange({ earliestLoggedDate: null, today: '2026-07-28' }), 14);
  });

  it('narrows to 7 days for a brand-new account whose first log is today', () => {
    assert.strictEqual(pickDefaultRange({ earliestLoggedDate: '2026-07-28', today: '2026-07-28' }), 7);
  });

  it('narrows to 7 days when the first log was earlier this week (within the last 7 days)', () => {
    assert.strictEqual(pickDefaultRange({ earliestLoggedDate: '2026-07-24', today: '2026-07-28' }), 7);
  });

  it('stays at the full 14-day window once history is older than a week', () => {
    assert.strictEqual(pickDefaultRange({ earliestLoggedDate: '2026-07-20', today: '2026-07-28' }), 14);
  });

  it('treats exactly 7 days ago as still within the new-account window (inclusive boundary)', () => {
    assert.strictEqual(pickDefaultRange({ earliestLoggedDate: '2026-07-22', today: '2026-07-28' }), 7);
  });
});

describe('_parseTab', () => {
  it('reads each of the four valid tab values', () => {
    assert.strictEqual(_parseTab('overview'), 'overview');
    assert.strictEqual(_parseTab('nutrition'), 'nutrition');
    assert.strictEqual(_parseTab('meals'), 'meals');
    assert.strictEqual(_parseTab('goals'), 'goals');
  });

  it('falls back to overview for an invalid value', () => {
    assert.strictEqual(_parseTab('progress'), 'overview');
  });

  it('falls back to overview when the param is absent', () => {
    assert.strictEqual(_parseTab(null), 'overview');
  });
});

describe('_parseMetric (M239/03)', () => {
  it('reads each of the five metrics', () => {
    for (const metric of ['net-carbs', 'calories', 'protein', 'fat', 'fiber'] as const) {
      assert.strictEqual(_parseMetric(metric), metric);
    }
  });

  it('falls back to net carbs for an invalid or absent value', () => {
    assert.strictEqual(_parseMetric('sugar'), 'net-carbs');
    assert.strictEqual(_parseMetric(null), 'net-carbs');
  });
});
