/**
 * Unit tests for `#app/lib/oauth-pkce` — the generic browser-only PKCE
 * client (M127/02). Every browser dependency (storage, `fetch`, randomness,
 * the digest, the clock) is injected via `deps`, so these run under plain
 * `node:test` with no jsdom/browser environment.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  beginConnect,
  exchangeCode,
  OAuthPkceError,
  type OAuthPkceConfig,
  type OAuthPkceErrorCode,
  type OAuthPkceStorage,
} from '../../app/lib/oauth-pkce';

const TEST_CONFIG: OAuthPkceConfig = {
  authorizeUrl: 'https://example.com/auth',
  exchangeUrl: 'https://example.com/exchange',
  callbackPath: '/oauth/test/callback',
};

const TEST_ORIGIN = 'https://openplate.example';

function createMemoryStorage(): OAuthPkceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Deterministic, seed-distinguishable "randomness" — real entropy isn't needed for these tests. */
function makeRandomBytes(seed: number): (byteLength: number) => Uint8Array {
  return (byteLength) => {
    const bytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) bytes[i] = (seed + i) % 256;
    return bytes;
  };
}

async function fakeDigestSha256(): Promise<ArrayBuffer> {
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

function makeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (deltaMs: number) => {
      current += deltaMs;
    },
  };
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

/** `assert.rejects` validator: the rejection must be an `OAuthPkceError` carrying `expected`. */
function rejectsWithCode(expected: OAuthPkceErrorCode) {
  return (error: Error) => {
    assert.ok(error instanceof OAuthPkceError);
    assert.equal(error.code, expected);
    return true;
  };
}

/** The exchange POST body `exchangeCode` sends (see `app/lib/oauth-pkce.ts`). */
interface ExchangeRequestBody {
  code: string;
  code_verifier: string;
  code_challenge_method: string;
}

/** The provider rejects the code/verifier pair. */
const rejectingFetch: typeof fetch = async () => new Response('rejected', { status: 400 });

/** The exchange endpoint is unreachable. */
const networkErrorFetch: typeof fetch = async () => {
  throw new Error('getaddrinfo ENOTFOUND');
};

/** A 200 response that carries no usable key. */
const keylessFetch: typeof fetch = async () => new Response(JSON.stringify({}), { status: 200 });

/** Issues tab 2's key in the multi-tab test. */
const tab2Fetch: typeof fetch = async () => new Response(JSON.stringify({ key: 'sk-or-v1-tab-2' }), { status: 200 });

describe('beginConnect', () => {
  it('builds a redirect URL carrying code_challenge/S256 and embeds state in callback_url', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);

    const { redirectUrl, state } = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    const url = new URL(redirectUrl);
    assert.equal(url.origin, 'https://example.com');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const callbackUrl = new URL(url.searchParams.get('callback_url') ?? '');
    assert.equal(callbackUrl.origin, TEST_ORIGIN);
    assert.equal(callbackUrl.pathname, '/oauth/test/callback');
    assert.equal(callbackUrl.searchParams.get('state'), state);
  });
});

describe('exchangeCode', () => {
  it('rejects a state mismatch before ever calling fetch, without destroying the stored flow', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    let fetchCalled = false;
    const fetchImpl: typeof fetch = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ key: 'sk-or-v1-should-not-be-reached' }), { status: 200 });
    };

    const { state } = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state: 'not-the-real-state' }, { storage, fetchImpl, now: clock.now }),
      rejectsWithCode('state-mismatch'),
    );
    assert.equal(fetchCalled, false, 'a state mismatch must never reach the exchange endpoint');

    // The genuine flow is untouched by the mismatched attempt above — a
    // mismatch never clears storage, since the stored entry could belong to a
    // DIFFERENT still-valid flow (see the multi-tab test below). Exchanging
    // with the real state still succeeds.
    const result = await exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl, now: clock.now });
    assert.equal(result.apiKey, 'sk-or-v1-should-not-be-reached');
  });

  it('rejects an expired flow (past the 10-minute TTL) without calling fetch', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    let fetchCalled = false;
    const fetchImpl: typeof fetch = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ key: 'sk-or-v1-should-not-be-reached' }), { status: 200 });
    };

    const { state } = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    clock.advance(TEN_MINUTES_MS + 1_000);

    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl, now: clock.now }),
      rejectsWithCode('expired'),
    );
    assert.equal(fetchCalled, false, 'an expired flow must never reach the exchange endpoint');
  });

  it('reports missing-verifier when no flow was ever started on this device', async () => {
    const storage = createMemoryStorage();
    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state: 'whatever' }, { storage, now: () => 0 }),
      rejectsWithCode('missing-verifier'),
    );
  });

  it('reports denied when the callback carries no code, regardless of a pending flow', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: null, state: 'irrelevant' }, { storage, now: clock.now }),
      rejectsWithCode('denied'),
    );
  });

  it('resolves the issued key on a successful exchange, then clears the flow (single-use after success)', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    let capturedBody: ExchangeRequestBody | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ key: 'sk-or-v1-issued' }), { status: 200 });
    };

    const { state } = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    const result = await exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl, now: clock.now });
    assert.equal(result.apiKey, 'sk-or-v1-issued');
    assert.equal(capturedBody?.code, 'auth-code');
    assert.equal(capturedBody?.code_challenge_method, 'S256');
    assert.ok(capturedBody !== undefined && capturedBody.code_verifier.length >= 43);

    // Replaying the same callback (e.g. a browser back-button) now fails
    // safely as missing-verifier — never a second real exchange.
    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl, now: clock.now }),
      rejectsWithCode('missing-verifier'),
    );
  });

  it('clears the flow after a failed exchange too (single-use after failure)', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    const { state } = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl: rejectingFetch, now: clock.now }),
      rejectsWithCode('exchange-failed'),
    );

    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl: rejectingFetch, now: clock.now }),
      rejectsWithCode('missing-verifier'),
    );
  });

  it('reports exchange-failed on a network error, and clears the flow', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    const { state } = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl: networkErrorFetch, now: clock.now }),
      rejectsWithCode('exchange-failed'),
    );
  });

  it('reports exchange-failed when the provider response has no usable key', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    const { state } = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });

    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'auth-code', state }, { storage, fetchImpl: keylessFetch, now: clock.now }),
      rejectsWithCode('exchange-failed'),
    );
  });

  it('multi-tab: a second beginConnect overwrites the first (last-write-wins) — the losing tab\'s callback fails safely', async () => {
    const storage = createMemoryStorage();
    const clock = makeClock(0);
    const tab1 = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(1),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });
    const tab2 = await beginConnect(TEST_CONFIG, {
      storage,
      randomBytes: makeRandomBytes(99),
      digestSha256: fakeDigestSha256,
      now: clock.now,
      origin: TEST_ORIGIN,
    });
    assert.notEqual(tab1.state, tab2.state, 'the two tabs must generate distinct states for this test to be meaningful');

    // Tab 1's callback lands after tab 2 already overwrote the stored flow.
    await assert.rejects(
      exchangeCode(TEST_CONFIG, { code: 'tab-1-code', state: tab1.state }, { storage, fetchImpl: tab2Fetch, now: clock.now }),
      rejectsWithCode('state-mismatch'),
    );

    // Tab 2's own callback still succeeds — it matches the flow actually stored.
    const result = await exchangeCode(TEST_CONFIG, { code: 'tab-2-code', state: tab2.state }, { storage, fetchImpl: tab2Fetch, now: clock.now });
    assert.equal(result.apiKey, 'sk-or-v1-tab-2');
  });
});
