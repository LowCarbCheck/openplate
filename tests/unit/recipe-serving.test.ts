/**
 * The serving rule (M233/06): what one recipe serving weighs, which weights
 * are shown at all, and how many servings a person may say they ate.
 *
 * WHAT THIS EXISTS TO CATCH. The weight is the base every macro on the card
 * and every figure in the stored log is computed from, so a wrong one is not a
 * cosmetic problem: it is a diary entry that rescales wrongly the first time
 * somebody edits it. The range is therefore asserted AT ITS BOUNDS, with the
 * first value outside each of them, because an off-by-one there silently
 * changes which recipes a person is offered.
 *
 * Every assertion is paired with a control that goes red on its own: the drops
 * with a keep, the bounds with the values one step past them, and the round
 * trip with a wrong serving weight that misses.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECIPE_SERVING_MAX_GRAMS,
  RECIPE_SERVING_MIN_GRAMS,
  RECIPE_SERVINGS_MAX,
  RECIPE_SERVINGS_MIN,
  SERVINGS_STEP,
  keepServableRecipes,
  macrosPer100gFromServing,
  roundServingGramsForDisplay,
  servingsEatenOptions,
} from '../../app/lib/recipe-serving';
import type { RecipePerServing, RecipeProposal } from '../../app/services/vision/recipe-schema';

const PER_SERVING: RecipePerServing = { kcal: 320, proteinG: 22, carbsG: 4, fiberG: 2, fatG: 24 };

/** One well-formed proposal, varied only by the two fields these tests read. */
function recipe(title: string, servingGrams: number, servings = 2): RecipeProposal {
  return {
    title,
    servings,
    servingGrams,
    ingredients: [{ name: 'Eggs', amount: 3, unit: 'piece', fromPantry: true }],
    steps: ['Beat the eggs.', 'Cook them.'],
    perServing: PER_SERVING,
    whyItFits: 'High in protein, which is what is still open today.',
    prepMinutes: 10,
  };
}

/** The titles that survived, which is what the screen would render. */
function survivors(...recipes: RecipeProposal[]): string[] {
  return keepServableRecipes(recipes).map((kept) => kept.title);
}

describe('keepServableRecipes', () => {
  it('keeps a plausible plate and drops the ones nobody could have estimated', () => {
    const kept = recipe('Omelette', 350);
    const tiny = recipe('Garnish', 29);
    const pot = recipe('The whole pot', 1501);

    assert.deepEqual(survivors(kept, tiny, pot), ['Omelette']);
    // THE CONTROL. The two that were dropped are dropped for their weight and
    // not because this filter refuses everything: each survives on its own
    // once the weight is moved inside the range.
    assert.deepEqual(survivors(recipe('Garnish', 30), recipe('The whole pot', 1500)), ['Garnish', 'The whole pot']);
  });

  it('treats both bounds as inside, and the first value past each as outside', () => {
    assert.deepEqual(survivors(recipe('Min', RECIPE_SERVING_MIN_GRAMS)), ['Min']);
    assert.deepEqual(survivors(recipe('Max', RECIPE_SERVING_MAX_GRAMS)), ['Max']);
    // The control for the two above: one gram further out and both are gone,
    // so "the bound is inside" is a claim about the bound.
    assert.deepEqual(survivors(recipe('Under', RECIPE_SERVING_MIN_GRAMS - 1)), []);
    assert.deepEqual(survivors(recipe('Over', RECIPE_SERVING_MAX_GRAMS + 1)), []);
  });

  it('drops a weight that is not a finite number', () => {
    assert.deepEqual(survivors(recipe('NaN', Number.NaN), recipe('Infinite', Number.POSITIVE_INFINITY)), []);
    // The control: the same two titles with real weights are kept, so the
    // rejection is about the value rather than about the fixtures.
    assert.deepEqual(survivors(recipe('NaN', 400), recipe('Infinite', 400)), ['NaN', 'Infinite']);
  });

  it('drops a serving COUNT nobody could divide a dish into', () => {
    // The count is what the stepper is built out of: zero empties it, a
    // fraction is a recipe the model did not think through, and thirteen is
    // catering. All three weigh a perfectly plausible 350 g, so only the count
    // can explain the drop.
    assert.deepEqual(survivors(recipe('None', 350, 0), recipe('Many', 350, 13), recipe('Half', 350, 2.5)), []);
  });

  it('keeps both ends of the serving range, which is the control', () => {
    // Without this the case above passes against a filter that refuses every
    // count, and the screen would say it could not build a meal every time.
    assert.deepEqual(survivors(recipe('One', 350, RECIPE_SERVINGS_MIN)), ['One']);
    assert.deepEqual(survivors(recipe('Twelve', 350, RECIPE_SERVINGS_MAX)), ['Twelve']);
    // And one step past each bound is out, so "the bound is inside" is a claim
    // about the bound.
    assert.deepEqual(survivors(recipe('Under', 350, RECIPE_SERVINGS_MIN - 1)), []);
    assert.deepEqual(survivors(recipe('Over', 350, RECIPE_SERVINGS_MAX + 1)), []);
  });

  it('keeps the order the model answered in', () => {
    assert.deepEqual(survivors(recipe('First', 300), recipe('Dropped', 9000), recipe('Third', 500)), [
      'First',
      'Third',
    ]);
  });
});

