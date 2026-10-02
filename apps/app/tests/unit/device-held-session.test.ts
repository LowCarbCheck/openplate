/**
 * A session on a device that holds another account's diary (ADR-0022): the
 * guard fails closed, the resume refuses quietly, and every lock names whose
 * diary it closes.
 *
 * ── The guard, and why it is tested by calling it wrong ──────────────────
 *
 * `openSyncVault` is the one place a session opens. The flows ask the lock
 * first and show the account-switch step, but the property that matters is
 * what happens when a flow FORGETS to: the guard must throw before a vault, a
 * cache row, a remembered address, a token store or an unlock exists. So the
 * first test calls it for the wrong account and reads all five back. Its
 * CONTROL is the same call for the owner, which opens and lifts the lock.
 *
 * ── The owner a lock names ───────────────────────────────────────────────
 *
 * A session the server ends locks the device like a sign-out, and the lock
 * has to name the account: read from the open vault, else from the cached
 * row, both before anything closes. With neither, a lock that already names
 * somebody must not be replaced by nobody.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import {
  clearSessionCache,
  endSessionRefused,
  openSyncVault,
  readSessionCache,
  resumeSyncSession,
  writeSessionCache,
  type SessionCacheRecord,
} from '../../app/lib/sync/session-cache';
import {
  closeSyncSession,
  getSyncSessionSnapshot,
  getSyncVault,
  readAccountHint,
  writeAccountHint,
} from '../../app/lib/sync/sync-session';
import {
  clearDeviceLockAfterErase,
  DeviceHeldByAnotherAccountError,
  deviceStorage,
  lockDevice,
  readDeviceLock,
  setLockDeviceWhenSessionEnds,
} from '../../app/lib/sync/sync-state';
import { defaultSignOutSteps } from '../../app/lib/sync/sign-out-flow';
import { deriveAesKeyViaHkdf, HKDF_INFO } from '../../app/lib/sync/engine/crypto/hkdf';
import { SyncAuthClient, type SessionTokenStore } from '../../app/lib/sync/engine/client/auth-client';
import { SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';

const SERVER_URL = 'https://sync.example.test';
const OWNER = { id: 7, email: 'anna@example.org' };
const OTHER = { id: 9, email: 'ben@example.org' };
const PREVIOUS_HINT = 'someone-before@example.org';

const REFUSED = { reason: 'reauth-required', message: 'The session ended.' } as const;

const TOKENS = {
  accessToken: 'access-old',
  accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
  refreshToken: 'refresh-old',
  refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
};

/** A `K_pp` derived the way the real one is: non-extractable, and clonable exactly because of that. */
async function compartmentKey(): Promise<CryptoKey> {
  return deriveAesKeyViaHkdf({
    inputKeyMaterial: new Uint8Array(32).fill(9),
    salt: new Uint8Array(16),
    info: HKDF_INFO.PRIVATE_STORE_KEK,
  });
}

/** An auth client, and one entry per token store attached to it. */
interface CountedClient {
  authClient: SyncAuthClient;
  storesAttached: number[];
}

/** An auth client signed in as `account`, counting how often a token store is attached to it. */
function signedInClient(account: { id: number; email: string }): CountedClient {
  const authClient = new SyncAuthClient({ baseUrl: SERVER_URL });
  authClient.restoreSession({ account, tokens: TOKENS });
  const storesAttached: number[] = [];
  const attach = authClient.setTokenStore.bind(authClient);
  authClient.setTokenStore = (store: SessionTokenStore) => {
    storesAttached.push(1);
    attach(store);
  };
  return { authClient, storesAttached };
}

/** Opens a vault for `account` the way every flow does. */
async function openVaultFor(authClient: SyncAuthClient, account: { id: number; email: string }): Promise<void> {
  openSyncVault({
    authClient,
    http: new SyncHttpClient({ baseUrl: SERVER_URL, tokens: authClient }),
    serverUrl: SERVER_URL,
    accountId: account.id,
    email: account.email,
    dek: new Uint8Array(32).fill(1),
    privateStoreKek: await compartmentKey(),
  });
}

