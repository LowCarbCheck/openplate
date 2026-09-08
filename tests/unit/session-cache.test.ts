/**
 * The session cache: what survives a reload, and what ends it.
 *
 * ── The premise this file exists to hold ─────────────────────────────────
 *
 * Before M192 a reload signed the person out, and the argument for it was that
 * a cached token bought nothing because the DEK could not be re-derived without
 * the passphrase. Caching the DEK is what changed, and it costs nothing because
 * the local diary is already plaintext in `openplate-primary` on the same
 * device and origin — anything that can read this database can read that one.
 *
 * What must NOT change is the set of things that END a session. So the tests
 * below are as much about the clearing as about the resuming:
 *
 *  1. A cache written by a real vault resumes into a real vault.
 *  2. A REFUSED refresh — `401` from a revoked family, `403` from a suspension
 *     — clears the cache and leaves the app signed out. A device that resumed
 *     a session the service had ended would look signed in and sync nothing.
 *  3. An UNREACHABLE service keeps the cache. Flaky network is not a sign-out.
 *  4. A cache for a DIFFERENT server is dropped unread.
 *  5. Sign-out clears it, or the next reload undoes the sign-out.
 *
 * `fake-indexeddb/auto` gives this file a real IndexedDB, which is the point:
 * the cache holds a non-extractable `CryptoKey` and a `Uint8Array`, and it is
 * raw IndexedDB rather than TinyBase precisely because those two survive a
 * structured clone and do not survive JSON.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import {
  clearSessionCache,
  deviceTokenStore,
  openSyncVault,
  readSessionCache,
  resumeSyncSession,
  writeSessionCache,
  type SessionCacheRecord,
} from '../../app/lib/sync/session-cache';
import { closeSyncSession, getSyncSessionSnapshot, getSyncVault } from '../../app/lib/sync/sync-session';
import { isDeviceLocked, setLockDeviceWhenSessionEnds, unlockDevice } from '../../app/lib/sync/sync-state';
import { deriveAesKeyViaHkdf, HKDF_INFO } from '../../app/lib/sync/engine/crypto/hkdf';
import { SyncAuthClient } from '../../app/lib/sync/engine/client/auth-client';
import { SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';

const SERVER_URL = 'https://sync.example.test';

const ACCOUNT = {
  id: 7,
  email: 'anna@example.org',
  displayName: null,
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 3,
  suspendedAt: null,
  createdAt: '2026-09-04T10:00:00.000Z',
};

/**
 * One JSON document a stub answers with: a token pair, an account view, or an
 * error. A union rather than a dictionary, so a branch below cannot answer with
 * a shape the client has no reading for.
 */
type StubBody =
  | {
      tokens: {
        accessToken: string;
        accessTokenExpiresAt: string;
        refreshToken: string;
        refreshTokenExpiresAt: string;
      };
    }
  | { account: typeof ACCOUNT }
  | { error: string }
  | Record<string, never>;

const json = (body: StubBody, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A `K_pp` derived the way the real one is: non-extractable, and clonable exactly because of that. */
async function compartmentKey(): Promise<CryptoKey> {
  return deriveAesKeyViaHkdf({
    inputKeyMaterial: new Uint8Array(32).fill(9),
    salt: new Uint8Array(16),
    info: HKDF_INFO.PRIVATE_STORE_KEK,
  });
}

async function cachedRecord(overrides: Partial<SessionCacheRecord> = {}): Promise<SessionCacheRecord> {
  return {
    accountId: ACCOUNT.id,
    email: ACCOUNT.email,
    accessToken: 'access-old',
    accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
    serverUrl: SERVER_URL,
    dek: new Uint8Array(32).fill(4),
    compartment: { passphraseKek: await compartmentKey() },
    savedAt: Date.now(),
    ...overrides,
  };
}

/** Swaps in a `fetch` for the duration of one test, and puts the real one back. */
function withFetch(impl: typeof fetch): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = previous;
  };
}

