/**
 * Food cautions (M219/03): the pure decision that turns the model's raw flags
 * on one food plus the local profile into the chips a person sees, and the
 * two small codecs that carry those raw flags through a form and back.
 *
 * ── The decision runs on the device, at render time (D3, D6) ───────────────
 *
 * The model flags EVERY food it parses, whoever is asking (spec 01), and
 * nothing about the person leaves the device (spec 02). This module is the
 * join: `decideCautions` reads the flags a log row stores and the status and
 * the allergy list the profile stores, and answers with the chips. Nothing
 * here is persisted. A log row keeps the RAW flags, never the decision, so a
 * person who changes their status or their allergy list sees every old entry
 * re-evaluated on the next render, with no migration and no stale chip.
 *
 * ── The table (D3) ─────────────────────────────────────────────────────────
 *
 *  - `pregnant`: every pregnancy category shows.
 *  - `lactating`: `alcohol`, `caffeine` and `high-mercury-fish` only.
 *  - `none`, `null` or unset: no pregnancy chip at all.
 *  - An allergen chip shows whenever the person listed that allergen, for
 *    every status including `none`. A flag in `allergens` is a `contains`
 *    caution; one in `mayContain` is a `may-contain` caution (spec 01 D1e).
 *
 * ── Two tiers (D5a) ────────────────────────────────────────────────────────
 *
 * Every pregnancy category except `caffeine` is `avoid`; `caffeine` is
 * `limit`, because a cup of coffee is allowed and counts toward 200 mg a day,
 * while a raw egg is not allowed at all. An allergen caution is always
 * `avoid`. The chip picks its tone from the tier and nothing else.
 *
 * Pure: no store, no DOM, no clock, no i18n. The chip component owns the
 * words; this file owns the facts.
 */
import { z } from 'zod';
import {
  ALLERGENS,
  LenientFoodFlagsSchema,
  PREGNANCY_CATEGORIES,
  normalizeFoodFlags,
} from '#app/services/vision/schema';
import type { Allergen, FoodFlags, PregnancyCategory } from '#app/services/vision/schema';
import type { LocalProfileGoals, ReproductiveStatus } from '#app/lib/local-store/schema';

/** How strongly a caution speaks: avoid the food, or keep it within a limit. */
export type CautionTier = 'avoid' | 'limit';

/** Whether the model saw the allergen, or only could not rule it out. */
export type AllergenCertainty = 'contains' | 'may-contain';

/** One chip's worth of fact, the discriminant is `kind`. */
export type FoodCaution =
  | { kind: 'pregnancy'; category: PregnancyCategory; tier: CautionTier }
  | { kind: 'allergen'; allergen: Allergen; tier: 'avoid'; certainty: AllergenCertainty };

/**
 * The two profile facts the decision reads, in the shape every route hands
 * them over: the status may be absent or `null` for a profile that never
 * answered, and the list is empty for a profile that listed nothing.
 */
export interface CautionProfile {
  reproductiveStatus: ReproductiveStatus | null | undefined;
  allergens: readonly Allergen[];
}

/** The profile facts of no profile at all, or of one that never answered either question. */
export const NO_CAUTION_PROFILE: CautionProfile = { reproductiveStatus: null, allergens: [] };

/**
 * Reads the two facts off a stored profile, or off none, so every route
 * builds the input the same way and no route reads a third field.
 *
 * @param profile - the stored profile row, or `null` when there is none.
 * @returns the facts the decision needs.
 */
export function cautionProfileOf(
  profile: Pick<LocalProfileGoals, 'reproductiveStatus' | 'allergens'> | null | undefined,
): CautionProfile {
  if (!profile) return NO_CAUTION_PROFILE;
  return { reproductiveStatus: profile.reproductiveStatus ?? null, allergens: profile.allergens ?? [] };
}

/** The pregnancy categories that still show while breastfeeding (D3). */
const LACTATING_CATEGORIES: readonly PregnancyCategory[] = ['alcohol', 'caffeine', 'high-mercury-fish'];

/**
 * The tier of one pregnancy category (D5a): `limit` for caffeine, `avoid` for
 * every other category.
 *
 * @param category - one of the v1 pregnancy categories.
 * @returns the tier the chip paints from.
 */
export function cautionTier(category: PregnancyCategory): CautionTier {
  return category === 'caffeine' ? 'limit' : 'avoid';
}

/**
 * Which pregnancy categories a status is shown, in the catalog's order.
 * Answered as a list rather than a predicate so the two readers below cannot
 * disagree about the order the chips render in.
 */
function pregnancyCategoriesFor(status: ReproductiveStatus | null | undefined): readonly PregnancyCategory[] {
  if (status === 'pregnant') return PREGNANCY_CATEGORIES;
  if (status === 'lactating') return LACTATING_CATEGORIES;
  return [];
}

