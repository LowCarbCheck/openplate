/**
 * End-to-end (fetch-stubbed) tests for how the openai-compatible and
 * Anthropic adapters turn a failed HTTP call into a `VisionProviderFailure`,
 * and — for openai-compatible specifically — which statuses trigger the
 * structured-output-rejected retry and which don't. Covers the review
 * findings: every non-2xx used to throw one indistinguishable message, and
 * every 4xx (including auth/credit/rate-limit, which can never succeed by
 * resending) was retried once, doubling cost and photo egress for nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAiCompatibleProvider } from '../../app/services/vision/openai-compatible';
import { createAnthropicProvider } from '../../app/services/vision/anthropic';
import { VisionProviderFailure } from '../../app/services/vision/failure-cause';

const originalFetch = globalThis.fetch;

/** The one request-body field these tests inspect (openai-compatible chat completions). */
type ChatCompletionRequestProbe = { response_format?: { type: string } };

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  // SAFETY: `impl` has the (input, init) => Promise<Response> call signature the adapters use;
  // the only extra member on Node's `fetch` type is `preconnect`, which no adapter calls.
  globalThis.fetch = impl as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

async function expectVisionProviderFailure(promise: Promise<unknown>): Promise<VisionProviderFailure> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof VisionProviderFailure, `expected a VisionProviderFailure, got ${String(error)}`);
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('openai-compatible adapter — retry narrowing', () => {
  it('does NOT retry on 401 — a bad key can never succeed by resending, so exactly one request is sent', async () => {
    let callCount = 0;
    stubFetch(async () => {
      callCount += 1;
      return new Response(null, { status: 401 });
    });

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-bad', model: 'gpt-5o' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(callCount, 1, 'auth failures must not be retried — retrying doubles cost for nothing');
      assert.strictEqual(failure.failureCause, 'auth');
    } finally {
      restoreFetch();
    }
  });

  it('does NOT retry on 402 (out of credit)', async () => {
    let callCount = 0;
    stubFetch(async () => {
      callCount += 1;
      return new Response(null, { status: 402 });
    });

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-test', model: 'gpt-5o' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(callCount, 1);
      assert.strictEqual(failure.failureCause, 'credit');
    } finally {
      restoreFetch();
    }
  });

  it('does NOT retry on 429 (rate limited)', async () => {
    let callCount = 0;
    stubFetch(async () => {
      callCount += 1;
      return new Response(null, { status: 429 });
    });

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-test', model: 'gpt-5o' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(callCount, 1);
      assert.strictEqual(failure.failureCause, 'rate-limit');
    } finally {
      restoreFetch();
    }
  });

  it('DOES retry once on a 400 — the case the retry exists for (a custom server rejecting response_format)', async () => {
    let callCount = 0;
    let sawStructuredOutputOnFirstCall = false;
    stubFetch(async (_url, init) => {
      callCount += 1;
      if (callCount === 1) {
        const body: ChatCompletionRequestProbe = JSON.parse(String(init?.body));
        sawStructuredOutputOnFirstCall = body.response_format !== undefined;
        return new Response(null, { status: 400 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ foods: [], notes: null }) } }] }),
        { status: 200 },
      );
    });

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-test', model: 'llama3' });
      const result = await provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' });
      assert.strictEqual(callCount, 2, 'a 400 should trigger exactly one retry without response_format');
      assert.ok(sawStructuredOutputOnFirstCall, 'the first attempt should still request structured output');
      assert.deepStrictEqual(result.foods, []);
    } finally {
      restoreFetch();
    }
  });

  it('classifies a persistent 400 (after the retry also fails) as invalid-request, not auth/credit/rate-limit/transient', async () => {
    let callCount = 0;
    stubFetch(async () => {
      callCount += 1;
      return new Response(null, { status: 400 });
    });

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-test', model: 'llama3' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(callCount, 2);
      assert.strictEqual(failure.failureCause, 'invalid-request');
    } finally {
      restoreFetch();
    }
  });

  it('classifies a network failure as transient and never bills usage', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-test', model: 'gpt-5o' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(failure.failureCause, 'transient');
      assert.strictEqual(failure.usage, undefined);
    } finally {
      restoreFetch();
    }
  });

  it('classifies an empty (2xx but no content) response as genuinely-no-food', async () => {
    stubFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }));

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-test', model: 'gpt-5o' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(failure.failureCause, 'genuinely-no-food');
    } finally {
      restoreFetch();
    }
  });
});

describe('anthropic adapter — failure classification', () => {
  it('classifies a 401 from the Messages endpoint as auth', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));

    try {
      const provider = createAnthropicProvider({ apiKey: 'sk-ant-bad', model: 'claude-sonnet-5' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(failure.failureCause, 'auth');
    } finally {
      restoreFetch();
    }
  });

  it('classifies a 529 (Anthropic "overloaded") as transient', async () => {
    stubFetch(async () => new Response(null, { status: 529 }));

    try {
      const provider = createAnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5' });
      const failure = await expectVisionProviderFailure(
        provider.identifyPlate({ base64: 'AAAA', mimeType: 'image/png' }),
      );
      assert.strictEqual(failure.failureCause, 'transient');
    } finally {
      restoreFetch();
    }
  });
});
