/**
 * `GET /v1/plans/prices`, the one anonymous route in the plans subtree.
 *
 * WHAT THIS FILE PROVES, each with a control that goes red when the rule is
 * removed:
 *
 *  - an anonymous caller reads the biller's price list, byte for byte, with a
 *    public five-minute `Cache-Control` and the CORS header the app needs;
 *  - it goes out with `X-Plans-Secret` alone: no account header, no token and
 *    nothing else the caller sent, and a token the caller sends buys and costs
 *    nothing;
 *  - ONLY this path and this method are anonymous: every other path, and a
 *    `POST` or a `HEAD` on this one, still meets the bearer gate;
 *  - the answer is kept for five minutes and a burst is one call to the biller,
 *    while a refusal or a broken biller is asked again;
 *  - one source address gets sixty reads a minute.
 *
 * The dark case (no biller configured) is in `plans-404-when-unset.test.ts`,
 * beside every other plans path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPlansHarness, type PlansHarness, type StartPlansHarnessOptions } from './plans-harness.js';
import {
  PLANS_PRICES_CACHE_TTL_MS,
  PLANS_PRICES_RATE_LIMIT_PER_MINUTE,
  PLANS_PRICES_RATE_LIMITED,
  PLANS_UPSTREAM_UNREACHABLE,
} from '../../src/server/plans-proxy.js';

const SECRET = 'the-shared-plans-secret';

/** What openplate's biller answers, as its own catalogue would. The proxy must relay it unread. */
const PRICE_LIST = JSON.stringify({
  currency: 'EUR',
  plans: [
    { key: 'monthly', interval: 'month', grossCents: 500 },
    { key: 'yearly', interval: 'year', grossCents: 4000 },
  ],
});

/** A syntactically perfect credential this instance never minted. On every other route it is a 401. */
const VALID_LOOKING_TOKEN = 'c'.repeat(48);

/** Boots a lit harness answering the price list, runs the body, and closes it. A fresh one per test, so no cache and no rate limit window leaks between cases. */
async function withBiller(
  body: (lit: PlansHarness) => Promise<void>,
  options: Partial<StartPlansHarnessOptions> = {},
): Promise<void> {
  const lit = await startPlansHarness({ configured: true, secret: SECRET, ...options });
  lit.reply.body = PRICE_LIST;
  try {
    await body(lit);
  } finally {
    await lit.close();
  }
}

function readPrices(
  lit: PlansHarness,
  input: { token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return lit.request({ method: 'GET', path: '/v1/plans/prices', token: input.token, headers: input.headers });
}

test('an anonymous caller reads the price list, byte for byte, public for five minutes', async () => {
  await withBiller(async (lit) => {
    const response = await readPrices(lit);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), PRICE_LIST, "the body is the biller's, unread and unchanged");
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
    // The app runs on another origin, and a simple GET needs no preflight: this
    // one header is what lets its script read the answer.
    assert.equal(response.headers.get('access-control-allow-origin'), '*');

    assert.equal(lit.received.length, 1);
    assert.equal(lit.received[0]?.method, 'GET');
    assert.equal(lit.received[0]?.url, '/plans/prices', "the biller's own path, under the configured base");
  });
});

test('the price list goes out with the secret alone, and nothing the caller sent goes with it', async () => {
  await withBiller(async (lit) => {
    const response = await readPrices(lit, {
      // THE LIVE TOKEN of a real account: on every other plans route it would
      // put that account's id and address on the wire.
      token: lit.accessToken,
      headers: { 'x-account-id': '999', 'x-account-email': 'mallory@example.org', cookie: 'session=abc' },
    });
    assert.equal(response.status, 200);

    const sent = lit.received[0]?.headers ?? {};
    assert.equal(sent['x-plans-secret'], SECRET);
    assert.equal(sent['x-account-id'], undefined, 'there is no account, so there is no account id');
    assert.equal(sent['x-account-email'], undefined, 'and no address');
    assert.equal(sent.authorization, undefined, "the caller's token is never forwarded");
    assert.equal(sent.cookie, undefined);
    assert.equal(sent['content-type'], undefined, 'a GET carries no body and names no type');

    // THE CONTROL: the same token on an authenticated plans route does put the
    // account on the wire, so the absences above are this route's and not the harness's.
    await lit.request({ method: 'GET', path: '/v1/plans/me', token: lit.accessToken });
    assert.equal(lit.received[1]?.headers['x-account-id'], String(lit.account.id));
    assert.equal(lit.received[1]?.headers['x-account-email'], lit.account.email);
  });
});

test('a token this instance never minted is ignored here, where every other route answers 401', async () => {
  await withBiller(async (lit) => {
    const prices = await readPrices(lit, { token: VALID_LOOKING_TOKEN });
    assert.equal(prices.status, 200, 'the token is not read, so it cannot fail');
    assert.equal(lit.received[0]?.headers.authorization, undefined);

    // THE CONTROL: the same token on the next path over.
    const me = await lit.request({ method: 'GET', path: '/v1/plans/me', token: VALID_LOOKING_TOKEN });
    assert.equal(me.status, 401);
  });
});