describe('servingsEatenOptions', () => {
  it('offers half and whole for a recipe that makes one serving', () => {
    assert.deepEqual(servingsEatenOptions(1), [0.5, 1]);
  });

  it('climbs in half steps to the whole recipe', () => {
    // THE CONTROL for the case above: three servings answer differently, so
    // the ladder is built from `servings` rather than being a constant.
    assert.deepEqual(servingsEatenOptions(3), [0.5, 1, 1.5, 2, 2.5, 3]);
    assert.equal(servingsEatenOptions(3)[1] - servingsEatenOptions(3)[0], SERVINGS_STEP);
  });

  it('falls back to the single-serving ladder rather than an empty stepper', () => {
    assert.deepEqual(servingsEatenOptions(0), [0.5, 1]);
    assert.deepEqual(servingsEatenOptions(Number.NaN), [0.5, 1]);
  });
});

describe('macrosPer100gFromServing', () => {
  it('round trips: the per 100 g basis scaled back to the serving is the serving again', () => {
    const servingGrams = 350;
    const per100g = macrosPer100gFromServing(PER_SERVING, servingGrams);
    const back = (value: number | null): number => ((value ?? 0) * servingGrams) / 100;

    assert.ok(Math.abs(back(per100g.kcal) - PER_SERVING.kcal) < 0.5);
    assert.ok(Math.abs(back(per100g.protein) - PER_SERVING.proteinG) < 0.5);
    assert.ok(Math.abs(back(per100g.fat) - PER_SERVING.fatG) < 0.5);
    assert.ok(Math.abs(back(per100g.fiber) - PER_SERVING.fiberG) < 0.5);
    // The stored carbs are the printed-panel TOTAL, so net plus fibre is what
    // comes back, which is what every reader's fallback subtracts again.
    assert.ok(Math.abs(back(per100g.carbs) - (PER_SERVING.carbsG + PER_SERVING.fiberG)) < 0.5);

    // THE CONTROL. Scaled back against a DIFFERENT serving weight, the round
    // trip misses by far more than the tolerance, so the assertions above are
    // about the conversion rather than about a tolerance wide enough to
    // swallow anything.
    const wrongWeight = 200;
    const missed = ((per100g.kcal ?? 0) * wrongWeight) / 100;
    assert.ok(Math.abs(missed - PER_SERVING.kcal) >= 0.5);
  });

  it('rounds each field to one decimal and never fabricates the unknowns', () => {
    const per100g = macrosPer100gFromServing(PER_SERVING, 350);
    for (const value of [per100g.kcal, per100g.protein, per100g.fat, per100g.carbs, per100g.fiber]) {
      assert.equal(value, Math.round((value ?? 0) * 10) / 10);
    }
    assert.equal(per100g.sugars, null);
    assert.equal(per100g.polyols, null);
    // The control for the rounding claim: 320 kcal over 350 g is 91.428..., so
    // an unrounded conversion would fail the loop above.
    assert.equal(per100g.kcal, 91.4);
  });
});

describe('roundServingGramsForDisplay', () => {
  it('rounds to the nearest 10, because an estimate is not a measurement', () => {
    assert.equal(roundServingGramsForDisplay(347), 350);
    assert.equal(roundServingGramsForDisplay(344), 340);
    // The control: a figure already on a ten is left alone, so the rounding is
    // not a constant.
    assert.equal(roundServingGramsForDisplay(350), 350);
  });
});
