/**
 * Resolves openplate's free-text identified food names against the public
 * LowCarbCheck food API, replacing LLM-guessed macros with curated per-100g
 * data (and surfacing food images) where a confident match exists.
 *
 * Hard requirement — FAIL OPEN: this is an enrichment, never a dependency. Any
 * network error, non-2xx response, malformed body, or a disabled integration
 * yields an empty match list for that food; the photo -> draft -> log flow
 * behaves exactly as it does without LowCarbCheck. Nothing here ever throws to
 * the caller.
 *
 * Privacy: only the food NAME is ever sent to LCC — never photos, never user
 * data — and it travels in a POST JSON body, never a URL query string
 * (M117/02), so it never lands in an access log. Failure-path logs carry only
 * an HTTP status, never the query name.
 *
 * Request budget (M123/04, M123/05): `/api/food-matches` rate-limits callers
 * to `RATE_LIMIT_MAX_REQUESTS` per `RATE_LIMIT_WINDOW_MS` (see that route),
 * and accountless callers (the common case for `/scan`/`/add`) bucket by IP —
 * an office, campus, or mobile-carrier NAT can mean that budget is a SHARED
 * resource across unrelated people, not a per-person allowance. The client's
 * keystroke-debounced search can burn several requests typing a single food
 * name. To keep that budget from being wasted on requests we already know the
 * answer to, `searchFoodByName` below caches resolved lookups per normalized
 * name (process-wide, not per-user — food data has no per-user variation) and
 * de-dupes concurrent identical lookups (e.g. the same name appearing twice on
 * one plate) so they share a single upstream call instead of racing two.
 * Raising the request budget alone would not fix wasted-request pressure;
 * this cache is the actual fix for that half of the problem.
 */
import { CONFIG } from '#app/config';
import { createComponentLogger } from '#app/lib/logger';
import { cloneMicronutrients } from '#app/lib/micronutrients';
import type { FoodMatch } from './types';
import { filterViableMatches, parseFoodSearchResponse, type UnvalidatedSearchJson } from './schema';

export type { FoodMatch, FoodMatchMacros } from './types';
export {
  SCORE_FLOOR,
  LEXICAL_SCORE_FLOOR,
  FUZZY_SCORE_FLOOR,
  filterViableMatches,
  parseFoodSearchResponse,
  FoodResolutionParseError,
} from './schema';

const logger = createComponentLogger('food-resolution');

/** One plate rarely has more than a handful of foods; keep the LCC call fan-out gentle. */
const RESOLVE_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 4000;
/**
 * Matches the LCC search API's own maximum (`limit=<1-10>` on
 * `/api/v1/foods/search`) — previously capped at 3, which threw away
 * candidates the server was willing to rank and return (M123/04). A bigger
 * limit here is only useful once the upstream ranking is trustworthy; that's
 * tracked separately (M123/04's `matcher.ts` specificity-penalty fix).
 */
const SEARCH_LIMIT = 10;
const SEARCH_LOCALE = 'en';

/** How long a resolved search result stays cached before asking LCC again for the same normalized name. */
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Hard cap on resident cache entries (M123/06 review fix) — this was
 * previously an unbounded process-lifetime `Map` with no eviction, so a
 * long-running server process would grow it without limit as new names got
 * searched. Least-recently-used entries are evicted once this is exceeded
 * (see `touchCacheEntry`/`evictOldestOverCapacity`). Generous for this app's
 * actual usage: every account is a single user (see AGENTS.md), so realistic
 * traffic is a handful of distinct names per `SEARCH_CACHE_TTL_MS` window,
 * not hundreds.
 */
export const MAX_CACHE_ENTRIES = 200;

interface CachedSearch {
  matches: FoodMatch[];
  expiresAt: number;
}

/**
 * Per-process cache of resolved LCC searches, keyed on `apiUrl::normalizedName`
 * (M123/05) — see this module's doc comment above for why this exists.
 *
 * Only a GENUINE result — the upstream responded with a schema-valid body —
 * is ever cached (M123/06 review fix). Every fail-open outcome (network
 * error, non-2xx, non-JSON body, or a validation failure) is deliberately
 * left uncached: caching it too would let one transient LCC blip poison this
 * shared cache with a false "no such food" for every caller, for the full
 * TTL window. `performSearch` signals this via `SearchOutcome.cacheable`;
 * `searchFoodByName` only writes to `searchCache` when that flag is true.
 *
 * Bounded to `MAX_CACHE_ENTRIES` with least-recently-used eviction (see
 * above). Every hand-out from this cache is a defensive copy
 * (`cloneMatches`) — no caller ever receives the same array or `FoodMatch`/
 * `macrosPer100g` object identity that the cache (or a different caller)
 * holds, so nothing downstream can mutate shared state by accident.
 *
 * `inFlightSearches` dedupes concurrent identical lookups so they resolve
 * from one shared promise instead of one race per caller; each waiter still
 * gets its own cloned result (see `searchFoodByName`).
 */
