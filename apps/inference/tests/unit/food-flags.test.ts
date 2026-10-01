/**
 * The name lookup that fills `flags`, and the contract field that says how far
 * to trust them.
 *
 * Two kinds of case, and both are required. A HIT case proves a rule fires. A
 * CONTROL case proves a rule does NOT fire where a careless table would: a
 * plant milk is not a milk allergen, an eggplant is not an egg. A table that
 * flagged every food would pass every hit case, and only the controls catch it.
 * The miss cases matter most: a miss must be `null` (not assessed), never three
 * empty arrays (assessed and clear).
 */
import { describe, expect, it } from 'vitest';
import {
  ALLERGENS,
  FoodFlagsSchema,
  IdentifiedFoodSchema,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
  PREGNANCY_CATEGORIES,
  type Allergen,
  type PregnancyCategory,
} from '../../src/contract/plate-identification.js';
import {
  FOOD_FLAG_RULES,
  addNameFlags,
  flagsForFoodName,
  toWords,
} from '../../src/pipeline/food-flags.js';
import { mapTerseToPlate } from '../../src/pipeline/map-terse.js';

interface HitCase {
  name: string;
  allergens: Allergen[];
  pregnancy: PregnancyCategory[];
}

const HITS: HitCase[] = [
  { name: 'cheddar cheese', allergens: ['milk'], pregnancy: [] },
  { name: 'brie', allergens: ['milk'], pregnancy: ['soft-cheese'] },
  { name: 'smoked salmon', allergens: ['fish'], pregnancy: ['smoked-fish'] },
  { name: 'shrimp pasta', allergens: ['gluten', 'crustaceans'], pregnancy: [] },
  { name: 'peanut butter', allergens: ['peanuts'], pregnancy: [] },
  { name: 'almond milk', allergens: ['nuts'], pregnancy: [] },
  { name: 'soy milk', allergens: ['soybeans'], pregnancy: [] },
  { name: 'soy sauce', allergens: ['gluten', 'soybeans'], pregnancy: [] },
  { name: 'Scrambled Eggs', allergens: ['eggs'], pregnancy: [] },
  { name: 'oyster sauce', allergens: ['molluscs'], pregnancy: [] },
  { name: 'swordfish steak', allergens: ['fish'], pregnancy: ['high-mercury-fish'] },
  { name: 'red wine', allergens: ['sulphites'], pregnancy: ['alcohol'] },
  { name: 'red wine vinegar', allergens: ['sulphites'], pregnancy: [] },
  { name: 'chicken liver pâté', allergens: [], pregnancy: ['liver-retinol'] },
  { name: 'steak tartare', allergens: [], pregnancy: ['raw-meat'] },
  { name: 'tuna tartare', allergens: ['fish'], pregnancy: ['raw-fish'] },
  { name: 'salmon sushi', allergens: ['fish'], pregnancy: ['raw-fish'] },
  { name: 'cappuccino', allergens: [], pregnancy: ['caffeine'] },
  { name: 'hummus', allergens: ['sesame'], pregnancy: [] },
  {
    name: 'tiramisu',
    allergens: ['gluten', 'eggs', 'milk'],
    pregnancy: ['raw-egg', 'caffeine'],
  },
];

/** Names the table must leave unflagged, each a trap for a careless word list. */
const MISSES: string[] = [
  'eggplant',
  'grilled chicken breast',
  'grilled chicken',
  '',
  '   ',
  'coconut',
  'coconut milk',
  'nutmeg',
  'butternut squash soup',
  'water chestnut',
  'oyster mushrooms',
  'butter beans',
  'rice noodles',
  'decaf coffee',
  'root beer',
  'pizza margherita gluten free',
  'white rice',
];

describe('flagsForFoodName', () => {
  it.each(HITS)('flags "$name"', ({ name, allergens, pregnancy }) => {
    expect(flagsForFoodName(name)).toEqual({ allergens, pregnancy, mayContain: [] });
  });

  it.each(MISSES)('returns null for "%s", which means not assessed', (name) => {
    expect(flagsForFoodName(name)).toBeNull();
  });

  it('does not read a plant milk as milk', () => {
    expect(flagsForFoodName('almond milk')?.allergens).not.toContain('milk');
    // Control: the same word without the plant base is milk.
    expect(flagsForFoodName('milk')?.allergens).toContain('milk');
  });

  it('reads peanut butter as peanuts, never as milk and never as tree nuts', () => {
    const allergens = flagsForFoodName('peanut butter')?.allergens;
    expect(allergens).toContain('peanuts');
    expect(allergens).not.toContain('milk');
    expect(allergens).not.toContain('nuts');
    // Control: butter on its own is milk, so the exclusion is what kept it out.
    expect(flagsForFoodName('butter')?.allergens).toEqual(['milk']);
  });

  it('keeps a dairy word that sits beside an excluded phrase in its own rule', () => {
    // "almond milk" switches the milk rule off, but the cream rule has its own
    // exclusions and still fires.
    expect(flagsForFoodName('almond milk with whipped cream')?.allergens).toEqual(['milk', 'nuts']);
  });

  it('flags raw egg only when the name says the egg is not cooked', () => {
    expect(flagsForFoodName('fried egg')?.pregnancy).toEqual([]);
    expect(flagsForFoodName('soft boiled runny egg')?.pregnancy).toEqual(['raw-egg']);
  });

  it('never fills mayContain, so no allergen can sit in both lists', () => {
    for (const { name } of HITS) {
      expect(flagsForFoodName(name)?.mayContain).toEqual([]);
    }
  });
});

