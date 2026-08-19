/**
 * Unit tests for the micronutrient MODEL (`app/lib/micronutrients`) and for the
 * food-resolution parser that produces it
 * (`app/services/food-resolution/schema`).
 *
 * The whole feature rests on one distinction that is easy to lose and
 * impossible to notice afterwards: an ABSENT block ("this source has no
 * micronutrient dimension"), a `null` VALUE ("we looked, this nutrient has no
 * figure") and a measured `0` ("this food genuinely contains none") are three
 * different facts. These tests pin all three at the two places they can be
 * collapsed — the wire parser, and the form encoding.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MINERAL_KEYS,
  NUTRIENT_KEYS,
  VITAMIN_KEYS,
  cloneMicronutrients,
  decodeMicronutrients,
  encodeMicronutrients,
  hasAnyMicronutrientBlock,
  isVitaminKey,
  readNutrientPer100g,
  type MicronutrientsPer100g,
  type Vitamins,
} from '../../app/lib/micronutrients';
import { parseFoodSearchResponse } from '../../app/services/food-resolution/schema';

const FULL_VITAMINS = {
  betaCarotene: 449,
  vitaminA: 42,
  vitaminC: 13.7,
  vitaminD: null,
  vitaminE: 0.54,
  vitaminB1: 0.037,
  vitaminB2: 0.019,
  vitaminB6: 0.08,
  vitaminB9: 15,
  vitaminB12: null,
};

const FULL_MINERALS = {
  nacl: null,
  potassium: 237,
  sodium: 0,
  calcium: 10,
  magnesium: 11,
  zinc: 0.17,
  phosphorus: 24,
  iron: 0.27,
};

/**
 * A micronutrient block exactly as it arrives on the wire — including the
 * malformed values these tests feed the parser on purpose (a string figure, a
 * missing nutrient key, an explicit `null` block).
 */
type WireNutrientBlock = { [nutrient: string]: number | string | null } | null;

/** The micronutrient fields a wire search result may carry; an omitted key means "no block at all". */
interface WireMicronutrients {
  vitamins?: WireNutrientBlock;
  minerals?: WireNutrientBlock;
}

/** A minimal LCC search result; `extra` merges the micronutrient blocks in (or leaves them out). */
function searchResult(extra: WireMicronutrients = {}) {
  return {
    slug: 'carrot',
    locale: 'en',
    title: 'Carrot',
    canonicalName: 'Carrot',
    url: 'https://lowcarbcheck.com/foods/carrot',
    imageUrl: null,
    macrosPer100g: { kcal: 41, protein: 0.9, fat: 0.2, carbs: 9.6, fiber: 2.8, sugars: 4.7, polyols: null },
    netCarbsPer100g: 6.8,
    attribution: null,
    score: 0.95,
    origin: 'curated',
    portionSize: 80,
    ...extra,
  };
}

describe('nutrient key model', () => {
  it('lists every vitamin and mineral exactly once', () => {
    assert.equal(NUTRIENT_KEYS.length, VITAMIN_KEYS.length + MINERAL_KEYS.length);
    assert.equal(new Set(NUTRIENT_KEYS).size, NUTRIENT_KEYS.length);
  });

  it('routes each key to the block it is actually stored in', () => {
    assert.equal(isVitaminKey('vitaminD'), true);
    assert.equal(isVitaminKey('magnesium'), false);
  });
});

describe('readNutrientPer100g — three states, none of them zero', () => {
  it('reports no-block when there is no snapshot at all (manual / AI-estimated entries)', () => {
    assert.deepEqual(readNutrientPer100g(undefined, 'magnesium'), { state: 'no-block' });
  });

  it('reports no-block when the OTHER block is present but this one is absent', () => {
    const micronutrients: MicronutrientsPer100g = { vitamins: FULL_VITAMINS };
    assert.deepEqual(readNutrientPer100g(micronutrients, 'magnesium'), { state: 'no-block' });
  });

  it('reports no-value for a null figure inside a present block', () => {
    const micronutrients: MicronutrientsPer100g = { vitamins: FULL_VITAMINS };
    assert.deepEqual(readNutrientPer100g(micronutrients, 'vitaminD'), { state: 'no-value' });
  });

  it('reports a measured 0 as measured — a real figure, never a gap', () => {
    const micronutrients: MicronutrientsPer100g = { minerals: FULL_MINERALS };
    assert.deepEqual(readNutrientPer100g(micronutrients, 'sodium'), { state: 'measured', value: 0 });
  });

  it('reports a real figure as measured', () => {
    const micronutrients: MicronutrientsPer100g = { minerals: FULL_MINERALS };
    assert.deepEqual(readNutrientPer100g(micronutrients, 'magnesium'), { state: 'measured', value: 11 });
  });

  it('distinguishes an absent block from a present all-null one', () => {
    // SAFETY: `VITAMIN_KEYS` is the exact key set of `Vitamins`, so an entry per
    // key with a `null` value is a complete block (`number | null` per key).
    const allNull = Object.fromEntries(VITAMIN_KEYS.map((key) => [key, null])) as Vitamins;
    const present: MicronutrientsPer100g = { vitamins: allNull };

    assert.equal(readNutrientPer100g(present, 'vitaminC').state, 'no-value');
    assert.equal(readNutrientPer100g({}, 'vitaminC').state, 'no-block');
  });
});

