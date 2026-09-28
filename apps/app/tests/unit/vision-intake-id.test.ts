/**
 * The intake id and the scan count on the adapter (M253/05).
 *
 * The core counts one free scan per `X-Intake-Id` (M253/03), so the id must
 * ride on every request of one person action, both adapter retries included,
 * and must NEVER reach a provider the person configured: a custom header there
 * fails that provider's CORS preflight. A stub records what `fetch` was given.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAiCompatibleProvider, INTAKE_ID_HEADER } from '../../app/services/vision/openai-compatible';
import { photoIntakeTask } from '../../app/services/vision/task';
import { newIntakeId, TRIAL_SCANS_LEFT_HEADER } from '../../app/lib/plans/trial-scans';

const originalFetch = globalThis.fetch;

/** What one request carried. */
interface Sent {
  url: string;
  headers: Headers;
}

/** Answers each request with the next response, and records what it was sent. */
function stubFetch(responses: readonly (() => Response)[]): Sent[] {
  const sent: Sent[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), headers: new Headers(init?.headers) });
    const next = responses[Math.min(sent.length, responses.length) - 1];
    if (next === undefined) throw new Error('the stub was given no response');
    return next();
  };
  // SAFETY: `impl` has the (input, init) => Promise<Response> call signature the adapter uses;
  // the only extra member on Node's `fetch` type is `preconnect`, which the adapter never calls.
  globalThis.fetch = impl as typeof fetch;
  return sent;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A 2xx the adapter parses into one food, with the headers a test names. */
function answered(headers: Record<string, string> = {}): Response {
  const content = JSON.stringify({ items: [] });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A managed credential with a fixed bearer and the id under test. */
function managed(intakeId: string, onTrialScansLeft?: (left: number) => void) {
  return {
    getBearer: async () => 'access-1',
    refreshBearer: async () => 'access-2',
    intakeId,
    onTrialScansLeft,
  };
}

const IMAGE = { base64: 'AAAA', mimeType: 'image/png' } as const;

/** Runs one photo intake and swallows the parse outcome; these tests read the requests. */
async function scan(provider: ReturnType<typeof createOpenAiCompatibleProvider>): Promise<void> {
  await provider.runScan({ task: photoIntakeTask('en'), image: IMAGE }).catch(() => undefined);
}

describe('X-Intake-Id', () => {
  it('is sent to the managed proxy', async () => {
    const sent = stubFetch([() => answered()]);
    const id = newIntakeId();
    await scan(createOpenAiCompatibleProvider({ credential: managed(id), model: 'm', baseUrl: 'https://sync.example/v1' }));
    assert.equal(sent[0]?.headers.get(INTAKE_ID_HEADER), id);
  });

  it('is never sent to a provider the person configured', async () => {
    // THE CONTROL for the case above: the same call with a BYOK key.
    const sent = stubFetch([() => answered()]);
    await scan(createOpenAiCompatibleProvider({ credential: { apiKey: 'sk-x' }, model: 'm', baseUrl: 'https://ai.example/v1' }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.headers.has(INTAKE_ID_HEADER), false);
  });

  it('rides on the bearer retry after a 401, unchanged', async () => {
    const sent = stubFetch([() => new Response(null, { status: 401 }), () => answered()]);
    const id = newIntakeId();
    await scan(createOpenAiCompatibleProvider({ credential: managed(id), model: 'm', baseUrl: 'https://sync.example/v1' }));
    assert.deepEqual(
      sent.map((request) => request.headers.get(INTAKE_ID_HEADER)),
      [id, id],
    );
  });

  it('rides on the structured-output retry after a 400, unchanged', async () => {
    const sent = stubFetch([() => new Response(null, { status: 400 }), () => answered()]);
    const id = newIntakeId();
    await scan(createOpenAiCompatibleProvider({ credential: managed(id), model: 'm', baseUrl: 'https://sync.example/v1' }));
    assert.deepEqual(
      sent.map((request) => request.headers.get(INTAKE_ID_HEADER)),
      [id, id],
    );
  });

  it('is new for every action and fits the core\'s shape', () => {
    const first = newIntakeId();
    const second = newIntakeId();
    assert.notEqual(first, second);
    assert.match(first, /^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe('X-Trial-Scans-Left', () => {
  it('reports the count the proxy stated', async () => {
    stubFetch([() => answered({ [TRIAL_SCANS_LEFT_HEADER]: '2' })]);
    const seen: number[] = [];
    await scan(
      createOpenAiCompatibleProvider({
        credential: managed(newIntakeId(), (left) => seen.push(left)),
        model: 'm',
        baseUrl: 'https://sync.example/v1',
      }),
    );
    assert.deepEqual(seen, [2]);
  });

  it('reports the zero a refusal carries', async () => {
    stubFetch([
      () =>
        new Response(JSON.stringify({ error: 'trial-scans-spent' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', [TRIAL_SCANS_LEFT_HEADER]: '0' },
        }),
    ]);
    const seen: number[] = [];
    await scan(
      createOpenAiCompatibleProvider({
        credential: managed(newIntakeId(), (left) => seen.push(left)),
        model: 'm',
        baseUrl: 'https://sync.example/v1',
      }),
    );
    assert.deepEqual(seen, [0]);
  });

  it('reports nothing when the response carries no count', async () => {
    // THE CONTROL: an account with no scan trial gets no header.
    stubFetch([() => answered()]);
    const seen: number[] = [];
    await scan(
      createOpenAiCompatibleProvider({
        credential: managed(newIntakeId(), (left) => seen.push(left)),
        model: 'm',
        baseUrl: 'https://sync.example/v1',
      }),
    );
    assert.deepEqual(seen, []);
  });
});
