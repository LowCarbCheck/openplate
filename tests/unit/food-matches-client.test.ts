/**
 * Unit tests for the `/api/food-matches` client caller (M123/06 review fix).
 * Covers the fix itself — a `throttled`/`retryAfterMs` response must surface
 * to the caller, never collapse into a bare (and indistinguishable-from-
 * genuine-empty) match list — plus the existing fail-open contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
      assert.deepEqual(result, { matches: [], throttled: false, retryAfterMs: null });
      assert.equal(called, false);
    } finally {
      restoreFetch();
    }
  });
});
