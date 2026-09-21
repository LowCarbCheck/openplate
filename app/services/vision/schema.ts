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
import type { IdentifiedFood, IdentifiedFoodMacros, PlateIdentification, PrintedServingSize } from './types';
import { MACRO_PROVENANCE_VALUES, MACRO_SOURCE_VALUES, VisionProviderError } from './types';
import { CARB_BASES } from '#app/lib/net-carbs';

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
 * The serving a panel prints, as the model reports it for a `'label'` item.
 * `asPrinted` is not nullable because the whole block is: a serving with no
 * printed text is not a serving, it is an absent one.
 */
const RawServingSizeSchema = z.object({
  asPrinted: z.string(),
  grams: z.number().nullable(),
});

////////////////////////////////////////////////////////////////////////////////
// Food flags (M219 spec 01)
////////////////////////////////////////////////////////////////////////////////

/**
 * THE MODEL CLASSIFIES, THE APP DECIDES (M219 D1). Every food comes back with
 * the pregnancy categories it falls into and the EU 14 allergens it carries,
 * filled for EVERY food regardless of who is asking. Nothing about the person
 * goes into the request: the reproductive status and the allergy list stay on
 * the device, and which flag becomes a visible chip is a pure decision made
 * there (spec 03). The lists live HERE, beside the schema that asks for them,
 * the same way `PANTRY_CATEGORIES` lives beside the pantry schema, so the
 * profile (spec 02) and the chip (spec 03) import one vocabulary.
 *
 * The v1 pregnancy list is the categories the UK NHS, the German BfR and the
 * US ACOG agree on. Each row names the bodies that list it, so the table can
 * be re-checked without redoing the research (D1b). The two categories only
 * the BfR lists (a tonic drink, a seed) are deliberately NOT in v1 (D1a); the
 * milestone README names them, this file must not, so an absence grep holds.
 */
export const PREGNANCY_CATEGORIES = [
  /** Unpasteurised milk and anything made from it. NHS, BfR, ACOG. */
  'raw-dairy',
  /** Mould-ripened and blue soft cheese, brie and camembert included. NHS, BfR, ACOG. */
  'soft-cheese',
  /** Raw or undercooked meat, cured raw meat and pate included. NHS, BfR, ACOG. */
  'raw-meat',
  /** Raw or lightly cooked egg, and dishes made with it. NHS, BfR, ACOG. */
  'raw-egg',
  /** Raw fish and raw shellfish, sushi and oysters included. NHS, BfR, ACOG. */
  'raw-fish',
  /** Cold-smoked fish, smoked salmon and gravlax included. BfR, ACOG. */
  'smoked-fish',
  /** Shark, swordfish, marlin, king mackerel, bigeye tuna; tuna limited. NHS, BfR, ACOG. */
  'high-mercury-fish',
  /** Liver, liver products and retinol supplements. NHS, BfR, ACOG. */
  'liver-retinol',
  /** Any alcoholic drink or dish that keeps its alcohol. NHS, BfR, ACOG. */
  'alcohol',
  /** Coffee, strong tea, energy drinks; limited to 200 mg a day. NHS, BfR, ACOG. */
  'caffeine',
  /** Raw sprouts and raw sprouted seeds. BfR, ACOG. */
  'raw-sprouts',
] as const;
export type PregnancyCategory = (typeof PREGNANCY_CATEGORIES)[number];

/** The 14 allergens EU Regulation 1169/2011 Annex II requires a label to declare. */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

/**
 * The parsed flags on one food, three arrays that are always present so no
 * consumer handles `undefined`. `allergens` is what the food CONTAINS, an
 * ingredient the model can see or name. `mayContain` is what the model cannot
 * rule out: a hidden ingredient, likely cross-contact, or a dish whose recipe
 * varies (D1e). An allergen is never in both; `normalizeFoodFlags` keeps it in
 * `allergens` only, so a chip never says "contains" and "may contain" at once.
 */
export interface FoodFlags {
  pregnancy: PregnancyCategory[];
  allergens: Allergen[];
  mayContain: Allergen[];
}

/**
 * The flags shape every provider is ASKED for: three enum arrays, all
 * required, so a strict structured-output provider is never handed an optional
 * field it would reject (D1d). Two arrays over one enum rather than one array
 * of objects, because those providers handle an enum array well and an object
 * array poorly, and because an older prompt that knows only `allergens` still
 * parses.
 */
const RawFoodFlagsSchema = z.object({
  pregnancy: z.array(z.enum(PREGNANCY_CATEGORIES)),
  allergens: z.array(z.enum(ALLERGENS)),
  mayContain: z.array(z.enum(ALLERGENS)),
});

