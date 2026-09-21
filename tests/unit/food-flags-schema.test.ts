/**
 * The `flags` object on every AI-parsed food (M219 spec 01).
 *
 * Three facts are pinned here. The JSON schema handed to a provider DEMANDS
 * the field, with both enums, because a strict structured-output provider
 * rejects an optional one (D1d). The zod side TOLERATES almost anything on the
 * way in, so an invented category costs one word and never the plate (D2), and
 * the two allergen levels never name the same allergen twice (D1e). And the
 * outbound request carries nothing about the person: a body built for a
 * pregnant profile with an allergy list is byte-identical to one built for an
 * empty profile, because the builders have no parameter it could travel in.
 *
 * Every assertion has a control that makes it fail: a parse that does keep a
 * flag, a schema that does name a category, a body with the word injected.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import {
  ALLERGENS,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
  PREGNANCY_CATEGORIES,
  normalizeFoodFlags,
  parsePlateIdentificationJson,
} from '../../app/services/vision/schema';
import type { Allergen, JsonSchemaNode } from '../../app/services/vision/schema';
import { buildOpenAiCompatibleRequestBody } from '../../app/services/vision/openai-compatible';
import { buildAnthropicRequestBody } from '../../app/services/vision/anthropic';
import { PHOTO_INTAKE_TASK, TEXT_INTAKE_TASK } from '../../app/services/vision/task';
import type { ReproductiveStatus } from '../../app/lib/local-store/schema';

/** The `flags` object as it may arrive: any strings, any subset of keys, or null. */
interface ArrivingFlags {
  pregnancy?: string[];
  allergens?: string[];
  mayContain?: string[];
}

/** One food as a provider sends it, before any `flags`. */
const BRIE = {
  name: 'brie',
  estimatedGrams: 40,
  confidence: 'high',
  portionHint: 'a wedge',
  macroSource: 'estimated',
  brand: null,
  servingSize: null,
  carbBasis: null,
  macrosPer100g: { carbs: 0.5, fiber: null, sugars: 0.5, polyols: null, protein: 21, fat: 28, kcal: 334 },
};

/** A one-food plate, serialised the way the text-parse path receives it. */
function plateWith(food: typeof BRIE & { flags?: ArrivingFlags | null }): string {
  return JSON.stringify({ unreadable: false, unreadableReason: null, foods: [food], notes: null });
}

const EMPTY_FLAGS = { pregnancy: [], allergens: [], mayContain: [] };

