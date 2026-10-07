/**
 * `/api/food-matches` and `/api/food-proposals` on a MANAGED instance, and the
 * daily cap on LowCarbCheck calls (2026-09-30 security fix).
 *
 * THE FINDING: both routes answered anybody, and every uncached name was a call
 * under the operator's key, so anyone could spend the month's allowance and
 * stop food search for everyone. On a managed instance they now ask core
 * whether the caller's bearer is live, and refuse before anything leaves for
 * LowCarbCheck. Every case below counts the calls that reached each side, not
 * only the status, because a guard that answered `401` AFTER the lookup would
 * pass a status check and still spend the key.
 *
 * THE ENVIRONMENT IS SET BEFORE THE MODULES LOAD. `CONFIG` is parsed once, on
 * import, so this file imports the routes dynamically after writing
 * `process.env`, the pattern `api-food-matches-refusal.test.ts` uses. `node
 * --test` runs each file in its own process, so none of it leaks into the
 * open-instance suite in `api-food-matches.test.ts`.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { FoodMatchesThrottledResponseBody } from '../../app/routes/api.food-matches';

const CORE = 'http://core.test';
const LCC = 'http://lcc.test';
const LIVE_TOKEN = 'live-token';
const DEAD_TOKEN = 'dead-token';
const DAILY_LIMIT = 4;

process.env.INSTANCE_MODE = 'managed';
process.env.CORE_URL = CORE;
process.env.FOOD_DB_API_URL = LCC;
process.env.FOOD_DB_API_KEY = 'lcc_live_test_key_000000000000000';
process.env.FOOD_DB_BACKFILL = 'true';
process.env.FOOD_DB_DAILY_CALL_LIMIT = String(DAILY_LIMIT);

/** The one argument each action reads. */
type ActionArgs = { request: Request };
type Action = (args: ActionArgs) => Promise<Response>;

let foodMatches: Action;
let foodProposals: Action;
let resetState: () => void;

/** Calls that reached each side, per case. */
let coreCalls = 0;
let lccCalls = 0;
/** What core answers this case with. */
let coreAnswer: (authorization: string | null) => Response;

const realFetch = globalThis.fetch;

/** Core's answer for the two known tokens: live, or refused. */
function coreByToken(authorization: string | null): Response {
  if (authorization === `Bearer ${LIVE_TOKEN}`) return Response.json({ account: { id: 1 } });
  return Response.json({ error: 'authentication required' }, { status: 401 });
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (new URL(url).origin === CORE) {
    coreCalls += 1;
    return Promise.resolve(coreAnswer(new Headers(init?.headers).get('authorization')));
  }
  if (new URL(url).origin === LCC) {
    lccCalls += 1;
    if (url.endsWith('/proposals')) return Promise.resolve(new Response(null, { status: 202 }));
    return Promise.resolve(Response.json({ results: [] }));
  }
  return Promise.reject(new Error(`unexpected request to ${url}`));
}

let nameCounter = 0;
/** Names nobody has searched in this process, so each case reaches the lookup. */
function freshNames(count: number): string[] {
  return Array.from({ length: count }, () => `managed-food-${(nameCounter += 1)}`);
}

/** JSON headers, with the bearer when there is a token. */
function jsonHeaders(token: string | undefined): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

function matchesRequest(names: string[], token?: string): Request {
  const headers = jsonHeaders(token);
  return new Request('http://localhost/api/food-matches', { method: 'POST', headers, body: JSON.stringify({ names }) });
}

function proposalsRequest(token?: string): Request {
  const headers = jsonHeaders(token);
  const proposal = {
    kind: 'new',
    translations: { en: 'Kale bowl', de: 'Grünkohlschale' },
    macrosPer100g: { carbs: 6, fat: 4, protein: 8, kcal: 95 },
    via: 'photo',
  };
  return new Request('http://localhost/api/food-proposals', {
    method: 'POST',
    headers,
    body: JSON.stringify({ proposals: [proposal] }),
  });
}

/** The one export each route module is read for. */
interface RouteModule {
  action: Action;
}

before(async () => {
  // SAFETY: `fakeFetch` implements `fetch(input, init)`, the only form the
  // code under test calls; `typeof fetch` also carries `preconnect`, which
  // nothing here touches.
  globalThis.fetch = fakeFetch as typeof fetch;
  const matchesModule: unknown = await import('../../app/routes/api.food-matches');
  const proposalsModule: unknown = await import('../../app/routes/api.food-proposals');
  // SAFETY: this repo's own route module. Its typed action takes React
  // Router's full server-args object and reads `request` and nothing else.
  foodMatches = (matchesModule as RouteModule).action;
  // SAFETY: the same, for the proposals relay.
  foodProposals = (proposalsModule as RouteModule).action;
  const { clearAccountTokenCache } = await import('../../app/lib/managed-account-gate.server');
  const { resetFoodDbDailyBudget } = await import('../../app/lib/food-db-daily-budget.server');
  const { clearRateLimit } = await import('../../app/lib/rate-limit.server');
  const { foodMatchesRateLimitKey } = await import('../../app/lib/food-matches-rate-limit.server');
  const { foodProposalsRateLimitKey } = await import('../../app/lib/food-proposals-rate-limit.server');
  resetState = () => {
    clearAccountTokenCache();
    resetFoodDbDailyBudget();
    clearRateLimit(foodMatchesRateLimitKey(matchesRequest([])));
    clearRateLimit(foodProposalsRateLimitKey(proposalsRequest()));
  };
});

