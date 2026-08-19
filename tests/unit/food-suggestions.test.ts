/**
 * Unit tests for `#app/lib/food-suggestions` — the deterministic ranking
 * behind the drill-down's "what could close this gap?" section (M129/06).
 *
 * Driven entirely off the fixture below rather than the bundled dataset: the
 * ranking rules are what's under test, and pinning them to real catalog
 * numbers would make this file fail every time the dataset is refreshed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SuggestionFood } from '../../app/data/suggestion-foods';
import { describeSuggestion, rankFoodSuggestions } from '../../app/lib/food-suggestions';
import type { Translate } from '../../app/lib/macro-gaps';
import { formatMacroNumber } from '../../app/lib/format-macro-number';
import i18next from '../../app/i18n/i18n';

/** The REAL catalog — the suggestion reason line is copy, so it is asserted in the language it ships in. */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

function food(overrides: Partial<SuggestionFood> & Pick<SuggestionFood, 'slug'>): SuggestionFood {
  return {
    name: overrides.slug,
    category: 'meat-fish',
    servingGrams: 100,
    per100g: { kcal: 100, protein: 20, fat: 2, carbs: 0, fiber: 0, netCarbs: 0 },
    url: null,
    attribution: null,
    ...overrides,
  };
}

const CHICKEN = food({ slug: 'chicken-breast', name: 'Chicken breast', category: 'meat-fish' });
const SALMON = food({
  slug: 'salmon',
  name: 'Salmon',
  category: 'meat-fish',
  servingGrams: 120,
  per100g: { kcal: 208, protein: 20, fat: 13, carbs: 0, fiber: 0, netCarbs: 0 },
});
const GREEK_YOGURT = food({
  slug: 'greek-yogurt',
  name: 'Greek yogurt',
  category: 'eggs-dairy',
  servingGrams: 170,
  per100g: { kcal: 59, protein: 10, fat: 0.4, carbs: 3.6, fiber: 0, netCarbs: 3.6 },
});
const ALMONDS = food({
  slug: 'almonds',
  name: 'Almonds',
  category: 'nuts-seeds',
  servingGrams: 28,
  per100g: { kcal: 579, protein: 21, fat: 50, carbs: 22, fiber: 12.5, netCarbs: 9.5 },
});
const CHIA = food({
  slug: 'chia-seeds',
  name: 'Chia seeds',
  category: 'nuts-seeds',
  servingGrams: 28,
  per100g: { kcal: 486, protein: 17, fat: 31, carbs: 42, fiber: 34, netCarbs: 8 },
});
const BROCCOLI = food({
  slug: 'broccoli',
  name: 'Broccoli',
  category: 'vegetables',
  servingGrams: 90,
  per100g: { kcal: 34, protein: 2.8, fat: 0.4, carbs: 7, fiber: 2.6, netCarbs: 4.4 },
});
const TEA = food({
  slug: 'black-tea',
  name: 'Black tea',
  category: 'fruit',
  servingGrams: 240,
  per100g: { kcal: 1, protein: 0.1, fat: 0, carbs: 0.3, fiber: 0, netCarbs: 0.3 },
});

const POOL = [CHICKEN, SALMON, GREEK_YOGURT, ALMONDS, CHIA, BROCCOLI, TEA];

describe('rankFoodSuggestions — fail-open guards', () => {
  it('returns nothing when there is no gap to close', () => {
    assert.deepEqual(
      rankFoodSuggestions({ foods: POOL, nutrient: 'protein', remainingG: 0, carbHeadroomG: 30, limit: 4 }),
      [],
    );
  });

  it('returns nothing when the candidate pool is empty — never throws', () => {
    assert.deepEqual(
      rankFoodSuggestions({ foods: [], nutrient: 'protein', remainingG: 50, carbHeadroomG: 30, limit: 4 }),
      [],
    );
  });

  it('returns nothing when asked for zero suggestions', () => {
    assert.deepEqual(
      rankFoodSuggestions({ foods: POOL, nutrient: 'protein', remainingG: 50, carbHeadroomG: 30, limit: 0 }),
      [],
    );
  });

  it('skips a candidate with a nonsensical serving size instead of dividing by it', () => {
    const broken = food({ slug: 'broken', servingGrams: 0 });
    const result = rankFoodSuggestions({
      foods: [broken],
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 4,
    });
    assert.deepEqual(result, []);
  });
});

describe('rankFoodSuggestions — the headroom filter', () => {
  it('drops anything whose serving would blow the remaining headroom', () => {
    const slugs = new Set(rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 1,
      limit: 5,
    }).map((suggestion) => suggestion.food.slug));
    // Greek yogurt costs 6.1 g net carbs per serving — no room for it at 1 g.
    assert.equal(slugs.has('greek-yogurt'), false);
    assert.equal(slugs.has('chicken-breast'), true);
  });

  it('still offers the zero-carb options on a day with no headroom left', () => {
    const result = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 0,
      limit: 5,
    });
    assert.ok(result.length > 0);
    assert.ok(result.every((suggestion) => suggestion.netCarbsG <= 0.5));
  });

  it('treats a day past its ceiling as zero headroom, never a negative budget', () => {
    const overGoal = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: -20,
      limit: 5,
    });
    const atZero = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 0,
      limit: 5,
    });
    assert.deepEqual(
      overGoal.map((suggestion) => suggestion.food.slug),
      atZero.map((suggestion) => suggestion.food.slug),
    );
  });

  it('applies no headroom filter at all when the user has no carb ceiling', () => {
    const slugs = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: null,
      limit: 7,
    }).map((suggestion) => suggestion.food.slug);
    assert.equal(slugs.includes('greek-yogurt'), true);
  });
});

