/**
 * The three limits a compute-bound paid endpoint cannot ship without: image
 * size, image count, and a per-key rate limit.
 *
 * API-key auth alone does not protect anything here — one key posting 8 MB
 * photos in a loop starves every other tenant on the box, and each request costs
 * seconds of GPU or tens of seconds of CPU. These are the gates that make a
 * shared instance survivable.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OTHER_TEST_API_KEY,
  TEST_API_KEY,
  chatRequest,
  makeJpeg,
  startTestApp,
  toDataUri,
  type TestApp,
} from '../support/app-harness.js';
import { createRateLimiter } from '../../src/server/rate-limit.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

let runtime: FakeRuntime;

beforeEach(async () => {
  runtime = await startFakeRuntime();
});

afterEach(async () => {
  await runtime.close();
});

describe('image size limit', () => {
  let app: TestApp;

  beforeEach(async () => {
    // A tiny cap so the test does not have to build an 8 MB payload. The JSON
    // body limit is DERIVED from this, so it moves with it.
    app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl, config: { maxImageBytes: 4096 } });
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects a decoded image over MAX_IMAGE_BYTES with 413', async () => {
    const oversize = await makeJpeg(1200, 900);
    expect(oversize.byteLength).toBeGreaterThan(4096);
    const response = await app.post('/v1/chat/completions', chatRequest(toDataUri(oversize)));
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('image_too_large');
    expect(runtime.requests).toHaveLength(0);
  });

  it('accepts an image inside the cap', async () => {
    const small = await makeJpeg(120, 90);
    expect(small.byteLength).toBeLessThan(4096);
    const response = await app.post('/v1/chat/completions', chatRequest(toDataUri(small)));
    expect(response.status).toBe(200);
  });

  it('answers a body over the derived JSON limit with a 413 in the OpenAI shape', async () => {
    // Well past `maxImageBytes * 4/3 + 64 KB`, so body-parser rejects it before
    // any handler runs. Express's default handler would answer HTML here.
    const enormous = 'A'.repeat(400_000);
    const response = await app.post('/v1/chat/completions', chatRequest(`data:image/jpeg;base64,${enormous}`));
    expect(response.status).toBe(413);
    expect(response.body.error.type).toBe('invalid_request_error');
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

describe('image count limit', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl });
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects more than one image per request', async () => {
    const dataUri = toDataUri(await makeJpeg(300, 200));
    const response = await app.post(
      '/v1/chat/completions',
      chatRequest(dataUri, { extraImages: [dataUri] }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('too_many_images');
    expect(runtime.requests).toHaveLength(0);
  });

  it('rejects a request with no image at all', async () => {
    const response = await app.post('/v1/chat/completions', {
      model: 'openplate-plate-1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'what did I eat?' }] }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('image_missing');
  });

  it('rejects a remote image URL with an actionable message', async () => {
    const response = await app.post('/v1/chat/completions', chatRequest('https://example.com/plate.jpg'));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('unsupported_image_source');
    expect(response.body.error.message).toContain('data URI');
  });
});

describe('per-key rate limit', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl, config: { rateLimitRpm: 2 } });
  });
  afterEach(async () => {
    await app.close();
  });

  it('allows the budget, then answers 429 with Retry-After', async () => {
    const dataUri = toDataUri(await makeJpeg(200, 150));
    const first = await app.post('/v1/chat/completions', chatRequest(dataUri));
    const second = await app.post('/v1/chat/completions', chatRequest(dataUri));
    const third = await app.post('/v1/chat/completions', chatRequest(dataUri));

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(third.status).toBe(429);
    expect(third.body.error.type).toBe('rate_limit_error');
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    // The rejected request never reached the model.
    expect(runtime.requests).toHaveLength(2);
  });

  it('buckets per key, so one tenant cannot spend the budget of another', async () => {
    const dataUri = toDataUri(await makeJpeg(200, 150));
    await app.post('/v1/chat/completions', chatRequest(dataUri), { apiKey: TEST_API_KEY });
    await app.post('/v1/chat/completions', chatRequest(dataUri), { apiKey: TEST_API_KEY });
    const exhausted = await app.post('/v1/chat/completions', chatRequest(dataUri), { apiKey: TEST_API_KEY });
    const otherTenant = await app.post('/v1/chat/completions', chatRequest(dataUri), {
      apiKey: OTHER_TEST_API_KEY,
    });

    expect(exhausted.status).toBe(429);
    expect(otherTenant.status).toBe(200);
  });
});

describe('token bucket refill', () => {
  it('refills continuously rather than in fixed windows', () => {
    // A fixed window would let a caller spend a whole minute's budget at the end
    // of one window and again at the start of the next — the exact burst a
    // compute-bound service cannot absorb.
    let clock = 0;
    const limiter = createRateLimiter({ requestsPerMinute: 60, now: () => clock });

    for (let i = 0; i < 60; i += 1) limiter.consume('key');
    expect(() => limiter.consume('key')).toThrow(/Rate limit reached/);

    clock += 1000; // one second ⇒ exactly one token back at 60/min
    expect(() => limiter.consume('key')).not.toThrow();
    expect(() => limiter.consume('key')).toThrow(/Rate limit reached/);
  });
});
