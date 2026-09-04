/**
 * The session, cached on this device so a reload does not sign anybody out
 * (M192).
 *
 * ── What is kept, and the argument for keeping it ────────────────────────
 *
 * The token pair, the DEK, and the compartment's passphrase door `K_pp` —
 * everything the vault (`sync-session.ts`) needs to reopen WITHOUT the
 * passphrase. The passphrase itself is not here and never will be; nothing
 * below could derive it from what is.
 *
 * The rule this replaces said the opposite, and its premise was that a cached
 * token buys nothing because the DEK cannot be re-derived without the
 * passphrase. Caching the DEK is exactly what changed. THE REASON IT COSTS
 * NOTHING: the local diary is already plaintext in `openplate-primary`, on
 * this device, on this origin. Anything that can read this database can read
 * that one, and reading that one is the whole prize. A password prompt on
 * every reload was protecting the copy in the cloud from somebody who already
 * held the copy in front of them, at the price of a person retyping a password
 * several times a day and, in practice, choosing a shorter one.
 *
 * The password is still asked at sign-in, at a passphrase change, at account
 * deletion, and whenever a refresh is refused.
 *
 * ── Raw IndexedDB, not TinyBase ──────────────────────────────────────────
 *
 * Every other store in this app is TinyBase, which stores one JSON string per
 * row. A `CryptoKey` cannot be JSON, and exporting `K_pp` to bytes so it could
 * be would make an extractable key out of one this app deliberately derives as
 * non-extractable (`hkdf.ts`). Raw IndexedDB stores values by STRUCTURED
 * CLONE, and a `CryptoKey` clones — non-extractable and all — which is the one
 * mechanism the platform offers for keeping a key that cannot be read out of
 * the browser. The `Uint8Array` DEK rides the same way, as bytes rather than
 * as base64 text.
 *
 * ── It is never exported ─────────────────────────────────────────────────
 *
 * `/settings/data`'s export is `backup.ts`'s `exportBackup`, which reads the
 * PRIMARY store's entities through one allowlist and knows nothing about any
 * other database. This one is not in it and cannot be added to it by accident:
 * there is no code path from the exporter to this file.
 */
import { SyncAuthClient } from './engine/client/auth-client';
import { SyncHttpClient } from './engine/client/http-client';
import { SyncRequestError } from './engine/client/sync-error';
import type { SessionTokensWire } from './engine/client/auth-wire';
import { createPrivateStoreSession, type PrivateStoreSession } from './private-store';
import type { EstablishedPrivateStore } from './engine/crypto/private-store';
import { createSyncStateStore, deviceStorage, resolveDeviceId } from './sync-state';
import {
  closeSyncSession,
  getSyncSessionSnapshot,
  openSyncSession,
  writeAccountHint,
  type SyncSessionSnapshot,
  type SyncVault,
} from './sync-session';
import { createComponentLogger } from '#app/lib/logger';

const log = createComponentLogger('sync-session-cache');

/** Its own IndexedDB database, beside `openplate-primary` and the rest. One row, one key. */
export const SESSION_DB_NAME = 'openplate-session';
const SESSION_STORE_NAME = 'session';
const SESSION_ROW_KEY = 'me';
const SESSION_DB_VERSION = 1;

/**
 * What one cached session is.
 *
 * `serverUrl` is not decoration and is not in the milestone's field list by
 * accident of drafting: a cache written while this instance pointed at one
 * service must never be replayed against another. An operator who moves
 * `SYNC_SERVER_URL` would otherwise have every device silently present a
 * stranger's tokens to the new address.
 */
export interface SessionCacheRecord {
  accountId: number;
  email: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  /** The service this session belongs to. A mismatch drops the cache, unread. */
  serverUrl: string;
  /** The unwrapped data-encryption key, as bytes. Structured-cloned, never base64 in a JSON cell. */
  dek: Uint8Array;
  /**
   * The MINIMUM the owner-private compartment needs to reopen: its passphrase
   * door.
   *
   * Not the CDK, not the wraps, not the seal cache. A resumed session adopts
   * all three from its first pull exactly as an ordinary sign-in does
   * (`createPrivateStoreSession` starts every sign-in with `cdk: null`), so
   * caching them would add key material to disk to save one round trip that
   * happens anyway. `K_pp` is different: it is the one value in the session
   * that only a passphrase can produce.
   */
  compartment: { passphraseKek: CryptoKey };
  /** Epoch-ms this record was written. Diagnostics only — expiry is the tokens' own business. */
  savedAt: number;
}

/** `true` in a browser with IndexedDB. SSR and unusual runtimes simply have no cache. */
function hasIndexedDb(): boolean {
  return globalThis.indexedDB !== undefined;
}

