/**
 * Unit tests for `#app/lib/goal-rings`, which daily goals draw a ring, and
 * which single focus value gets stored for an older build (M200 spec 02).
 *
 * The defect this module exists to fix is the BOTH case: a person with a carb
 * ceiling AND a calorie target saw only carbs, because the hero returned early
 * on the carb branch. So "both" is the case that matters most here, and the
 * selector is deliberately blind to the stored `trackingFocus`, a number the
 * person set is the evidence that they track it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { selectGoalRings, storedTrackingFocusFor } from '../../app/lib/goal-rings';

describe('selectGoalRings', () => {
  it('returns both rings when both targets are set', () => {
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: 50, kcalTarget: 1800 }), ['net-carbs', 'calories']);
  });

  it('puts net carbs first when both are set, so the pair cannot swap places between renders', () => {
    const rings = selectGoalRings({ netCarbsCeiling: 20, kcalTarget: 2000 });
    assert.equal(rings[0], 'net-carbs');
    assert.equal(rings[1], 'calories');
  });

  it('returns only the carb ring when only a ceiling is set', () => {
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: 50, kcalTarget: null }), ['net-carbs']);
  });

  it('returns only the calorie ring when only a target is set', () => {
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: null, kcalTarget: 1800 }), ['calories']);
  });

  it('returns no ring when neither target is set', () => {
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: null, kcalTarget: null }), []);
  });

  it('treats a zero or negative target as no goal, never as a ring against nothing', () => {
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: 0, kcalTarget: 0 }), []);
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: -10, kcalTarget: -1 }), []);
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: 0, kcalTarget: 1800 }), ['calories']);
    assert.deepEqual(selectGoalRings({ netCarbsCeiling: 50, kcalTarget: -5 }), ['net-carbs']);
  });
});

describe('storedTrackingFocusFor', () => {
  it('stores net-carbs when both rings are visible, so an older build renders the hero it already renders', () => {
    assert.equal(storedTrackingFocusFor(['net-carbs', 'calories']), 'net-carbs');
  });

  it('stores the one metric being tracked when only one ring is visible', () => {
    assert.equal(storedTrackingFocusFor(['net-carbs']), 'net-carbs');
    assert.equal(storedTrackingFocusFor(['calories']), 'calories');
  });

  it('stores habit when there is no ring, which is what habit has always meant', () => {
    assert.equal(storedTrackingFocusFor([]), 'habit');
  });

  it('never invents a fourth value: every result is one of the three stored members', () => {
    const stored = [['net-carbs', 'calories'], ['net-carbs'], ['calories'], []] as const;
    for (const rings of stored) {
      assert.ok(['net-carbs', 'calories', 'habit'].includes(storedTrackingFocusFor(rings)));
    }
  });
});