beforeEach(() => {
  resetState();
  coreCalls = 0;
  lccCalls = 0;
  coreAnswer = coreByToken;
});

after(() => {
  globalThis.fetch = realFetch;
});

describe('/api/food-matches on a managed instance', () => {
  it('refuses a caller with no token with 401, and asks neither core nor LowCarbCheck', async () => {
    const response = await foodMatches({ request: matchesRequest(freshNames(3)) });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.equal(coreCalls, 0);
    assert.equal(lccCalls, 0, 'the lookup must not run for a caller with no account');
  });

  it('refuses a token core refuses with 401, and remembers the refusal', async () => {
    const first = await foodMatches({ request: matchesRequest(freshNames(1), DEAD_TOKEN) });
    const second = await foodMatches({ request: matchesRequest(freshNames(1), DEAD_TOKEN) });
    assert.equal(first.status, 401);
    assert.equal(second.status, 401);
    assert.equal(coreCalls, 1, 'the second refusal came from the cache');
    assert.equal(lccCalls, 0);
  });

  it('control: a live token is served, and core is asked once for a session of searches', async () => {
    const first = await foodMatches({ request: matchesRequest(freshNames(1), LIVE_TOKEN) });
    const second = await foodMatches({ request: matchesRequest(freshNames(1), LIVE_TOKEN) });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(coreCalls, 1);
    assert.equal(lccCalls, 2);
  });

  it('fails closed with 503 when core cannot be asked, and never caches that', async () => {
    coreAnswer = () => new Response('bad gateway', { status: 502 });
    const first = await foodMatches({ request: matchesRequest(freshNames(1), LIVE_TOKEN) });
    assert.equal(first.status, 503);
    assert.equal(lccCalls, 0, 'a lookup must not run while the check is down');

    coreAnswer = coreByToken;
    const second = await foodMatches({ request: matchesRequest(freshNames(1), LIVE_TOKEN) });
    assert.equal(second.status, 200, 'core back up, the same token is served at once');
  });
});

describe('the daily cap on LowCarbCheck calls', () => {
  it('answers 429 with the throttled body once the day is spent, and makes no call', async () => {
    const withinCap = await foodMatches({ request: matchesRequest(freshNames(DAILY_LIMIT), LIVE_TOKEN) });
    assert.equal(withinCap.status, 200);
    assert.equal(lccCalls, DAILY_LIMIT);

    const overCap = await foodMatches({ request: matchesRequest(freshNames(1), LIVE_TOKEN) });
    assert.equal(overCap.status, 429);
    const body: FoodMatchesThrottledResponseBody = await overCap.json();
    assert.deepEqual(body.matches, []);
    assert.equal(body.throttled, true, 'a capped caller is told to wait, never "no matches"');
    assert.ok(body.retryAfterMs > 0);
    assert.equal(lccCalls, DAILY_LIMIT, 'the capped request did not reach LowCarbCheck');
  });

  it('refuses a request whose names would pass the cap, whole, before any call', async () => {
    const response = await foodMatches({ request: matchesRequest(freshNames(DAILY_LIMIT + 1), LIVE_TOKEN) });
    assert.equal(response.status, 429);
    assert.equal(lccCalls, 0);
  });

  it('control: a cached name costs nothing and is served past the cap', async () => {
    const [name] = freshNames(1);
    if (name === undefined) throw new Error('no name');
    await foodMatches({ request: matchesRequest([name], LIVE_TOKEN) });
    await foodMatches({ request: matchesRequest(freshNames(DAILY_LIMIT - 1), LIVE_TOKEN) });
    const again = await foodMatches({ request: matchesRequest([name], LIVE_TOKEN) });
    assert.equal(again.status, 200);
    assert.equal(lccCalls, DAILY_LIMIT);
  });
});

describe('/api/food-proposals on a managed instance', () => {
  it('refuses a caller with no token with 401, and relays nothing', async () => {
    const response = await foodProposals({ request: proposalsRequest() });
    assert.equal(response.status, 401);
    assert.equal(coreCalls, 0);
    assert.equal(lccCalls, 0);
  });

  it('refuses a token core refuses with 401, and relays nothing', async () => {
    const response = await foodProposals({ request: proposalsRequest(DEAD_TOKEN) });
    assert.equal(response.status, 401);
    assert.equal(lccCalls, 0);
  });

  it('control: relays for a live token, and a spent day stops the relay with 429', async () => {
    const accepted = await foodProposals({ request: proposalsRequest(LIVE_TOKEN) });
    assert.equal(accepted.status, 202);
    assert.equal(lccCalls, 1);

    await foodMatches({ request: matchesRequest(freshNames(DAILY_LIMIT - 1), LIVE_TOKEN) });
    const capped = await foodProposals({ request: proposalsRequest(LIVE_TOKEN) });
    assert.equal(capped.status, 429);
    assert.equal(lccCalls, DAILY_LIMIT, 'the capped relay did not reach LowCarbCheck');
  });
});
