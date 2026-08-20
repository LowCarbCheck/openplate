/**
 * The rate limiter's bucket sweep — the two ways it used to be wrong.
 *
 * ── Why these two and not "does it rate-limit" ───────────────────────────
 *
 * The counting itself is exercised by every caller's own tests. The SWEEP is
 * different: it is invisible bookkeeping that runs on whichever request
 * happens to trip a size threshold, and both of its faults were silent —
 * neither produced an error, a log line or a wrong HTTP status, only a limit
 * that quietly stopped limiting or a flood that quietly got slower.
 *
 * 1. CROSS-WINDOW CONTAMINATION. The sweep judged every bucket by the window
 *    of the caller that triggered it. A short-window limiter walking the map
 *    therefore evicted a long-window limiter's LIVE buckets, handing a client
 *    that was over its limit a brand-new allowance.
 * 2. UNTHROTTLED SWEEPS. Above the threshold every single request walked the
 *    whole map, so the guard against a flood cost the most exactly during one.
 *
 * ── Why mocked time, and why each case starts later than the last ────────
 *
 * Both facts are about elapsed milliseconds against windows measured in
 * minutes; real sleeps would make this file slow or flaky. The mocked clock
 * starts at a REALISTIC epoch rather than at 0, because the module's
 * `lastSweptAt` starts at 0 and "has a window elapsed since the last sweep?"
 * is only meaningful against a real timestamp. Each case starts well after
 * the previous one for the same reason: `lastSweptAt` is module state, and a
 * clock that jumps backwards between cases would suppress every later sweep.
 *
 * Keys are prefixed per case — the bucket map is module state shared with the
 * rest of the suite, so overlapping keys would make these cases order-dependent.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRateLimit,
  clearRateLimit,
  rateLimitBucketCount,
  RateLimitExceededError,
} from '../../app/lib/rate-limit.server';

/** Comfortably past `SWEEP_THRESHOLD` (1000), so a sweep is eligible to run. */
const FLOOD_SIZE = 1_050;

const CONTAMINATION_START = 1_700_000_000_000;
const THROTTLE_START = CONTAMINATION_START + 10_000_000;

/** Opens `FLOOD_SIZE` buckets under one window and returns their keys. */
function flood(prefix: string, windowMs: number): string[] {
  const keys = Array.from({ length: FLOOD_SIZE }, (_, index) => `${prefix}:${index}`);
  for (const key of keys) checkRateLimit(key, { windowMs, max: FLOOD_SIZE });
  return keys;
}

describe('rate-limit bucket sweep', () => {
  it('never evicts a bucket whose own window is still running', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: CONTAMINATION_START });
    t.after(() => mock.timers.reset());

    const longKey = 'sweep-window:long';
    const longWindow = { windowMs: 60_000, max: 1 };
    clearRateLimit(longKey);

    // One hit under a MINUTE-long window: this bucket is now at its limit.
    checkRateLimit(longKey, longWindow);

    // A short-window limiter fills the map past the sweep threshold, then time
    // moves far enough for ITS buckets to expire — but nowhere near far enough
    // for the minute-long one above.
    const shortWindow = { windowMs: 1_000, max: 1 };
    flood('sweep-window:short', shortWindow.windowMs);
    t.mock.timers.tick(2_000);
    checkRateLimit('sweep-window:short:trigger', shortWindow);

    // The long bucket must have survived. Judged by the SWEEPING caller's
    // 1s window it was 2000ms old and would have been dropped, and this hit
    // would then have opened a fresh window instead of being refused.
    assert.throws(
      () => checkRateLimit(longKey, longWindow),
      RateLimitExceededError,
      'a 60s bucket was evicted by a 1s sweep — cross-window contamination is back',
    );
  });

  it('sweeps at most once per window while the map stays large', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: THROTTLE_START });
    t.after(() => mock.timers.reset());

    // A long window keeps these buckets alive for the whole case, so the map
    // stays above the threshold and the sweep stays eligible throughout. The
    // flood's own first hit past the threshold performs this window's sweep.
    const longWindow = { windowMs: 100_000, max: FLOOD_SIZE };
    flood('sweep-throttle:bulk', longWindow.windowMs);

    // One probe key does the triggering from here on, reused so that it never
    // grows the map and never changes what a sweep would find.
    const probe = 'sweep-throttle:probe';
    clearRateLimit(probe);
    checkRateLimit(probe, longWindow);

    // A bucket that expires almost immediately, opened after that sweep.
    const doomed = 'sweep-throttle:doomed';
    clearRateLimit(doomed);
    checkRateLimit(doomed, { windowMs: 10, max: 1 });
    t.mock.timers.tick(50); // expired, and 50ms is well inside the 100s window

    const before = rateLimitBucketCount();
    checkRateLimit(probe, longWindow);
    assert.equal(
      rateLimitBucketCount(),
      before,
      'the map was walked again 50ms after the previous sweep — the throttle is gone',
    );

    // Past the window, the next hit does sweep, and the expired bucket goes.
    t.mock.timers.tick(100_000);
    checkRateLimit(probe, longWindow);
    assert.ok(rateLimitBucketCount() < before, 'the sweep never ran again, so nothing was ever reclaimed');
  });
});
