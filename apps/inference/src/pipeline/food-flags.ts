/**
 * Caution flags from the food NAME: allergens and pregnancy categories, by a
 * curated word table. Pure, no I/O, no model call.
 *
 * WHY CODE AND NOT THE MODEL. The prompt and grammar are frozen and measured
 * (`terse-contract.ts`, guarded by `terse-contract-frozen.test.ts`): the model
 * names foods and estimates grams, nothing else. Asking it for flags would be a
 * second, unmeasured task, so the flags come from the name it already gave.
 *
 * WHAT A LOOKUP CAN AND CANNOT SAY. A name can show that a food CONTAINS
 * something ("cheddar cheese" is milk). It can never show that a food LACKS
 * something: a "chicken curry" may hold cream, nuts or mustard that no word in
 * its name reveals. So:
 *  - a hit returns the flags for what the words show, and the caller marks the
 *    item `flagsCoverage: 'partial'`, so a client shows "not fully checked";
 *  - a miss returns `null` and the item gets NO `flags` key at all. A miss
 *    means "not assessed", never "safe". Three empty arrays would be a claim
 *    that somebody looked and found nothing, which this table cannot make.
 *  - `mayContain` is always `[]`: a name carries no trace-contamination
 *    information, and an allergen must never sit in both arrays.
 *
 * WHY THE TABLE IS SMALL. Every entry is a word a reader can defend without a
 * recipe: "brie" is milk, "tahini" is sesame. Words that name a dish rather
 * than an ingredient ("curry", "pie", "dumpling") are left out, because their
 * contents vary too much. The exclusions are the other half of the same
 * discipline: a plant milk is not a milk allergen, an oyster mushroom is not
 * a mollusc, and "peanut butter" is peanuts but not milk.
 *
 * MATCHING. The name and every term are folded the same way: accents removed,
 * lowercase, anything that is not a letter or digit becomes a space. A term is
 * one or more words that must appear as whole, consecutive words; a single
 * trailing `s` on a name word is accepted, so "eggs" matches `egg`. A rule
 * fires when ALL of its `allOf` terms appear (anywhere, in any order) and NONE
 * of its `noneOf` terms do. The model names foods in English, so the table is
 * English.
 */
import {
  ALLERGENS,
  PREGNANCY_CATEGORIES,
  type Allergen,
  type FoodFlags,
  type IdentifiedFood,
  type PlateIdentification,
  type PregnancyCategory,
} from '../contract/plate-identification.js';

/** One row of the table. Terms are lowercase words separated by single spaces. */
export interface FoodFlagRule {
  /** Every term must appear in the name as whole, consecutive words. */
  readonly allOf: readonly string[];
  /** The rule does not fire when any of these terms appears in the name. */
  readonly noneOf: readonly string[];
  readonly allergens: readonly Allergen[];
  readonly pregnancy: readonly PregnancyCategory[];
}

/** What one or more terms add, before it is spread over each term. */
interface FlagEffect {
  readonly noneOf?: readonly string[];
  readonly allergens?: readonly Allergen[];
  readonly pregnancy?: readonly PregnancyCategory[];
}

/** The value `flagsCoverage` takes on every item this lookup flags. */
export const NAME_LOOKUP_COVERAGE = 'partial' as const;

/** One rule per term, each with the same effect. A table-writing helper, nothing more. */
function eachOf(terms: readonly string[], effect: FlagEffect): FoodFlagRule[] {
  return terms.map((term) => allOf([term], effect));
}

/** One rule that needs every listed term. */
function allOf(terms: readonly string[], effect: FlagEffect): FoodFlagRule {
  return {
    allOf: terms,
    noneOf: effect.noneOf ?? [],
    allergens: effect.allergens ?? [],
    pregnancy: effect.pregnancy ?? [],
  };
}

/** Plant products named after the dairy food they replace. */
const PLANT_BASES = ['almond', 'oat', 'soy', 'soya', 'coconut', 'rice', 'cashew', 'hemp'] as const;

/** "almond milk", "oat milk", ... for one dairy word. */
function plantAlternativesOf(dairyWord: string): string[] {
  return PLANT_BASES.map((base) => `${base} ${dairyWord}`);
}

