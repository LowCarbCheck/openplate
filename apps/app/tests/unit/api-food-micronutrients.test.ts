/**
 * `/api/food-micronutrients` on a MANAGED instance (the micronutrient
 * backfill, 2026-10-13): the three guards, the mapping, and the four answers.
 *
 * Every case counts the calls that reached LowCarbCheck, not only the status:
 * a guard that answered AFTER the lookup would pass a status check and still
 * spend the key. Every claim has a control beside it that makes it fail.
 *
 * THE ENVIRONMENT IS SET BEFORE THE MODULES LOAD, the pattern
 * `api-food-matches-managed.test.ts` uses: `CONFIG` is parsed once, on import.
 * The daily cap and the instance with no food database live in their own
 * files, because each needs its own environment.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  FoodMicronutrientsResponseBody,
  SlugMicronutrientsOutcome,
} from '../../app/services/food-db/micronutrients-wire';
import { VITAMIN_KEYS } from '../../app/lib/micronutrients';

const CORE = 'http://core.test';
const LCC = 'http://lcc.test';
const LIVE_TOKEN = 'live-token';
const DEAD_TOKEN = 'dead-token';

process.env.INSTANCE_MODE = 'managed';
process.env.CORE_URL = CORE;
process.env.FOOD_DB_API_URL = LCC;
process.env.FOOD_DB_API_KEY = 'placeholder-food-db-key';
process.env.FOOD_DB_DAILY_CALL_LIMIT = '500';

type Action = (args: { request: Request }) => Promise<Response>;

let foodMicronutrients: Action;
let resetState: () => void;

/** Calls that reached each side, per case. */
let coreCalls = 0;
let lccCalls = 0;
/** Every (slug, locale) pair LowCarbCheck was asked, in order. */
let lccAsked: Array<{ slug: string; locale: string }> = [];
/** What LowCarbCheck answers for one (slug, locale) pair this case. */
let lccAnswer: (slug: string, locale: string) => Response;

const realFetch = globalThis.fetch;

/** LowCarbCheck's own not-found answer. */
function lccNotFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}

/** A food detail body: the fields the lookup reads, plus some it ignores. */
function lccFood(slug: string, blocks: { vitamins: object | null; minerals: object | null }): Response {
  return Response.json({
    slug,
    locale: 'de',
    origin: 'bls',
    title: 'Hühnerei, roh',
    macrosPer100g: { kcal: 137 },
    ...blocks,
  });
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === CORE) {
    coreCalls += 1;
    const authorization = new Headers(init?.headers).get('authorization');
    if (authorization === `Bearer ${LIVE_TOKEN}`) return Promise.resolve(Response.json({ account: { id: 1 } }));
    return Promise.resolve(Response.json({ error: 'authentication required' }, { status: 401 }));
  }
  if (url.origin === LCC) {
    lccCalls += 1;
    const slug = decodeURIComponent(url.pathname.replace('/api/v1/foods/', ''));
    const locale = url.searchParams.get('locale') ?? '';
    lccAsked.push({ slug, locale });
    return Promise.resolve(lccAnswer(slug, locale));
  }
  return Promise.reject(new Error(`unexpected request to ${url.href}`));
}

/** The request the device sends, with the bearer and a language cookie when given. */
function micronutrientsRequest({
  slugs,
  token = LIVE_TOKEN,
  language,
  rawBody,
}: {
  slugs?: readonly string[];
  token?: string | null;
  language?: string;
  rawBody?: string;
}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  if (language !== undefined) headers.set('cookie', `openplate-language=${language}`);
  return new Request('http://localhost/api/food-micronutrients', {
    method: 'POST',
    headers,
    body: rawBody ?? JSON.stringify({ slugs }),
  });
}

/** The answers, by slug, of a `200`. */
async function outcomesOf(response: Response): Promise<Map<string, SlugMicronutrientsOutcome>> {
  assert.equal(response.status, 200);
  // SAFETY: the route's own success body; a `200` carries nothing else.
  const body = (await response.json()) as FoodMicronutrientsResponseBody;
  return new Map(body.results.map(({ slug, outcome }) => [slug, outcome]));
}

/** One slug's answer from a fresh request. */
async function askOne(slug: string, language = 'de'): Promise<SlugMicronutrientsOutcome | undefined> {
  return (
    await outcomesOf(await foodMicronutrients({ request: micronutrientsRequest({ slugs: [slug], language }) }))
  ).get(slug);
}

