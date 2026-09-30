/**
 * Unit tests for the `/api/food-matches` client caller (M123/06 review fix).
 * Covers the fix itself — a `throttled`/`retryAfterMs` response must surface
 * to the caller, never collapse into a bare (and indistinguishable-from-
 * genuine-empty) match list — plus the existing fail-open contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AccountBearer } from '../../app/lib/account-bearer';
import { fetchFoodMatches } from '../../app/lib/food-matches-client';

const originalFetch = globalThis.fetch;

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  // SAFETY: `typeof fetch` carries extras (e.g. `preconnect`) that nothing under test
  // touches; the code being exercised only ever calls `fetch(input, init)`, which `impl`
  // implements exactly.
  globalThis.fetch = impl as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

describe('fetchFoodMatches', () => {
  it('returns matches with throttled: false on a genuine success response', async () => {
    stubFetch(async () => new Response(JSON.stringify({ matches: [[{ slug: 'chicken-breast' }]] }), { status: 200 }));
    try {
      const result = await fetchFoodMatches(['chicken breast']);
      assert.deepEqual(result.matches, [[{ slug: 'chicken-breast' }]]);
      assert.equal(result.throttled, false);
      assert.equal(result.retryAfterMs, null);
    } finally {
      restoreFetch();
    }
  });

  it('surfaces throttled: true and retryAfterMs from a throttled response — the M123/06 fix', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ matches: [], throttled: true, retryAfterMs: 45_000 }), { status: 200 }),
    );
    try {
      const result = await fetchFoodMatches(['apple']);
      assert.deepEqual(result.matches, []);
      assert.equal(result.throttled, true, 'a throttled response must not be silently dropped');
      assert.equal(result.retryAfterMs, 45_000);
    } finally {
      restoreFetch();
    }
  });

  it('falls back to a null retryAfterMs when the throttled response omits it', async () => {
    stubFetch(async () => new Response(JSON.stringify({ matches: [], throttled: true }), { status: 200 }));
    try {
      const result = await fetchFoodMatches(['apple']);
      assert.equal(result.throttled, true);
      assert.equal(result.retryAfterMs, null);
    } finally {
      restoreFetch();
    }
  });

  it('fails open with throttled: false on a network error', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });
    try {
      const result = await fetchFoodMatches(['apple', 'rice']);
      assert.deepEqual(result.matches, [[], []]);
      assert.equal(result.throttled, false);
      assert.equal(result.retryAfterMs, null);
    } finally {
      restoreFetch();
    }
  });

  it('fails open with throttled: false on a non-OK HTTP status', async () => {
    stubFetch(async () => new Response('server error', { status: 500 }));
    try {
      const result = await fetchFoodMatches(['apple']);
      assert.deepEqual(result.matches, [[]]);
      assert.equal(result.throttled, false);
    } finally {
      restoreFetch();
    }
  });

  it('fails open with throttled: false on a malformed matches field', async () => {
    stubFetch(async () => new Response(JSON.stringify({ matches: 'not an array' }), { status: 200 }));
    try {
      const result = await fetchFoodMatches(['apple']);
      assert.deepEqual(result.matches, [[]]);
      assert.equal(result.throttled, false);
    } finally {
      restoreFetch();
    }
  });

  it('returns an empty result with no request for an empty name list', async () => {
    let called = false;
    stubFetch(async () => {
      called = true;
      return new Response(JSON.stringify({ matches: [] }), { status: 200 });
    });
    try {
      const result = await fetchFoodMatches([]);
      // `foodDb` reports "nothing known" (M238 spec 02), which is what a
      // branch that never asked the server has learned. It is `ok: true`, so
      // the scan review draws no line.
      assert.deepEqual(result, { matches: [], throttled: false, retryAfterMs: null, foodDb: { ok: true, reason: null } });
      assert.equal(called, false);
    } finally {
      restoreFetch();
    }
  });
});

/** A bearer that hands out `token`, and `refreshed` once asked to refresh. */
function fakeBearer({ token, refreshed }: { token: string | null; refreshed: string | null }) {
  let refreshCount = 0;
  const bearer: AccountBearer = {
    getBearer: () => token,
    refreshBearer: async () => {
      refreshCount += 1;
      return refreshed;
    },
  };
  return { bearer, refreshCount: () => refreshCount };
}

/**
 * The account bearer (2026-09-30 security fix): on a managed instance the
 * route refuses a caller with no live account token, so the page sends the
 * session's.
 */
describe('fetchFoodMatches, the account bearer', () => {
  it('sends the session bearer to the route', async () => {
    const sent: (string | null)[] = [];
    stubFetch(async (_input, init) => {
      sent.push(new Headers(init?.headers).get('authorization'));
      return new Response(JSON.stringify({ matches: [[]] }), { status: 200 });
    });
    try {
      await fetchFoodMatches(['egg'], { bearer: fakeBearer({ token: 'tok', refreshed: null }).bearer });
      assert.deepEqual(sent, ['Bearer tok']);
    } finally {
      restoreFetch();
    }
  });

  it('control: sends no Authorization header with no session', async () => {
    const sent: (string | null)[] = [];
    stubFetch(async (_input, init) => {
      sent.push(new Headers(init?.headers).get('authorization'));
      return new Response(JSON.stringify({ matches: [[]] }), { status: 200 });
    });
    try {
      await fetchFoodMatches(['egg'], { bearer: fakeBearer({ token: null, refreshed: null }).bearer });
      assert.deepEqual(sent, [null]);
    } finally {
      restoreFetch();
    }
  });

  it('refreshes once after a 401 and retries with the new token', async () => {
    const sent: (string | null)[] = [];
    stubFetch(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('authorization');
      sent.push(authorization);
      if (authorization === 'Bearer stale') return new Response(null, { status: 401 });
      return new Response(JSON.stringify({ matches: [[{ slug: 'egg' }]] }), { status: 200 });
    });
    const fake = fakeBearer({ token: 'stale', refreshed: 'fresh' });
    try {
      const result = await fetchFoodMatches(['egg'], { bearer: fake.bearer });
      assert.deepEqual(sent, ['Bearer stale', 'Bearer fresh']);
      assert.equal(fake.refreshCount(), 1);
      assert.deepEqual(result.matches, [[{ slug: 'egg' }]]);
    } finally {
      restoreFetch();
    }
  });

  it('fails open with no matches when the refresh cannot help', async () => {
    let requests = 0;
    stubFetch(async () => {
      requests += 1;
      return new Response(null, { status: 401 });
    });
    try {
      const result = await fetchFoodMatches(['egg'], { bearer: fakeBearer({ token: 'dead', refreshed: null }).bearer });
      assert.equal(requests, 1, 'no retry without a new token');
      assert.deepEqual(result.matches, [[]]);
      assert.equal(result.throttled, false);
    } finally {
      restoreFetch();
    }
  });

  it("reads the daily cap's 429 as throttled, never as no matches", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ matches: [], throttled: true, retryAfterMs: 3_600_000 }), { status: 429 }),
    );
    try {
      const result = await fetchFoodMatches(['egg']);
      assert.equal(result.throttled, true);
      assert.equal(result.retryAfterMs, 3_600_000);
    } finally {
      restoreFetch();
    }
  });

  it('reads a 429 with an unreadable body as throttled too', async () => {
    stubFetch(async () => new Response('Too Many Requests', { status: 429 }));
    try {
      const result = await fetchFoodMatches(['egg']);
      assert.equal(result.throttled, true);
      assert.equal(result.retryAfterMs, null);
      assert.deepEqual(result.matches, [[]]);
    } finally {
      restoreFetch();
    }
  });
});