/** A service that rotates the pair and reports the account. The happy path. */
const healthyService: typeof fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith('/auth/refresh')) {
    return json({
      tokens: {
        accessToken: 'access-new',
        accessTokenExpiresAt: '2026-09-04T10:30:00.000Z',
        refreshToken: 'refresh-new',
        refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
      },
    });
  }
  if (path.endsWith('/auth/account')) return json({ account: ACCOUNT });
  return json({ error: 'unexpected route' }, 404);
};

beforeEach(async () => {
  closeSyncSession();
  await clearSessionCache();
  // The device lock and the policy that writes it are module state, shared by
  // every test in this file. An open instance is the default everywhere else.
  setLockDeviceWhenSessionEnds(false);
  unlockDevice();
});

after(() => {
  closeSyncSession();
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

test('a CryptoKey and raw bytes survive the round trip — the reason this is not TinyBase', async () => {
  const record = await cachedRecord();
  await writeSessionCache(record);
  const read = await readSessionCache();

  assert.ok(read !== null);
  assert.deepEqual([...read.dek], [...record.dek], 'the DEK must come back as the same bytes');
  // A NON-EXTRACTABLE key, still non-extractable. Exporting it to store it
  // would have made an extractable key out of one this app derives as
  // non-extractable on purpose.
  assert.equal(read.compartment.passphraseKek.extractable, false);
  assert.equal(read.compartment.passphraseKek.algorithm.name, 'AES-GCM');
  assert.equal(read.email, ACCOUNT.email);
});

test('clearing leaves nothing behind', async () => {
  await writeSessionCache(await cachedRecord());
  await clearSessionCache();
  assert.equal(await readSessionCache(), null);
});

// ---------------------------------------------------------------------------
// Resuming
// ---------------------------------------------------------------------------

test('a cached session resumes into a real vault, with the rotated tokens written back', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(healthyService);
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });

    assert.equal(snapshot.account?.email, ACCOUNT.email);
    // The ALLOWANCE comes from the fresh read, not from the cache: it moves on
    // the server between visits, and a resumed session that trusted a cached
    // copy would offer a scan button to an account whose allowance is zero.
    assert.equal(snapshot.account?.dailyAiLimit, 200);

    const vault = getSyncVault();
    assert.ok(vault !== null, 'a resumed session must open the vault, not just the snapshot');
    assert.deepEqual([...vault.dek], [...new Uint8Array(32).fill(4)], 'the cached DEK is what reopens the diary');
    assert.equal(vault.serverUrl, SERVER_URL);

    // The refresh token ROTATES, and the cache has to follow it: a cache still
    // holding the spent one would fail on the next reload, and a spent refresh
    // token is the theft signal that revokes the whole family.
    const written = await readSessionCache();
    assert.equal(written?.refreshToken, 'refresh-new');
    assert.equal(written?.accessToken, 'access-new');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Role — not a guessed default (0.10.1 walk defect 2)
// ---------------------------------------------------------------------------

test('a session opened once the real AccountView has been read carries the true role', async () => {
  const restore = withFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/account')) return json({ account: { ...ACCOUNT, role: 'admin' } });
    return json({ error: 'unexpected route' }, 404);
  });
  try {
    const authClient = new SyncAuthClient({ baseUrl: SERVER_URL });
    authClient.restoreSession({
      account: { id: ACCOUNT.id, email: ACCOUNT.email },
      tokens: {
        accessToken: 'access-old',
        accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
        refreshToken: 'refresh-old',
        refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
      },
    });
    // The reset ceremony's own account read — `recover-rotate`'s response
    // already carries the full view (`openplate-sync` `toAccountView`), and
    // `resumeSyncSession` reaches the same state via `getAccount()`.
    await authClient.getAccount();
    const http = new SyncHttpClient({ baseUrl: SERVER_URL, tokens: authClient });

    openSyncVault({
      authClient,
      http,
      serverUrl: SERVER_URL,
      accountId: ACCOUNT.id,
      email: ACCOUNT.email,
      dek: new Uint8Array(32).fill(1),
      privateStoreKek: await compartmentKey(),
    });

    assert.equal(getSyncSessionSnapshot().account?.role, 'admin');
  } finally {
    restore();
    closeSyncSession();
  }
});

