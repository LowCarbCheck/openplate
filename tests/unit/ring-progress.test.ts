/**
 * Unit tests for `#app/lib/ring-progress` — the pure dashoffset/circumference
 * math behind the diary hero's `RingProgress` ring (M129/02). Pins the
 * clamping rules (over-goal renders a FULL ring, not an overflowing dash
 * array) and the degenerate `max <= 0` fallback so a future edit can't
 * silently reintroduce a divide-by-zero or a dash offset that draws past
 * the circle's own circumference.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeRingGeometry } from '../../app/lib/ring-progress';

describe('computeRingGeometry', () => {
  it('draws no arc at value 0 — dashoffset equals the full circumference', () => {
    const geometry = computeRingGeometry({ value: 0, max: 100, size: 100, strokeWidth: 10 });
    assert.equal(geometry.dashoffset, geometry.circumference);
    assert.equal(geometry.percent, 0);
  });

  it('draws a full arc at value === max — dashoffset is 0', () => {
    const geometry = computeRingGeometry({ value: 100, max: 100, size: 100, strokeWidth: 10 });
    assert.equal(geometry.dashoffset, 0);
    assert.equal(geometry.percent, 100);
  });

  it('draws a half arc at value === max / 2', () => {
    const geometry = computeRingGeometry({ value: 50, max: 100, size: 100, strokeWidth: 10 });
    assert.ok(Math.abs(geometry.dashoffset - geometry.circumference / 2) < 1e-9);
    assert.equal(geometry.percent, 50);
  });

  it('clamps an over-goal value to a full ring rather than overflowing the dasharray', () => {
    const geometry = computeRingGeometry({ value: 150, max: 100, size: 100, strokeWidth: 10 });
    assert.equal(geometry.dashoffset, 0);
    assert.equal(geometry.clampedValue, 100);
    assert.equal(geometry.percent, 100);
  });

  it('clamps a negative value to an empty ring', () => {
    const geometry = computeRingGeometry({ value: -10, max: 100, size: 100, strokeWidth: 10 });
    assert.equal(geometry.dashoffset, geometry.circumference);
    assert.equal(geometry.clampedValue, 0);
  });

  it('treats a non-positive max as "no ceiling to divide against" — full ring once value is positive', () => {
    const zeroCeiling = computeRingGeometry({ value: 5, max: 0, size: 100, strokeWidth: 10 });
    assert.equal(zeroCeiling.dashoffset, 0);
    assert.equal(zeroCeiling.percent, 100);

    const zeroCeilingNoValue = computeRingGeometry({ value: 0, max: 0, size: 100, strokeWidth: 10 });
    assert.equal(zeroCeilingNoValue.dashoffset, zeroCeilingNoValue.circumference);
    assert.equal(zeroCeilingNoValue.percent, 0);
  });

  it('radius is inset by half the stroke width so the ring never clips the SVG viewport', () => {
    const geometry = computeRingGeometry({ value: 10, max: 100, size: 140, strokeWidth: 10 });
    assert.equal(geometry.radius, (140 - 10) / 2);
    assert.equal(geometry.circumference, 2 * Math.PI * geometry.radius);
  });
});
