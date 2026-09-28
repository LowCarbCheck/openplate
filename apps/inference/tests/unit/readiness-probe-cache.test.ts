/**
 * The readiness decision table and its endpoint cache.
 *
 * Each case here is one measured runtime behaviour (2026-08-15), not a shape the
 * API surface suggested:
 *
 *  - llama.cpp answers `/health` **503 while the model loads**, so 503 must be a
 *    plain "not ready" with NO fallback. Falling back there would report ready
 *    mid-load — which is exactly the lie `/readyz` exists to prevent. The
 *    assertion that matters is the one about a request that was NOT made.
 *  - Ollama has no `/health` (404) and must fall through to `/v1/models`, which
 *    is what stops the container HEALTHCHECK restart-looping a working service.
 *  - An authed vLLM answers `/v1/models` 401, which must surface as NOT ready:
 *    hiding a key misconfiguration behind a green probe is the worse bug.
 *
 * The cache is asserted by counting probes, because the cost it removes is two
 * sequential round-trips on every 30 s HEALTHCHECK for the container's lifetime.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createModelRuntime } from '../../src/pipeline/runtime-client.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

let runtime: FakeRuntime;

function clientFor(fake: FakeRuntime) {
  return createModelRuntime({ baseUrl: fake.baseUrl, modelId: 'test-model' });
}

function pathsOf(fake: FakeRuntime): string[] {
  return fake.probes.map((probe) => probe.path);
}

afterEach(async () => {
  await runtime?.close();
});

describe('readiness decision table', () => {
  it('reports ready on a 2xx /health', async () => {
    runtime = await startFakeRuntime();

    expect(await clientFor(runtime).isReady()).toBe(true);
    expect(pathsOf(runtime)).toEqual(['/health']);
  });

  it('reports NOT ready on a 503 /health and does not fall back', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus(503);

    expect(await clientFor(runtime).isReady()).toBe(false);
    // The whole point: no `/v1/models` request was made. A 503 is the runtime
    // answering the question, not evidence that `/health` is absent.
    expect(pathsOf(runtime)).toEqual(['/health']);
  });

  it('falls back to /v1/models on a 404 /health', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus('absent');

    expect(await clientFor(runtime).isReady()).toBe(true);
    expect(pathsOf(runtime)).toEqual(['/health', '/v1/models']);
  });

  it('falls back on a 401 /health (auth-everything proxy), not only on 404', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus(401);

    expect(await clientFor(runtime).isReady()).toBe(true);
    expect(pathsOf(runtime)).toEqual(['/health', '/v1/models']);
  });

  it('reports NOT ready when the fallback answers 401', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus('absent');
    runtime.setModelsStatus(401);

    expect(await clientFor(runtime).isReady()).toBe(false);
    expect(pathsOf(runtime)).toEqual(['/health', '/v1/models']);
  });

  it('never throws when nothing is listening at all', async () => {
    const client = createModelRuntime({ baseUrl: 'http://127.0.0.1:1', modelId: 'test-model' });

    await expect(client.isReady()).resolves.toBe(false);
  });
});

describe('probe endpoint cache', () => {
  it('goes straight to /v1/models after the first successful fallback', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus('absent');
    const client = clientFor(runtime);

    expect(await client.isReady()).toBe(true);
    runtime.probes.length = 0;

    expect(await client.isReady()).toBe(true);
    expect(await client.isReady()).toBe(true);

    // No `/health` re-probe: the resolution is remembered, so a `/health`-less
    // runtime stops paying two round-trips per readiness check.
    expect(pathsOf(runtime)).toEqual(['/v1/models', '/v1/models']);
  });

  it('re-probes /health after a run of consecutive fallback failures', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus('absent');
    const client = clientFor(runtime);

    expect(await client.isReady()).toBe(true);
    runtime.setModelsStatus(500);
    runtime.probes.length = 0;

    // Three consecutive failures, all on the cached endpoint only.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await client.isReady()).toBe(false);
    }
    expect(pathsOf(runtime)).toEqual(['/v1/models', '/v1/models', '/v1/models']);

    // The fourth starts over at `/health`, so a URL repointed at a
    // `/health`-speaking runtime re-resolves instead of being wrong forever.
    runtime.probes.length = 0;
    await client.isReady();
    expect(pathsOf(runtime)[0]).toBe('/health');
  });

  it('falls through to /v1/models within the same call when /health later disappears', async () => {
    runtime = await startFakeRuntime();
    const client = clientFor(runtime);

    // Resolved the ordinary way first: `/health` answered, one round-trip.
    expect(await client.isReady()).toBe(true);
    expect(pathsOf(runtime)).toEqual(['/health']);

    // The upstream is swapped (or a proxy stops mapping the path) mid-life.
    runtime.setHealthStatus('absent');
    runtime.probes.length = 0;

    // Still ready, resolved inside this single call — no state says "we already
    // settled on /health, skip the fallback". This is what protects the chain
    // from being "optimized" into a health fast path.
    expect(await client.isReady()).toBe(true);
    expect(pathsOf(runtime)).toEqual(['/health', '/v1/models']);
  });

  it('does not discard a resolution after a single blip', async () => {
    runtime = await startFakeRuntime();
    runtime.setHealthStatus('absent');
    const client = clientFor(runtime);

    expect(await client.isReady()).toBe(true);
    runtime.setModelsStatus(500);
    expect(await client.isReady()).toBe(false);
    runtime.setModelsStatus(200);
    expect(await client.isReady()).toBe(true);
    runtime.probes.length = 0;

    expect(await client.isReady()).toBe(true);
    expect(pathsOf(runtime)).toEqual(['/v1/models']);
  });
});
