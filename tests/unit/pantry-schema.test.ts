/**
 * The PANTRY wire schema (`#app/services/vision/pantry-schema`), M233/02.
 *
 * What makes this worth its own file: the pantry is the first task with a
 * result shape of its own, so nothing the plate schema's tests assert covers
 * it. The load-bearing rule is the one the prompt spends half its length on,
 * that an amount nobody could read comes back as `null` and never as 0, and a
 * schema that quietly accepted a wrong unit would let a reading through that
 * the store then renders against nothing.
 *
 * EVERY ASSERTION HAS A CONTROL that goes red. A parse test is the easiest
 * kind to write so that it cannot fail, because a valid fixture passes every
 * check by construction; each `it` below either names the rejection or pairs
 * the acceptance with a fixture built to trip it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PANTRY_IDENTIFICATION_JSON_SCHEMA,
  parsePantryIdentificationJson,
  validatePantryIdentification,
} from '../../app/services/vision/pantry-schema';
import type { UnvalidatedProviderJson } from '../../app/services/vision/schema';
import { VisionProviderError } from '../../app/services/vision/types';

/**
 * A JSON object as the provider would send one.
 *
 * `UnvalidatedProviderJson` rather than `unknown`: the input to these two
 * entry points is always JSON, it is just not trusted yet, and typing the
 * fixtures as the same closed value type the parser takes keeps a fixture
 * nobody could actually receive out of the file.
 */
type WireObject = Record<string, UnvalidatedProviderJson>;

/** One complete wire item; override any field per test. */
function wireItem(overrides: WireObject = {}) {
  return { name: 'Eggs', amount: 6, unit: 'piece', category: 'egg', confidence: 'high', ...overrides };
}

/** A complete wire response around `items`. */
function wireResponse(items: UnvalidatedProviderJson[], notes: string | null = null) {
  return { items, notes };
}

describe('validatePantryIdentification', () => {
  it('accepts a complete reading and keeps the amount and the unit together', () => {
    const result = validatePantryIdentification(wireResponse([wireItem()]));

    assert.deepEqual(result.items, [
      { name: 'Eggs', amount: 6, unit: 'piece', category: 'egg', confidence: 'high' },
    ]);
  });

  it('keeps a null amount as NULL, never as 0', () => {
    const result = validatePantryIdentification(wireResponse([wireItem({ amount: null, unit: null })]));

    // The control for this one is the assertion itself: `0` and `null` are
    // different values and `deepEqual` tells them apart, which is the whole
    // point, an amount nobody could read must not become a figure a person
    // cannot tell from one they typed.
    assert.equal(result.items[0].amount, null);
    assert.notEqual(result.items[0].amount, 0);
  });

  it('drops a unit that arrived without an amount, so no row renders a bare unit', () => {
    const result = validatePantryIdentification(wireResponse([wireItem({ amount: null, unit: 'g' })]));

    assert.equal(result.items[0].unit, null);
  });

  it('REJECTS an unknown unit', () => {
    // THE CONTROL for every acceptance above. `kg` is a plausible unit and the
    // prompt names four; a schema that let it through would store a row the
    // renderer has no label for and the recipe step cannot add up.
    assert.throws(
      () => validatePantryIdentification(wireResponse([wireItem({ amount: 2, unit: 'kg' })])),
      VisionProviderError,
    );
  });

  it('REJECTS an unknown category', () => {
    assert.throws(
      () => validatePantryIdentification(wireResponse([wireItem({ category: 'frozen' })])),
      VisionProviderError,
    );
  });

  it('REJECTS a response with the notes key missing, because every field is required', () => {
    assert.throws(() => validatePantryIdentification({ items: [wireItem()] }), VisionProviderError);
  });

  it('turns an empty or whitespace-only note into an absent one', () => {
    const blank = validatePantryIdentification(wireResponse([wireItem()], '   '));
    const said = validatePantryIdentification(wireResponse([wireItem()], 'The back shelf was dark.'));

    assert.equal(blank.notes, undefined);
    assert.equal(said.notes, 'The back shelf was dark.');
  });

  it('accepts a reading that found nothing', () => {
    const result = validatePantryIdentification(wireResponse([], 'No food in this picture.'));

    assert.deepEqual(result.items, []);
  });
});

describe('parsePantryIdentificationJson', () => {
  it('round-trips a fenced JSON response', () => {
    const raw = ['```json', JSON.stringify(wireResponse([wireItem({ name: 'Butter', amount: 250, unit: 'g' })])), '```'].join(
      '\n',
    );

    const result = parsePantryIdentificationJson(raw);

    assert.deepEqual(result.items, [
      { name: 'Butter', amount: 250, unit: 'g', category: 'egg', confidence: 'high' },
    ]);
  });

  it('REJECTS text that is not JSON at all', () => {
    assert.throws(() => parsePantryIdentificationJson('I could not see the shelf.'), VisionProviderError);
  });
});

describe('PANTRY_IDENTIFICATION_JSON_SCHEMA', () => {
  it('asks providers for every field and forbids extra ones, which is what strict mode needs', () => {
    const items = PANTRY_IDENTIFICATION_JSON_SCHEMA.properties?.items;
    const item = items?.items;

    assert.deepEqual(PANTRY_IDENTIFICATION_JSON_SCHEMA.required?.toSorted(), ['items', 'notes']);
    assert.equal(PANTRY_IDENTIFICATION_JSON_SCHEMA.additionalProperties, false);
    assert.deepEqual(item?.required?.toSorted(), ['amount', 'category', 'confidence', 'name', 'unit']);
    assert.equal(item?.additionalProperties, false);
  });

  it('carries no draft `$schema` keyword, which some strict validators reject', () => {
    assert.equal(PANTRY_IDENTIFICATION_JSON_SCHEMA.$schema, undefined);
  });
});
