/**
 * That the sync clients call `fetch` with a receiver the browser accepts.
 *
 * ── The bug ──────────────────────────────────────────────────────────────
 *
 * `fetch` is a WebIDL operation on `Window` and brand-checks its receiver.
 * WebIDL substitutes the global for a `null`/`undefined` `this` — which is why
 * a plain `fetch(url)` works — but rejects anything else:
 *
 *     TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * Both sync clients store their fetch and call it as `this.fetchImpl(url)`, a
 * METHOD call whose receiver is the client instance. With `fetchImpl = fetch`
 * as the default, that is the forbidden case, and in Chrome EVERY request
 * threw before leaving the page. The error mapping rendered it as "The sync
 * server could not be reached", so it read as a network problem for two
 * rounds of debugging.
 *
 * ── Why Node's suites all passed, and how this one doesn't ──────────────
 *
 * Node's `fetch` has no brand check, so the buggy call is perfectly fine
 * there — no test in this repo could fail on it. The guard below therefore
 * installs a `globalThis.fetch` that ENFORCES THE WEBIDL RULE, and drives each
 * client through its DEFAULT fetch path (no `fetchImpl` override — that
 * override is what every other test uses, and it is exactly what hid this).
 *
 * This is a simulation of Chrome's check, not Chrome. It cannot catch a
 * browser-specific rule we have not modelled. It does catch this bug — the
 * whole file fails against a bare `= fetch` default, which was verified by
 * reverting — and any future client that reintroduces the pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncAuthClient } from '../../../app/lib/sync/engine/client/auth-client';
import { SyncHttpClient } from '../../../app/lib/sync/engine/client/http-client';
import { defaultFetchImpl } from '../../../app/lib/sync/engine/client/fetch-impl';
import type {
  ProtocolErrorResponse,
  ProtocolHandshake,
  PushBlobAcceptedResponse,
} from '../../../app/lib/sync/engine/protocol';

const BASE_URL = 'https://sync.example.test';
const TOKENS = { getAccessToken: () => 'token', refreshAccessToken: async () => null };

/** An object that keeps a fetch as a property and calls it as a method — the receiver WebIDL rejects. */
interface FetchHolder {
  fetchImpl: typeof fetch;
}

/**
 * Every receiver a strict-mode call can supply here: nothing (WebIDL substitutes
 * the global for it), the global itself, or a {@link FetchHolder}.
 */
type FetchReceiver = typeof globalThis | FetchHolder | null | undefined;

/** A payload the test reads straight back; it never crosses a protocol parser. */
interface ProbeResponse {
  ok?: boolean;
  replaced?: boolean;
}

type StubResponseBody = ProtocolHandshake | ProtocolErrorResponse | PushBlobAcceptedResponse | ProbeResponse;

const transportFailureFetch: typeof fetch = async () => {
  throw new TypeError('Failed to fetch');
};

/**
 * Replaces `globalThis.fetch` with one that applies WebIDL's receiver rule,
 * exactly as a browser does. Returns a restore function and the call log.
 */
function installBrandCheckedFetch(respond: () => Response) {
  const original = globalThis.fetch;
  const calls: string[] = [];

  // A `function` (not an arrow) so it observes its own receiver, and the
  // module is strict mode so an unbound call gives `this === undefined`.
  const brandChecked = async function (this: FetchReceiver, input: string | URL | Request): Promise<Response> {
    if (this !== undefined && this !== null && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    calls.push(String(input));
    return respond();
  };

  globalThis.fetch = brandChecked;
  return { restore: () => void (globalThis.fetch = original), calls };
}

function json(body: StubResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('the shared default calls fetch with a receiver WebIDL accepts', async () => {
  const { restore, calls } = installBrandCheckedFetch(() => json({ ok: true }));
  try {
    // Called as a PROPERTY, which is how both clients invoke it — the exact
    // shape that made a bare `= fetch` default throw.
    const holder: FetchHolder = { fetchImpl: defaultFetchImpl };
    await holder.fetchImpl(`${BASE_URL}/health`);
    assert.deepEqual(calls, [`${BASE_URL}/health`]);
  } finally {
    restore();
  }
});

test('the default resolves globalThis.fetch at CALL time, not at module load', async () => {
  // `.bind(globalThis)` at module scope would have captured the original and
  // ignored this replacement — the property that makes test hooks and
  // mock-service workers keep working.
  const { restore, calls } = installBrandCheckedFetch(() => json({ replaced: true }));
  try {
    const response = await defaultFetchImpl(`${BASE_URL}/health`);
    assert.deepEqual(await response.json(), { replaced: true });
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test('SyncAuthClient handshakes through its DEFAULT fetch without losing the receiver', async () => {
  const { restore, calls } = installBrandCheckedFetch(() =>
    json({ protocolVersion: 1, envelopeVersion: 1, serviceVersion: 'test' }),
  );
  try {
    // No `fetchImpl` — that override is what every other test passes, and it
    // is precisely what hid this bug from the entire suite.
    const client = new SyncAuthClient({ baseUrl: BASE_URL });
    const compatibility = await client.handshake();

    assert.equal(
      compatibility.status,
      'compatible',
      'an Illegal invocation here is swallowed by the handshake catch and reported as "could not be reached"',
    );
    assert.deepEqual(calls, [`${BASE_URL}/health`]);
  } finally {
    restore();
  }
});

test('a genuinely unreachable service is still reported as incompatible', async () => {
  // The counterpart to the test above: the handshake must keep failing closed
  // for a real network failure. Fixing the receiver must not silence that.
  const original = globalThis.fetch;
  globalThis.fetch = transportFailureFetch;
  try {
    const result = await new SyncAuthClient({ baseUrl: BASE_URL }).handshake();
    assert.equal(result.status, 'incompatible');
  } finally {
    globalThis.fetch = original;
  }
});

test('SyncHttpClient pulls through its DEFAULT fetch without losing the receiver', async () => {
  const { restore, calls } = installBrandCheckedFetch(() => json({ error: 'no blob' }, 404));
  try {
    const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: TOKENS });

    // A 404 pull is "fresh account", not an error — so reaching this assertion
    // at all proves the request was actually issued.
    assert.equal(await client.pullBlob(), null);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test('SyncHttpClient pushes through its DEFAULT fetch without losing the receiver', async () => {
  const { restore } = installBrandCheckedFetch(() => json({ newVersion: 1 }));
  try {
    const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: TOKENS });
    const result = await client.pushBlob({ baseVersion: 0, envelopeVersion: 1, ciphertext: new Uint8Array([1]) });

    assert.deepEqual(result, { status: 'accepted', newVersion: 1 });
  } finally {
    restore();
  }
});

test('an explicitly injected fetchImpl is still honoured', async () => {
  // The default must not shadow the injection seam the whole test suite and
  // the integration harness depend on.
  let wasCalled = false;
  const injected: typeof fetch = async () => {
    wasCalled = true;
    return json({ error: 'no blob' }, 404);
  };

  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: TOKENS, fetchImpl: injected });
  assert.equal(await client.pullBlob(), null);
  assert.equal(wasCalled, true);
});
