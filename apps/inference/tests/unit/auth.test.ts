/**
 * API-key auth on the inference routes.
 *
 * The interesting assertions are the negative ones: that an unauthenticated
 * caller learns NOTHING. No hint about which models exist, no distinction
 * between "no key", "malformed key" and "wrong key", and no leak of the failure
 * through a different status on a different route. And that the two probes stay
 * open, because an orchestrator has no key to give.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OTHER_TEST_API_KEY, TEST_API_KEY, chatRequest, makeJpeg, startTestApp, toDataUri, type TestApp } from '../support/app-harness.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

let runtime: FakeRuntime;
let app: TestApp;
let dataUri: string;

beforeEach(async () => {
  runtime = await startFakeRuntime();
  app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl });
  dataUri = toDataUri(await makeJpeg(400, 300));
});

afterEach(async () => {
  await app.close();
  await runtime.close();
});

describe('API-key auth', () => {
  it('rejects a chat completion with no Authorization header', async () => {
    const response = await app.post('/v1/chat/completions', chatRequest(dataUri), { apiKey: null });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('invalid_api_key');
    expect(response.body.error.type).toBe('invalid_request_error');
    // The runtime must never have been asked — auth precedes all work.
    expect(runtime.requests).toHaveLength(0);
  });

  it('rejects an unknown key with the same shape as a missing one', async () => {
    const response = await app.post('/v1/chat/completions', chatRequest(dataUri), {
      apiKey: 'opk_not_a_real_key',
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('invalid_api_key');
    expect(runtime.requests).toHaveLength(0);
  });

  it('rejects a non-Bearer Authorization scheme', async () => {
    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { Authorization: `Basic ${Buffer.from(`user:${TEST_API_KEY}`).toString('base64')}` },
    });
    expect(response.status).toBe(401);
  });

  it('guards /v1/models too, and does not reveal the model id to an anonymous caller', async () => {
    const anonymous = await app.get('/v1/models', { apiKey: null });
    expect(anonymous.status).toBe(401);
    expect(anonymous.text).not.toContain('openplate-plate-1');
  });

  it('accepts every configured key', async () => {
    for (const key of [TEST_API_KEY, OTHER_TEST_API_KEY]) {
      const response = await app.get('/v1/models', { apiKey: key });
      expect(response.status).toBe(200);
      expect(response.body.data[0].id).toBe('openplate-plate-1');
    }
  });

  it('leaves /healthz and /readyz unauthenticated', async () => {
    const health = await app.get('/healthz', { apiKey: null });
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const ready = await app.get('/readyz', { apiKey: null });
    expect(ready.status).toBe(200);
    expect(ready.body.modelRuntimeReady).toBe(true);
  });

  it('never echoes the presented key back', async () => {
    const response = await app.post('/v1/chat/completions', chatRequest(dataUri), {
      apiKey: 'opk_secret_guess_value',
    });
    expect(response.text).not.toContain('opk_secret_guess_value');
    const logged = app.logLines.map((line) => JSON.stringify(line)).join('\n');
    expect(logged).not.toContain('opk_secret_guess_value');
  });
});
