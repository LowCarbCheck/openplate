/**
 * Boots the REAL app (`createApp`) on an ephemeral port with injectable parts.
 *
 * Every test in this suite drives the service over HTTP rather than calling
 * handlers directly, because most of what is being asserted only exists on the
 * wire: status codes, `Retry-After`, the OpenAI error envelope, the body-parser
 * limit. The only things swapped are the model runtime, the logger and the clock.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { parseConfig, type ServiceConfig } from '../../src/config.js';
import { createCapturingLogger, type CapturedLogLine, type Logger } from '../../src/logger.js';
import type { Embedder } from '../../src/food-source/embedding.js';
import type { ModelRuntime } from '../../src/pipeline/runtime-client.js';
import { createModelRuntime } from '../../src/pipeline/runtime-client.js';
import type { NutritionResolver } from '../../src/pipeline/resolve-nutrition.js';
import { createAdmissionController, type AdmissionController } from '../../src/server/admission.js';
import { createApp } from '../../src/server/create-app.js';
import { createRateLimiter, type RateLimiter } from '../../src/server/rate-limit.js';

export const TEST_API_KEY = 'opk_test_key_one';
export const OTHER_TEST_API_KEY = 'opk_test_key_two';

export function testConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  const base = parseConfig({
    MODEL_RUNTIME_URL: 'http://127.0.0.1:1',
    API_KEYS: `${TEST_API_KEY},${OTHER_TEST_API_KEY}`,
    LOG_LEVEL: 'error',
  });
  return { ...base, ...overrides };
}

/** One content part of an OpenAI-compatible user message. */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** One message of an OpenAI-compatible chat-completions request. */
export interface ChatMessage {
  role: 'system' | 'user';
  content: string | ChatContentPart[];
}

/**
 * The chat-completions request body a test puts on the wire. Deliberately
 * permissive about `model`/`response_format` (absent in the malformed-request
 * tests) but exact about everything the service reads.
 */
export interface ChatCompletionRequestBody {
  model?: string;
  messages: ChatMessage[];
  response_format?: { type: string; json_schema?: { name: string } };
}

export interface TestApp {
  baseUrl: string;
  config: ServiceConfig;
  admission: AdmissionController;
  logLines: CapturedLogLine[];
  post(
    path: string,
    body: ChatCompletionRequestBody,
    options?: { apiKey?: string | null },
  ): Promise<TestResponse>;
  get(path: string, options?: { apiKey?: string | null }): Promise<TestResponse>;
  close(): Promise<void>;
}

export interface TestResponse {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

export interface StartTestAppOptions {
  config?: Partial<ServiceConfig>;
  /** A stub runtime. Omit and one is built against `runtimeBaseUrl`. */
  runtime?: ModelRuntime;
  runtimeBaseUrl?: string;
  admission?: AdmissionController;
  rateLimiter?: RateLimiter;
  /** Omit for the no-resolution default, which is what every pre-spec-04 test asserts. */
  resolver?: NutritionResolver | null;
  /** Reporting-only stub for the `/readyz` degraded-embedding field. */
  embedder?: Pick<Embedder, 'status'> | null;
  logger?: Logger;
}

export async function startTestApp(options: StartTestAppOptions = {}): Promise<TestApp> {
  const configOverrides: Partial<ServiceConfig> = { ...options.config };
  if (options.runtimeBaseUrl !== undefined && configOverrides.modelRuntimeUrl === undefined) {
    configOverrides.modelRuntimeUrl = options.runtimeBaseUrl;
  }
  const config = testConfig(configOverrides);
  const captured = createCapturingLogger();
  const admission =
    options.admission ??
    createAdmissionController({
      concurrency: config.concurrency,
      maxQueueDepth: config.maxQueueDepth,
      latencyCeilingMs: config.latencyCeilingMs,
    });

  const app = createApp({
    config,
    runtime:
      options.runtime ??
      createModelRuntime({
        baseUrl: config.modelRuntimeUrl,
        modelId: config.runtimeModelId,
        apiKey: config.modelRuntimeApiKey,
        completionTimeoutMs: config.runtimeCompletionTimeoutMs,
      }),
    embedder: options.embedder ?? null,
    admission,
    rateLimiter: options.rateLimiter ?? createRateLimiter({ requestsPerMinute: config.rateLimitRpm }),
    resolver: options.resolver ?? null,
    logger: options.logger ?? captured.logger,
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  // SAFETY: `app.listen` has already resolved its `listening` event above, and this
  // server is bound to a TCP port (not a UNIX socket), so `address()` is an
  // `AddressInfo` here and never `null` or the pipe-name string.
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function send(
    method: 'GET' | 'POST',
    path: string,
    body: ChatCompletionRequestBody | null,
    apiKey: string | null | undefined,
  ): Promise<TestResponse> {
    const headers: Record<string, string> = {};
    if (apiKey !== null) headers.Authorization = `Bearer ${apiKey ?? TEST_API_KEY}`;
    const init: RequestInit = { method, headers };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return { status: response.status, headers: response.headers, body: parsed, text };
  }

  return {
    baseUrl,
    config,
    admission,
    logLines: captured.lines,
    post: (path, body, opts) => send('POST', path, body, opts?.apiKey),
    get: (path, opts) => send('GET', path, null, opts?.apiKey),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A real JPEG of the given size — sharp must be able to decode it. */
export async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 190, g: 120, b: 70 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

export function toDataUri(bytes: Buffer, mimeType = 'image/jpeg'): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

/** The request body openplate's `openai-compatible` adapter sends: text part, then image part. */
export function chatRequest(
  dataUri: string,
  overrides: { model?: string; extraImages?: string[] } = {},
): ChatCompletionRequestBody {
  const content: ChatContentPart[] = [
    { type: 'text', text: 'Identify the foods on this plate.' },
    { type: 'image_url', image_url: { url: dataUri } },
  ];
  for (const extra of overrides.extraImages ?? []) {
    content.push({ type: 'image_url', image_url: { url: extra } });
  }
  return {
    model: overrides.model ?? 'openplate-plate-1',
    messages: [
      { role: 'system', content: 'You are a plate identifier.' },
      { role: 'user', content },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'plate_identification' } },
  };
}

/** Every string a test can see: the response text plus every captured log line. */
export function allObservableText(app: TestApp, responseText: string): string {
  return [responseText, ...app.logLines.map((line) => JSON.stringify(line))].join('\n');
}
