/**
 * Unit tests for `#app/lib/trend-eating-window` — median first→last-meal span. No DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeEatingWindow } from '../../app/lib/trend-eating-window';

/** Builds an epoch-ms timestamp for a given hour/minute on an arbitrary fixed day. */
function at(hour: number, minute = 0): number {
  return Date.UTC(2026, 6, 13, hour, minute, 0);
}

describe('computeEatingWindow', () => {
  it('returns null when fewer than the minimum days are logged', () => {
    const result = computeEatingWindow({
      days: [{ loggedAtMs: [at(8), at(20)] }, { loggedAtMs: [at(9), at(19)] }],
    });

    assert.strictEqual(result, null);
  });

  it('computes the median span across logged days, skipping empty days', () => {
    const result = computeEatingWindow({
      days: [
        { loggedAtMs: [at(8), at(18)] }, // 10h = 600m
        { loggedAtMs: [at(9), at(21)] }, // 12h = 720m
        { loggedAtMs: [] }, // no logs — skipped
        { loggedAtMs: [at(10), at(20)] }, // 10h = 600m
      ],
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.loggedDayCount, 3);
    // Spans sorted: 600, 600, 720 → median 600.
    assert.strictEqual(result?.medianSpanMinutes, 600);
  });

  it('treats a single-meal day as a zero-length span', () => {
    const result = computeEatingWindow({
      days: [{ loggedAtMs: [at(12)] }, { loggedAtMs: [at(8), at(20)] }, { loggedAtMs: [at(9), at(15)] }],
    });

    // Spans: 0, 720, 360 → sorted 0, 360, 720 → median 360.
    assert.strictEqual(result?.medianSpanMinutes, 360);
  });

  it('averages the two middle spans on an even number of logged days', () => {
    const result = computeEatingWindow({
      days: [
        { loggedAtMs: [at(8), at(18)] }, // 600
        { loggedAtMs: [at(8), at(19)] }, // 660
        { loggedAtMs: [at(8), at(20)] }, // 720
        { loggedAtMs: [at(8), at(22)] }, // 840
      ],
    });

    // Middle two are 660 and 720 → mean 690.
    assert.strictEqual(result?.medianSpanMinutes, 690);
  });
});
