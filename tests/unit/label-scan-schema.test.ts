/**
 * Unit tests for the label-reading scan task (M123/10): the wire schema and
 * its parse, the strict JSON Schema handed to providers, and the fact that
 * both adapters build a label request from the task descriptor alone — no
 * plate prompt, no plate schema, no mode branch.
 *
 * The load-bearing assertions are about NULL: a macro the panel doesn't print
 * (or the model can't read) must arrive absent, never as 0. A silent 0 for
 * polyols is the exact bug this feature exists to kill, since net carbs are
 * `carbs − fiber − polyols`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LABEL_READING_JSON_SCHEMA,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
  parseLabelReadingJson,
  validateLabelReading,
} from '../../app/services/vision/schema';
import { LABEL_SCAN_TASK, PLATE_SCAN_TASK, VISION_MODES } from '../../app/services/vision/task';
import { buildOpenAiCompatibleRequestBody } from '../../app/services/vision/openai-compatible';
import { buildAnthropicRequestBody } from '../../app/services/vision/anthropic';
import { VisionProviderError } from '../../app/services/vision/types';

/** One macro column exactly as a provider sends it: every row present, `null` for "not printed". */
interface RawMacroRow {
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
}

/** The parts of the wire payload individual tests vary. */
interface LabelResponseOverrides {
  unreadable?: boolean;
  unreadableReason?: string | null;
  productName?: string | null;
  brand?: string | null;
  servingSize?: { asPrinted: string | null; grams: number | null } | null;
  servingsPerPackage?: number | null;
  macrosPerServing?: RawMacroRow | null;
  macrosPer100g?: RawMacroRow | null;
  carbBasis?: 'total' | 'available' | null;
  notes?: string | null;
}

/** A complete panel reading, as a provider must return it: every key present, nulls for "not printed". */
function labelResponse(overrides: LabelResponseOverrides = {}): string {
  return JSON.stringify({
    unreadable: false,
    unreadableReason: null,
    productName: 'Keto Bar, Chocolate',
    brand: 'Testbrand',
    servingSize: { asPrinted: '1 bar (35 g)', grams: 35 },
    servingsPerPackage: 1,
    macrosPerServing: {
      carbs: 14.7,
      fiber: 3.5,
      sugars: 0.7,
      polyols: 9.1,
      protein: 7,
      fat: 12.6,
      kcal: 180,
    },
    macrosPer100g: {
      carbs: 42,
      fiber: 10,
      sugars: 2,
      polyols: 26,
      protein: 20,
      fat: 36,
      kcal: 514,
    },
    carbBasis: 'total',
    notes: null,
    ...overrides,
  });
}

describe('parseLabelReadingJson', () => {
  it('reads a printed panel including polyols — the whole point of the label scan', () => {
    const reading = parseLabelReadingJson(labelResponse());

    assert.strictEqual(reading.unreadable, false);
    assert.strictEqual(reading.productName, 'Keto Bar, Chocolate');
    assert.deepStrictEqual(reading.servingSize, { asPrinted: '1 bar (35 g)', grams: 35 });
    assert.strictEqual(reading.macrosPerServing?.polyols, 9.1);
    assert.strictEqual(reading.macrosPer100g?.polyols, 26);
  });

  it('keeps both printed columns exactly as printed — it never converts one into the other', () => {
    const reading = parseLabelReadingJson(labelResponse());

    // 14.7 g per 35 g serving would be 42 g/100 g; the parse must report the
    // panel's own numbers, not a conversion (that is M123/06's job).
    assert.strictEqual(reading.macrosPerServing?.carbs, 14.7);
    assert.strictEqual(reading.macrosPer100g?.carbs, 42);
  });

  it('leaves a per-100g column absent when the panel prints only per serving', () => {
    const reading = parseLabelReadingJson(labelResponse({ macrosPer100g: null }));

    assert.strictEqual(reading.macrosPer100g, undefined);
    assert.strictEqual(reading.macrosPerServing?.carbs, 14.7);
  });

  it('NEVER turns an unreported macro into 0', () => {
    const reading = parseLabelReadingJson(
      labelResponse({
        macrosPerServing: {
          carbs: 14.7,
          fiber: null,
          sugars: null,
          polyols: null,
          protein: 7,
          fat: 12.6,
          kcal: 180,
        },
      }),
    );

    assert.strictEqual(reading.macrosPerServing?.carbs, 14.7);
    assert.ok(!('polyols' in (reading.macrosPerServing ?? {})), 'a null polyols must not become 0');
    assert.strictEqual(reading.macrosPerServing?.polyols, undefined);
    assert.strictEqual(reading.macrosPerServing?.fiber, undefined);
  });

  it('carries the model’s unreadable signal through with its reason', () => {
    const reading = parseLabelReadingJson(
      labelResponse({
        unreadable: true,
        unreadableReason: 'The panel is out of focus.',
        productName: null,
        servingSize: null,
        servingsPerPackage: null,
        macrosPerServing: null,
        macrosPer100g: null,
      }),
    );

    assert.strictEqual(reading.unreadable, true);
    assert.strictEqual(reading.unreadableReason, 'The panel is out of focus.');
    assert.strictEqual(reading.macrosPerServing, undefined);
  });

  it('tolerates a markdown-fenced response', () => {
    const reading = parseLabelReadingJson(`\`\`\`json\n${labelResponse()}\n\`\`\``);
    assert.strictEqual(reading.macrosPerServing?.polyols, 9.1);
  });

  it('throws a display-safe error when a required field is missing', () => {
    assert.throws(() => parseLabelReadingJson('{"unreadable": false}'), VisionProviderError);
  });

  it('rejects a plate response — the two tasks do not share a shape', () => {
    assert.throws(() => parseLabelReadingJson('{"foods": [], "notes": null}'), VisionProviderError);
  });
});

