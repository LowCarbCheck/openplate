/**
 * The privacy promise, tested where it actually breaks: the ERROR paths.
 *
 * "Photos are processed in memory and never written to disk or logged" is the
 * product, not a nicety — and the happy path passing proves nothing about it. The
 * realistic leak is an unhandled exception whose reporter dumps the request body,
 * or a dependency that helpfully quotes the input it choked on into its
 * `Error.message`, which some `${error}` then logs.
 *
 * So each test below drives a real request with a REAL base64 photo through the
 * real app, forces a failure at a different point in the pipeline, and asserts
 * that the base64 appears in NEITHER the response body NOR any captured log
 * line. The last test is the adversarial one: a runtime whose error message
 * deliberately contains the whole data URI. If the scrubber is removed, that test
 * is the one that fails.
 */
import { describe, expect, it } from 'vitest';
import {
  allObservableText,
  chatRequest,
  makeJpeg,
  startTestApp,
  toDataUri,
} from '../support/app-harness.js';
import { upstreamFailure } from '../../src/errors.js';
import type { ModelRuntime } from '../../src/pipeline/runtime-client.js';
import { scrubPayloads } from '../../src/server/scrub.js';
import { startFakeRuntime } from '../support/fake-runtime.js';

/** A long, distinctive slice of the payload — what a leak would look like. */
function needle(dataUri: string): string {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  return base64.slice(0, 64);
}

describe('image bytes never reach an error path', () => {
  it('does not leak the payload when the model runtime fails', async () => {
    const runtime = await startFakeRuntime();
    // Some runtimes echo the request back inside their error body. Ours must not
    // forward any of it.
    runtime.setScenario({ kind: 'status', status: 500, body: { error: 'see request', echo: 'REQUEST_ECHO' } });
    const app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl });
    const dataUri = toDataUri(await makeJpeg(600, 450));

    const response = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(response.status).toBe(502);

    const observable = allObservableText(app, response.text);
    expect(observable).not.toContain(needle(dataUri));
    expect(observable).not.toContain('data:image/jpeg;base64,');
    expect(observable).not.toContain('REQUEST_ECHO');

    await app.close();
    await runtime.close();
  });

  it('does not leak the payload when the runtime returns malformed JSON', async () => {
    const runtime = await startFakeRuntime();
    runtime.setScenario({ kind: 'raw', content: '{"f":[{"n":"rice","g":' });
    const app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl });
    const dataUri = toDataUri(await makeJpeg(600, 450));

    const response = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(response.status).toBe(502);
    expect(allObservableText(app, response.text)).not.toContain(needle(dataUri));

    await app.close();
    await runtime.close();
  });

  it('does not leak the payload when the request is rejected for size', async () => {
    const runtime = await startFakeRuntime();
    const app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl, config: { maxImageBytes: 2048 } });
    const dataUri = toDataUri(await makeJpeg(1000, 800));

    const response = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(response.status).toBe(413);
    expect(allObservableText(app, response.text)).not.toContain(needle(dataUri));

    await app.close();
    await runtime.close();
  });

  it('scrubs the payload out of an UNEXPECTED error that carries it', async () => {
    // The adversarial case, and the reason `scrub.ts` exists: a dependency (or a
    // future contributor's `${error}`) putting the input into the message. Our own
    // code never does this — which is exactly why it must be tested rather than
    // assumed.
    const leakyRuntime: ModelRuntime = {
      async identify(imageDataUri: string) {
        throw new Error(`decode failed for input ${imageDataUri}`);
      },
      async isReady() {
        return true;
      },
    };
    const app = await startTestApp({ runtime: leakyRuntime });
    const dataUri = toDataUri(await makeJpeg(600, 450));

    const response = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(response.status).toBe(500);
    // The response says nothing about the failure at all.
    expect(response.body.error.message).toBe('Internal server error.');

    const observable = allObservableText(app, response.text);
    expect(observable).not.toContain(needle(dataUri));
    expect(observable).not.toContain('data:image/jpeg;base64,');
    // The failure was still reported — scrubbed, not swallowed.
    const errorLine = app.logLines.find((line) => line.level === 'error');
    expect(errorLine?.message).toBe('Unhandled request error');
    expect(String(errorLine?.fields.error)).toContain('[redacted]');

    await app.close();
  });

  it('scrubs an ApiError message that was built around the payload', async () => {
    const leakyRuntime: ModelRuntime = {
      async identify(imageDataUri: string) {
        throw upstreamFailure(`runtime rejected ${imageDataUri}`);
      },
      async isReady() {
        return true;
      },
    };
    const app = await startTestApp({ runtime: leakyRuntime });
    const dataUri = toDataUri(await makeJpeg(600, 450));

    const response = await app.post('/v1/chat/completions', chatRequest(dataUri));
    expect(response.status).toBe(502);
    // An ApiError message IS returned to the client, so it is the one place a
    // sloppily-built message would escape. The 'Request rejected' log line logs
    // only metadata, and the body carries no payload.
    expect(allObservableText(app, response.text)).not.toContain(needle(dataUri));

    await app.close();
  });

  it('never opens a file: the request path imports no fs write API', async () => {
    // A grep-shaped assertion, kept as a test so it runs with the suite rather
    // than only in a checklist. `src/pipeline/image.ts` is the only module that
    // holds decoded bytes; it must not be able to persist them.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../../src/pipeline/image.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/from 'node:fs'/);
    expect(source).not.toMatch(/writeFile|createWriteStream|appendFile/);
  });
});

describe('scrubPayloads', () => {
  it('redacts data URIs and long base64 runs, and is idempotent', () => {
    const scrubbed = scrubPayloads('failed on data:image/png;base64,AAAABBBBCCCCDDDD/+== really');
    expect(scrubbed).toBe('failed on [redacted] really');
    expect(scrubPayloads(scrubbed)).toBe(scrubbed);
  });

  it('leaves short identifiers alone', () => {
    // A key fingerprint (8 hex) and a UUID (36) must survive — they are what
    // makes a log line useful.
    const message = 'key a1b2c3d4 request 5f1c9a20-1b7e-4c31-9f0a-2d3e4f5a6b7c failed';
    expect(scrubPayloads(message)).toBe(message);
  });
});
