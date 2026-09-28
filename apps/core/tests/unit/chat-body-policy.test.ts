/**
 * The body policy's edge cases (M256/01), as a pure function. The end-to-end
 * rewrite, through the real app and a real upstream, is
 * `tests/integration/ai-proxy.test.ts`; this file owns the cases a request
 * shape there would only repeat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChatBodyPolicy, DEFAULT_AI_MAX_OUTPUT_TOKENS } from '../../src/ai/chat-body-policy.js';
import type { JsonObject } from '../../src/lib/json.js';

const OPEN = { model: null, maxOutputTokens: 1_000 };

test('a null max_tokens means "no limit" and becomes the ceiling', () => {
  const body = applyChatBodyPolicy({ body: { model: 'm', max_tokens: null }, policy: OPEN });
  assert.equal(body.max_tokens, 1_000);
});

test('a max_tokens that is not a number becomes the ceiling, and one at the ceiling stays', () => {
  assert.equal(applyChatBodyPolicy({ body: { max_tokens: '99999' }, policy: OPEN }).max_tokens, 1_000);
  // THE CONTROL for the comparison: the boundary value is the caller's.
  assert.equal(applyChatBodyPolicy({ body: { max_tokens: 1_000 }, policy: OPEN }).max_tokens, 1_000);
  assert.equal(applyChatBodyPolicy({ body: { max_tokens: 999 }, policy: OPEN }).max_tokens, 999);
});

test('a body naming only max_completion_tokens is capped there and gets no second field', () => {
  // An OpenAI reasoning model refuses `max_tokens` beside it, so writing the
  // other field in would break a self-hosted instance that forwards to one.
  const body = applyChatBodyPolicy({ body: { max_completion_tokens: 50_000 }, policy: OPEN });
  assert.equal(body.max_completion_tokens, 1_000);
  assert.equal('max_tokens' in body, false);
});

test('a reasoning block without a count keeps its effort and gets no count', () => {
  const body = applyChatBodyPolicy({ body: { reasoning: { effort: 'high' } }, policy: OPEN });
  assert.deepEqual(body.reasoning, { effort: 'high' });
});

test("the caller's body is not changed, so the proxy's log fields read what was asked", () => {
  const sent: JsonObject = { model: 'caller', n: 3, plugins: [{ id: 'web' }] };
  applyChatBodyPolicy({ body: sent, policy: { model: 'instance', maxOutputTokens: 1_000 } });
  assert.deepEqual(sent, { model: 'caller', n: 3, plugins: [{ id: 'web' }] });
});

test('the default ceiling sits clearly above the largest cap the app sends anywhere', () => {
  // 1536 is the app's Anthropic cap (`openplate/app/services/vision/anthropic.ts`),
  // the largest it sends; the managed path sends none.
  assert.ok(DEFAULT_AI_MAX_OUTPUT_TOKENS >= 4 * 1536);
});

test('on OpenRouter the body asks for endpoints that do not keep or train on it, whatever the caller sent', () => {
  const body = applyChatBodyPolicy({
    body: { model: 'm', provider: { data_collection: 'allow', order: ['Cheap'] } },
    policy: OPEN,
    upstreamBaseUrl: 'https://openrouter.ai/api/v1',
  });
  assert.deepEqual(body.provider, { data_collection: 'deny' });
});

test('any other upstream gets no provider field, because it is an OpenRouter extension', () => {
  // THE CONTROL for the host check: without it the test above would pass against a policy that
  // wrote the preference into every body.
  for (const upstreamBaseUrl of [
    'https://api.openai.com/v1',
    'http://inference:8300/v1',
    'https://openrouter.ai.example.com/v1',
  ]) {
    const body = applyChatBodyPolicy({
      body: { model: 'm', provider: { order: ['x'] } },
      policy: OPEN,
      upstreamBaseUrl,
    });
    assert.equal('provider' in body, false, upstreamBaseUrl);
  }
  assert.equal('provider' in applyChatBodyPolicy({ body: { model: 'm' }, policy: OPEN }), false);
});
