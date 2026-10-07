/**
 * What one chat body carries in (2026-09-30), as pure functions, and the one
 * unit every request weighs (2026-10-07). The refusal and the reservation through the real handler are in
 * `ai-proxy.test.ts` and `tests/integration/ai-proxy.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_INPUT_POLICY,
  findExceededInputLimit,
  measureChatInput,
  REQUEST_WEIGHT,
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

test("the app's plate scan is inside every bound", () => {
  const size = measureChatInput(appPlateScan());
  assert.equal(size.messages, 2);
  assert.equal(size.imageParts, 1);
  // The image's base64 is NOT text: an image is billed by resolution, and
  // counting its bytes would make every photograph over the bound.
  assert.ok(size.textBytes > 12_000 && size.textBytes < 12_300, `text was ${size.textBytes} bytes`);
  assert.equal(findExceededInputLimit({ size, policy: POLICY }), null);
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

test('every request weighs one unit: one action a person starts is one scan (owner, 2026-10-07)', () => {
  assert.equal(REQUEST_WEIGHT, 1);
  // The size is bounded, not weighed: the policy has no unit any more, only the three bounds.
  assert.deepEqual(Object.keys(POLICY).toSorted(), ['maxImageParts', 'maxMessages', 'maxTextBytes']);
});
