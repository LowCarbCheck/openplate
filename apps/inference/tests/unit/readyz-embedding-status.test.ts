/**
 * `/readyz` publishes the embedding runtime's state — as a DEGRADED field.
 *
 * Adding `EMBEDDING_RUNTIME_API_KEY` removes one CAUSE of silent degradation and
 * leaves the silence itself: a typo'd or rotated key produces the same permanent,
 * invisible lexical-only retrieval, with no signal after a single boot-time
 * warning. So the state is observable here.
 *
 * The status code is the load-bearing assertion in every case below. Lexical-only
 * is a legitimate mode — it is the DEFAULT — so a dead embeddings runtime must
 * never take the service out of an orchestrator's rotation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/food-source/embedding.js';
import { createSilentLogger } from '../../src/logger.js';
import { startFakeEmbeddings, type FakeEmbeddings } from '../support/fake-embeddings.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';
import { startTestApp, type TestApp } from '../support/app-harness.js';

let runtime: FakeRuntime;
let app: TestApp;
let embeddings: FakeEmbeddings | undefined;

afterEach(async () => {
  await app?.close();
  await runtime?.close();
  await embeddings?.close();
  embeddings = undefined;
});

describe('/readyz embedding state', () => {
  it('reports null — not false — when no embeddings runtime is configured', async () => {
    runtime = await startFakeRuntime();
    app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl });

    const response = await app.get('/readyz');

    expect(response.status).toBe(200);
    // `null` is "not configured", distinct from `false` = "configured and failing".
    expect(response.body.embeddingReady).toBeNull();
    // A non-null reason must mean something is WRONG. The default configuration
    // is not wrong, so it carries no reason — anyone alerting on
    // `embeddingReason !== null` would otherwise be paged by a stock install.
    expect(response.body.embeddingReason).toBeNull();
  });

  it('reports ready while the embeddings runtime is healthy', async () => {
    runtime = await startFakeRuntime();
    app = await startTestApp({
      runtimeBaseUrl: runtime.baseUrl,
      embedder: { status: () => ({ ready: true, reason: null }) },
    });

    const response = await app.get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body.embeddingReady).toBe(true);
    expect(response.body.embeddingReason).toBeNull();
  });

  it('exposes the failure reason WITHOUT changing the status code', async () => {
    runtime = await startFakeRuntime();
    app = await startTestApp({
      runtimeBaseUrl: runtime.baseUrl,
      embedder: { status: () => ({ ready: false, reason: 'http 401' }) },
    });

    const response = await app.get('/readyz');

    // Degraded, never unhealthy: the model runtime is what gates the 200/503.
    expect(response.status).toBe(200);
    expect(response.body.modelRuntimeReady).toBe(true);
    expect(response.body.embeddingReady).toBe(false);
    expect(response.body.embeddingReason).toBe('http 401');
  });

  it('surfaces a real 401 from the embedder rather than swallowing it', async () => {
    embeddings = await startFakeEmbeddings();
    // A rejected key — the exact failure `EMBEDDING_RUNTIME_API_KEY` introduces
    // the possibility of, and the one that used to vanish after one warn line.
    embeddings.setStatus(401);
    const embedder = createEmbedder({
      baseUrl: embeddings.baseUrl,
      apiKey: 'sk_wrong',
      logger: createSilentLogger(),
    });
    expect(embedder.status()).toEqual({ ready: true, reason: null });

    expect(await embedder.embed(['banana'])).toBeNull();
    expect(embedder.status()).toEqual({ ready: false, reason: 'http 401' });

    runtime = await startFakeRuntime();
    app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl, embedder });
    const response = await app.get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body.embeddingReady).toBe(false);
    expect(response.body.embeddingReason).toBe('http 401');
  });

  it('recovers: a later successful call clears the degraded state', async () => {
    embeddings = await startFakeEmbeddings();
    embeddings.setStatus(401);
    const embedder = createEmbedder({
      baseUrl: embeddings.baseUrl,
      apiKey: 'sk_rotated',
      logger: createSilentLogger(),
    });

    expect(await embedder.embed(['banana'])).toBeNull();
    expect(embedder.status()).toEqual({ ready: false, reason: 'http 401' });

    // The operator fixes the key (or the runtime comes back). Nothing restarts
    // the process, so this reset is the feature's ONLY self-healing path — a
    // `/readyz` that stayed red until a redeploy would just be a new silence.
    embeddings.setStatus(200);
    expect(await embedder.embed(['banana'])).not.toBeNull();

    expect(embedder.status()).toEqual({ ready: true, reason: null });

    runtime = await startFakeRuntime();
    app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl, embedder });
    const response = await app.get('/readyz');

    expect(response.body.embeddingReady).toBe(true);
    expect(response.body.embeddingReason).toBeNull();
  });
});
