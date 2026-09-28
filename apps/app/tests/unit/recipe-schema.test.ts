/**
 * The recipe wire schema (M233/04).
 *
 * The COUNT is the part worth pinning. One recipe is not a choice and four is
 * a list nobody reads on a phone, and the bound cannot be enforced by the
 * provider: strict structured output accepts neither `minItems` nor
 * `maxItems`, so this schema is the only thing standing between a model that
 * answered with one recipe and a screen that renders it as if it had offered
 * a decision. The JSON Schema is asserted to be free of those keywords for the
 * same reason, since a bounded one would be rejected before the model saw it.
 *
 * The rejections are paired with an acceptance of three, so "the schema says
 * no" can never pass against a schema that says no to everything.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECIPE_PROPOSALS_JSON_SCHEMA,
  RecipeProposalsSchema,
  parseRecipeProposalsJson,
  validateRecipeProposals,
} from '../../app/services/vision/recipe-schema';

/**
 * One ingredient as a FIXTURE holds it: the two nullable fields widened on
 * purpose, so a test can build the malformed shapes this suite exists to
 * prove the schema refuses.
 *
 * A type alias and not an interface, because an interface has no implicit
 * index signature and a fixture has to be assignable to the parser's own
 * JSON value type.
 */
type FixtureIngredient = {
  name: string;
  amount: number | null;
  unit: string | null;
  fromPantry: boolean;
};

/** One well-formed recipe, varied only by its title so a list of them is distinguishable. */
function recipe(title: string) {
  const ingredients: FixtureIngredient[] = [
    { name: 'Eggs', amount: 3, unit: 'piece', fromPantry: true },
    { name: 'Olive oil', amount: 1, unit: 'tbsp', fromPantry: false },
    { name: 'Salt', amount: null, unit: null, fromPantry: false },
  ];
  return {
    title,
    servings: 2,
    servingGrams: 350,
    ingredients,
    steps: ['Beat the eggs.', 'Cook them.'],
    perServing: { kcal: 320, proteinG: 22, carbsG: 4, fiberG: 2, fatG: 24 },
    whyItFits: 'High in protein, which is what is still open today.',
    prepMinutes: 10,
  };
}

function proposals(count: number) {
  return { recipes: Array.from({ length: count }, (_value, index) => recipe(`Recipe ${index + 1}`)) };
}

describe('RecipeProposalsSchema, the count', () => {
  it('accepts three recipes', () => {
    const parsed = validateRecipeProposals(proposals(3));
    assert.equal(parsed.recipes.length, 3);
    assert.equal(parsed.recipes[0].title, 'Recipe 1');
  });

  it('accepts two, the smallest real choice', () => {
    assert.equal(validateRecipeProposals(proposals(2)).recipes.length, 2);
  });

  it('rejects one recipe', () => {
    assert.equal(RecipeProposalsSchema.safeParse(proposals(1)).success, false);
    assert.throws(() => validateRecipeProposals(proposals(1)), /recipe shape/);
  });

  it('rejects four recipes', () => {
    assert.equal(RecipeProposalsSchema.safeParse(proposals(4)).success, false);
    assert.throws(() => validateRecipeProposals(proposals(4)), /recipe shape/);
  });
});

describe('RecipeProposalsSchema, the fields', () => {
  it('rejects a serving with a missing macro', () => {
    const missing = proposals(2);
    // SAFETY: a deliberately malformed fixture, built to prove the schema
    // refuses a serving the card could not render.
    delete (missing.recipes[0].perServing as { fiberG?: number }).fiberG;
    assert.equal(RecipeProposalsSchema.safeParse(missing).success, false);
  });

  it('rejects a recipe with no serving weight', () => {
    const weightless = proposals(2);
    // SAFETY: a deliberately malformed fixture. The weight is the base every
    // macro on the card is computed from, so an answer without one must not
    // reach a screen (M233/06).
    delete (weightless.recipes[0] as { servingGrams?: number }).servingGrams;
    assert.equal(RecipeProposalsSchema.safeParse(weightless).success, false);
    // The control: the same two proposals WITH the weight parse, so the
    // rejection is about the missing field.
    assert.equal(validateRecipeProposals(proposals(2)).recipes[0].servingGrams, 350);
  });

  it('drops a unit that has no amount', () => {
    const stray = proposals(2);
    stray.recipes[0].ingredients[0] = { name: 'Butter', amount: null, unit: 'g', fromPantry: true };
    const parsed = validateRecipeProposals(stray);
    assert.equal(parsed.recipes[0].ingredients[0].unit, null);
  });

  it('reads a markdown-fenced answer', () => {
    const parsed = parseRecipeProposalsJson(`\`\`\`json\n${JSON.stringify(proposals(2))}\n\`\`\``);
    assert.equal(parsed.recipes.length, 2);
  });
});

describe('RECIPE_PROPOSALS_JSON_SCHEMA', () => {
  it('carries no count bound, which strict structured output would reject', () => {
    const asText = JSON.stringify(RECIPE_PROPOSALS_JSON_SCHEMA);
    assert.ok(!asText.includes('minItems'), 'minItems would be rejected by strict mode');
    assert.ok(!asText.includes('maxItems'), 'maxItems would be rejected by strict mode');
    // The control for the two assertions above: the schema really does
    // describe the recipes array, so their silence is about the keywords.
    assert.ok(asText.includes('whyItFits'));
  });

  it('requires every field of every object, as strict mode demands', () => {
    const recipes = RECIPE_PROPOSALS_JSON_SCHEMA.properties?.recipes;
    const item = recipes?.items;
    assert.deepEqual(item?.required, [
      'title',
      'servings',
      'servingGrams',
      'ingredients',
      'steps',
      'perServing',
      'whyItFits',
      'prepMinutes',
    ]);
    assert.equal(item?.additionalProperties, false);
  });
});
