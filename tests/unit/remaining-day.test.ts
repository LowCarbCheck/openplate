/**
 * Unit tests for `#app/lib/remaining-day` — the rest of the day as one value,
 * and the emphasis the next meal is built from (M233/03).
 *
 * The behaviour worth pinning is the one a screenshot can never show: that a
 * meal already heavy in a nutrient stops that nutrient from leading the NEXT
 * meal, that an untouched day leaves every target fully open, and that a day
 * past its calorie target asks for something light rather than reporting a
 * negative budget.
 *
 * Every assertion below has a control that goes red: the heavy breakfast is
 * paired with the same day eaten lighter, the over-target day with the same day
 * under it, and the prompt block with a language code it must NOT carry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRemainingDay,
  describeRemainingDayForPrompt,
  DEFAULT_PROTEIN_FLOOR_G,
  LIGHT_EMPHASIS_MAX_REMAINING_FRACTION,
  LOW_CARB_EMPHASIS_MAX_REMAINING_FRACTION,
  PROTEIN_EMPHASIS_MIN_REMAINING_FRACTION,
  type RemainingDay,
  type RemainingDayTotals,
} from '../../app/lib/remaining-day';
import { deriveFatTargetG } from '../../app/lib/day-budget-rows';
import { DEFAULT_FIBER_REFERENCE_G } from '../../app/lib/macro-gaps';
import type { LocalProfileGoals } from '../../app/lib/local-store/schema';

/** A stored profile with the three goal numbers set, and nothing else that matters here. */
function profile(overrides: Partial<LocalProfileGoals> = {}): LocalProfileGoals {
  return {
    timezone: 'Europe/Berlin',
    goalNetCarbsCeilingG: 50,
    goalProteinFloorG: 120,
    goalKcalTarget: 2000,
    targetWeightKg: null,
    trackingFocus: null,
    onboardingCompletedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** A day's totals, defaulting to an untouched day. */
function totals(overrides: Partial<RemainingDayTotals> = {}): RemainingDayTotals {
  return { netCarbs: 0, protein: 0, fiber: 0, kcal: 0, fatG: 0, ...overrides };
}

/** Narrows a nullable row, so a missing target reads as a failure rather than an optional chain. */
function row(value: RemainingDay['kcal']): NonNullable<RemainingDay['kcal']> {
  assert.ok(value !== null, 'expected this nutrient to have a target');
  return value;
}

describe('computeRemainingDay, a heavy protein breakfast', () => {
  /** 600 kcal of a 2000 kcal day, so the day is 30 percent eaten by energy. */
  const DAY_KCAL = 600;

  it('drops protein from the emphasis once the floor is all but met', () => {
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, protein: 100, netCarbs: 8, fiber: 4, fatG: 30 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.equal(day.protein.remaining, 20);
    assert.ok(
      day.protein.remaining / day.protein.target < PROTEIN_EMPHASIS_MIN_REMAINING_FRACTION,
      'the floor must be inside the drop threshold for this case to mean anything',
    );
    assert.ok(!day.emphasis.includes('protein'), `expected no protein emphasis, got ${day.emphasis.join(', ')}`);
  });

  it('keeps protein in the emphasis on the same day eaten light on protein', () => {
    // The control. Identical day, identical energy, 10 g of protein instead of
    // 100 g, so only the protein figure can explain the different answer.
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, protein: 10, netCarbs: 8, fiber: 4, fatG: 30 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.ok(day.emphasis.includes('protein'), `expected a protein emphasis, got ${day.emphasis.join(', ')}`);
  });

  it('holds the lead threshold exactly: 20 g of protein is still not behind enough', () => {
    // The boundary the spec's own example sits on. At 20 g the floor is 16.7
    // percent paid against 30 percent of the energy, a lead of 13.3 points,
    // which is under `BEHIND_THE_DAY_MIN_FRACTION_LEAD`. Pinned so a change to
    // that constant fails here instead of quietly changing every proposal.
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, protein: 20, netCarbs: 8, fiber: 4, fatG: 30 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.ok(!day.emphasis.includes('protein'), `expected no protein emphasis, got ${day.emphasis.join(', ')}`);
  });
});

describe('computeRemainingDay, an empty day', () => {
  it('leaves every target fully open', () => {
    const day = computeRemainingDay({
      totals: totals(),
      goals: profile(),
      slot: 'breakfast',
      slotsLeft: 3,
    });

    assert.equal(row(day.kcal).remaining, 2000);
    assert.equal(row(day.kcal).target, 2000);
    assert.equal(row(day.netCarbs).remaining, 50);
    assert.equal(day.protein.remaining, 120);
    assert.equal(day.fiber.remaining, DEFAULT_FIBER_REFERENCE_G);
    // 2000 - 4*50 - 4*120 = 1320 kcal of fat, 146.67 g, rounded to whole grams.
    assert.equal(row(day.fat).remaining, 147);
    assert.equal(row(day.fat).source, 'derived');

    // The control: one bite makes the same assertions false, so "remaining
    // equals target" is a claim about an untouched day and not about the shape.
    const eaten = computeRemainingDay({
      totals: totals({ kcal: 300, netCarbs: 12, protein: 25, fiber: 3, fatG: 9 }),
      goals: profile(),
      slot: 'breakfast',
      slotsLeft: 3,
    });
    assert.notEqual(row(eaten.kcal).remaining, row(eaten.kcal).target);
    assert.notEqual(eaten.protein.remaining, eaten.protein.target);
  });

  it('asks for nothing in particular: every floor is exactly as open as the day', () => {
    const day = computeRemainingDay({
      totals: totals(),
      goals: profile(),
      slot: 'breakfast',
      slotsLeft: 3,
    });

    // No nutrient is behind: each is 100 percent open, and so is the energy, so
    // no lead exists for any rule to fire on.
    assert.deepEqual(day.emphasis, ['balanced']);
  });

  it('divides what is left by the slots left', () => {
    const three = computeRemainingDay({ totals: totals(), goals: profile(), slot: 'breakfast', slotsLeft: 3 });
    const one = computeRemainingDay({ totals: totals(), goals: profile(), slot: 'dinner', slotsLeft: 1 });
    const none = computeRemainingDay({ totals: totals(), goals: profile(), slot: 'snack', slotsLeft: 0 });

    assert.ok(Math.abs(three.share - 1 / 3) < 1e-9);
    assert.equal(one.share, 1);
    // Clamped, so a caller that counted no slots left still gets a whole meal
    // rather than a division by zero.
    assert.equal(none.share, 1);
  });
});

describe('computeRemainingDay, over the kcal target', () => {
  it('reports nothing left and asks for something light', () => {
    const day = computeRemainingDay({
      totals: totals({ kcal: 2100, netCarbs: 30, protein: 60, fiber: 10, fatG: 80 }),
      goals: profile(),
      slot: 'dinner',
      slotsLeft: 1,
    });

    assert.equal(row(day.kcal).remaining, 0);
    assert.equal(row(day.kcal).consumed, 2100);
    assert.ok(day.emphasis.includes('light'), `expected a light emphasis, got ${day.emphasis.join(', ')}`);
  });

  it('does not ask for something light while the day still has energy left', () => {
    // The control. The same day at half the calories keeps more than
    // `LIGHT_EMPHASIS_MAX_REMAINING_FRACTION` of the target open.
    const day = computeRemainingDay({
      totals: totals({ kcal: 1000, netCarbs: 30, protein: 60, fiber: 10, fatG: 80 }),
      goals: profile(),
      slot: 'dinner',
      slotsLeft: 1,
    });

    assert.ok(row(day.kcal).remaining / row(day.kcal).target > LIGHT_EMPHASIS_MAX_REMAINING_FRACTION);
    assert.ok(!day.emphasis.includes('light'), `expected no light emphasis, got ${day.emphasis.join(', ')}`);
  });
});

describe('computeRemainingDay, a person with no goals', () => {
  it('has no calorie, carb or fat target, and the two default floors', () => {
    const day = computeRemainingDay({
      totals: totals({ kcal: 500, netCarbs: 20, protein: 15, fiber: 5, fatG: 12 }),
      goals: null,
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.equal(day.kcal, null);
    assert.equal(day.netCarbs, null);
    assert.equal(day.fat, null);
    assert.equal(day.protein.target, DEFAULT_PROTEIN_FLOOR_G);
    assert.equal(day.protein.source, 'default');
    assert.equal(day.protein.remaining, DEFAULT_PROTEIN_FLOOR_G - 15);
    assert.equal(day.fiber.target, DEFAULT_FIBER_REFERENCE_G);
    assert.equal(day.fiber.source, 'default');
    assert.equal(day.lens, 'none');

    // The control: the same day for somebody who set the three numbers gets all
    // three targets and a personal protein floor, so the nulls above are about
    // the missing profile and not about the module.
    const withGoals = computeRemainingDay({
      totals: totals({ kcal: 500, netCarbs: 20, protein: 15, fiber: 5, fatG: 12 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });
    assert.equal(row(withGoals.kcal).target, 2000);
    assert.equal(row(withGoals.netCarbs).target, 50);
    assert.equal(row(withGoals.fat).target, 147);
    assert.equal(withGoals.protein.target, 120);
    assert.equal(withGoals.protein.source, 'goal');
    assert.notEqual(withGoals.lens, 'none');
  });

  it('never reports a negative remaining', () => {
    const day = computeRemainingDay({
      totals: totals({ kcal: 9000, netCarbs: 400, protein: 300, fiber: 90, fatG: 400 }),
      goals: profile(),
      slot: 'dinner',
      slotsLeft: 1,
    });

    assert.equal(row(day.kcal).remaining, 0);
    assert.equal(row(day.netCarbs).remaining, 0);
    assert.equal(day.protein.remaining, 0);
    assert.equal(day.fiber.remaining, 0);
    assert.equal(row(day.fat).remaining, 0);
  });
});

describe('computeRemainingDay, the low-carb rule', () => {
  /** 600 kcal of a 2000 kcal day, so nothing here can be explained by the energy. */
  const DAY_KCAL = 600;

  it('asks the next meal to lean low carb once the ceiling is nearly spent', () => {
    // 35 g of a 50 g ceiling eaten, so 30 percent of it is left, inside
    // `LOW_CARB_EMPHASIS_MAX_REMAINING_FRACTION`. The profile sets a ceiling
    // and a calorie target, which is the carb lens.
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, netCarbs: 35, protein: 100, fiber: 20, fatG: 30 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.equal(day.lens, 'carb', 'this case only means something under the carb lens');
    assert.ok(
      row(day.netCarbs).remaining / row(day.netCarbs).target < LOW_CARB_EMPHASIS_MAX_REMAINING_FRACTION,
      'the headroom must be inside the threshold for this case to mean anything',
    );
    assert.ok(day.emphasis.includes('lowCarb'), `expected a lowCarb emphasis, got ${day.emphasis.join(', ')}`);
  });

  it('does not, on the same day with half the ceiling still open', () => {
    // THE CONTROL. Identical day, 25 g of carbs instead of 35 g, so 50 percent
    // is left and only the carb figure can explain the different answer.
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, netCarbs: 25, protein: 100, fiber: 20, fatG: 30 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.ok(!day.emphasis.includes('lowCarb'), `expected no lowCarb emphasis, got ${day.emphasis.join(', ')}`);
  });

  it('never asks for it without a ceiling to be low against', () => {
    // The second control: the same carb intake for somebody who set no ceiling
    // has no fraction to compare, so the rule cannot fire at all.
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, netCarbs: 35, protein: 100, fiber: 20, fatG: 30 }),
      goals: null,
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.equal(day.netCarbs, null);
    assert.ok(!day.emphasis.includes('lowCarb'));
  });
});

describe('computeRemainingDay, the fibre rule', () => {
  /** 600 kcal of a 2000 kcal day: 70 percent of the energy is still open. */
  const DAY_KCAL = 600;

  it('asks the next meal to lean on fibre when the floor is behind the day', () => {
    // No fibre eaten at all, so 100 percent of the reference is open against 70
    // percent of the energy: a lead of 30 points, past
    // `BEHIND_THE_DAY_MIN_FRACTION_LEAD`.
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, netCarbs: 8, protein: 100, fiber: 0, fatG: 30 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.equal(day.fiber.remaining, DEFAULT_FIBER_REFERENCE_G);
    assert.ok(day.emphasis.includes('fiber'), `expected a fiber emphasis, got ${day.emphasis.join(', ')}`);
  });

  it('does not, on the same day eaten AHEAD on fibre', () => {
    // THE CONTROL. Identical day, 20 g of the 25 g reference already eaten, so
    // a fifth of the floor is open against seven tenths of the energy and the
    // floor is ahead rather than behind.
    const day = computeRemainingDay({
      totals: totals({ kcal: DAY_KCAL, netCarbs: 8, protein: 100, fiber: 20, fatG: 30 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    assert.ok(
      day.fiber.remaining / day.fiber.target < row(day.kcal).remaining / row(day.kcal).target,
      'the floor must be ahead of the energy pace for this control to mean anything',
    );
    assert.ok(!day.emphasis.includes('fiber'), `expected no fiber emphasis, got ${day.emphasis.join(', ')}`);
  });
});

describe('describeRemainingDayForPrompt', () => {
  const day = computeRemainingDay({
    totals: totals({ kcal: 600, netCarbs: 8, protein: 100, fiber: 4, fatG: 30 }),
    goals: profile(),
    slot: 'lunch',
    slotsLeft: 2,
  });
  const block = describeRemainingDayForPrompt(day, 'de');

  it('names every nutrient, the slot, the share and the answer language', () => {
    for (const word of ['Calories', 'Net carbs', 'Protein', 'Fat', 'Fiber']) {
      assert.ok(block.includes(word), `expected the block to name ${word}`);
    }
    assert.ok(block.includes('lunch'), 'expected the block to name the slot');
    assert.ok(block.includes('50%'), 'expected the block to carry the share');
    assert.ok(block.includes('de'), 'expected the block to carry the answer language code');

    // The control: a code the caller did not ask for must not appear, so the
    // assertion above is about the argument and not about a word that is always
    // there.
    assert.ok(!describeRemainingDayForPrompt(day, 'de').includes('code: fr'));
    assert.ok(describeRemainingDayForPrompt(day, 'fr').includes('code: fr'));
  });

  it('writes whole units, not raw decimals', () => {
    const uneven = computeRemainingDay({
      totals: totals({ kcal: 601.4, netCarbs: 8.27, protein: 100.6, fiber: 4.45, fatG: 30.2 }),
      goals: profile(),
      slot: 'lunch',
      slotsLeft: 2,
    });

    const unevenBlock = describeRemainingDayForPrompt(uneven, 'en');
    assert.doesNotMatch(unevenBlock, /\d\.\d/, `expected no decimal figure in ${unevenBlock}`);
    // The control: the same figures unrounded do carry a decimal point, so the
    // assertion above is about the formatting and not about the numbers.
    assert.ok(String(uneven.protein.consumed).includes('.'));
  });

  it('says plainly when a nutrient has no target', () => {
    const noGoals = computeRemainingDay({
      totals: totals({ kcal: 500, protein: 15 }),
      goals: null,
      slot: 'dinner',
      slotsLeft: 1,
    });

    const noGoalsBlock = describeRemainingDayForPrompt(noGoals, 'en');
    assert.ok(noGoalsBlock.includes('Calories: no target'));
    assert.ok(noGoalsBlock.includes('Fat: no target'));
    // The control: the goal-bearing day never says it.
    assert.ok(!block.includes('Calories: no target'));
  });
});

describe('deriveFatTargetG', () => {
  it('spends what the other two targets leave of the energy budget', () => {
    // 2000 - 4*50 - 4*120 = 1320 kcal for fat, 1320 / 9 = 146.67 g, rounded to
    // whole grams the way the budget row rounds it.
    assert.equal(deriveFatTargetG({ kcalTarget: 2000, netCarbsCeilingG: 50, proteinFloorG: 120 }), 147);
  });

  it('answers null when any one of the three is missing', () => {
    assert.equal(deriveFatTargetG({ kcalTarget: null, netCarbsCeilingG: 50, proteinFloorG: 120 }), null);
    assert.equal(deriveFatTargetG({ kcalTarget: 2000, netCarbsCeilingG: null, proteinFloorG: 120 }), null);
    assert.equal(deriveFatTargetG({ kcalTarget: 2000, netCarbsCeilingG: 50, proteinFloorG: null }), null);
  });

  it('answers null when the remainder is too small to be a budget', () => {
    // 700 - 4*30 - 4*130 = 60 kcal, under seven grams of fat.
    assert.equal(deriveFatTargetG({ kcalTarget: 700, netCarbsCeilingG: 30, proteinFloorG: 130 }), null);
    // The control: one more hundred kilocalories clears the floor, so the null
    // above is about the size of the remainder and not about these inputs.
    assert.equal(deriveFatTargetG({ kcalTarget: 800, netCarbsCeilingG: 30, proteinFloorG: 130 }), 18);
  });
});
