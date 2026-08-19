/**
 * lowcarbcheck connector — the premium resolver, and REMOTE-ONLY FOREVER.
 *
 * That is not a deployment preference, it is a licence consequence. LCC's curated
 * corpus is BLS-4.0-derived, and BLS PROHIBITS REDISTRIBUTION — which fixes this
 * backend's shape permanently: it can exist only as a remote API call, never as a
 * bundled dataset and never as an offline index. Spec 04's checklist greps the
 * tree for BLS-shaped data files for exactly this reason. It is also why this is a
 * legitimate hosted-tier differentiator: not because we withheld it, but because
 * it cannot be shipped.
 *
 * ATTRIBUTION IS THE LOAD-BEARING FEATURE HERE. BLS is CC BY 4.0, so its credit
 * string is a licence obligation, not a nicety. LCC already surfaces it per row
 * through the public API's `attribution` field, and this connector's only job on
 * that front is to NOT DROP IT: `attribution` travels from the LCC row into
 * `FoodCandidate.attribution`, into the response item, and out to the client,
 * which has an optional `attribution` field waiting for it
 * (`openplate/app/services/vision/schema.ts`). `tests/unit/attribution.test.ts`
 * proves the whole chain.
 *
 * WHAT WE DELIBERATELY MATCH FROM openplate's CLIENT-SIDE RESOLVER
 * (`openplate/app/services/food-resolution/`), which does the same lookup from the
 * browser side:
 *  - name-only queries: a food NAME is the only thing that leaves the machine —
 *    no image, no user id, no plate context.
 *  - `origin` is carried as informational context, never as a closed union: LCC
 *    may add an origin value we have not seen and that must not be a parse error.
 *  - fail-open is the caller's contract, so this module throws and lets
 *    `pipeline/resolve-nutrition.ts` decide.
 *
 * AND WHERE WE DELIBERATELY DIVERGE:
 *  - NO CACHE HERE. openplate caches searches for 5 minutes because a browser
 *    re-resolves the same draft repeatedly as a user edits it. This service
 *    resolves each item once per scan, so a cache would add a stale-data surface
 *    and a memory bound to argue about for no hit-rate.
 *  - WE RE-SCORE. openplate trusts LCC's own `score` with a floor at 0.45. Here
 *    the row names are re-scored with this repo's lexical scorer so that ONE
 *    accept threshold means the same thing across all three backends; LCC's score
 *    is a different formula and mixing the two would make the threshold
 *    backend-dependent.
 *  - `netCarbsPer100g`, micronutrients, `portionSize` and `imageUrl` are dropped.
 *    The wire contract this service speaks has nowhere to put them, and inventing
 *    a place would be a cross-repo schema change (spec 06's business, not ours).
 */
import { z } from 'zod';
import { JsonValueSchema, type JsonValue } from '../json.js';
import { scoreLexical } from './lexical.js';
import {
  emptyMacros,
  toMacroValue,
  type FoodCandidate,
  type FoodSource,
  type FoodSourceDescription,
  type SearchOptions,
} from './types.js';

const DEFAULT_LIMIT = 10;

/** LCC's public API caps `limit` at 10 — asking for more is a 400, not a bigger page. */
const MAX_LIMIT = 10;

const REQUEST_TIMEOUT_MS = 4000;

/** Fallback query locale. LCC defaults to `en` too, so this only makes it explicit. */
const DEFAULT_LOCALE = 'en';

/**
 * Mirrors the real wire contract, which sends `null` for unknown macros. Unknown
 * FIELDS are ignored (Zod strips extras) so LCC can keep adding to its API —
 * `vitamins`/`minerals` landed additively in M135 — without breaking resolution.
 */
const MacrosSchema = z.object({
  kcal: JsonValueSchema.optional(),
  protein: JsonValueSchema.optional(),
  fat: JsonValueSchema.optional(),
  carbs: JsonValueSchema.optional(),
  fiber: JsonValueSchema.optional(),
  sugars: JsonValueSchema.optional(),
  polyols: JsonValueSchema.optional(),
});

const FoodSchema = z.object({
  slug: z.string().min(1),
  locale: z.string().optional(),
  title: z.string().min(1),
  canonicalName: z.string().optional(),
  /** Open string, not an enum — see the module header. */
  origin: z.string().nullable().optional(),
  macrosPer100g: MacrosSchema,
  attribution: z.string().nullable().optional(),
});