describe('the flags on a parsed food', () => {
  it('drops "made-up" and keeps the plate: ["raw-dairy","made-up"] parses to ["raw-dairy"]', () => {
    const result = parsePlateIdentificationJson(
      plateWith({ ...BRIE, flags: { pregnancy: ['raw-dairy', 'made-up'], allergens: ['milk', 'made-up'], mayContain: [] } }),
    );

    assert.strictEqual(result.foods.length, 1);
    assert.deepStrictEqual(result.foods[0]?.flags, { pregnancy: ['raw-dairy'], allergens: ['milk'], mayContain: [] });
  });

  it('parses a plate with no flags at all to three empty arrays', () => {
    const result = parsePlateIdentificationJson(plateWith(BRIE));
    assert.deepStrictEqual(result.foods[0]?.flags, EMPTY_FLAGS);

    // Control: the same plate WITH a flag does not parse to empty arrays, so
    // the assertion above depends on the absence and not on a parser that
    // empties everything.
    const flagged = parsePlateIdentificationJson(plateWith({ ...BRIE, flags: { pregnancy: ['soft-cheese'], allergens: [], mayContain: [] } }));
    assert.notDeepStrictEqual(flagged.foods[0]?.flags, EMPTY_FLAGS);
    assert.deepStrictEqual(flagged.foods[0]?.flags.pregnancy, ['soft-cheese']);
  });

  it('parses a null flags object the same way, for a fallback-prompt model that answers null', () => {
    const result = parsePlateIdentificationJson(plateWith({ ...BRIE, flags: null }));
    assert.deepStrictEqual(result.foods[0]?.flags, EMPTY_FLAGS);
  });

  it('parses a flags object with no mayContain key to an empty mayContain', () => {
    const result = parsePlateIdentificationJson(plateWith({ ...BRIE, flags: { pregnancy: ['soft-cheese'], allergens: ['milk'] } }));
    assert.deepStrictEqual(result.foods[0]?.flags, { pregnancy: ['soft-cheese'], allergens: ['milk'], mayContain: [] });
  });

  it('keeps an allergen named in both lists in allergens only: mayContain ["milk","eggs"] parses to ["eggs"]', () => {
    const result = parsePlateIdentificationJson(
      plateWith({ ...BRIE, flags: { pregnancy: [], allergens: ['milk'], mayContain: ['milk', 'eggs'] } }),
    );
    assert.deepStrictEqual(result.foods[0]?.flags.allergens, ['milk']);
    assert.deepStrictEqual(result.foods[0]?.flags.mayContain, ['eggs']);

    // Control: with milk absent from `allergens`, mayContain keeps it, so the
    // drop above is the overlap rule and not a filter that removes milk.
    const doubtful = parsePlateIdentificationJson(plateWith({ ...BRIE, flags: { pregnancy: [], allergens: [], mayContain: ['milk', 'eggs'] } }));
    assert.deepStrictEqual(doubtful.foods[0]?.flags.mayContain, ['milk', 'eggs']);
  });

  it('keeps a repeated flag once, in arrival order', () => {
    const flags = normalizeFoodFlags({ pregnancy: ['alcohol', 'caffeine', 'alcohol'], allergens: [], mayContain: [] }, { isDev: false });
    assert.deepStrictEqual(flags.pregnancy, ['alcohol', 'caffeine']);
  });

  it('warns through console.warn for "made-up" in dev, and stays silent otherwise', () => {
    const warn = mock.method(console, 'warn', () => undefined);
    try {
      normalizeFoodFlags({ pregnancy: ['raw-dairy', 'made-up'], allergens: [], mayContain: [] }, { isDev: true });
      assert.strictEqual(warn.mock.callCount(), 1);
      const [message] = warn.mock.calls[0]?.arguments ?? [];
      assert.match(String(message), /made-up/);
      assert.match(String(message), /pregnancy/);

      // Silent outside development: the same drop, no line.
      warn.mock.resetCalls();
      normalizeFoodFlags({ pregnancy: ['raw-dairy', 'made-up'], allergens: [], mayContain: [] }, { isDev: false });
      assert.strictEqual(warn.mock.callCount(), 0);

      // Control for the dev case: known values alone warn about nothing, so
      // the one line above is about the dropped word and not about parsing.
      normalizeFoodFlags({ pregnancy: ['raw-dairy'], allergens: ['milk'], mayContain: ['eggs'] }, { isDev: true });
      assert.strictEqual(warn.mock.callCount(), 0);

      // The real parse path under this tier: Node has no `import.meta.env`,
      // which the module reads as "not development", so it is silent too.
      parsePlateIdentificationJson(plateWith({ ...BRIE, flags: { pregnancy: ['made-up'], allergens: [], mayContain: [] } }));
      assert.strictEqual(warn.mock.callCount(), 0);
    } finally {
      warn.mock.restore();
    }
  });
});

/** The enum an `items` node carries; a parse failure is the failure being looked for. */
const enumNodeSchema = z.object({ enum: z.array(z.string()) });

function flagsNode(): JsonSchemaNode {
  const foodSchema = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items;
  assert.ok(foodSchema, 'expected foods.items schema');
  assert.ok((foodSchema.required ?? []).includes('flags'), 'flags must be required on every food');
  const node = foodSchema.properties?.flags;
  assert.ok(node, 'expected foods.items.properties.flags');
  return node;
}

describe('PLATE_IDENTIFICATION_JSON_SCHEMA carries the flags', () => {
  it('json schema lists flags, flags.pregnancy, flags.allergens and flags.mayContain as required', () => {
    const node = flagsNode();
    assert.strictEqual(node.type, 'object');
    assert.strictEqual(node.additionalProperties, false);
    assert.deepStrictEqual((node.required ?? []).toSorted(), ['allergens', 'mayContain', 'pregnancy']);
  });

  it('json schema carries the v1 pregnancy list and the EU 14 as the two enums', () => {
    const node = flagsNode();
    const pregnancy = enumNodeSchema.parse(node.properties?.pregnancy?.items);
    const allergens = enumNodeSchema.parse(node.properties?.allergens?.items);
    const mayContain = enumNodeSchema.parse(node.properties?.mayContain?.items);

    assert.deepStrictEqual(pregnancy.enum, [...PREGNANCY_CATEGORIES]);
    assert.deepStrictEqual(allergens.enum, [...ALLERGENS]);
    // The same enum twice: two levels of one vocabulary, never two vocabularies.
    assert.deepStrictEqual(mayContain.enum, allergens.enum);

    // The list is the v1 list: eleven categories and fourteen allergens, the
    // two BfR-only additions absent (D1a). The positive half is the control
    // for the absence check: the serialised schema does name a category.
    assert.strictEqual(pregnancy.enum.length, 11);
    assert.strictEqual(allergens.enum.length, 14);
    const serialized = JSON.stringify(PLATE_IDENTIFICATION_JSON_SCHEMA);
    assert.ok(serialized.includes('high-mercury-fish'));
    assert.ok(serialized.includes('molluscs'));
    assert.ok(!serialized.includes('quinine'));
    assert.ok(!serialized.includes('poppy'));
  });
});

