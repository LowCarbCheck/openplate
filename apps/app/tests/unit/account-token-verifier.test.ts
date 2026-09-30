/**
 * The account check behind `/api/food-matches` and `/api/food-proposals` on a
 * managed instance (2026-09-30 security fix): how a bearer is read, what each
 * answer from core becomes, and how long each is remembered. Core is a fake
 * `fetch`, and the clock is injected.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_READ_PATH,
  createAccountTokenVerifier,
  INVALID_TOKEN_TTL_MS,
  parseBearerToken,
  VALID_TOKEN_TTL_MS,
  type AccountFetch,
} from '../../app/lib/account-token-verifier.server';

const CORE = 'http://core.test';

/** A fake core that answers every read with `answer` and records what it was sent. */
function fakeCore(answer: () => Response | Promise<Response>) {
  const calls: { url: string; authorization: string | null }[] = [];
  const fetchImpl: AccountFetch = async (url, init) => {
    calls.push({ url, authorization: new Headers(init.headers).get('authorization') });
    return answer();
  };
  return { calls, fetchImpl };
}

/** Core's `200` for a live token. */
const liveAccount = (): Response => Response.json({ account: { id: 7, email: 'a@example.test' } });

/** A clock the test moves by hand. */
function manualClock(start: number) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('parseBearerToken', () => {
  it('reads the token out of a bearer header, the scheme in any case', () => {
    assert.equal(parseBearerToken('Bearer abc.def'), 'abc.def');
    assert.equal(parseBearerToken('bearer abc'), 'abc');
    assert.equal(parseBearerToken('  BEARER   abc  '), 'abc');
  });

  it('reads no token from an absent, empty, foreign or doubled header', () => {
    assert.equal(parseBearerToken(null), null);
    assert.equal(parseBearerToken(''), null);
    assert.equal(parseBearerToken('Bearer'), null);
    assert.equal(parseBearerToken('Basic dXNlcjpwYXNz'), null);
    assert.equal(parseBearerToken('Bearer a b'), null);
    assert.equal(parseBearerToken('Bearer a,Bearer b'), null);
  });

  it('refuses a token longer than any core issues', () => {
    assert.equal(parseBearerToken(`Bearer ${'x'.repeat(513)}`), null);
    assert.equal(parseBearerToken(`Bearer ${'x'.repeat(512)}`), 'x'.repeat(512));
  });
});

describe('createAccountTokenVerifier', () => {
  it("asks core's account read with the token as the bearer", async () => {
    const core = fakeCore(liveAccount);
    const verifier = createAccountTokenVerifier({ syncServerUrl: CORE, fetchImpl: core.fetchImpl });
    assert.equal(await verifier.verify('tok-1'), 'valid');
    assert.deepEqual(core.calls, [{ url: `${CORE}${ACCOUNT_READ_PATH}`, authorization: 'Bearer tok-1' }]);
  });

  it('believes a live token for five minutes, then asks again', async () => {
    const core = fakeCore(liveAccount);
    const clock = manualClock(1_000_000);
    const verifier = createAccountTokenVerifier({ syncServerUrl: CORE, fetchImpl: core.fetchImpl, now: clock.now });
    await verifier.verify('tok');
    clock.advance(VALID_TOKEN_TTL_MS - 1);
    assert.equal(await verifier.verify('tok'), 'valid');
    assert.equal(core.calls.length, 1, 'inside five minutes core is not asked again');
    clock.advance(1);
    await verifier.verify('tok');
    assert.equal(core.calls.length, 2, 'at five minutes core is asked again');
  });

  it('refuses a token core answers 401 or 403 for, and remembers that for one minute', async () => {
    for (const status of [401, 403]) {
      const core = fakeCore(() => Response.json({ error: 'authentication required' }, { status }));
      const clock = manualClock(0);
      const verifier = createAccountTokenVerifier({ syncServerUrl: CORE, fetchImpl: core.fetchImpl, now: clock.now });
      assert.equal(await verifier.verify('dead'), 'invalid');
      clock.advance(INVALID_TOKEN_TTL_MS - 1);
      assert.equal(await verifier.verify('dead'), 'invalid');
      assert.equal(core.calls.length, 1, `a ${status} is not asked again inside a minute`);
      clock.advance(1);
      await verifier.verify('dead');
      assert.equal(core.calls.length, 2, `a ${status} is asked again after a minute`);
    }
  });

  it('answers unavailable for a network failure, a 5xx and a 200 with no account, and never remembers it', async () => {
    const answers: (() => Response)[] = [
      () => {
        throw new TypeError('fetch failed');
      },
      () => new Response('bad gateway', { status: 502 }),
      () => new Response('<html>app shell</html>', { status: 200 }),
      () => Response.json({ account: null }),
    ];
    for (const answer of answers) {
      const core = fakeCore(answer);
      const verifier = createAccountTokenVerifier({ syncServerUrl: CORE, fetchImpl: core.fetchImpl });
      assert.equal(await verifier.verify('tok'), 'unavailable');
      assert.equal(await verifier.verify('tok'), 'unavailable');
      assert.equal(core.calls.length, 2, 'an unavailable answer is asked again on the next request');
    }
  });

  it('keys by token: a live token does not vouch for another one', async () => {
    const core = fakeCore(() => Response.json({ error: 'authentication required' }, { status: 401 }));
    const verifier = createAccountTokenVerifier({ syncServerUrl: CORE, fetchImpl: core.fetchImpl });
    assert.equal(await verifier.verify('other'), 'invalid');
  });

  it('shares one read among concurrent checks of one token', async () => {
    const core = fakeCore(liveAccount);
    const verifier = createAccountTokenVerifier({ syncServerUrl: CORE, fetchImpl: core.fetchImpl });
    // Started together, none awaited: the second and third find the first read in flight.
    const checks = [verifier.verify('tok'), verifier.verify('tok'), verifier.verify('tok')];
    assert.deepEqual(await Promise.all(checks), ['valid', 'valid', 'valid']);
    assert.equal(core.calls.length, 1);
  });

  it('holds at most maxEntries tokens, dropping the oldest first', async () => {
    const core = fakeCore(liveAccount);
    const verifier = createAccountTokenVerifier({ syncServerUrl: CORE, fetchImpl: core.fetchImpl, maxEntries: 2 });
    await verifier.verify('a');
    await verifier.verify('b');
    await verifier.verify('c');
    assert.equal(core.calls.length, 3);
    await verifier.verify('c');
    await verifier.verify('b');
    assert.equal(core.calls.length, 3, 'the two newest are still held');
    await verifier.verify('a');
    assert.equal(core.calls.length, 4, 'the oldest was dropped and is asked again');
  });
});
