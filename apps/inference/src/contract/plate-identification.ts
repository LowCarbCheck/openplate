/**
 * The `PlateIdentification` wire contract — VENDORED, transcribed by hand from
 * `openplate/app/services/vision/schema.ts`.
 *
 * WHY VENDORED RATHER THAN A SHARED PACKAGE. The original plan (spec 02) was to
 * publish the Zod schema as `@sprqvntrs/*` and have both repos depend on it, so
 * drift became a compile error. That is dead: `@sprqvntrs/*` lives on GitHub
 * Packages, which requires an auth token even to install a PUBLIC package. This
 * repo is MIT and meant to be `git clone && docker compose up` for a stranger —
 * a private-registry token in the install path is a non-starter. So: a
 * transcribed copy, plus `tests/unit/schema-parity.test.ts`, which reads
 * openplate's file directly when the sibling checkout is present (it is, in the
 * dev workspace) and skips loudly when it is not (a self-hoster has no openplate
 * checkout, and a hard failure there would be noise, not a signal).
 *
 * This is the same duplication discipline `openplate-sync/src/protocol.ts` uses
 * for the sync wire contract, for the same reason and with the same cost:
 * changing the contract is FOUR edits (two sources, two tests).
 *
 * SHAPE RULES, inherited from openplate's file and not to be "tidied":
 *  - Every field is required; `.nullable()` (never `.optional()`) stands in for
 *    "the model doesn't know". That is what makes it OpenAI strict-mode legal.
 *  - `additionalProperties: false` and a full `required` list on every object in
 *    the derived JSON Schema.
 *  - The client validates with `parsePlateIdentificationJson` and THROWS on a
 *    mismatch. A near-miss shape is a hard client failure, not a degradation.
 */
import { z } from 'zod';

export const MacrosSchema = z.object({
  carbs: z.number().nullable(),
  fiber: z.number().nullable(),
  sugars: z.number().nullable(),
  polyols: z.number().nullable(),
  protein: z.number().nullable(),
  fat: z.number().nullable(),
  kcal: z.number().nullable(),
});

/**
 * The base per-item shape, byte-for-byte the client's contract. Kept separate
 * from `IdentifiedFoodSchema` so the parity test can compare exactly this
 * against openplate's `RawIdentifiedFoodSchema` without the two forward-looking
 * fields below counting as drift.
 */
export const BaseIdentifiedFoodSchema = z.object({
  name: z.string(),
  estimatedGrams: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  /** Short everyday-size comparison ("about half the plate"); null when nothing natural fits. */
  portionHint: z.string().nullable(),
  macrosPer100g: MacrosSchema.nullable(),
});

/**
 * Per-item shape as this SERVICE models it: the client contract plus two
 * forward-looking fields.
 *
 * `provenance` and `attribution` exist from day one and are UNUSED until spec 04
 * (corpus-backed nutrition resolution). Spec 04 must report whether a macro row
 * came from the food corpus or from the model, and must carry the resolving
 * source's attribution string — a CC BY 4.0 obligation for BLS-derived data.
 * Adding them later would be a coordinated two-repo release; adding them now
 * costs nothing because they are `.optional()` and are OMITTED from every
 * response this spec emits. (`.optional()`, not `.nullable()`: these are ours,
 * not the model's, so "absent" is the honest encoding and it keeps the emitted
 * JSON identical to the client's contract until 04 fills them in.)
 */
export const IdentifiedFoodSchema = BaseIdentifiedFoodSchema.extend({
  provenance: z.enum(['corpus', 'model']).optional(),
  attribution: z.string().nullable().optional(),
});

/** The base plate shape — exactly what openplate validates. Used by the parity test. */
export const BasePlateIdentificationSchema = z.object({
  foods: z.array(BaseIdentifiedFoodSchema),
  notes: z.string().nullable(),
});

export const PlateIdentificationSchema = z.object({
  foods: z.array(IdentifiedFoodSchema),
  notes: z.string().nullable(),
});

export type PlateIdentification = z.infer<typeof PlateIdentificationSchema>;
export type IdentifiedFood = z.infer<typeof IdentifiedFoodSchema>;
export type Macros = z.infer<typeof MacrosSchema>;

/**
 * Minimal recursive JSON Schema shape we post-process. Only the keywords the
 * plate schema actually emits are modeled.
 */
export interface JsonSchemaNode {
  $schema?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  enum?: unknown[];
  minItems?: number;
  maxItems?: number;
}

/**
 * Recursively enforces OpenAI strict-mode rules: every object node gets
 * `additionalProperties: false` and lists all its properties as `required`.
 * Transcribed from openplate's `applyStrictModeRules`.
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

/** Drops the draft `$schema` keyword and applies the strict-mode rules. */
export function toStrictJsonSchema(raw: z.core.JSONSchema.BaseSchema): JsonSchemaNode {
  // SAFETY: `raw` is a draft-2020-12 schema document and `JsonSchemaNode` models
  // a subset of its keywords — every field is optional there, so the assertion
  // cannot claim a property is present. `structuredClone` runs first, so the
  // mutation below cannot reach zod's own object.
  const cloned = structuredClone(raw) as JsonSchemaNode;
  delete cloned.$schema;
  applyStrictModeRules(cloned);
  return cloned;
}

/**
 * JSON Schema (draft 2020-12) for the CLIENT-facing contract — derived from the
 * BASE schema, so the response shape stays byte-identical to what openplate
 * expects while `provenance`/`attribution` wait for spec 04.
 */
export const PLATE_IDENTIFICATION_JSON_SCHEMA: JsonSchemaNode = toStrictJsonSchema(
  z.toJSONSchema(BasePlateIdentificationSchema),
);

/**
 * Validates a value against the plate contract. Used on our OWN outbound
 * payload — the response is built in code from the terse model output, so this
 * is a self-check that a mapping bug can never ship a shape the client will
 * reject.
 */
export function validatePlateIdentification(plate: PlateIdentification): PlateIdentification {
  return PlateIdentificationSchema.parse(plate);
}
