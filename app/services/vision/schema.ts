/**
 * Zod schema + parsing for the vision provider's JSON response. Shared by
 * every adapter so validation behavior is identical regardless of provider,
 * AND it is the single source of truth for the JSON Schema handed to providers
 * for enforced structured output (`PLATE_IDENTIFICATION_JSON_SCHEMA`).
 *
 * This is an LLM-facing schema: every field a provider is ASKED for is
 * required, with `.nullable()` (never `.optional()`) standing in for "the model
 * doesn't know" — see the `zod-llm-schemas` skill. Because it's
 * all-required-with-nullable it is strict-mode compatible.
 * `normalizePlateIdentification` then converts the nullable raw shape into the
 * app-facing `PlateIdentification` type (with `?:` optional fields) used
 * everywhere else.
 *
 * The one deliberate exception is the pair of optional provenance fields a
 * self-hosted openplate-inference server may add (M138 spec 06): we accept
 * them, we never require them, and they are kept out of the provider-facing
 * JSON Schema. That is why the parse schema and the generation schema are two
 * objects below rather than one.
 */
import { z } from 'zod';
import type { IdentifiedFood, IdentifiedFoodMacros, PlateIdentification } from './types';
import { MACRO_PROVENANCE_VALUES, VisionProviderError } from './types';

const RawMacrosSchema = z.object({
  carbs: z.number().nullable(),
  fiber: z.number().nullable(),
  sugars: z.number().nullable(),
  polyols: z.number().nullable(),
  protein: z.number().nullable(),
  fat: z.number().nullable(),
  kcal: z.number().nullable(),
});

/**
 * The item shape EVERY provider is ASKED to produce — the source of the
 * provider-facing `PLATE_IDENTIFICATION_JSON_SCHEMA` below. All-required, with
 * `.nullable()` for "don't know", so it survives OpenAI strict mode intact.
 *
 * Nothing optional may ever be added here; that's what
 * `RawIdentifiedFoodParseSchema` is for.
 */
const RawIdentifiedFoodSchema = z.object({
  name: z.string(),
  estimatedGrams: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  /** Short everyday-size comparison ("about half the plate"); null when nothing natural fits. */
  portionHint: z.string().nullable(),
  macrosPer100g: RawMacrosSchema.nullable(),
});

/**
 * THE WIRE CONTRACT: what every provider is told to return, and the only
 * schema `PLATE_IDENTIFICATION_JSON_SCHEMA` is derived from. Deliberately
 * unchanged by M138 spec 06 — see `PlateIdentificationParseSchema`.
 */
export const PlateIdentificationSchema = z.object({
  foods: z.array(RawIdentifiedFoodSchema),
  notes: z.string().nullable(),
});

/**
 * The item shape we ACCEPT — the wire shape plus two optional provenance
 * fields (M138 spec 06). A self-hosted openplate-inference server resolves
 * some items' macros against a food corpus and reports which ones, together
 * with the source's licence attribution (a CC BY obligation for BLS-derived
 * data); every cloud provider omits both.
 *
 * ASYMMETRY IS THE POINT — read this before "simplifying" the two schemas into
 * one. `toStrictJsonSchema` forces every property of every object into
 * `required` (OpenAI strict structured output demands exactly that), and Zod
 * emits an optional field into `properties` while leaving it out of `required`.
 * So folding these fields into `PlateIdentificationSchema` would hand
 * Gemini-via-OpenRouter a contract obliging it to invent a `provenance` for
 * every food it sees. Tolerate-and-preserve on the way in; never demand on the
 * way out.
 */
const RawIdentifiedFoodParseSchema = RawIdentifiedFoodSchema.extend({
  provenance: z.enum(MACRO_PROVENANCE_VALUES).optional(),
  attribution: z.string().nullable().optional(),
});

/**
 * What `validatePlateIdentification` / `parsePlateIdentificationJson` actually
 * validate against: the wire schema widened by the optional fields above. Never
 * handed to a provider.
 */
const PlateIdentificationParseSchema = z.object({
  foods: z.array(RawIdentifiedFoodParseSchema),
  notes: z.string().nullable(),
});

/**
 * Any value `JSON.parse` — or a provider's structured-output block — can yield,
 * before this module validates it. A closed JSON value type rather than
 * `unknown`: the input is always JSON, it just isn't trusted yet.
 */
export type UnvalidatedProviderJson = z.infer<ReturnType<typeof z.json>>;

type RawPlateIdentification = z.infer<typeof PlateIdentificationParseSchema>;
type RawIdentifiedFood = z.infer<typeof RawIdentifiedFoodParseSchema>;
type RawMacros = z.infer<typeof RawMacrosSchema>;

function stripNullMacros(macros: RawMacros): IdentifiedFoodMacros {
  const result: IdentifiedFoodMacros = {};
  if (macros.carbs !== null) result.carbs = macros.carbs;
  if (macros.fiber !== null) result.fiber = macros.fiber;
  if (macros.sugars !== null) result.sugars = macros.sugars;
  if (macros.polyols !== null) result.polyols = macros.polyols;
  if (macros.protein !== null) result.protein = macros.protein;
  if (macros.fat !== null) result.fat = macros.fat;
  if (macros.kcal !== null) result.kcal = macros.kcal;
  return result;
}

