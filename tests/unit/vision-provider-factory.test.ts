/**
 * Unit tests for `#app/services/vision` (`createVisionProvider`) —
 * specifically that the `openrouter` provider resolves to the
 * openai-compatible adapter with a fixed base URL and OpenRouter
 * attribution headers. `fetch` is stubbed; no real network calls or
 * vendor SDKs are involved.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { createVisionProvider } from '../../app/services/vision/index';
import { PLATE_SCAN_TASK } from '../../app/services/vision/task';

const originalFetch = globalThis.fetch;

function stubFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

/**
 * The outgoing chat-completions body, parsed loosely: only `reasoning` is
 * asserted on, and the unknown keys are kept so "the field is ABSENT" stays a
 * real check rather than an artefact of parsing.
 */
const requestBodySchema = z.looseObject({ reasoning: z.object({ effort: z.string() }).optional() });

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

const VALID_RESPONSE_BODY = JSON.stringify({
  choices: [
    {
      message: {
        content: JSON.stringify({
          foods: [{ name: 'apple', estimatedGrams: 100, confidence: 'high', portionHint: null, macrosPer100g: null }],
          notes: null,
        }),
      },
    },
  ],
});

describe('createVisionProvider — openrouter dispatch', () => {
  it('calls the fixed OpenRouter base URL with bearer auth and attribution headers', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    stubFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(VALID_RESPONSE_BODY, { status: 200 });
    });

    try {
      const provider = createVisionProvider({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        model: 'google/gemini-3.1-flash-lite',
      });
      await provider.runScan({ task: PLATE_SCAN_TASK, image: { base64: 'AAAA', mimeType: 'image/png' } });

      assert.strictEqual(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
      assert.strictEqual(capturedHeaders?.get('authorization'), 'Bearer sk-or-test');
      assert.strictEqual(capturedHeaders?.get('http-referer'), 'https://github.com/openplate/openplate');
      assert.strictEqual(capturedHeaders?.get('x-title'), 'openplate');
    } finally {
      restoreFetch();
    }
  });

  it('ignores a caller-supplied baseUrl for openrouter — the endpoint is fixed', async () => {
    let capturedUrl: string | undefined;
    stubFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(VALID_RESPONSE_BODY, { status: 200 });
    });

    try {
      const provider = createVisionProvider({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        model: 'google/gemini-3.1-flash-lite',
        baseUrl: 'https://attacker.example/v1',
      });
      await provider.runScan({ task: PLATE_SCAN_TASK, image: { base64: 'AAAA', mimeType: 'image/png' } });

      assert.strictEqual(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    } finally {
      restoreFetch();
    }
  });

  it('does not attach OpenRouter attribution headers for plain openai-compatible', async () => {
    let capturedHeaders: Headers | undefined;
    stubFetch(async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(VALID_RESPONSE_BODY, { status: 200 });
    });

    try {
      const provider = createVisionProvider({
        provider: 'openai-compatible',
        apiKey: 'sk-test',
        model: 'gpt-5o',
        baseUrl: 'http://localhost:11434/v1',
      });
      await provider.runScan({ task: PLATE_SCAN_TASK, image: { base64: 'AAAA', mimeType: 'image/png' } });

      assert.strictEqual(capturedHeaders?.get('x-title'), null);
      assert.strictEqual(capturedHeaders?.get('http-referer'), null);
    } finally {
      restoreFetch();
    }
  });

  it('sends reasoning:none for a catalog model flagged with disableReasoning', async () => {
    let capturedBody: z.infer<typeof requestBodySchema> | undefined;
    stubFetch(async (_url, init) => {
      capturedBody = requestBodySchema.parse(JSON.parse(String(init?.body)));
      return new Response(VALID_RESPONSE_BODY, { status: 200 });
    });

    try {
      const provider = createVisionProvider({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        model: 'openai/gpt-5.6-luna',
      });
      await provider.runScan({ task: PLATE_SCAN_TASK, image: { base64: 'AAAA', mimeType: 'image/png' } });

      assert.deepStrictEqual(capturedBody?.reasoning, { effort: 'none' });
    } finally {
      restoreFetch();
    }
  });

  it('sends no reasoning field for a model with no catalog entry', async () => {
    // A user-typed custom model on a self-hosted endpoint: nothing is known
    // about it, so nothing extra is sent — some servers reject unknown fields.
    let capturedBody: z.infer<typeof requestBodySchema> | undefined;
    stubFetch(async (_url, init) => {
      capturedBody = requestBodySchema.parse(JSON.parse(String(init?.body)));
      return new Response(VALID_RESPONSE_BODY, { status: 200 });
    });

    try {
      const provider = createVisionProvider({
        provider: 'openai-compatible',
        apiKey: 'sk-test',
        model: 'llama3',
        baseUrl: 'http://localhost:11434/v1',
      });
      await provider.runScan({ task: PLATE_SCAN_TASK, image: { base64: 'AAAA', mimeType: 'image/png' } });

      assert.ok(capturedBody !== undefined);
      assert.ok(!('reasoning' in capturedBody));
    } finally {
      restoreFetch();
    }
  });

  it('throws (never silently falls back to api.openai.com) when openai-compatible has no base URL — the browser can never reach it directly', () => {
    assert.throws(() => createVisionProvider({ provider: 'openai-compatible', apiKey: 'sk-test', model: 'gpt-5o' }));
  });

  it('throws for a blank (whitespace-only) base URL the same way', () => {
    assert.throws(() =>
      createVisionProvider({ provider: 'openai-compatible', apiKey: 'sk-test', model: 'gpt-5o', baseUrl: '   ' }),
    );
  });
});