const SearchResponseSchema = z.object({ results: z.array(FoodSchema) });

type LccFood = z.infer<typeof FoodSchema>;

export interface LccFoodSourceOptions {
  /** Base URL of the LCC deployment, e.g. `https://lowcarbcheck.org`. */
  apiUrl: string;
  /** Default query locale when a caller does not pass one. */
  locale?: string;
}

const DESCRIPTION: FoodSourceDescription = {
  name: 'lcc',
  license:
    'Mixed per row: curated (lowcarbcheck), BLS 4.0 (CC BY 4.0 — attribution REQUIRED, ' +
    'redistribution prohibited) and USDA FDC (CC0). Queried live; never bundled.',
  // Null at the SOURCE level because it is per-row here: a curated row needs no
  // credit and a BLS row needs a specific one, so a blanket string would be
  // wrong in both directions.
  attribution: null,
  requiresNetwork: true,
};

function toMacros(food: LccFood): ReturnType<typeof emptyMacros> {
  const macros = emptyMacros();
  macros.carbs = toMacroValue(food.macrosPer100g.carbs);
  macros.fiber = toMacroValue(food.macrosPer100g.fiber);
  macros.sugars = toMacroValue(food.macrosPer100g.sugars);
  macros.polyols = toMacroValue(food.macrosPer100g.polyols);
  macros.protein = toMacroValue(food.macrosPer100g.protein);
  macros.fat = toMacroValue(food.macrosPer100g.fat);
  macros.kcal = toMacroValue(food.macrosPer100g.kcal);
  return macros;
}

function toCandidate(query: string, food: LccFood): FoodCandidate {
  // Scored on the LOCALIZED title, which is what a German query should match, with
  // the canonical English name as a second chance for a German row queried in
  // English (and vice versa).
  const titleScore = scoreLexical(query, food.title).score;
  const canonicalScore = food.canonicalName ? scoreLexical(query, food.canonicalName).score : 0;
  const lexical = Math.max(titleScore, canonicalScore);
  return {
    id: `lcc:${food.slug}`,
    name: food.title,
    category: food.origin ?? null,
    macrosPer100g: toMacros(food),
    // The licence obligation, carried through verbatim.
    attribution: food.attribution ?? null,
    score: lexical,
    signals: { lexical, embedding: null },
  };
}

export function createLccFoodSource(options: LccFoodSourceOptions): FoodSource {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const defaultLocale = options.locale ?? DEFAULT_LOCALE;

  async function getJson(url: URL, signal: AbortSignal | undefined): Promise<JsonValue | null> {
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`lowcarbcheck responded ${response.status}`);
    // SAFETY: `response.json()` is typed `any` by the fetch lib but resolves to
    // whatever `JSON.parse` produced, which is exactly `JsonValue`. Both callers
    // run a Zod schema over the result before reading a field.
    return (await response.json()) as JsonValue;
  }

  return {
    describe: () => DESCRIPTION,

    async search(query: string, searchOptions: SearchOptions = {}): Promise<FoodCandidate[]> {
      const url = new URL('/api/v1/foods/search', apiUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('locale', searchOptions.locale ?? defaultLocale);
      url.searchParams.set('limit', String(Math.min(searchOptions.limit ?? DEFAULT_LIMIT, MAX_LIMIT)));

      const parsed = SearchResponseSchema.safeParse(await getJson(url, searchOptions.signal));
      if (!parsed.success) throw new Error('lowcarbcheck returned an unexpected search shape');

      return parsed.data.results
        .map((food) => toCandidate(query, food))
        .toSorted((a, b) => b.score - a.score);
    },

    async getById(id: string, searchOptions: SearchOptions = {}): Promise<FoodCandidate | null> {
      const slug = id.startsWith('lcc:') ? id.slice(4) : id;
      if (slug.length === 0) return null;
      const url = new URL(`/api/v1/foods/${encodeURIComponent(slug)}`, apiUrl);
      url.searchParams.set('locale', searchOptions.locale ?? defaultLocale);

      const payload = await getJson(url, searchOptions.signal);
      if (payload === null) return null;
      const parsed = FoodSchema.safeParse(payload);
      if (!parsed.success) return null;
      const candidate = toCandidate(parsed.data.title, parsed.data);
      // An explicit slug lookup is not a similarity question.
      return { ...candidate, score: 1, signals: { lexical: 1, embedding: null } };
    },
  };
}