/**
 * One raw item → the app-facing shape. The two provenance fields are assigned
 * only when the provider actually sent them, so "absent" and "null" both land
 * on `undefined` — same convention as `portionHint` and the macro fields, and
 * the reason a cloud provider's response is byte-for-byte unaffected by their
 * existence.
 */
function normalizeFood(food: RawIdentifiedFood): IdentifiedFood {
  const normalized: IdentifiedFood = {
    name: food.name,
    estimatedGrams: food.estimatedGrams,
    confidence: food.confidence,
    portionHint: food.portionHint ?? undefined,
    macrosPer100g: food.macrosPer100g ? stripNullMacros(food.macrosPer100g) : undefined,
  };
  if (food.provenance !== undefined) normalized.provenance = food.provenance;
  if (food.attribution !== undefined && food.attribution !== null) normalized.attribution = food.attribution;
  return normalized;
}

export function normalizePlateIdentification(raw: RawPlateIdentification): PlateIdentification {
  return {
    foods: raw.foods.map(normalizeFood),
    notes: raw.notes ?? undefined,
  };
}

/**
 * Validates an already-parsed value (from JSON text OR a provider's enforced
 * structured-output block) against the schema, returning the normalized
 * app-facing shape. Pure — no I/O — so both the text-parse path and the
 * enforced-output path funnel through the same validation.
 *
 * @throws {VisionProviderError} when `value` doesn't match the expected shape.
 */
export function validatePlateIdentification(value: UnvalidatedProviderJson): PlateIdentification {
  const result = PlateIdentificationParseSchema.safeParse(value);
  if (!result.success) {
    throw new VisionProviderError('Vision provider response did not match the expected shape', {
      cause: result.error,
    });
  }
  return normalizePlateIdentification(result.data);
}

/** Strips a leading/trailing markdown code fence (```json ... ``` or ``` ... ```) if present. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Parses raw LLM output text into a validated `PlateIdentification`.
 * Tolerates markdown-fenced JSON. Pure — no I/O — so it's directly unit
 * testable without mocking `fetch`. This is the universal fallback path used
 * whenever a provider returns free-text JSON instead of enforced output.
 *
 * @throws {VisionProviderError} on non-JSON input or a shape mismatch.
 */
export function parsePlateIdentificationJson(rawText: string): PlateIdentification {
  const jsonText = stripCodeFence(rawText);

  let parsedJson: UnvalidatedProviderJson;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (error) {
    throw new VisionProviderError('Vision provider returned a response that was not valid JSON', {
      cause: error,
    });
  }

  return validatePlateIdentification(parsedJson);
}

////////////////////////////////////////////////////////////////////////////////
// JSON Schema for enforced structured output
////////////////////////////////////////////////////////////////////////////////

/**
 * Minimal recursive JSON Schema shape we post-process. Only the keywords the
 * plate schema actually emits are modeled; `unknown`-typed leaves are left
 * untouched. Not a full JSON Schema type — just enough to walk objects safely
 * without `any`.
 */
interface JsonSchemaNode {
  $schema?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
}

/**
 * Recursively enforces OpenAI strict-mode rules on a JSON Schema tree: every
 * object node gets `additionalProperties: false` and lists all its properties
 * as `required`. Because the source Zod schema is all-required-with-nullable,
 * this never drops a field — it just makes the requirement explicit and robust
 * to Zod's output defaults.
 */
function applyStrictModeRules(node: JsonSchemaNode): void {
  if (node.properties) {
    for (const child of Object.values(node.properties)) applyStrictModeRules(child);
    node.additionalProperties = false;
    node.required = Object.keys(node.properties);
  }
  if (node.items) applyStrictModeRules(node.items);
  for (const branch of [node.anyOf, node.allOf, node.oneOf]) {
    if (branch) for (const child of branch) applyStrictModeRules(child);
  }
}

/**
 * Post-processes Zod's JSON Schema output for provider strict structured
 * output: drops the draft `$schema` keyword (providers infer the dialect and
 * some strict validators reject unknown top-level keywords) and applies the
 * strict-mode rules above in this one place.
 */
function toStrictJsonSchema(schema: z.ZodType): JsonSchemaNode {
  // SAFETY: `z.toJSONSchema` emits a plain JSON-Schema object tree and
  // `structuredClone` deep-copies it, so `cloned` is a fresh, own-property-only
  // schema node; `JsonSchemaNode` models exactly the keywords the plate schema
  // emits and leaves every unmodeled leaf untouched.
  const cloned = structuredClone(z.toJSONSchema(schema)) as JsonSchemaNode;
  delete cloned.$schema;
  applyStrictModeRules(cloned);
  return cloned;
}

/**
 * JSON Schema (draft 2020-12) derived from `PlateIdentificationSchema` — the
 * single maintainable source of truth — for provider-enforced structured
 * output (OpenAI `json_schema` response_format, Anthropic tool `input_schema`).
 *
 * Derived from the WIRE schema, never the parse schema: `applyStrictModeRules`
 * would turn the parse schema's optional provenance fields into required ones
 * for every provider. See `RawIdentifiedFoodParseSchema` for the full
 * reasoning.
 */
export const PLATE_IDENTIFICATION_JSON_SCHEMA: JsonSchemaNode = toStrictJsonSchema(PlateIdentificationSchema);
