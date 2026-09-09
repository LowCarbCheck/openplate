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
 * This is the same duplication discipline `openplate-core/src/protocol.ts` uses
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
 * Where one item's macros came from: `'estimated'` (the model looking at
 * food) or `'label'` (the model transcribing a printed nutrition panel). See
 * openplate's `MacroSource` (`app/services/vision/types.ts`) — this replaced
 * the old label-scan MODE (openplate commit b770563, "one photo path, and the
 * model decides what the picture shows").
 */
export const MACRO_SOURCE_VALUES = ['estimated', 'label'] as const;

/**
 * Which printed-panel convention a `'label'` item's carbs figure uses: `total`
 * (US, fibre-inclusive) or `available` (EU, fibre-exclusive). See openplate's
 * `CarbBasis` (`#app/lib/net-carbs`).
 */
export const CARB_BASES = ['total', 'available'] as const;

/**
 * The serving a panel prints, as the model reports it for a `'label'` item.
 * `asPrinted` is not nullable because the whole block is: a serving with no
 * printed text is not a serving, it is an absent one.
 */
export const ServingSizeSchema = z.object({
  asPrinted: z.string(),
  grams: z.number().nullable(),
});

/**
 * The base per-item shape, byte-for-byte the client's contract. Kept separate
 * from `IdentifiedFoodSchema` so the parity test can compare exactly this
 * against openplate's `RawIdentifiedFoodSchema` without the two forward-looking
 * fields below counting as drift.
 *
 * `macroSource`, `brand`, `servingSize` and `carbBasis` (openplate commit
 * b770563, "one photo path, and the model decides what the picture shows")
 * are the folded-in label reading: one prompt now decides PER ITEM whether it
 * is estimating food or transcribing a printed panel, and answers with one
 * `foods[]` array either way.
 */
export const BaseIdentifiedFoodSchema = z.object({
  name: z.string(),
  estimatedGrams: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  /** Short everyday-size comparison ("about half the plate"); null when nothing natural fits. */
  portionHint: z.string().nullable(),
  macrosPer100g: MacrosSchema.nullable(),
  /** Estimated from looking at food, or transcribed off a printed panel. */
  macroSource: z.enum(MACRO_SOURCE_VALUES),
  /** The manufacturer, when a package named one. Null for anything unbranded, and never invented. */
  brand: z.string().nullable(),
  /** The printed serving, for a label item. Null for an estimated one. */
  servingSize: ServingSizeSchema.nullable(),
  /**
   * Which printed-panel convention this item's carbs figure uses. Null for an
   * estimated item, and null when a panel's layout does not decide it, never
   * a guess. `.catch(null)`, mirroring openplate: every other field here
   * stays strict, but a provider that emits an unrecognised value has clearly
   * still read the panel, and `null` already means "not decided".
   */
  carbBasis: z.enum(CARB_BASES).nullable().catch(null),
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
  /**
   * The model's own "I could not read this photograph" answer (openplate
   * commit b770563). A statement about the whole picture, not about one food
   * on it — a photograph with legible items and one unreadable packet is not
   * unreadable, and the model says so per item instead, by leaving that
   * item's macros null.
   */
  unreadable: z.boolean(),
  unreadableReason: z.string().nullable(),
  notes: z.string().nullable(),
});

export const PlateIdentificationSchema = z.object({
  foods: z.array(IdentifiedFoodSchema),
  unreadable: z.boolean(),
  unreadableReason: z.string().nullable(),
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
