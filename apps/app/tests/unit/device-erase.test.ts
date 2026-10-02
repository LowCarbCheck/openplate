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
import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteIndexedDbDatabase,
  eraseDeviceData,
  ERASED_DATABASES,
  type DeviceEraseDeps,
} from '../../app/lib/local-store/device-erase';
import { createMemoryStorage, syncBaselineStorageKey } from '../../app/lib/sync/sync-state';
import { OUTBOX_DB_NAME, PHOTOS_DB_NAME, PRIMARY_DB_NAME } from '../../app/lib/local-store/store';
import { MACRO_SHARE_BASIS_STORAGE_KEY } from '../../app/lib/macro-share-basis';
import { PULSE_ENABLED_STORAGE_KEY } from '../../app/lib/pulse';
import {
  PUSH_DISABLED_STORAGE_KEY,
  PUSH_ENDPOINT_STORAGE_KEY,
  PUSH_PREFS_STORAGE_KEY,
  resetPush,
} from '../../app/lib/push';

const ACCOUNT_ID = 42;

/** A `Storage` a test can seed and read back, standing in for `window.localStorage`. */
function fakeLocalStorage(seed: Record<string, string> = {}): Storage & { entries: Map<string, string> } {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
    clear: () => entries.clear(),
    key: () => null,
    get length() {
      return entries.size;
    },
  };
}

/** Installs a bare `window` carrying the given `localStorage`, restored after the test. */
function withFakeWindow(localStorage: Storage): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { localStorage }, configurable: true, writable: true });
  return () => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previous);
  };
}

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

/**
 * The pulse toggle and every push key are DEVICE preferences, not account
 * data: `deleteDatabase` never touches `localStorage`, so without this an
 * erased device hands its pulse opt-in and its stale push subscription
 * straight to the next account that signs in on it.
 */
describe('eraseDeviceData forgets this device’s preferences', () => {
  afterEach(() => {
    resetPush();
  });

  it('clears the pulse opt-in and every push key, and leaves an unrelated preference alone', async () => {
    const localStorage = fakeLocalStorage({
      [PULSE_ENABLED_STORAGE_KEY]: 'on',
      [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa',
      [PUSH_DISABLED_STORAGE_KEY]: '1',
      [PUSH_PREFS_STORAGE_KEY]: JSON.stringify({ catchUpMinute: 480, fastTargetEnabled: true }),
      'openplate:weight-unit': 'kg',
      [MACRO_SHARE_BASIS_STORAGE_KEY]: 'grams',
    });
    const restoreWindow = withFakeWindow(localStorage);

    try {
      await eraseDeviceData({ accountId: ACCOUNT_ID }, fakeDeps());

      assert.equal(localStorage.getItem(PULSE_ENABLED_STORAGE_KEY), null, 'the pulse opt-in is gone');
      assert.equal(localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY), null, 'the remembered endpoint is gone');
      assert.equal(localStorage.getItem(PUSH_DISABLED_STORAGE_KEY), null, 'the remembered refusal is gone');
      assert.equal(localStorage.getItem(PUSH_PREFS_STORAGE_KEY), null, 'the two kinds are gone');
      // The control: a key this erase never touches must survive, or the
      // assertions above would pass just as well against a wiped-out storage.
      assert.equal(localStorage.getItem('openplate:weight-unit'), 'kg', 'an unrelated preference must survive');
      // The macro share basis is the same kind of key: a rendering choice of this device.
      assert.equal(localStorage.getItem(MACRO_SHARE_BASIS_STORAGE_KEY), 'grams', 'the macro share basis must survive');
    } finally {
      restoreWindow();
    }
  });
});

/**
 * `deleteIndexedDbDatabase` against a fake `indexedDB`. The timers are real and
 * tiny (a few milliseconds, injected), and every `setTimeout` is counted so a
 * test can say that a settled delete leaves none armed.
 */
describe('deleteIndexedDbDatabase bounds the wait from the request', () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let armed: Set<ReturnType<typeof setTimeout>>;
  let request: EventTarget & { error: Error | null };

  beforeEach(() => {
    armed = new Set();
    request = Object.assign(new EventTarget(), { error: null });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { deleteDatabase: () => request },
    });
    // SAFETY: the wrapper takes and returns what the one call site here passes, a callback and a delay; the
    // overloads of the Node `setTimeout` type (with `__promisify__`) are not needed by this file.
    globalThis.setTimeout = ((handler: () => void, ms: number) => {
      const timer = originalSetTimeout(() => {
        armed.delete(timer);
        handler();
      }, ms);
      armed.add(timer);
      return timer;
    }) as typeof setTimeout;
    // SAFETY: same as above, a timer handle in and nothing out.
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      armed.delete(timer);
      originalClearTimeout(timer);
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalIndexedDb === undefined) Reflect.deleteProperty(globalThis, 'indexedDB');
    else Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
  });

  it('rejects at the cap when the request never fires blocked and never settles (the queued second press)', async () => {
    await assert.rejects(
      () => deleteIndexedDbDatabase('db', { blockedTimeoutMs: 1_000, overallTimeoutMs: 20 }),
      /did not delete in time/,
    );
    assert.equal(armed.size, 0, 'the rejection leaves no timer behind');
  });

  it('resolves a delete that succeeds before the cap, and leaves no timer armed', async () => {
    const pending = deleteIndexedDbDatabase('db', { blockedTimeoutMs: 1_000, overallTimeoutMs: 1_000 });
    originalSetTimeout(() => request.dispatchEvent(new Event('success')), 5);
    await pending;
    assert.equal(armed.size, 0, 'the success clears the cap');
  });

  it('still rejects a blocked delete after the blocked bound, which is shorter than the cap', async () => {
    const started = Date.now();
    const pending = deleteIndexedDbDatabase('db', { blockedTimeoutMs: 20, overallTimeoutMs: 2_000 });
    request.dispatchEvent(new Event('blocked'));
    await assert.rejects(() => pending, /open in another tab/);
    assert.ok(Date.now() - started < 1_500, 'it did not wait for the overall cap');
    assert.equal(armed.size, 0, 'the rejection clears the cap too');
  });

  it('lets a slow delete that finishes after blocked but before the blocked bound succeed', async () => {
    const pending = deleteIndexedDbDatabase('db', { blockedTimeoutMs: 200, overallTimeoutMs: 1_000 });
    request.dispatchEvent(new Event('blocked'));
    originalSetTimeout(() => request.dispatchEvent(new Event('success')), 5);
    await pending;
    assert.equal(armed.size, 0);
  });
});
