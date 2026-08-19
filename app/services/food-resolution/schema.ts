/**
 * Zod validation + mapping for the LowCarbCheck `/api/v1/foods/search`
 * response. Pure — no I/O — so parsing and score-floor filtering are directly
 * unit-testable without stubbing `fetch`.
 *
 * `.nullable()` here reflects the real wire contract (LCC sends `null` for
 * unknown macros); this is an external-API validator, not an LLM structured
 * output, so the `.nullable()`-only rule that applies to LLM schemas is not in
 * play. Unknown fields are ignored (Zod object parsing strips extras), so the
 * LCC API can add fields without breaking resolution.
 */
import { z } from 'zod';
import {
  hasAnyMicronutrientBlock,
  MINERAL_KEYS,
  VITAMIN_KEYS,
  type Minerals,
  type MicronutrientsPer100g,
  type Vitamins,
} from '#app/lib/micronutrients';
import type { FoodMatch } from './types';

/**
 * Matches below this relevance score are discarded before they ever reach the
 * UI — a confidently-wrong curated match ("apple" → "apple pie") is worse than
 * showing nothing and letting the AI estimate stand.
 *
 * This floor only applies to scores that are GUARANTEED to be a genuine
 * lexical hit (exact/prefix/token-prefix/substring/token-overlap) on LCC's
 * side, never a pure-fuzzy (typo-only) one — see `FUZZY_BAND_BOUNDARY` below
 * for why that guarantee holds and `filterViableMatches` for how the two
 * bands get two different floors.
 */
export const LEXICAL_SCORE_FLOOR = 0.45;

/**
 * Backwards-compatible alias — `LEXICAL_SCORE_FLOOR` is the more precise name
 * now that admission is split into two bands (see `filterViableMatches`), but
 * `SCORE_FLOOR` is kept as the "did we admit this match at all, roughly"
 * export for callers/tests that only care about the lexical case.
 */
export const SCORE_FLOOR = LEXICAL_SCORE_FLOOR;

/**
 * Score boundary between LCC's fuzzy-only band and its lexical tiers.
 *
 * LCC's matcher (`apps/remix-lcc/app/lib/food-api/matcher.ts`) deliberately
 * caps every pure-fuzzy (typo-tolerant, fuse.js-derived) hit at its
 * `SCORE_FUZZY_MAX` constant (0.35) — strictly below the lowest score any
 * nonzero LEXICAL tier can produce (`SCORE_TOKEN_BASE` = 0.4). That is a
 * hard invariant on LCC's side (documented in that file's header): a fuzzy
 * hit can never outrank, or even reach, a real lexical match. It also means
 * a `score` openplate receives is self-describing: anything below 0.4 is
 * GUARANTEED fuzzy-only, anything at/above it is GUARANTEED a genuine
 * lexical hit — the two populations never overlap in value space.
 *
 * `filterViableMatches` uses that fact to apply two different admission
 * bars instead of one flat floor across both populations. That distinction
 * is the actual fix for the M123 regression where lowering
 * `SCORE_FUZZY_MAX` from 0.65 to 0.35 (to stop fuzzy hits from outranking
 * lexical ones — see matcher.ts) pushed every fuzzy hit below the single
 * flat `SCORE_FLOOR` (0.45) that used to admit both populations, so a
 * misspelled food (e.g. "brocoli") could never surface a match again. Raising
 * `SCORE_FUZZY_MAX` back up would re-introduce the original bug (a fuzzy hit
 * outranking/tying a lexical one — the "nutella" → "lemon grass" case); the
 * fix belongs on the admission side, not the ranking side.
 */
const FUZZY_BAND_BOUNDARY = 0.4;

/**
 * Admission floor for the guaranteed-fuzzy-only band (score < `FUZZY_BAND_BOUNDARY`).
 *
 * Deliberately lower than `LEXICAL_SCORE_FLOOR` — fuzzy scores are capped at
 * 0.35 by construction (see `FUZZY_BAND_BOUNDARY`'s comment), so reusing the
 * lexical floor here would mean "no fuzzy hit is ever viable", which is the
 * exact regression this constant exists to fix.
 *
 * Calibrated against the real LCC content index (verified with a script
 * against the live `content_foods`/`content_food_translations` tables, not
 * synthetic fixtures — see the M123 fix commit):
 *   - Reported regression cases (single-edit typos of real foods) score
 *     0.3277–0.3465, e.g. "brocoli" → Broccoli 0.3429, "chiken" → a
 *     chicken-titled food 0.3403, "spinnach" → Spinach 0.3445.
 *   - The reported false-positive case ("nutella" → "Lemon grass") scores
 *     0.2500.
 * 0.30 sits with a clear margin below every verified genuine-typo case and
 * above the verified bad case. A purely score-based floor cannot achieve
 * perfect precision against adversarial fuzzy input in general (fuse.js
 * scores character similarity, not meaning — an unrelated word that happens
 * to share letters with a real food name, e.g. "printer" vs "Printen", can
 * still land above this floor); that residual noise is accepted because
 * these are low-cost, non-authoritative suggestions in a picker the user
 * must actively select (never auto-applied — see `app/routes/add.tsx`), so
 * missing a real typo (silence) is the worse failure mode of the two.
 */