test('a session opened before the real AccountView lands has role: null, not "member"', async () => {
  const authClient = new SyncAuthClient({ baseUrl: SERVER_URL });
  // `restoreSession` is what `resumeSyncSession` calls BEFORE its own
  // `getAccount()` read — a placeholder carrying only id and email. Opening a
  // vault straight from this (the shape a defensive default used to paper
  // over) must publish "not known yet", never an invented standing.
  authClient.restoreSession({
    account: { id: ACCOUNT.id, email: ACCOUNT.email },
    tokens: {
      accessToken: 'access-old',
      accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
      refreshToken: 'refresh-old',
      refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
    },
  });
  const http = new SyncHttpClient({ baseUrl: SERVER_URL, tokens: authClient });

  openSyncVault({
    authClient,
    http,
    serverUrl: SERVER_URL,
    accountId: ACCOUNT.id,
    email: ACCOUNT.email,
    dek: new Uint8Array(32).fill(1),
    privateStoreKek: await compartmentKey(),
  });

  const account = getSyncSessionSnapshot().account;
  assert.equal(account?.role, null, 'an administrator must never be read as "member" for a fact not yet in hand');
  assert.equal(account?.dailyAiLimit, null);
  assert.equal(account?.aiUsedToday, null);
  closeSyncSession();
});

test('nothing cached means nothing dialled', async () => {
  let calls = 0;
  const restore = withFetch(async () => {
    calls += 1;
    return json({});
  });
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(snapshot.account, null);
    assert.equal(getSyncVault(), null);
    assert.equal(calls, 0, 'a device that has never signed in must make no request at all');
  } finally {
    restore();
  }
});

test('a cache for ANOTHER service is dropped unread', async () => {
  // An operator who moves `SYNC_SERVER_URL` would otherwise have every device
  // silently present a stranger's tokens to the new address.
  await writeSessionCache(await cachedRecord({ serverUrl: 'https://old.example.test' }));
  let calls = 0;
  const restore = withFetch(async () => {
    calls += 1;
    return json({});
  });
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(snapshot.account, null);
    assert.equal(calls, 0, 'the cached tokens must not be presented to a different service');
    assert.equal(await readSessionCache(), null, 'and the record must not be left to be tried again');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The ways a session ends
// ---------------------------------------------------------------------------

test('a REFUSED refresh clears the cache and leaves the app signed out', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(async () => json({ error: 'refresh token reuse detected' }, 401));
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(snapshot.account, null, 'a revoked family must not resume');
    assert.equal(getSyncVault(), null);
    // CLEARED, not kept. A cache the service has ended would be retried on
    // every reload, forever, on a device that looks signed in.
    assert.equal(await readSessionCache(), null);
  } finally {
    restore();
  }
});

test('a SUSPENDED account is refused exactly like a revoked family', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(async () => json({ error: 'account-suspended' }, 403));
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(snapshot.account, null);
    assert.equal(await readSessionCache(), null);
  } finally {
    restore();
  }
});

test('an UNREACHABLE service keeps the cache — a flaky network is not a sign-out', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(async () => {
    throw new TypeError('Failed to fetch');
  });
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(snapshot.account, null, 'a session that could not be confirmed is not open');
    // KEPT. This device IS signed in and simply could not say so yet; dropping
    // the session here would make a train tunnel look like a sign-out.
    assert.notEqual(await readSessionCache(), null, 'an unreachable service must not end the session');
  } finally {
    restore();
  }
});

