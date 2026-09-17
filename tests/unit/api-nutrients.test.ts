/**
 * The basis parameter on `/api/nutrients` (M234 spec 05).
 *
 * The route is the ONE place a reference basis is chosen. The service below it
 * caches all three published bases for twelve hours under the API URL alone,
 * so nothing in this app can serve a stale CHOICE, and nothing downstream of
 * this route can see two bases at once.
 *
 * Three refusals and one default are pinned here:
 *
 *  - an unknown `basis` is a 400 carrying no nutrient list, because a typo that
 *    silently serves the default is a door that looks locked,
 *  - `?basis=us` and `?basis=dge` answer with different numbers, which is what
 *    proves the parameter is read at all,
 *  - no parameter serves the INSTANCE default. This file sets
 *    `NUTRIENT_REFERENCE_BASIS=us`, never the shipped `dge`, so a hardcoded
 *    default fails here rather than passing by coincidence,
 *  - one upstream body serves every basis: the fetch happens once.
 *
 * The environment is set BEFORE the route module is imported, because `CONFIG`
 * reads `process.env` once at module load. A static import would bind the
 * developer's own shell.
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The instance default this file runs under. Deliberately NOT `dge`, the shipped default. */
const INSTANCE_BASIS = 'us';

const WIRE_FIXTURE_PATH = fileURLToPath(new URL('../fixtures/nutrients-response.json', import.meta.url));

/** The upstream base URL the stubbed fetch answers for. Never reached: nothing here goes to the network. */
const FIXTURE_API_URL = 'https://fixture.invalid';

/** The route module, called the way the router calls it. */
interface NutrientsRouteModule {
  loader: (args: { request: Request }) => Promise<Response>;
}

/** One nutrient as this app's own `/api/nutrients` body carries it. */
interface ResponseNutrient {
  key: string;
  rda: { source: string; female: { '31-50': number } } | null;
}

let route: NutrientsRouteModule;
let clearCache: () => void;
let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

/** Reads the 31 to 50 female iron figure out of a served body, or null when the row has no reference. */
async function ironForFemaleThirtyOneToFifty(response: Response): Promise<number | null> {
  // SAFETY: the body is this route's own `NutrientReferenceResponseBody`,
  // built one line earlier from parsed and validated references. `json()`
  // types its result as `any`; this names the two fields the test reads.
  const body = (await response.json()) as { nutrients: ResponseNutrient[] };
  const iron = body.nutrients.find((nutrient) => nutrient.key === 'iron');
  return iron?.rda?.female['31-50'] ?? null;
}

async function loadNutrients(query: string): Promise<Response> {
  return route.loader({ request: new Request(`http://localhost:3000/api/nutrients${query}`) });
}

describe('GET /api/nutrients?basis=', () => {
  before(async () => {
    process.env.NUTRIENT_REFERENCE_BASIS = INSTANCE_BASIS;
    process.env.FOOD_DB_API_URL = FIXTURE_API_URL;
    const fixture = readFileSync(WIRE_FIXTURE_PATH, 'utf8');

    globalThis.fetch = (input: Parameters<typeof realFetch>[0]) => {
      fetchCalls.push(String(input));
      return Promise.resolve(new Response(fixture, { headers: { 'content-type': 'application/json' } }));
    };

    const imported: unknown = await import('../../app/routes/api.nutrients');
    // SAFETY: this repo's own route module. Its typed loader takes React
    // Router's full server-args object; it reads `request` and nothing else,
    // so the narrower shape above is what it does at runtime.
    route = imported as NutrientsRouteModule;

    const service: unknown = await import('../../app/services/nutrient-reference/index.server');
    // SAFETY: same module this route imports, narrowed to the one test hook it
    // exports so each case starts with an empty cache.
    clearCache = (service as { clearNutrientReferenceCache: () => void }).clearNutrientReferenceCache;
  });

  beforeEach(() => {
    clearCache();
    fetchCalls = [];
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  it('refuses an unknown basis with a 400 that is not a nutrient list', async () => {
    const response = await loadNutrients('?basis=xx');
    assert.equal(response.status, 400);

    // SAFETY: the refusal body this route builds, `NutrientBasisErrorBody`.
    const body = (await response.json()) as { error?: string; nutrients?: unknown };
    assert.equal(body.error, 'unknown_basis');
    assert.equal(body.nutrients, undefined);
    // No request went upstream either: the typo is refused before the fetch.
    assert.deepEqual(fetchCalls, []);
  });

  it('serves a known basis with a 200 and a list, so the 400 above is about the value and not the parameter', async () => {
    const response = await loadNutrients('?basis=dge');
    assert.equal(response.status, 200);
    assert.notEqual(await ironForFemaleThirtyOneToFifty(response), null);
  });

  it('reads the parameter: two bases answer with two different numbers for one nutrient', async () => {
    const dge = await ironForFemaleThirtyOneToFifty(await loadNutrients('?basis=dge'));
    const us = await ironForFemaleThirtyOneToFifty(await loadNutrients('?basis=us'));

    // Asserted FIRST. If the two published figures were equal, every equality
    // below would pass against a route that ignored the parameter entirely.
    assert.notEqual(dge, us);
    assert.equal(dge, 16);
    assert.equal(us, 18);
  });

  it('serves the instance default when no parameter is given', async () => {
    const byDefault = await ironForFemaleThirtyOneToFifty(await loadNutrients(''));
    const explicit = await ironForFemaleThirtyOneToFifty(await loadNutrients(`?basis=${INSTANCE_BASIS}`));
    const dge = await ironForFemaleThirtyOneToFifty(await loadNutrients('?basis=dge'));

    assert.equal(byDefault, explicit);
    // The control: this instance's default is `us`, so a route that hardcoded
    // the shipped `dge` default would pass the line above and fail this one.
    assert.notEqual(byDefault, dge);
  });

  it('fetches the upstream body once and serves every basis from it', async () => {
    await loadNutrients('?basis=dge');
    await loadNutrients('?basis=efsa');
    await loadNutrients('?basis=us');

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], /^https:\/\/fixture\.invalid\/api\/v1\/nutrients$/);
  });
});
