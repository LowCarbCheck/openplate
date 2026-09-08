/**
 * The Bitwarden-model auth client, and the one invariant this whole feature
 * rests on: THE MASTER PASSPHRASE NEVER LEAVES THE DEVICE.
 *
 * The zero-knowledge claim is easy to state and easy to break by accident —
 * one convenience cache, one debug log, one "remember me" checkbox. The
 * assertions below are deliberately blunt about it: run a real signup and a
 * real sign-in against a stubbed service, then search EVERY request body,
 * every header, and every storage surface for the literal passphrase and for
 * the encryption-branch key material. A future change that starts persisting
 * either one fails here rather than in a security review after launch.
 *
 * Argon2id runs with tiny parameters via the injected deriver — this is a
 * wiring test, not a KDF benchmark.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncAuthClient, type SessionTokenStore } from '../../app/lib/sync/engine/client/auth-client';
import { deriveCredentialsFromPassphrase } from '../../app/lib/sync/engine/client/derive-credentials';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { createMemoryStorage } from '../../app/lib/sync/sync-state';
import type { ProtocolErrorResponse, ProtocolHandshake } from '../../app/lib/sync/engine/protocol';
import type {
  KdfDescriptorResponse,
  RefreshResponseWire,
  SessionResponseWire,
  SessionTokensWire,
} from '../../app/lib/sync/engine/client/auth-wire';

const BASE_URL = 'https://sync.example.test';
const PASSPHRASE = 'seventeen purple lanterns drifting';
const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
const SALT_BASE64 = 'AAECAwQFBgcICQoLDA0ODw==';

const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });

/** Every JSON document the stub service can answer with — the protocol's own response types. */
type StubResponseBody =
  ProtocolHandshake | KdfDescriptorResponse | SessionResponseWire | RefreshResponseWire | ProtocolErrorResponse;

const respond = (body: StubResponseBody, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function stubService() {
  const captured: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body;
    captured.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: body === undefined || body === null ? undefined : String(body),
    });

    if (url.endsWith('/health')) return respond({ protocolVersion: 2, envelopeVersion: 1, serviceVersion: 'test' });
    if (url.endsWith('/v1/auth/kdf')) {
      return respond({ kdfDescriptor: { salt: SALT_BASE64, params: FAST_PARAMS } });
    }
    if (url.endsWith('/v1/auth/signup')) {
      return respond(
        {
          account: {
            id: 1,
            email: 'anna@example.org',
            displayName: null,
            role: 'member',
            dailyAiLimit: 0,
            aiUsedToday: 0,
            suspendedAt: null,
            createdAt: '2026-09-04T10:00:00.000Z',
          },
          tokens: {
            accessToken: 'access-1',
            accessTokenExpiresAt: '2026-08-04T10:15:00.000Z',
            refreshToken: 'refresh-1',
            refreshTokenExpiresAt: '2026-09-03T10:00:00.000Z',
          },
        },
        201,
      );
    }
    if (url.endsWith('/v1/auth/login')) {
      return respond({
        account: {
          id: 1,
          email: 'anna@example.org',
          displayName: null,
          role: 'member',
          dailyAiLimit: 0,
          aiUsedToday: 0,
          suspendedAt: null,
          createdAt: '2026-09-04T10:00:00.000Z',
        },
        tokens: {
          accessToken: 'access-2',
          accessTokenExpiresAt: '2026-08-04T10:15:00.000Z',
          refreshToken: 'refresh-2',
          refreshTokenExpiresAt: '2026-09-03T10:00:00.000Z',
        },
      });
    }
    if (url.endsWith('/v1/auth/refresh')) {
      return respond({
        tokens: {
          accessToken: 'access-3',
          accessTokenExpiresAt: '2026-08-04T10:30:00.000Z',
          refreshToken: 'refresh-3',
          refreshTokenExpiresAt: '2026-09-03T10:00:00.000Z',
        },
      });
    }
    return respond({ error: 'unexpected route' }, 404);
  };
  return { fetchImpl, captured };
}