test('a 500 from the account read keeps the cache too', async () => {
  // "We do not know" and "you are signed out" are different answers, and only
  // the second may drop a session.
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/refresh')) {
      return json({
        tokens: {
          accessToken: 'a',
          accessTokenExpiresAt: 'x',
          refreshToken: 'r',
          refreshTokenExpiresAt: 'y',
        },
      });
    }
    return json({ error: 'boom' }, 500);
  });
  try {
    assert.equal((await resumeSyncSession({ serverUrl: SERVER_URL })).account, null);
    assert.notEqual(await readSessionCache(), null);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Single-flight (0.10.1 walk defect 1)
// ---------------------------------------------------------------------------

test('two concurrent resumes make exactly one refresh request, and both resolve to the same open session', async () => {
  await writeSessionCache(await cachedRecord());
  let refreshCalls = 0;
  const restore = withFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return json({
        tokens: {
          accessToken: 'access-new',
          accessTokenExpiresAt: '2026-09-04T10:30:00.000Z',
          refreshToken: 'refresh-new',
          refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
        },
      });
    }
    if (path.endsWith('/auth/account')) return json({ account: ACCOUNT });
    return json({ error: 'unexpected route' }, 404);
  });
  try {
    // Two `SyncController` mounts racing — the exact shape of the 0.10.1 walk
    // defect: a quick bounce out of `_personal` and back starts a second
    // `resumeSyncSession` before the first has opened the vault.
    const [first, second] = await Promise.all([
      resumeSyncSession({ serverUrl: SERVER_URL }),
      resumeSyncSession({ serverUrl: SERVER_URL }),
    ]);

    assert.equal(refreshCalls, 1, 'the cached refresh token must be spent exactly once');
    assert.equal(first.account?.email, ACCOUNT.email);
    assert.deepEqual(first, second, 'both callers must see the same settled session');
    assert.notEqual(getSyncVault(), null);
  } finally {
    restore();
  }
});

test('a caller arriving after the resume already settled makes no request at all', async () => {
  await writeSessionCache(await cachedRecord());
  let refreshCalls = 0;
  const restore = withFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return json({
        tokens: {
          accessToken: 'access-new',
          accessTokenExpiresAt: '2026-09-04T10:30:00.000Z',
          refreshToken: 'refresh-new',
          refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
        },
      });
    }
    if (path.endsWith('/auth/account')) return json({ account: ACCOUNT });
    return json({ error: 'unexpected route' }, 404);
  });
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(refreshCalls, 1);

    // A second `SyncController` mount, well after the first one settled — the
    // vault is already open, so this must be answered from it, not rebuilt.
    const again = await resumeSyncSession({ serverUrl: SERVER_URL });

    assert.equal(refreshCalls, 1, 'a resume with an open vault must make no request');
    assert.equal(again.account?.email, ACCOUNT.email);
  } finally {
    restore();
  }
});

test('a stale 401 arriving after a successful refresh does not clear the session cache', async () => {
  await writeSessionCache(await cachedRecord());
  // The executor runs synchronously, so this is assigned before the line below reads it.
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const restore = withFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/refresh')) {
      // Held open until the test releases it, so a session can open from
      // elsewhere WHILE this refresh is still in flight.
      await refreshGate;
      return json({ error: 'refresh token reuse detected' }, 401);
    }
    return json({ error: 'unexpected route' }, 404);
  });
  try {
    const resuming = resumeSyncSession({ serverUrl: SERVER_URL });

    // A totally different flow — a manual sign-in, say — opens a session of
    // its own while the stale attempt above is still waiting on the network.
    const freshAuthClient = new SyncAuthClient({ baseUrl: SERVER_URL });
    freshAuthClient.restoreSession({
      account: { id: ACCOUNT.id, email: ACCOUNT.email },
      tokens: {
        accessToken: 'access-fresh',
        accessTokenExpiresAt: '2026-09-04T11:00:00.000Z',
        refreshToken: 'refresh-fresh',
        refreshTokenExpiresAt: '2026-10-04T11:00:00.000Z',
      },
    });
    const freshHttp = new SyncHttpClient({ baseUrl: SERVER_URL, tokens: freshAuthClient });
    openSyncVault({
      authClient: freshAuthClient,
      http: freshHttp,
      serverUrl: SERVER_URL,
      accountId: ACCOUNT.id,
      email: ACCOUNT.email,
      dek: new Uint8Array(32).fill(9),
      privateStoreKek: await compartmentKey(),
    });

    // Now let the stale refresh's 401 land.
    releaseRefresh();
    await resuming;

    assert.notEqual(getSyncVault(), null, 'the fresh session must still be open');
    assert.equal(
      getSyncVault()?.authClient.getSession()?.tokens.refreshToken,
      'refresh-fresh',
      'the stale attempt must not have touched the fresh vault',
    );
    assert.notEqual(
      await readSessionCache(),
      null,
      'a refusal that arrived after the vault moved on must not clear the cache',
    );
  } finally {
    restore();
  }
});

