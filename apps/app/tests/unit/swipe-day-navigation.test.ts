/**
 * Unit tests for `#app/lib/swipe-day-navigation` — the pure decision behind the
 * diary's swipe-between-days gesture (M129/04). The DOM adapter around it
 * (`use-day-swipe.ts`) is deliberately thin precisely so every threshold is
 * provable here, without a browser.
 *
 * The bias under test is conservatism: swipe is a BONUS affordance on top of
 * chevrons and a date picker, so a missed swipe costs nothing while a false
 * positive yanks the page out from under a scroll. Every "returns null" test
 * below is protecting that.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSwipe,
  SWIPE_MAX_DURATION_MS,
  SWIPE_MAX_OFF_AXIS_RATIO,
  SWIPE_MIN_DISTANCE_PX,
} from '../../app/lib/swipe-day-navigation';

/** A clean, unambiguous horizontal flick of `dx` pixels. */
function flick(dx: number, dy = 0, durationMs = 200) {
  return { dx, dy, durationMs };
}

describe('resolveSwipe — direction', () => {
  it('reads a rightward drag as "prev" — yesterday is pulled in from the left', () => {
    assert.equal(resolveSwipe(flick(120)), 'prev');
  });

  it('reads a leftward drag as "next"', () => {
    assert.equal(resolveSwipe(flick(-120)), 'next');
  });

  it('resolves regardless of which way the small vertical drift went', () => {
    assert.equal(resolveSwipe(flick(-120, 20)), 'next');
    assert.equal(resolveSwipe(flick(-120, -20)), 'next');
  });
});

describe('resolveSwipe — minimum distance', () => {
  it('ignores a drag shorter than the minimum (a tap that wobbled)', () => {
    assert.equal(resolveSwipe(flick(SWIPE_MIN_DISTANCE_PX - 1)), null);
    assert.equal(resolveSwipe(flick(-(SWIPE_MIN_DISTANCE_PX - 1))), null);
  });

  it('accepts a drag exactly at the minimum', () => {
    assert.equal(resolveSwipe(flick(SWIPE_MIN_DISTANCE_PX)), 'prev');
  });

  it('ignores a zero-movement touch outright', () => {
    assert.equal(resolveSwipe(flick(0, 0)), null);
  });

  it('honours a caller-supplied distance threshold', () => {
    assert.equal(resolveSwipe(flick(30), { minDistancePx: 20 }), 'prev');
    assert.equal(resolveSwipe(flick(30), { minDistancePx: 200 }), null);
  });
});

describe('resolveSwipe — vertical-scroll rejection', () => {
  it('ignores a straight vertical drag even when it is long', () => {
    assert.equal(resolveSwipe({ dx: 4, dy: 400, durationMs: 300 }), null);
  });

  it('ignores a diagonal drag whose vertical travel exceeds the off-axis ratio', () => {
    const dx = 100;
    const tooSteep = dx * SWIPE_MAX_OFF_AXIS_RATIO + 1;
    assert.equal(resolveSwipe({ dx, dy: tooSteep, durationMs: 300 }), null);
  });

  it('still resolves a diagonal drag right at the off-axis limit (a real thumb arc)', () => {
    const dx = 100;
    assert.equal(resolveSwipe({ dx, dy: dx * SWIPE_MAX_OFF_AXIS_RATIO, durationMs: 300 }), 'prev');
  });

  it('rejects a 45° drag — ambiguous intent is never a swipe', () => {
    assert.equal(resolveSwipe({ dx: -100, dy: 100, durationMs: 300 }), null);
  });

  it('honours a caller-supplied off-axis ratio', () => {
    assert.equal(resolveSwipe({ dx: 100, dy: 90, durationMs: 300 }, { maxOffAxisRatio: 1 }), 'prev');
  });
});

describe('resolveSwipe — duration', () => {
  it('ignores a drag slower than the duration cap (a scroll that drifted sideways)', () => {
    assert.equal(resolveSwipe(flick(200, 0, SWIPE_MAX_DURATION_MS + 1)), null);
  });

  it('accepts a drag exactly at the duration cap', () => {
    assert.equal(resolveSwipe(flick(200, 0, SWIPE_MAX_DURATION_MS)), 'prev');
  });

  it('honours a caller-supplied duration cap', () => {
    assert.equal(resolveSwipe(flick(200, 0, 5000), { maxDurationMs: 10_000 }), 'prev');
  });
});

describe('resolveSwipe — degenerate input', () => {
  it('returns null for non-finite deltas rather than resolving a direction from NaN', () => {
    assert.equal(resolveSwipe({ dx: Number.NaN, dy: 0, durationMs: 100 }), null);
    assert.equal(resolveSwipe({ dx: 100, dy: Number.NaN, durationMs: 100 }), null);
    assert.equal(resolveSwipe({ dx: Number.POSITIVE_INFINITY, dy: 0, durationMs: 100 }), null);
  });
});
