/**
 * Unit tests for `#app/services/vision/verify-key` — the live BYOK key
 * check performed before persisting AI settings (`app/routes/settings.ai.tsx`).
 * `fetch` is stubbed throughout; no real network calls are made.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { verifyProviderKey } from '../../app/services/vision/verify-key';

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

describe('verifyProviderKey', () => {
  it('resolves to "ok" when the provider responds 200', async () => {
    stubFetch(async () => new Response(null, { status: 200 }));
    try {
      const result = await verifyProviderKey({ provider: 'openrouter', apiKey: 'sk-test' });
      assert.deepStrictEqual(result, { status: 'ok' });
    } finally {
      restoreFetch();
    }
  });

  it('resolves to "rejected" when the provider responds 401', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    try {
      const result = await verifyProviderKey({ provider: 'openrouter', apiKey: 'sk-bad' });
      assert.deepStrictEqual(result, { status: 'rejected' });
    } finally {
      restoreFetch();
    }
  });

  it('resolves to "rejected" when the provider responds 403', async () => {
    stubFetch(async () => new Response(null, { status: 403 }));
    try {
      const result = await verifyProviderKey({ provider: 'anthropic', apiKey: 'sk-bad' });
      assert.deepStrictEqual(result, { status: 'rejected' });
    } finally {
      restoreFetch();
    }
  });

  it('resolves to "unverified" when fetch throws (network failure) — distinct from a missing-base-URL config problem', async () => {
    stubFetch(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    try {
      const result = await verifyProviderKey({
        provider: 'openai-compatible',
        apiKey: 'sk-test',
        baseUrl: 'http://localhost:11434/v1',
      });
      assert.deepStrictEqual(result, { status: 'unverified' });
    } finally {
      restoreFetch();
    }
  });

  it('hits OpenRouter\'s key-introspection endpoint (not /models, which never rejects a key) with a bearer header and attribution headers', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    stubFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    });

    try {
      await verifyProviderKey({ provider: 'openrouter', apiKey: 'sk-or-test' });
      assert.strictEqual(capturedUrl, 'https://openrouter.ai/api/v1/auth/key');
      assert.strictEqual(capturedHeaders?.get('authorization'), 'Bearer sk-or-test');
      assert.strictEqual(capturedHeaders?.get('x-title'), 'openplate');
      assert.strictEqual(capturedHeaders?.get('http-referer'), 'https://github.com/openplate/openplate');
    } finally {
      restoreFetch();
    }
  });

  it('hits the Anthropic models endpoint with x-api-key and anthropic-version headers', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    stubFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    });

    try {
      await verifyProviderKey({ provider: 'anthropic', apiKey: 'sk-ant-test' });
      assert.strictEqual(capturedUrl, 'https://api.anthropic.com/v1/models');
      assert.strictEqual(capturedHeaders?.get('x-api-key'), 'sk-ant-test');
      assert.ok(capturedHeaders?.get('anthropic-version'));
    } finally {
      restoreFetch();
    }
  });

  it('uses the caller-supplied base URL for openai-compatible providers', async () => {
    let capturedUrl: string | undefined;
    stubFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(null, { status: 200 });
    });

    try {
      await verifyProviderKey({
        provider: 'openai-compatible',
        apiKey: 'sk-local',
        baseUrl: 'http://localhost:11434/v1/',
      });
      assert.strictEqual(capturedUrl, 'http://localhost:11434/v1/models');
    } finally {
      restoreFetch();
    }
  });

  it('rejects as "rejected" (not a silent api.openai.com fallback) when no base URL is supplied — the browser can never reach api.openai.com directly (CSP/CORS)', async () => {
    let fetchCalled = false;
    stubFetch(async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    });

    try {
      const result = await verifyProviderKey({ provider: 'openai-compatible', apiKey: 'sk-test' });
      assert.strictEqual(result.status, 'rejected');
      assert.strictEqual(fetchCalled, false, 'a missing base URL must never reach fetch');
    } finally {
      restoreFetch();
    }
  });

  it('rejects a blank (whitespace-only) base URL the same way', async () => {
    let fetchCalled = false;
    stubFetch(async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    });

    try {
      const result = await verifyProviderKey({ provider: 'openai-compatible', apiKey: 'sk-test', baseUrl: '   ' });
      assert.strictEqual(result.status, 'rejected');
      assert.strictEqual(fetchCalled, false);
    } finally {
      restoreFetch();
    }
  });
});