export const FUZZY_SCORE_FLOOR = 0.3;

const MatchMacrosSchema = z.object({
  kcal: z.number().nullable(),
  protein: z.number().nullable(),
  fat: z.number().nullable(),
  carbs: z.number().nullable(),
  fiber: z.number().nullable(),
  sugars: z.number().nullable(),
  polyols: z.number().nullable(),
});

/**
 * Wire schema for ONE micronutrient block (M135). Every key is
 * `.nullish().catch(null)`, which is three tolerances in one line and each is
 * deliberate:
 *  - `.nullable()` is the real contract — LCC sends `null` when the source has
 *    no figure for that nutrient.
 *  - `.optional()` tolerates LCC dropping a key it has nothing to say about,
 *    which reads as the same "no figure" state rather than failing the parse.
 *  - `.catch(null)` degrades an unexpected value for ONE nutrient to "unknown"
 *    instead of discarding the whole block (and every sibling figure in it).
 *
 * All three normalize to `null`, i.e. UNCOVERED — never to `0`. The absent-vs-
 * null distinction that matters lives one level up, on the BLOCK (see
 * `toMicronutrients`).
 */
function blockWireSchema(keys: readonly string[]): z.ZodType<Record<string, number | null>> {
  const fields: Record<string, z.ZodType<number | null>> = {};
  for (const key of keys) {
    fields[key] = z
      .number()
      .nullish()
      .transform((value) => value ?? null)
      .catch(null);
  }
  // SAFETY: every entry of `fields` parses to `number | null` and `z.object`
  // parses to a record of its members' outputs, so the parsed value IS a
  // `Record<string, number | null>`; only Zod's generic object inference (which
  // wants a statically-known key set) cannot express that for a computed one.
  return z.object(fields) as z.ZodType<Record<string, number | null>>;
}

// `.nullish()` on the block itself: absent (BLS/FDC origins, and the
// pre-rollout API shape that predates micronutrients entirely) and an explicit
// `null` both mean "this food has no such dimension". `.catch(null)` keeps a
// structurally broken block from blanking an otherwise-good match — same
// fail-open posture as every `.nullish()` field above.
const VitaminsWireSchema = blockWireSchema(VITAMIN_KEYS).nullish().catch(null);
const MineralsWireSchema = blockWireSchema(MINERAL_KEYS).nullish().catch(null);

/**
 * Any value `JSON.parse` can yield off the LCC search endpoint, before this
 * module validates it. A closed JSON value type rather than `unknown`: the
 * input is always JSON, it just isn't trusted yet.
 */
export type UnvalidatedSearchJson = z.infer<ReturnType<typeof z.json>>;

const SearchResultSchema = z.object({
  slug: z.string(),
  locale: z.string(),
  title: z.string(),
  canonicalName: z.string(),
  // Null for BLS-origin foods (no public lowcarbcheck.org page — a link would
  // 404). `.nullish()` also tolerates the field being absent so resolution keeps
  // working against the pre-rollout API shape; normalized to `string | null` in
  // the mapper below.
  url: z.string().nullish(),
  imageUrl: z.string().nullable(),
  macrosPer100g: MatchMacrosSchema,
  netCarbsPer100g: z.number().nullable(),
  // Source/licence credit for imported foods (e.g. BLS 4.0 / CC BY); null for
  // curated foods, and absent entirely on the pre-rollout API — `.nullish()`
  // covers both, normalized to `string | null` in the mapper below.
  attribution: z.string().nullish(),
  score: z.number(),
  // origin/portionSize are newer additions to the LCC contract — `.nullish()`
  // tolerates both an explicit null and the field being absent entirely (the
  // pre-rollout API shape), same pattern as `url`/`attribution` above.
  // `origin` is intentionally `z.string()` rather than a closed enum: this is
  // an external field, and a not-yet-recognized value must not fail parsing
  // and blank out an otherwise-good match.
  origin: z.string().nullish(),
  portionSize: z.number().nullish(),
  vitamins: VitaminsWireSchema,
  minerals: MineralsWireSchema,
});

const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
});

type RawSearchResult = z.infer<typeof SearchResultSchema>;

/** Error thrown when the LCC search response fails validation. Caught by the fail-open shell. */
export class FoodResolutionParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FoodResolutionParseError';
  }
}

