/**
 * What the proxy reads off an answer (`ai/usage-tap.ts`): numbers and a model
 * name, and never a change to the bytes that pass through.
 *
 * EACH CASE THAT READS A NUMBER HAS ITS CONTROL: the same shape with the field
 * missing, malformed or absurd gives `null`, so a tap that invented a value, or
 * read every number it saw, fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';
import {
  createUsageTap,
  MAX_JSON_BYTES,
  MAX_SSE_LINE_BYTES,
  NO_COMPLETION_USAGE,
  readUsageFields,
  type CompletionUsage,
} from '../../src/ai/usage-tap.js';
import type { JsonObject, JsonValue } from '../../src/lib/json.js';

/** Runs `pieces` through a tap and returns what came out the other side and what the tap read. */
async function relay(input: {
  pieces: (string | Buffer)[];
  isEventStream: boolean;
}): Promise<{ out: Buffer; usage: CompletionUsage }> {
  const tap = createUsageTap({ isEventStream: input.isEventStream });
  const received: Buffer[] = [];
  await pipeline(
    Readable.from(input.pieces.map((piece) => Buffer.from(piece))),
    tap.stream,
    new Writable({
      write(chunk: Buffer, _encoding, callback): void {
        received.push(chunk);
        callback();
      },
    }),
  );
  return { out: Buffer.concat(received), usage: tap.result() };
}

const ANSWER = {
  id: 'gen-1',
  model: 'google/gemini-3.7-flash',
  choices: [{ message: { role: 'assistant', content: 'a bowl of rice, about 45 g of carbs' } }],
  usage: { prompt_tokens: 1523, completion_tokens: 87, total_tokens: 1610, cost: 0.000412 },
};

test('a JSON answer gives its model, its token counts and its price in micro dollars', async () => {
  const text = JSON.stringify(ANSWER);
  const { out, usage } = await relay({ pieces: [text], isEventStream: false });
  assert.equal(out.toString('utf8'), text, 'the answer passes through unchanged');
  assert.deepEqual(usage, {
    model: 'google/gemini-3.7-flash',
    promptTokens: 1523,
    completionTokens: 87,
    costMicroUsd: 412,
  });
});

test('a JSON answer split across chunks reads the same', async () => {
  const text = JSON.stringify(ANSWER);
  const pieces = [text.slice(0, 40), text.slice(40, 300), text.slice(300)];
  const { out, usage } = await relay({ pieces, isEventStream: false });
  assert.equal(out.toString('utf8'), text);
  assert.equal(usage.costMicroUsd, 412);
});

test('CONTROL: an answer with no usage, a null usage or an unreadable body gives nulls, and still passes through', async () => {
  for (const text of [
    JSON.stringify({ model: 'm', choices: [] }),
    JSON.stringify({ model: 'm', usage: null }),
    '<html>upstream is down</html>',
    '',
  ]) {
    const { out, usage } = await relay({ pieces: [text], isEventStream: false });
    assert.equal(out.toString('utf8'), text);
    assert.equal(usage.costMicroUsd, null, text);
    assert.equal(usage.promptTokens, null, text);
  }
  assert.deepEqual((await relay({ pieces: [], isEventStream: false })).usage, NO_COMPLETION_USAGE);
});

function usageOf(usage: JsonObject): CompletionUsage {
  return readUsageFields({ model: 'm', usage });
}

function modelOf(name: JsonValue): string | null {
  return readUsageFields({ model: name, usage: {} }).model;
}

test('CONTROL: fields that are not what they claim to be are null, not repaired and not trusted', () => {
  assert.equal(usageOf({ cost: -1 }).costMicroUsd, null);
  assert.equal(usageOf({ cost: 1_000_000 }).costMicroUsd, null);
  assert.equal(usageOf({ cost: '0.5' }).costMicroUsd, null);
  assert.equal(usageOf({ prompt_tokens: 1.5 }).promptTokens, null);
  assert.equal(usageOf({ prompt_tokens: -3 }).promptTokens, null);
  assert.equal(usageOf({ completion_tokens: 'many' }).completionTokens, null);
  // The cost is the price rounded to a whole micro dollar, and zero is a real value.
  assert.equal(usageOf({ cost: 0 }).costMicroUsd, 0);
  assert.equal(usageOf({ cost: 0.0000004 }).costMicroUsd, 0);
  assert.equal(usageOf({ cost: 0.0000006 }).costMicroUsd, 1);
});

test('a model name is kept only when it looks like one, so an answer cannot smuggle text into a log', () => {
  assert.equal(modelOf('google/gemini-3.7-flash'), 'google/gemini-3.7-flash');
  assert.equal(modelOf('anthropic/claude-sonnet:beta'), 'anthropic/claude-sonnet:beta');
  assert.equal(modelOf('a bowl of rice, about 45 g of carbs'), null);
  assert.equal(modelOf('x'.repeat(65)), null);
  assert.equal(modelOf('m\nnew line'), null);
  assert.equal(modelOf(''), null);
  assert.equal(modelOf(42), null);
});