test('signing out drops the cached copy, or the next reload would undo it', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(healthyService);
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.notEqual(getSyncVault(), null);

    // `signOutOfSync` is the composition root's, and it calls exactly this
    // pair — see `tests/unit/sync-sign-out-hint.test.ts`, which reads the
    // source. What is asserted here is what the pair DOES.
    const { closeAndForgetSyncSession } = await import('../../app/lib/sync/session-cache');
    await closeAndForgetSyncSession();

    assert.equal(getSyncVault(), null);
    assert.equal(getSyncSessionSnapshot().account, null);
    assert.equal(await readSessionCache(), null, 'a sign-out that left the cache would be undone by a reload');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The rotated pair is written back (M201, the 0.10.3 silent sign-out)
// ---------------------------------------------------------------------------

/**
 * A refresh-token expiry LATER than the one every fixture in this file starts
 * from (`2026-10-04T10:00:00.000Z`).
 *
 * It is the ordering, not decoration. `adoptNewerTokens` adopts a stored pair
 * only when its `refreshTokenExpiresAt` is strictly later than the one in
 * hand, so a rotation that minted the same expiry would correctly not be
 * adopted, and a test that wanted an adoption would quietly stop testing one.
 */
const LATER_REFRESH_EXPIRY = '2026-11-04T10:00:00.000Z';

/** A `/refresh` stub that hands out a named pair and counts how often it is asked. */
function rotatingService(pair: { access: string; refresh: string }, counter: { calls: number }): typeof fetch {
  return async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/refresh')) {
      counter.calls += 1;
      return json({
        tokens: {
          accessToken: pair.access,
          accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshToken: pair.refresh,
          refreshTokenExpiresAt: LATER_REFRESH_EXPIRY,
        },
      });
    }
    if (path.endsWith('/auth/account')) return json({ account: ACCOUNT });
    return json({ error: 'unexpected route' }, 404);
  };
}

test('a refresh AFTER the resume writes the rotated pair back to the cache', async () => {
  // THIS TEST IS THE INCIDENT. The resume rotated `refresh-old` to `refresh-new`
  // and cached it, that part always worked, because `openSyncVault` writes the
  // record. The SECOND rotation, the ordinary mid-life one that follows any 401
  // once the fifteen-minute access token has expired, went unrecorded: the row
  // kept `refresh-new`, the service had already revoked it, and the next reload
  // presented a spent token, which §4.2 reads as theft and answers by revoking
  // the whole family. Nobody had done anything.
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(healthyService);
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal((await readSessionCache())?.refreshToken, 'refresh-new');
  } finally {
    restore();
  }

  const counter = { calls: 0 };
  const restoreSecond = withFetch(rotatingService({ access: 'access-2nd', refresh: 'refresh-2nd' }, counter));
  try {
    const vault = getSyncVault();
    assert.ok(vault !== null);
    assert.equal(await vault.authClient.refreshAccessToken(), 'access-2nd');
    assert.equal(counter.calls, 1, 'the pair it held was current, so it must have been spent');

    const written = await readSessionCache();
    assert.equal(written?.refreshToken, 'refresh-2nd', 'the cache must follow every rotation, not just the first');
    assert.equal(written?.accessToken, 'access-2nd');
  } finally {
    restoreSecond();
  }
});

test('the record keeps its keys through a rotation, only the four token fields move', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(healthyService);
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });
  } finally {
    restore();
  }

  const counter = { calls: 0 };
  const restoreSecond = withFetch(rotatingService({ access: 'access-2nd', refresh: 'refresh-2nd' }, counter));
  try {
    await getSyncVault()?.authClient.refreshAccessToken();
  } finally {
    restoreSecond();
  }

  const written = await readSessionCache();
  assert.ok(written !== null);
  // A rotation that rebuilt the row from the tokens alone would resume into a
  // vault with no DEK and no compartment door, a session that opens and
  // decrypts nothing.
  assert.deepEqual([...written.dek], [...new Uint8Array(32).fill(4)]);
  assert.equal(written.compartment.passphraseKek.extractable, false);
  assert.equal(written.serverUrl, SERVER_URL);
  assert.equal(written.accountId, ACCOUNT.id);
});

