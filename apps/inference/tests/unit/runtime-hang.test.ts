/**
 * A MUTE upstream — one that completes the TCP handshake, accepts the request,
 * and then sends nothing, forever — must fail bounded and must say so.
 *
 * WHY A RAW `net` SERVER RATHER THAN THE EXPRESS FAKE. The condition under test
 * is "the socket is open and zero bytes come back", which express cannot express:
 * any express handler eventually answers. A bare socket that is never written to
 * is exactly what a misrouted URL, a proxy that swallowed the request, or a
 * wedged llama-server looks like on the wire.
 *
 * The second half is the point of the whole spec: until now this failure and an
 * instant connection refusal produced the SAME message, so an operator staring
 * at "the model runtime could not be reached" could not tell a ten-minute hang
 * from a typo'd port. The two are asserted here to be different.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createModelRuntime } from '../../src/pipeline/runtime-client.js';
import { captureApiError, captureRejection } from '../support/capture-rejection.js';

/**
 * MEASURED shape of undici's mid-body stall: the thrown error's `cause` is a
 * `TypeError('terminated')` whose own `cause` carries the undici code. Parsed
 * rather than asserted so a change in that chain fails here, loudly.
 */
const TerminatedCauseSchema = z.object({
  message: z.string(),
  cause: z.object({ code: z.string() }),
});

/** Small on purpose: the assertion is about attribution, not about waiting 600 s. */
const TEST_TIMEOUT_MS = 300;

const IMAGE = 'data:image/jpeg;base64,AAAA';

interface MuteRuntime {
  baseUrl: string;
  close(): Promise<void>;
}

/** Accepts connections, reads whatever arrives, and never writes a byte back. */
async function startMuteRuntime(): Promise<MuteRuntime> {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  // SAFETY: `listen` has already fired its callback above and this server is bound
  // to a TCP port, so `address()` is an `AddressInfo`, never `null` or a pipe name.
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let mute: MuteRuntime | null = null;

afterEach(async () => {
  await mute?.close();
  mute = null;
});

describe('a mute model runtime', () => {
  it('fails within the configured bound instead of hanging forever', async () => {
    mute = await startMuteRuntime();
    const client = createModelRuntime({
      baseUrl: mute.baseUrl,
      modelId: 'test-model',
      completionTimeoutMs: TEST_TIMEOUT_MS,
    });

    const startedAt = performance.now();
    await expect(client.identify(IMAGE)).rejects.toThrow();
    const elapsedMs = performance.now() - startedAt;

    // Generous upper bound: undici checks the timer on an interval, so the fire
    // is "shortly after", never "exactly at". The claim is boundedness.
    expect(elapsedMs).toBeLessThan(10_000);
  });

  it('names the mute case and the knob rather than the generic unreachable copy', async () => {
    mute = await startMuteRuntime();
    const client = createModelRuntime({
      baseUrl: mute.baseUrl,
      modelId: 'test-model',
      completionTimeoutMs: TEST_TIMEOUT_MS,
    });

    const error = await captureApiError(client.identify(IMAGE));

    expect(error).toBeInstanceOf(Error);
    const { message } = error;
    expect(message).toMatch(/sent nothing back/i);
    expect(message).toContain('RUNTIME_COMPLETION_TIMEOUT_MS');
    // Both remedies, per the repo's convention for actionable boot/runtime errors.
    expect(message).toMatch(/raise/i);
    expect(message).toMatch(/\b0\b/);
    expect(message).not.toMatch(/could not be reached/i);
    expect(error.status).toBe(502);
  });

  it('is distinguishable from a connection refusal', async () => {
    mute = await startMuteRuntime();
    const hangClient = createModelRuntime({
      baseUrl: mute.baseUrl,
      modelId: 'test-model',
      completionTimeoutMs: TEST_TIMEOUT_MS,
    });
    // Port 1: nothing listens, so the connect is refused immediately.
    const refusedClient = createModelRuntime({
      baseUrl: 'http://127.0.0.1:1',
      modelId: 'test-model',
      completionTimeoutMs: TEST_TIMEOUT_MS,
    });

    const hangError = await captureRejection(hangClient.identify(IMAGE));
    const refusedError = await captureRejection(refusedClient.identify(IMAGE));

    expect(refusedError.message).toMatch(/could not be reached/i);
    expect(refusedError.message).not.toContain('RUNTIME_COMPLETION_TIMEOUT_MS');
    expect(hangError.message).not.toBe(refusedError.message);
  });
});

/**
 * The OTHER half of the timeout, and the one that is easy to miss: with undici's
 * `fetch`, only `headersTimeout` rejects the `fetch()` call. `bodyTimeout` fires
 * AFTER headers have arrived, during body consumption — so it surfaces in the
 * `response.json()` catch, one `try` block further down, where the obvious
 * (wrong) diagnosis is "the body was not JSON".
 *
 * The distinction is real and worth the separate copy: this upstream DID start
 * answering, so telling the operator it "sent nothing back" would be false and
 * would point them at the wrong thing entirely.
 */
describe('a model runtime that starts answering and then stalls mid-body', () => {
  let stalling: HttpServer | null = null;

  afterEach(async () => {
    const server = stalling;
    stalling = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('is attributed to the timeout, not to a malformed body', async () => {
    stalling = createHttpServer((req, res) => {
      req.resume();
      // Headers and a partial body land immediately — the `fetch()` call
      // RESOLVES. Then nothing, and `res.end()` never comes.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"choices":[{"message":{"content":"');
    });
    // `destroy()` on close would strand the open socket otherwise.
    stalling.on('connection', (socket) => socket.unref());
    await new Promise<void>((resolve) => stalling!.listen(0, '127.0.0.1', () => resolve()));
    // SAFETY: `listen` has already fired its callback above and this server is bound
    // to a TCP port, so `address()` is an `AddressInfo`, never `null` or a pipe name.
    const { port } = stalling.address() as AddressInfo;

    const client = createModelRuntime({
      baseUrl: `http://127.0.0.1:${port}`,
      modelId: 'test-model',
      completionTimeoutMs: TEST_TIMEOUT_MS,
    });

    const error = await captureRejection(client.identify(IMAGE));

    expect(error.message).toContain('RUNTIME_COMPLETION_TIMEOUT_MS');
    expect(error.message).toMatch(/stalled/i);
    expect(error.message).not.toMatch(/not JSON/i);
    // It must not be mistaken for the mute case either: this upstream DID answer.
    expect(error.message).not.toMatch(/sent nothing back/i);

    // MEASURED: `fetch()` resolves 200 here and the stall surfaces later as
    // `TypeError: terminated` — an opaque symptom the caller can do nothing
    // with. Pinned as the cause so a future refactor cannot quietly start
    // classifying a genuinely malformed body as a timeout.
    const cause = TerminatedCauseSchema.parse(error.cause);
    expect(cause.message).toBe('terminated');
    expect(cause.cause.code).toBe('UND_ERR_BODY_TIMEOUT');
  }, 20_000);
});