/**
 * Maps the wire's two optional micronutrient blocks onto the owned snapshot
 * (M135), PRESERVING the absent-vs-null distinction that the whole coverage
 * measure rests on:
 *  - A block LCC did not send is left OFF the result object entirely — it is
 *    never materialized as an all-`null` block, because "this origin has no
 *    micronutrient dimension" and "this food's figures are all unknown" are
 *    different facts about different futures.
 *  - A block LCC did send is copied through verbatim, `null`s and measured
 *    `0`s alike. A `0` here is real data.
 *  - Neither block present ⇒ `undefined`, so `FoodMatch.micronutrientsPer100g`
 *    is simply absent rather than an empty object nobody can distinguish from
 *    a populated one.
 */
function toMicronutrients(raw: RawSearchResult): MicronutrientsPer100g | undefined {
  const micronutrients: MicronutrientsPer100g = {};
  if (raw.vitamins) {
    // SAFETY: `VitaminsWireSchema` is built from `VITAMIN_KEYS` — the very key list `Vitamins` is declared over — and every member parses to `number | null`, so a parsed block carries exactly those keys with those value types.
    micronutrients.vitamins = { ...raw.vitamins } as Vitamins;
  }
  if (raw.minerals) {
    // SAFETY: same invariant one block over — `MineralsWireSchema` is built from `MINERAL_KEYS`, the key list `Minerals` is declared over, with the same `number | null` members.
    micronutrients.minerals = { ...raw.minerals } as Minerals;
  }
  return hasAnyMicronutrientBlock(micronutrients) ? micronutrients : undefined;
}

function toFoodMatch(raw: RawSearchResult): FoodMatch {
  const micronutrientsPer100g = toMicronutrients(raw);
  const match: FoodMatch = {
    slug: raw.slug,
    locale: raw.locale,
    title: raw.title,
    canonicalName: raw.canonicalName,
    url: raw.url ?? null,
    imageUrl: raw.imageUrl,
    macrosPer100g: {
      kcal: raw.macrosPer100g.kcal,
      protein: raw.macrosPer100g.protein,
      fat: raw.macrosPer100g.fat,
      carbs: raw.macrosPer100g.carbs,
      fiber: raw.macrosPer100g.fiber,
      sugars: raw.macrosPer100g.sugars,
      polyols: raw.macrosPer100g.polyols,
    },
    netCarbsPer100g: raw.netCarbsPer100g,
    attribution: raw.attribution ?? null,
    score: raw.score,
    origin: raw.origin ?? null,
    portionSize: raw.portionSize ?? null,
  };
  // Assigned conditionally rather than always, so the key is genuinely ABSENT
  // (not present-and-undefined) for a food with no micronutrient dimension —
  // the same shape a `JSON.parse` of a stored log produces, so the two can
  // never disagree.
  if (micronutrientsPer100g) match.micronutrientsPer100g = micronutrientsPer100g;
  return match;
}

/**
 * Validates an already-parsed JSON value against the LCC search contract and
 * maps it to owned `FoodMatch[]`. Throws `FoodResolutionParseError` on a shape
 * mismatch. Does not apply the score floor — call `filterViableMatches` for that.
 */
export function parseFoodSearchResponse(json: UnvalidatedSearchJson): FoodMatch[] {
  const result = SearchResponseSchema.safeParse(json);
  if (!result.success) {
    throw new FoodResolutionParseError('LowCarbCheck search response did not match the expected shape', {
      cause: result.error,
    });
  }
  return result.data.results.map(toFoodMatch);
}

/**
 * Drops matches below the viability bar, preserving the (already
 * relevance-sorted) order.
 *
 * Default behavior applies TWO admission floors, not one — see
 * `FUZZY_BAND_BOUNDARY`'s comment for why a single flat floor across LCC's
 * fuzzy and lexical score populations cannot admit typo tolerance without
 * either also admitting a fuzzy hit that outranks a real match, or (the
 * regression this fixes) blocking every fuzzy hit outright:
 *   - `score >= FUZZY_BAND_BOUNDARY` (guaranteed lexical) uses `LEXICAL_SCORE_FLOOR`.
 *   - `score < FUZZY_BAND_BOUNDARY` (guaranteed fuzzy-only) uses the lower `FUZZY_SCORE_FLOOR`.
 * This only changes ADMISSION, never ORDER: matches keep whatever order LCC
 * returned them in (already relevance-sorted upstream), and since the two
 * bands never overlap in value space, a surviving lexical match always still
 * outranks a surviving fuzzy one.
 *
 * Passing an explicit `floor` opts out of the two-band split entirely and
 * applies that single flat floor to every match, regardless of band — an
 * escape hatch for callers/tests that want one uniform bar.
 */
export function filterViableMatches(matches: FoodMatch[], floor?: number): FoodMatch[] {
  if (floor !== undefined) {
    return matches.filter((match) => match.score >= floor);
  }
  return matches.filter((match) =>
    match.score >= FUZZY_BAND_BOUNDARY ? match.score >= LEXICAL_SCORE_FLOOR : match.score >= FUZZY_SCORE_FLOOR,
  );
}
