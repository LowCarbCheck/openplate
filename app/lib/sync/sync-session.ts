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
 * ── Everything here is memory-only, and that is the design ────────────────
 *
 * A page reload ends the session and the user re-enters their passphrase.
 * That is not a gap to be closed with `localStorage`. The DEK cannot be
 * re-derived without the passphrase, so a persisted token would restore a
 * SESSION the user still could not decrypt anything with — all cost, no
 * benefit, plus a credential sitting on disk for any XSS to read. Bitwarden
 * locks its vault on reload for exactly this reason.
 *
 * The one thing that IS persisted is the account HINT: the handle this device
 * last signed in with. It is not a credential, and having it means a returning
 * visitor sees "unlock your sync" with their handle filled in rather than a
 * sign-up form that makes them wonder whether their data is gone. Since M181
 * it is also the only readable trace of the account left on the device, which
 * is a good deal less than an address was.
 */
import type { SyncAuthClient } from './engine/client/auth-client';
import type { SyncHttpClient } from './engine/client/http-client';
import type { PrivateStoreSession } from './private-store';
import type { SyncStateStore, KeyValueStorage } from './sync-state';
import { browserStorage } from './sync-state';

const ACCOUNT_HINT_KEY = 'openplate.sync.account-hint';

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
  /** `null` when no session is open. Carries NO credential material. */
  account: { id: number; handle: string } | null;
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
  handle: string;
  deviceId: string;
  state: SyncStateStore;
  serverUrl: string;
}

const SIGNED_OUT: SyncSessionSnapshot = {
  account: null,
  phase: 'idle',
  lastSyncedAt: null,
  hasPendingChanges: false,
  error: null,
};

let snapshot: SyncSessionSnapshot = SIGNED_OUT;
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

/** Opens a session. Called once a passphrase has produced a DEK and the service has issued tokens. */
export function openSyncSession(next: SyncVault, initial: { lastSyncedAt: number | null }): void {
  vault = next;
  publish({
    account: { id: next.accountId, handle: next.handle },
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
// Account hint (non-secret, persisted)
// ---------------------------------------------------------------------------

/** The handle this device last signed in with. A name, not a credential. */
export function readAccountHint(storage: KeyValueStorage | null = browserStorage()): string | null {
  const value = storage?.getItem(ACCOUNT_HINT_KEY) ?? null;
  return value === '' ? null : value;
}

export function writeAccountHint(handle: string, storage: KeyValueStorage | null = browserStorage()): void {
  storage?.setItem(ACCOUNT_HINT_KEY, handle);
}

/** Cleared on sign-out and on account deletion, so a shared device stops offering someone else's handle. */
export function clearAccountHint(storage: KeyValueStorage | null = browserStorage()): void {
  storage?.removeItem(ACCOUNT_HINT_KEY);
}