/** Lets the fire-and-forget cache write of an open land, so its absence below is not just "not yet". */
async function settleCacheWrite(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function cachedRecord(account: { id: number; email: string }): Promise<SessionCacheRecord> {
  return {
    accountId: account.id,
    email: account.email,
    ...TOKENS,
    serverUrl: SERVER_URL,
    dek: new Uint8Array(32).fill(4),
    compartment: { passphraseKek: await compartmentKey() },
    savedAt: Date.now(),
  };
}

/** One JSON document the stub answers with: a token pair, an account view, or an error. */
type StubBody =
  | { tokens: typeof TOKENS }
  | {
      account: {
        id: number;
        email: string;
        displayName: null;
        role: 'member';
        dailyAiLimit: number;
        aiUsedToday: number;
        suspendedAt: null;
      };
    }
  | { error: string };

const json = (body: StubBody, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Swaps in a `fetch` for the duration of one test, and puts the real one back. */
function withFetch(impl: typeof fetch): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = previous;
  };
}

/** A stub service, and one entry per logout it answered. */
interface CountedService {
  fetchImpl: typeof fetch;
  logouts: number[];
}

/** A service that rotates the pair and reports the cached account, and counts every logout. */
function healthyService(account: { id: number; email: string }): CountedService {
  const logouts: number[] = [];
  const fetchImpl: typeof fetch = async (input) => {
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
    if (path.endsWith('/auth/account')) {
      return json({
        account: { ...account, displayName: null, role: 'member', dailyAiLimit: 1, aiUsedToday: 0, suspendedAt: null },
      });
    }
    if (path.endsWith('/auth/logout')) {
      logouts.push(1);
      return new Response(null, { status: 204 });
    }
    return json({ error: 'unexpected route' }, 404);
  };
  return { fetchImpl, logouts };
}

beforeEach(async () => {
  closeSyncSession();
  await clearSessionCache();
  setLockDeviceWhenSessionEnds(false);
  clearDeviceLockAfterErase();
  writeAccountHint(PREVIOUS_HINT, deviceStorage());
});

describe('openSyncVault on a held device', () => {
  test('FAILS CLOSED for another account: no vault, no cache row, no address, no token store, no unlock', async () => {
    lockDevice({ owner: { accountId: OWNER.id, email: OWNER.email } });
    const { authClient, storesAttached } = signedInClient(OTHER);

    await assert.rejects(() => openVaultFor(authClient, OTHER), DeviceHeldByAnotherAccountError);
    await settleCacheWrite();

    assert.equal(getSyncVault(), null, 'a vault was opened');
    assert.equal(getSyncSessionSnapshot().account, null, 'a session was published');
    assert.equal(await readSessionCache(), null, 'the session was cached');
    assert.equal(readAccountHint(deviceStorage()), PREVIOUS_HINT, 'the address was remembered');
    assert.equal(storesAttached.length, 0, 'a token store was attached');
    assert.deepEqual(readDeviceLock(), {
      kind: 'locked',
      owner: { accountId: OWNER.id, email: OWNER.email },
    });
  });

  test('CONTROL: the owner opens, and the lock lifts', async () => {
    lockDevice({ owner: { accountId: OWNER.id, email: OWNER.email } });
    const { authClient, storesAttached } = signedInClient(OWNER);

    await openVaultFor(authClient, OWNER);
    await settleCacheWrite();

    assert.equal(getSyncVault()?.accountId, OWNER.id);
    assert.equal((await readSessionCache())?.accountId, OWNER.id);
    assert.equal(storesAttached.length, 1);
    assert.deepEqual(readDeviceLock(), { kind: 'unlocked' });
  });

  test('a lock that names nobody refuses even the account that signed out', async () => {
    lockDevice({ owner: null });
    const { authClient } = signedInClient(OWNER);
    await assert.rejects(() => openVaultFor(authClient, OWNER), DeviceHeldByAnotherAccountError);
    assert.equal(getSyncVault(), null);
  });
});

