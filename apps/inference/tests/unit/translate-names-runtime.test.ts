/**
 * The runtime client's translation call, on a real socket.
 *
 * What the front door tests cannot see is the request body itself: that the
 * call is text only, that it goes to the same model at temperature 0, and that
 * its grammar pins the array to exactly as many names as were sent. A grammar
 * with the wrong `minItems`/`maxItems` would still pass every front door test,
 * because the stub runtime there never decodes anything.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createModelRuntime } from '../../src/pipeline/runtime-client.js';
import { MAX_TERSE_ITEMS } from '../../src/pipeline/terse-contract.js';
import { translateMaxTokens, translateSystemPrompt } from '../../src/pipeline/translate-names.js';
import { captureApiError, captureRejection } from '../support/capture-rejection.js';

/** The request body as this test reads it back. Parsed, so a change in the wire fails here. */
const TranslateRequestSchema = z.object({
  model: z.string(),
  temperature: z.number(),
  max_tokens: z.number(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  response_format: z.object({
    type: z.literal('json_schema'),
    json_schema: z.object({
      name: z.string(),
      strict: z.boolean(),
      schema: z.object({
        type: z.literal('array'),
        items: z.object({ type: z.literal('string') }),
        minItems: z.number(),
        maxItems: z.number(),
      }),
    }),
  }),
});

type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

interface ScriptedRuntime {
  baseUrl: string;
  /** Raw request bodies, in order. */
  bodies: string[];
  close(): Promise<void>;
}

/** Answers every completion with `content`, or never answers when `content` is null. */
async function startScriptedRuntime(content: string | null): Promise<ScriptedRuntime> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      bodies.push(body);
      if (content === null) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 12 },
        }),
      );
    });
  });
  server.on('connection', (socket) => socket.unref());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  // SAFETY: `listen` has already fired its callback above and this server is bound
  // to a TCP port, so `address()` is an `AddressInfo`, never `null` or a pipe name.
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    bodies,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

let scripted: ScriptedRuntime | null = null;

afterEach(async () => {
  await scripted?.close();
  scripted = null;
});

function onlyRequest(runtime: ScriptedRuntime): TranslateRequest {
  expect(runtime.bodies).toHaveLength(1);
  return TranslateRequestSchema.parse(JSON.parse(runtime.bodies[0]));
}

describe('ModelRuntime.translateNames', () => {
  it('sends a text-only call to the same model, at temperature 0, with the length pinned by the grammar', async () => {
    scripted = await startScriptedRuntime(JSON.stringify(['Gegrillte Hähnchenbrust', 'Weißer Reis', 'Salat']));
    const client = createModelRuntime({ baseUrl: scripted.baseUrl, modelId: 'test-model' });

    const translated = await client.translateNames(['grilled chicken breast', 'white rice', 'salad'], 'de');

    expect(translated).toEqual(['Gegrillte Hähnchenbrust', 'Weißer Reis', 'Salat']);
    const sent = onlyRequest(scripted);
    expect(sent.model).toBe('test-model');
    expect(sent.temperature).toBe(0);
    expect(sent.response_format.json_schema.schema.minItems).toBe(3);
    expect(sent.response_format.json_schema.schema.maxItems).toBe(3);
    expect(sent.max_tokens).toBe(translateMaxTokens(3));
    // Text only: both messages are plain strings, no content parts, no image.
    expect(sent.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(sent.messages[0].content).toBe(translateSystemPrompt('de'));
    expect(sent.messages[0].content).toContain('German');
    expect(JSON.parse(sent.messages[1].content)).toEqual(['grilled chicken breast', 'white rice', 'salad']);
    expect(scripted.bodies[0]).not.toContain('image_url');
  });

  it('CONTROL: names the requested language, not a fixed one', async () => {
    scripted = await startScriptedRuntime(JSON.stringify(['Izgara tavuk']));
    const client = createModelRuntime({ baseUrl: scripted.baseUrl, modelId: 'test-model' });

    await client.translateNames(['grilled chicken'], 'tr');

    const sent = onlyRequest(scripted);
    expect(sent.messages[0].content).toContain('Turkish');
    expect(sent.messages[0].content).not.toContain('German');
    expect(sent.response_format.json_schema.schema.maxItems).toBe(1);
  });

  it('sizes max_tokens with headroom for a full plate', () => {
    expect(translateMaxTokens(1)).toBe(96);
    expect(translateMaxTokens(MAX_TERSE_ITEMS)).toBe(MAX_TERSE_ITEMS * 32 + 64);
  });

  it('rejects an answer that is not an array of strings, and does not quote it', async () => {
    scripted = await startScriptedRuntime(JSON.stringify({ f: [{ n: 'Hähnchen', g: 1 }] }));
    const client = createModelRuntime({ baseUrl: scripted.baseUrl, modelId: 'test-model' });

    const error = await captureApiError(client.translateNames(['grilled chicken'], 'de'));

    expect(error.status).toBe(502);
    expect(error.message).toMatch(/not a JSON array of strings/);
    expect(error.message).not.toContain('Hähnchen');
    expect(error.cause).toBeUndefined();
  });

  it('rejects an empty completion like identify does', async () => {
    scripted = await startScriptedRuntime('');
    const client = createModelRuntime({ baseUrl: scripted.baseUrl, modelId: 'test-model' });

    const error = await captureApiError(client.translateNames(['grilled chicken'], 'de'));

    expect(error.message).toMatch(/empty completion/);
  });

  it('stops waiting when the caller aborts', async () => {
    scripted = await startScriptedRuntime(null);
    const client = createModelRuntime({ baseUrl: scripted.baseUrl, modelId: 'test-model' });

    const startedAt = performance.now();
    await captureRejection(client.translateNames(['grilled chicken'], 'de', { signal: AbortSignal.timeout(100) }));

    expect(performance.now() - startedAt).toBeLessThan(5000);
  });
});
