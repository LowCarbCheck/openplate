/**
 * The micronutrient dimension (M135) — the vitamin and mineral figures the
 * LowCarbCheck food API reports per 100 g, plus the ONE reader every consumer
 * must go through and the three-state form encoding that carries them between
 * a search result and a stored log.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: a missing micronutrient is never a
 * zero. There are three distinct states, and collapsing any two of them is the
 * single biggest correctness trap in this feature:
 *
 *  - **The BLOCK is absent** — this food has no micronutrient dimension at all
 *    (a BLS- or FDC-origin row, an AI plate estimate, a hand-typed manual
 *    entry). Every nutrient is UNCOVERED for it.
 *  - **The block is present, the VALUE is `null`** — we looked, and the source
 *    has no figure for that specific nutrient. That one nutrient is UNCOVERED;
 *    its siblings in the same block may still be covered.
 *  - **The block is present, the value is a NUMBER (including `0`)** — a real
 *    measured figure. COVERED. A measured `0` is data: it must sum as 0 and
 *    count towards coverage, never be mistaken for a gap.
 *
 * `readNutrientPer100g` below is the only sanctioned way to get at a value,
 * and it deliberately returns a tagged result rather than `number | null` —
 * so there is nothing for a caller to `?? 0` in the first place.
 *
 * Pure types + string/number helpers plus one zod field — no store, no
 * browser, no React — so this unit-tests directly.
 */
import { z } from 'zod';

/**
 * The vitamin keys LCC's `content_foods.vitamins` JSONB carries, in the order
 * that column declares them. Kept as a `const` tuple so `VitaminKey` is a
 * closed union AND the list is iterable at runtime (the aggregation walks it).
 */
export const VITAMIN_KEYS = [
  'betaCarotene',
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminB1',
  'vitaminB2',
  'vitaminB6',
  'vitaminB9',
  'vitaminB12',
] as const;

/** The mineral keys LCC's `content_foods.minerals` JSONB carries. */
export const MINERAL_KEYS = [
  'nacl',
  'potassium',
  'sodium',
  'calcium',
  'magnesium',
  'zinc',
  'phosphorus',
  'iron',
] as const;

export type VitaminKey = (typeof VITAMIN_KEYS)[number];
export type MineralKey = (typeof MINERAL_KEYS)[number];

/** Every nutrient this app tracks, vitamins first then minerals. */
export type NutrientKey = VitaminKey | MineralKey;

/** All nutrient keys in one iterable list — the aggregation's loop domain. */
export const NUTRIENT_KEYS: readonly NutrientKey[] = [...VITAMIN_KEYS, ...MINERAL_KEYS];

/** True when `key` is one of the vitamin keys (the two blocks are stored apart). */
export function isVitaminKey(key: NutrientKey): key is VitaminKey {
  return VITAMIN_KEYS.some((vitamin) => vitamin === key);
}

/** One block's values: every key present, each `number | null` (`null` = source had no figure). */
export type NutrientBlock<K extends NutrientKey> = { readonly [P in K]: number | null };

export type Vitamins = NutrientBlock<VitaminKey>;
export type Minerals = NutrientBlock<MineralKey>;

/**
 * A food's per-100 g micronutrients. BOTH blocks are optional, and their
 * absence is meaningful and DIFFERENT from an all-`null` block: absent means
 * "this source has no vitamin/mineral dimension", all-`null` means "we have
 * the dimension and every figure in it happens to be unknown". Downstream both
 * read as uncovered, but only the first can ever become covered by a data
 * import upstream — so the parser must not normalize one into the other.
 */
export interface MicronutrientsPer100g {
  vitamins?: Vitamins;
  minerals?: Minerals;
}

/**
 * The result of looking one nutrient up on a food. A tagged union rather than
 * `number | null`, deliberately: a caller cannot reach `value` without first
 * narrowing on `state`, so there is no shape here that invites a `?? 0`.
 *
 *  - `measured` — a real figure (possibly `0`). Sum it; count it as covered.
 *  - `no-block` — this food has no such dimension at all. Uncovered.
 *  - `no-value` — the dimension exists, this nutrient's figure does not. Uncovered.
 */
export type NutrientReading =
  | { readonly state: 'measured'; readonly value: number }
  | { readonly state: 'no-block' }
  | { readonly state: 'no-value' };

const NO_BLOCK: NutrientReading = { state: 'no-block' };
const NO_VALUE: NutrientReading = { state: 'no-value' };

/** A stored figure becomes a `measured` reading; a missing or non-finite one stays `no-value`. */
function toReading(value: number | null): NutrientReading {
  return value !== null && Number.isFinite(value) ? { state: 'measured', value } : NO_VALUE;
}

/**
 * Reads one nutrient's per-100 g figure off a food's micronutrient snapshot —
 * THE single accessor. Preserves all three states (see this module's header);
 * an absent snapshot entirely is `no-block`, same as an absent block.
 *
 * @param micronutrients - the food's snapshot, or `undefined` when it has none.
 * @param key - the nutrient to read.
 * @returns a tagged reading that cannot be misread as a zero.
 */