/**
 * The item shape EVERY provider is ASKED to produce — the source of the
 * provider-facing `PLATE_IDENTIFICATION_JSON_SCHEMA` below. All-required, with
 * `.nullable()` for "don't know", so it survives OpenAI strict mode intact.
 *
 * Nothing optional may ever be added here; that's what
 * `RawIdentifiedFoodParseSchema` is for.
 *
 * ── The label merge (amends ADR-0005, 2026-09-08) ────────────────────────
 *
 * `macroSource`, `brand`, `servingSize` and `carbBasis` are what used to be a
 * whole second schema (`LabelReadingSchema`) behind a mode the person had to
 * choose before the shutter. One prompt now decides per ITEM, which is the
 * only way a photograph of a packet standing beside a plate of food can be
 * answered honestly, and the answer is always this one array.
 */
const RawIdentifiedFoodSchema = z.object({
  name: z.string(),
  estimatedGrams: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  /** Short everyday-size comparison ("about half the plate"); null when nothing natural fits. */
  portionHint: z.string().nullable(),
  macrosPer100g: RawMacrosSchema.nullable(),
  /** Estimated from looking at food, or transcribed off a printed panel. */
  macroSource: z.enum(MACRO_SOURCE_VALUES),
  /** The manufacturer, when a package named one. Null for anything unbranded, and never invented. */
  brand: z.string().nullable(),
  /** The printed serving, for a label item. Null for an estimated one. */
  servingSize: RawServingSizeSchema.nullable(),
  /**
   * Which printed-panel convention this item's carbs figure uses, see
   * `IdentifiedFood.carbBasis`. Null for an estimated item, and null when a
   * panel's layout does not decide it, never a guess.
   *
   * `.catch(null)` (carried over from the label schema it replaces): every
   * other field here stays strict, because a response this schema cannot parse
   * at all is not safely usable. This one is different. A provider that emits
   * `"eu"` instead of `"available"` has clearly still read the panel and
   * reported real macro numbers around it, and `null` already means exactly
   * "not decided", a pre-existing, harmless state the rest of the app
   * handles. Discarding tokens already spent and an otherwise-good reading
   * over ONE enum mismatch, on the one field with a built-in "don't know",
   * would be strictness with no payoff. `.catch()` only changes behaviour at
   * PARSE time; `z.toJSONSchema` still emits the same `enum` constraint, so
   * providers are still ASKED for exactly `"total" | "available" | null`.
   */
  carbBasis: z.enum(CARB_BASES).nullable().catch(null),
  /**
   * See {@link RawFoodFlagsSchema}. Strict HERE, because this is what the
   * provider is asked for; the parse side widens it (`RawIdentifiedFoodParseSchema`),
   * so a plate never fails over one invented category.
   */
  flags: RawFoodFlagsSchema,
});

/**
 * THE WIRE CONTRACT: what every provider is told to return, and the only
 * schema `PLATE_IDENTIFICATION_JSON_SCHEMA` is derived from. Deliberately
 * unchanged by M138 spec 06 — see `PlateIdentificationParseSchema`.
 */