describe('FOOD_FLAG_RULES', () => {
  it('emits only values from the contract vocabularies', () => {
    for (const rule of FOOD_FLAG_RULES) {
      const parsed = FoodFlagsSchema.safeParse({
        pregnancy: rule.pregnancy,
        allergens: rule.allergens,
        mayContain: [],
      });
      expect(parsed.success, `rule ${rule.allOf.join(' + ')}`).toBe(true);
    }
    // Control: the same parse rejects a typo, so the loop above can fail.
    expect(FoodFlagsSchema.safeParse({ pregnancy: [], allergens: ['gluton'], mayContain: [] }).success).toBe(
      false,
    );
  });

  it('has a word for all 14 allergens and for every pregnancy category but raw sprouts', () => {
    const allergens = new Set(FOOD_FLAG_RULES.flatMap((rule) => rule.allergens));
    const pregnancy = new Set(FOOD_FLAG_RULES.flatMap((rule) => rule.pregnancy));
    expect(ALLERGENS.filter((allergen) => !allergens.has(allergen))).toEqual([]);
    // Raw sprouts are left out on purpose: "bean sprouts" are often cooked and
    // "brussels sprouts" are not sprouts, so no word decides it.
    expect(PREGNANCY_CATEGORIES.filter((category) => !pregnancy.has(category))).toEqual(['raw-sprouts']);
  });

  it('gives every rule an effect and writes every term in the folded form it is matched in', () => {
    for (const rule of FOOD_FLAG_RULES) {
      const label = `rule ${rule.allOf.join(' + ')}`;
      expect(rule.allergens.length + rule.pregnancy.length, label).toBeGreaterThan(0);
      for (const term of [...rule.allOf, ...rule.noneOf]) {
        // A term with a capital, an accent or a hyphen would still match after
        // folding, but a reader comparing the table to a name would misread it.
        expect(toWords(term).join(' '), label).toBe(term);
      }
    }
    // Control: the check above rejects a term that is not folded.
    expect(toWords('Pâté-Maison').join(' ')).not.toBe('Pâté-Maison');
  });
});

describe('addNameFlags', () => {
  it('sets flags and partial coverage on a hit and leaves a miss without either key', () => {
    const { plate } = mapTerseToPlate({
      f: [
        { n: 'cheddar cheese', g: 30 },
        { n: 'grilled chicken', g: 150 },
      ],
    });
    const [cheese, chicken] = addNameFlags(plate).foods;

    expect(cheese.flags).toEqual({ pregnancy: [], allergens: ['milk'], mayContain: [] });
    expect(cheese.flagsCoverage).toBe('partial');
    expect('flags' in chicken).toBe(false);
    expect('flagsCoverage' in chicken).toBe(false);
  });

  it('changes nothing but the two flag keys', () => {
    const { plate } = mapTerseToPlate({ f: [{ n: 'brie', g: 40 }] });
    const { flags: _flags, flagsCoverage: _coverage, ...rest } = addNameFlags(plate).foods[0];
    expect(rest).toEqual(plate.foods[0]);
  });
});

describe('flagsCoverage in the contract', () => {
  it('is a service-side field, kept out of the wire JSON Schema a provider is asked for', () => {
    const itemProperties = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items?.properties ?? {};
    expect(Object.keys(itemProperties)).not.toContain('flagsCoverage');
    // Control: the service schema does carry it, so the line above is not
    // passing because the field does not exist anywhere.
    expect(Object.keys(IdentifiedFoodSchema.keyof().enum)).toContain('flagsCoverage');
  });

  it('accepts only "partial"', () => {
    const food = mapTerseToPlate({ f: [{ n: 'brie', g: 40 }] }).plate.foods[0];
    expect(IdentifiedFoodSchema.safeParse({ ...food, flagsCoverage: 'partial' }).success).toBe(true);
    expect(IdentifiedFoodSchema.safeParse({ ...food, flagsCoverage: 'complete' }).success).toBe(false);
  });
});
