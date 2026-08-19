/**
 * Unit tests for `#app/lib/ewma` — the pure weight-trend math behind the goals
 * page's inline-SVG chart. No DB, no React: exponential smoothing, value-range
 * padding, linear pixel scaling, and calendar-day distance. The irregular-gap
 * behaviour (a reading after a long gap pulls the trend harder) is asserted
 * explicitly since it's the whole reason this isn't a textbook EWMA.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeValueRange,
  daysBetweenDates,
  exponentialMovingAverage,
  scaleLinear,
  type DatedValue,
} from '../../app/lib/ewma';

const EPSILON = 1e-9;

/** Asserts two numbers are equal within floating-point tolerance. */
function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < EPSILON, `expected ${actual} ≈ ${expected}`);
}

describe('daysBetweenDates', () => {
  it('counts whole calendar days forward', () => {
    assert.strictEqual(daysBetweenDates('2026-01-01', '2026-01-11'), 10);
  });

  it('returns a negative count when the second date precedes the first', () => {
    assert.strictEqual(daysBetweenDates('2026-03-01', '2026-02-28'), -1);
  });

  it('counts calendar days across a DST transition, not elapsed hours', () => {
    // Europe/Berlin springs forward on 2026-03-29, but this is pure UTC-date math.
    assert.strictEqual(daysBetweenDates('2026-03-29', '2026-03-30'), 1);
  });

  it('throws on a malformed date', () => {
    assert.throws(() => daysBetweenDates('2026-1-1', '2026-01-02'));
  });
});

describe('exponentialMovingAverage', () => {
  it('returns an empty series for no points', () => {
    assert.deepStrictEqual(exponentialMovingAverage([]), []);
  });

  it('seeds the first point unchanged', () => {
    const result = exponentialMovingAverage([{ date: '2026-01-01', value: 80 }]);
    assert.deepStrictEqual(result, [{ date: '2026-01-01', value: 80 }]);
  });

  it('applies ordinary EWMA weighting across a one-day gap', () => {
    const points: DatedValue[] = [
      { date: '2026-01-01', value: 80 },
      { date: '2026-01-02', value: 82 },
    ];
    const result = exponentialMovingAverage(points, 0.5);
    assertClose(result[1].value, 81); // 0.5*82 + 0.5*80
  });

  it('lets a reading after a long gap pull the trend harder than a next-day reading', () => {
    const nextDay = exponentialMovingAverage(
      [
        { date: '2026-01-01', value: 80 },
        { date: '2026-01-02', value: 90 },
      ],
      0.25,
    );
    const afterGap = exponentialMovingAverage(
      [
        { date: '2026-01-01', value: 80 },
        { date: '2026-01-11', value: 90 },
      ],
      0.25,
    );
    // Both move toward 90; the 10-day gap lands closer to the fresh reading.
    assert.ok(afterGap[1].value > nextDay[1].value);
    assert.ok(afterGap[1].value < 90);
  });

  it('clamps same-day duplicates to a one-day gap', () => {
    const result = exponentialMovingAverage(
      [
        { date: '2026-01-01', value: 80 },
        { date: '2026-01-01', value: 90 },
      ],
      0.5,
    );
    assertClose(result[1].value, 85); // treated as a 1-day gap: 0.5*90 + 0.5*80
  });

  it('rejects an alpha outside (0, 1]', () => {
    assert.throws(() => exponentialMovingAverage([{ date: '2026-01-01', value: 80 }], 0));
    assert.throws(() => exponentialMovingAverage([{ date: '2026-01-01', value: 80 }], 1.5));
  });
});

describe('computeValueRange', () => {
  it('falls back to a unit range for no values', () => {
    assert.deepStrictEqual(computeValueRange([]), { min: 0, max: 1 });
  });

  it('pads a spread of values by 10% on each side', () => {
    const range = computeValueRange([80, 84]);
    assertClose(range.min, 79.6);
    assertClose(range.max, 84.4);
  });

  it('gives a single distinct value a fixed ±1 band', () => {
    assert.deepStrictEqual(computeValueRange([80, 80]), { min: 79, max: 81 });
  });
});

describe('scaleLinear', () => {
  it('maps the domain endpoints onto the range endpoints', () => {
    assertClose(scaleLinear({ value: 0, domainMin: 0, domainMax: 10, rangeMin: 0, rangeMax: 100 }), 0);
    assertClose(scaleLinear({ value: 10, domainMin: 0, domainMax: 10, rangeMin: 0, rangeMax: 100 }), 100);
  });

  it('interpolates the midpoint', () => {
    assertClose(scaleLinear({ value: 5, domainMin: 0, domainMax: 10, rangeMin: 0, rangeMax: 100 }), 50);
  });

  it('supports an inverted range (SVG y-axis)', () => {
    assertClose(scaleLinear({ value: 5, domainMin: 0, domainMax: 10, rangeMin: 200, rangeMax: 0 }), 100);
  });

  it('maps a zero-width domain to the range midpoint', () => {
    assertClose(scaleLinear({ value: 5, domainMin: 3, domainMax: 3, rangeMin: 0, rangeMax: 100 }), 50);
  });
});
