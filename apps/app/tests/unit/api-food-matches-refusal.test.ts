/**
 * `/api/food-matches` publishes the food-database status, and never the key
 * (M238 spec 02).
 *
 * ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────
 *
 * `CONFIG` reads `process.env` ONCE, at module load. This file is the only one
 * in the suite that needs a configured `FOOD_DB_API_KEY`, so it sets the
 * environment in `before()` and reaches the route by DYNAMIC import, exactly
 * as `tests/unit/api-nutrients.test.ts` does. A static import would bind
 * whatever the developer's own shell happened to hold, and a key set here
 * would leak into every other suite sharing the process.
 *
 * ── WHAT IT PROVES ───────────────────────────────────────────────────────
 *
 * Two things the service-level suite cannot. That the status actually reaches
 * the WIRE, which is the only way it reaches a screen. And that a response
 * built while a key was configured does not contain that key anywhere in it,
 * which is the rule the whole milestone rests on: the LowCarbCheck API is
 * CORS-open, so a key in a page is a public key.
 *
 * The control is a 200 upstream: the same route, the same request, and a body
 * that reports `ok: true`. Without it, a route that hardcoded `ok: false`, or
 * one that sent no `foodDb` at all, would pass the refusal case.
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

/** The base URL `CONFIG` is given. Nothing listens on it: every call is stubbed below. */
const FIXTURE_API_URL = 'https://fixture.invalid';

/** A key in the frozen M202 format. Long enough that a 16-character prefix is not the whole key. */
const API_KEY = 'lcc_live_0123456789abcdefghijklmnopqrstuv';

/** The route module, called the way the router calls it. */
interface FoodMatchesRouteModule {
  action: (args: { request: Request }) => Promise<Response>;
}

/** The part of this route's own body this file reads. */
interface FoodMatchesBody {
  matches: unknown[];
  foodDb?: { ok: boolean; reason: string | null };
}

let route: FoodMatchesRouteModule;
let clearStatus: () => void;
let clearSearchCache: () => void;
let nextStatus = 200;
let nextBody = JSON.stringify({ results: [] });
const realFetch = globalThis.fetch;

/** Posts one name and hands back the parsed body. */
async function resolveOneName(): Promise<FoodMatchesBody> {
  const response = await route.action({
    request: new Request('http://localhost:3000/api/food-matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ names: ['rye bread'] }),
    }),
  });
  assert.equal(response.status, 200, 'this route is fail open and never answers a non-2xx');
  // SAFETY: the route's own `FoodMatchesResponseBody`, built two lines earlier
  // in its own source. `json()` types its result as `any`; this names the two
  // fields the cases below read.
  return (await response.json()) as FoodMatchesBody;
}

/** The same request, kept as raw text, so an assertion can search the whole thing. */
async function resolveOneNameAsText(): Promise<string> {
  const response = await route.action({
    request: new Request('http://localhost:3000/api/food-matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ names: ['rye bread'] }),
    }),
  });
  return response.text();
}

describe('POST /api/food-matches, with a key configured', () => {
  before(async () => {
    process.env.FOOD_DB_API_URL = FIXTURE_API_URL;
    process.env.FOOD_DB_API_KEY = API_KEY;

    globalThis.fetch = () =>
      Promise.resolve(new Response(nextBody, { status: nextStatus, headers: { 'content-type': 'application/json' } }));

    const imported: unknown = await import('../../app/routes/api.food-matches');
    // SAFETY: this repo's own route module. Its typed action takes React
    // Router's full server-args object; it reads `request` and nothing else.
    route = imported as FoodMatchesRouteModule;

    const status: unknown = await import('../../app/services/food-db/status');
    // SAFETY: the same module the route imports, narrowed to the one hook each
    // case needs so it starts from a clear status.
    clearStatus = (status as { noteFoodDbAccepted: () => void }).noteFoodDbAccepted;

    const service: unknown = await import('../../app/services/food-resolution');
    // SAFETY: same again, for the per-name search cache. A cached answer would
    // skip the upstream call these cases are about.
    clearSearchCache = (service as { clearFoodResolutionCache: () => void }).clearFoodResolutionCache;
  });

  beforeEach(() => {
    nextStatus = 200;
    nextBody = JSON.stringify({ results: [] });
    clearStatus();
    clearSearchCache();
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  it('reports a refusal on the wire, and still answers a matches array', async () => {
    nextStatus = 401;
    nextBody = JSON.stringify({ error: { code: 'invalid_key', message: 'no', docs: 'https://lowcarbcheck.org' } });

    const body = await resolveOneName();

    // FAIL OPEN IS UNCHANGED: one empty list per requested name.
    assert.deepEqual(body.matches, [[]]);
    assert.deepEqual(body.foodDb, { ok: false, reason: 'invalid_key' });
  });

  it('reports ok when the upstream answered, which is what makes the case above mean something', async () => {
    // THE CONTROL. A route that hardcoded a refusal, or sent no `foodDb` at
    // all, passes the case above and fails this one.
    const body = await resolveOneName();

    assert.deepEqual(body.foodDb, { ok: true, reason: null });
  });

  it('never puts the key in the response body, refused or not', async () => {
    nextStatus = 401;
    nextBody = JSON.stringify({ error: { code: 'invalid_key' } });
    const refused = await resolveOneNameAsText();

    clearStatus();
    clearSearchCache();
    nextStatus = 200;
    nextBody = JSON.stringify({ results: [] });
    const accepted = await resolveOneNameAsText();

    for (const text of [refused, accepted]) {
      assert.equal(text.includes(API_KEY), false, 'the whole key must never be in a body');
      // The display prefix is a LOG affordance, not a wire one. Nothing on a
      // screen needs it, so nothing puts it there either.
      assert.equal(text.includes(API_KEY.slice(0, 16)), false, 'not even the display prefix belongs on the wire');
    }
    // And the search really did run, so these are not two empty strings.
    assert.ok(refused.includes('"matches"'), 'the body must be this route own answer');
  });
});
