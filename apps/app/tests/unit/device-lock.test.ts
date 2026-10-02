/**
 * The device lock names its owner (ADR-0022): how a stored value is read, who
 * may open a session on it, and how a lock is written.
 *
 * ── The defect behind every row ──────────────────────────────────────────
 *
 * The lock used to be the bare word `locked`, and any session lifted it, so a
 * second account on a shared managed device opened the first person's diary
 * and pushed it into its own account. The rows below hold the three halves of
 * the fix: a value is read exactly and never in the locking direction for
 * garbage, only the named owner opens, and a named owner is never replaced by
 * nobody.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Each refusal table carries the row that must OPEN ("same account opens"), so
 * a `decideDeviceOpen` that refused everything would fail it. The no-write
 * check first proves its recorder sees a write.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearDeviceLockAfterErase,
  createMemoryStorage,
  decideDeviceOpen,
  DeviceHeldByAnotherAccountError,
  isDeviceHeldFromEmail,
  isDeviceLocked,
  listSyncBaselineKeys,
  lockDevice,
  parseDeviceLock,
  readDeviceLock,
  releaseDeviceLockForOwner,
  syncBaselineStorageKey,
  type DeviceLock,
  type KeyValueStorage,
} from '../../app/lib/sync/sync-state';

const LOCK_KEY = 'openplate.device-locked';

/** A baseline that names one diary entity, so `hasSyncBaselineEntities` counts it. */
const BASELINE_WITH_A_DIARY = JSON.stringify({
  formatVersion: 1,
  lastBlobVersion: 3,
  lastSyncedAt: null,
  baseline: { perEntity: { 'foodLog:soup': { lamport: 1, deviceId: 'd', hash: 'h' } }, tombstones: [] },
});

/** A baseline with no entity of a diary: a device that synced nothing of one. */
const EMPTY_BASELINE = JSON.stringify({
  formatVersion: 1,
  lastBlobVersion: 1,
  lastSyncedAt: null,
  baseline: { perEntity: {}, tombstones: [] },
});

const OWNED_BY_7 = JSON.stringify({ v: 2, accountId: 7, email: 'anna@example.org' });

/** A storage holding these keys. */
function storageWith(entries: Record<string, string>): KeyValueStorage {
  return createMemoryStorage(entries);
}

/** A storage, and every write and removal made to it. */
interface RecordingStorage {
  storage: KeyValueStorage;
  writes: string[];
}

/** A storage that records every write and removal, around a memory one. */
function recordingStorage(entries: Record<string, string>): RecordingStorage {
  const inner = createMemoryStorage(entries);
  const writes: string[] = [];
  return {
    writes,
    storage: {
      getItem: (key) => inner.getItem(key),
      setItem: (key, value) => {
        writes.push(`set ${key}`);
        inner.setItem(key, value);
      },
      removeItem: (key) => {
        writes.push(`remove ${key}`);
        inner.removeItem(key);
      },
      get length() {
        return inner.length;
      },
      key: (index) => inner.key?.(index) ?? null,
    },
  };
}