/** A name that says it has no animal product, or none of this one. */
const NOT_DAIRY = ['vegan', 'dairy free', 'non dairy', 'plant based'] as const;

const NOT_GLUTEN = ['gluten free'] as const;

const MILK_ONLY: FlagEffect = { allergens: ['milk'] };

export const FOOD_FLAG_RULES: readonly FoodFlagRule[] = [
  // ── milk ─────────────────────────────────────────────────────────────────
  ...eachOf(['milk'], { allergens: ['milk'], noneOf: [...plantAlternativesOf('milk'), ...NOT_DAIRY] }),
  ...eachOf(['cream'], {
    allergens: ['milk'],
    noneOf: [...plantAlternativesOf('cream'), ...NOT_DAIRY, 'cream soda', 'cream of tartar'],
  }),
  ...eachOf(['cheese'], { allergens: ['milk'], noneOf: [...plantAlternativesOf('cheese'), ...NOT_DAIRY] }),
  ...eachOf(['yogurt', 'yoghurt'], {
    allergens: ['milk'],
    noneOf: [...plantAlternativesOf('yogurt'), ...plantAlternativesOf('yoghurt'), ...NOT_DAIRY],
  }),
  ...eachOf(['butter'], {
    allergens: ['milk'],
    noneOf: [
      ...plantAlternativesOf('butter'),
      ...NOT_DAIRY,
      'peanut butter',
      'nut butter',
      'cocoa butter',
      'shea butter',
      'apple butter',
      'sunflower butter',
      'seed butter',
      'butter bean',
      'butter lettuce',
    ],
  }),
  ...eachOf(
    [
      'whey',
      'buttermilk',
      'ghee',
      'kefir',
      'milkshake',
      'cheesecake',
      'mozzarella',
      'parmesan',
      'cheddar',
      'feta',
      'ricotta',
      'mascarpone',
      'paneer',
      'halloumi',
      'gouda',
      'emmental',
      'gruyere',
    ],
    { ...MILK_ONLY, noneOf: NOT_DAIRY },
  ),

  // ── soft cheese (pregnancy), each also milk ──────────────────────────────
  ...eachOf(['brie', 'camembert', 'blue cheese', 'gorgonzola', 'roquefort', 'stilton'], {
    allergens: ['milk'],
    pregnancy: ['soft-cheese'],
    noneOf: NOT_DAIRY,
  }),

  // ── raw dairy (pregnancy) ────────────────────────────────────────────────
  allOf(['raw milk'], { allergens: ['milk'], pregnancy: ['raw-dairy'] }),
  allOf(['unpasteurised', 'milk'], { allergens: ['milk'], pregnancy: ['raw-dairy'] }),
  allOf(['unpasteurized', 'milk'], { allergens: ['milk'], pregnancy: ['raw-dairy'] }),
  allOf(['unpasteurised', 'cheese'], { allergens: ['milk'], pregnancy: ['raw-dairy'] }),
  allOf(['unpasteurized', 'cheese'], { allergens: ['milk'], pregnancy: ['raw-dairy'] }),

  // ── eggs ─────────────────────────────────────────────────────────────────
  // "eggplant" is one word, so it never matches `egg`; "egg plant" is excluded.
  ...eachOf(['egg', 'omelette', 'omelet', 'frittata', 'meringue', 'quiche', 'hollandaise', 'carbonara'], {
    allergens: ['eggs'],
    noneOf: ['vegan', 'egg free', 'egg plant'],
  }),

  // ── raw egg (pregnancy): only where the name says the egg is not cooked ──
  allOf(['raw', 'egg'], { allergens: ['eggs'], pregnancy: ['raw-egg'] }),
  allOf(['runny', 'egg'], { allergens: ['eggs'], pregnancy: ['raw-egg'] }),
  ...eachOf(['mayonnaise', 'mayo'], { allergens: ['eggs'], pregnancy: ['raw-egg'], noneOf: ['vegan', 'egg free'] }),
  allOf(['mousse'], { allergens: ['eggs'], pregnancy: ['raw-egg'], noneOf: ['vegan', 'egg free'] }),
  // Raw egg yolks, mascarpone, ladyfingers and espresso.
  allOf(['tiramisu'], {
    allergens: ['eggs', 'milk', 'gluten'],
    pregnancy: ['raw-egg', 'caffeine'],
    noneOf: ['vegan'],
  }),

  // ── fish ─────────────────────────────────────────────────────────────────
  // "shellfish", "crayfish", "cuttlefish" are one word each, so `fish` misses them.
  ...eachOf(
    [
      'fish',
      'salmon',
      'tuna',
      'cod',
      'haddock',
      'trout',
      'sardine',
      'anchovy',
      'anchovies',
      'mackerel',
      'herring',
      'halibut',
      'tilapia',
      'pollock',
      'sea bass',
      'snapper',
      'catfish',
      'monkfish',
      'eel',
      'caviar',
    ],
    { allergens: ['fish'], noneOf: ['vegan'] },
  ),

  // ── high-mercury fish (pregnancy), each also fish ────────────────────────
  ...eachOf(['shark', 'swordfish', 'marlin', 'king mackerel', 'tilefish'], {
    allergens: ['fish'],
    pregnancy: ['high-mercury-fish'],
  }),

  // ── smoked fish (pregnancy), each also fish ──────────────────────────────
  ...eachOf(['lox', 'gravlax', 'gravadlax', 'kipper'], { allergens: ['fish'], pregnancy: ['smoked-fish'] }),
  ...['salmon', 'trout', 'mackerel', 'haddock', 'herring', 'eel', 'fish'].map((fish) =>
    allOf(['smoked', fish], { allergens: ['fish'], pregnancy: ['smoked-fish'] }),
  ),

  // ── raw fish (pregnancy) ─────────────────────────────────────────────────
  // Sushi and poke can be vegetable-only, and sashimi or ceviche can be
  // shellfish, so these add the pregnancy category and leave the allergen to
  // whatever fish or shellfish word the name also carries.
  ...eachOf(['sushi', 'sashimi', 'ceviche', 'poke'], {
    pregnancy: ['raw-fish'],
    noneOf: ['vegan', 'vegetarian', 'vegetable', 'veggie', 'tofu'],
  }),
  ...['tuna', 'salmon', 'fish'].map((fish) =>
    allOf([fish, 'tartare'], { allergens: ['fish'], pregnancy: ['raw-fish'], noneOf: ['tartare sauce'] }),
  ),
  ...['tuna', 'salmon'].map((fish) =>
    allOf([fish, 'carpaccio'], { allergens: ['fish'], pregnancy: ['raw-fish'] }),
  ),

  // ── crustaceans ──────────────────────────────────────────────────────────
  ...eachOf(['shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'langoustine', 'scampi'], {
    allergens: ['crustaceans'],
    noneOf: ['vegan', 'crab apple'],
  }),

  // ── molluscs ─────────────────────────────────────────────────────────────
  // Oyster sauce is made from oyster extract, so it stays in; the mushroom is out.
  ...eachOf(
    [
      'mussel',
      'oyster',
      'clam',
      'squid',
      'calamari',
      'octopus',
      'scallop',
      'snail',
      'escargot',
      'cuttlefish',
      'abalone',
      'whelk',
      'cockle',
    ],
    { allergens: ['molluscs'], noneOf: ['vegan', 'oyster mushroom'] },
  ),

  // ── peanuts, never `nuts` ────────────────────────────────────────────────
  ...eachOf(['peanut', 'groundnut', 'satay'], { allergens: ['peanuts'] }),

  // ── nuts (tree nuts, EU Annex II) ────────────────────────────────────────
  // No bare `nut`: "coconut", "nutmeg", "butternut" and "water chestnut" are
  // not tree nuts, and "pine nuts" are not on the EU list either.
  ...eachOf(
    [
      'almond',
      'walnut',
      'cashew',
      'hazelnut',
      'pistachio',
      'pecan',
      'macadamia',
      'brazil nut',
      'marzipan',
      'praline',
      'nutella',
    ],
    { allergens: ['nuts'] },
  ),

  // ── soybeans ─────────────────────────────────────────────────────────────
  ...eachOf(['soy', 'soya', 'tofu', 'edamame', 'tempeh', 'miso'], { allergens: ['soybeans'] }),
  // Brewed with wheat. Tamari is the wheat-free kind and is not named here.
  allOf(['soy sauce'], { allergens: ['soybeans', 'gluten'], noneOf: [...NOT_GLUTEN, 'tamari'] }),

  // ── gluten (EU Annex II: wheat, rye, barley, oats, spelt, kamut) ─────────
  ...eachOf(
    [
      'bread',
      'breaded',
      'breadcrumb',
      'toast',
      'bagel',
      'croissant',
      'baguette',
      'pita',
      'naan',
      'crouton',
      'pizza',
      'spaghetti',
      'macaroni',
      'lasagna',
      'lasagne',
      'penne',
      'ravioli',
      'udon',
      'ramen',
      'couscous',
      'bulgur',
      'semolina',
      'wheat',
      'barley',
      'rye',
      'spelt',
      'oat',
      'oatmeal',
      'seitan',
      'cookie',
      'biscuit',
      'muffin',
      'pancake',
      'waffle',
      'pastry',
    ],
    { allergens: ['gluten'], noneOf: NOT_GLUTEN },
  ),
  ...eachOf(['pasta'], {
    allergens: ['gluten'],
    noneOf: [...NOT_GLUTEN, 'rice pasta', 'chickpea pasta', 'lentil pasta', 'bean pasta'],
  }),
  ...eachOf(['noodle'], {
    allergens: ['gluten'],
    noneOf: [...NOT_GLUTEN, 'rice noodle', 'glass noodle', 'cellophane noodle', 'zucchini noodle', 'kelp noodle'],
  }),
  ...eachOf(['cake'], { allergens: ['gluten'], noneOf: [...NOT_GLUTEN, 'rice cake'] }),
  ...eachOf(['cracker'], { allergens: ['gluten'], noneOf: [...NOT_GLUTEN, 'rice cracker'] }),

  // ── sesame ───────────────────────────────────────────────────────────────
  ...eachOf(['sesame', 'tahini', 'hummus', 'houmous', 'halva'], { allergens: ['sesame'] }),

  // ── mustard, celery, lupin ───────────────────────────────────────────────
  ...eachOf(['mustard'], { allergens: ['mustard'] }),
  ...eachOf(['celery', 'celeriac'], { allergens: ['celery'] }),
  ...eachOf(['lupin', 'lupini', 'lupine'], { allergens: ['lupin'] }),

  // ── wine: sulphites always, alcohol unless it is vinegar ─────────────────
  ...eachOf(['wine', 'champagne', 'prosecco'], { allergens: ['sulphites'] }),
  ...eachOf(['wine', 'champagne', 'prosecco'], { pregnancy: ['alcohol'], noneOf: ['vinegar'] }),

  // ── alcohol (pregnancy) ──────────────────────────────────────────────────
  // Beer is brewed from barley. Root beer, ginger beer and ginger ale are soft drinks.
  ...eachOf(['beer', 'ale', 'lager'], {
    allergens: ['gluten'],
    pregnancy: ['alcohol'],
    noneOf: ['root beer', 'ginger beer', 'ginger ale', 'non alcoholic', 'alcohol free', ...NOT_GLUTEN],
  }),
  ...eachOf(['whiskey', 'whisky', 'vodka', 'rum', 'gin', 'tequila', 'cocktail', 'liqueur', 'sangria'], {
    pregnancy: ['alcohol'],
    noneOf: ['non alcoholic', 'alcohol free', 'mocktail'],
  }),
  // Japanese menus also write salmon as "sake".
  ...eachOf(['sake'], { pregnancy: ['alcohol'], noneOf: ['nigiri', 'sashimi', 'maki', 'roll', 'salmon'] }),

  // ── raw and cured meat (pregnancy) ───────────────────────────────────────
  ...eachOf(['steak tartare', 'beef tartare'], { pregnancy: ['raw-meat'] }),
  allOf(['rare', 'steak'], { pregnancy: ['raw-meat'] }),
  allOf(['carpaccio'], {
    pregnancy: ['raw-meat'],
    noneOf: [
      'salmon',
      'tuna',
      'fish',
      'octopus',
      'scallop',
      'beet',
      'beetroot',
      'zucchini',
      'courgette',
      'tomato',
      'pineapple',
      'mushroom',
      'vegetable',
      'vegan',
    ],
  }),
  ...eachOf(['prosciutto', 'parma ham', 'serrano ham', 'jamon', 'bresaola'], { pregnancy: ['raw-meat'] }),
  // On a pizza, salami is baked.
  allOf(['salami'], { pregnancy: ['raw-meat'], noneOf: ['pizza'] }),

  // ── liver (pregnancy) ────────────────────────────────────────────────────
  ...eachOf(['liver', 'liverwurst', 'pate', 'foie gras'], { pregnancy: ['liver-retinol'] }),

  // ── caffeine (pregnancy) ─────────────────────────────────────────────────
  // Coffee cake is cake to go with coffee; a turmeric latte has none.
  ...eachOf(['coffee', 'espresso', 'cappuccino', 'americano', 'macchiato', 'energy drink', 'matcha'], {
    pregnancy: ['caffeine'],
    noneOf: ['decaf', 'decaffeinated', 'caffeine free', 'coffee cake'],
  }),
  ...eachOf(['latte'], {
    pregnancy: ['caffeine'],
    noneOf: ['decaf', 'decaffeinated', 'caffeine free', 'turmeric', 'golden', 'beetroot', 'beet'],
  }),
];

