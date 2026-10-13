/**
 * `/api/food-micronutrients` on an instance with NO food database
 * (`FOOD_DB_API_URL` set empty): `404`, and nothing leaves the server.
 *
 * Its own file because `CONFIG` is read once, on import. The device reads this
 * `404` as "nothing to ask here" and records nothing
 * (`micronutrient-backfill-client.ts`), so it never counts an attempt against
 * a food on an instance that cannot answer.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.FOOD_DB_API_URL = '';

type Action = (args: { request: Request }) => Promise<Response>;

let foodMicronutrients: Action;
let fetchCalls = 0;
const realFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error('no request may leave an instance without a food database'));
  };
  const routeModule: object = await import('../../app/routes/api.food-micronutrients');
  // SAFETY: this repo's own route module; its action reads `request` and nothing else.
  foodMicronutrients = (routeModule as { action: Action }).action;
});

after(() => {
  globalThis.fetch = realFetch;
});

describe('with no food database', () => {
  it('answers 404 and asks nothing', async () => {
    const response = await foodMicronutrients({
      request: new Request('http://localhost/api/food-micronutrients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slugs: ['huhnerei-roh'] }),
      }),
    });
    assert.equal(response.status, 404);
    assert.equal(fetchCalls, 0);
  });
});