async function openSessionDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return null;
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(SESSION_DB_NAME, SESSION_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(SESSION_STORE_NAME)) {
        request.result.createObjectStore(SESSION_STORE_NAME);
      }
    });
    // A blocked or failed open is answered with `null`, never a throw. Every
    // caller here can carry on without a cache — the worst outcome is a
    // sign-in prompt — and a private-mode browser that refuses IndexedDB must
    // not turn a reload into an error screen.
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => resolve(null));
    request.addEventListener('blocked', () => resolve(null));
  });
}

/** Writes (or replaces) this device's cached session. Best effort: a storage failure is logged, never thrown. */
export async function writeSessionCache(record: SessionCacheRecord): Promise<void> {
  const db = await openSessionDb();
  if (db === null) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, 'readwrite');
      tx.objectStore(SESSION_STORE_NAME).put(record, SESSION_ROW_KEY);
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('error', () => reject(tx.error ?? new Error('session cache write failed')));
      tx.addEventListener('abort', () => reject(tx.error ?? new Error('session cache write aborted')));
    });
  } catch (cause) {
    // Quota, a private window, a browser that refuses structured-cloning a
    // `CryptoKey`. The session is open either way; it just will not survive a
    // reload, which is exactly where this app stood before M192.
    log.warn('could not cache the sync session on this device', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    db.close();
  }
}

/** @returns this device's cached session, or `null` when there is none (or it cannot be read). */
export async function readSessionCache(): Promise<SessionCacheRecord | null> {
  const db = await openSessionDb();
  if (db === null) return null;
  try {
    return await new Promise<SessionCacheRecord | null>((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, 'readonly');
      const request = tx.objectStore(SESSION_STORE_NAME).get(SESSION_ROW_KEY);
      request.addEventListener('success', () => {
        // SAFETY: this key is written only by `writeSessionCache` above, which
        // stores a `SessionCacheRecord` and nothing else. A record written by
        // an older build of this app would be structurally different, and the
        // resume path treats a mismatched `serverUrl` — and a refused refresh —
        // as "no cache", so a stale shape ends in a sign-in prompt rather than
        // in a wrong session.
        resolve((request.result as SessionCacheRecord | undefined) ?? null);
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('session cache read failed')));
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Drops the cached session. Called on sign-out, on account deletion, and on any refused refresh. */
export async function clearSessionCache(): Promise<void> {
  const db = await openSessionDb();
  if (db === null) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, 'readwrite');
      tx.objectStore(SESSION_STORE_NAME).delete(SESSION_ROW_KEY);
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('error', () => reject(tx.error ?? new Error('session cache clear failed')));
      tx.addEventListener('abort', () => reject(tx.error ?? new Error('session cache clear aborted')));
    });
  } catch {
    // Nothing to do. The in-memory vault is closed by the caller regardless,
    // and a cache we cannot delete is one we could not have written either.
  } finally {
    db.close();
  }
}

/**
 * Assembles the vault, publishes the session, and remembers it on this device.
 *
 * THE ONE PLACE A SESSION OPENS. `sync-actions.ts` calls it after a signup, a
 * sign-in and a recovery; {@link resumeSyncSession} calls it after a reload.
 * Keeping the assembly here rather than in each of those is what makes "is the
 * session cached on every path that opens one" answerable by reading a single
 * function instead of four.
 *
 * The cache write is deliberately NOT awaited by the caller's happy path — it
 * is fire-and-forget, and a failed write costs a reload, not a session.
 */
export function openSyncVault(input: {
  authClient: SyncAuthClient;
  http: SyncHttpClient;
  serverUrl: string;
  accountId: number;
  email: string;
  dek: Uint8Array;
  /** `K_pp` for the passphrase (or the cached key) that just unlocked this session. */
  privateStoreKek: CryptoKey;
  /** Present only when this call ESTABLISHED the compartment (setup); a sign-in adopts one on its first pull instead. */
  privateStore?: EstablishedPrivateStore | null;
  /** The compartment session to adopt verbatim, for a resume that has already built one. */
  privateStoreSession?: PrivateStoreSession;
}): SyncVault {
  const storage = deviceStorage();
  const state = createSyncStateStore({ storage, accountId: input.accountId });
  const vault: SyncVault = {
    authClient: input.authClient,
    http: input.http,
    dek: input.dek,
    privateStore:
      input.privateStoreSession ??
      createPrivateStoreSession({
        accountId: input.accountId,
        passphraseKek: input.privateStoreKek,
        established: input.privateStore ?? null,
      }),
    accountId: input.accountId,
    email: input.email,
    deviceId: resolveDeviceId(storage),
    state,
    serverUrl: input.serverUrl,
  };
  writeAccountHint(input.email, storage);
  openSyncSession(vault, { lastSyncedAt: state.load().lastSyncedAt });
  void cacheOpenSession(vault);
  return vault;
}