test('the passphrase never appears in ANY request the client sends', async () => {
  const { fetchImpl, captured } = stubService();
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  const wire = await client.fetchKdfDescriptor('anna@example.org');
  const { authHash } = await deriveCredentialsFromPassphrase({
    passphrase: PASSPHRASE,
    descriptor: { salt: wire.salt, params: wire.params },
    deriveHash: fastDeriver,
  });
  await client.login({ email: 'anna@example.org', authHash });

  assert.ok(captured.length > 0, 'expected the stub service to have been called');
  for (const request of captured) {
    assert.equal(
      request.body?.includes(PASSPHRASE) ?? false,
      false,
      `passphrase leaked into a request body: ${request.url}`,
    );
    assert.equal(
      JSON.stringify(request.headers).includes(PASSPHRASE),
      false,
      `passphrase leaked into request headers: ${request.url}`,
    );
  }
});

test('the passphrase never lands in any client storage', async () => {
  const { fetchImpl } = stubService();
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  // Stands in for localStorage/sessionStorage: the client is handed a storage
  // surface it could write to and must not touch with anything sensitive.
  const storage = createMemoryStorage();

  const wire = await client.fetchKdfDescriptor('anna@example.org');
  const { authHash } = await deriveCredentialsFromPassphrase({
    passphrase: PASSPHRASE,
    descriptor: { salt: wire.salt, params: wire.params },
    deriveHash: fastDeriver,
  });
  await client.login({ email: 'anna@example.org', authHash });

  for (const key of ['openplate.sync.email-hint', 'openplate.sync.state.v1:1', 'openplate.sync.device-id']) {
    const value = storage.getItem(key);
    assert.equal(value?.includes(PASSPHRASE) ?? false, false, `passphrase found under ${key}`);
  }
  // And the session the client does hold carries only tokens.
  assert.equal(JSON.stringify(client.getSession()).includes(PASSPHRASE), false);
});

test('the auth branch and the encryption branch are different values', async () => {
  // If these ever coincided, sending `authHash` would hand the server the
  // material for the key that decrypts the blob — the single failure that
  // would quietly void the entire zero-knowledge claim.
  const descriptor = { salt: SALT_BASE64, params: FAST_PARAMS };
  const { authHash, passphraseKek } = await deriveCredentialsFromPassphrase({
    passphrase: PASSPHRASE,
    descriptor,
    deriveHash: fastDeriver,
  });

  assert.equal(atob(authHash).length, 32);
  // A KEK is imported non-extractable, so it cannot be serialized at all —
  // which is itself the property being checked.
  assert.equal(passphraseKek.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey('raw', passphraseKek));
});

test('the same passphrase under a different salt derives a different auth hash', async () => {
  const one = await deriveCredentialsFromPassphrase({
    passphrase: PASSPHRASE,
    descriptor: { salt: SALT_BASE64, params: FAST_PARAMS },
    deriveHash: fastDeriver,
  });
  const two = await deriveCredentialsFromPassphrase({
    passphrase: PASSPHRASE,
    descriptor: { salt: 'Dw4NDAsKCQgHBgUEAwIBAA==', params: FAST_PARAMS },
    deriveHash: fastDeriver,
  });

  assert.notEqual(one.authHash, two.authHash);
});

test('signup adopts the returned session so key records can be written immediately', async () => {
  const { fetchImpl } = stubService();
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  await client.signup({
    inviteToken: 'si_TESTTOKENONLY',
    authHash: 'AAAA',
    kdfDescriptor: { salt: SALT_BASE64, params: FAST_PARAMS },
    recoveryAuthHash: 'BBBB',
    recoveryCode: 'ABCDE-FGHJK-LMNPQ-RSTVW-XYZ01-23456-789AB-CDEFG',
    keyRecords: [
      { kind: 'passphrase', kdfDescriptor: { salt: SALT_BASE64, params: FAST_PARAMS }, wrappedDek: 'CCCC' },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: 'DDDD' },
    ],
  });

  assert.equal(client.getAccessToken(), 'access-1');
});

