/**
 * `restoreAnyOfTypeUnions` is the inverse of the type-union folding zod 4.6.7 added to `z.toJSONSchema`, and
 * the model-facing plate schema goes through it. GHSA-mrhx-c7xc-m3w5 (memory exhaustion on an oversized array)
 * forced the zod bump; the schema sent to the AI models must not change spelling because of it, and a change
 * needs a provider test first.
 *
 * There is no committed pin of this schema in this app, so the last suite here is the pin: no `type` array may
 * reach `PLATE_IDENTIFICATION_JSON_SCHEMA`.
 *
 * THE CONTROL. The first suite asserts the installed zod really emits the `type` array for a nullable field.
 * Without that, an assertion for the `anyOf` form could not fail on the raw output.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  restoreAnyOfTypeUnions,
  type JsonSchemaObject,
  type JsonSchemaValue,
} from '../../src/contract/json-schema-any-of.js';
import {
  BasePlateIdentificationSchema,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
} from '../../src/contract/plate-identification.js';

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
    expect(propertyOf(raw, 'name')).toEqual({ type: ['string', 'null'] });
  });

  it('is not the anyOf form, so an assertion for the anyOf form can fail on the raw output', () => {
    expect(propertyOf(raw, 'name')).not.toEqual(NULLABLE_STRING);
  });

  it('puts type arrays into the raw plate schema, so the wire check below can fail', () => {
    expect(findTypeArrays(rawSchema(BasePlateIdentificationSchema)).length).toBeGreaterThan(0);
  });
});

describe('restoreAnyOfTypeUnions', () => {
  it('turns a nullable field back into anyOf of two bare types, the null branch last', () => {
    const raw = rawSchema(z.object({ name: z.string().nullable() }));
    expect(propertyOf(restoreAnyOfTypeUnions(raw), 'name')).toEqual(NULLABLE_STRING);
  });

  it('puts anyOf first and keeps the other keywords in their order', () => {
    const raw = rawSchema(z.object({ grams: z.number().nullable().describe('weight') }));
    const restored = propertyOf(restoreAnyOfTypeUnions(raw), 'grams');
    if (!isObject(restored)) throw new Error('the grams property is not a schema object');
    expect(Object.keys(restored)).toEqual(['anyOf', 'description']);
    expect(JSON.stringify(restored)).toBe('{"anyOf":[{"type":"number"},{"type":"null"}],"description":"weight"}');
  });

  it('restores a union of more than two types, in member order', () => {
    const raw = rawSchema(z.object({ value: z.union([z.string(), z.number(), z.null()]) }));
    expect(propertyOf(raw, 'value')).toEqual({ type: ['string', 'number', 'null'] });
    expect(propertyOf(restoreAnyOfTypeUnions(raw), 'value')).toEqual({
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
    expect(findTypeArrays(tree)).toEqual([
      '$.properties.list.items.properties.a.type',
      '$.properties.pick.oneOf[0].type',
      '$.$defs.shared.type',
    ]);
    expect(findTypeArrays(restoreAnyOfTypeUnions(tree))).toEqual([]);
  });

  it('leaves a plain type, an enum with null, a property called "type" and a required list alone', () => {
    const raw = rawSchema(z.object({ type: z.enum(['a', 'b']).nullable(), plain: z.string() }));
    const restored = restoreAnyOfTypeUnions(raw);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(raw));
    expect(restored.required).toEqual(['type', 'plain']);
  });

  it('does not touch a node that carries both anyOf and a type array', () => {
    const handWritten: JsonSchemaObject = { type: ['string', 'null'], anyOf: [{ minLength: 1 }] };
    expect(restoreAnyOfTypeUnions(handWritten)).toEqual(handWritten);
  });

  it('does not change its input', () => {
    const raw = rawSchema(z.object({ name: z.string().nullable() }));
    const before = JSON.stringify(raw);
    restoreAnyOfTypeUnions(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe('the schema sent to the models', () => {
  it('has no type array anywhere, so a zod change cannot alter the wire shape unseen', () => {
    // SAFETY: `JsonSchemaNode` is a typed view of a plain JSON document, which is what `JsonSchemaObject` names.
    const wire = PLATE_IDENTIFICATION_JSON_SCHEMA as JsonSchemaObject;
    expect(findTypeArrays(wire)).toEqual([]);
  });

  it('spells a nullable field as anyOf with the null branch last', () => {
    const portionHint = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items?.properties?.portionHint;
    expect(portionHint?.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
  });
});