/** Accents off, lowercase, every non-alphanumeric run to one space, split into words. */
export function toWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

/** A name word matches a term word exactly, or as its plural with one trailing `s`. */
function isSameWord(options: { nameWord: string; termWord: string }): boolean {
  return options.nameWord === options.termWord || options.nameWord === `${options.termWord}s`;
}

/** True when the term's words appear in `nameWords` consecutively. */
function containsTerm(nameWords: readonly string[], term: string): boolean {
  const termWords = toWords(term);
  if (termWords.length === 0) return false;
  const lastStart = nameWords.length - termWords.length;
  for (let start = 0; start <= lastStart; start += 1) {
    const isMatch = termWords.every((termWord, offset) =>
      isSameWord({ nameWord: nameWords[start + offset], termWord }),
    );
    if (isMatch) return true;
  }
  return false;
}

function doesRuleFire(nameWords: readonly string[], rule: FoodFlagRule): boolean {
  if (!rule.allOf.every((term) => containsTerm(nameWords, term))) return false;
  return !rule.noneOf.some((term) => containsTerm(nameWords, term));
}

/**
 * The caution flags a food's name shows, or `null` when no rule recognises it.
 * `null` means "not assessed", never "safe": see the module header.
 */
export function flagsForFoodName(name: string): FoodFlags | null {
  const nameWords = toWords(name);
  const allergens = new Set<Allergen>();
  const pregnancy = new Set<PregnancyCategory>();
  for (const rule of FOOD_FLAG_RULES) {
    if (!doesRuleFire(nameWords, rule)) continue;
    for (const allergen of rule.allergens) allergens.add(allergen);
    for (const category of rule.pregnancy) pregnancy.add(category);
  }
  if (allergens.size === 0 && pregnancy.size === 0) return null;
  // The vocabulary order, not the table order, so one food always reads the same.
  return {
    pregnancy: PREGNANCY_CATEGORIES.filter((category) => pregnancy.has(category)),
    allergens: ALLERGENS.filter((allergen) => allergens.has(allergen)),
    mayContain: [],
  };
}

/** One food with its flags and coverage set, or unchanged when the lookup misses. */
function withNameFlags(food: IdentifiedFood): IdentifiedFood {
  const flags = flagsForFoodName(food.name);
  if (flags === null) return food;
  return { ...food, flags, flagsCoverage: NAME_LOOKUP_COVERAGE };
}

/**
 * Every food on the plate through {@link flagsForFoodName}. A hit sets `flags`
 * and `flagsCoverage: 'partial'`; a miss leaves the food exactly as it was, with
 * neither key. Nothing else on the food changes.
 */
export function addNameFlags(plate: PlateIdentification): PlateIdentification {
  return { ...plate, foods: plate.foods.map(withNameFlags) };
}
