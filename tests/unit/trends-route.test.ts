/**
 * Unit tests for the pure helpers exported from `app/routes/trends.tsx`.
 * Focus: `pickDefaultRange` — the "week one shouldn't look broken" fix. A
 * brand-new account (first log within the last week) gets the narrow 7-day
 * chart window instead of the usual 14, so the chart isn't a dozen empty
 * "no entry" slots around a single bar.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pickDefaultRange } from '../../app/routes/trends';

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