before(async () => {
  // SAFETY: `fakeFetch` implements `fetch(input, init)`, the only form the
  // code under test calls; `typeof fetch` also carries `preconnect`, which
  // nothing here touches.
  globalThis.fetch = fakeFetch as typeof fetch;
  const routeModule: object = await import('../../app/routes/api.food-micronutrients');
  // SAFETY: this repo's own route module. Its typed action takes React
  // Router's full server-args object and reads `request` and nothing else.
  foodMicronutrients = (routeModule as { action: Action }).action;
  const { clearAccountTokenCache } = await import('../../app/lib/managed-account-gate.server');
  const { resetFoodDbDailyBudget } = await import('../../app/lib/food-db-daily-budget.server');
  const { clearRateLimit } = await import('../../app/lib/rate-limit.server');
  const { foodMicronutrientsRateLimitKey } = await import('../../app/lib/food-micronutrients-rate-limit.server');
  const { clearFoodMicronutrientsCache } = await import('../../app/services/food-db/micronutrients.server');
  resetState = () => {
    clearAccountTokenCache();
    resetFoodDbDailyBudget();
    clearRateLimit(foodMicronutrientsRateLimitKey(micronutrientsRequest({ slugs: [] })));
    clearFoodMicronutrientsCache();
  };
});

beforeEach(() => {
  resetState();
  coreCalls = 0;
  lccCalls = 0;
  lccAsked = [];
  lccAnswer = () => lccNotFound();
});

after(() => {
  globalThis.fetch = realFetch;
});

describe('the account guard', () => {
  it('refuses a caller with no token with 401, and asks neither core nor LowCarbCheck', async () => {
    const response = await foodMicronutrients({
      request: micronutrientsRequest({ slugs: ['huhnerei-roh'], token: null }),
    });
    assert.equal(response.status, 401);
    assert.equal(coreCalls, 0);
    assert.equal(lccCalls, 0);
  });

  it('refuses a token core refuses with 401, before any lookup', async () => {
    const response = await foodMicronutrients({
      request: micronutrientsRequest({ slugs: ['huhnerei-roh'], token: DEAD_TOKEN }),
    });
    assert.equal(response.status, 401);
    assert.equal(coreCalls, 1);
    assert.equal(lccCalls, 0);
  });

  it('control: a live token is served, and LowCarbCheck is asked', async () => {
    const response = await foodMicronutrients({ request: micronutrientsRequest({ slugs: ['huhnerei-roh'] }) });
    assert.equal(response.status, 200);
    assert.equal(coreCalls, 1);
    assert.ok(lccCalls > 0);
  });
});

describe('the mapping', () => {
  it('answers filled with the block mapped as the search maps it', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: { vitaminD: 2.9, vitaminC: 'n/a' }, minerals: null });
    const outcome = await askOne('huhnerei-roh');
    assert.equal(outcome?.kind, 'filled');
    if (outcome?.kind !== 'filled') return;
    const { vitamins, minerals } = outcome.micronutrientsPer100g;
    assert.equal(vitamins?.vitaminD, 2.9);
    // A broken figure for ONE nutrient reads as unknown, never as 0, and every
    // vitamin key is present, the search path's own tolerance.
    assert.equal(vitamins?.vitaminC, null);
    assert.deepEqual(Object.keys(vitamins ?? {}).toSorted(), [...VITAMIN_KEYS].toSorted());
    assert.equal(minerals, undefined, 'a null block stays absent, never an empty block');
  });

  it('answers no-data when LowCarbCheck knows the food and has no block', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: null, minerals: null });
    assert.deepEqual(await askOne('huhnerei-roh'), { kind: 'no-data' });
    assert.equal(lccCalls, 1, 'a 200 settles the slug in the first locale');
  });

  it('control: the same food with one block is filled, not no-data', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: null, minerals: { calcium: 56 } });
    assert.equal((await askOne('huhnerei-roh'))?.kind, 'filled');
  });

  it('answers no-data for a structurally broken block, as the search does', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: [1, 2], minerals: null });
    assert.deepEqual(await askOne('huhnerei-roh'), { kind: 'no-data' });
  });
});

describe('the locales', () => {
  it('asks in the caller language first, then the rest, and answers not-found only when every locale says so', async () => {
    assert.deepEqual(await askOne('no-such-food', 'fr'), { kind: 'not-found' });
    assert.deepEqual(
      lccAsked.map(({ locale }) => locale),
      ['fr', 'de', 'en', 'it', 'es'],
    );
  });

  it('settles at the first locale that knows the slug', async () => {
    lccAnswer = (slug, locale) =>
      locale === 'en' ? lccFood(slug, { vitamins: { vitaminD: 1 }, minerals: null }) : lccNotFound();
    assert.equal((await askOne('chicken-egg-raw', 'de'))?.kind, 'filled');
    assert.deepEqual(
      lccAsked.map(({ locale }) => locale),
      ['de', 'en'],
    );
  });

  it('a language LowCarbCheck lacks starts at German', async () => {
    await askOne('no-such-food', 'tr');
    assert.equal(lccAsked[0]?.locale, 'de');
  });
});

