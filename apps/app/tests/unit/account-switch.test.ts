/**
 * The account-switch erase and the step's read of the held diary (ADR-0023).
 *
 * ── The order the erase must keep ────────────────────────────────────────
 *
 * The stores stopped, then every baseline, then the databases, then the lock,
 * and the lock only when the databases are gone. A device whose erase failed
 * still holds the diary,
 * so it must stay locked: the CONTROL makes the second delete fail and the
 * lock is still there. The success case reads the removal of the lock from
 * the same log as the deletes, so "after the last delete" is a statement about
 * order and not about the end state alone.
 *
 * ── The read is settled before it returns ────────────────────────────────
 *
 * The step is drawn once, so a read that throws or never answers must still
 * come back as a finished set of lines: "could not be checked", never
 * "checking".
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  eraseDiaryAndReleaseLock,
  HELD_DIARY_READ_DEADLINE_MS,
  readHeldDiaryNotice,
  type DiaryEraseDeps,
} from '../../app/lib/sync/account-switch';
import { ERASED_DATABASES } from '../../app/lib/local-store/device-erase';
import type { UnsentOnDevice } from '../../app/lib/sync/erase-notice';
import {
  createMemoryStorage,
  isDeviceLocked,
  listSyncBaselineKeys,
  syncBaselineStorageKey,
  type KeyValueStorage,
} from '../../app/lib/sync/sync-state';

const LOCK_KEY = 'openplate.device-locked';

const STOP_STORES = 'stop stores';

/** The store stop, storage and database deletes, writing one shared log, so their ORDER can be read. */
function loggedDeps({ failOn }: { failOn?: string } = {}): DiaryEraseDeps & {
  log: string[];
  storage: KeyValueStorage;
} {
  const log: string[] = [];
  const inner = createMemoryStorage({
    [LOCK_KEY]: JSON.stringify({ v: 2, accountId: 7, email: 'anna@example.org' }),
    [syncBaselineStorageKey(7)]: '{}',
    [syncBaselineStorageKey(12)]: '{}',
    'openplate.sync.device-id': 'device-1',
  });
  const storage: KeyValueStorage = {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => inner.setItem(key, value),
    removeItem: (key) => {
      log.push(`remove ${key}`);
      inner.removeItem(key);
    },
    get length() {
      return inner.length;
    },
    key: (index) => inner.key?.(index) ?? null,
  };
  return {
    log,
    storage,
    stopStores: async () => {
      log.push(STOP_STORES);
    },
    deleteDatabase: async (name) => {
      if (name === failOn) throw new Error(`${name} is open in another tab`);
      log.push(`delete ${name}`);
    },
  };
}

/**
 * Throws unless the stores were stopped before anything was erased: before the
 * first delete, and before the first baseline removal, which is what sends
 * another tab away. A store still running when a database goes recreates it.
 */
function assertStoresStoppedFirst(log: readonly string[]): void {
  const stopped = log.indexOf(STOP_STORES);
  const firstErase = log.findIndex((entry) => entry.startsWith('delete ') || entry.startsWith('remove '));
  assert.ok(stopped >= 0, `the stores were never stopped: ${log.join(', ')}`);
  assert.ok(firstErase >= 0, 'the log saw no erase, so the order proves nothing');
  assert.ok(stopped < firstErase, `the stores were stopped after the erase began: ${log.join(', ')}`);
}