const searchCache = new Map<string, CachedSearch>();
const inFlightSearches = new Map<string, Promise<FoodMatch[]>>();

/**
 * Moves `key` to the end of `searchCache`'s iteration order — `Map`
 * preserves insertion order, and re-inserting an existing key moves it to
 * the end, so this is the basis for the least-recently-used eviction in
 * `evictOldestOverCapacity` below: the first key in iteration order is
 * always the one least recently read or written.
 */
function touchCacheEntry(key: string, entry: CachedSearch): void {
  searchCache.delete(key);
  searchCache.set(key, entry);
}

/** Removes least-recently-used entries until back at `MAX_CACHE_ENTRIES`. Bounded: each iteration strictly shrinks `searchCache.size` toward the cap, so this always terminates. */
function evictOldestOverCapacity(): void {
  while (searchCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey === undefined) return;
    searchCache.delete(oldestKey);
  }
}

function cacheSearchResult(key: string, matches: FoodMatch[]): void {
  searchCache.set(key, { matches, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  evictOldestOverCapacity();
}

/**
 * Defensive copy of a match list (M123/06 review fix) — every hand-off to a
 * caller (a cache hit, an in-flight dedupe waiter, or a fresh resolve) goes
 * through this so no two callers, and no caller and the cache itself, ever
 * share the same array or `FoodMatch`/`macrosPer100g` object identity.
 * Without this, every caller of a cached name received the literal array
 * stored in `searchCache`, and mutating one caller's copy would corrupt what
 * every other caller — and the cache — saw. `FoodMatch`'s nested objects are
 * `macrosPer100g` and `micronutrientsPer100g` (whose own `vitamins`/`minerals`
 * blocks nest one level deeper); every other field is a primitive or `null`,
 * so a shallow spread of each match plus a copy of those is a full copy.
 */
function cloneMatches(matches: FoodMatch[]): FoodMatch[] {
  return matches.map((match) => {
    // M135: `micronutrientsPer100g` is the second nested object, and its two
    // vitamins/minerals blocks need copying too. Spread-or-omit rather than
    // assigning `undefined`, so a match with no micronutrient dimension keeps
    // the key genuinely ABSENT — the distinction the coverage measure rests on
    // (see `#app/lib/micronutrients`).
    const micronutrientsPer100g = cloneMicronutrients(match.micronutrientsPer100g);
    const clone: FoodMatch = { ...match, macrosPer100g: { ...match.macrosPer100g } };
    // Assigned conditionally rather than always, so a match with no
    // micronutrient dimension keeps the key genuinely ABSENT — the distinction
    // the coverage measure rests on (see `#app/lib/micronutrients`).
    if (micronutrientsPer100g) clone.micronutrientsPer100g = micronutrientsPer100g;
    return clone;
  });
}

/** Collapses trivial formatting differences ("Apple  Pie", " apple pie ") onto one cache key. */
function normalizeSearchName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function searchCacheKey(options: { apiUrl: string; name: string }): string {
  return `${options.apiUrl}::${normalizeSearchName(options.name)}`;
}

/** Test-only escape hatch — clears cached/in-flight state so unit tests don't leak between cases. */
export function clearFoodResolutionCache(): void {
  searchCache.clear();
  inFlightSearches.clear();
}

/**
 * True when resolving every one of `names` right now would be a pure cache
 * hit — none would need a fresh upstream LCC call. Side-effect-free: unlike
 * `searchFoodByName`, this never touches LRU order, evicts, or reads
 * `inFlightSearches` — it only answers "would this cost anything upstream?".
 *
 * `/api/food-matches` uses this to decide whether a request should count
 * against its caller's rate-limit budget (M123/07 — see that route's doc
 * comment for the full rationale). A request built entirely from cache costs
 * nothing upstream, so charging it against the budget only punishes
 * shared-IP callers (office NAT, campus wifi, carrier CGNAT) re-searching a
 * food someone else on the same IP already looked up in the last
 * `SEARCH_CACHE_TTL_MS`, without buying any protection — a genuinely
 * abusive burst of *novel* names can never satisfy this (a name nobody has
 * searched yet cannot be cached), so it is still fully rate-limited.
 *
 * `enabled: false` and an empty `names` list both count as "cached" (i.e.
 * exempt from the budget) for the same reason: neither ever reaches the
 * upstream lookup either (see `resolveIdentifiedFoods`'s own short-circuit),
 * so there is nothing to protect against.
 */
export function allNamesCached(names: readonly string[], options: ResolveOptions = configuredOptions()): boolean {
  if (!options.enabled || names.length === 0) return true;
  const now = Date.now();
  return names.every((name) => {
    const cached = searchCache.get(searchCacheKey({ apiUrl: options.apiUrl, name }));
    return cached !== undefined && cached.expiresAt > now;
  });
}

/** Injectable slice of `CONFIG.foodDb` — lets tests exercise the disabled path and a stub base URL. */
export interface ResolveOptions {
  enabled: boolean;
  apiUrl: string;
}

function configuredOptions(): ResolveOptions {
  return { enabled: CONFIG.foodDb.enabled, apiUrl: CONFIG.foodDb.apiUrl };
}

function buildSearchUrl(apiUrl: string): string {
  return new URL('/api/v1/foods/search', apiUrl).toString();
}

/**
 * Single-name lookup, cache-and-dedupe-checked (see the module doc comment).
 * A live cache hit or an already-in-flight identical lookup short-circuits
 * before any network call. Always resolves — every failure mode (including a
 * cache miss that goes on to fail) is swallowed to an empty array, never a
 * throw. Every return path hands back a `cloneMatches` copy, never the
 * array/objects the cache or another caller holds (M123/06).
 */
async function searchFoodByName(options: { name: string; apiUrl: string }): Promise<FoodMatch[]> {
  const key = searchCacheKey(options);

  const cached = searchCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      touchCacheEntry(key, cached);
      return cloneMatches(cached.matches);
    }
    // Expired — evict now. Reads used to only "skip" a stale entry and leave
    // it resident until some unrelated write happened to trip the capacity
    // sweep (M123/06 bound fix); every read now either extends an entry's
    // life (the touch above) or removes it outright.
    searchCache.delete(key);
  }

  const pending = inFlightSearches.get(key);
  if (pending) {
    return pending.then(cloneMatches);
  }

  const search = performSearch(options)
    .then((outcome) => {
      // Only a genuine (schema-valid) result is cached — see the module doc
      // comment on `searchCache` for why a fail-open outcome must not be.
      if (outcome.cacheable) {
        cacheSearchResult(key, outcome.matches);
      }
      return outcome.matches;
    })
    .finally(() => {
      inFlightSearches.delete(key);
    });

  inFlightSearches.set(key, search);
  return search.then(cloneMatches);
}

