/**
 * Unit tests for `#app/services/vision/schema` — the pure parse/validate
 * functions shared by every vision provider adapter, plus the derived JSON
 * Schema handed to providers for enforced structured output. No network/fetch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLATE_IDENTIFICATION_JSON_SCHEMA,
  parsePlateIdentificationJson,
  validatePlateIdentification,
} from '../../app/services/vision/schema';
import { VisionProviderError } from '../../app/services/vision/types';

const VALID_PAYLOAD = {
  foods: [
    {
      name: 'grilled chicken breast',
      estimatedGrams: 150,
      confidence: 'high',
      portionHint: 'about half the plate',
      macrosPer100g: {
        carbs: 0,
        fiber: null,
        sugars: 0,
        polyols: null,
        protein: 31,
        fat: 3.6,
        kcal: 165,
      },
    },
  ],
  notes: null,
};

describe('parsePlateIdentificationJson', () => {
  it('parses a valid JSON response', () => {
    const result = parsePlateIdentificationJson(JSON.stringify(VALID_PAYLOAD));

    assert.strictEqual(result.foods.length, 1);
    assert.strictEqual(result.foods[0]?.name, 'grilled chicken breast');
    assert.strictEqual(result.foods[0]?.estimatedGrams, 150);
    assert.strictEqual(result.foods[0]?.confidence, 'high');
    assert.strictEqual(result.notes, undefined);
  });

  it('tolerates a ```json fenced response', () => {
    const fenced = '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```';

    const result = parsePlateIdentificationJson(fenced);

    assert.strictEqual(result.foods[0]?.name, 'grilled chicken breast');
  });

  it('tolerates a plain ``` fenced response with no language tag', () => {
    const fenced = '```\n' + JSON.stringify(VALID_PAYLOAD) + '\n```';

    const result = parsePlateIdentificationJson(fenced);

    assert.strictEqual(result.foods.length, 1);
  });

  it('exposes the portionHint string when present', () => {
    const result = parsePlateIdentificationJson(JSON.stringify(VALID_PAYLOAD));

    assert.strictEqual(result.foods[0]?.portionHint, 'about half the plate');
  });

  it('normalizes a null portionHint to undefined', () => {
    const payload = {
      foods: [{ name: 'apple', estimatedGrams: 100, confidence: 'high', portionHint: null, macrosPer100g: null }],
      notes: null,
    };

    const result = parsePlateIdentificationJson(JSON.stringify(payload));

    assert.strictEqual(result.foods[0]?.portionHint, undefined);
  });

  it('rejects a food missing the required portionHint field', () => {
    const payload = {
      foods: [{ name: 'apple', estimatedGrams: 100, confidence: 'high', macrosPer100g: null }],
      notes: null,
    };

    assert.throws(() => parsePlateIdentificationJson(JSON.stringify(payload)), VisionProviderError);
  });

  it('converts null macro fields to undefined rather than 0', () => {
    const result = parsePlateIdentificationJson(JSON.stringify(VALID_PAYLOAD));

    const macros = result.foods[0]?.macrosPer100g;
    assert.strictEqual(macros?.fiber, undefined);
    assert.strictEqual(macros?.polyols, undefined);
    // Fields the model DID provide (even if 0) must survive.
    assert.strictEqual(macros?.carbs, 0);
    assert.strictEqual(macros?.protein, 31);
  });

  it('leaves macrosPer100g undefined when the model returned null for the whole object', () => {
    const payload = {
      foods: [{ name: 'mystery item', estimatedGrams: 80, confidence: 'low', portionHint: null, macrosPer100g: null }],
      notes: 'could not estimate macros confidently',
    };

    const result = parsePlateIdentificationJson(JSON.stringify(payload));

    assert.strictEqual(result.foods[0]?.macrosPer100g, undefined);
    assert.strictEqual(result.notes, 'could not estimate macros confidently');
  });

  it('throws a VisionProviderError on garbage (non-JSON) input', () => {
    assert.throws(() => parsePlateIdentificationJson('not json at all'), VisionProviderError);
  });

  it('throws a VisionProviderError when the JSON does not match the expected shape', () => {
    assert.throws(() => parsePlateIdentificationJson(JSON.stringify({ oops: true })), VisionProviderError);
  });
});

describe('validatePlateIdentification', () => {
  it('validates an already-parsed object (enforced-output path)', () => {
    const result = validatePlateIdentification(VALID_PAYLOAD);

    assert.strictEqual(result.foods[0]?.name, 'grilled chicken breast');
    assert.strictEqual(result.foods[0]?.portionHint, 'about half the plate');
  });

  it('throws a VisionProviderError on a shape mismatch', () => {
    assert.throws(() => validatePlateIdentification({ foods: 'not an array', notes: null }), VisionProviderError);
  });

  it('throws a VisionProviderError on a non-object value', () => {
    assert.throws(() => validatePlateIdentification(42), VisionProviderError);
  });
});

describe('PLATE_IDENTIFICATION_JSON_SCHEMA', () => {
  it('drops the draft $schema keyword', () => {
    assert.ok(!('$schema' in PLATE_IDENTIFICATION_JSON_SCHEMA));
  });

  it('is a strict object: additionalProperties false, all top-level keys required', () => {
    assert.strictEqual(PLATE_IDENTIFICATION_JSON_SCHEMA.type, 'object');
    assert.strictEqual(PLATE_IDENTIFICATION_JSON_SCHEMA.additionalProperties, false);
    assert.deepStrictEqual((PLATE_IDENTIFICATION_JSON_SCHEMA.required ?? []).toSorted(), ['foods', 'notes']);
  });

  it('requires every per-food field including portionHint', () => {
    const foodSchema = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items;
    assert.ok(foodSchema, 'expected foods.items schema');
    assert.strictEqual(foodSchema.additionalProperties, false);
    assert.deepStrictEqual((foodSchema.required ?? []).toSorted(), [
      'confidence',
      'estimatedGrams',
      'macrosPer100g',
      'name',
      'portionHint',
    ]);
  });

  it('marks nested macro objects strict as well', () => {
    const foodSchema = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items;
    // macrosPer100g is nullable -> anyOf: [ <object>, { type: 'null' } ]
    const macrosObject = foodSchema?.properties?.macrosPer100g?.anyOf?.find((branch) => branch.type === 'object');
    assert.ok(macrosObject, 'expected the object branch of the nullable macros schema');
    assert.strictEqual(macrosObject.additionalProperties, false);
    assert.deepStrictEqual((macrosObject.required ?? []).toSorted(), [
      'carbs',
      'fat',
      'fiber',
      'kcal',
      'polyols',
      'protein',
      'sugars',
    ]);
  });
});

/**
 * The optional provenance fields (M138 spec 06). Two requirements pull in
 * opposite directions and both are load-bearing:
 *
 * 1. A self-hosted openplate-inference server may report, per item, whether
 *    the macros came from a food corpus and which source to credit — and the
 *    client must preserve both.
 * 2. No cloud provider may be OBLIGED to emit them. OpenAI strict structured
 *    output requires every property of the schema in `required`, so a field
 *    present in the provider-facing schema is a field Gemini-via-OpenRouter
 *    has to invent a value for on every scan.
 *
 * The third test below is the one that fails if someone "simplifies" the two
 * schemas in `schema.ts` back into one.
 */
