/**
 * One food's vitamins and minerals, read from LowCarbCheck BY SLUG (the
 * micronutrient backfill, 2026-10-13).
 *
 * WHY BY SLUG. Until 2026-10-13 the 6,896 BLS foods in LowCarbCheck carried no
 * vitamins; that day they were backfilled upstream. A diary entry logged from
 * one of them before then snapshotted no block, so its day reads "not enough
 * data" for ever. The entry still names its food (`curatedSource` is
 * `lowcarbcheck:<slug>`), so the device asks for exactly that food. It never
 * searches by NAME: a name match is a guess, and a guess written into somebody's
 * history is fabricated data.
 *
 * ── THE LOCALE IS NOT ON THE ENTRY ───────────────────────────────────────
 *
 * LowCarbCheck answers `GET /api/v1/foods/:slug?locale=<l>` per (slug, locale)
 * pair, and the slugs differ by locale (`huhnerei-roh` in `de` is
 * `chicken-egg-raw` in `en`; the German slug answers `404` under `en`). The
 * entry kept the slug of the language the person searched in, not the
 * language. So the lookup asks in the caller's UI language first, which is
 * right whenever the person has not switched language since, and on a `404`
 * walks the other locales the app ships. The first `200` settles the slug.
 *
 * COST. One call per slug in the common case. At most
 * {@link LOOKUP_LOCALES}`.length` (five) for a slug no locale knows, and that
 * answer is then final on the device, so it is never paid twice. Every call
 * after the first is reserved from the daily cap on its own; a cap reached
 * mid-walk answers `unknown`, never `not-found`.
 *
 * ── WHAT IS A NOT-FOUND ──────────────────────────────────────────────────
 *
 * Only LowCarbCheck's own `404 { "error": "not_found" }`. A bare `404` (a
 * wrong `FOOD_DB_API_URL`, a proxy, an older upstream with no detail route)
 * is a failure, because reading it as "no such food" would settle every slug
 * on every device as not-found for good.
 *
 * ── CACHE ────────────────────────────────────────────────────────────────
 *
 * Settled answers (`filled`, `no-data`, `not-found`) are cached per process,
 * keyed by upstream and slug, so a second device asking for the same food
 * costs nothing. A failure is never cached: one upstream blip must not become
 * a false answer for every caller. The key carries no locale, on purpose: a
 * food's vitamins live on the food, not on its translation, so whichever
 * locale settled a slug settled it for everybody.
 *
 * NOTHING HERE LOGS A SLUG. A slug names a food somebody ate; the logs carry an
 * HTTP status and nothing else, the rule the search path keeps for names.
 * The slug does travel in the upstream URL path, because the detail endpoint
 * is a `GET`. It is sent by this server under the instance key, never with
 * anything that names a person.
 */
import { z } from 'zod';
import type { LanguageCode } from '#app/i18n/language-prefs';
import { DailyCallLimitExceededError } from '#app/lib/food-db-daily-budget';
import { createComponentLogger } from '#app/lib/logger';
import { MicronutrientBlocksWireSchema, toMicronutrientsPer100g } from '#app/services/food-resolution/schema';
import { foodDbKeyDisplayPrefix, foodDbRequestHeaders } from './request';
import { noteFoodDbAccepted, noteFoodDbRefusal } from './status';
import { isLookupableSlug, type SlugMicronutrientsAnswer, type SlugMicronutrientsOutcome } from './micronutrients-wire';

const logger = createComponentLogger('food-micronutrients');

/**
 * The LowCarbCheck locales the app ships a language for, in the order a slug
 * is tried after the caller's own language.
 *
 * German first: the foods this backfill exists for are the BLS foods, a German
 * table, and most entries that need it were logged in German. Turkish is
 * absent because LowCarbCheck has no `tr` locale; Dutch because the app has
 * no Dutch, so no entry can carry a Dutch slug.
 */
export const LOOKUP_LOCALES = ['de', 'en', 'fr', 'it', 'es'] as const satisfies readonly LanguageCode[];

type LookupLocale = (typeof LOOKUP_LOCALES)[number];

/** One upstream call's budget, the same as the search's. */
const REQUEST_TIMEOUT_MS = 4000;

/** How long a settled answer is reused. Long, because the figures are corrected upstream rarely and the device asks once. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Hard cap on resident entries; the oldest is dropped first. A block is well under a kilobyte. */
export const MAX_CACHE_ENTRIES = 2000;

/** How many slugs are looked up at once within one request. */
const LOOKUP_CONCURRENCY = 4;

