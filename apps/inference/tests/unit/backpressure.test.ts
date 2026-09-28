/**
 * Backpressure: a bounded pool that REFUSES work instead of queueing it forever,
 * and no job queue anywhere near the synchronous route.
 *
 * Determinism note: none of this sleeps or races. The fake runtime can park a
 * request indefinitely (`block()`), and the admission controller's own counters
 * are readable, so each test drives the pool into an exact state — full, then
 * full-with-a-waiter — before asserting what the next caller gets. A timing-based
 * version of this test would be the kind that passes on a fast laptop and fails
 * in CI.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatRequest, makeJpeg, startTestApp, toDataUri, type TestApp } from '../support/app-harness.js';
import { createAdmissionController } from '../../src/server/admission.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

let runtime: FakeRuntime;
let app: TestApp;
let dataUri: string;

beforeEach(async () => {
  runtime = await startFakeRuntime();
  app = await startTestApp({
    runtimeBaseUrl: runtime.baseUrl,
    // One worker, room for one waiter: the smallest pool that can be saturated.
    config: { concurrency: 1, maxQueueDepth: 1, latencyCeilingMs: 0, rateLimitRpm: 1000 },
  });
  dataUri = toDataUri(await makeJpeg(320, 240));
});

afterEach(async () => {
  await app.close();
  await runtime.close();
});

/** Resolves once the admission controller reports the state a test needs. */
async function waitForStats(
  target: TestApp,
  predicate: (stats: { active: number; queued: number }) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate(target.admission.stats())) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(
    `admission never reached the expected state: ${JSON.stringify(target.admission.stats())}`,
  );
}

describe('bounded worker pool', () => {
  it('answers 429 with Retry-After once the queue is full, and never queues the request', async () => {
    const gate = runtime.block();

    // Worker occupied.
    const inFlight = app.post('/v1/chat/completions', chatRequest(dataUri));
    await gate.waitForInFlight(1);

    // Waiting line occupied (this one has not reached the runtime at all).
    const queued = app.post('/v1/chat/completions', chatRequest(dataUri));
    await waitForStats(app, (stats) => stats.active === 1 && stats.queued === 1);

    // Third caller: refused rather than admitted.
    const refused = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(refused.status).toBe(429);
    expect(refused.body.error.type).toBe('rate_limit_error');
    expect(refused.body.error.code).toBe('rate_limit_exceeded');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    // Refused means refused — not deferred. Only the admitted request is at the
    // runtime, and the refusal is already on the wire.
    expect(runtime.requests).toHaveLength(1);

    gate.release();
    expect((await inFlight).status).toBe(200);
    expect((await queued).status).toBe(200);
    // The queued request ran only after the first finished: one worker, in order.
    expect(runtime.requests).toHaveLength(2);
  });

  it('drains back to idle so a later caller is admitted normally', async () => {
    const gate = runtime.block();
    const inFlight = app.post('/v1/chat/completions', chatRequest(dataUri));
    await gate.waitForInFlight(1);
    gate.release();
    await inFlight;

    await waitForStats(app, (stats) => stats.active === 0 && stats.queued === 0);
    const later = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(later.status).toBe(200);
  });
});

describe('admission controller', () => {
  it('caps concurrent tasks at CONCURRENCY', async () => {
    const controller = createAdmissionController({
      concurrency: 2,
      maxQueueDepth: 10,
      latencyCeilingMs: 0,
    });
    let peak = 0;
    let running = 0;
    const releases: Array<() => void> = [];

    const tasks = [1, 2, 3, 4].map(() =>
      controller.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running -= 1;
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(controller.stats().active).toBe(2);
    expect(controller.stats().queued).toBe(2);

    while (releases.length > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it('records service time even when the task throws', async () => {
    // A failure that took 30 s still consumed 30 s of capacity. An average that
    // ignored failures would make a degraded runtime look fast and keep admitting.
    let clock = 0;
    const controller = createAdmissionController({
      concurrency: 1,
      maxQueueDepth: 1,
      latencyCeilingMs: 0,
      monotonicNow: () => clock,
    });
    await expect(
      controller.run(async () => {
        clock += 5000;
        throw new Error('runtime exploded');
      }),
    ).rejects.toThrow('runtime exploded');
    expect(controller.stats().meanServiceMs).toBe(5000);
  });
});
