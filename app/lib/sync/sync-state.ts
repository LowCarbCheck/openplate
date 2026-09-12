/**
 * The device-local sync bookkeeping: which blob version this device last
 * agreed with, and the per-entity baseline `snapshot-sync.ts` diffs against.
 *
 * WHY NOT IN THE TINYBASE STORE: this is not user data. It is derived state
 * that can be thrown away and rebuilt (losing it costs one extra full push,
 * not a byte of anyone's diary), it must never appear in a backup export or
 * inside a sync blob, and — most usefully — keeping it out of the primary
 * store means the orchestrator never has to interleave with `persist.ts`'s
 * save lock to read or write it. See `sync-lock.ts` for why that matters.
 *
 * NOTHING SECRET LIVES HERE. Not the passphrase, not the DEK, not a token.
 * Content HASHES, Lamport counters, device ids and a blob version — all
 * derived, non-reversible, and useless to anyone who reads them. The account
 * hint (`sync-account-hint.ts`) is likewise an email address the person typed
 * on this device, kept so a returning visitor sees "unlock" instead of "sign
 * up".
 *
 * The storage is behind an interface so the unit and integration suites can
 * run this without a browser — `localStorage` does not exist in `node:test`.
 */
import { z } from 'zod';
import { randomUuid } from '#app/lib/uuid';
import type { SyncBaseline } from './snapshot-sync';

/** Bumped only if the shape below changes incompatibly; an unreadable state is simply discarded and rebuilt. */
const STATE_FORMAT_VERSION = 1;

const STATE_KEY_PREFIX = 'openplate.sync.state.v1';
const DEVICE_ID_KEY = 'openplate.sync.device-id';

export interface PersistedSyncState {
  formatVersion: number;
  /** The `blobVersion` this device last successfully agreed with. `0` means "never synced". */
  lastBlobVersion: number;
  /** Epoch-ms of the last successful cycle, for the "last synced" line in the UI. `null` until the first one. */
  lastSyncedAt: number | null;
  baseline: SyncBaseline;
}

/** Just enough storage for this module — `localStorage`'s shape, minus everything unused. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SyncStateStore {
  load(): PersistedSyncState;
  save(state: PersistedSyncState): void;
  clear(): void;
}

/** The state a device that has never synced starts from: no baseline, no version, everything is "new". */
export function emptySyncState(): PersistedSyncState {
  return {
    formatVersion: STATE_FORMAT_VERSION,
    lastBlobVersion: 0,
    lastSyncedAt: null,
    baseline: { perEntity: {}, tombstones: [] },
  };
}

/**
 * The one place the per-account baseline key is spelled (M201 spec 02).
 *
 * It is exported because a SECOND module has to reach it: erasing the diary
 * from a device must take this key with it, and a hand-built
 * `openplate.sync.state.v1:${id}` somewhere else is how the two drift apart.
 * The whole trap is written out at `eraseDeviceData` in
 * `app/lib/local-store/device-erase.ts`, and it is worth restating here
 * because this is the value that springs it: the baseline tells the next
 * sign-in how far this account already got, so a device whose diary is gone
 * and whose baseline is not downloads nothing and shows an EMPTY diary with no
 * error at all.
 *
 * @param accountId - the sync account this device is signed into.
 */
export function syncBaselineStorageKey(accountId: number): string {
  return `${STATE_KEY_PREFIX}:${accountId}`;
}

/**
 * State is keyed BY ACCOUNT.
 *
 * Signing into a different account on the same device must not inherit the
 * previous account's baseline — the entity ids would look "already synced"
 * against a blob they were never in, and this device would quietly decline to
 * upload data it is the only copy of.
 */
export function createSyncStateStore({
  storage,
  accountId,
}: {
  storage: KeyValueStorage;
  accountId: number;
}): SyncStateStore {
  const key = syncBaselineStorageKey(accountId);
  return {
    load(): PersistedSyncState {
      const raw = storage.getItem(key);
      if (raw === null) return emptySyncState();
      return parseSyncState(raw);
    },
    save(state: PersistedSyncState): void {
      storage.setItem(key, JSON.stringify(state));
    },
    clear(): void {
      storage.removeItem(key);
    },
  };
}

const stampedEntitySchema = z.object({
  lamport: z.number(),
  deviceId: z.string(),
  hash: z.string(),
});

const tombstoneSchema = z.object({
  lamport: z.number(),
  deviceId: z.string(),
  entityId: z.string(),
  entityType: z.string(),
});

