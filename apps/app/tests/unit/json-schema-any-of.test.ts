/**
 * Unit tests for `restoreAnyOfTypeUnions`, the inverse of the type-union folding zod 4.6.7 added to
 * `z.toJSONSchema`. The helper keeps the structured-output schema sent to the AI models spelled the way it
 * always was (GHSA-mrhx-c7xc-m3w5 forced the zod bump). The committed vision contract pins the same bytes.
 *
 * THE CONTROL. Every "restores" assertion below is only worth something if the raw zod output really has the
 * `type` array the helper removes. The first suite asserts that against the installed zod, so a zod that
 * stopped folding would turn it red and tell the reader the helper is no longer needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  restoreAnyOfTypeUnions,
  type JsonSchemaObject,
  type JsonSchemaValue,
} from '../../app/services/vision/json-schema-any-of';
import { PLATE_IDENTIFICATION_JSON_SCHEMA } from '../../app/services/vision/schema';

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };

function isObject(node: JsonSchemaValue): node is JsonSchemaObject {
  return node?.constructor === Object;
}

/** zod types its JSON leaves as `unknown`; what it returns is a plain JSON document. */
function rawSchema(schema: z.ZodType): JsonSchemaObject {
  // SAFETY: `z.toJSONSchema` returns strings, numbers, booleans, null, arrays and plain objects only.
  return z.toJSONSchema(schema) as JsonSchemaObject;
}

function propertyOf(schema: JsonSchemaObject, name: string): JsonSchemaValue {
  const properties = schema.properties;
  if (!properties || !isObject(properties)) throw new Error('the schema has no properties');
  return properties[name] ?? null;
}

/** Every `type` value in a schema tree that is an array. A property NAMED "type" holds a schema, never an array. */
function findTypeArrays(node: JsonSchemaValue, path = '$'): string[] {
  if (Array.isArray(node)) return node.flatMap((child, index) => findTypeArrays(child, `${path}[${index}]`));
  if (!isObject(node)) return [];
  return Object.entries(node).flatMap(([key, child]) => {
    const here = `${path}.${key}`;
    return key === 'type' && Array.isArray(child) ? [here] : findTypeArrays(child, here);
  });
}

describe('control: the installed zod folds a nullable field into a type array', () => {
  const raw = rawSchema(z.object({ name: z.string().nullable() }));

  it('emits type: ["string","null"] for a nullable string, so the helper has something to undo', () => {
    assert.deepEqual(propertyOf(raw, 'name'), { type: ['string', 'null'] });
  });

  it('is NOT the anyOf form, so an assertion for the anyOf form can fail on the raw output', () => {
    assert.notDeepEqual(propertyOf(raw, 'name'), NULLABLE_STRING);
  });
});

describe('restoreAnyOfTypeUnions', () => {
  it('turns a nullable field back into anyOf of two bare types, the null branch last', () => {
    const raw = rawSchema(z.object({ name: z.string().nullable() }));
    assert.deepEqual(propertyOf(restoreAnyOfTypeUnions(raw), 'name'), NULLABLE_STRING);
  });

  it('puts anyOf first and keeps the other keywords in their order', () => {
    const raw = rawSchema(z.object({ grams: z.number().nullable().describe('weight') }));
    const restored = propertyOf(restoreAnyOfTypeUnions(raw), 'grams');
    if (!isObject(restored)) throw new Error('the grams property is not a schema object');
    assert.deepEqual(Object.keys(restored), ['anyOf', 'description']);
    assert.equal(JSON.stringify(restored), '{"anyOf":[{"type":"number"},{"type":"null"}],"description":"weight"}');
  });

  it('restores a union of more than two types, in member order', () => {
    const raw = rawSchema(z.object({ value: z.union([z.string(), z.number(), z.null()]) }));
    assert.deepEqual(propertyOf(raw, 'value'), { type: ['string', 'number', 'null'] });
    assert.deepEqual(propertyOf(restoreAnyOfTypeUnions(raw), 'value'), {
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
    });
  });

  it('reaches nested objects, array items and $defs', () => {
    const tree: JsonSchemaObject = {
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { a: { type: ['integer', 'null'] } } } },
        pick: { oneOf: [{ type: ['string', 'null'] }] },
      },
      $defs: { shared: { type: ['boolean', 'null'] } },
    };
    assert.deepEqual(findTypeArrays(tree), [
      '$.properties.list.items.properties.a.type',
      '$.properties.pick.oneOf[0].type',
      '$.$defs.shared.type',
    ]);
    assert.deepEqual(findTypeArrays(restoreAnyOfTypeUnions(tree)), []);
  });

  it('leaves a plain type, an enum with null, a property called "type" and a required list alone', () => {
    const raw = rawSchema(
      z.object({
        type: z.enum(['a', 'b']).nullable(),
        plain: z.string(),
      }),
    );
    const before = JSON.stringify(raw);
    const restored = restoreAnyOfTypeUnions(raw);
    assert.equal(JSON.stringify(restored), before);
    assert.deepEqual(restored.required, ['type', 'plain']);
  });

  it('does not touch a node that carries both anyOf and a type array', () => {
    const handWritten: JsonSchemaObject = { type: ['string', 'null'], anyOf: [{ minLength: 1 }] };
    assert.deepEqual(restoreAnyOfTypeUnions(handWritten), handWritten);
  });

  it('does not change its input', () => {
    const raw = rawSchema(z.object({ name: z.string().nullable() }));
    const before = JSON.stringify(raw);
    restoreAnyOfTypeUnions(raw);
    assert.equal(JSON.stringify(raw), before);
  });
});

describe('the schema sent to the providers', () => {
  it('has no type array anywhere, so a zod change cannot alter the wire shape unseen', () => {
    // SAFETY: `JsonSchemaNode` is a typed view of a plain JSON document, which is what `JsonSchemaObject` names.
    const wire = PLATE_IDENTIFICATION_JSON_SCHEMA as JsonSchemaObject;
    assert.deepEqual(findTypeArrays(wire), []);
  });

  it('spells a nullable field as anyOf with the null branch last', () => {
    const foods = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods;
    const portionHint = foods?.items?.properties?.portionHint;
    assert.deepEqual(portionHint?.anyOf, [{ type: 'string' }, { type: 'null' }]);
  });
});
