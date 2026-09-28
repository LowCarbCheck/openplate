/**
 * Client-safe caller for the `/api/nutrients` resource route (M135/06) — the
 * browser counterpart of `#app/lib/food-matches-client`, and for the same
 * reason: the LCC API config (`CONFIG.foodDb`) is server-only, so every read of
 * published reference data goes through this app's own origin.
 *
 * FAIL OPEN, always: any network/parse failure yields an empty list. The
 * `/nutrients` screen then renders exactly what the on-device log says, with
 * every row reporting "no published reference" instead of a target — which is
 * the same honest state a nutrient with no published DRV is in anyway, so
 * offline is a degradation of the screen rather than a broken version of it.
 *
 * IN-TAB CACHE: reference intakes are near-static published figures, so the
 * result is held for `CACHE_TTL_MS` and shared by every navigation to
 * `/nutrients` in this tab. This is deliberately NOT the local store: the
 * primary store is the person's own data — it rides the E2EE sync envelope and
 * the backup file — and public reference figures that are identical for every
 * user have no business being versioned into someone's diary snapshot. A
 * module-level map is the right lifetime for a cache of somebody else's
 * near-static public data.
 */
import { readNutrientReferenceBody, readNutrientSourceFoodsBody } from '#app/lib/nutrient-reference';
import type {
  JsonValue,
  NutrientReference,
  NutrientReferenceBasis,
  NutrientSourceFood,
} from '#app/lib/nutrient-reference';

/** Long enough that switching windows or leaving and returning never re-fetches; short enough that a corrected figure lands the same day. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const referenceCache = new Map<string, CacheEntry<NutrientReference[]>>();
const foodsCache = new Map<string, CacheEntry<NutrientSourceFood[]>>();

/**
 * Cache key for one basis's reference list (M234 spec 05).
 *
 * One slot per basis, never one shared slot: two bases answer with different
 * numbers for the same nutrient, so a single key would let a list fetched on
 * one basis be served for another. A `null` basis is "whatever this instance's
 * server default is", which the browser cannot name and which therefore gets
 * its own slot rather than being filed under a guess.
 */
function referenceCacheKey(basis: NutrientReferenceBasis | null): string {
  return `nutrients::${basis ?? 'instance-default'}`;
}

/** Test-only escape hatch — clears cached state so unit tests don't leak between cases. */
export function clearNutrientReferenceClientCache(): void {
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

/** Fetches one JSON body from this app's own origin, answering `null` on every failure path. */
async function fetchJson(url: string): Promise<JsonValue | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Every nutrient's published reference intakes, on ONE basis.
 *
 * @param options.basis - the basis to ask for, or `null` (the default) to take
 *   the instance's own `NUTRIENT_REFERENCE_BASIS`. Nothing in the browser knows
 *   that setting yet; the parameter is the seam an administrator's choice will
 *   arrive through.
 * @returns the references, or `[]` on any failure. Never throws.
 */
export async function fetchNutrientReferenceList({
  basis = null,
}: { basis?: NutrientReferenceBasis | null } = {}): Promise<NutrientReference[]> {
  const cacheKey = referenceCacheKey(basis);
  const cached = readCache(referenceCache, cacheKey);
  if (cached) return cached;

  const json = await fetchJson(basis === null ? '/api/nutrients' : `/api/nutrients?basis=${basis}`);
  if (json === null) return [];

  const value = readNutrientReferenceBody(json);
  referenceCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * The foods richest in one nutrient.
 *
 * @param slug - the nutrient's `content_nutrients` slug (server-side allowlisted).
 * @returns the ranked foods, or `[]` on any failure — never throws.
 */
export async function fetchNutrientSources(slug: string): Promise<NutrientSourceFood[]> {
  const cached = readCache(foodsCache, slug);
  if (cached) return cached;

  const json = await fetchJson(`/api/nutrients?foodsFor=${encodeURIComponent(slug)}`);
  if (json === null) return [];

  const value = readNutrientSourceFoodsBody(json);
  foodsCache.set(slug, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