test('a refresh ADOPTS a newer pair another context wrote, and spends nothing', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(healthyService);
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });
  } finally {
    restore();
  }

  // Another tab rotated and wrote its pair to the shared row while this vault
  // was idle. The token this client holds (`refresh-new`) is now spent.
  const current = await readSessionCache();
  assert.ok(current !== null);
  await writeSessionCache({
    ...current,
    accessToken: 'access-from-the-other-tab',
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: 'refresh-from-the-other-tab',
    // LATER than what this vault holds, which is what makes it newer. A pair
    // that merely DIFFERS is not adopted, because a failed write-back leaves
    // an OLDER pair in the row and adopting that spends a revoked token.
    refreshTokenExpiresAt: LATER_REFRESH_EXPIRY,
  });

  const counter = { calls: 0 };
  const restoreSecond = withFetch(rotatingService({ access: 'nope', refresh: 'nope' }, counter));
  try {
    const accessToken = await getSyncVault()?.authClient.refreshAccessToken();
    assert.equal(accessToken, 'access-from-the-other-tab', 'the pair in the row is the one this device holds');
    assert.equal(counter.calls, 0, 'spending an already rotated token is the theft signal');
  } finally {
    restoreSecond();
  }
});

test('two clients sharing the store make ONE request and end holding the same pair', async () => {
  await writeSessionCache(await cachedRecord());
  const counter = { calls: 0 };
  const restore = withFetch(rotatingService({ access: 'access-shared', refresh: 'refresh-shared' }, counter));
  try {
    // Two tabs, two module instances, one device row. They cannot share the
    // in-tab `refreshInFlight` promise, which is exactly why the lock and the
    // read-back exist.
    const tokens = {
      accessToken: 'access-old',
      accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
      refreshToken: 'refresh-old',
      refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
    };
    const clients = [new SyncAuthClient({ baseUrl: SERVER_URL }), new SyncAuthClient({ baseUrl: SERVER_URL })];
    for (const client of clients) {
      client.restoreSession({ account: { id: ACCOUNT.id, email: ACCOUNT.email }, tokens });
      client.setTokenStore(deviceTokenStore());
    }

    const results = await Promise.all(clients.map((client) => client.refreshAccessToken()));

    assert.equal(counter.calls, 1, 'the cached refresh token must be spent exactly once');
    assert.deepEqual(results, ['access-shared', 'access-shared']);
    for (const client of clients) {
      assert.equal(client.getSession()?.tokens.refreshToken, 'refresh-shared');
    }
    assert.equal((await readSessionCache())?.refreshToken, 'refresh-shared');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// A refused session is VISIBLE (M201, fix B)
// ---------------------------------------------------------------------------

test('a refused resume publishes reauth-required rather than a silent sign-out', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(async () => json({ error: 'refresh token reuse detected' }, 401));
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });

    // The snapshot used to say nothing at all: `closeSyncSession` publishes an
    // error of `null`, so the app looked signed in until the person tried to
    // scan and was told to ask their administrator.
    assert.equal(getSyncSessionSnapshot().error?.reason, 'reauth-required');
    assert.equal(getSyncSessionSnapshot().account, null);
  } finally {
    restore();
  }
});

test('a refused resume LOCKS the device where the instance asks for it', async () => {
  setLockDeviceWhenSessionEnds(true);
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(async () => json({ error: 'account-suspended' }, 403));
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });

    // The same marker sign-out writes. On a managed instance the diary belongs
    // to the account, so a session the server ended must close it to whoever
    // opens the app next.
    assert.equal(isDeviceLocked(), true);
  } finally {
    restore();
  }
});

test('on an OPEN instance a refused session leaves the device unlocked', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(async () => json({ error: 'refresh token reuse detected' }, 401));
  try {
    await resumeSyncSession({ serverUrl: SERVER_URL });

    // Here the diary belongs to the DEVICE and sync is an extra. Shutting
    // somebody out of their own rows because a token expired would be the
    // worse of the two failures.
    assert.equal(isDeviceLocked(), false);
    assert.equal(getSyncSessionSnapshot().error?.reason, 'reauth-required', 'and it is still said out loud');
  } finally {
    restore();
  }
});
