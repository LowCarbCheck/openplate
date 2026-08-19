/**
 * `SyncHttpClient` — the blob/key-record transport.
 *
 * Spec 01's review flagged this as the one engine module with zero coverage,
 * and it is exactly the module where a silent bug is expensive: a mis-encoded
 * `ciphertext` or a swallowed `409` does not throw, it corrupts or strands
 * someone's only copy of their diary.
 *
 * `fetchImpl` is injected throughout, so these run with no server and no
 * network. What is asserted is the CONTRACT (`PROTOCOL.md` §5.1–§5.5): what
 * goes on the wire, what a `409` means, what a `404` means, and the
 * refresh-once-retry-once rule of §11.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { SyncHttpClient } from '../../../app/lib/sync/engine/client/http-client';
import { SYNC_API_PREFIX } from '../../../app/lib/sync/engine/protocol';
import type {
  ListKeyRecordsResponse,
  ProtocolErrorResponse,
  PullBlobResponse,
  PushBlobAcceptedResponse,
  PushBlobConflictResponse,
  PutKeyRecordConflictResponse,
  KeyRecordWire,
} from '../../../app/lib/sync/engine/protocol';
import { SyncRequestError } from '../../../app/lib/sync/engine/client/sync-error';

const BASE_URL = 'https://sync.example.test';

interface CapturedRequest {
  url: string;
  method: string;
  /** Normalized through `Headers`, exactly as `fetch` would — so the names are lower-cased. */
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(handler: (request: CapturedRequest) => Response) {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const sent = init?.body;
    const captured: CapturedRequest = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: sent === undefined || sent === null ? undefined : JSON.parse(String(sent)),
    };
    requests.push(captured);
    return handler(captured);
  };
  return { fetchImpl, requests };
}

/** Every JSON document the stub can answer with — the protocol's own response types. */
type StubResponseBody =
  | PushBlobAcceptedResponse
  | PushBlobConflictResponse
  | PullBlobResponse
  | ListKeyRecordsResponse
  | KeyRecordWire
  | PutKeyRecordConflictResponse
  | ProtocolErrorResponse;

/** A captured request body, back from JSON with no claim yet about its fields. */
const capturedBodySchema = z.record(z.string(), z.unknown());

function json(body: StubResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const transportFailureFetch: typeof fetch = async () => {
  throw new TypeError('Failed to fetch');
};

const STATIC_TOKENS = { getAccessToken: () => 'access-token', refreshAccessToken: async () => null };

const KDF_DESCRIPTOR = { salt: 'x', params: { memorySizeKib: 8, iterations: 1, parallelism: 1 } };

test('pushBlob base64-encodes the ciphertext and sends the CAS baseVersion', async () => {
  const { fetchImpl, requests } = stubFetch(() => json({ newVersion: 4 }));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  const result = await client.pushBlob({
    baseVersion: 3,
    envelopeVersion: 1,
    ciphertext: new Uint8Array([0, 1, 250, 255]),
  });

  assert.deepEqual(result, { status: 'accepted', newVersion: 4 });
  const request = requests[0];
  assert.equal(request?.url, `${BASE_URL}${SYNC_API_PREFIX}/blob`);
  assert.equal(request?.method, 'POST');
  assert.deepEqual(request?.body, { baseVersion: 3, envelopeVersion: 1, ciphertext: 'AAH6/w==' });
});

test('a trailing slash on the base URL never produces a double slash in the path', async () => {
  const { fetchImpl, requests } = stubFetch(() => json({ newVersion: 1 }));
  const client = new SyncHttpClient({ baseUrl: `${BASE_URL}/`, tokens: STATIC_TOKENS, fetchImpl });

  await client.pushBlob({ baseVersion: 0, envelopeVersion: 1, ciphertext: new Uint8Array([1]) });

  assert.equal(requests[0]?.url, `${BASE_URL}${SYNC_API_PREFIX}/blob`);
});

test('a 409 push is RETURNED as a conflict, never thrown — the CAS loop depends on it', async () => {
  const { fetchImpl } = stubFetch(() => json({ currentVersion: 9 }, 409));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  const result = await client.pushBlob({ baseVersion: 3, envelopeVersion: 1, ciphertext: new Uint8Array([1]) });

  assert.deepEqual(result, { status: 'conflict', currentVersion: 9 });
});

test('a 413 push throws a too-large error carrying the status', async () => {
  const { fetchImpl } = stubFetch(() => json({ error: 'blob too large' }, 413));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  await assert.rejects(
    () => client.pushBlob({ baseVersion: 0, envelopeVersion: 1, ciphertext: new Uint8Array([1]) }),
    (error) => error instanceof SyncRequestError && error.kind === 'too-large' && error.status === 413,
  );
});

test('pullBlob decodes the base64 ciphertext back to the exact bytes', async () => {
  const { fetchImpl } = stubFetch(() =>
    json({ blobVersion: 7, envelopeVersion: 1, ciphertext: 'AAH6/w==', createdAt: '2026-08-04T10:00:00.000Z' }),
  );
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  const pulled = await client.pullBlob();

  assert.equal(pulled?.blobVersion, 7);
  assert.deepEqual(pulled?.ciphertext, new Uint8Array([0, 1, 250, 255]));
});

test('pullBlob returns null on 404 — a fresh account, not an error', async () => {
  const { fetchImpl } = stubFetch(() => json({ error: 'no blob' }, 404));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  assert.equal(await client.pullBlob(), null);
});

test('every request carries the bearer token and no cookies', async () => {
  const { fetchImpl, requests } = stubFetch(() => json({ records: [] }));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  await client.listKeyRecords();

  assert.equal(requests[0]?.headers.authorization, 'Bearer access-token');
  // `credentials: 'include'` would defeat the CSRF property the wide-open CORS
  // policy relies on (`PROTOCOL.md` §4.1).
  assert.equal('credentials' in (requests[0] ?? {}), false);
});

test('a 401 refreshes ONCE and retries ONCE with the new token', async () => {
  let refreshCount = 0;
  const tokens = {
    getAccessToken: () => 'stale-token',
    refreshAccessToken: async () => {
      refreshCount += 1;
      return 'fresh-token';
    },
  };
  const { fetchImpl, requests } = stubFetch((request) =>
    request.headers.authorization === 'Bearer fresh-token' ? json({ records: [] }) : json({ error: 'nope' }, 401),
  );
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens, fetchImpl });

  assert.deepEqual(await client.listKeyRecords(), []);
  assert.equal(refreshCount, 1);
  assert.equal(requests.length, 2);
});