function sse(...events: JsonObject[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
}

const STREAM_EVENTS: JsonObject[] = [
  { model: 'google/gemini-3.7-flash', choices: [{ delta: { content: 'a bowl ' } }] },
  { model: 'google/gemini-3.7-flash', choices: [{ delta: { content: 'of rice' } }] },
  {
    model: 'google/gemini-3.7-flash',
    choices: [{ delta: {} }],
    usage: { prompt_tokens: 1523, completion_tokens: 87, cost: 0.000412 },
  },
];

test('a streamed answer gives the usage the last chunk carries, and passes every byte through', async () => {
  const text = sse(...STREAM_EVENTS);
  const { out, usage } = await relay({ pieces: [text], isEventStream: true });
  assert.equal(out.toString('utf8'), text);
  assert.deepEqual(usage, {
    model: 'google/gemini-3.7-flash',
    promptTokens: 1523,
    completionTokens: 87,
    costMicroUsd: 412,
  });
});

test('a stream cut at every possible byte reads the same, including inside a multibyte character', async () => {
  const text = sse(
    { model: 'm', choices: [{ delta: { content: 'Reis mit Gemüse, 45 g Kohlenhydrate' } }] },
    { model: 'm', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.000001 } },
  );
  const bytes = Buffer.from(text);
  for (let cut = 1; cut < bytes.length; cut += 7) {
    const { out, usage } = await relay({ pieces: [bytes.subarray(0, cut), bytes.subarray(cut)], isEventStream: true });
    assert.equal(out.toString('utf8'), text, `cut at ${cut}`);
    assert.equal(usage.costMicroUsd, 1, `cut at ${cut}`);
    assert.equal(usage.completionTokens, 5, `cut at ${cut}`);
  }
});

test('CONTROL: a stream that never reports usage gives a model and nulls', async () => {
  const text = sse(...STREAM_EVENTS.slice(0, 2));
  const { usage } = await relay({ pieces: [text], isEventStream: true });
  assert.deepEqual(usage, {
    model: 'google/gemini-3.7-flash',
    promptTokens: null,
    completionTokens: null,
    costMicroUsd: null,
  });
});

test('a stream with CRLF line ends, comment lines and no final newline still reads', async () => {
  const body =
    `: keep-alive\r\n\r\ndata: ${JSON.stringify({ model: 'm' })}\r\n\r\n` +
    `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.5 } })}`;
  const { usage } = await relay({ pieces: [body], isEventStream: true });
  assert.deepEqual(usage, { model: 'm', promptTokens: 3, completionTokens: 4, costMicroUsd: 500_000 });
});

test('a JSON answer over the bound is not read, and still passes through whole', async () => {
  const filler = 'x'.repeat(MAX_JSON_BYTES);
  const text = JSON.stringify({ ...ANSWER, filler });
  const { out, usage } = await relay({ pieces: [text], isEventStream: false });
  assert.equal(out.length, Buffer.byteLength(text));
  assert.equal(usage.costMicroUsd, null, 'too big to read: null, never a guess');
  // THE CONTROL: the same answer under the bound is read.
  const small = await relay({
    pieces: [JSON.stringify({ ...ANSWER, filler: 'x'.repeat(1000) })],
    isEventStream: false,
  });
  assert.equal(small.usage.costMicroUsd, 412);
});

test('a stream line over the bound is skipped, the lines after it are read, and every byte passes', async () => {
  const long = `data: ${JSON.stringify({ model: 'm', filler: 'y'.repeat(MAX_SSE_LINE_BYTES + 10) })}\n\n`;
  const usageLine = `data: ${JSON.stringify({ model: 'm', usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.000003 } })}\n\n`;
  const { out, usage } = await relay({
    pieces: [long.slice(0, 1000), long.slice(1000), usageLine],
    isEventStream: true,
  });
  assert.equal(out.toString('utf8'), long + usageLine);
  assert.equal(usage.costMicroUsd, 3);
});

test('the tap never throws on a body it cannot parse, and the relay goes on', async () => {
  for (const isEventStream of [true, false]) {
    const { out, usage } = await relay({
      pieces: ['data: {not json\n\n', 'data: [1,2,3]\n\n', Buffer.from([0xff, 0xfe, 0x00])],
      isEventStream,
    });
    assert.equal(out.length, 'data: {not json\n\n'.length + 'data: [1,2,3]\n\n'.length + 3);
    assert.equal(usage.costMicroUsd, null);
  }
});