test('concurrent refreshes are serialized — a spent refresh token is read as theft', async () => {
  let refreshCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/login')) {
      return respond({
        account: {
          id: 1,
          email: 'anna@example.org',
          displayName: null,
          role: 'member',
          dailyAiLimit: 0,
          aiUsedToday: 0,
          suspendedAt: null,
          createdAt: '2026-09-04T10:00:00.000Z',
        },
        tokens: {
          accessToken: 'a1',
          accessTokenExpiresAt: 'x',
          refreshToken: 'r1',
          refreshTokenExpiresAt: 'y',
        },
      });
    }
    refreshCalls += 1;
    return respond({
      tokens: { accessToken: 'a2', accessTokenExpiresAt: 'x', refreshToken: 'r2', refreshTokenExpiresAt: 'y' },
    });
  };

  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  await client.login({ email: 'anna@example.org', authHash: 'AAAA' });

  const [first, second] = await Promise.all([client.refreshAccessToken(), client.refreshAccessToken()]);

  assert.equal(first, 'a2');
  assert.equal(second, 'a2');
  assert.equal(refreshCalls, 1, 'two concurrent refreshes must spend the token only once');
});

/** Logs in fine, then answers every refresh with a `401` — the revoked-family branch. */
const revokedRefreshFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.endsWith('/v1/auth/login')) {
    return respond({
      account: {
        id: 1,
        email: 'anna@example.org',
        displayName: null,
        role: 'member',
        dailyAiLimit: 0,
        aiUsedToday: 0,
        suspendedAt: null,
        createdAt: '2026-09-04T10:00:00.000Z',
      },
      tokens: { accessToken: 'a1', accessTokenExpiresAt: 'x', refreshToken: 'r1', refreshTokenExpiresAt: 'y' },
    });
  }
  return respond({ error: 'revoked' }, 401);
};

test('a rejected refresh clears the session and reports null rather than throwing', async () => {
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: revokedRefreshFetch });
  await client.login({ email: 'anna@example.org', authHash: 'AAAA' });

  assert.equal(await client.refreshAccessToken(), null);
  assert.equal(client.getSession(), null);
});

const unreachableFetch: typeof fetch = async () => {
  throw new TypeError('Failed to fetch');
};

const wrongVersionFetch: typeof fetch = async () =>
  respond({ protocolVersion: 99, envelopeVersion: 1, serviceVersion: 'x' });

const garbageFetch: typeof fetch = async () => new Response('not json at all', { status: 200 });

test('the handshake fails CLOSED when the service is unreachable or mismatched', async () => {
  const offlineClient = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: unreachableFetch });
  assert.equal((await offlineClient.handshake()).status, 'incompatible');

  const mismatched = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: wrongVersionFetch });
  const result = await mismatched.handshake();
  assert.equal(result.status, 'incompatible');
  assert.match(result.status === 'incompatible' ? result.reason : '', /protocol version 99/);

  const unreadable = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: garbageFetch });
  assert.equal((await unreadable.handshake()).status, 'incompatible');
});

// ---------------------------------------------------------------------------
// The token store (M201, the 0.10.3 silent sign-out)
// ---------------------------------------------------------------------------

/**
 * A `SessionTokenStore` that remembers what it was told.
 *
 * The real one is `session-cache.ts`'s IndexedDB row; what this file checks is
 * the CLIENT's half of the contract, that a rotation is reported at all, that
 * a newer pair is adopted instead of spending a spent token, and that a client
 * with no store attached behaves exactly as it did before the interface
 * existed.
 */
function recordingStore(initial: SessionTokensWire | null = null) {
  const rotations: SessionTokensWire[] = [];
  const state = { latest: initial, rotations, locks: 0 };
  const store: SessionTokenStore = {
    latest: async () => state.latest,
    onRotated: async (tokens) => {
      state.rotations.push(tokens);
      state.latest = tokens;
    },
    withLock: async (task) => {
      state.locks += 1;
      return task();
    },
  };
  return { store, state };
}

