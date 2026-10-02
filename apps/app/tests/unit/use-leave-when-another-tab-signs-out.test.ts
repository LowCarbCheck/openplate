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

import { shouldLeave, type StorageChange } from '../../app/hooks/use-leave-when-another-tab-signs-out';
import {
  DEVICE_LOCK_KEY,
  lockDevice,
  syncBaselineStorageKey,
  type KeyValueStorage,
} from '../../app/lib/sync/sync-state';

const OWN_KEY = syncBaselineStorageKey(7);
const OTHER_ACCOUNT_KEY = syncBaselineStorageKey(8);

const ROWS: Array<{ name: string; change: StorageChange; leaves: boolean }> = [
  {
    name: 'the lock set to its current value leaves',
    change: { key: DEVICE_LOCK_KEY, newValue: 'locked', ownBaselineKey: OWN_KEY },
    leaves: true,
  },
  {
    name: 'the lock set to JSON, the format another change may give it, leaves',
    change: { key: DEVICE_LOCK_KEY, newValue: '{"reason":"signed-out","at":1}', ownBaselineKey: OWN_KEY },
    leaves: true,
  },
  {
    name: 'the lock set to garbage that parses as nothing still leaves, the value is never read',
    change: { key: DEVICE_LOCK_KEY, newValue: '{not json', ownBaselineKey: OWN_KEY },
    leaves: true,
  },
  {
    name: 'the lock set while no account is open in this tab still leaves',
    change: { key: DEVICE_LOCK_KEY, newValue: 'locked', ownBaselineKey: null },
    leaves: true,
  },
  {
    name: 'the lock removed, which is a sign-in, does NOT leave',
    change: { key: DEVICE_LOCK_KEY, newValue: null, ownBaselineKey: OWN_KEY },
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

/** What {@link recordingStorage} hands back: a storage, and every write it saw as `[key, value]`. */
interface RecordingStorage {
  storage: KeyValueStorage;
  written: Array<[string, string]>;
}

/** A storage that records every key written and the value it got. */
function recordingStorage(): RecordingStorage {
  const written: Array<[string, string]> = [];
  const storage: KeyValueStorage = {
    getItem: () => null,
    setItem: (key, value) => void written.push([key, value]),
    removeItem: () => undefined,
  };
  return { storage, written };
}

describe('the lock key this listener watches', () => {
  it('is the key lockDevice really writes, for an owned lock', () => {
    const { storage, written } = recordingStorage();
    lockDevice({ owner: { accountId: 7, email: 'anna@example.org' }, storage });
    assert.deepEqual(
      written.map(([key]) => key),
      [DEVICE_LOCK_KEY],
    );
  });

  it('is the key lockDevice really writes, for a lock that names nobody', () => {
    const { storage, written } = recordingStorage();
    lockDevice({ owner: null, storage });
    assert.deepEqual(
      written.map(([key]) => key),
      [DEVICE_LOCK_KEY],
    );
  });

  it('leaves for whatever value lockDevice wrote, whichever format it is', () => {
    const { storage, written } = recordingStorage();
    lockDevice({ owner: { accountId: 7, email: 'anna@example.org' }, storage });
    lockDevice({ owner: null, storage });
    assert.equal(written.length, 2);
    for (const [key, value] of written) {
      assert.equal(shouldLeave({ key, newValue: value, ownBaselineKey: OWN_KEY }), true);
    }
  });

  it('CONTROL: a key that is not the lock key does not leave, so the rows above name the real one', () => {
    assert.equal(shouldLeave({ key: 'openplate.device-lock', newValue: 'x', ownBaselineKey: OWN_KEY }), false);
  });
});