describe('parseDeviceLock', () => {
  test('no value is unlocked', () => {
    assert.deepEqual(parseDeviceLock({ raw: null, storage: storageWith({}) }), { kind: 'unlocked' });
  });

  test('the owned value names its owner', () => {
    assert.deepEqual(parseDeviceLock({ raw: OWNED_BY_7, storage: storageWith({}) }), {
      kind: 'locked',
      owner: { accountId: 7, email: 'anna@example.org' },
    });
  });

  test('the old value is locked, owned by the one account whose baseline holds a diary', () => {
    const storage = storageWith({
      [syncBaselineStorageKey(7)]: BASELINE_WITH_A_DIARY,
      [syncBaselineStorageKey(9)]: EMPTY_BASELINE,
    });
    assert.deepEqual(parseDeviceLock({ raw: 'locked', storage }), {
      kind: 'locked',
      owner: { accountId: 7, email: null },
    });
  });

  test('the old value with no such baseline, or with two, is locked for an owner nobody can name', () => {
    assert.deepEqual(parseDeviceLock({ raw: 'locked', storage: storageWith({}) }), { kind: 'locked', owner: null });
    const two = storageWith({
      [syncBaselineStorageKey(7)]: BASELINE_WITH_A_DIARY,
      [syncBaselineStorageKey(9)]: BASELINE_WITH_A_DIARY,
    });
    assert.deepEqual(parseDeviceLock({ raw: 'locked', storage: two }), { kind: 'locked', owner: null });
  });

  test('a storage that cannot list its keys reads the old value as owner unknown, the refusing direction', () => {
    const map = new Map([[syncBaselineStorageKey(7), BASELINE_WITH_A_DIARY]]);
    const unlistable: KeyValueStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    };
    assert.deepEqual(parseDeviceLock({ raw: 'locked', storage: unlistable }), { kind: 'locked', owner: null });
  });

  for (const raw of ['yes', 'Locked', 'locked ', '', 'true', '{', 'null', '42']) {
    test(`garbage ${JSON.stringify(raw)} is unlocked, never a lock-out`, () => {
      assert.deepEqual(parseDeviceLock({ raw, storage: storageWith({}) }), { kind: 'unlocked' });
    });
  }

  for (const raw of [
    JSON.stringify({ v: 3, accountId: 7, email: null }),
    JSON.stringify({ v: 2, accountId: '7', email: null }),
    JSON.stringify({ v: 2, accountId: 7.5, email: null }),
    JSON.stringify({ v: 2, email: 'anna@example.org' }),
    JSON.stringify({ accountId: 7, email: null }),
    JSON.stringify([2, 7]),
  ]) {
    test(`JSON of the wrong shape ${raw} is unlocked`, () => {
      assert.deepEqual(parseDeviceLock({ raw, storage: storageWith({}) }), { kind: 'unlocked' });
    });
  }
});

describe('decideDeviceOpen', () => {
  const ROWS: ReadonlyArray<{ name: string; lock: DeviceLock; accountId: number; expected: 'open' | 'refuse' }> = [
    { name: 'unlocked opens for anyone', lock: { kind: 'unlocked' }, accountId: 9, expected: 'open' },
    {
      name: 'CONTROL: the same account opens',
      lock: { kind: 'locked', owner: { accountId: 7, email: 'anna@example.org' } },
      accountId: 7,
      expected: 'open',
    },
    {
      name: 'another account is refused',
      lock: { kind: 'locked', owner: { accountId: 7, email: 'anna@example.org' } },
      accountId: 9,
      expected: 'refuse',
    },
    {
      name: 'the old value opens for its derived owner',
      lock: { kind: 'locked', owner: { accountId: 7, email: null } },
      accountId: 7,
      expected: 'open',
    },
    {
      name: 'the old value refuses another account',
      lock: { kind: 'locked', owner: { accountId: 7, email: null } },
      accountId: 9,
      expected: 'refuse',
    },
    {
      name: 'an owner nobody can name refuses every account',
      lock: { kind: 'locked', owner: null },
      accountId: 7,
      expected: 'refuse',
    },
  ];

  for (const row of ROWS) {
    test(row.name, () => {
      const decision = decideDeviceOpen({ lock: row.lock, accountId: row.accountId });
      assert.equal(decision.kind, row.expected);
      if (decision.kind === 'refuse') {
        // The refusal carries the owner, so the step can name whose diary it is.
        assert.deepEqual(decision.owner, row.lock.kind === 'locked' ? row.lock.owner : null);
      }
    });
  }
});

describe('isDeviceHeldFromEmail', () => {
  const known: DeviceLock = { kind: 'locked', owner: { accountId: 7, email: 'anna@example.org' } };
  const byIdOnly: DeviceLock = { kind: 'locked', owner: { accountId: 7, email: null } };
  const nobody: DeviceLock = { kind: 'locked', owner: null };

  test('CONTROL: the owner address, in any case and with spaces, is not held', () => {
    assert.equal(isDeviceHeldFromEmail({ lock: known, email: '  Anna@Example.ORG ', isNewAccount: false }), false);
  });

  test('another address is held, before the server is asked', () => {
    assert.equal(isDeviceHeldFromEmail({ lock: known, email: 'ben@example.org', isNewAccount: false }), true);
  });

  test('an unlocked device holds nothing', () => {
    assert.equal(
      isDeviceHeldFromEmail({ lock: { kind: 'unlocked' }, email: 'ben@example.org', isNewAccount: true }),
      false,
    );
  });

  test('an owner known only by id: a sign-in asks the core, an invitation is held', () => {
    assert.equal(isDeviceHeldFromEmail({ lock: byIdOnly, email: 'ben@example.org', isNewAccount: false }), false);
    assert.equal(isDeviceHeldFromEmail({ lock: byIdOnly, email: 'ben@example.org', isNewAccount: true }), true);
  });

  test('an owner nobody can name holds every address', () => {
    assert.equal(isDeviceHeldFromEmail({ lock: nobody, email: 'anna@example.org', isNewAccount: false }), true);
  });
});

