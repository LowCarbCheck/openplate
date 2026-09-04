/**
 * The live sync session: what the UI is allowed to see, and what it must not.
 *
 * ── The split this module enforces ────────────────────────────────────────
 *
 * `SyncSessionSnapshot` is the React-visible state — a handle, a timestamp, a
 * phase. The VAULT (the DEK, the tokens, the HTTP clients) lives in a
 * module-private variable that no snapshot ever references. React state is
 * copied into component closures, serialized by devtools, and captured in
 * error reports; key material must never take that path. Keeping the two in
 * one file rather than two makes the boundary visible: the only way to reach
 * the vault is `getSyncVault()`, and grepping it shows every call site.
 *
 * ── The vault is memory-only; a COPY of it may sit on this device ─────────
 *
 * Nothing in this module writes to disk. `session-cache.ts` does, and it is
 * the only thing that may: it keeps the tokens, the DEK and the compartment
 * key in a device-only IndexedDB database so a reload resumes instead of
 * ending the session (M192).
 *
 * The argument that used to stand here was that a persisted token buys
 * nothing because the DEK cannot be re-derived without the passphrase. THE NEW
 * RULE, and why it costs nothing: the local diary is already plaintext in
 * IndexedDB on this device and this origin. Anything that can read the cached
 * key can read the diary it opens, directly, without it — so a password prompt
 * on every reload was protecting the copy in the cloud from somebody who
 * already had the copy in front of them.
 *
 * The other thing that IS persisted is the EMAIL HINT: the address this device
 * last signed in with. It is not a credential, and having it means a returning
 * visitor sees a sign-in form with their address filled in rather than a blank
 * one that makes them wonder whether their data is gone.
 */
import type { SyncAuthClient } from './engine/client/auth-client';
import type { SyncHttpClient } from './engine/client/http-client';
import type { PrivateStoreSession } from './private-store';
import type { SyncStateStore, KeyValueStorage } from './sync-state';
import { browserStorage } from './sync-state';

/**
 * The address this device last signed in with.
 *
 * A NEW KEY, not a rename of `openplate.sync.account-hint`. That one held a
 * HANDLE, which protocol 2 has no field for any more — reusing the key would
 * prefill a sign-in form with a value the service would answer `401` to, and
 * the person would be told their password was wrong.
 */
const EMAIL_HINT_KEY = 'openplate.sync.email-hint';

/** What sync is doing right now, for the status surface. */
export type SyncPhase = 'idle' | 'syncing';

/** Why sync last stopped. Amber, never alarmist (DESIGN.md) — none of these lose data. */
export type SyncErrorReason =
  /** The session expired and could not be renewed. The user signs in again; nothing is lost. */
  | 'reauth-required'
  /** The service is unreachable, or the device is offline. Local editing continues normally. */
  | 'offline'
  /** Protocol handshake mismatch — one side needs updating before it is safe to sync. */
  | 'incompatible'
  /** Anything else. */
  | 'failed';

export interface SyncSessionSnapshot {
  /**
   * `null` when no session is open. Carries NO credential material.
   *
   * `dailyAiLimit` is here because a screen decides whether AI is available
   * from it (`managed-ai-settings.ts`), and a screen may only read the
   * SNAPSHOT — the vault is off limits to React. `aiUsedToday` rides with it
   * so the same read answers "and how much is left".
   */
  account: {
    id: number;
    email: string;
    displayName: string | null;
    role: 'admin' | 'member';
    dailyAiLimit: number;
    aiUsedToday: number;
  } | null;
  /**
   * True while this device may still be reopening a session it already had.
   *
   * `account === null` alone cannot be read as "nobody is signed in": it is
   * also what the first moments after a reload look like, before
   * `resumeSyncSession` has finished. A screen that treats the two as one
   * tells a signed-in person they are signed out, once per reload.
   *
   * OWNED BY `SyncController`, which is the only thing that ever resumes and
   * therefore the only thing that knows when the attempt is over. It settles
   * this to `false` on every path, including the instance where sync is off
   * and no resume is attempted at all.
   */
  isResuming: boolean;
  phase: SyncPhase;
  /** Epoch-ms of the last successful cycle on this device, or `null` if it has never completed one. */
  lastSyncedAt: number | null;
  /** True when this device holds changes the server has not seen. Drives the "waiting to sync" dot. */
  hasPendingChanges: boolean;
  error: { reason: SyncErrorReason; message: string } | null;
}