describe('per-item provenance and attribution', () => {
  it('still accepts a response that omits both fields (every cloud provider)', () => {
    const result = parsePlateIdentificationJson(JSON.stringify(VALID_PAYLOAD));

    assert.strictEqual(result.foods[0]?.provenance, undefined);
    assert.strictEqual(result.foods[0]?.attribution, undefined);
  });

  it('preserves both values through parsePlateIdentificationJson when present', () => {
    const payload = {
      foods: [
        {
          name: 'boiled potatoes',
          estimatedGrams: 200,
          confidence: 'high',
          portionHint: null,
          macrosPer100g: null,
          provenance: 'corpus',
          attribution: 'Bundeslebensmittelschlüssel (BLS), CC BY 4.0',
        },
        {
          name: 'gravy',
          estimatedGrams: 30,
          confidence: 'low',
          portionHint: null,
          macrosPer100g: null,
          provenance: 'model',
          attribution: null,
        },
      ],
      notes: null,
    };

    const result = parsePlateIdentificationJson(JSON.stringify(payload));

    assert.strictEqual(result.foods[0]?.provenance, 'corpus');
    assert.strictEqual(result.foods[0]?.attribution, 'Bundeslebensmittelschlüssel (BLS), CC BY 4.0');
    assert.strictEqual(result.foods[1]?.provenance, 'model');
    // `null` normalizes to absent, exactly like portionHint and the macros.
    assert.strictEqual(result.foods[1]?.attribution, undefined);
  });

  it('rejects a provenance value outside the enum rather than passing it through', () => {
    const payload = {
      foods: [
        {
          name: 'rice',
          estimatedGrams: 150,
          confidence: 'high',
          portionHint: null,
          macrosPer100g: null,
          provenance: 'vibes',
        },
      ],
      notes: null,
    };

    assert.throws(() => parsePlateIdentificationJson(JSON.stringify(payload)), VisionProviderError);
  });

  it('keeps BOTH field names out of the provider-facing JSON schema entirely', () => {
    // Not just out of `required` — out of the serialized schema altogether, so
    // no provider ever sees the words. A whole-document check rather than a
    // properties lookup: it also catches them appearing in a nested branch.
    const serialized = JSON.stringify(PLATE_IDENTIFICATION_JSON_SCHEMA);

    assert.ok(!serialized.includes('provenance'), 'provenance must not appear in the generation schema');
    assert.ok(!serialized.includes('attribution'), 'attribution must not appear in the generation schema');
  });

  it('still lists exactly the five asked-for per-food fields as required', () => {
    const foodSchema = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items;
    assert.ok(foodSchema, 'expected foods.items schema');
    assert.deepStrictEqual((foodSchema.required ?? []).toSorted(), [
      'confidence',
      'estimatedGrams',
      'macrosPer100g',
      'name',
      'portionHint',
    ]);
  });
});