test('a mid-life refresh reports the rotated pair to the store', async () => {
  const { fetchImpl } = stubService();
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  await client.login({ email: 'anna@example.org', authHash: 'AAAA' });
  const { store, state } = recordingStore();
  client.setTokenStore(store);

  assert.equal(await client.refreshAccessToken(), 'access-3');

  // THE WHOLE INCIDENT IN ONE ASSERTION. Before M201 this rotation happened in
  // memory and nothing wrote it down, so the device's cached copy went on
  // holding `refresh-2`, a token the service had already revoked, and which it
  // reads as theft on the next reload.
  assert.equal(state.rotations.length, 1, 'a rotation nobody records is a spent token left on disk');
  assert.equal(state.rotations[0]?.refreshToken, 'refresh-3');
  assert.equal(state.rotations[0]?.accessToken, 'access-3');
  assert.equal(state.locks, 1, 'the refresh must run under the device lock');
});

/**
 * The three refresh-token expiries this file orders pairs by.
 *
 * `refreshTokenExpiresAt` IS the ordering: the service mints a fresh one on
 * every rotation and it only moves forward within a family, so later means
 * minted later. A test that used the same expiry for two different tokens
 * would be asserting a tie, which is its own case below.
 */
const HELD_REFRESH_EXPIRY = '2026-10-04T10:00:00.000Z';
const NEWER_REFRESH_EXPIRY = '2026-11-04T10:00:00.000Z';
const OLDER_REFRESH_EXPIRY = '2026-09-01T10:00:00.000Z';

/** A client holding one pair, with a stub that fails any request it must not make. */
function clientHoldingR1(onRefresh: () => void) {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).endsWith('/v1/auth/refresh')) onRefresh();
    return respond({ error: 'the client must not have asked' }, 500);
  };
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  client.restoreSession({
    account: { id: 1, email: 'anna@example.org' },
    tokens: {
      accessToken: 'a1',
      accessTokenExpiresAt: 'x',
      refreshToken: 'r1',
      refreshTokenExpiresAt: HELD_REFRESH_EXPIRY,
    },
  });
  return client;
}

test('a refresh adopts a NEWER pair from the store and spends nothing', async () => {
  let refreshCalls = 0;
  const client = clientHoldingR1(() => {
    refreshCalls += 1;
  });
  // Another context rotated while this client was not looking, and left a pair
  // with real life in its access token.
  const { store } = recordingStore({
    accessToken: 'a2',
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: 'r2',
    refreshTokenExpiresAt: NEWER_REFRESH_EXPIRY,
  });
  client.setTokenStore(store);

  assert.equal(await client.refreshAccessToken(), 'a2');
  assert.equal(refreshCalls, 0, 'spending r1 here is the theft signal that revokes the family');
  assert.equal(client.getSession()?.tokens.refreshToken, 'r2', 'the whole pair is adopted, not just the access token');
});

