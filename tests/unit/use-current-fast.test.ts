/**
 * Unit tests for `badgeValueFor` in `#app/hooks/use-current-fast`, the app
 * badge decision, extracted from the hook precisely so it can be pinned here
 * without a `navigator` and without a commit phase (`renderToStaticMarkup`
 * never runs a `useEffect`, so the hook itself is unreachable from this tier).
 *
 * The decision is three-valued on purpose and each value means something
 * different to the platform:
 *
 *   number   -> `setAppBadge(n)`, n hours on the icon
 *   null     -> `setAppBadge()`, a badge with NO number, i.e. a plain dot
 *   'clear'  -> `clearAppBadge()`, no badge at all
 *
 * The first hour is a dot rather than a "0" because "0" reads as nothing to
 * see, which is the opposite of what a fast that just started means.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { badgeValueFor } from '../../app/hooks/use-current-fast';
import { resolveFastTimeline } from '../../app/models/fasting';
import type { LocalFast } from '../../app/lib/local-store/schema';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SIXTEEN = 16 * HOUR;

const NOW = 1_760_000_000_000;

function fast(overrides: Partial<LocalFast>): LocalFast {
  return {
    id: 'fast-1',
    protocolId: '16:8',
    targetDurationMs: SIXTEEN,
    plannedStartAt: null,
    startedAt: NOW,
    endedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

/** The badge decision for one stored row, resolved against the fixed clock. */
function badgeFor(row: LocalFast): number | null | 'clear' {
  return badgeValueFor(resolveFastTimeline(row, NOW));
}

describe('badgeValueFor', () => {
  it('clears the badge for a fast that has not started yet', () => {
    const scheduled = fast({ startedAt: null, plannedStartAt: NOW + 2 * HOUR, createdAt: NOW - MINUTE });

    assert.equal(resolveFastTimeline(scheduled, NOW).status, 'scheduled', 'fixture guard: this row must be scheduled');
    assert.equal(badgeFor(scheduled), 'clear');
  });

  it('shows a numberless dot in the first hour', () => {
    const justStarted = fast({ startedAt: NOW - 10 * MINUTE, createdAt: NOW - 10 * MINUTE });

    assert.equal(badgeFor(justStarted), null, 'a 0 would read as "nothing to see"');
  });

  it('floors to whole hours, so 5h 59m is still a 5', () => {
    const started = NOW - (5 * HOUR + 59 * MINUTE);
    const almostSix = fast({ startedAt: started, createdAt: started });

    assert.equal(badgeFor(almostSix), 5);
  });

  it('clears the badge once the fast has ended', () => {
    const started = NOW - 17 * HOUR;
    const ended = fast({ startedAt: started, createdAt: started, endedAt: NOW - MINUTE });

    assert.equal(resolveFastTimeline(ended, NOW).status, 'completed', 'fixture guard: this row must be finished');
    assert.equal(badgeFor(ended), 'clear');
  });
});
