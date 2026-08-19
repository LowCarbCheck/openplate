/**
 * THE BEARER IS ASSERTED ON THE WIRE, not on the outcome.
 *
 * A test that only checked `response.ok` would have passed against the build
 * that sent no `Authorization` header at all — which is the bug this covers:
 * measured 2026-08-15, `vllm serve --api-key …` answers every unauthenticated
 * `POST /v1/chat/completions` with 401 while leaving `/health` open, so the
 * service reported ready and failed every single scan. Every assertion below
 * therefore reads the header the fake runtime RECEIVED.
 *
 * The absent-key cases matter just as much: `Authorization: Bearer ` (present
 * and empty) is not the same thing as no header, and a proxy will reject the
 * first while ignoring the second.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createModelRuntime } from '../../src/pipeline/runtime-client.js';
import { createEmbedder } from '../../src/food-source/embedding.js';
import { createSilentLogger } from '../../src/logger.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';
import { startFakeEmbeddings } from '../support/fake-embeddings.js';

const API_KEY = 'sk_upstream_key';
const IMAGE = 'data:image/jpeg;base64,AAAA';

let runtime: FakeRuntime;

afterEach(async () => {
  await runtime?.close();
});

describe('model runtime bearer', () => {
  it('attaches the bearer to the completions call', async () => {
    runtime = await startFakeRuntime();
    const client = createModelRuntime({
      baseUrl: runtime.baseUrl,
      modelId: 'test-model',
      apiKey: API_KEY,
    });

    await client.identify(IMAGE);

    expect(runtime.requests[0].authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('attaches the bearer to the /health probe', async () => {
    runtime = await startFakeRuntime();
    const client = createModelRuntime({
      baseUrl: runtime.baseUrl,
      modelId: 'test-model',
      apiKey: API_KEY,
    });

    await client.isReady();

    expect(runtime.probes).toEqual([{ path: '/health', authorization: `Bearer ${API_KEY}` }]);
  });

  it('attaches the bearer to the /v1/models fallback probe', async () => {
    runtime = await startFakeRuntime();
    // Ollama-class: no /health at all, so readiness falls through to /v1/models.
    runtime.setHealthStatus('absent');
    const client = createModelRuntime({
      baseUrl: runtime.baseUrl,
      modelId: 'test-model',
      apiKey: API_KEY,
    });

    await client.isReady();

    const fallback = runtime.probes.find((probe) => probe.path === '/v1/models');
    expect(fallback?.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('sends NO Authorization header at all when no key is configured', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus('absent');
    const client = createModelRuntime({ baseUrl: runtime.baseUrl, modelId: 'test-model' });

    await client.isReady();
    await client.identify(IMAGE);

    for (const probe of runtime.probes) expect(probe.authorization).toBeNull();
    expect(runtime.requests[0].authorization).toBeNull();
  });
});

describe('embedding runtime bearer', () => {
  it('attaches the bearer to /v1/embeddings when configured', async () => {
    const fake = await startFakeEmbeddings();
    try {
      const embedder = createEmbedder({
        baseUrl: fake.baseUrl,
        apiKey: API_KEY,
        logger: createSilentLogger(),
      });

      await embedder.embed(['banana']);

      expect(fake.received).toEqual([`Bearer ${API_KEY}`]);
    } finally {
      await fake.close();
    }
  });

  it('sends no Authorization header when no key is configured', async () => {
    const fake = await startFakeEmbeddings();
    try {
      const embedder = createEmbedder({ baseUrl: fake.baseUrl, logger: createSilentLogger() });

      await embedder.embed(['banana']);

      expect(fake.received).toEqual([null]);
    } finally {
      await fake.close();
    }
  });
});