/**
 * The persisted form, as read back out of storage.
 *
 * `lastBlobVersion`/`lastSyncedAt` default rather than reject: losing a
 * timestamp is cosmetic, and a missing version simply means "push everything",
 * which is already the safe direction. A malformed BASELINE is not defaulted —
 * it is what the diff is computed against, so a wrong one is worse than none.
 */
const persistedSyncStateSchema = z.object({
  formatVersion: z.literal(STATE_FORMAT_VERSION),
  lastBlobVersion: z.number().catch(0),
  lastSyncedAt: z.number().nullable().catch(null),
  baseline: z.object({
    perEntity: z.record(z.string(), stampedEntitySchema),
    tombstones: z.array(tombstoneSchema),
    // OPTIONAL, AND THAT IS THE MIGRATION. Every state written before M226 has
    // no such key, and a REQUIRED field here would fail the whole parse and
    // discard the baseline, which costs a full re-push and, worse, throws away
    // the tombstones that keep other devices' deletes buried. Absent means "this
    // device recorded nothing about its fasts and saved meals", which
    // `mergeSnapshots` reads as untrusted for exactly one cycle. No
    // `STATE_FORMAT_VERSION` bump for the same reason: the old shape is still
    // readable, so nothing is incompatible.
    passThrough: z
      .object({ fasts: z.array(z.string()), savedMeals: z.array(z.string()) })
      .optional(),
  }),
});

/**
 * Parses persisted state, falling back to empty on ANYTHING unrecognizable.
 *
 * Fail-soft is right here and nowhere else in this feature: a corrupt baseline
 * costs one redundant full push, whereas throwing would leave a device unable
 * to sync at all until someone cleared their browser storage by hand. Contrast
 * `parseEnvelope`, where a malformed input means "do not touch this data".
 */
export function parseSyncState(raw: string): PersistedSyncState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySyncState();
  }
  const state = persistedSyncStateSchema.safeParse(parsed);
  if (!state.success) return emptySyncState();
  return {
    formatVersion: STATE_FORMAT_VERSION,
    lastBlobVersion: state.data.lastBlobVersion,
    lastSyncedAt: state.data.lastSyncedAt,
    baseline: {
      perEntity: state.data.baseline.perEntity,
      tombstones: state.data.baseline.tombstones,
      passThrough: state.data.baseline.passThrough,
    },
  };
}

/**
 * Has this device ever synced an entity for this account (M223)?
 *
 * The onboarding gate's second piece of evidence that a device is not a new
 * person's. `hasEverHadData`, the first, lives in the values partition of
 * `openplate-primary`; this one lives in `localStorage`, so it survives the
 * whole database being evicted, which is the failure that put a real person in
 * front of the first-run wizard with her diary gone.
 *
 * @param accountId - the sync account this device is signed into.
 * @returns `true` when a stored baseline names at least one entity.
 */
export function hasSyncBaselineEntities({
  accountId,
  storage = deviceStorage(),
}: {
  accountId: number;
  storage?: KeyValueStorage;
}): boolean {
  const raw = storage.getItem(syncBaselineStorageKey(accountId));
  if (raw === null) return false;
  return Object.keys(parseSyncState(raw).baseline.perEntity).length > 0;
}

/**
 * This device's stable id — the `(lamport, deviceId)` tie-break's second half.
 *
 * Generated once and reused forever. It only has to be UNIQUE and STABLE: the
 * merge needs the same total order on every device, not a meaningful name. It
 * is not an identifier of a person — it is per browser profile, carries
 * nothing derived from the user, and travels only inside encrypted blobs.
 */
export function resolveDeviceId(storage: KeyValueStorage): string {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing !== null && existing !== '') return existing;
  const created = randomUuid();
  storage.setItem(DEVICE_ID_KEY, created);
  return created;
}

/** `localStorage` when there is one, otherwise `null` — SSR and `node:test` both take the `null` branch. */
export function browserStorage(): KeyValueStorage | null {
  if (globalThis.localStorage === undefined) return null;
  return localStorage;
}

/**
 * The in-memory stand-in used when there is no `localStorage` — SSR, a
 * locked-down browser, a `node:test` run.
 *
 * A MODULE SINGLETON, not a fresh store per call. A new store each time would
 * mint a new `deviceId` on every read and lose the baseline between two calls
 * in the same page, so every sync would look like a first sync from a brand
 * new device — quietly turning "no localStorage" into "re-upload everything,
 * forever".
 */
const fallbackStorage = createMemoryStorage();

