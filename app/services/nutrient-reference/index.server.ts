/**
 * Server-side reader for LowCarbCheck's public nutrient endpoints (M135/06):
 * the published reference intakes (`GET /api/v1/nutrients`) and the foods
 * richest in one nutrient (`GET /api/v1/nutrients/:slug/foods`).
 *
 * Hard requirement — FAIL OPEN, exactly as `#app/services/food-resolution`
 * does: any network error, non-2xx, malformed body, or a disabled integration
 * yields an EMPTY result, never a throw. `/nutrients` is a local-first screen;
 * with the API unreachable it still renders what the on-device log says and
 * every row simply reports "no published reference" instead of a target. A
 * reference intake is an enrichment of the log, never a dependency of it.
 *
 * Privacy: these are anonymous GETs of public reference data. NOTHING about
 * the person is sent — not the log, not the body metrics, and least of all the
 * pregnancy/lactation status the resolution uses locally. The only thing that
 * ever leaves the device's own server is a nutrient slug drawn from a fixed
 * 17-entry allowlist (`KNOWN_NUTRIENT_SLUGS`).
 *
 * Caching: reference intakes are near-static published figures — EFSA does not
 * revise a DRV between two page loads — so they are cached process-wide for
 * `REFERENCE_CACHE_TTL_MS` and the source rankings for `FOODS_CACHE_TTL_MS`.
 * Only a GENUINE (schema-valid) response is ever cached, mirroring
 * `food-resolution`'s rule: caching a fail-open outcome would let one transient
 * upstream blip serve a false "no reference published" to every caller for the
 * full TTL. The foods cache is keyed by slug and therefore bounded by the
 * allowlist — 17 entries, no eviction policy needed.
 */
import { z } from 'zod';

import { CONFIG } from '#app/config';
import { createComponentLogger } from '#app/lib/logger';
import { KNOWN_NUTRIENT_SLUGS, parseNutrientReferences, parseNutrientSourceFoods } from '#app/lib/nutrient-reference';
import type { NutrientReference, NutrientSourceFood } from '#app/lib/nutrient-reference';

const logger = createComponentLogger('nutrient-reference');

const REQUEST_TIMEOUT_MS = 4000;
/** Published reference intakes change on the timescale of a standards revision, not a session. */
const REFERENCE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** Food rankings move only when the corpus is re-imported; upstream itself serves them with `max-age=3600`. */
const FOODS_CACHE_TTL_MS = 60 * 60 * 1000;
/** Upstream caps this endpoint at 25; a suggestion list is a handful, not a catalog. */
const FOODS_LIMIT = 8;
/** Locale of the returned food TITLES. Fixed to `en` like the food-resolution search — the screen shows canonical names. */
const FOODS_LOCALE = 'en';

/** Injectable slice of `CONFIG.foodDb` — lets tests exercise the disabled path and a stub base URL. */
export interface NutrientApiOptions {
  enabled: boolean;
  apiUrl: string;
}

function configuredOptions(): NutrientApiOptions {
  return { enabled: CONFIG.foodDb.enabled, apiUrl: CONFIG.foodDb.apiUrl };
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const referenceCache = new Map<string, CacheEntry<NutrientReference[]>>();
const foodsCache = new Map<string, CacheEntry<NutrientSourceFood[]>>();

/** Test-only escape hatch — clears cached state so unit tests don't leak between cases. */
export function clearNutrientReferenceCache(): void {
  referenceCache.clear();
  foodsCache.clear();
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Fetches and parses one upstream URL. The whole fail-open surface lives here:
 * every failure mode logs at debug and answers `null`, which every caller reads
 * as "nothing to add", never as an error to propagate.
 */
/**
 * Any value `JSON.parse` can yield off an upstream nutrient endpoint, before
 * `#app/lib/nutrient-reference` validates it. A closed JSON value type rather
 * than `unknown`: the body is always JSON, it just isn't trusted yet.
 */
type UnvalidatedNutrientJson = z.infer<ReturnType<typeof z.json>>;

async function fetchJson(url: string): Promise<UnvalidatedNutrientJson | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    logger.debug('LowCarbCheck nutrient request failed');
    return null;
  }

  if (!response.ok) {
    logger.debug('LowCarbCheck nutrient request returned a non-OK status', { status: response.status });
    return null;
  }

  try {
    return await response.json();
  } catch {
    logger.debug('LowCarbCheck nutrient request returned a non-JSON body', { status: response.status });
    return null;
  }
}

/**
 * Every nutrient's published EU reference intakes.
 *
 * @param options - the food-DB integration settings; defaults to `CONFIG.foodDb`.
 * @returns the recognised references, or `[]` on any failure or when the integration is off.
 */
export async function fetchNutrientReferences(
  options: NutrientApiOptions = configuredOptions(),
): Promise<NutrientReference[]> {
  if (!options.enabled) return [];

  const cached = readCache(referenceCache, options.apiUrl);
  if (cached) return cached;

  const json = await fetchJson(new URL('/api/v1/nutrients', options.apiUrl).toString());
  if (json === null) return [];

  try {
    const references = parseNutrientReferences(json);
    referenceCache.set(options.apiUrl, { value: references, expiresAt: Date.now() + REFERENCE_CACHE_TTL_MS });
    return references;
  } catch {
    logger.debug('LowCarbCheck nutrient list failed validation');
    return [];
  }
}

/**
 * The foods richest in one nutrient, per 100 g.
 *
 * The slug is checked against `KNOWN_NUTRIENT_SLUGS` before any request goes
 * out: it arrives from a public resource route, and an allowlist is what keeps
 * this from being an open URL-path proxy into the upstream API (and keeps the
 * per-slug cache bounded).
 *
 * @param slug - a `content_nutrients` slug from the allowlist.
 * @param options - the food-DB integration settings; defaults to `CONFIG.foodDb`.
 * @returns the ranked foods, or `[]` on an unknown slug, any failure, or a disabled integration.
 */
export async function fetchNutrientSourceFoods(
  slug: string,
  options: NutrientApiOptions = configuredOptions(),
): Promise<NutrientSourceFood[]> {
  if (!options.enabled) return [];
  if (!KNOWN_NUTRIENT_SLUGS.includes(slug)) return [];

  const cacheKey = `${options.apiUrl}::${slug}`;
  const cached = readCache(foodsCache, cacheKey);
  if (cached) return cached;

  const url = new URL(`/api/v1/nutrients/${slug}/foods`, options.apiUrl);
  url.searchParams.set('locale', FOODS_LOCALE);
  url.searchParams.set('limit', String(FOODS_LIMIT));

  const json = await fetchJson(url.toString());
  if (json === null) return [];

  try {
    const foods = parseNutrientSourceFoods(json);
    foodsCache.set(cacheKey, { value: foods, expiresAt: Date.now() + FOODS_CACHE_TTL_MS });
    return foods;
  } catch {
    logger.debug('LowCarbCheck nutrient sources failed validation');
    return [];
  }
}