describe('hasAnyMicronutrientBlock / cloneMicronutrients', () => {
  it('treats an empty snapshot as carrying nothing', () => {
    assert.equal(hasAnyMicronutrientBlock({}), false);
    assert.equal(hasAnyMicronutrientBlock(undefined), false);
    assert.equal(hasAnyMicronutrientBlock({ minerals: FULL_MINERALS }), true);
  });

  it('deep-copies so no two holders share block identity', () => {
    const source: MicronutrientsPer100g = { vitamins: { ...FULL_VITAMINS }, minerals: { ...FULL_MINERALS } };
    const copy = cloneMicronutrients(source);

    assert.ok(copy);
    assert.notEqual(copy.vitamins, source.vitamins);
    assert.notEqual(copy.minerals, source.minerals);
    assert.deepEqual(copy, source);
  });
});

describe('form encoding (encodeMicronutrients / decodeMicronutrients)', () => {
  it('round-trips a snapshot with a measured 0 and a null intact', () => {
    const source: MicronutrientsPer100g = { vitamins: FULL_VITAMINS, minerals: FULL_MINERALS };
    const decoded = decodeMicronutrients(encodeMicronutrients(source));

    assert.deepEqual(decoded, source);
    assert.equal(decoded?.minerals?.sodium, 0);
    assert.equal(decoded?.vitamins?.vitaminD, null);
  });

  it('encodes "nothing captured" as a blank that decodes straight back to undefined', () => {
    assert.equal(encodeMicronutrients(undefined), '');
    assert.equal(encodeMicronutrients({}), '');
    assert.equal(decodeMicronutrients(''), undefined);
  });

  it('keeps a one-block snapshot one-block through the round trip', () => {
    const decoded = decodeMicronutrients(encodeMicronutrients({ minerals: FULL_MINERALS }));
    assert.equal(decoded?.minerals?.iron, 0.27);
    assert.equal(decoded?.vitamins, undefined);
  });

  it('fails open to undefined on a malformed value — never to a block of zeros', () => {
    assert.equal(decodeMicronutrients('not json'), undefined);
    assert.equal(decodeMicronutrients('[]'), undefined);
    assert.equal(decodeMicronutrients(null), undefined);
  });
});

describe('food-resolution parser — absent-vs-null preserved off the wire', () => {
  it('leaves micronutrientsPer100g absent entirely for a food with neither block (BLS/FDC origins)', () => {
    const [match] = parseFoodSearchResponse({ results: [searchResult()] });
    assert.equal('micronutrientsPer100g' in match, false);
  });

  it('carries both blocks through verbatim, measured 0 and null alike', () => {
    const [match] = parseFoodSearchResponse({
      results: [searchResult({ vitamins: FULL_VITAMINS, minerals: FULL_MINERALS })],
    });

    assert.deepEqual(match.micronutrientsPer100g, { vitamins: FULL_VITAMINS, minerals: FULL_MINERALS });
    assert.equal(match.micronutrientsPer100g?.minerals?.sodium, 0);
    assert.equal(match.micronutrientsPer100g?.vitamins?.vitaminD, null);
  });

  it('does not materialize an absent block as an all-null one', () => {
    const [match] = parseFoodSearchResponse({ results: [searchResult({ vitamins: FULL_VITAMINS })] });

    assert.equal(match.micronutrientsPer100g?.minerals, undefined);
    assert.equal(match.micronutrientsPer100g?.vitamins?.vitaminA, 42);
  });

  it('treats an explicit null block the same as an absent one', () => {
    const [match] = parseFoodSearchResponse({
      results: [searchResult({ vitamins: null, minerals: null })],
    });
    assert.equal('micronutrientsPer100g' in match, false);
  });

  it('degrades ONE malformed nutrient value to unknown without discarding its siblings', () => {
    const [match] = parseFoodSearchResponse({
      results: [searchResult({ minerals: { ...FULL_MINERALS, iron: 'a lot' } })],
    });

    assert.equal(match.micronutrientsPer100g?.minerals?.iron, null);
    assert.equal(match.micronutrientsPer100g?.minerals?.magnesium, 11);
  });

  it('reads a missing nutrient key as unknown, not as zero', () => {
    const { iron: _iron, ...withoutIron } = FULL_MINERALS;
    const [match] = parseFoodSearchResponse({ results: [searchResult({ minerals: withoutIron })] });

    assert.equal(match.micronutrientsPer100g?.minerals?.iron, null);
  });
});
