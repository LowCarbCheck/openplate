/**
 * The latency ceiling: admission is refused when the PROJECTED completion would
 * exceed it, rather than the request being served slowly.
 *
 * This encodes a product requirement, not a tuning preference. The hosted tier's
 * bar is "p95 ≤ 10 s per scan, hard maximum" (owner, 2026-08-11), which makes a
 * 30-second success a FAILED request. A service that served it anyway would blow
 * the SLO while reporting 200s.
 *
 * The mean service time is measured, not configured, so these tests seed it
 * explicitly (`recordServiceMs`) instead of sleeping — the arithmetic under test
 * is `(queue_depth + 1) × mean > ceiling`, and real timing would only add flake.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatRequest, makeJpeg, startTestApp, toDataUri, type TestApp } from '../support/app-harness.js';
import { createAdmissionController } from '../../src/server/admission.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

const HOSTED_CEILING_MS = 10_000;

describe('projected-latency admission (unit)', () => {
  it('admits while the projection is inside the ceiling', async () => {
    const controller = createAdmissionController({
      concurrency: 1,
      maxQueueDepth: 4,
      latencyCeilingMs: HOSTED_CEILING_MS,
    });
    controller.recordServiceMs(2000);
    await expect(controller.run(async () => 'served')).resolves.toBe('served');
  });

  it('refuses with 503 + Retry-After once the projection exceeds the ceiling', async () => {
    const controller = createAdmissionController({
      concurrency: 1,
      maxQueueDepth: 4,
      latencyCeilingMs: HOSTED_CEILING_MS,
    });
    // A CPU-class service time: one request alone already blows a 10 s ceiling.
    controller.recordServiceMs(25_000);

    await expect(controller.run(async () => 'served')).rejects.toMatchObject({
      status: 503,
      code: 'service_overloaded',
    });
  });

  it('counts queue depth into the projection, not just the request itself', async () => {
    const controller = createAdmissionController({
      concurrency: 1,
      maxQueueDepth: 10,
      latencyCeilingMs: HOSTED_CEILING_MS,
    });
    controller.recordServiceMs(4000); // one request: 4 s, fine

    const releases: Array<() => void> = [];
    const start = (): Promise<void> =>
      controller.run(() => new Promise<void>((resolve) => releases.push(resolve)));

    const first = start(); // active
    const second = start(); // queued ⇒ projection for the NEXT caller is 2 × 4 s
    await new Promise((resolve) => setImmediate(resolve));
    expect(controller.stats().queued).toBe(1);

    // (1 queued + 1) × 4000 = 8000 ≤ 10000 ⇒ still admitted.
    const third = start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(controller.stats().queued).toBe(2);

    // (2 queued + 1) × 4000 = 12000 > 10000 ⇒ refused.
    await expect(start()).rejects.toMatchObject({ status: 503 });

    while (releases.length > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all([first, second, third]);
  });

  it('stays open before any measurement exists', async () => {
    // No completed request ⇒ no mean ⇒ nothing to project from. Refusing here
    // would make every cold start look like an outage.
    const controller = createAdmissionController({
      concurrency: 1,
      maxQueueDepth: 1,
      latencyCeilingMs: 1,
    });
    expect(controller.stats().meanServiceMs).toBeNull();
    await expect(controller.run(async () => 'served')).resolves.toBe('served');
  });

  it('is disabled entirely at LATENCY_CEILING_MS = 0 (the self-host default)', async () => {
    // A CPU box legitimately takes 25–110 s per plate. Shedding load at 10 s
    // there would refuse every request it is capable of serving.
    const controller = createAdmissionController({
      concurrency: 1,
      maxQueueDepth: 1,
      latencyCeilingMs: 0,
    });
    controller.recordServiceMs(110_000);
    await expect(controller.run(async () => 'served')).resolves.toBe('served');
  });

  it('derives Retry-After from the measured drain estimate, not a fixed number', async () => {
    const controller = createAdmissionController({
      concurrency: 1,
      maxQueueDepth: 10,
      latencyCeilingMs: 5000,
    });
    controller.recordServiceMs(4000);

    const releases: Array<() => void> = [];
    const start = (): Promise<void> =>
      controller.run(() => new Promise<void>((resolve) => releases.push(resolve)));
    const first = start(); // active
    const second = start(); // queued
    await new Promise((resolve) => setImmediate(resolve));

    // Projection (1 + 1) × 4000 = 8000 > 5000 ⇒ refused, and the work ahead
    // (1 active + 1 queued, one worker) drains in ~8 s.
    await expect(start()).rejects.toMatchObject({ status: 503, retryAfterSeconds: 8 });

    while (releases.length > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all([first, second]);
  });
});

describe('projected-latency admission (over HTTP)', () => {
  let runtime: FakeRuntime;
  let app: TestApp;

  beforeEach(async () => {
    runtime = await startFakeRuntime();
    app = await startTestApp({
      runtimeBaseUrl: runtime.baseUrl,
      config: { concurrency: 1, maxQueueDepth: 4, latencyCeilingMs: HOSTED_CEILING_MS, rateLimitRpm: 1000 },
    });
  });

  afterEach(async () => {
    await app.close();
    await runtime.close();
  });

  it('sheds load with 503 rather than serving a scan that would miss the ceiling', async () => {
    const dataUri = toDataUri(await makeJpeg(320, 240));

    // Warm: the first request establishes a (fast) mean and succeeds.
    expect((await app.post('/v1/chat/completions', chatRequest(dataUri))).status).toBe(200);

    // Now the box is measured as slow — a model reload, a thermally throttled
    // host, a bigger model swapped in underneath. Fed repeatedly because the mean
    // is an EWMA: one slow sample deliberately does NOT start shedding traffic,
    // a sustained trend does.
    for (let i = 0; i < 20; i += 1) app.admission.recordServiceMs(40_000);
    expect(app.admission.stats().meanServiceMs).toBeGreaterThan(HOSTED_CEILING_MS);

    const shed = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(shed.status).toBe(503);
    expect(shed.body.error.code).toBe('service_overloaded');
    expect(shed.body.error.type).toBe('server_error');
    expect(Number(shed.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    // Shed means the model was never asked a second time.
    expect(runtime.requests).toHaveLength(1);
  });
});
