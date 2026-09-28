/**
 * Unit tests for `#app/lib/goal-progress` — the pure goal-vs-actual arithmetic
 * behind the diary's goal-aware day summary (net-carb ceiling + protein floor).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeCarbGoalProgress, computeProteinGoalProgress, isOverCarbGoal } from '../../app/lib/goal-progress';

describe('isOverCarbGoal', () => {
  it('is not over just under the ceiling', () => {
    assert.strictEqual(isOverCarbGoal({ netCarbs: 97, ceiling: 98 }), false);
  });

  it('is not over exactly at the ceiling', () => {
    assert.strictEqual(isOverCarbGoal({ netCarbs: 98, ceiling: 98 }), false);
  });

  it('is over just past the ceiling', () => {
    assert.strictEqual(isOverCarbGoal({ netCarbs: 99, ceiling: 98 }), true);
  });

  it('is not over for the sub-gram spillover that motivated rounding (98.3 vs 98)', () => {
    // 98.3 rounds to 98, matching the ceiling's rounded 98 — the headline would
    // display "98 of 98 g", so the verdict must read met, not over.
    assert.strictEqual(isOverCarbGoal({ netCarbs: 98.3, ceiling: 98 }), false);
  });

  it('is over once the sub-gram spillover rounds past the ceiling (98.6 vs 98)', () => {
    assert.strictEqual(isOverCarbGoal({ netCarbs: 98.6, ceiling: 98 }), true);
  });

  it('treats a null-equivalent absent goal as the caller’s responsibility, not its own', () => {
    // isOverCarbGoal takes a required numeric ceiling — every call site (diary,
    // habit-strip, streak, weekly recap) gates on `ceiling !== null` before
    // calling it, so "no goal set" never reaches this predicate as a value.
    // A ceiling of 0 (the closest in-band "no room" case) still behaves sanely.
    assert.strictEqual(isOverCarbGoal({ netCarbs: 0, ceiling: 0 }), false);
    assert.strictEqual(isOverCarbGoal({ netCarbs: 1, ceiling: 0 }), true);
  });
});

describe('computeCarbGoalProgress', () => {
  it('fills proportionally and is not over when under the ceiling', () => {
    const progress = computeCarbGoalProgress({ netCarbs: 10, ceiling: 20 });
    assert.strictEqual(progress.fraction, 0.5);
    assert.strictEqual(progress.isOver, false);
    assert.strictEqual(progress.overByG, 0);
  });

  it('treats exactly at the ceiling as full but not over', () => {
    const progress = computeCarbGoalProgress({ netCarbs: 20, ceiling: 20 });
    assert.strictEqual(progress.fraction, 1);
    assert.strictEqual(progress.isOver, false);
    assert.strictEqual(progress.overByG, 0);
  });

  it('clamps the bar at 1 and reports the grams over when past the ceiling', () => {
    const progress = computeCarbGoalProgress({ netCarbs: 26, ceiling: 20 });
    assert.strictEqual(progress.fraction, 1);
    assert.strictEqual(progress.isOver, true);
    assert.strictEqual(progress.overByG, 6);
  });

  it('never returns a negative fraction', () => {
    const progress = computeCarbGoalProgress({ netCarbs: -5, ceiling: 20 });
    assert.strictEqual(progress.fraction, 0);
    assert.strictEqual(progress.isOver, false);
  });

  it('handles a zero ceiling without dividing by zero', () => {
    assert.strictEqual(computeCarbGoalProgress({ netCarbs: 3, ceiling: 0 }).fraction, 1);
    assert.strictEqual(computeCarbGoalProgress({ netCarbs: 3, ceiling: 0 }).isOver, true);
    assert.strictEqual(computeCarbGoalProgress({ netCarbs: 0, ceiling: 0 }).fraction, 0);
  });

  it('is not over when the raw value rounds down to the displayed ceiling (20.4 vs 20)', () => {
    // The UI rounds both netCarbs and ceiling to whole grams for the "X of Y g"
    // headline — 20.4 displays as "20", so isOver must agree with that, not the
    // raw 20.4 > 20 comparison (which used to contradict the headline).
    const progress = computeCarbGoalProgress({ netCarbs: 20.4, ceiling: 20 });
    assert.strictEqual(progress.isOver, false);
    assert.strictEqual(progress.overByG, 0);
  });

  it('is over once the rounded value exceeds the rounded ceiling (20.6 vs 20)', () => {
    const progress = computeCarbGoalProgress({ netCarbs: 20.6, ceiling: 20 });
    assert.strictEqual(progress.isOver, true);
  });
});

describe('computeProteinGoalProgress', () => {
  it('is met at or above the floor', () => {
    assert.strictEqual(computeProteinGoalProgress({ protein: 80, floor: 80 }).isMet, true);
    assert.strictEqual(computeProteinGoalProgress({ protein: 95, floor: 80 }).isMet, true);
  });

  it('is not met below the floor', () => {
    assert.strictEqual(computeProteinGoalProgress({ protein: 60, floor: 80 }).isMet, false);
  });

  it('is met when the raw value rounds up to the displayed floor (99.6 vs 100)', () => {
    // The UI rounds to "100 / 100 g" — isMet must agree, not the raw 99.6 >= 100
    // comparison (which used to contradict the headline with no checkmark).
    assert.strictEqual(computeProteinGoalProgress({ protein: 99.6, floor: 100 }).isMet, true);
  });

  it('is not met when the rounded value still falls short of the rounded floor (99.4 vs 100)', () => {
    assert.strictEqual(computeProteinGoalProgress({ protein: 99.4, floor: 100 }).isMet, false);
  });
});
