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
  const key = `${STATE_KEY_PREFIX}:${accountId}`;
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
    baseline: { perEntity: state.data.baseline.perEntity, tombstones: state.data.baseline.tombstones },
  };
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

/** An in-memory {@link KeyValueStorage}, for tests and for the SSR/no-storage fallback. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}