test('only this path and this method are anonymous: everything else in the subtree still needs a token', async () => {
  await withBiller(async (lit) => {
    const anonymous = [
      { method: 'GET', path: '/v1/plans/offer' },
      { method: 'GET', path: '/v1/plans/me' },
      { method: 'POST', path: '/v1/plans/prices' },
      // Express answers HEAD with a GET route; this one is sent on to the gate.
      { method: 'HEAD', path: '/v1/plans/prices' },
      { method: 'GET', path: '/v1/plans/prices-and-more' },
    ];
    for (const route of anonymous) {
      const response = await lit.request(route);
      assert.equal(response.status, 401, `${route.method} ${route.path} must be 401 without a token`);
    }
    assert.equal(lit.received.length, 0, 'no refused request reached the biller');

    // THE CONTROL: the anonymous GET on the same instance, and the offer with a token.
    assert.equal((await readPrices(lit)).status, 200);
    const offer = await lit.request({ method: 'GET', path: '/v1/plans/offer', token: lit.accessToken });
    assert.equal(offer.status, 200);
    assert.equal(lit.received.length, 2);
  });
});

test('a query string reaches neither the biller nor the cache', async () => {
  await withBiller(async (lit) => {
    await readPrices(lit);
    const withQuery = await lit.request({ method: 'GET', path: '/v1/plans/prices?locale=de&x=1' });
    assert.equal(withQuery.status, 200);
    assert.equal(await withQuery.text(), PRICE_LIST);
    assert.equal(lit.received.length, 1, 'one entry for everybody: the query is not a key');
    assert.equal(lit.received[0]?.url, '/plans/prices');
  });
});

test('the answer is kept for five minutes, so repeated reads are one call to the biller', async () => {
  await withBiller(async (lit) => {
    await readPrices(lit);
    // The biller now says something else. A kept answer does not see it.
    lit.reply.body = JSON.stringify({ currency: 'EUR', plans: [] });

    for (let read = 1; read <= 3; read += 1) {
      assert.equal(await (await readPrices(lit)).text(), PRICE_LIST, `read ${read} is served from memory`);
    }
    lit.advance(PLANS_PRICES_CACHE_TTL_MS - 1);
    assert.equal(await (await readPrices(lit)).text(), PRICE_LIST, 'one millisecond before the window closes');
    assert.equal(lit.received.length, 1);

    // THE CONTROL: at five minutes the biller is asked again, and its new answer is served.
    lit.advance(1);
    assert.equal(await (await readPrices(lit)).text(), lit.reply.body);
    assert.equal(lit.received.length, 2);
  });
});

test('readers who arrive together on a cold entry share one call to the biller', async () => {
  await withBiller(async (lit) => {
    lit.reply.delayMs = 150;
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => readPrices(lit)));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(await response.text(), PRICE_LIST);
    }
    assert.equal(lit.received.length, 1);
  });
});

test('a refusal from the biller is relayed and not kept, so the next reader asks again', async () => {
  await withBiller(async (lit) => {
    lit.reply.status = 503;
    lit.reply.body = JSON.stringify({ error: 'catalogue-unavailable' });

    const refused = await readPrices(lit);
    assert.equal(refused.status, 503, "the biller's status passes through");
    assert.deepEqual(await refused.json(), { error: 'catalogue-unavailable' });
    assert.equal(refused.headers.get('cache-control'), null, 'a refusal is never public for five minutes');

    lit.reply.status = 200;
    lit.reply.body = PRICE_LIST;
    const recovered = await readPrices(lit);
    assert.equal(recovered.status, 200);
    assert.equal(lit.received.length, 2, 'the refusal was not kept');

    // THE CONTROL: the 200 is kept.
    await readPrices(lit);
    assert.equal(lit.received.length, 2);
  });
});

test('an unreachable biller is the ordinary 502, for an anonymous caller too', async () => {
  await withBiller(
    async (lit) => {
      const response = await readPrices(lit);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: PLANS_UPSTREAM_UNREACHABLE });
      assert.equal(response.headers.get('cache-control'), null);
    },
    { unreachable: true },
  );
});

test('one source address gets sixty reads a minute; the next is a 429 the app can read', async () => {
  await withBiller(async (lit) => {
    for (let read = 1; read <= PLANS_PRICES_RATE_LIMIT_PER_MINUTE; read += 1) {
      const response = await readPrices(lit);
      assert.equal(response.status, 200, `read ${read}`);
      await response.body?.cancel();
    }

    const limited = await readPrices(lit);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: PLANS_PRICES_RATE_LIMITED });
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal(limited.headers.get('access-control-allow-origin'), '*');
    assert.match(limited.headers.get('access-control-expose-headers') ?? '', /Retry-After/);
    assert.equal(lit.received.length, 1, 'the biller saw one call in all of it');

    // THE CONTROL: a minute later the same address reads again.
    lit.advance(60_000);
    assert.equal((await readPrices(lit)).status, 200);
  });
});
