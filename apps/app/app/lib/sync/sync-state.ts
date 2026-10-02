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
import { canonicalizeEmail } from './email';
import { PRIVATE_STORE_ENTITY_KEY, type SyncBaseline } from './snapshot-sync';

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
  /**
   * How many keys are stored, and the key at one index: `localStorage`'s own
   * two members for walking its keys (ADR-0022).
   *
   * OPTIONAL, because only two questions need them: whose baselines this
   * device holds, for a lock an older build wrote, and every baseline an
   * erase must take. A storage that cannot list its keys answers both with
   * "none known", and the first of those answers fails closed (`readDeviceLock`).
   */
  readonly length?: number;
  key?(index: number): string | null;
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
    // device recorded nothing about its saved meals", which `mergeSnapshots`
    // reads as untrusted for exactly one cycle. No `STATE_FORMAT_VERSION` bump
    // for the same reason: the old shape is still readable, so nothing is
    // incompatible.
    //
    // IT CARRIED A `fasts` LIST TOO UNTIL M240/01 (ADR-0014), and this object
    // no longer names it. Zod strips an unknown key, so a state written by
    // 0.35.1 or older parses here unchanged and its stale fast ids are simply
    // dropped: a fast is a merged entity now, so `baseline.perEntity` carries
    // its id, its stamp and its content hash, which is strictly more than the
    // bare list ever said. No `STATE_FORMAT_VERSION` bump for that either, for
    // the reason directly above.
    //
    // `savedMealsHash` is OPTIONAL INSIDE the optional record (M240 counsel
    // item 4), which is the same migration one level in: a baseline written
    // before the hash existed parses whole and simply has none, and the
    // sign-out dialog reads a missing hash as "cannot vouch" and warns. A
    // required field here would discard the baseline instead.
    passThrough: z
      .object({ savedMeals: z.array(z.string()), savedMealsHash: z.string().optional() })
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
 * Has this device ever synced an entity for this account (M224)?
 *
 * The onboarding gate's second piece of evidence that a device is not a new
 * person's. `hasEverHadData`, the first, lives in the values partition of
 * `openplate-primary`; this one lives in `localStorage`, so it survives the
 * whole database being evicted, which is the failure that put a real person in
 * front of the first-run wizard with her diary gone.
 *
 * THE OWNER-PRIVATE COMPARTMENT DOES NOT COUNT (M265/03). Every account's
 * first sync writes it (`privateStore:me`, lamport 1), whether or not the
 * account has ever held a diary, so it proves that this device synced, never
 * that it synced a diary. Counting it sent a buyer who chose a plan on the
 * pricing page to the recovery screen: they pay before the questionnaire, the
 * app syncs on the order page, and their first diary page then found a
 * baseline and no profile and said their diary was gone. A device that lost a
 * real diary still has the diary's own entities in its baseline, a profile
 * above all, so this narrows nothing M224 was written for.
 *
 * @param accountId - the sync account this device is signed into.
 * @returns `true` when a stored baseline names at least one entity besides the compartment.
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
  return Object.keys(parseSyncState(raw).baseline.perEntity).some((key) => key !== PRIVATE_STORE_ENTITY_KEY);
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

/**
 * The value every build before ADR-0022 wrote. It names nobody, so the owner
 * is worked out on read (`legacyLockOwner`). It is still WRITTEN, and only when
 * a lock has to be set and nothing says whose diary it holds.
 */
const LEGACY_DEVICE_LOCK_VALUE = 'locked';

/** The lock that names its owner (ADR-0022). An account id, and the address in its canonical form when it is known. */
const ownedLockSchema = z.object({
  v: z.literal(2),
  accountId: z.number().int(),
  email: z.string().nullable(),
});

/**
 * Whose diary a locked device holds.
 *
 * `email` is `null` for a lock an older build wrote: its owner is worked out
 * from the one baseline on the device, and a baseline carries an id and no
 * address. The address is canonical (`canonicalizeEmail`) whenever it is
 * known, so a comparison with a typed address is a plain `===`.
 */
