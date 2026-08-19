/**
 * Unit tests for `#app/services/vision/failure-cause` — the typed
 * classification that replaced the single generic
 * "Vision provider returned an error (status N)" message every non-2xx used
 * to throw (auth/credit/rate-limit/transient/5xx were all indistinguishable
 * from each other and from a genuinely bad photo).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyVisionHttpFailure, VisionProviderFailure } from '../../app/services/vision/failure-cause';
import { VisionProviderError } from '../../app/services/vision/types';

/** The provider error envelope `classifyVisionHttpFailure` reads. */
type ProviderErrorBody = { error: { type?: string; code?: string; message?: string } };

function jsonResponse(status: number, body?: ProviderErrorBody): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('classifyVisionHttpFailure', () => {
  it('classifies 401 as auth', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(401));
    assert.strictEqual(result.cause, 'auth');
    assert.match(result.message, /key/i);
  });

  it('classifies 403 as auth', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(403));
    assert.strictEqual(result.cause, 'auth');
  });

  it('classifies 402 as credit', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(402));
    assert.strictEqual(result.cause, 'credit');
    assert.match(result.message, /credit/i);
  });

  it('classifies a plain 429 (no quota/billing code) as rate-limit', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(429, { error: { type: 'rate_limit_error' } }));
    assert.strictEqual(result.cause, 'rate-limit');
  });

  it('classifies a 429 with a known quota/billing error code as credit, not rate-limit', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(429, { error: { code: 'insufficient_quota' } }));
    assert.strictEqual(result.cause, 'credit');
  });

  it('classifies a 429 with no parseable body as rate-limit (the safe default)', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(429));
    assert.strictEqual(result.cause, 'rate-limit');
  });

  it('never echoes the response body\'s free-text message into the thrown message (key material could be embedded there)', async () => {
    const result = await classifyVisionHttpFailure(
      jsonResponse(401, { error: { message: 'Incorrect API key provided: sk-secret-fragment-1234' } }),
    );
    assert.ok(!result.message.includes('sk-secret-fragment-1234'));
  });

  it('classifies 500 as transient', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(500));
    assert.strictEqual(result.cause, 'transient');
  });

  it('classifies 529 (Anthropic "overloaded") as transient', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(529));
    assert.strictEqual(result.cause, 'transient');
  });

  it('classifies 404 as model-not-found, with an actionable "pick a different model" message (not "try again")', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(404));
    assert.strictEqual(result.cause, 'model-not-found');
    assert.match(result.message, /different model/i);
  });

  // 400/413/422 (and any other unmatched 4xx) can never succeed by resending
  // the identical request — they must NOT fall into `transient`, whose own
  // doc promises "can succeed if retried later" (the reported bug: retry
  // logic keyed on `transient` would burn real money re-uploading the photo
  // forever for a request that can never succeed).
  for (const status of [400, 413, 422]) {
    it(`classifies ${status} as invalid-request, not transient, with the status in the message`, async () => {
      const result = await classifyVisionHttpFailure(jsonResponse(status));
      assert.strictEqual(result.cause, 'invalid-request');
      assert.match(result.message, new RegExp(String(status)));
    });
  }

  it('classifies an unmatched 4xx (e.g. 406) as invalid-request too', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(406));
    assert.strictEqual(result.cause, 'invalid-request');
  });
});

describe('VisionProviderFailure', () => {
  it('is a VisionProviderError — existing `instanceof VisionProviderError` checks keep working', () => {
    const failure = new VisionProviderFailure('auth', 'bad key');
    assert.ok(failure instanceof VisionProviderError);
    assert.strictEqual(failure.failureCause, 'auth');
    assert.strictEqual(failure.message, 'bad key');
  });

  it('carries usage through to the base VisionProviderError shape', () => {
    const failure = new VisionProviderFailure('genuinely-no-food', 'empty response', {
      usage: { inputTokens: 10, outputTokens: 0 },
    });
    assert.deepStrictEqual(failure.usage, { inputTokens: 10, outputTokens: 0 });
  });
});