describe('a resume on a held device', () => {
  test('does not reopen another account: the cache goes, the boot settles signed out, the lock stays', async () => {
    lockDevice({ owner: { accountId: OWNER.id, email: OWNER.email } });
    await writeSessionCache(await cachedRecord(OTHER));
    const service = healthyService(OTHER);
    const restore = withFetch(service.fetchImpl);
    try {
      const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
      assert.equal(snapshot.account, null);
      assert.equal(snapshot.isResuming, false, 'the boot did not settle');
      assert.equal(getSyncVault(), null);
      assert.equal(await readSessionCache(), null, 'a reload would try the same session again');
      assert.equal(service.logouts.length, 1, 'the unused tokens were not revoked');
      assert.equal(readDeviceLock().kind, 'locked');
    } finally {
      restore();
    }
  });

  test('CONTROL: the owner resumes', async () => {
    lockDevice({ owner: { accountId: OWNER.id, email: OWNER.email } });
    await writeSessionCache(await cachedRecord(OWNER));
    const restore = withFetch(healthyService(OWNER).fetchImpl);
    try {
      const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
      assert.equal(snapshot.account?.id, OWNER.id);
      assert.deepEqual(readDeviceLock(), { kind: 'unlocked' });
    } finally {
      restore();
      closeSyncSession();
    }
  });
});

describe('endSessionRefused names the owner', () => {
  test('from the open vault, read before it closes', async () => {
    setLockDeviceWhenSessionEnds(true);
    const { authClient } = signedInClient(OWNER);
    await openVaultFor(authClient, OWNER);
    await clearSessionCache();

    await endSessionRefused(REFUSED);

    assert.deepEqual(readDeviceLock(), { kind: 'locked', owner: { accountId: OWNER.id, email: OWNER.email } });
  });

  test('from the cached row when no vault is open, read before the cache is cleared', async () => {
    setLockDeviceWhenSessionEnds(true);
    await writeSessionCache(await cachedRecord(OWNER));

    await endSessionRefused(REFUSED);

    assert.deepEqual(readDeviceLock(), { kind: 'locked', owner: { accountId: OWNER.id, email: OWNER.email } });
    assert.equal(await readSessionCache(), null);
  });

  test('an owner passed in wins', async () => {
    setLockDeviceWhenSessionEnds(true);
    await writeSessionCache(await cachedRecord(OTHER));
    await endSessionRefused(REFUSED, { accountId: OWNER.id, email: OWNER.email });
    assert.deepEqual(readDeviceLock(), { kind: 'locked', owner: { accountId: OWNER.id, email: OWNER.email } });
  });

  test('with no owner anywhere, a lock that names somebody is never replaced by nobody', async () => {
    setLockDeviceWhenSessionEnds(true);
    lockDevice({ owner: { accountId: 5, email: 'carla@example.org' } });
    await endSessionRefused(REFUSED);
    assert.deepEqual(readDeviceLock(), { kind: 'locked', owner: { accountId: 5, email: 'carla@example.org' } });
  });

  test('CONTROL: with no owner anywhere and no lock, the device still locks, for nobody', async () => {
    setLockDeviceWhenSessionEnds(true);
    await endSessionRefused(REFUSED);
    assert.deepEqual(readDeviceLock(), { kind: 'locked', owner: null });
  });
});

describe('defaultSignOutSteps names the owner', () => {
  test('a passed owner wins over the open session', async () => {
    const { authClient } = signedInClient(OTHER);
    await openVaultFor(authClient, OTHER);
    const steps = defaultSignOutSteps({ owner: { accountId: OWNER.id, email: OWNER.email } });
    steps.lockDevice();
    assert.deepEqual(readDeviceLock(), { kind: 'locked', owner: { accountId: OWNER.id, email: OWNER.email } });
    closeSyncSession();
  });

  test('without one, the session open when the steps are built', async () => {
    const { authClient } = signedInClient(OWNER);
    await openVaultFor(authClient, OWNER);
    const steps = defaultSignOutSteps();
    // The session closes before the lock step runs, as it does in `runSignOut`.
    closeSyncSession();
    steps.lockDevice();
    assert.deepEqual(readDeviceLock(), { kind: 'locked', owner: { accountId: OWNER.id, email: OWNER.email } });
  });
});
