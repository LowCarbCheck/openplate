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
import { readFileSync } from 'node:fs';

import { badgeValueFor, badgeValueForCurrent } from '../../app/hooks/use-current-fast';
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

/**
 * `badgeValueForCurrent` is the whole decision, including the state the hook
 * spends most of its life in: no open fast at all. It exists so the badge
 * effect is keyed on ONE expression, which is what makes "the fast went away"
 * take the number off the icon on the same effect run that sees it go.
 */
describe('badgeValueForCurrent', () => {
  it('clears the badge when there is no open fast', () => {
    assert.equal(badgeValueForCurrent(null, NOW), 'clear');
  });

  it('still reports the hours when a fast is open, so the clear arm means something', () => {
    const started = NOW - (5 * HOUR + 59 * MINUTE);

    assert.equal(badgeValueForCurrent(fast({ startedAt: started, createdAt: started }), NOW), 5);
  });

  it('agrees with badgeValueFor for every open fast it is given', () => {
    const justStarted = fast({ startedAt: NOW - 10 * MINUTE, createdAt: NOW - 10 * MINUTE });

    assert.equal(badgeValueForCurrent(justStarted, NOW), badgeValueFor(resolveFastTimeline(justStarted, NOW)));
  });
});

/**
 * The chip lagged every write to a fast by up to a minute, because the hook
 * re-read only on its own tick. The fix is the primary store's own table
 * listener, which no unit tier can exercise: it needs IndexedDB and a commit
 * phase. So the source itself is the assertion, and each check below has a
 * control that fails if the mechanism is removed or downgraded.
 */
describe('the hook re-reads on a store write, not only on the tick', () => {
  const source = readFileSync(new URL('../../app/hooks/use-current-fast.ts', import.meta.url), 'utf8');

  it('listens to the fasts table of the primary store', () => {
    assert.match(source, /addTableListener\(FASTS_TABLE/, 'the store change signal is the mechanism');
    assert.match(source, /delListener\(listenerId\)/, 'the listener must come off on unmount');
  });

  it('keys the re-read effect on the write counter as well as the clock', () => {
    assert.match(source, /\}, \[nowMs, writeCount\]\);/, 'a [nowMs] only dependency list is the defect');
  });
});