export interface DeviceLockOwner {
  accountId: number;
  email: string | null;
}

/**
 * What the lock says, read without writing anything.
 *
 * `owner: null` is a device that is locked and cannot say for whom: a lock an
 * older build wrote on a device with no baseline, or with several. Every
 * account is refused there, the one that signed out included (ADR-0022).
 */
export type DeviceLock = { kind: 'unlocked' } | { kind: 'locked'; owner: DeviceLockOwner | null };

/** May a session for one account open on this device? */
export type DeviceOpenDecision = { kind: 'open' } | { kind: 'refuse'; owner: DeviceLockOwner | null };

/**
 * A session for one account was asked to open on a device that holds another
 * account's diary (ADR-0022).
 *
 * THROWN, never returned, by the guard in `openSyncVault` and again in
 * `openSyncSession`, so a flow that forgets to ask first fails CLOSED: no
 * vault, no cache row, no unlock. The flows that can ask first (sign-in, the
 * invitation, the reset) do, and turn the answer into the account-switch step
 * before anything reaches the server.
 */
export class DeviceHeldByAnotherAccountError extends Error {
  readonly owner: DeviceLockOwner | null;

  constructor({ owner }: { owner: DeviceLockOwner | null }) {
    super('This device holds another account’s diary; erase it before another account opens here.');
    this.name = 'DeviceHeldByAnotherAccountError';
    this.owner = owner;
  }
}

/**
 * Every key this storage holds, or none when it cannot list them.
 *
 * `localStorage` lists its keys by index. A storage that cannot is read as
 * holding no baselines, which for a legacy lock means "owner unknown" and
 * therefore the refusing direction.
 */
function listStorageKeys(storage: KeyValueStorage): string[] {
  const { key, length } = storage;
  if (key === undefined || length === undefined) return [];
  const keys: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const name = key.call(storage, index);
    if (name !== null) keys.push(name);
  }
  return keys;
}

/** A whole decimal account id and nothing else, so `1e3` and `0x10` are not ids. */
const ACCOUNT_ID_PATTERN = /^[0-9]+$/;

/**
 * Every per-account baseline key this device holds (ADR-0022).
 *
 * For the erase that hands the device to another account, which must take
 * every account's baseline and not only the owner's: a baseline left behind is
 * the silent empty diary `eraseDeviceData` describes, for whichever account it
 * names.
 *
 * @param storage - this device's storage by default.
 * @returns the keys, listed before any is removed.
 */
export function listSyncBaselineKeys(storage: KeyValueStorage = deviceStorage()): string[] {
  const prefix = `${STATE_KEY_PREFIX}:`;
  return listStorageKeys(storage).filter(
    (name) => name.startsWith(prefix) && ACCOUNT_ID_PATTERN.test(name.slice(prefix.length)),
  );
}

/**
 * The owner of a lock an older build wrote, or `null` when this device cannot
 * say.
 *
 * The one account whose baseline names an entity of its diary
 * (`hasSyncBaselineEntities`) is the account whose diary this is. No such
 * baseline, or several, and nobody can be named: the device then refuses every
 * account until it is erased, which is the cost ADR-0022 accepts for the
 * devices that carry an old lock.
 */
function legacyLockOwner(storage: KeyValueStorage): DeviceLockOwner | null {
  const prefix = `${STATE_KEY_PREFIX}:`;
  const owners = listSyncBaselineKeys(storage)
    .map((name) => Number(name.slice(prefix.length)))
    .filter((accountId) => Number.isSafeInteger(accountId) && hasSyncBaselineEntities({ accountId, storage }));
  const [only] = owners;
  if (owners.length !== 1 || only === undefined) return null;
  return { accountId: only, email: null };
}

