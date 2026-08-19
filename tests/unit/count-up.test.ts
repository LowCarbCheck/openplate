/**
 * Unit tests for `#app/lib/count-up` — the hero figure's tween arithmetic
 * (M129/03).
 *
 * The interesting property here is the INTERRUPTION contract from the spec's
 * counsel amendments: a second add landing mid-tween must continue from the
 * value currently on screen, never restart from zero and never overshoot. The
 * hook enforces that by always passing the displayed value as `from`; these
 * tests pin that such a call behaves (monotonic, lands exactly, no rewind).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COUNT_UP_DURATION_MS, countUpValue, easeOutCubic, shouldAnimateCountUp } from '../../app/lib/count-up';

describe('easeOutCubic', () => {
  it('spans 0 to 1 and clamps outside that range', () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.equal(easeOutCubic(-1), 0);
    assert.equal(easeOutCubic(4), 1);
  });

  it('front-loads the movement (ease OUT, not linear)', () => {
    assert.ok(easeOutCubic(0.5) > 0.5, 'half the time should cover more than half the distance');
  });
});

describe('countUpValue', () => {
  it('starts at the from value', () => {
    assert.equal(countUpValue({ from: 10, to: 20, elapsedMs: 0 }), 10);
  });

  it('lands exactly on the target at the end, with no floating-point residue', () => {
    assert.equal(countUpValue({ from: 10, to: 20, elapsedMs: COUNT_UP_DURATION_MS }), 20);
    assert.equal(countUpValue({ from: 10, to: 20, elapsedMs: COUNT_UP_DURATION_MS * 10 }), 20);
  });

  it('moves monotonically between the two values', () => {
    let previous = -Infinity;
    for (let elapsed = 0; elapsed <= COUNT_UP_DURATION_MS; elapsed += 20) {
      const value = countUpValue({ from: 0, to: 50, elapsedMs: elapsed });
      assert.ok(value >= previous, `value went backwards at ${elapsed}ms`);
      assert.ok(value <= 50, 'never overshoots the target');
      previous = value;
    }
  });

  it('counts DOWN as happily as up (remaining budgets shrink)', () => {
    const mid = countUpValue({ from: 50, to: 10, elapsedMs: COUNT_UP_DURATION_MS / 2 });
    assert.ok(mid < 50 && mid > 10, `expected a value between 10 and 50, got ${mid}`);
  });

  it('continues from a partial value rather than restarting (interrupted tween)', () => {
    const interruptedAt = countUpValue({ from: 0, to: 50, elapsedMs: 100 });
    const retargeted = countUpValue({ from: interruptedAt, to: 30, elapsedMs: 0 });
    assert.equal(retargeted, interruptedAt, 'a retarget must not rewind the displayed value');
  });

  it('jumps straight to the target when there is no duration (the reduced-motion path)', () => {
    assert.equal(countUpValue({ from: 0, to: 42, elapsedMs: 0, durationMs: 0 }), 42);
  });
});

describe('shouldAnimateCountUp', () => {
  it('does not animate a first paint', () => {
    assert.equal(shouldAnimateCountUp(null, 42), false);
  });

  it('does not animate a no-op change', () => {
    assert.equal(shouldAnimateCountUp(42, 42), false);
    assert.equal(shouldAnimateCountUp(42, 42.01), false);
  });

  it('animates a real change in either direction', () => {
    assert.equal(shouldAnimateCountUp(42, 30), true);
    assert.equal(shouldAnimateCountUp(30, 42), true);
  });
});
