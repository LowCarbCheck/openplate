/**
 * A SLOW BUT CORRECT runtime must succeed. Slow-and-local is the product; the
 * completion bound is a liveness backstop, not a latency policy.
 *
 * WHY THIS TEST IS NOT VACUOUS. "A request succeeded against the default config"
 * proves nothing on its own — nothing was slow enough to trip anything, and the
 * test would pass just as happily if the configured value never reached the
 * dispatcher at all. So the SAME slow server is hit three ways: a bound shorter
 * than the delay must fail (which is what proves the number is wired through),
 * while the default and the explicit `0` must both succeed.
 *
 * The delay is deliberately far below the 300 s ambient default this spec exists
 * to replace, because the point being proved is the wiring, not the size.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModelRuntime } from '../../src/pipeline/runtime-client.js';
import { captureRejection } from '../support/capture-rejection.js';

/**
 * Long enough to outlast `SHORT_BOUND_MS` by a wide margin, short enough to run.
 *
 * MEASURED: undici's timer wheel has roughly 1 s granularity, so a sub-second
 * bound fires at ~1 s, not at the configured instant. At 700 ms this file passed
 * two of three tests and the discriminating one silently SUCCEEDED — the response
 * beat the timer. Anything at or below ~1.5 s here makes this suite a coin flip.
 */
const SLOW_RESPONSE_MS = 2500;

/** Shorter than the server's delay: the discriminating case. */
const SHORT_BOUND_MS = 250;

const IMAGE = 'data:image/jpeg;base64,AAAA';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'slow-completion',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({ f: [{ n: 'grilled chicken breast', g: 140 }] }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 512, completion_tokens: 42 },
          }),
        );
      }, SLOW_RESPONSE_MS);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  // SAFETY: `listen` has already fired its callback above and this server is bound
  // to a TCP port, so `address()` is an `AddressInfo`, never `null` or a pipe name.
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('a slow but correct model runtime', () => {
  it('succeeds under the default bound', async () => {
    const client = createModelRuntime({ baseUrl, modelId: 'test-model' });

    const completion = await client.identify(IMAGE);

    expect(completion.candidate.f).toHaveLength(1);
    expect(completion.latencyMs).toBeGreaterThanOrEqual(SLOW_RESPONSE_MS - 100);
  });

  it('succeeds with the bound disabled (0)', async () => {
    const client = createModelRuntime({ baseUrl, modelId: 'test-model', completionTimeoutMs: 0 });

    const completion = await client.identify(IMAGE);

    expect(completion.candidate.f).toHaveLength(1);
  });

  it('fails when the configured bound is shorter than the generation — proving the value reaches the dispatcher', async () => {
    const client = createModelRuntime({
      baseUrl,
      modelId: 'test-model',
      completionTimeoutMs: SHORT_BOUND_MS,
    });

    const error = await captureRejection(client.identify(IMAGE));

    expect(error.message).toContain('RUNTIME_COMPLETION_TIMEOUT_MS');
  });
});
