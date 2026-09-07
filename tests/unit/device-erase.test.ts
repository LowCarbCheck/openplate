/**
 * Unit tests for `#app/lib/local-store/device-erase`: what an opt-in erase
 * takes off the device.
 *
 * ONE of these matters more than the rest, and it is the silent-empty-diary
 * case: the diary is IndexedDB and the sync baseline is a localStorage key, so
 * an erase that removes the first and leaves the second produces a device that
 * signs back in, is told by its own baseline that it is up to date, downloads
 * nothing, and shows an EMPTY diary with no error anywhere. Nobody sees a
 * failure; a person just has no record. That is why the assertion below is
 * about the two together and not about either one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { eraseDeviceData, ERASED_DATABASES, type DeviceEraseDeps } from '../../app/lib/local-store/device-erase';
import { createMemoryStorage, syncBaselineStorageKey } from '../../app/lib/sync/sync-state';
import { OUTBOX_DB_NAME, PHOTOS_DB_NAME, PRIMARY_DB_NAME } from '../../app/lib/local-store/store';

const ACCOUNT_ID = 42;

/** A recording stand-in for `indexedDB.deleteDatabase`, optionally failing on one name. */
function fakeDeps({ failOn }: { failOn?: string } = {}): DeviceEraseDeps & { deleted: string[] } {
  const deleted: string[] = [];
  const storage = createMemoryStorage({
    [syncBaselineStorageKey(ACCOUNT_ID)]: JSON.stringify({ formatVersion: 1, lastBlobVersion: 9 }),
    'openplate.sync.device-id': 'device-1',
  });
  return {
    deleted,
    storage,
    deleteDatabase: async (name) => {
      if (name === failOn) throw new Error(`${name} is open in another tab`);
      deleted.push(name);
    },
  };
}

describe('eraseDeviceData', () => {
  it('takes the diary, the photos and the outbox', async () => {
    const deps = fakeDeps();
    await eraseDeviceData({ accountId: ACCOUNT_ID }, deps);

    assert.deepEqual(deps.deleted, [PRIMARY_DB_NAME, PHOTOS_DB_NAME, OUTBOX_DB_NAME]);
    assert.deepEqual([...ERASED_DATABASES], deps.deleted, 'the exported list is what actually gets deleted');
  });

  it('takes the account baseline whenever it takes the diary, which is the silent-empty-diary case', async () => {
    const deps = fakeDeps();
    const key = syncBaselineStorageKey(ACCOUNT_ID);
    assert.notEqual(deps.storage.getItem(key), null, 'the baseline is there to begin with');

    await eraseDeviceData({ accountId: ACCOUNT_ID }, deps);

    assert.ok(deps.deleted.includes(PRIMARY_DB_NAME), 'the diary is gone');
    assert.equal(deps.storage.getItem(key), null, 'so the baseline is gone with it');
  });

  it('drops the baseline even when a database delete fails, so the failure never fakes a fresh sync', async () => {
    // The ordering claim, asserted rather than read: the baseline goes first,
    // so the surviving state is "diary present, baseline absent" (the next
    // sign-in re-downloads and merges) and never the reverse.
    const deps = fakeDeps({ failOn: PHOTOS_DB_NAME });

    await assert.rejects(() => eraseDeviceData({ accountId: ACCOUNT_ID }, deps));

    assert.equal(deps.storage.getItem(syncBaselineStorageKey(ACCOUNT_ID)), null);
  });

  it('refuses to report success when a database could not be deleted', async () => {
    const deps = fakeDeps({ failOn: PRIMARY_DB_NAME });
    await assert.rejects(
      () => eraseDeviceData({ accountId: ACCOUNT_ID }, deps),
      /another tab/,
      'an erase blocked by a second tab must surface, not resolve',
    );
  });

  it('leaves the device id alone, because it is not a diary and no account owns it', async () => {
    const deps = fakeDeps();
    await eraseDeviceData({ accountId: ACCOUNT_ID }, deps);
    assert.equal(deps.storage.getItem('openplate.sync.device-id'), 'device-1');
  });

  it('still clears the databases for a device that holds no account', async () => {
    const deps = fakeDeps();
    await eraseDeviceData({ accountId: null }, deps);
    assert.deepEqual(deps.deleted, [PRIMARY_DB_NAME, PHOTOS_DB_NAME, OUTBOX_DB_NAME]);
    // Nothing to remove: a device with no account never wrote a baseline for one.
    assert.notEqual(deps.storage.getItem(syncBaselineStorageKey(ACCOUNT_ID)), null);
  });
});