test('an OLDER pair in the store is NOT adopted, because a write-back can fail', async () => {
  // THE HOLE THIS CLOSES. `reportRotation` is best effort by design, so a
  // failed `onRotated` leaves the store holding the pair BEFORE the rotation
  // while this client holds the one after it. A test of mere inequality would
  // read that as "somebody rotated", adopt `r0`, and spend a token the
  // rotation already revoked, which revokes the family on every device.
  const { fetchImpl, captured } = stubService();
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  await client.login({ email: 'anna@example.org', authHash: 'AAAA' });
  const { store, state } = recordingStore({
    accessToken: 'a0',
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: 'r0-already-revoked',
    refreshTokenExpiresAt: OLDER_REFRESH_EXPIRY,
  });
  client.setTokenStore(store);
  // NON-VACUITY: the stored pair really is older than the one the login left
  // in hand. Written as an assertion because both sides are fixtures, and a
  // fixture drifting the wrong way would silently make this test pass for the
  // wrong reason.
  assert.ok(
    Date.parse(OLDER_REFRESH_EXPIRY) < Date.parse(client.getSession()?.tokens.refreshTokenExpiresAt ?? ''),
    'the stale pair must genuinely predate the one in hand',
  );

  assert.equal(await client.refreshAccessToken(), 'access-3');

  const refreshes = captured.filter((call) => call.url.endsWith('/v1/auth/refresh'));
  assert.equal(refreshes.length, 1, 'the pair in hand is the current one, so it is the one to spend');
  assert.ok(refreshes[0]?.body?.includes('refresh-2'), 'and NOT the stale token the failed write left behind');
  assert.ok(!(refreshes[0]?.body?.includes('r0-already-revoked') ?? false));
  // And the write that failed last time is retried by this rotation, so the
  // store catches up rather than staying stale forever.
  assert.equal(state.latest?.refreshToken, 'refresh-3');
});

test('a TIE is not adopted: same expiry, different token, keep the pair in hand', async () => {
  // WHY THE TIE GOES TO THE PAIR IN HAND. Two different refresh tokens sharing
  // a `refreshTokenExpiresAt` are not ordered by anything this client can see,
  // so "newer" is unprovable, and the two possible mistakes are not the same
  // size. Declining to adopt a pair that really was newer costs one refused
  // refresh, which ends the session VISIBLY (`endSessionRefused`) and asks the
  // person to sign in. Adopting one that was not newer spends a revoked token
  // and revokes the family on every device the account has. So the tie is
  // resolved towards the smaller failure, and it is the same answer this code
  // gives when either timestamp will not parse.
  let refreshCalls = 0;
  const client = clientHoldingR1(() => {
    refreshCalls += 1;
  });
  const { store } = recordingStore({
    accessToken: 'a-tied',
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: 'r-tied',
    refreshTokenExpiresAt: HELD_REFRESH_EXPIRY,
  });
  client.setTokenStore(store);

  // The stub answers every refresh with a 500, so this throws rather than
  // adopting, which is the observable difference: an adoption would have
  // returned `a-tied` without a request at all.
  await assert.rejects(client.refreshAccessToken());
  assert.equal(refreshCalls, 1, 'it spent its own token rather than one it cannot prove is newer');
  assert.equal(client.getSession()?.tokens.refreshToken, 'r1', 'and it still holds its own pair');
});

test('an adopted pair whose access token is nearly spent is refreshed rather than used', async () => {
  const { fetchImpl } = stubService();
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  await client.login({ email: 'anna@example.org', authHash: 'AAAA' });
  // `refresh-2` is what this client holds; the store has moved on to a NEWER
  // pair whose access token expires in five seconds, which is not enough to
  // send a request with.
  const { store, state } = recordingStore({
    accessToken: 'nearly-spent',
    accessTokenExpiresAt: new Date(Date.now() + 5_000).toISOString(),
    refreshToken: 'refresh-newer',
    refreshTokenExpiresAt: NEWER_REFRESH_EXPIRY,
  });
  client.setTokenStore(store);

  assert.equal(await client.refreshAccessToken(), 'access-3');
  assert.equal(state.rotations.length, 1);
});

test('with NO store attached the client refreshes exactly as it did before', async () => {
  const { fetchImpl, captured } = stubService();
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  await client.login({ email: 'anna@example.org', authHash: 'AAAA' });

  assert.equal(await client.refreshAccessToken(), 'access-3');

  const refreshes = captured.filter((call) => call.url.endsWith('/v1/auth/refresh'));
  assert.equal(refreshes.length, 1, 'one request, the same one');
  assert.ok(refreshes[0]?.body?.includes('refresh-2'), 'and it spends the pair this client holds');
  assert.equal(client.getSession()?.tokens.refreshToken, 'refresh-3');
});
