/**
 * Unit tests for the `/api/food-matches` resource route (M117/02 review
 * fix): the pure `parseNames` parser directly, plus the `action`'s
 * easily-stubbed behaviors (malformed body, rate limiting) via a constructed
 * `Request`. `resolveIdentifiedFoods`'s own fail-open contract is already
 * covered by `food-resolution.test.ts` — these tests focus on this route's own
 * control flow (rate-limit/JSON-parse), stubbing `fetch` only where a call
 * actually reaches the LCC lookup.
 *
 * BUCKETING (M128 spec 03): the route no longer has a per-user bucket to key
 * on — there are no accounts — so every caller buckets by client IP. In this
 * test environment `trustProxy` is off, so `getClientIp` deliberately ignores
 * `X-Forwarded-For` entirely and collapses every constructed `Request` onto
 * one shared bucket (see `client-ip.ts`'s doc comment for why that's the
 * correct, non-spoofable behaviour). That means the cases here cannot isolate
 * themselves with distinct ids the way they used to; each one clears the
 * shared bucket up front instead. Names still have to stay distinct per case
 * — the food-resolution search cache is process-wide.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { action, MAX_NAMES_PER_REQUEST, parseNames, RATE_LIMIT_MAX_REQUESTS } from '../../app/routes/api.food-matches';
import type {
  FoodMatchesResponseBody,
  FoodMatchesThrottledResponseBody,
} from '../../app/routes/api.food-matches';
import { foodMatchesRateLimitKey } from '../../app/lib/food-matches-rate-limit.server';
import { clearRateLimit } from '../../app/lib/rate-limit.server';

const originalFetch = globalThis.fetch;

function stubFetch(impl: typeof globalThis.fetch): void {
  globalThis.fetch = impl;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

/** Builds the POST request the route's action takes. */
function foodMatchesRequest(names: string[]): Request {
  return new Request('http://localhost/api/food-matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  });
}

/** Starts a case from an empty rate-limit window — see this file's doc comment. */
function resetBudget(): void {
  clearRateLimit(foodMatchesRateLimitKey(foodMatchesRequest([])));
}

/** A unique name prefix per case, so the process-wide food-resolution cache never crosses cases. */
function uniquePrefix(label: string): string {
  return `${label}-${Math.floor(Math.random() * 1_000_000)}`;
}

/**
 * Every shape the route can answer with: the plain success body, optionally
 * carrying the throttled signal's extra fields (see the route's
 * `FoodMatchesThrottledResponseBody`).
 */
type FoodMatchesActionBody = FoodMatchesResponseBody & Partial<Omit<FoodMatchesThrottledResponseBody, 'matches'>>;

/** Reads a route response under the union of shapes the route documents. */
async function readBody(response: Response): Promise<FoodMatchesActionBody> {
  return await response.json();
}

// SAFETY: `action` destructures `request` and nothing else (see
// `app/routes/api.food-matches.ts`), so the router-supplied members of
// `Route.ActionArgs` this literal omits are never read on any path under test.
const actionArgs = (request: Request) => ({ request, params: {} }) as Parameters<typeof action>[0];

/** Invokes the route's `action` with only the argument it actually reads. */
function invokeAction(request: Request): Promise<Response> {
  return action(actionArgs(request));
}

describe('parseNames', () => {
  it('returns an empty array for a non-object body', () => {
    assert.deepEqual(parseNames(null), []);
    assert.deepEqual(parseNames('a string'), []);
    assert.deepEqual(parseNames(42), []);
  });

  it('returns an empty array when `names` is missing or not an array', () => {
    assert.deepEqual(parseNames({}), []);
    assert.deepEqual(parseNames({ names: 'chicken' }), []);
    assert.deepEqual(parseNames({ names: null }), []);
  });

  it('drops non-string and blank entries', () => {
    assert.deepEqual(parseNames({ names: ['chicken', 42, null, '  ', 'rice'] }), ['chicken', 'rice']);
  });

  it(`truncates to ${MAX_NAMES_PER_REQUEST} names — an oversized request never fans out further`, () => {
    const oversized = Array.from({ length: MAX_NAMES_PER_REQUEST + 10 }, (_, index) => `food-${index}`);
    const parsed = parseNames({ names: oversized });

    assert.equal(parsed.length, MAX_NAMES_PER_REQUEST);
    assert.deepEqual(parsed, oversized.slice(0, MAX_NAMES_PER_REQUEST));
  });
});

describe('action — malformed body', () => {
  it('returns a safe empty-matches response for a non-JSON body (never a 4xx)', async () => {
    resetBudget();
    const request = new Request('http://localhost/api/food-matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    const response = await invokeAction(request);

    assert.equal(response.status, 200);
    const body = await readBody(response);
    assert.deepEqual(body.matches, []);
  });
});

describe('action — rate limiting', () => {
  it(`returns a distinct throttled signal (never a bare empty-matches shape) once the limit is exceeded`, async () => {
    resetBudget();
    const prefix = uniquePrefix('throttle-test-food');
    let fetchCallCount = 0;
    stubFetch(async () => {
      fetchCallCount += 1;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });

    try {
      // Each attempt uses a distinct food name — otherwise the food-resolution
      // search cache (M123/05, same module the route calls into) would serve
      // repeats from cache and this test's fetchCallCount assertions (which
      // exist to prove every within-budget request actually reaches the LCC
      // lookup) would no longer measure what they claim to.
      const submit = (attempt: number) => invokeAction(foodMatchesRequest([`${prefix}-${attempt}`]));

      for (let attempt = 0; attempt < RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
        const response = await submit(attempt);
        assert.equal(response.status, 200);
        const body = await readBody(response);
        assert.equal(body.throttled, undefined, 'a request within the limit must not carry the throttled flag');
      }
      assert.equal(
        fetchCallCount,
        RATE_LIMIT_MAX_REQUESTS,
        'every request within the limit should reach the LCC lookup',
      );

      const overLimitResponse = await submit(RATE_LIMIT_MAX_REQUESTS);
      assert.equal(overLimitResponse.status, 200);
      const body = await readBody(overLimitResponse);
      // Distinguishable from a genuine "we checked, nothing matched" response
      // — the UI must never render "No matches" for a throttled caller.
      assert.deepEqual(body.matches, []);
      assert.equal(body.throttled, true);
      assert.ok(body.retryAfterMs !== undefined && body.retryAfterMs > 0, 'a throttled body must carry a retry hint');
      // The rate limiter short-circuits BEFORE resolveIdentifiedFoods/fetch —
      // the count must stay unchanged, not just the response shape.
      assert.equal(fetchCallCount, RATE_LIMIT_MAX_REQUESTS, 'the over-limit request must not reach the LCC lookup');
    } finally {
      restoreFetch();
    }
  });
});

describe('action — throttled vs genuine empty-match response shape (M123/05)', () => {
  it('a genuine empty search result has no throttled flag', async () => {
    resetBudget();
    stubFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    try {
      const response = await invokeAction(foodMatchesRequest([uniquePrefix('a genuinely unmatched food name')]));

      assert.equal(response.status, 200);
      const body = await readBody(response);
      assert.deepEqual(body.matches, [[]]);
      assert.equal('throttled' in body, false);
    } finally {
      restoreFetch();
    }
  });
});

describe('action — rate-limit budget fits realistic use (M123/07)', () => {
  it('a realistic search-as-you-type session (many distinct foods, some re-searched) never gets throttled', async () => {
    resetBudget();
    stubFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const prefix = uniquePrefix('session-food');
    try {
      // Simulates one ordinary sitting: 12 distinct foods, each with the
      // debounce firing ~3 times as the person types/corrects/refines (the
      // real trigger for M123/07 — a single food name is rarely typed
      // without a pause >=250ms), for 36 requests total — comfortably under
      // the old 20/10-minute budget's failure point, but the exact kind of
      // volume a normal person hits inside one search session.
      const foods = Array.from({ length: 12 }, (_, index) => `${prefix}-${index}`);
      let requestCount = 0;
      for (const food of foods) {
        for (const typed of [food.slice(0, food.length - 4), food.slice(0, food.length - 2), food]) {
          requestCount += 1;
          const response = await invokeAction(foodMatchesRequest([typed]));
          assert.equal(response.status, 200);
          const body = await readBody(response);
          assert.equal(body.throttled, undefined, `request ${requestCount} of the session must not be throttled`);
        }
      }

      // Now re-search a couple of the earlier foods (a person backspacing
      // back to a prior query, or simply reconsidering) — cache hits, so
      // they cost nothing against the budget even this deep into the
      // session.
      for (const food of [foods[0]!, foods[5]!]) {
        const response = await invokeAction(foodMatchesRequest([food]));
        const body = await readBody(response);
        assert.equal(body.throttled, undefined, 're-searching an already-resolved food must never throttle');
      }
    } finally {
      restoreFetch();
    }
  });

  it('a genuine abuse burst of novel names still gets throttled', async () => {
    resetBudget();
    stubFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const prefix = uniquePrefix('abuse-burst-food');
    try {
      const submit = (attempt: number) => invokeAction(foodMatchesRequest([`${prefix}-${attempt}`]));

      for (let attempt = 0; attempt < RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
        const response = await submit(attempt);
        const body = await readBody(response);
        assert.equal(body.throttled, undefined, `attempt ${attempt} is within budget`);
      }

      const overLimit = await submit(RATE_LIMIT_MAX_REQUESTS);
      const body = await readBody(overLimit);
      assert.equal(body.throttled, true, 'a burst of distinct never-searched names must still be throttled');
      assert.ok(body.retryAfterMs !== undefined && body.retryAfterMs > 0);
    } finally {
      restoreFetch();
    }
  });

  it('a request built entirely from already-cached names bypasses the budget even once it is exhausted', async () => {
    resetBudget();
    stubFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const prefix = uniquePrefix('exhaust-budget-food');
    const commonFood = uniquePrefix('shared-office-food');
    try {
      // Prime the cache once (e.g. the first person behind a shared IP).
      const primeResponse = await invokeAction(foodMatchesRequest([commonFood]));
      assert.equal((await readBody(primeResponse)).throttled, undefined);

      // Exhaust the budget with distinct novel names.
      for (let attempt = 0; attempt < RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
        await invokeAction(foodMatchesRequest([`${prefix}-${attempt}`]));
      }
      // Confirm the budget really is exhausted now.
      const throttledCheck = await invokeAction(foodMatchesRequest([`${prefix}-final`]));
      assert.equal((await readBody(throttledCheck)).throttled, true);

      // The same-IP "someone else" re-searching the already-cached common
      // food is still served — this is the shared-IP fix (M123/07), and it is
      // the ONLY thing keeping a shared-IP budget tolerable now that IP is the
      // only bucketing signal there is (M128 spec 03).
      const cachedRequest = await invokeAction(foodMatchesRequest([commonFood]));
      assert.equal(cachedRequest.status, 200);
      const cachedBody = await readBody(cachedRequest);
      assert.equal(cachedBody.throttled, undefined, 'a fully-cached request must bypass an exhausted budget');
    } finally {
      restoreFetch();
    }
  });
});

describe('foodMatchesRateLimitKey', () => {
  it('buckets by client IP only — there is no account identifier left to key on (M128 spec 03)', () => {
    const key = foodMatchesRateLimitKey(foodMatchesRequest(['egg']));
    assert.match(key, /^food-matches:ip:/);
  });
});
