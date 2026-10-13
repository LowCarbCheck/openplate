/**
 * `/api/food-micronutrients` against the server's DAILY CAP on LowCarbCheck
 * calls (the micronutrient backfill, 2026-10-13), on an open instance.
 *
 * Its own file because the cap is read from the environment once, on import,
 * and a cap this small would starve the cases in `api-food-micronutrients.test.ts`.
 *
 * The claim that matters: a cap reached in the middle of a slug's locale walk
 * answers that slug `unknown`, never `not-found`, because a not-found is final
 * on the device and the food was never fully asked about.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  FoodMicronutrientsResponseBody,
  SlugMicronutrientsOutcome,
} from '../../app/services/food-db/micronutrients-wire';

const LCC = 'http://lcc.test';
const DAILY_LIMIT = 3;

process.env.FOOD_DB_API_URL = LCC;
process.env.FOOD_DB_DAILY_CALL_LIMIT = String(DAILY_LIMIT);

type Action = (args: { request: Request }) => Promise<Response>;

let foodMicronutrients: Action;
let resetState: () => void;

let lccCalls = 0;
/** The one locale that knows the slug this case, or none. */
let knownIn: string | null = null;

const realFetch = globalThis.fetch;

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin !== LCC) return Promise.reject(new Error(`unexpected request to ${url.href}`));
  lccCalls += 1;
  if (url.searchParams.get('locale') === knownIn) {
    return Promise.resolve(Response.json({ slug: 'x', vitamins: { vitaminD: 1 }, minerals: null }));
  }
  return Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));
}

function micronutrientsRequest(slugs: readonly string[]): Request {
  return new Request('http://localhost/api/food-micronutrients', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'openplate-language=de' },
    body: JSON.stringify({ slugs }),
  });
}

async function askOne(slug: string): Promise<SlugMicronutrientsOutcome | undefined> {
  const response = await foodMicronutrients({ request: micronutrientsRequest([slug]) });
  assert.equal(response.status, 200);
  // SAFETY: the route's own success body; a `200` carries nothing else.
  const body = (await response.json()) as FoodMicronutrientsResponseBody;
  return body.results.find((answer) => answer.slug === slug)?.outcome;
}

before(async () => {
  // SAFETY: `fakeFetch` implements `fetch(input)`, the only form the code under
  // test calls; `typeof fetch` also carries `preconnect`, which nothing touches.
  globalThis.fetch = fakeFetch as typeof fetch;
  const routeModule: object = await import('../../app/routes/api.food-micronutrients');
  // SAFETY: this repo's own route module; its action reads `request` and nothing else.
  foodMicronutrients = (routeModule as { action: Action }).action;
  const { resetFoodDbDailyBudget } = await import('../../app/lib/food-db-daily-budget.server');
  const { clearRateLimit } = await import('../../app/lib/rate-limit.server');
  const { foodMicronutrientsRateLimitKey } = await import('../../app/lib/food-micronutrients-rate-limit.server');
  const { clearFoodMicronutrientsCache } = await import('../../app/services/food-db/micronutrients.server');
  resetState = () => {
    resetFoodDbDailyBudget();
    clearRateLimit(foodMicronutrientsRateLimitKey(micronutrientsRequest([])));
    clearFoodMicronutrientsCache();
  };
});

beforeEach(() => {
  resetState();
  lccCalls = 0;
  knownIn = null;
});

after(() => {
  globalThis.fetch = realFetch;
});

describe('the daily cap', () => {
  it('answers a slug whose walk the cap cuts short unknown, after exactly the capped calls', async () => {
    assert.deepEqual(await askOne('no-such-food'), { kind: 'unknown' });
    assert.equal(lccCalls, DAILY_LIMIT);
  });

  it('control: a slug settled within the cap is answered', async () => {
    knownIn = 'en';
    assert.equal((await askOne('chicken-egg-raw'))?.kind, 'filled');
    assert.equal(lccCalls, 2);
  });

  it('refuses a request whose first calls alone pass the cap with 429, and asks nothing', async () => {
    const response = await foodMicronutrients({ request: micronutrientsRequest(['a', 'b', 'c', 'd']) });
    assert.equal(response.status, 429);
    assert.equal(lccCalls, 0);
  });

  it('control: as many slugs as the cap allows are served', async () => {
    knownIn = 'de';
    const response = await foodMicronutrients({ request: micronutrientsRequest(['a', 'b', 'c']) });
    assert.equal(response.status, 200);
    assert.equal(lccCalls, DAILY_LIMIT);
  });
});