export function readNutrientPer100g(
  micronutrients: MicronutrientsPer100g | undefined,
  key: NutrientKey,
): NutrientReading {
  if (!micronutrients) return NO_BLOCK;
  if (isVitaminKey(key)) {
    const vitamins = micronutrients.vitamins;
    return vitamins ? toReading(vitamins[key]) : NO_BLOCK;
  }
  const minerals = micronutrients.minerals;
  return minerals ? toReading(minerals[key]) : NO_BLOCK;
}

/** True when a snapshot carries at least one block — i.e. is worth storing at all. */
export function hasAnyMicronutrientBlock(micronutrients: MicronutrientsPer100g | undefined): boolean {
  if (!micronutrients) return false;
  return micronutrients.vitamins !== undefined || micronutrients.minerals !== undefined;
}

/** Deep copy of a snapshot (blocks included) — nothing hands out shared object identity. */
export function cloneMicronutrients(
  micronutrients: MicronutrientsPer100g | undefined,
): MicronutrientsPer100g | undefined {
  if (!micronutrients) return undefined;
  const copy: MicronutrientsPer100g = {};
  if (micronutrients.vitamins) copy.vitamins = { ...micronutrients.vitamins };
  if (micronutrients.minerals) copy.minerals = { ...micronutrients.minerals };
  return copy;
}

// ---------------------------------------------------------------------------
// Zod shape + form encoding
// ---------------------------------------------------------------------------

// `.catch(null)` per FIELD, not per block: an unexpected value for ONE
// nutrient must degrade to "unknown" rather than discard the whole block
// (and with it every sibling figure that parsed perfectly well). Same
// fail-open posture the food-resolution parser takes everywhere else.
const nutrientFieldSchema = z
  .number()
  .nullish()
  .transform((value) => value ?? null)
  .catch(null);

function blockSchema<K extends NutrientKey>(keys: readonly K[]): z.ZodType<NutrientBlock<K>> {
  // SAFETY: `fields` is built from `keys`, so it carries exactly one field per
  // `K` — which is what the mapped type states and `Object.fromEntries` forgets.
  const fields = Object.fromEntries(keys.map((key) => [key, nutrientFieldSchema])) as {
    [P in K]: typeof nutrientFieldSchema;
  };
  // SAFETY: the object's fields are exactly `keys`, each parsing to
  // `number | null`, so its parsed output IS a `NutrientBlock<K>` — zod's own
  // `ZodObject` type just can't be related to `ZodType` through the generic `K`.
  return z.object(fields) as z.ZodType<NutrientBlock<K>>;
}

/**
 * The per-100 g micronutrient snapshot as it appears on the wire and in a
 * backup envelope. Both blocks `.optional()` — absence is the "no dimension"
 * state and must survive a round trip (see this module's header).
 */
export const micronutrientsPer100gSchema: z.ZodType<MicronutrientsPer100g> = z.object({
  vitamins: blockSchema(VITAMIN_KEYS).optional(),
  minerals: blockSchema(MINERAL_KEYS).optional(),
});

/**
 * Encodes a snapshot into one form value. JSON rather than 18 hidden inputs:
 * the blocks are opaque to the form (nothing in the UI edits an individual
 * vitamin), and one value keeps the absent-block distinction intact for free.
 *
 * `''` means "no snapshot at all", mirroring `encodeAuthoritativeNetCarbs`'s
 * empty-string convention for the same "never captured" state.
 */
export function encodeMicronutrients(value: MicronutrientsPer100g | undefined): string {
  if (!hasAnyMicronutrientBlock(value)) return '';
  return JSON.stringify(value);
}

/**
 * Decodes one form value back into a snapshot.
 *
 * FAILS OPEN, never throws: every writer of this field is our own hidden input
 * (never a user-typed control), so a malformed value is a bug upstream, not bad
 * user input — and refusing the whole log over it would block a person from
 * tracking their food. Anything unparseable degrades to `undefined`, i.e. "no
 * micronutrients captured", which is exactly the uncovered state the
 * aggregation already handles honestly. It never degrades to a block of zeros.
 */
export function decodeMicronutrients(raw: string | null | undefined): MicronutrientsPer100g | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const result = micronutrientsPer100gSchema.safeParse(parsed);
  if (!result.success) return undefined;
  return hasAnyMicronutrientBlock(result.data) ? result.data : undefined;
}

/**
 * The zod field every action parsing this value should use, so the encoding
 * lives in exactly one place (the `authoritativeNetCarbsField` precedent).
 */
/** The hidden input as it arrives from a form submission; anything else reads as absent. */
const submittedFieldValue = z.string().nullish().catch(undefined);

export const micronutrientsField = z.preprocess(
  (raw) => decodeMicronutrients(submittedFieldValue.parse(raw)),
  micronutrientsPer100gSchema.optional(),
);
