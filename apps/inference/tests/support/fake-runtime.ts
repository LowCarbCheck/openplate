/**
 * An in-process fake model runtime: a real express app on an ephemeral port that
 * speaks the same OpenAI-compatible dialect llama-server does.
 *
 * WHY A REAL SERVER RATHER THAN A MOCKED `fetch`. The client under test
 * (`src/pipeline/runtime-client.ts`) is mostly about wire details — the
 * `response_format` it sends, the `finish_reason: length` truncation trap, an
 * empty `content`, a non-2xx body it must NOT forward. Stubbing `fetch` would
 * assert that we called a mock the way we think we call it; a socket asserts what
 * actually goes over one. (Same precedent as openplate-sync's service harness.)
 *
 * It records what it RECEIVED, minus the payload: the recorded request carries
 * the model id, whether a `response_format` was attached, the token cap, the
 * message shape and the `Authorization` header it was sent — never the image. A
 * test fixture that logged the base64 would undercut the privacy tests two
 * directories over.
 *
 * The readiness endpoints are configurable per test because the three runtimes
 * this service must survive disagree about them: llama.cpp answers `/health` 503
 * while loading, Ollama has no `/health` at all, and an authed vLLM answers
 * `/v1/models` 401. `probes` records every readiness call, so a test can assert
 * that a request was NOT made (the 503 no-fallback rule) as easily as that it was.
 */
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

export type FakeScenario =
  /** A well-formed terse candidate. */
  | { kind: 'ok'; items: Array<{ n: string; g: number }> }
  /** Arbitrary content, e.g. malformed JSON, a fenced body, or a truncated object. */
  | { kind: 'raw'; content: string; finishReason?: string }
  /** 200 with an empty completion — llama.cpp does this when a reasoning budget swallows the answer. */
  | { kind: 'empty' }
  /** A non-2xx from the runtime, optionally with a body that echoes the request back. */
  | { kind: 'status'; status: number; body?: unknown };

export interface RecordedRuntimeRequest {
  model: string;
  hasResponseFormat: boolean;
  responseFormatType: string | null;
  maxTokens: number | null;
  temperature: number | null;
  messageRoles: string[];
  /** Content-part types of the user turn, in order — proves image-first ordering. */
  userPartTypes: string[];
  /** Byte length of the data URI we were sent. A COUNT, never the bytes. */
  imageDataUriLength: number;
  /** The raw `Authorization` header, or `null` when none was sent. */
  authorization: string | null;
}

export interface RecordedProbe {
  /** `/health` or `/v1/models`. */
  path: string;
  authorization: string | null;
}

export interface FakeRuntime {
  baseUrl: string;
  requests: RecordedRuntimeRequest[];
  /** Every `/health` and `/v1/models` call, in order. */
  probes: RecordedProbe[];
  setScenario(scenario: FakeScenario): void;
  setReady(ready: boolean): void;
  /**
   * Status for `/health`. `'absent'` makes the route 404, which is what an
   * Ollama-class runtime does — it has no `/health` at all.
   */
  setHealthStatus(status: number | 'absent'): void;
  /** Status for `GET /v1/models`. 401 is the authed-vLLM case. */
  setModelsStatus(status: number): void;
  /**
   * Makes every completion block until `release()` is called, so a test can hold
   * the worker pool full without sleeping. `waitForInFlight` resolves once at
   * least `count` requests are parked inside the runtime.
   */
  block(): { release: () => void; waitForInFlight: (count: number) => Promise<void> };
  close(): Promise<void>;
}

function terseContent(items: Array<{ n: string; g: number }>): string {
  return JSON.stringify({ f: items });
}

function authorizationOf(req: express.Request): string | null {
  return req.get('authorization') ?? null;
}

/**
 * The completion request as this fake reads it. Every field is `.catch()`-guarded
 * because half the point of the fixture is to keep answering when the client
 * sends something unexpected — a parse failure here must degrade to a recorded
 * default, never to a 500 that hides the assertion under test.
 */
const RuntimeContentPartSchema = z.object({
  type: z.string().catch('undefined'),
  image_url: z.object({ url: z.string().catch('') }).nullable().catch(null),
});

const RuntimeMessageSchema = z.object({
  role: z.string().catch('undefined'),
  /** Array content only; a plain-string system turn is recorded as "no parts". */
  content: z.array(RuntimeContentPartSchema).nullable().catch(null),
});

const RuntimeCompletionRequestSchema = z.object({
  model: z.string().catch(''),
  max_tokens: z.number().nullable().catch(null),
  temperature: z.number().nullable().catch(null),
  response_format: z
    .object({ type: z.string().nullable().catch(null) })
    .nullable()
    .catch(null),
  messages: z.array(RuntimeMessageSchema).catch([]),
});