/** The device's key-value storage: `localStorage` where it exists, one shared in-memory store where it doesn't. */
export function deviceStorage(): KeyValueStorage {
  return browserStorage() ?? fallbackStorage;
}

// ---------------------------------------------------------------------------
// The device lock
// ---------------------------------------------------------------------------

/**
 * Set while this device has been signed out of an account whose diary it must
 * not keep showing.
 *
 * Deliberately not versioned into the state above: it has to be readable
 * SYNCHRONOUSLY, before any store opens, by `_personal.tsx`'s gate.
 */
const DEVICE_LOCK_KEY = 'openplate.device-locked';
const DEVICE_LOCK_VALUE = 'locked';

/**
 * LOCKING IS THE GUARANTEE; ERASING IS THE EXTRA (M201 spec 02).
 *
 * ── The problem this solves ──────────────────────────────────────────────
 *
 * Signing out revokes the tokens and zeroes the key, which is the half an
 * operator can verify. The half a PERSON can see is the diary, and it is
 * plaintext rows in `openplate-primary` that no server-side act can reach. The
 * counsel refused a wipe-by-default, and rightly: a research participant's
 * unsynced week is not recoverable and a diary left on a device is. So
 * sign-out has to close the diary without destroying it, and this marker is
 * how, on the instances where the diary belongs to an account rather than to
 * the device (`InstancePolicy.signOutErasesDevice`).
 *
 * ── Why a marker and not the policy ──────────────────────────────────────
 *
 * The gate that reads this runs in `_personal.tsx`'s `clientLoader`, which has
 * no server loader and therefore no way to read `INSTANCE_MODE` before it
 * decides. The policy IS available at the moment of sign-out, in React, where
 * the person pressed the button. So the decision is taken once, there, and
 * recorded as a device-local fact the gate can read synchronously on every
 * later boot, offline included. It is not a credential and it protects
 * nothing from an attacker with the device: it stops the NEXT person who opens
 * the app reading the last one's diary, which is what an account on a shared
 * device is for.
 *
 * @param storage - defaults to this device's storage; injected in tests.
 */
export function lockDevice(storage: KeyValueStorage = deviceStorage()): void {
  storage.setItem(DEVICE_LOCK_KEY, DEVICE_LOCK_VALUE);
}

/**
 * Clears the lock. Called from {@link openSyncSession}, so signing back in is
 * the ONLY way a locked device becomes readable again, and every path that
 * opens a session gets it without remembering to.
 */
export function unlockDevice(storage: KeyValueStorage = deviceStorage()): void {
  storage.removeItem(DEVICE_LOCK_KEY);
}

/**
 * Does a session the SERVER ended lock this device, the way pressing sign out
 * does?
 *
 * ── Why a setting and not a read ─────────────────────────────────────────
 *
 * The question is `InstancePolicy.signOutErasesDevice`, and the policy arrives
 * through the root loader's public config, which is React and is asynchronous.
 * `session-cache.ts` is neither: it runs on boot, from a controller effect,
 * and it has to decide the moment a refresh comes back refused. So the policy
 * is pushed DOWN here, once, by `SyncController`, synchronously, in its
 * effect, before the resume that can produce the refusal.
 *
 * DEFAULT `false`, which is the open instance: the diary belongs to the
 * device there, and locking somebody out of their own rows because a token
 * expired would be the worse failure of the two. An instance that wants the
 * lock says so, on every boot, before anything can end a session.
 */
let lockOnSessionEnd = false;

/** Told to this module by `SyncController`; see {@link lockDeviceWhenSessionEnds}. */
export function setLockDeviceWhenSessionEnds(value: boolean): void {
  lockOnSessionEnd = value;
}

/** Whether a refused session should leave this device locked. See {@link setLockDeviceWhenSessionEnds}. */
export function lockDeviceWhenSessionEnds(): boolean {
  return lockOnSessionEnd;
}

/**
 * Is this device locked?
 *
 * Exact value match rather than truthiness, for the same reason
 * `parseHomeHintCookie` is exact: an unrecognisable value means "not locked",
 * and locking somebody out of their own diary on a half-written string would
 * be the worse failure of the two.
 */
export function isDeviceLocked(storage: KeyValueStorage = deviceStorage()): boolean {
  return storage.getItem(DEVICE_LOCK_KEY) === DEVICE_LOCK_VALUE;
}

/** An in-memory {@link KeyValueStorage}, for tests and for the SSR/no-storage fallback. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}