/**
 * The outcome of a single upstream search attempt. `cacheable` is the signal
 * `searchFoodByName` uses to decide whether this result may be written to
 * `searchCache` — see that Map's doc comment for why a fail-open outcome
 * must never be cached (M123/06).
 */
interface SearchOutcome {
  matches: FoodMatch[];
  /** True only when the upstream responded with a schema-valid body — a genuine result. False on every fail-open path below. */
  cacheable: boolean;
}

/**
 * The actual network call behind `searchFoodByName`, split out so caching can
 * wrap it without complicating the fetch/parse control flow. POSTs the term
 * in a JSON body rather than a `?q=` query string (M117/02) — a food name in
 * a URL lands in Traefik's access log on the LCC side, a health-adjacent
 * signal this integration must not leak. The GET form still exists on the LCC
 * API for other callers; this service always uses the POST form. Failure logs
 * never carry the search term (only an HTTP status), for the same reason.
 */
async function performSearch(options: { name: string; apiUrl: string }): Promise<SearchOutcome> {
  const { name, apiUrl } = options;

  let response: Response;
  try {
    response = await fetch(buildSearchUrl(apiUrl), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ q: name, locale: SEARCH_LOCALE, limit: SEARCH_LIMIT }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    logger.debug('LowCarbCheck search request failed');
    return { matches: [], cacheable: false };
  }

  if (!response.ok) {
    logger.debug('LowCarbCheck search returned a non-OK status', { status: response.status });
    return { matches: [], cacheable: false };
  }

  let json: UnvalidatedSearchJson;
  try {
    json = await response.json();
  } catch {
    logger.debug('LowCarbCheck search returned a non-JSON body', { status: response.status });
    return { matches: [], cacheable: false };
  }

  try {
    return { matches: filterViableMatches(parseFoodSearchResponse(json)), cacheable: true };
  } catch {
    logger.debug('LowCarbCheck search response failed validation', { status: response.status });
    return { matches: [], cacheable: false };
  }
}

/**
 * Order-preserving concurrency-limited map. Bounded by `items.length` (each
 * iteration advances the shared cursor), so there is no unbounded loop.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  let cursor = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  const runners = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * For each identified food name, returns up to `SEARCH_LIMIT` curated
 * LowCarbCheck matches (score-filtered, best first). The outer array is
 * parallel to `foods` by index; a food with no viable match gets an empty
 * inner array — every non-throwing path through this function preserves that
 * parity (see `mapWithConcurrency`).
 */
export async function resolveIdentifiedFoods(
  foods: { name: string }[],
  options: ResolveOptions = configuredOptions(),
): Promise<FoodMatch[][]> {
  if (!options.enabled || foods.length === 0) {
    return foods.map(() => []);
  }

  return mapWithConcurrency(foods, RESOLVE_CONCURRENCY, (food) =>
    searchFoodByName({ name: food.name, apiUrl: options.apiUrl }),
  );
}