/** An answer the cache may hold: everything but a failure. */
type SettledOutcome = Exclude<SlugMicronutrientsOutcome, { kind: 'unknown' }>;

const NOT_FOUND: SettledOutcome = { kind: 'not-found' };
const UNKNOWN: SlugMicronutrientsOutcome = { kind: 'unknown' };

/** Resident settled answers, keyed by {@link cacheKey}. A `Map`, so insertion order is the eviction order. */
const cache = new Map<string, { outcome: SettledOutcome; expiresAt: number }>();

/** Lookups in flight, so two devices asking for one food at once spend one walk. */
const inFlight = new Map<string, Promise<SlugMicronutrientsOutcome>>();

function cacheKey({ apiUrl, slug }: { apiUrl: string; slug: string }): string {
  return `${apiUrl}::${slug}`;
}

/** The live cached answer for a key, evicting an expired one. */
function readCache(key: string): SettledOutcome | null {
  const held = cache.get(key);
  if (held === undefined) return null;
  if (held.expiresAt > Date.now()) return held.outcome;
  cache.delete(key);
  return null;
}

function writeCache(key: string, outcome: SettledOutcome): void {
  cache.delete(key);
  cache.set(key, { outcome, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = cache.keys().next();
  if (oldest.done !== true) cache.delete(oldest.value);
}

/** Test-only: forgets every cached and in-flight answer. */
export function clearFoodMicronutrientsCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * The order a slug's locales are tried in: the caller's language first when
 * LowCarbCheck has it, then the rest of {@link LOOKUP_LOCALES}.
 *
 * @param language - the caller's UI language.
 * @returns every lookup locale once.
 */
export function lookupLocalesFor(language: LanguageCode): LookupLocale[] {
  const first = LOOKUP_LOCALES.find((locale) => locale === language);
  if (first === undefined) return [...LOOKUP_LOCALES];
  return [first, ...LOOKUP_LOCALES.filter((locale) => locale !== first)];
}

/**
 * How many of `slugs` would need at least one upstream call right now.
 *
 * The route reserves this many calls from the daily cap before it looks
 * anything up, and charges the per-address limiter only when it is above zero,
 * the cache-miss accounting `/api/food-matches` uses.
 *
 * @param options.slugs - the distinct slugs of one request.
 * @param options.apiUrl - the upstream the cache is keyed by.
 * @returns the count of lookupable slugs with no live cached answer.
 */
export function countUncachedSlugs({ slugs, apiUrl }: { slugs: readonly string[]; apiUrl: string }): number {
  return slugs.filter((slug) => isLookupableSlug(slug) && readCache(cacheKey({ apiUrl, slug })) === null).length;
}

/** LowCarbCheck's own not-found body. Anything else on a `404` is a failure. */
const notFoundBodySchema = z.object({ error: z.literal('not_found') });

/** The detail body: a food object, of which only its slug and its two blocks are read. */
const foodDetailSchema = MicronutrientBlocksWireSchema.extend({ slug: z.string() });

/** One locale's answer: settled, absent in this locale, or a failure that ends the walk. */
type DetailStep = { kind: 'settled'; outcome: SettledOutcome } | { kind: 'absent' } | { kind: 'failed' };

const ABSENT: DetailStep = { kind: 'absent' };
const FAILED: DetailStep = { kind: 'failed' };

/** Everything one upstream detail call needs. */
interface DetailRequest {
  slug: string;
  locale: LookupLocale;
  apiUrl: string;
  apiKey: string | null;
}

/** Reads a body as JSON, or `null` when it is not JSON. */
async function readJson(response: Response): Promise<z.infer<ReturnType<typeof z.json>> | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Classifies a non-OK answer: LowCarbCheck's own not-found, or a failure (a refusal is recorded on the way). */
async function classifyFailure({
  response,
  apiKey,
}: {
  response: Response;
  apiKey: string | null;
}): Promise<DetailStep> {
  if (response.status === 404) {
    // The upstream authenticated us and answered, so it is not refusing.
    if (notFoundBodySchema.safeParse(await readJson(response)).success) {
      noteFoodDbAccepted();
      return ABSENT;
    }
    logger.debug('LowCarbCheck food detail returned a 404 that is not its own not-found');
    return FAILED;
  }
  const refusal = await noteFoodDbRefusal(response);
  if (refusal === null) {
    logger.debug('LowCarbCheck food detail returned a non-OK status', { status: response.status });
    return FAILED;
  }
  logger.warn('LowCarbCheck refused this instance, the micronutrient backfill pauses', {
    status: response.status,
    reason: refusal,
    operation: 'food-detail',
    keyPrefix: foodDbKeyDisplayPrefix(apiKey),
  });
  return FAILED;
}

/** One upstream call for one (slug, locale) pair. Never throws. */
async function fetchDetail({ slug, locale, apiUrl, apiKey }: DetailRequest): Promise<DetailStep> {
  const url = new URL(`/api/v1/foods/${encodeURIComponent(slug)}`, apiUrl);
  url.searchParams.set('locale', locale);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: foodDbRequestHeaders({ apiKey }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    logger.debug('LowCarbCheck food detail request failed');
    return FAILED;
  }
  if (!response.ok) return classifyFailure({ response, apiKey });
  noteFoodDbAccepted();

  const parsed = foodDetailSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    logger.debug('LowCarbCheck food detail failed validation', { status: response.status });
    return FAILED;
  }
  const micronutrientsPer100g = toMicronutrientsPer100g(parsed.data);
  if (micronutrientsPer100g === undefined) return { kind: 'settled', outcome: { kind: 'no-data' } };
  return { kind: 'settled', outcome: { kind: 'filled', micronutrientsPer100g } };
}

/** Everything one slug's lookup needs. */
interface SlugLookup {
  slug: string;
  apiUrl: string;
  apiKey: string | null;
  language: LanguageCode;
  /**
   * Reserves ONE more upstream call from the daily cap, for a locale after the
   * first. The route reserved the first call of every uncached slug already.
   *
   * @throws DailyCallLimitExceededError when the day's calls are spent.
   */
  reserveExtraCall: () => void;
}

/** Walks a slug's locales until one settles it, all of them answer absent, or one fails. */
async function walkLocales(lookup: SlugLookup): Promise<SlugMicronutrientsOutcome> {
  const { slug, apiUrl, apiKey, language, reserveExtraCall } = lookup;
  const key = cacheKey({ apiUrl, slug });
  for (const [index, locale] of lookupLocalesFor(language).entries()) {
    if (index > 0) {
      try {
        reserveExtraCall();
      } catch (error) {
        if (!(error instanceof DailyCallLimitExceededError)) throw error;
        return UNKNOWN;
      }
    }
    const step = await fetchDetail({ slug, locale, apiUrl, apiKey });
    if (step.kind === 'failed') return UNKNOWN;
    if (step.kind === 'absent') continue;
    writeCache(key, step.outcome);
    return step.outcome;
  }
  writeCache(key, NOT_FOUND);
  return NOT_FOUND;
}

/** One slug: refused shape, cache, in-flight, then the walk. */
async function lookupSlug(lookup: SlugLookup): Promise<SlugMicronutrientsOutcome> {
  if (!isLookupableSlug(lookup.slug)) return NOT_FOUND;
  const key = cacheKey(lookup);
  const cached = readCache(key);
  if (cached !== null) return cached;
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;
  const walk = walkLocales(lookup).finally(() => inFlight.delete(key));
  inFlight.set(key, walk);
  return walk;
}

/**
 * Answers every slug of one request, in order.
 *
 * Never throws for an upstream reason: every failure is that slug's `unknown`.
 *
 * @param options.slugs - the distinct slugs, at most `MAX_SLUGS_PER_REQUEST`.
 * @param options.apiUrl - `CONFIG.foodDb.apiUrl`.
 * @param options.apiKey - `CONFIG.foodDb.apiKey`, or `null` for the anonymous tier.
 * @param options.language - the caller's UI language, tried first.
 * @param options.reserveExtraCall - reserves a locale call after a slug's first; see {@link SlugLookup}.
 * @returns one answer per slug, parallel to `slugs`.
 */
export async function lookupFoodMicronutrients({
  slugs,
  ...shared
}: Omit<SlugLookup, 'slug'> & { slugs: readonly string[] }): Promise<SlugMicronutrientsAnswer[]> {
  const answers: SlugMicronutrientsAnswer[] = [];
  for (let start = 0; start < slugs.length; start += LOOKUP_CONCURRENCY) {
    const group = slugs.slice(start, start + LOOKUP_CONCURRENCY);
    const outcomes = await Promise.all(group.map((slug) => lookupSlug({ ...shared, slug })));
    group.forEach((slug, index) => answers.push({ slug, outcome: outcomes[index] ?? UNKNOWN }));
  }
  return answers;
}