describe('validateLabelReading', () => {
  it('validates an enforced-structured-output block the same way as the text path', () => {
    const reading = validateLabelReading(JSON.parse(labelResponse()));
    assert.strictEqual(reading.macrosPer100g?.polyols, 26);
  });
});

describe('LABEL_READING_JSON_SCHEMA', () => {
  it('drops the $schema keyword and marks every top-level property required', () => {
    assert.ok(!('$schema' in LABEL_READING_JSON_SCHEMA));
    assert.strictEqual(LABEL_READING_JSON_SCHEMA.type, 'object');
    assert.strictEqual(LABEL_READING_JSON_SCHEMA.additionalProperties, false);
    assert.deepStrictEqual((LABEL_READING_JSON_SCHEMA.required ?? []).toSorted(), [
      'brand',
      'carbBasis',
      'macrosPer100g',
      'macrosPerServing',
      'notes',
      'productName',
      'servingSize',
      'servingsPerPackage',
      'unreadable',
      'unreadableReason',
    ]);
  });

  it('carries no plate concepts', () => {
    const properties = Object.keys(LABEL_READING_JSON_SCHEMA.properties ?? {});
    assert.ok(!properties.includes('foods'));
    assert.ok(!properties.includes('estimatedGrams'));
    assert.ok(!properties.includes('portionHint'));
  });
});

describe('LABEL_SCAN_TASK', () => {
  it('is a distinct mode with its own prompt, schema and parse', () => {
    assert.deepStrictEqual([...VISION_MODES], ['plate', 'label']);
    assert.strictEqual(LABEL_SCAN_TASK.mode, 'label');
    assert.strictEqual(LABEL_SCAN_TASK.jsonSchema, LABEL_READING_JSON_SCHEMA);
    assert.notStrictEqual(LABEL_SCAN_TASK.systemPrompt, PLATE_SCAN_TASK.systemPrompt);
    assert.notStrictEqual(LABEL_SCAN_TASK.schemaName, PLATE_SCAN_TASK.schemaName);
    assert.notStrictEqual(LABEL_SCAN_TASK.toolName, PLATE_SCAN_TASK.toolName);
  });

  it('asks the model for the polyols row and for the unreadable escape hatch', () => {
    assert.match(LABEL_SCAN_TASK.systemPrompt, /polyols/i);
    assert.match(LABEL_SCAN_TASK.systemPrompt, /unreadable/i);
  });
});

describe('adapters parameterized by the label task', () => {
  it('sends the label json_schema, not the plate one (openai-compatible)', () => {
    const body = buildOpenAiCompatibleRequestBody({
      model: 'gpt-5o',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      task: LABEL_SCAN_TASK,
      useStructuredOutput: true,
    });

    assert.strictEqual(body.response_format?.json_schema.name, 'label_reading');
    assert.strictEqual(body.response_format?.json_schema.schema, LABEL_READING_JSON_SCHEMA);
    assert.notStrictEqual(body.response_format?.json_schema.schema, PLATE_IDENTIFICATION_JSON_SCHEMA);
    assert.strictEqual(body.messages[0]?.content, LABEL_SCAN_TASK.systemPrompt);
  });

  it('forces the label tool with the label input schema (anthropic)', () => {
    const body = buildAnthropicRequestBody({
      model: 'claude-sonnet-5',
      image: { base64: 'AAAA', mimeType: 'image/jpeg' },
      task: LABEL_SCAN_TASK,
    });

    assert.strictEqual(body.system, LABEL_SCAN_TASK.systemPrompt);
    assert.strictEqual(body.tools[0]?.name, 'record_label_reading');
    assert.strictEqual(body.tools[0]?.input_schema, LABEL_READING_JSON_SCHEMA);
    assert.deepStrictEqual(body.tool_choice, { type: 'tool', name: 'record_label_reading' });
  });
});