/**
 * Parses one stored lock value. Exact, and never in the locking direction for
 * a value it does not recognise.
 *
 * Exact match rather than truthiness, for the same reason
 * `parseHomeHintCookie` is exact: an unrecognisable value means "not locked",
 * and locking somebody out of their own diary on a half-written string would
 * be the worse failure of the two. The owned lock is the one shape this build
 * writes; a JSON value of any other shape is the same unrecognisable string.
 *
 * @param raw - the stored value, or `null` for none.
 * @param storage - where the baselines live, read only for the legacy value.
 */
export function parseDeviceLock({ raw, storage }: { raw: string | null; storage: KeyValueStorage }): DeviceLock {
  if (raw === null) return { kind: 'unlocked' };
  if (raw === LEGACY_DEVICE_LOCK_VALUE) return { kind: 'locked', owner: legacyLockOwner(storage) };
  const owned = parseOwnedLock(raw);
  if (owned === null) return { kind: 'unlocked' };
  return { kind: 'locked', owner: owned };
}

/** The owner an owned lock names, or `null` for any value that is not one. */
function parseOwnedLock(raw: string): DeviceLockOwner | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const lock = ownedLockSchema.safeParse(parsed);
  if (!lock.success) return null;
  return { accountId: lock.data.accountId, email: lock.data.email };
}

/**
 * What this device's lock says. READING NEVER WRITES: a legacy value keeps its
 * legacy form, and its owner is worked out again on every read.
 *
 * @param storage - this device's storage by default; injected in tests.
 */
export function readDeviceLock(storage: KeyValueStorage = deviceStorage()): DeviceLock {
  return parseDeviceLock({ raw: storage.getItem(DEVICE_LOCK_KEY), storage });
}

/**
 * May a session for `accountId` open on a device whose lock says `lock`?
 *
 * Open when the device is unlocked, or when the lock names this very account.
 * Refused for everything else, the unknown owner included, and the refusal
 * carries the owner so the step can name whose diary it is.
 *
 * Pure, so every row is in `tests/unit/device-lock.test.ts`.
 */
export function decideDeviceOpen({ lock, accountId }: { lock: DeviceLock; accountId: number }): DeviceOpenDecision {
  if (lock.kind === 'unlocked') return { kind: 'open' };
  if (lock.owner !== null && lock.owner.accountId === accountId) return { kind: 'open' };
  return { kind: 'refuse', owner: lock.owner };
}

/**
 * Must the account-switch step come BEFORE the server is asked anything, for
 * an incoming account that is known only by its address?
 *
 * `true` when the device is locked and the address cannot be the owner's: the
 * owner is unknown, or the owner's address is known and differs. When the
 * owner is known only by its id (a legacy lock), the address decides nothing
 * and the answer depends on the flow. A sign-in or a reset reaches an EXISTING
 * account, so the core is asked who it is and the id decides
 * (`decideDeviceOpen`). An invitation always creates a NEW account, whose id
 * can never be the owner's, so the step comes first (`isNewAccount`).
 *
 * @param lock - what the lock says.
 * @param email - the incoming address, in any form; compared canonically.
 * @param isNewAccount - does this flow create the account it opens?
 */
export function isDeviceHeldFromEmail({
  lock,
  email,
  isNewAccount,
}: {
  lock: DeviceLock;
  email: string;
  isNewAccount: boolean;
}): boolean {
  if (lock.kind === 'unlocked') return false;
  if (lock.owner === null) return true;
  if (lock.owner.email === null) return isNewAccount;
  return lock.owner.email !== canonicalizeEmail(email);
}

/**
 * Throws {@link DeviceHeldByAnotherAccountError} unless a session for
 * `accountId` may open here.
 *
 * THE GUARD. It is the first statement of `openSyncVault` and of
 * `openSyncSession`, and it runs before a vault, a cache write or an unlock
 * exists, so a flow that never asked still cannot open another person's diary.
 */
