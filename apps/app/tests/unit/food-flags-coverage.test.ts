/**
 * `flagsCoverage: 'partial'` on one food: a self-hosted openplate-inference
 * service can list what a food contains but cannot rule an allergen out, so
 * such a food is "not fully checked", never "clear".
 *
 * Four facts are pinned. The coverage is kept on a food that carries flags,
 * and dropped on one that does not. A value this build does not know costs the
 * coverage and never the plate. `checkCautions` answers `partial` for it, and
 * the chips `decideCautions` answers do not change. And the provider-facing
 * JSON Schema never asks for it, because a strict provider would then invent
 * one for every food.
 *
 * Every assertion has a control: the same food without the coverage, the
 * same coverage without flags, a known value against an unknown one, a JSON
 * Schema probe that does find a field it should find.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PLATE_IDENTIFICATION_JSON_SCHEMA, parsePlateIdentificationJson } from '../../app/services/vision/schema';
import type { FoodFlags } from '../../app/services/vision/schema';
import type { IdentifiedFood } from '../../app/services/vision/types';
import { cautionKey, checkCautions, decideCautions } from '../../app/lib/food-cautions';

/** A person with a milk allergy, the profile a false all-clear would hurt. */
const MILK_ALLERGIC = { reproductiveStatus: 'none', allergens: ['milk'] } as const;

/** The flags a name lookup gives a plain bread roll: gluten, nothing about milk. */
const GLUTEN_ONLY: FoodFlags = { pregnancy: [], allergens: ['gluten'], mayContain: [] };

/** One food as a service sends it, before `flags` and `flagsCoverage`. */
const ROLL = {
  name: 'bread roll',
  estimatedGrams: 60,
  confidence: 'high',
  portionHint: null,
  macroSource: 'estimated',
  brand: null,
  servingSize: null,
  carbBasis: null,
  macrosPer100g: null,
};

/** The two fields under test as a service may send them, an unknown coverage value included. */
interface ArrivingFlagFields {
  flags?: FoodFlags | null;
  flagsCoverage?: string | number;
}

/** The first food of a one-food plate whose item carries `extra`, through the real parse. */
function parsedRoll(extra: ArrivingFlagFields): IdentifiedFood {
  const plate = parsePlateIdentificationJson(
    JSON.stringify({ unreadable: false, unreadableReason: null, foods: [{ ...ROLL, ...extra }], notes: null }),
    'en',
  );
  const [first] = plate.foods;
  assert.ok(first, 'expected one parsed food');
  return first;
}

describe('flagsCoverage on a parsed food', () => {
  it('keeps partial on a food that carries flags', () => {
    const food = parsedRoll({ flags: GLUTEN_ONLY, flagsCoverage: 'partial' });
    assert.equal(food.flagsCoverage, 'partial');
    assert.deepEqual(food.flags, GLUTEN_ONLY);
  });

  it('leaves it absent on the same food that sent none (the control)', () => {
    const food = parsedRoll({ flags: GLUTEN_ONLY });
    assert.equal('flagsCoverage' in food, false);
  });

  it('drops a coverage that came without flags; the food stays not assessed', () => {
    const noFlags = parsedRoll({ flagsCoverage: 'partial' });
    assert.equal(noFlags.flags, undefined);
    assert.equal('flagsCoverage' in noFlags, false);
    const nullFlags = parsedRoll({ flags: null, flagsCoverage: 'partial' });
    assert.equal('flagsCoverage' in nullFlags, false);
  });

  it('an unknown coverage value costs the coverage, never the plate', () => {
    const food = parsedRoll({ flags: GLUTEN_ONLY, flagsCoverage: 'mostly' });
    assert.equal(food.name, 'bread roll');
    assert.deepEqual(food.flags, GLUTEN_ONLY);
    assert.equal('flagsCoverage' in food, false);
    const numeric = parsedRoll({ flags: GLUTEN_ONLY, flagsCoverage: 3 });
    assert.equal('flagsCoverage' in numeric, false);
  });
});

describe('checkCautions for a partly checked food', () => {
  it('answers partial, not clear, when nothing on the food matches the profile', () => {
    const food = parsedRoll({ flags: GLUTEN_ONLY, flagsCoverage: 'partial' });
    const check = checkCautions({ flags: food.flags, flagsCoverage: food.flagsCoverage, ...MILK_ALLERGIC });
    assert.deepEqual(check, { kind: 'partial', cautions: [] });
  });

  it('answers clear for the same flags fully checked (the control)', () => {
    const food = parsedRoll({ flags: GLUTEN_ONLY });
    const check = checkCautions({ flags: food.flags, flagsCoverage: food.flagsCoverage, ...MILK_ALLERGIC });
    assert.deepEqual(check, { kind: 'clear' });
  });

  it('keeps the cautions a partly checked food does earn, under partial', () => {
    const flags: FoodFlags = { pregnancy: [], allergens: ['gluten', 'milk'], mayContain: [] };
    const check = checkCautions({ flags, flagsCoverage: 'partial', ...MILK_ALLERGIC });
    assert.equal(check.kind, 'partial');
    assert.deepEqual(check.kind === 'partial' ? check.cautions.map(cautionKey) : [], ['allergen:milk:contains']);
    // Control: the same flags fully checked answer `cautions`.
    assert.equal(checkCautions({ flags, ...MILK_ALLERGIC }).kind, 'cautions');
  });

  it('a coverage with no flags is still not assessed', () => {
    assert.deepEqual(checkCautions({ flags: undefined, flagsCoverage: 'partial', ...MILK_ALLERGIC }), {
      kind: 'not-assessed',
    });
  });

  it('decideCautions, the chips, do not change with the coverage', () => {
    const flags: FoodFlags = { pregnancy: [], allergens: ['milk'], mayContain: [] };
    assert.deepEqual(
      decideCautions({ flags, flagsCoverage: 'partial', ...MILK_ALLERGIC }),
      decideCautions({ flags, ...MILK_ALLERGIC }),
    );
  });
});

describe('the provider-facing JSON Schema', () => {
  const itemProperties = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items?.properties;

  it('does not ask for flagsCoverage', () => {
    assert.ok(itemProperties, 'expected the food item properties');
    assert.equal(Object.hasOwn(itemProperties, 'flagsCoverage'), false);
    assert.equal(JSON.stringify(PLATE_IDENTIFICATION_JSON_SCHEMA).includes('flagsCoverage'), false);
  });

  it('does ask for flags, beside it, so the probe reads the item properties (the control)', () => {
    assert.ok(itemProperties, 'expected the food item properties');
    assert.equal(Object.hasOwn(itemProperties, 'flags'), true);
    assert.ok(JSON.stringify(PLATE_IDENTIFICATION_JSON_SCHEMA).includes('"mayContain"'));
  });
});
