/**
 * Unit tests for `shouldLeave`, the decision behind
 * `use-leave-when-another-tab-signs-out.ts`: when does a `storage` event from
 * another tab mean this tab must leave the diary?
 *
 * Every row is a control for the others. A rule that sent every tab away on any
 * change would pass the "leaves" rows and fail the "stays" rows, and the other
 * way round.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVICE_LOCK_STORAGE_KEY,
  shouldLeave,
  type StorageChange,
} from '../../app/hooks/use-leave-when-another-tab-signs-out';
import { lockDevice, syncBaselineStorageKey, type KeyValueStorage } from '../../app/lib/sync/sync-state';

const OWN_KEY = syncBaselineStorageKey(7);
const OTHER_ACCOUNT_KEY = syncBaselineStorageKey(8);

const ROWS: Array<{ name: string; change: StorageChange; leaves: boolean }> = [
  {
    name: 'the lock set to its current value leaves',
    change: { key: DEVICE_LOCK_STORAGE_KEY, newValue: 'locked', ownBaselineKey: OWN_KEY },
    leaves: true,
  },
  {
    name: 'the lock set to JSON, the format another change may give it, leaves',
    change: { key: DEVICE_LOCK_STORAGE_KEY, newValue: '{"reason":"signed-out","at":1}', ownBaselineKey: OWN_KEY },
    leaves: true,
  },
  {
    name: 'the lock set to garbage that parses as nothing still leaves, the value is never read',
    change: { key: DEVICE_LOCK_STORAGE_KEY, newValue: '{not json', ownBaselineKey: OWN_KEY },
    leaves: true,
  },
  {
    name: 'the lock set while no account is open in this tab still leaves',
    change: { key: DEVICE_LOCK_STORAGE_KEY, newValue: 'locked', ownBaselineKey: null },
    leaves: true,
  },
  {
    name: 'the lock removed, which is a sign-in, does NOT leave',
    change: { key: DEVICE_LOCK_STORAGE_KEY, newValue: null, ownBaselineKey: OWN_KEY },
    leaves: false,
  },
  {
    name: 'this tab own baseline removed, which is what an erase does first, leaves',
    change: { key: OWN_KEY, newValue: null, ownBaselineKey: OWN_KEY },
    leaves: true,
  },
  {
    name: 'this tab own baseline rewritten, an ordinary sync cycle, does NOT leave',
    change: { key: OWN_KEY, newValue: '{"perEntity":{}}', ownBaselineKey: OWN_KEY },
    leaves: false,
  },
  {
    name: 'another account baseline removed does NOT leave',
    change: { key: OTHER_ACCOUNT_KEY, newValue: null, ownBaselineKey: OWN_KEY },
    leaves: false,
  },
  {
    name: 'a baseline removed while no account is open in this tab does NOT leave',
    change: { key: OWN_KEY, newValue: null, ownBaselineKey: null },
    leaves: false,
  },
  {
    name: 'an unrelated key removed does NOT leave',
    change: { key: 'openplate.theme', newValue: null, ownBaselineKey: OWN_KEY },
    leaves: false,
  },
  {
    name: 'an unrelated key set does NOT leave',
    change: { key: 'openplate.theme', newValue: 'dark', ownBaselineKey: OWN_KEY },
    leaves: false,
  },
  {
    name: 'a whole-storage clear (key null) does NOT leave, nothing here clears storage',
    change: { key: null, newValue: null, ownBaselineKey: OWN_KEY },
    leaves: false,
  },
];

describe('shouldLeave', () => {
  for (const { name, change, leaves } of ROWS) {
    it(name, () => {
      assert.equal(shouldLeave(change), leaves);
    });
  }

  it('has rows on both sides, so a constant answer fails one of them', () => {
    assert.ok(ROWS.some((row) => row.leaves));
    assert.ok(ROWS.some((row) => !row.leaves));
  });
});

describe('the lock key this listener watches', () => {
  it('is the key lockDevice really writes', () => {
    const written: string[] = [];
    const recording: KeyValueStorage = {
      getItem: () => null,
      setItem: (key) => void written.push(key),
      removeItem: () => undefined,
    };
    lockDevice(recording);
    assert.deepEqual(written, [DEVICE_LOCK_STORAGE_KEY]);
  });
});