describe('eraseDiaryAndReleaseLock', () => {
  it('stops every store before the first delete and before the first baseline goes', async () => {
    const deps = loggedDeps();
    await eraseDiaryAndReleaseLock({ accountId: 7 }, deps);
    assertStoresStoppedFirst(deps.log);
  });

  it('CONTROL: the order check fails for a log where the stop came after a delete', () => {
    const swapped = ['remove openplate.sync.state.v1:7', `delete ${ERASED_DATABASES[0]}`, STOP_STORES];
    assert.throws(() => assertStoresStoppedFirst(swapped), /stopped after the erase began/);
    const stopBetween = [`delete ${ERASED_DATABASES[0]}`, STOP_STORES, `delete ${ERASED_DATABASES[1]}`];
    assert.throws(() => assertStoresStoppedFirst(stopBetween), /stopped after the erase began/);
    assert.throws(() => assertStoresStoppedFirst([`delete ${ERASED_DATABASES[0]}`]), /never stopped/);
  });

  it('takes every baseline and every database, and lifts the lock after the last delete', async () => {
    const deps = loggedDeps();
    await eraseDiaryAndReleaseLock({ accountId: 7 }, deps);

    assert.deepEqual(listSyncBaselineKeys(deps.storage), [], 'a baseline outlived the erase');
    assert.equal(isDeviceLocked(deps.storage), false, 'the lock outlived a finished erase');
    assert.equal(
      deps.storage.getItem('openplate.sync.device-id'),
      'device-1',
      'the erase took a key that is not a baseline',
    );

    const lastDelete = Math.max(...ERASED_DATABASES.map((name) => deps.log.indexOf(`delete ${name}`)));
    const lockRemoved = deps.log.indexOf(`remove ${LOCK_KEY}`);
    const firstDelete = Math.min(...ERASED_DATABASES.map((name) => deps.log.indexOf(`delete ${name}`)));
    const baselinesRemoved = [7, 12].map((id) => deps.log.indexOf(`remove ${syncBaselineStorageKey(id)}`));
    assert.ok(lastDelete >= 0, 'the log saw no delete, so the order below proves nothing');
    assert.ok(lockRemoved > lastDelete, `the lock went before the last delete: ${deps.log.join(', ')}`);
    for (const index of baselinesRemoved)
      assert.ok(index >= 0 && index < firstDelete, 'a baseline went after a delete');
  });

  it('CONTROL: an erase that fails keeps the lock, so a device still holding the diary stays closed', async () => {
    const deps = loggedDeps({ failOn: ERASED_DATABASES[1] });
    await assert.rejects(() => eraseDiaryAndReleaseLock({ accountId: 7 }, deps));
    assert.equal(isDeviceLocked(deps.storage), true);
    assert.equal(deps.log.includes(`remove ${LOCK_KEY}`), false);
  });

  it('on a device with no lock, as on an open instance, still erases and leaves it unlocked', async () => {
    const deps = loggedDeps();
    deps.storage.removeItem(LOCK_KEY);
    deps.log.length = 0;
    await eraseDiaryAndReleaseLock({ accountId: null }, deps);
    assert.equal(isDeviceLocked(deps.storage), false);
    assert.deepEqual(listSyncBaselineKeys(deps.storage), []);
    assert.equal(deps.log.filter((entry) => entry.startsWith('delete ')).length, ERASED_DATABASES.length);
  });
});

const NOTHING_UNSENT: UnsentOnDevice = {
  changes: 0,
  reports: 0,
  hasUnsentSavedMeals: false,
  hasOwnerPrivateRows: false,
};

describe('readHeldDiaryNotice', () => {
  it('reads the OWNER baseline and says what an erase would lose', async () => {
    const asked: number[] = [];
    const lines = await readHeldDiaryNotice({
      owner: { accountId: 7, email: 'anna@example.org' },
      read: async ({ accountId }) => {
        asked.push(accountId);
        return { ...NOTHING_UNSENT, changes: 3 };
      },
    });
    assert.deepEqual(asked, [7]);
    assert.deepEqual(lines, [{ kind: 'unsent-changes', count: 3 }]);
  });

  it('with no owner compares against an empty baseline, so every row counts', async () => {
    const lines = await readHeldDiaryNotice({
      owner: null,
      read: async ({ storage }) => {
        assert.ok(storage !== undefined, 'an unknown owner must not read this device baselines');
        assert.equal(storage.getItem(syncBaselineStorageKey(0)), null);
        return NOTHING_UNSENT;
      },
    });
    assert.deepEqual(lines, [{ kind: 'all-sent' }]);
  });

  it('a read that throws is settled as "could not be checked", never as an all-clear', async () => {
    const lines = await readHeldDiaryNotice({
      owner: { accountId: 7, email: null },
      read: async () => {
        throw new Error('the store would not open');
      },
    });
    assert.deepEqual(lines, [{ kind: 'unchecked' }]);
  });

  it('a read that never answers is settled at the deadline', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = readHeldDiaryNotice({
        owner: { accountId: 7, email: null },
        read: () => new Promise<UnsentOnDevice>(() => undefined),
      });
      mock.timers.tick(HELD_DIARY_READ_DEADLINE_MS);
      assert.deepEqual(await pending, [{ kind: 'unchecked' }]);
    } finally {
      mock.timers.reset();
    }
  });
});
