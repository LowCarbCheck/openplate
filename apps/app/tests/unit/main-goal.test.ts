/**
 * Unit tests for `#app/lib/main-goal`, the one reader of the profile's main
 * goal.
 *
 * Three claims: a valid stored pick wins over the lens, an unknown string
 * falls back rather than leading with nothing, and each lens maps to the lead
 * the brief names (carb to net carbs, kcal to calories, protein to protein,
 * none to net carbs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { effectiveMainGoal, isMainGoalId, mainGoalForLens, MAIN_GOAL_IDS } from '../../app/lib/main-goal';
import type { MainGoalProfile } from '../../app/lib/main-goal';

/** A profile with no numbers, no style and no pick; every test overrides what it needs. */
function profile(overrides: Partial<MainGoalProfile>): MainGoalProfile {
  return {
    goalNetCarbsCeilingG: null,
    goalKcalTarget: null,
    goalProteinFloorG: null,
    eatingStyle: null,
    mainGoal: null,
    ...overrides,
  };
}

describe('effectiveMainGoal, a stored pick', () => {
  it('wins over the lens of a carb style', () => {
    const goals = profile({ eatingStyle: 'low-carb', goalNetCarbsCeilingG: 50, mainGoal: 'protein' });
    assert.equal(effectiveMainGoal(goals), 'protein');
    // CONTROL: the same profile without the pick leads with the lens, so the
    // assertion above is the pick winning and not the lens agreeing.
    assert.equal(effectiveMainGoal({ ...goals, mainGoal: null }), 'net-carbs');
  });

  it('wins over the lens of a calorie style', () => {
    const goals = profile({ eatingStyle: 'low-kcal', goalKcalTarget: 1800, mainGoal: 'net-carbs' });
    assert.equal(effectiveMainGoal(goals), 'net-carbs');
    assert.equal(effectiveMainGoal({ ...goals, mainGoal: null }), 'calories');
  });
});

describe('effectiveMainGoal, a value this build does not know', () => {
  for (const unknown of ['fiber', 'Net carbs', '', 'habit']) {
    it(`falls back to the lens for "${unknown}"`, () => {
      assert.equal(effectiveMainGoal(profile({ eatingStyle: 'high-protein', mainGoal: unknown })), 'protein');
      assert.equal(effectiveMainGoal(profile({ eatingStyle: 'low-kcal', mainGoal: unknown })), 'calories');
    });
  }

  it('reads an absent key the same as null', () => {
    const { mainGoal: _absent, ...withoutKey } = profile({ eatingStyle: 'low-kcal', goalKcalTarget: 1800 });
    assert.equal(effectiveMainGoal(withoutKey), 'calories');
  });
});

describe('effectiveMainGoal, the default per lens', () => {
  it('maps each stored style through its lens', () => {
    assert.equal(effectiveMainGoal(profile({ eatingStyle: 'low-carb' })), 'net-carbs');
    assert.equal(effectiveMainGoal(profile({ eatingStyle: 'low-carb-low-kcal' })), 'net-carbs');
    assert.equal(effectiveMainGoal(profile({ eatingStyle: 'low-kcal' })), 'calories');
    assert.equal(effectiveMainGoal(profile({ eatingStyle: 'high-protein' })), 'protein');
    assert.equal(effectiveMainGoal(profile({ eatingStyle: 'just-track' })), 'net-carbs');
  });

  it('derives the style from the numbers for a profile written before the style existed', () => {
    assert.equal(effectiveMainGoal(profile({ goalKcalTarget: 1800 })), 'calories');
    assert.equal(effectiveMainGoal(profile({ goalProteinFloorG: 120 })), 'protein');
    assert.equal(effectiveMainGoal(profile({ goalNetCarbsCeilingG: 50, goalKcalTarget: 1800 })), 'net-carbs');
  });

  it('leads with net carbs for a profile that says nothing at all', () => {
    assert.equal(effectiveMainGoal(profile({})), 'net-carbs');
  });

  it('maps the four lenses directly', () => {
    assert.equal(mainGoalForLens('carb'), 'net-carbs');
    assert.equal(mainGoalForLens('kcal'), 'calories');
    assert.equal(mainGoalForLens('protein'), 'protein');
    assert.equal(mainGoalForLens('none'), 'net-carbs');
  });
});

describe('isMainGoalId', () => {
  it('accepts exactly the three ids', () => {
    assert.deepEqual(
      MAIN_GOAL_IDS.filter((id) => isMainGoalId(id)),
      ['net-carbs', 'calories', 'protein'],
    );
    assert.equal(isMainGoalId(null), false);
    assert.equal(isMainGoalId(undefined), false);
    assert.equal(isMainGoalId('fat'), false);
  });
});
