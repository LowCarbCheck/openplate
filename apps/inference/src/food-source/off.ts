/**
 * OpenFoodFacts connector — DISABLED unless the operator sets `FOOD_SOURCE=off`.
 *
 * THE LICENCE POSTURE IS THE DESIGN, and it is binding rather than a preference
 * (spec 04 Ground Truth; the 2026-07-15 ODbL decision in M116). OpenFoodFacts is
 * ODbL, which is share-alike. The mitigation that makes it admissible here at all
 * is that WE NEVER TOUCH THE DATA:
 *
 *  - no OFF dump in this repo, no OFF-derived index in the image, no cached
 *    products committed anywhere. `tests/unit/off-disabled-by-default.test.ts`
 *    asserts the default, and spec 04's checklist runs a `find` over the tree for
 *    OFF-shaped filenames.
 *  - every query is fetched at the OPERATOR's runtime, from the operator's
 *    machine, under their choice — so the share-alike obligation stays with them.
 *  - `describe()` states ODbL out loud, so the self-host docs (spec 05) and any
 *    operator reading `/readyz` see what they turned on.
 *
 * WHAT IT IS GOOD AND BAD AT. OFF is a BRANDED/packaged product database with
 * label-derived nutrition, so it shines on "Coke Zero" and is weak on "scrambled
 * eggs" — the opposite of the generic USDA table this service defaults to. That
 * asymmetry, not licence alone, is why it is an operator choice rather than a
 * fallback chained after FDC.
 *
 * ENDPOINTS, verified first-hand 2026-08-13:
 *  - search: `GET /cgi/search.pl?search_terms=…&json=1` (200; the v2 `/api/v2/search`
 *    endpoint wants tag filters and is not a free-text search).
 *  - by id:  `GET /api/v2/product/<barcode>.json` (200).
 * Both are the public read API: no key, no account.
 *
 * OFF's own relevance order is NOT used. Every returned product is re-scored with
 * this repo's lexical scorer so that one accept threshold means the same thing
 * across all three backends.
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

/** Products requested per query. OFF pages are slow; a shortlist is all the ranker needs. */
const DEFAULT_PAGE_SIZE = 20;

/** Per-request deadline. The resolution stage also imposes a total budget. */
const REQUEST_TIMEOUT_MS = 4000;

/**
 * OFF asks API clients to identify themselves in the User-Agent so they can
 * contact an abusive client instead of blocking a whole range. Honouring that is
 * the price of using a volunteer-run service.
 */
const USER_AGENT = 'openplate-inference (self-hosted; https://github.com/LowCarbCheck/openplate-inference)';

/**
 * OFF nutriment key → our macro field. `energy-kcal_100g` is used rather than
 * `energy_100g`, which is kilojoules on most products and would land a number ~4×
 * too large in a kcal field.
 */
const NUTRIMENT_KEYS = {
  carbs: 'carbohydrates_100g',
  fiber: 'fiber_100g',
  sugars: 'sugars_100g',
  polyols: 'polyols_100g',
  protein: 'proteins_100g',
  fat: 'fat_100g',
  kcal: 'energy-kcal_100g',
} as const;

const ProductSchema = z.object({
  code: z.string().optional(),
  product_name: z.string().optional(),
  categories: z.string().optional(),
  /** Values arrive as numbers or numeric strings depending on the product. */
  nutriments: z.record(z.string(), JsonValueSchema).optional(),
});

const SearchResponseSchema = z.object({ products: z.array(ProductSchema).optional() });
const ProductResponseSchema = z.object({ product: ProductSchema.optional() });

type OffProduct = z.infer<typeof ProductSchema>;

export interface OffFoodSourceOptions {
  /** Base URL, so an operator can point at a national subdomain or a mirror. */
  baseUrl?: string;
}

