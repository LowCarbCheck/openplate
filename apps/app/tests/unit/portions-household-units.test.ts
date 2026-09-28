/**
 * Unit tests for `#app/lib/portions/household-units` — the small, sourced
 * built-in unit table and its whole-word name matcher.
 *
 * The table carries no display nouns any more: "egg"/"eggs"/"Ei"/"Eier" are UI
 * copy in the translation bundles, and `portions-portion-options.test.ts`
 * asserts every unit id here resolves in BOTH bundles.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HOUSEHOLD_UNITS, getHouseholdUnit, matchHouseholdUnit } from '../../app/lib/portions/household-units';

describe('matchHouseholdUnit', () => {
  it('matches a food whose name contains a matched word', () => {
    assert.equal(matchHouseholdUnit('Scrambled eggs')?.id, 'egg');
    assert.equal(matchHouseholdUnit('Medium banana')?.id, 'banana');
    assert.equal(matchHouseholdUnit('Whole wheat bread')?.id, 'slice');
    assert.equal(matchHouseholdUnit('White rice, cooked')?.id, 'cup');
    assert.equal(matchHouseholdUnit('Olive oil')?.id, 'tablespoon');
    assert.equal(matchHouseholdUnit('Apple, raw')?.id, 'apple');
  });

  it('is case-insensitive', () => {
    assert.equal(matchHouseholdUnit('EGG')?.id, 'egg');
  });

  it('matches whole words only — "eggplant" never matches "egg"', () => {
    assert.equal(matchHouseholdUnit('Eggplant'), null);
  });

  it('returns null for a food with no matched unit', () => {
    assert.equal(matchHouseholdUnit('Tofu'), null);
    assert.equal(matchHouseholdUnit('Chicken breast'), null);
  });
});

describe('getHouseholdUnit', () => {
  it('finds a unit by id', () => {
    const egg = getHouseholdUnit('egg');
    assert.ok(egg);
    assert.equal(egg.gramsPerUnit, 50);
  });
});

describe('HOUSEHOLD_UNITS', () => {
  it('is a small, deliberately curated table (every entry has a positive reference weight and at least one match word)', () => {
    assert.ok(HOUSEHOLD_UNITS.length > 0);
    for (const unit of HOUSEHOLD_UNITS) {
      assert.ok(unit.gramsPerUnit > 0, `${unit.id} must have a positive reference weight`);
      assert.ok(unit.matchWords.length > 0, `${unit.id} must have at least one match word`);
      assert.ok(unit.typicalQuantities.length > 0, `${unit.id} must offer at least one typical quantity`);
    }
  });
});