type RuntimeCompletionRequest = z.infer<typeof RuntimeCompletionRequestSchema>;

function recordRequest(
  parsed: RuntimeCompletionRequest,
  authorization: string | null,
): RecordedRuntimeRequest {
  const userTurn = parsed.messages.find((message) => message.role === 'user');
  const parts = userTurn?.content ?? [];
  const imagePart = parts.find((part) => part.type === 'image_url');
  return {
    model: parsed.model,
    hasResponseFormat: parsed.response_format !== null,
    responseFormatType: parsed.response_format?.type ?? null,
    maxTokens: parsed.max_tokens,
    temperature: parsed.temperature,
    messageRoles: parsed.messages.map((message) => message.role),
    userPartTypes: parts.map((part) => part.type),
    imageDataUriLength: imagePart?.image_url?.url.length ?? 0,
    authorization,
  };
}

export async function startFakeRuntime(
  initial: FakeScenario = { kind: 'ok', items: [{ n: 'grilled chicken breast', g: 140 }] },
): Promise<FakeRuntime> {
  let scenario = initial;
  let ready = true;
  let healthStatus: number | 'absent' | null = null;
  let modelsStatus = 200;
  const probes: RecordedProbe[] = [];
  let gate: { promise: Promise<void>; release: () => void } | null = null;
  let inFlight = 0;
  const inFlightWaiters: Array<{ count: number; resolve: () => void }> = [];
  const requests: RecordedRuntimeRequest[] = [];

  function noteInFlight(): void {
    for (let i = inFlightWaiters.length - 1; i >= 0; i -= 1) {
      if (inFlight >= inFlightWaiters[i].count) {
        inFlightWaiters[i].resolve();
        inFlightWaiters.splice(i, 1);
      }
    }
  }

  const app = express();
  app.use(express.json({ limit: '32mb' }));

  app.get('/health', (req, res) => {
    probes.push({ path: '/health', authorization: authorizationOf(req) });
    const status = healthStatus ?? (ready ? 200 : 503);
    if (status === 'absent') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(status).json({ status: status === 200 ? 'ok' : 'loading model' });
  });

  app.get('/v1/models', (req, res) => {
    probes.push({ path: '/v1/models', authorization: authorizationOf(req) });
    if (modelsStatus !== 200) {
      res.status(modelsStatus).json({ error: 'models unavailable' });
      return;
    }
    res.status(200).json({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] });
  });

  app.post('/v1/chat/completions', (req, res) => {
    const parsed = RuntimeCompletionRequestSchema.parse(req.body);
    requests.push(recordRequest(parsed, authorizationOf(req)));

    const respond = (): void => {
      if (scenario.kind === 'status') {
        res.status(scenario.status).json(scenario.body ?? { error: 'runtime failure' });
        return;
      }
      const content =
        scenario.kind === 'ok' ? terseContent(scenario.items)
        : scenario.kind === 'raw' ? scenario.content
        : '';
      res.status(200).json({
        id: 'fake-completion',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: scenario.kind === 'raw' ? (scenario.finishReason ?? 'stop') : 'stop',
          },
        ],
        usage: { prompt_tokens: 512, completion_tokens: 42 },
      });
    };

    if (gate === null) {
      respond();
      return;
    }
    const respondWhenReleased = async (blocked: Promise<void>): Promise<void> => {
      await blocked;
      inFlight -= 1;
      respond();
    };
    inFlight += 1;
    noteInFlight();
    void respondWhenReleased(gate.promise);
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  // SAFETY: `app.listen` has already resolved its `listening` event above, and this
  // fake binds a TCP port (not a UNIX socket), so `address()` is an `AddressInfo`
  // here and never `null` or the pipe-name string.
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    probes,
    setScenario(next: FakeScenario) {
      scenario = next;
    },
    setReady(next: boolean) {
      ready = next;
    },
    setHealthStatus(next: number | 'absent') {
      healthStatus = next;
    },
    setModelsStatus(next: number) {
      modelsStatus = next;
    },
    block() {
      // The Promise executor runs synchronously, so `releaseGate` is assigned
      // before the next statement reads it.
      let releaseGate!: () => void;
      const promise = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      gate = { promise, release: releaseGate };
      return {
        release: () => {
          const current = gate;
          gate = null;
          current?.release();
        },
        waitForInFlight: (count: number) =>
          new Promise<void>((resolve) => {
            if (inFlight >= count) {
              resolve();
              return;
            }
            inFlightWaiters.push({ count, resolve });
          }),
      };
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