describe('lockDevice', () => {
  test('a known owner is written as the owned value, with its address canonical', () => {
    const storage = storageWith({});
    lockDevice({ owner: { accountId: 7, email: ' Anna@Example.org' }, storage });
    assert.deepEqual(readDeviceLock(storage), { kind: 'locked', owner: { accountId: 7, email: 'anna@example.org' } });
  });

  test('NEVER DOWNGRADES: an unknown owner leaves an owned lock exactly as it was', () => {
    const storage = storageWith({ [LOCK_KEY]: OWNED_BY_7 });
    lockDevice({ owner: null, storage });
    assert.equal(storage.getItem(LOCK_KEY), OWNED_BY_7);
  });

  test('CONTROL: an unknown owner on an unlocked device writes the old value, so it does write', () => {
    const storage = storageWith({});
    lockDevice({ owner: null, storage });
    assert.equal(storage.getItem(LOCK_KEY), 'locked');
    assert.equal(isDeviceLocked(storage), true);
  });

  test('an unknown owner over garbage writes the old value, which locks', () => {
    const storage = storageWith({ [LOCK_KEY]: 'nonsense' });
    lockDevice({ owner: null, storage });
    assert.equal(storage.getItem(LOCK_KEY), 'locked');
  });
});

describe('reading never writes', () => {
  test('CONTROL: the recorder sees a write when one happens', () => {
    const { storage, writes } = recordingStorage({});
    lockDevice({ owner: null, storage });
    assert.deepEqual(writes, [`set ${LOCK_KEY}`]);
  });

  test('reading an old value, its owner derived from the baselines, writes nothing at all', () => {
    const { storage, writes } = recordingStorage({
      [LOCK_KEY]: 'locked',
      [syncBaselineStorageKey(7)]: BASELINE_WITH_A_DIARY,
    });
    assert.deepEqual(readDeviceLock(storage), { kind: 'locked', owner: { accountId: 7, email: null } });
    isDeviceLocked(storage);
    decideDeviceOpen({ lock: readDeviceLock(storage), accountId: 9 });
    assert.deepEqual(writes, []);
    assert.equal(storage.getItem(LOCK_KEY), 'locked', 'the old value keeps its old form');
  });
});

describe('releaseDeviceLockForOwner', () => {
  test('the owner lifts its own lock', () => {
    const storage = storageWith({ [LOCK_KEY]: OWNED_BY_7 });
    releaseDeviceLockForOwner({ accountId: 7, storage });
    assert.equal(isDeviceLocked(storage), false);
  });

  test('another account is refused and the lock stays', () => {
    const storage = storageWith({ [LOCK_KEY]: OWNED_BY_7 });
    assert.throws(() => releaseDeviceLockForOwner({ accountId: 9, storage }), DeviceHeldByAnotherAccountError);
    assert.equal(storage.getItem(LOCK_KEY), OWNED_BY_7);
  });

  test('an unlocked device is left as it is', () => {
    const { storage, writes } = recordingStorage({});
    releaseDeviceLockForOwner({ accountId: 9, storage });
    assert.deepEqual(writes, []);
  });
});

describe('clearDeviceLockAfterErase and the baseline list', () => {
  test('lifts the lock whoever it names', () => {
    const storage = storageWith({ [LOCK_KEY]: OWNED_BY_7 });
    clearDeviceLockAfterErase(storage);
    assert.equal(isDeviceLocked(storage), false);
  });

  test('lists every per-account baseline and nothing that only looks like one', () => {
    const storage = storageWith({
      [syncBaselineStorageKey(7)]: EMPTY_BASELINE,
      [syncBaselineStorageKey(12)]: EMPTY_BASELINE,
      'openplate.sync.state.v1:': '{}',
      'openplate.sync.state.v1:x': '{}',
      'openplate.sync.device-id': 'device',
      [LOCK_KEY]: OWNED_BY_7,
    });
    assert.deepEqual(listSyncBaselineKeys(storage).toSorted(), [syncBaselineStorageKey(12), syncBaselineStorageKey(7)]);
  });
});