/**
 * What a person's record could contribute, if anything could carry it. Both
 * fields are typed against the real profile vocabulary so the test stays
 * honest when either grows.
 */
interface ProfileForTheRequest {
  reproductiveStatus: ReproductiveStatus;
  allergens: Allergen[];
}

const PREGNANT_WITH_MILK: ProfileForTheRequest = { reproductiveStatus: 'pregnant', allergens: ['milk'] };
const EMPTY_PROFILE: ProfileForTheRequest = { reproductiveStatus: 'none', allergens: [] };

type OpenAiBuilderOptions = Parameters<typeof buildOpenAiCompatibleRequestBody>[0];
type AnthropicBuilderOptions = Parameters<typeof buildAnthropicRequestBody>[0];

/**
 * Every outbound body the app can build, serialised, "for" one profile. The
 * builders have no parameter for a profile, so the object is handed over as
 * an extra option and each `@ts-expect-error` below is the type-level half of
 * the proof: the day a builder grows a `profile` option, the directive becomes
 * unused and the typecheck fails before any body is compared.
 */
function outboundBodiesFor(profile: ProfileForTheRequest): string[] {
  const image = { base64: 'AAAA', mimeType: 'image/png' };
  const text = 'a wedge of brie and a coffee';
  return [
    // @ts-expect-error the builder's input type carries no profile fields (M219 D1)
    buildOpenAiCompatibleRequestBody({ model: 'gpt-5o', input: { kind: 'photo', image }, task: PHOTO_INTAKE_TASK, useStructuredOutput: true, profile }),
    // @ts-expect-error the builder's input type carries no profile fields (M219 D1)
    buildOpenAiCompatibleRequestBody({ model: 'gpt-5o', input: { kind: 'text', text }, task: TEXT_INTAKE_TASK, useStructuredOutput: true, profile }),
    // @ts-expect-error the builder's input type carries no profile fields (M219 D1)
    buildAnthropicRequestBody({ model: 'claude-sonnet-5', input: { kind: 'photo', image }, task: PHOTO_INTAKE_TASK, profile }),
    // @ts-expect-error the builder's input type carries no profile fields (M219 D1)
    buildAnthropicRequestBody({ model: 'claude-sonnet-5', input: { kind: 'text', text }, task: TEXT_INTAKE_TASK, profile }),
  ].map((body) => JSON.stringify(body));
}

describe('the outbound request carries nothing about the person', () => {
  it('has no profile field on either builder input type', () => {
    // Compile-time: a key named after either profile field is not an option.
    const openAiHasNoStatus: 'reproductiveStatus' extends keyof OpenAiBuilderOptions ? never : true = true;
    const openAiHasNoAllergens: 'allergens' extends keyof OpenAiBuilderOptions ? never : true = true;
    const anthropicHasNoStatus: 'reproductiveStatus' extends keyof AnthropicBuilderOptions ? never : true = true;
    const anthropicHasNoAllergens: 'allergens' extends keyof AnthropicBuilderOptions ? never : true = true;
    assert.ok(openAiHasNoStatus && openAiHasNoAllergens && anthropicHasNoStatus && anthropicHasNoAllergens);
  });

  it('builds a byte-identical outbound body for a pregnant profile with allergens [milk] and for an empty profile', () => {
    const forPregnant = outboundBodiesFor(PREGNANT_WITH_MILK);
    const forNobody = outboundBodiesFor(EMPTY_PROFILE);

    assert.strictEqual(forPregnant.length, 4);
    assert.deepStrictEqual(forPregnant, forNobody);
    for (const body of forPregnant) {
      assert.ok(!body.includes('pregnant'), 'the status word reached an outbound body');
      assert.ok(!body.includes('lactating'), 'the status word reached an outbound body');
    }
  });

  it('control: injecting the word "pregnant" into one body makes the equality assertion fail', () => {
    const forPregnant = outboundBodiesFor(PREGNANT_WITH_MILK);
    const forNobody = outboundBodiesFor(EMPTY_PROFILE);
    // The status word, appended to the first body's serialised system prompt.
    const tampered = [forPregnant[0]?.replace('"content":"', '"content":"pregnant, '), ...forPregnant.slice(1)];

    assert.notDeepStrictEqual(tampered, forNobody);
    assert.ok(tampered[0]?.includes('pregnant'));
    assert.throws(() => assert.deepStrictEqual(tampered, forNobody), assert.AssertionError);
  });
});
