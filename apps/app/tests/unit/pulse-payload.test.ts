/**
 * What is actually on the wire, field by field.
 *
 * The promise on the settings page is a list of things that are NOT sent, and
 * the only way to keep a promise of that shape is to assert the exact key set
 * of the body rather than the presence of the two keys that should be there.
 * A test that checked `body.kcal === 500` would pass just as happily with the
 * food name beside it.
 *
 * The `Idempotency-Key` is checked against the uuid v4 regex and checked for
 * being DIFFERENT on two calls: one key reused across two meals would have the
 * server count them as one.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mealDeltaFor, reportMealLogged, resetPulse, roundKcal, roundProtein, setPulseDependencies } from '../../app/lib/pulse';

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

interface Sent {
  headers: Headers;
  body: Record<string, number>;
}

function recorder(sent: Sent[]): typeof fetch {
  return async (_input, init) => {
    // SAFETY: `post` in `#app/lib/pulse` builds every body of every request it
    // makes with `JSON.stringify` over an object of numbers, so the parse
    // below cannot see anything else.
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, number>;
    sent.push({ headers: new Headers(init?.headers), body });
    return new Response('{}', { status: 202 });
  };
}

function signedInWith(sent: Sent[]): void {
  setPulseDependencies({
    fetchImpl: recorder(sent),
    readEnabled: () => true,
    readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
  });
}

beforeEach(() => resetPulse());
afterEach(() => resetPulse());

describe('rounding', () => {
  it('rounds calories to the nearest fifty', () => {
    assert.equal(roundKcal(1234), 1250);
    assert.equal(roundKcal(0), 0);
    assert.equal(roundKcal(24), 0);
    assert.equal(roundKcal(25), 50);
  });

  it('rounds protein to the nearest five grams', () => {
    assert.equal(roundProtein(33), 35);
    assert.equal(roundProtein(2), 0);
    assert.equal(roundProtein(2.5), 5);
  });

  it('sums a log action and leaves unknown macros out of the sum', () => {
    const delta = mealDeltaFor([
      { macros: { kcal: 300, protein: 20 } },
      { macros: { kcal: null, protein: null } },
      { macros: { kcal: 212, protein: 13 } },
    ]);
    assert.deepEqual(delta, { kcal: 512, protein: 33 });
  });
});

describe('the meal delta on the wire', () => {
  it('carries the rounded figures and nothing else', async () => {
    const sent: Sent[] = [];
    signedInWith(sent);

    await reportMealLogged({ kcal: 512, protein: 33 });

    assert.equal(sent.length, 1);
    const only = sent[0];
    assert.ok(only !== undefined);
    assert.deepEqual(only.body, { kcal: 500, protein: 35 });
    // The control for the line above: the key set is exhaustive, so a food
    // name, a timestamp or a goal added to the body fails here.
    assert.deepEqual(Object.keys(only.body).toSorted(), ['kcal', 'protein']);
  });

  it('carries a fresh uuid v4 idempotency key on every call', async () => {
    const sent: Sent[] = [];
    signedInWith(sent);

    await reportMealLogged({ kcal: 100, protein: 10 });
    await reportMealLogged({ kcal: 100, protein: 10 });

    const keys = sent.map((request) => request.headers.get('Idempotency-Key') ?? '');
    assert.equal(keys.length, 2);
    for (const key of keys) assert.match(key, UUID_V4);
    assert.notEqual(keys[0], keys[1]);
  });

  it('presents the account bearer token', async () => {
    const sent: Sent[] = [];
    signedInWith(sent);

    await reportMealLogged({ kcal: 100, protein: 10 });

    assert.equal(sent[0]?.headers.get('Authorization'), 'Bearer token');
  });
});