export const PlateIdentificationSchema = z.object({
  foods: z.array(RawIdentifiedFoodSchema),
  /**
   * The model's own "I could not read this photograph" answer. See
   * `PlateIdentification.unreadable` for why it is a statement about the whole
   * picture rather than about one item on it.
   */
  unreadable: z.boolean(),
  unreadableReason: z.string().nullable(),
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
/**
 * One flag list as it may ARRIVE: any strings, or nothing at all. The wire
 * schema asks for the enum; this accepts whatever came back and leaves the
 * narrowing to `normalizeFoodFlags`, so an invented word costs one word and
 * never the plate (M219 D2).
 */
const LenientFlagListSchema = z.array(z.string()).nullish();

/**
 * The flags object as it may ARRIVE. `mayContain` was added after
 * `allergens` (D1e), so a prompt that predates it sends two keys, and a BYOK
 * model that ignores the field sends none; both parse.
 */
const LenientFoodFlagsSchema = z.object({
  pregnancy: LenientFlagListSchema,
  allergens: LenientFlagListSchema,
  mayContain: LenientFlagListSchema,
});

const RawIdentifiedFoodParseSchema = RawIdentifiedFoodSchema.extend({
  provenance: z.enum(MACRO_PROVENANCE_VALUES).optional(),
  attribution: z.string().nullable().optional(),
  // THE JSON SCHEMA IS STRICT, THE ZOD SCHEMA IS LENIENT (D1d): the field is
  // demanded on the way out and tolerated on the way in.
  flags: LenientFoodFlagsSchema.nullish(),
});

/**
 * What `validatePlateIdentification` / `parsePlateIdentificationJson` actually
 * validate against: the wire schema widened by the optional fields above. Never
 * handed to a provider.
 */
const PlateIdentificationParseSchema = z.object({
  foods: z.array(RawIdentifiedFoodParseSchema),
  unreadable: z.boolean(),
  unreadableReason: z.string().nullable(),
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
type RawFoodFlags = z.infer<typeof LenientFoodFlagsSchema>;

/**
 * Vite substitutes `import.meta.env.DEV` at build time. Under plain Node,
 * where the unit tier runs, `import.meta.env` is undefined, which reads as
 * "not development": the tier is silent by default, and a test that wants the
 * warning switches it on through `normalizeFoodFlags`'s `isDev` option.
 */
function isDevBuild(): boolean {
  return Boolean(import.meta.env) && import.meta.env.DEV === true;
}

/**
 * The known members of one arriving list, in arrival order, without repeats.
 * Every unknown string is dropped and, in development only, reported: a silent
 * filter hides a prompt that has drifted, and a production log line would
 * name a food the person photographed (M219 D2).
 */
function keepKnownFlags<TFlag extends string>(options: {
  field: keyof FoodFlags;
  arrived: readonly string[] | null | undefined;
  known: readonly TFlag[];
  isDev: boolean;
}): TFlag[] {
  const kept: TFlag[] = [];
  for (const value of options.arrived ?? []) {
    const match = options.known.find((flag) => flag === value);
    if (match === undefined) {
      if (options.isDev) console.warn(`[vision] dropped unknown flags.${options.field} value "${value}"`);
      continue;
    }
    if (!kept.includes(match)) kept.push(match);
  }
  return kept;
}

/**
 * The arriving flags, or their absence, to the three arrays every consumer
 * relies on. Exported with `isDev` as an option, rather than read inside, so
 * the unit tier can prove the warning fires in development and stays silent
 * otherwise without owning a Vite build. `normalizeFood` passes the real
 * answer.
 */
export function normalizeFoodFlags(
  arrived: RawFoodFlags | null | undefined,
  options: { isDev: boolean } = { isDev: isDevBuild() },
): FoodFlags {
  const isDev = options.isDev;
  const pregnancy = keepKnownFlags({ field: 'pregnancy', arrived: arrived?.pregnancy, known: PREGNANCY_CATEGORIES, isDev });
  const allergens = keepKnownFlags({ field: 'allergens', arrived: arrived?.allergens, known: ALLERGENS, isDev });
  const mayContain = keepKnownFlags({ field: 'mayContain', arrived: arrived?.mayContain, known: ALLERGENS, isDev })
    // CONTAINS WINS. An allergen the model named in both lists is a certainty
    // and a doubt about the same thing; the certainty is the one to keep (D1e).
    .filter((allergen) => !allergens.includes(allergen));
  return { pregnancy, allergens, mayContain };
}

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
/**
 * One raw serving block → the app-facing shape. A null weight becomes an
 * absent one, never a 0: a panel that printed "2 pieces" with no gram figure
 * has told us the text and nothing else, and a 0 there would offer the person
 * a portion chip that logs nothing.
 */
function normalizeServingSize(serving: z.infer<typeof RawServingSizeSchema>): PrintedServingSize {
  const normalized: PrintedServingSize = { asPrinted: serving.asPrinted };
  if (serving.grams !== null) normalized.grams = serving.grams;
  return normalized;
}

function normalizeFood(food: RawIdentifiedFood): IdentifiedFood {
  const normalized: IdentifiedFood = {
    name: food.name,
    estimatedGrams: food.estimatedGrams,
    confidence: food.confidence,
    portionHint: food.portionHint ?? undefined,
    macrosPer100g: food.macrosPer100g ? stripNullMacros(food.macrosPer100g) : undefined,
    macroSource: food.macroSource,
    flags: normalizeFoodFlags(food.flags),
  };
  // NULL BECOMES ABSENT, the same convention every other field here uses. A
  // brand of `''` or a `carbBasis` of `'total'` invented for an estimated item
  // would each be a claim about a package that was never photographed.
  if (food.brand !== null && food.brand.trim() !== '') normalized.brand = food.brand.trim();
  if (food.servingSize !== null) normalized.servingSize = normalizeServingSize(food.servingSize);
  if (food.carbBasis !== null) normalized.carbBasis = food.carbBasis;
  if (food.provenance !== undefined) normalized.provenance = food.provenance;
  if (food.attribution !== undefined && food.attribution !== null) normalized.attribution = food.attribution;
  return normalized;
}

export function normalizePlateIdentification(raw: RawPlateIdentification): PlateIdentification {
  return {
    foods: raw.foods.map(normalizeFood),
    unreadable: raw.unreadable,
    unreadableReason: raw.unreadableReason ?? undefined,
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
 *
 * EXPORTED, because the strict-mode rules are a property of the PROVIDER and
 * not of the task: `./pantry-schema` derives its own wire schema through this
 * same function rather than carrying a second copy of rules that would then
 * have two places to drift.
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchemaNode {
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