/**
 * The cautions one food earns for one person (D3). Pregnancy chips come
 * first, in the order the categories are defined; then `contains` allergen
 * chips, then `may-contain` ones, each in the EU 14 order. A food with no
 * flags, or a person with nothing on the profile, earns none.
 *
 * @param options.flags - the model's raw flags on the food, or `undefined` for a food that never had any (a database or a manual entry).
 * @param options.reproductiveStatus - the stored status, `null` or absent when never answered.
 * @param options.allergens - the allergens the person listed.
 * @returns the cautions, possibly empty, never `undefined`.
 */
export function decideCautions({
  flags,
  reproductiveStatus,
  allergens,
}: {
  flags: FoodFlags | undefined;
  reproductiveStatus: ReproductiveStatus | null | undefined;
  allergens: readonly Allergen[];
}): FoodCaution[] {
  if (!flags) return [];

  const shownCategories = pregnancyCategoriesFor(reproductiveStatus);
  const pregnancy: FoodCaution[] = shownCategories
    .filter((category) => flags.pregnancy.includes(category))
    .map((category) => ({ kind: 'pregnancy', category, tier: cautionTier(category) }));

  // The person's list is the gate, the flag is the match. Iterating the EU 14
  // in catalog order keeps the chips in the order the profile page lists them.
  const listed = ALLERGENS.filter((allergen) => allergens.includes(allergen));
  const contains: FoodCaution[] = listed
    .filter((allergen) => flags.allergens.includes(allergen))
    .map((allergen) => ({ kind: 'allergen', allergen, tier: 'avoid', certainty: 'contains' }));
  const mayContain: FoodCaution[] = listed
    .filter((allergen) => flags.mayContain.includes(allergen))
    .map((allergen) => ({ kind: 'allergen', allergen, tier: 'avoid', certainty: 'may-contain' }));

  return [...pregnancy, ...contains, ...mayContain];
}

/**
 * One stable string per caution, for a React `key` and for a test that wants
 * to name a chip without reading its words. It is the TEST-SIDE structural
 * key (the decision tables in `tests/unit/food-cautions.test.ts` compare
 * these strings), never a catalog key; `cautionTextKey` in the chip owns the
 * words. Two cautions on one food never
 * share a key: a category appears once, and an allergen is either contained
 * or may-contained, never both (`normalizeFoodFlags` keeps the certainty).
 *
 * @param caution - the caution to name.
 * @returns `pregnancy:<category>` or `allergen:<allergen>:<certainty>`.
 */
export function cautionKey(caution: FoodCaution): string {
  if (caution.kind === 'pregnancy') return `pregnancy:${caution.category}`;
  return `allergen:${caution.allergen}:${caution.certainty}`;
}

////////////////////////////////////////////////////////////////////////////////
// Carrying the raw flags through a form (the confirm draft, the Undo toast)
////////////////////////////////////////////////////////////////////////////////

/**
 * Encodes the raw flags into one hidden-field value, JSON in one input rather
 * than three lists of inputs, the `encodeMicronutrients` precedent. `''` is
 * "this food never had flags", which is how a database-search food and a
 * manual entry travel; an empty flags object is NOT `''`, because "the model
 * looked and found nothing" is a fact the row is allowed to keep.
 *
 * @param flags - the flags to carry, or `undefined` for a food without any.
 * @returns the form value.
 */
export function encodeFoodFlags(flags: FoodFlags | undefined): string {
  if (flags === undefined) return '';
  return JSON.stringify(flags);
}

/**
 * Decodes one form value back into the raw flags, through the SAME lenient
 * schema and the same narrowing the wire answer goes through, so an unknown
 * word costs one word and never the log.
 *
 * FAILS OPEN, never throws: every writer of this field is our own hidden
 * input, so a malformed value is a bug upstream, and refusing the whole log
 * over it would block a person from tracking their food. Anything unparseable
 * reads as `undefined`, "no flags", which renders no chip.
 *
 * @param raw - the submitted value, or nothing.
 * @returns the flags, or `undefined` for none.
 */
export function decodeFoodFlags(raw: string | null | undefined): FoodFlags | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const result = LenientFoodFlagsSchema.safeParse(parsed);
  if (!result.success) return undefined;
  return normalizeFoodFlags(result.data);
}

/** The hidden input as it arrives from a form submission; anything else reads as absent. */
const submittedFieldValue = z.string().nullish().catch(undefined);

/**
 * The zod field every action parsing this value should use, so the encoding
 * lives in exactly one place (the `micronutrientsField` precedent).
 */
export const foodFlagsField = z.preprocess(
  (raw) => decodeFoodFlags(submittedFieldValue.parse(raw)),
  LenientFoodFlagsSchema.transform((raw) => normalizeFoodFlags(raw)).optional(),
);