describe('rankFoodSuggestions — ranking', () => {
  it('drops candidates that barely move the needle', () => {
    const slugs = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 7,
    }).map((suggestion) => suggestion.food.slug);
    // Tea carries 0.24 g of protein per serving — technically a source, not an answer.
    assert.equal(slugs.includes('black-tea'), false);
  });

  it('prefers the cheaper carb cost when two foods close the same amount of gap', () => {
    const result = rankFoodSuggestions({
      foods: [CHICKEN, GREEK_YOGURT],
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 2,
    });
    assert.equal(result[0].food.slug, 'chicken-breast');
  });

  it('ranks by the gap nutrient asked for, not always protein', () => {
    const result = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'fiber',
      remainingG: 20,
      carbHeadroomG: 30,
      limit: 3,
    });
    assert.equal(result[0].food.slug, 'chia-seeds');
    assert.ok(result.every((suggestion) => suggestion.gainG > 0));
  });

  it('quotes gain, cost and calories for the food’s own serving size', () => {
    const [almonds] = rankFoodSuggestions({
      foods: [ALMONDS],
      nutrient: 'fiber',
      remainingG: 20,
      carbHeadroomG: 30,
      limit: 1,
    });
    assert.equal(almonds.servingGrams, 28);
    assert.equal(Math.round(almonds.gainG * 10) / 10, 3.5);
    assert.equal(Math.round(almonds.netCarbsG * 10) / 10, 2.7);
    assert.equal(Math.round(almonds.kcal), 162);
  });

  it('does not reward overshooting a nearly-closed gap', () => {
    // Only 4 g of protein left: both foods close it completely, so the one
    // that costs fewer carbs must win regardless of how much protein it piles on.
    const result = rankFoodSuggestions({
      foods: [SALMON, GREEK_YOGURT],
      nutrient: 'protein',
      remainingG: 4,
      carbHeadroomG: 30,
      limit: 2,
    });
    assert.equal(result[0].food.slug, 'salmon');
  });

  it('is deterministic — input order never changes the output', () => {
    const forward = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 5,
    });
    const reversed = rankFoodSuggestions({
      foods: POOL.toReversed(),
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 5,
    });
    assert.deepEqual(
      forward.map((suggestion) => suggestion.food.slug),
      reversed.map((suggestion) => suggestion.food.slug),
    );
  });
});

describe('rankFoodSuggestions — category diversity', () => {
  it('takes at most two from one category while other categories are available', () => {
    const chickenThigh = food({ slug: 'chicken-thigh', name: 'Chicken thigh', category: 'meat-fish' });
    const turkey = food({ slug: 'turkey-breast', name: 'Turkey breast', category: 'meat-fish' });
    const result = rankFoodSuggestions({
      foods: [CHICKEN, SALMON, chickenThigh, turkey, GREEK_YOGURT, CHIA],
      nutrient: 'protein',
      remainingG: 60,
      carbHeadroomG: 30,
      limit: 4,
    });
    const meatCount = result.filter((suggestion) => suggestion.food.category === 'meat-fish').length;
    assert.equal(meatCount, 2);
    assert.equal(result.length, 4);
  });

  it('relaxes the category cap rather than returning a short list', () => {
    const chickenThigh = food({ slug: 'chicken-thigh', name: 'Chicken thigh', category: 'meat-fish' });
    const turkey = food({ slug: 'turkey-breast', name: 'Turkey breast', category: 'meat-fish' });
    const result = rankFoodSuggestions({
      foods: [CHICKEN, SALMON, chickenThigh, turkey],
      nutrient: 'protein',
      remainingG: 60,
      carbHeadroomG: 30,
      limit: 4,
    });
    assert.equal(result.length, 4);
  });

  it('never returns more than the requested limit', () => {
    const result = rankFoodSuggestions({
      foods: POOL,
      nutrient: 'protein',
      remainingG: 60,
      carbHeadroomG: 30,
      limit: 3,
    });
    assert.equal(result.length, 3);
  });
});

describe('describeSuggestion', () => {
  it('names the gain and the carb cost in the gap nutrient’s own terms', () => {
    const [chicken] = rankFoodSuggestions({
      foods: [CHICKEN],
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 1,
    });
    assert.equal(describeSuggestion(chicken, 'protein', formatMacroNumber, t), '+20 g protein · 0 g net carbs');
  });

  it('never renders a NaN or an undefined into the reason line', () => {
    const [chia] = rankFoodSuggestions({
      foods: [CHIA],
      nutrient: 'fiber',
      remainingG: 20,
      carbHeadroomG: null,
      limit: 1,
    });
    assert.doesNotMatch(describeSuggestion(chia, 'fiber', formatMacroNumber, t), /NaN|undefined|Infinity/);
  });
});