/** Secrets and clients. NEVER referenced from a snapshot, never logged, never serialized. */
export interface SyncVault {
  authClient: SyncAuthClient;
  http: SyncHttpClient;
  /** The unwrapped data-encryption key for this session. */
  dek: Uint8Array;
  /**
   * The owner-private compartment's session state (`private-store.ts`) — the
   * compartment data key, its two wraps, and `K_pp`.
   *
   * MUTABLE and shared by reference: a first pull adopts a CDK into it and a
   * passphrase change rewrites its wraps, and every later push must see those
   * writes or it re-emits a stale wrap. Belongs in the vault rather than the
   * snapshot for the same reason the DEK does — key material must never reach
   * React state, devtools or an error report.
   */
  privateStore: PrivateStoreSession;
  accountId: number;
  email: string;
  deviceId: string;
  state: SyncStateStore;
  serverUrl: string;
}

/** Signed out, and SETTLED: the resume either finished with nothing or was never attempted. */
const SIGNED_OUT: SyncSessionSnapshot = {
  account: null,
  isResuming: false,
  phase: 'idle',
  lastSyncedAt: null,
  hasPendingChanges: false,
  error: null,
};

/**
 * Where every browser starts: nobody is signed in YET, and this device has not
 * looked in its cache. The only state in which `isResuming` is true.
 */
const BOOTING: SyncSessionSnapshot = { ...SIGNED_OUT, isResuming: true };

let snapshot: SyncSessionSnapshot = BOOTING;
let vault: SyncVault | null = null;
const listeners = new Set<() => void>();

/** `useSyncExternalStore` subscribe. */
export function subscribeSyncSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** `useSyncExternalStore` getSnapshot. Identity is stable between updates, as that hook requires. */
export function getSyncSessionSnapshot(): SyncSessionSnapshot {
  return snapshot;
}

/**
 * The server snapshot for `useSyncExternalStore`.
 *
 * A CONSTANT, deliberately: during SSR there is never a session, and returning
 * the mutable `snapshot` would let a value that only exists in the browser
 * leak into rendered HTML — and a differing server/client value is a hydration
 * mismatch, which in this app means a blank screen.
 */
export function getServerSyncSessionSnapshot(): SyncSessionSnapshot {
  return SIGNED_OUT;
}

function publish(next: SyncSessionSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Merges a patch into the snapshot and notifies subscribers. */
export function updateSyncSession(patch: Partial<SyncSessionSnapshot>): void {
  publish({ ...snapshot, ...patch });
}

/**
 * Opens a session. Called once a passphrase (or a resumed cache) has produced
 * a DEK and the service has issued tokens.
 *
 * The account fields come from the vault's auth client rather than from
 * arguments: the client already holds the `AccountView` the service returned,
 * and copying it through a second set of parameters is how the snapshot ends
 * up describing a different account than the one the vault is talking to.
 */
export function openSyncSession(next: SyncVault, initial: { lastSyncedAt: number | null }): void {
  vault = next;
  const account = next.authClient.getSession()?.account ?? null;
  publish({
    account: {
      id: next.accountId,
      email: next.email,
      displayName: account?.displayName ?? null,
      role: account?.role ?? 'member',
      dailyAiLimit: account?.dailyAiLimit ?? 0,
      aiUsedToday: account?.aiUsedToday ?? 0,
    },
    isResuming: false,
    phase: 'idle',
    lastSyncedAt: initial.lastSyncedAt,
    hasPendingChanges: false,
    error: null,
  });
}

/**
 * Closes the session and drops every secret it held.
 *
 * `dek.fill(0)` is best-effort hygiene, not a guarantee — JavaScript engines
 * copy and move buffers freely and nothing here can promise the bytes are gone
 * from memory. It costs one line and removes the one copy we do control.
 */
export function closeSyncSession(): void {
  vault?.dek.fill(0);
  vault = null;
  publish(SIGNED_OUT);
}

/** The vault, or `null` when no session is open. The single door to key material. */
export function getSyncVault(): SyncVault | null {
  return vault;
}

// ---------------------------------------------------------------------------
// Email hint (non-secret, persisted)
// ---------------------------------------------------------------------------

/** The address this device last signed in with. A name, not a credential. */
export function readAccountHint(storage: KeyValueStorage | null = browserStorage()): string | null {
  const value = storage?.getItem(EMAIL_HINT_KEY) ?? null;
  return value === '' ? null : value;
}

export function writeAccountHint(email: string, storage: KeyValueStorage | null = browserStorage()): void {
  storage?.setItem(EMAIL_HINT_KEY, email);
}

/**
 * Cleared on account deletion and by the explicit "Not you?" link (M183
 * spec 04) — NOT on sign-out. An address is not a credential, and keeping it
 * across sign-out is what turns a returning visitor's next visit into a
 * sign-in instead of a dead end. The shared-device concern this used to
 * answer with a side effect is answered better by a control the person can
 * see and press.
 */
export function clearAccountHint(storage: KeyValueStorage | null = browserStorage()): void {
  storage?.removeItem(EMAIL_HINT_KEY);
}