export function assertDeviceMayOpen({
  accountId,
  storage = deviceStorage(),
}: {
  accountId: number;
  storage?: KeyValueStorage;
}): void {
  const decision = decideDeviceOpen({ lock: readDeviceLock(storage), accountId });
  if (decision.kind === 'refuse') throw new DeviceHeldByAnotherAccountError({ owner: decision.owner });
}

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
 * the device (`InstancePolicy.signOutClosesTheDiary`).
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
 * ── It names its owner (ADR-0022) ────────────────────────────────────────
 *
 * The marker used to be the bare word `locked`, and any session that opened
 * lifted it. A second account signing in on a shared device therefore opened
 * the first person's diary, and its first sync pushed that diary into the
 * second account. The lock now records whose diary it closes, and only that
 * account's session may lift it (`releaseDeviceLockForOwner`); every other
 * account is refused until the diary is erased.
 *
 * A KNOWN OWNER IS NEVER DOWNGRADED. With `owner: null` (nothing at hand says
 * whose diary this is) the legacy value is written only where no owned lock
 * stands already, because replacing a named owner with nobody would refuse
 * that owner their own diary.
 *
 * @param owner - whose diary the device now holds, or `null` when no caller can say.
 * @param storage - defaults to this device's storage; injected in tests.
 */
export function lockDevice({
  owner,
  storage = deviceStorage(),
}: {
  owner: DeviceLockOwner | null;
  storage?: KeyValueStorage;
}): void {
  if (owner !== null) {
    const email = owner.email === null ? null : canonicalizeEmail(owner.email);
    storage.setItem(DEVICE_LOCK_KEY, JSON.stringify({ v: 2, accountId: owner.accountId, email }));
    return;
  }
  const current = storage.getItem(DEVICE_LOCK_KEY);
  if (current !== null && parseOwnedLock(current) !== null) return;
  storage.setItem(DEVICE_LOCK_KEY, LEGACY_DEVICE_LOCK_VALUE);
}

/**
 * Lifts the lock for the account it names. Called ONLY from
 * `openSyncSession`, so signing back in as the owner is the one way a locked
 * device becomes readable again without an erase, and every path that opens a
 * session gets it without remembering to.
 *
 * It re-asks the guard first, and throws for any other account: a lock never
 * lifts for somebody it does not name, whatever the caller already checked.
 * An unlocked device is left as it is.
 *
 * @throws DeviceHeldByAnotherAccountError when the lock names another account, or nobody.
 */
export function releaseDeviceLockForOwner({
  accountId,
  storage = deviceStorage(),
}: {
  accountId: number;
  storage?: KeyValueStorage;
}): void {
  assertDeviceMayOpen({ accountId, storage });
  if (readDeviceLock(storage).kind === 'unlocked') return;
  storage.removeItem(DEVICE_LOCK_KEY);
}

/**
 * Lifts the lock whoever it names. ONLY for `account-switch.ts`, after the
 * held diary and every baseline are gone from this device (ADR-0022).
 *
 * Nothing is held any more at that point, so there is nobody for the lock to
 * protect. A unit source test keeps every other module from calling this; an
 * erase that failed never reaches it, and the lock stays.
 */
export function clearDeviceLockAfterErase(storage: KeyValueStorage = deviceStorage()): void {
  storage.removeItem(DEVICE_LOCK_KEY);
}

/**
 * Does a session the SERVER ended lock this device, the way pressing sign out
 * does?
 *
 * ── Why a setting and not a read ─────────────────────────────────────────
 *
 * The question is `InstancePolicy.signOutClosesTheDiary`, and the policy arrives
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
 * Is this device locked, for anybody? The onboarding gate's question, which
 * keeps its boolean shape: the gate closes the diary to a device with no
 * session whoever the owner is (`onboarding-gate.ts`).
 */
export function isDeviceLocked(storage: KeyValueStorage = deviceStorage()): boolean {
  return readDeviceLock(storage).kind === 'locked';
}

/** An in-memory {@link KeyValueStorage}, for tests and for the SSR/no-storage fallback. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}
