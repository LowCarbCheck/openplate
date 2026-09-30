/**
 * The body policy's edge cases (M256/01), as a pure function. The end-to-end
 * rewrite, through the real app and a real upstream, is
 * `tests/integration/ai-proxy.test.ts`; this file owns the cases a request
 * shape there would only repeat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyChatBodyPolicy,
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  listDroppedChatFields,
} from '../../src/ai/chat-body-policy.js';
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
  // 1536 is the app's Anthropic cap (`apps/app/app/services/vision/anthropic.ts`),
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

// ── the allow list (2026-09-30) ────────────────────────────────────────────

/** A JPEG data URI, the only image the proxy forwards. */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('a top-level field nobody listed is dropped, and the fields the app sends all pass', () => {
  const body = applyChatBodyPolicy({
    body: {
      model: 'm',
      messages: [{ role: 'user', content: 'rice' }],
      response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: {} } },
      reasoning: { effort: 'none' },
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      top_p: 0.9,
      tools: [{ type: 'function', function: { name: 'f', description: 'A'.repeat(1000) } }],
      functions: [{ name: 'f' }],
      logit_bias: { 1: 100 },
      some_new_extension: { prompt: 'a megabyte of text' },
    },
    policy: OPEN,
  });
  // The unknown ones: each of them carries input the provider bills, or a
  // behaviour nobody measured.
  for (const field of ['tools', 'functions', 'logit_bias', 'some_new_extension']) {
    assert.equal(field in body, false, `${field} reached the provider`);
  }
  // THE CONTROL: every field the app sends, and the standard harmless ones,
  // arrive as sent.
  assert.deepEqual(Object.keys(body).toSorted(), [
    'max_tokens',
    'messages',
    'model',
    'reasoning',
    'response_format',
    'stream',
    'stream_options',
    'temperature',
    'top_p',
  ]);
});

test('a message keeps role, content and name; a part is text or an image data URI with its url alone', () => {
  const body = applyChatBodyPolicy({
    body: {
      messages: [
        { role: 'system', content: 'rules', name: 'app' },
        {
          role: 'user',
          tool_calls: [{ id: 't' }],
          content: [
            { type: 'text', text: 'what is this?', cache_control: { type: 'ephemeral' } },
            { type: 'image_url', image_url: { url: JPEG, detail: 'high' } },
            { type: 'image_url', image_url: { url: 'data:application/pdf;base64,JVBERi0=' } },
            { type: 'image_url', image_url: { url: 'https://example.org/plate.jpg' } },
            { type: 'file', file: { file_data: 'data:application/pdf;base64,JVBERi0=' } },
            { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } },
          ],
        },
        'not a message',
      ],
    },
    policy: OPEN,
  });
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'rules', name: 'app' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: JPEG } },
      ],
    },
  ]);
});

test('the dropped fields are listed by NAME, and a name made of a photograph is cut short', () => {
  const photographKey = 'A'.repeat(500);
  const dropped = listDroppedChatFields({
    model: 'm',
    provider: { order: ['x'] },
    tools: [],
    [photographKey]: 1,
    messages: [
      {
        role: 'user',
        tool_call_id: 'x',
        content: [
          { type: 'image_url', image_url: { url: JPEG, detail: 'low' } },
          { type: 'file', file: {} },
        ],
      },
    ],
  });
  assert.deepEqual(dropped, ['tools', 'A'.repeat(64), 'message.tool_call_id', 'image_url.detail', 'part.file']);
  // THE CONTROL: the app's own body drops nothing, so nothing is logged for it.
  assert.deepEqual(
    listDroppedChatFields({
      model: 'm',
      messages: [
        { role: 'system', content: 'rules' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image_url', image_url: { url: JPEG } },
          ],
        },
      ],
      response_format: { type: 'json_schema' },
      reasoning: { effort: 'none' },
    }),
    [],
  );
});