test('a second 401 gives up rather than looping — the user must sign in again', async () => {
  const tokens = { getAccessToken: () => 'stale', refreshAccessToken: async () => 'also-stale' };
  const { fetchImpl, requests } = stubFetch(() => json({ error: 'nope' }, 401));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens, fetchImpl });

  await assert.rejects(
    () => client.listKeyRecords(),
    (error) => error instanceof SyncRequestError && error.kind === 'unauthorized',
  );
  assert.equal(requests.length, 2);
});

test('a refresh that returns null skips the retry entirely', async () => {
  const tokens = { getAccessToken: () => 'stale', refreshAccessToken: async () => null };
  const { fetchImpl, requests } = stubFetch(() => json({ error: 'nope' }, 401));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens, fetchImpl });

  await assert.rejects(() => client.listKeyRecords());
  assert.equal(requests.length, 1);
});

test('putKeyRecord always sends expectedUpdatedAt, including the explicit null', async () => {
  const { fetchImpl, requests } = stubFetch(() =>
    json({
      kind: 'passphrase',
      kdfDescriptor: KDF_DESCRIPTOR,
      wrappedDek: 'AQ==',
      updatedAt: '2026-08-04T10:00:00.000Z',
    }),
  );
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  const result = await client.putKeyRecord({
    kind: 'passphrase',
    kdfDescriptor: KDF_DESCRIPTOR,
    wrappedDek: new Uint8Array([1]),
    expectedUpdatedAt: null,
  });

  assert.equal(result.status, 'accepted');
  assert.equal(requests[0]?.url, `${BASE_URL}${SYNC_API_PREFIX}/key-records/passphrase`);
  assert.equal(requests[0]?.method, 'PUT');
  // Present, and present as `null` — an ABSENT key is a 400 by design, so that
  // no caller can skip the concurrency check by forgetting a field.
  const putBody = capturedBodySchema.parse(requests[0]?.body);
  assert.equal(Object.hasOwn(putBody, 'expectedUpdatedAt'), true);
  assert.equal(putBody.expectedUpdatedAt, null);
});

test('a key-record 409 is returned as a conflict with the current CAS token', async () => {
  const { fetchImpl } = stubFetch(() => json({ currentUpdatedAt: '2026-08-04T09:00:00.000Z' }, 409));
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });

  const result = await client.putKeyRecord({
    kind: 'recovery',
    kdfDescriptor: null,
    wrappedDek: new Uint8Array([1]),
    expectedUpdatedAt: null,
  });

  assert.deepEqual(result, { status: 'conflict', currentUpdatedAt: '2026-08-04T09:00:00.000Z' });
});

test('a network failure surfaces as a transport error, distinct from any HTTP status', async () => {
  const client = new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl: transportFailureFetch });

  await assert.rejects(
    () => client.pullBlob(),
    (error) => error instanceof SyncRequestError && error.kind === 'transport' && error.status === null,
  );
});
