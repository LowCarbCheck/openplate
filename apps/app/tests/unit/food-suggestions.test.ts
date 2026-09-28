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
import { describeSuggestion, hashDateKey, normaliseFoodName, rankFoodSuggestions } from '../../app/lib/food-suggestions';
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

/** One fixed day for every test that is not about the day itself. */
const DAY = '2026-03-04';

describe('rankFoodSuggestions — fail-open guards', () => {
  it('returns nothing when there is no gap to close', () => {
    assert.deepEqual(
      rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [], foods: POOL, nutrient: 'protein', remainingG: 0, carbHeadroomG: 30, limit: 4 }),
      [],
    );
  });

  it('returns nothing when the candidate pool is empty — never throws', () => {
    assert.deepEqual(
      rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [], foods: [], nutrient: 'protein', remainingG: 50, carbHeadroomG: 30, limit: 4 }),
      [],
    );
  });

  it('returns nothing when asked for zero suggestions', () => {
    assert.deepEqual(
      rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [], foods: POOL, nutrient: 'protein', remainingG: 50, carbHeadroomG: 30, limit: 0 }),
      [],
    );
  });

  it('skips a candidate with a nonsensical serving size instead of dividing by it', () => {
    const broken = food({ slug: 'broken', servingGrams: 0 });
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const slugs = new Set(rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const overGoal = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: -20,
      limit: 5,
    });
    const atZero = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const slugs = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const slugs = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
      foods: [CHICKEN, GREEK_YOGURT],
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 2,
    });
    assert.equal(result[0].food.slug, 'chicken-breast');
  });

  it('ranks by the gap nutrient asked for, not always protein', () => {
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const [almonds] = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
      foods: [SALMON, GREEK_YOGURT],
      nutrient: 'protein',
      remainingG: 4,
      carbHeadroomG: 30,
      limit: 2,
    });
    assert.equal(result[0].food.slug, 'salmon');
  });

  it('is deterministic — input order never changes the output', () => {
    const forward = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
      foods: POOL,
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 5,
    });
    const reversed = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
      foods: [CHICKEN, SALMON, chickenThigh, turkey],
      nutrient: 'protein',
      remainingG: 60,
      carbHeadroomG: 30,
      limit: 4,
    });
    assert.equal(result.length, 4);
  });

  it('never returns more than the requested limit', () => {
    const result = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
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
    const [chicken] = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
      foods: [CHICKEN],
      nutrient: 'protein',
      remainingG: 50,
      carbHeadroomG: 30,
      limit: 1,
    });
    assert.equal(describeSuggestion(chicken, 'protein', formatMacroNumber, t), '+20 g protein · 0 g net carbs');
  });

  it('never renders a NaN or an undefined into the reason line', () => {
    const [chia] = rankFoodSuggestions({ dateKey: DAY, loggedFoodNames: [],
      foods: [CHIA],
      nutrient: 'fiber',
      remainingG: 20,
      carbHeadroomG: null,
      limit: 1,
    });
    assert.doesNotMatch(describeSuggestion(chia, 'fiber', formatMacroNumber, t), /NaN|undefined|Infinity/);
  });
});


////////////////////////////////////////////////////////////////////////////////
// The day: rotation, and what the day already contains
////////////////////////////////////////////////////////////////////////////////

/** The four categories the wide pool cycles through, so the category cap never decides a rotation test on its own. */
const ROTATION_CATEGORIES = ['meat-fish', 'eggs-dairy', 'nuts-seeds', 'vegetables'] as const;

/**
 * Twelve interchangeable protein sources: same macros, so nothing but the
 * rotation can reorder them, and three times the display limit of four, so
 * there is genuinely something to rotate through.
 */
const WIDE_POOL: SuggestionFood[] = Array.from({ length: 12 }, (_, index) =>
  food({
    slug: `wide-${String(index).padStart(2, '0')}`,
    name: `Wide food ${index}`,
    category: ROTATION_CATEGORIES[index % ROTATION_CATEGORIES.length],
  }),
);

/** The first four of `WIDE_POOL`, a pool no wider than the display limit, which must not rotate. */
const NARROW_POOL = WIDE_POOL.slice(0, 4);

function slugsFor({
  foods,
  dateKey,
  loggedFoodNames = [],
}: {
  foods: readonly SuggestionFood[];
  dateKey: string;
  loggedFoodNames?: readonly string[];
}): string[] {
  return rankFoodSuggestions({
    foods,
    nutrient: 'protein',
    remainingG: 60,
    carbHeadroomG: 30,
    limit: 4,
    dateKey,
    loggedFoodNames,
  }).map((suggestion) => suggestion.food.slug);
}