const DESCRIPTION: FoodSourceDescription = {
  name: 'off',
  license:
    'Open Database License (ODbL) 1.0 — OpenFoodFacts. Share-alike: fetched live at the ' +
    'operator’s runtime and never redistributed by this project.',
  attribution: 'Data from OpenFoodFacts (openfoodfacts.org), ODbL 1.0',
  requiresNetwork: true,
};

function toMacros(product: OffProduct): ReturnType<typeof emptyMacros> {
  const macros = emptyMacros();
  const nutriments = product.nutriments ?? {};
  for (const [field, key] of Object.entries(NUTRIMENT_KEYS)) {
    // `toMacroValue` returns null for absent/non-finite/negative. There is no
    // `?? 0` anywhere in this mapping and there must never be: a label that omits
    // fibre has not declared zero fibre.
    // SAFETY: `field` comes from `Object.entries(NUTRIMENT_KEYS)`, so it is a key
    // of that object by construction — `Object.entries` is what widened it to
    // `string`.
    macros[field as keyof typeof NUTRIMENT_KEYS] = toMacroValue(nutriments[key]);
  }
  return macros;
}

function toCandidate(query: string, product: OffProduct): FoodCandidate | null {
  const name = product.product_name?.trim();
  const code = product.code?.trim();
  if (!name || !code) return null;
  const lexical = scoreLexical(query, name).score;
  return {
    id: `off:${code}`,
    name,
    category: product.categories?.split(',')[0]?.trim() ?? null,
    macrosPer100g: toMacros(product),
    attribution: DESCRIPTION.attribution,
    score: lexical,
    signals: { lexical, embedding: null },
  };
}

export function createOffFoodSource(options: OffFoodSourceOptions = {}): FoodSource {
  const baseUrl = (options.baseUrl ?? 'https://world.openfoodfacts.org').replace(/\/+$/, '');

  async function getJson(url: string, signal: AbortSignal | undefined): Promise<JsonValue> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenFoodFacts responded ${response.status}`);
    }
    // SAFETY: `response.json()` is typed `any` by the fetch lib but resolves to
    // whatever `JSON.parse` produced, which is exactly `JsonValue`. Both callers
    // run a Zod schema over the result before reading a field.
    return (await response.json()) as JsonValue;
  }

  return {
    describe: () => DESCRIPTION,

    async search(query: string, searchOptions: SearchOptions = {}): Promise<FoodCandidate[]> {
      const url = new URL('/cgi/search.pl', baseUrl);
      url.searchParams.set('search_terms', query);
      url.searchParams.set('search_simple', '1');
      url.searchParams.set('action', 'process');
      url.searchParams.set('json', '1');
      url.searchParams.set('page_size', String(searchOptions.limit ?? DEFAULT_PAGE_SIZE));
      // Asking for four fields instead of the ~200 a product carries turns a
      // multi-hundred-kB response into a few kB.
      url.searchParams.set('fields', 'code,product_name,nutriments,categories');

      const parsed = SearchResponseSchema.safeParse(await getJson(url.toString(), searchOptions.signal));
      if (!parsed.success) throw new Error('OpenFoodFacts returned an unexpected search shape');

      return (parsed.data.products ?? [])
        .map((product) => toCandidate(query, product))
        .filter((candidate): candidate is FoodCandidate => candidate !== null)
        .toSorted((a, b) => b.score - a.score);
    },

    async getById(id: string, searchOptions: SearchOptions = {}): Promise<FoodCandidate | null> {
      const code = id.startsWith('off:') ? id.slice(4) : id;
      if (!/^[0-9]+$/.test(code)) return null;
      const url = new URL(`/api/v2/product/${code}.json`, baseUrl);
      url.searchParams.set('fields', 'code,product_name,nutriments,categories');

      const parsed = ProductResponseSchema.safeParse(await getJson(url.toString(), searchOptions.signal));
      if (!parsed.success || !parsed.data.product) return null;
      // Scored against its own name: an id lookup has no query to rank against.
      const product = parsed.data.product;
      return toCandidate(product.product_name ?? '', product);
    },
  };
}