/** Writes the current vault into the cache. Exported through {@link openSyncVault} and the passphrase-change path. */
export async function cacheOpenSession(vault: SyncVault): Promise<void> {
  const tokens = vault.authClient.getSession()?.tokens;
  if (tokens === undefined) return;
  await writeSessionCache({
    accountId: vault.accountId,
    email: vault.email,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    serverUrl: vault.serverUrl,
    dek: vault.dek,
    compartment: { passphraseKek: vault.privateStore.passphraseKek },
    savedAt: Date.now(),
  });
}

/**
 * Rebuilds the session from this device's cache — the reload path.
 *
 * ── The order, and why each step is where it is ──────────────────────────
 *
 *  1. Read the cache. Nothing there, or a record for a different service, and
 *     this returns the signed-out snapshot without a single request.
 *  2. Refresh the token pair. The cached access token is fifteen minutes old
 *     at best and usually expired, so refreshing first is one round trip
 *     instead of a 401 and then two. A REFUSED refresh — `401` from a revoked
 *     family, `403` from a suspended account — clears the cache and leaves the
 *     app signed out. That is the whole of the "an admin suspended you" and
 *     "you changed your password elsewhere" story on this path.
 *  3. Read the account. `dailyAiLimit`, `aiUsedToday` and `suspendedAt` all
 *     move on the server between visits, so a resumed session that trusted a
 *     cached copy of them would offer a scan button to a suspended account.
 *  4. Open the vault, which writes the rotated tokens back to the cache.
 *
 * NEVER THROWS. It is called on boot, before anything is rendered, and the
 * correct response to any failure here is a signed-out app — not an error
 * screen on top of a diary that works perfectly offline.
 */
export async function resumeSyncSession({ serverUrl }: { serverUrl: string }): Promise<SyncSessionSnapshot> {
  const cached = await readSessionCache();
  if (cached === null) return getSyncSessionSnapshot();
  if (cached.serverUrl !== serverUrl) {
    // The operator moved this instance to another service. The cached tokens
    // belong to the old one and mean nothing here.
    await clearSessionCache();
    return getSyncSessionSnapshot();
  }

  const authClient = new SyncAuthClient({ baseUrl: serverUrl });
  const http = new SyncHttpClient({ baseUrl: serverUrl, tokens: authClient });
  const tokens: SessionTokensWire = {
    accessToken: cached.accessToken,
    accessTokenExpiresAt: cached.accessTokenExpiresAt,
    refreshToken: cached.refreshToken,
    refreshTokenExpiresAt: cached.refreshTokenExpiresAt,
  };
  authClient.restoreSession({ account: { id: cached.accountId, email: cached.email }, tokens });

  try {
    const refreshed = await authClient.refreshAccessToken();
    if (refreshed === null) {
      await clearSessionCache();
      return getSyncSessionSnapshot();
    }
    await authClient.getAccount();
  } catch (cause) {
    if (isSessionEnded(cause)) {
      await clearSessionCache();
      return getSyncSessionSnapshot();
    }
    // Offline, a 500, a service mid-deploy. The cache is KEPT: this device is
    // signed in and simply could not say so yet, and dropping the session here
    // would make a flaky network look like a sign-out.
    log.warn('could not resume the cached sync session', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return getSyncSessionSnapshot();
  }

  const session = authClient.getSession();
  if (session === null) return getSyncSessionSnapshot();

  openSyncVault({
    authClient,
    http,
    serverUrl,
    accountId: session.account.id,
    email: session.account.email,
    dek: cached.dek,
    privateStoreKek: cached.compartment.passphraseKek,
  });
  return getSyncSessionSnapshot();
}

/** Whether a failure means "this session is over", as opposed to "we could not tell". */
function isSessionEnded(cause: unknown): boolean {
  if (!(cause instanceof SyncRequestError)) return false;
  return cause.kind === 'unauthorized' || cause.kind === 'suspended';
}

/**
 * Closes the in-memory session AND drops its cached copy.
 *
 * The pair is exported together rather than left to each call site, because
 * clearing one without the other is the failure this module can produce that
 * nothing else would notice: a closed vault beside a live cache resumes itself
 * on the next reload, and a cleared cache beside an open vault signs the
 * person out the next time they open the app for no visible reason.
 */
export async function closeAndForgetSyncSession(): Promise<void> {
  closeSyncSession();
  await clearSessionCache();
}
