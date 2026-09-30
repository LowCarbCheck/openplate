/**
 * What one chat body carries in and what it weighs (2026-09-30), as pure
 * functions. The refusal and the reservation through the real handler are in
 * `ai-proxy.test.ts` and `tests/integration/ai-proxy.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_INPUT_POLICY,
  estimateInputTokens,
  findExceededInputLimit,
  measureChatInput,
  requestWeight,
} from '../../src/ai/chat-input-bounds.js';
import type { JsonObject } from '../../src/lib/json.js';

const POLICY = DEFAULT_CHAT_INPUT_POLICY;

/**
 * The app's largest real request, by size: the plate scan measured on
 * 2026-09-30 carries 9,382 bytes of message text, a 2,764 byte
 * `response_format`, two messages and one image.
 */
function appPlateScan(input: { images: number } = { images: 1 }): JsonObject {
  const image = { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${'A'.repeat(600_000)}` } };
  return {
    model: 'm',
    messages: [
      { role: 'system', content: 's'.repeat(9_000) },
      {
        role: 'user',
        content: [{ type: 'text', text: 'u'.repeat(382) }, ...Array.from({ length: input.images }, () => image)],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'plate', schema: { description: 'd'.repeat(2_700) } },
    },
  };
}

test("the app's plate scan is inside every bound and weighs one unit", () => {
  const size = measureChatInput(appPlateScan());
  assert.equal(size.messages, 2);
  assert.equal(size.imageParts, 1);
  // The image's base64 is NOT text: an image is billed by resolution, and
  // counting its bytes would make every photograph over the bound.
  assert.ok(size.textBytes > 12_000 && size.textBytes < 12_300, `text was ${size.textBytes} bytes`);
  assert.equal(findExceededInputLimit({ size, policy: POLICY }), null);
  assert.ok(estimateInputTokens({ size, policy: POLICY }) < POLICY.unitInputTokens);
  assert.equal(requestWeight({ size, policy: POLICY }), 1);
});

test('a second image, a text over 48 KB and a fifth message are each named', () => {
  const twoImages = appPlateScan({ images: 2 });
  assert.deepEqual(findExceededInputLimit({ size: measureChatInput(twoImages), policy: POLICY }), {
    limit: 'image-parts',
    max: 1,
  });

  const longText = { messages: [{ role: 'user', content: 'x'.repeat(48 * 1024 + 1) }] };
  assert.deepEqual(findExceededInputLimit({ size: measureChatInput(longText), policy: POLICY }), {
    limit: 'text-bytes',
    max: 48 * 1024,
  });
  // THE CONTROL for the comparison: exactly at the bound is allowed.
  const atBound = { messages: [{ role: 'user', content: 'x'.repeat(48 * 1024) }] };
  assert.equal(findExceededInputLimit({ size: measureChatInput(atBound), policy: POLICY }), null);

  const fiveMessages = { messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'hi' })) };
  assert.deepEqual(findExceededInputLimit({ size: measureChatInput(fiveMessages), policy: POLICY }), {
    limit: 'messages',
    max: 4,
  });
});

test('text is counted in UTF-8 bytes, across names, parts and the response_format schema', () => {
  const size = measureChatInput({
    messages: [
      { role: 'user', name: 'ab', content: [{ type: 'text', text: 'äö' }] },
      { role: 'system', content: 'xyz' },
    ],
    response_format: { a: 1 },
  });
  // 'ab' 2 + 'äö' 4 + 'xyz' 3 + '{"a":1}' 7.
  assert.equal(size.textBytes, 16);
  // A schema is input the model reads: without it, 1 MB rides past the bound.
  const schemaOnly = measureChatInput({ messages: [], response_format: { description: 'x'.repeat(60_000) } });
  assert.equal(findExceededInputLimit({ size: schemaOnly, policy: POLICY })?.limit, 'text-bytes');
});

test('the weight grows with the input, and is never below one', () => {
  assert.equal(requestWeight({ size: { imageParts: 0, textBytes: 0, messages: 0 }, policy: POLICY }), 1);
  // 40 KB of text is about 10,000 tokens: two units of 8,192.
  assert.equal(requestWeight({ size: { imageParts: 0, textBytes: 40_000, messages: 2 }, policy: POLICY }), 2);
  // The operator's own numbers decide it: a smaller unit makes the same request heavier.
  assert.equal(
    requestWeight({
      size: { imageParts: 1, textBytes: 4_000, messages: 2 },
      policy: { ...POLICY, unitInputTokens: 1_000, imageInputTokens: 1_500 },
    }),
    3,
  );
});