describe('a failure is unknown, never a fake answer', () => {
  it('reads a bare 404 (not LowCarbCheck’s own) as unknown and stops the walk', async () => {
    lccAnswer = () => new Response('Not Found', { status: 404 });
    assert.deepEqual(await askOne('huhnerei-roh'), { kind: 'unknown' });
    assert.equal(lccCalls, 1);
  });

  it('control: LowCarbCheck’s own not-found walks on to the next locale', async () => {
    await askOne('huhnerei-roh');
    assert.equal(lccCalls, 5);
  });

  it('reads a 500 as unknown, and never caches it', async () => {
    lccAnswer = () => new Response('boom', { status: 500 });
    assert.deepEqual(await askOne('huhnerei-roh'), { kind: 'unknown' });
    assert.deepEqual(await askOne('huhnerei-roh'), { kind: 'unknown' });
    assert.equal(lccCalls, 2, 'the second request asked again');
  });

  it('reads a network failure as unknown', async () => {
    lccAnswer = () => {
      throw new TypeError('fetch failed');
    };
    assert.deepEqual(await askOne('huhnerei-roh'), { kind: 'unknown' });
  });

  it('reads a 200 that does not parse as unknown', async () => {
    lccAnswer = () => Response.json({ results: [] });
    assert.deepEqual(await askOne('huhnerei-roh'), { kind: 'unknown' });
  });
});

describe('the cache', () => {
  it('serves a settled answer again with no upstream call', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: { vitaminD: 2.9 }, minerals: null });
    await askOne('huhnerei-roh');
    await askOne('huhnerei-roh');
    assert.equal(lccCalls, 1);
  });

  it('control: a different slug is asked', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: { vitaminD: 2.9 }, minerals: null });
    await askOne('huhnerei-roh');
    await askOne('huhnerei-gekocht');
    assert.equal(lccCalls, 2);
  });
});

describe('the request', () => {
  it('answers a slug that could walk the upstream path not-found, with no call', async () => {
    const outcomes = await outcomesOf(
      await foodMicronutrients({ request: micronutrientsRequest({ slugs: ['../keys', 'a/b', 'x?y'] }) }),
    );
    assert.deepEqual([...outcomes.values()], [{ kind: 'not-found' }, { kind: 'not-found' }, { kind: 'not-found' }]);
    assert.equal(lccCalls, 0);
  });

  it('control: a plain slug with an umlaut is asked', async () => {
    await askOne('hühnerei-roh');
    assert.ok(lccCalls > 0);
  });

  it('refuses a body that is not JSON, or names no list, with 400 and no call', async () => {
    const notJson = await foodMicronutrients({ request: micronutrientsRequest({ rawBody: 'nope' }) });
    const noList = await foodMicronutrients({ request: micronutrientsRequest({ rawBody: '{"names":["x"]}' }) });
    assert.equal(notJson.status, 400);
    assert.equal(noList.status, 400);
    assert.equal(lccCalls, 0);
  });

  it('answers each distinct slug once, at most 20, in the order sent', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: null, minerals: null });
    const slugs = Array.from({ length: 25 }, (_, index) => `food-${index}`);
    const outcomes = await outcomesOf(
      await foodMicronutrients({ request: micronutrientsRequest({ slugs: ['food-0', ...slugs, ' food-1 '] }) }),
    );
    assert.deepEqual([...outcomes.keys()], slugs.slice(0, 20));
    assert.equal(lccCalls, 20);
  });
});

describe('the per-address limiter', () => {
  it('answers 429 with nothing asked once the window is spent', async () => {
    lccAnswer = (slug) => lccFood(slug, { vitamins: null, minerals: null });
    for (let index = 0; index < 30; index += 1) {
      const response = await foodMicronutrients({ request: micronutrientsRequest({ slugs: [`food-${index}`] }) });
      assert.equal(response.status, 200);
    }
    const callsBefore = lccCalls;
    const refused = await foodMicronutrients({ request: micronutrientsRequest({ slugs: ['one-more'] }) });
    assert.equal(refused.status, 429);
    // SAFETY: the route's own throttled body; a `429` from it carries nothing else.
    const body = (await refused.json()) as { throttled: boolean; retryAfterMs: number };
    assert.equal(body.throttled, true);
    assert.ok(body.retryAfterMs > 0);
    assert.equal(lccCalls, callsBefore, 'the refused request reached no upstream');

    // Control: a request whose slugs are all cached is not charged, so it is
    // still served while the window is spent.
    const cached = await foodMicronutrients({ request: micronutrientsRequest({ slugs: ['food-0'] }) });
    assert.equal(cached.status, 200);
    assert.equal(lccCalls, callsBefore);
  });
});