describe('normaliseFoodName', () => {
  it('folds case, surrounding space and diacritics to one key', () => {
    assert.equal(normaliseFoodName('  Greek Yogurt '), 'greek yogurt');
    assert.equal(normaliseFoodName('Müsli'), 'musli');
  });

  it('does not collapse two genuinely different names', () => {
    assert.notEqual(normaliseFoodName('Greek yogurt'), normaliseFoodName('Greek yogurt drink'));
  });
});

describe('hashDateKey', () => {
  it('is FNV-1a, pinned, so the rotation offset is reproducible outside this file', () => {
    // FNV-1a/32 of the empty string is the offset basis itself, and of 'a' the
    // basis xor 'a' times the prime. Both are computed independently of the
    // implementation under test.
    assert.equal(hashDateKey(''), 2166136261);
    assert.equal(hashDateKey('a'), 0xe40c292c);
  });

  it('gives two adjacent days two different hashes', () => {
    assert.notEqual(hashDateKey('2026-03-04'), hashDateKey('2026-03-05'));
  });
});

describe('rankFoodSuggestions, the day rotates the list', () => {
  it('returns the same list twice for the same day, stable within a day', () => {
    assert.deepEqual(slugsFor({ foods: WIDE_POOL, dateKey: '2026-03-04' }), slugsFor({ foods: WIDE_POOL, dateKey: '2026-03-04' }));
  });

  it('returns a different list on a different day when the pool is wider than the limit', () => {
    const monday = slugsFor({ foods: WIDE_POOL, dateKey: '2026-03-04' });
    const tuesday = slugsFor({ foods: WIDE_POOL, dateKey: '2026-03-05' });
    assert.equal(monday.length, 4);
    assert.equal(tuesday.length, 4);
    assert.notDeepEqual(monday, tuesday);
  });

  it('shows the same list on any day when the pool is no wider than the limit', () => {
    // The control for the test above: with nothing to rotate through, the day
    // must not shuffle four foods for the sake of shuffling them.
    assert.deepEqual(slugsFor({ foods: NARROW_POOL, dateKey: '2026-03-04' }), slugsFor({ foods: NARROW_POOL, dateKey: '2026-03-05' }));
  });

  it('still respects the category cap on whatever the day rotated to', () => {
    for (const dateKey of ['2026-03-04', '2026-03-05', '2026-03-06', '2026-07-19']) {
      const picked = rankFoodSuggestions({
        foods: WIDE_POOL,
        nutrient: 'protein',
        remainingG: 60,
        carbHeadroomG: 30,
        limit: 4,
        dateKey,
        loggedFoodNames: [],
      });
      const perCategory = new Map<string, number>();
      for (const suggestion of picked) {
        perCategory.set(suggestion.food.category, (perCategory.get(suggestion.food.category) ?? 0) + 1);
      }
      assert.equal(picked.length, 4);
      assert.ok(Math.max(...perCategory.values()) <= 2, `category cap broken on ${dateKey}`);
    }
  });
});

describe('rankFoodSuggestions, what the day already contains', () => {
  it('never suggests a food that was already logged that day', () => {
    const withoutLog = slugsFor({ foods: POOL, dateKey: DAY });
    // The control: the food is in the list to begin with, so its absence below
    // means something.
    assert.equal(withoutLog.includes('greek-yogurt'), true);

    const withLog = slugsFor({ foods: POOL, dateKey: DAY, loggedFoodNames: ['Greek yogurt'] });
    assert.equal(withLog.includes('greek-yogurt'), false);
  });

  it('matches the logged name loosely, case and surrounding space do not save a food', () => {
    const withLog = slugsFor({ foods: POOL, dateKey: DAY, loggedFoodNames: ['  GREEK YOGURT '] });
    assert.equal(withLog.includes('greek-yogurt'), false);
  });

  it('backfills from the wider pool, so an exclusion shortens nothing', () => {
    const untouched = slugsFor({ foods: WIDE_POOL, dateKey: DAY });
    const dropped = WIDE_POOL.find((candidate) => candidate.slug === untouched[0]);
    assert.ok(dropped);

    const excluded = slugsFor({ foods: WIDE_POOL, dateKey: DAY, loggedFoodNames: [dropped.name] });
    assert.equal(excluded.includes(dropped.slug), false);
    assert.equal(excluded.length, 4);
  });
});
