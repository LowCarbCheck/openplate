/**
 * The catch-up record's round trip through its own database.
 *
 * `fake-indexeddb/auto` installs a real IndexedDB implementation on the global,
 * so these are not mocks of the store: the same `indexedDB.open`, the same
 * transactions and the same structured clone the browser runs. What is pinned
 * here is what the service worker depends on, the database name, the store
 * name and the key are the three things both sides spell, and every field
 * (including the locale and the freshness stamp) comes back exactly as it went
 * in.
 */
import 'fake-indexeddb/auto';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATCH_UP_RECORD_KEY,
  CATCH_UP_STALE_AFTER_MS,
  CATCH_UP_STORE_NAME,
  NOTIFY_DB_NAME,
  clearCatchUpRecord,
  isCatchUpFresh,
  putCatchUpRecord,
  readCatchUpRecord,
} from '../../app/lib/notify-store';
import type { CatchUpRecord } from '../../app/lib/notify-store';

/** One IndexedDB request as a promise, for the raw reads this file makes behind the module's back. */
function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('request failed')), { once: true });
  });
}

/** The notify database, opened raw, exactly as the service worker opens it. */
function openRaw(): Promise<IDBDatabase> {
  return settled(indexedDB.open(NOTIFY_DB_NAME));
}

const RECORD: CatchUpRecord = {
  forDay: '2026-09-12',
  title: 'Your daily catch-up',
  body: 'Yesterday: 3 meals, 42 g net carbs of your 50 g ceiling, 96 g protein of your 90 g floor.',
  url: '/catch-up',
  locale: 'de',
  writtenAt: 1_789_000_000_000,
};

describe('the notify database', () => {
  beforeEach(async () => {
    await clearCatchUpRecord();
  });

  it('names the database, the store and the key the worker reads', () => {
    assert.equal(NOTIFY_DB_NAME, 'openplate-notify');
    assert.equal(CATCH_UP_STORE_NAME, 'catchUp');
    assert.equal(CATCH_UP_RECORD_KEY, 'current');
  });

  it('round trips the record with its locale and its freshness stamp intact', async () => {
    await putCatchUpRecord(RECORD);

    assert.deepEqual(await readCatchUpRecord(), RECORD);
  });

  it('reads back nothing before anything is written', async () => {
    assert.equal(await readCatchUpRecord(), null);
  });

  it('overwrites the one key rather than appending', async () => {
    await putCatchUpRecord(RECORD);
    const second: CatchUpRecord = { ...RECORD, forDay: '2026-09-13', body: 'Yesterday was a fasting day.' };
    await putCatchUpRecord(second);

    assert.deepEqual(await readCatchUpRecord(), second);

    // The control: the store really does hold ONE row, not two.
    const db = await openRaw();
    const count = await settled(
      db.transaction(CATCH_UP_STORE_NAME, 'readonly').objectStore(CATCH_UP_STORE_NAME).count(),
    );
    db.close();
    assert.equal(count, 1);
  });

  it('reads a half-written row as no record rather than as text', async () => {
    const db = await openRaw();
    await settled(
      db
        .transaction(CATCH_UP_STORE_NAME, 'readwrite')
        .objectStore(CATCH_UP_STORE_NAME)
        .put({ title: 'no body, no day' }, CATCH_UP_RECORD_KEY),
    );
    db.close();

    assert.equal(await readCatchUpRecord(), null);
  });
});

describe('freshness', () => {
  it('is fresh inside the thirty-six hour window', () => {
    assert.equal(isCatchUpFresh(RECORD, RECORD.writtenAt + CATCH_UP_STALE_AFTER_MS - 1), true);
  });

  it('is stale at the window and past it, the control for the assertion above', () => {
    assert.equal(isCatchUpFresh(RECORD, RECORD.writtenAt + CATCH_UP_STALE_AFTER_MS), false);
    assert.equal(isCatchUpFresh(RECORD, RECORD.writtenAt + CATCH_UP_STALE_AFTER_MS * 2), false);
  });

  it('treats a record from a stepped clock as fresh, not stale', () => {
    assert.equal(isCatchUpFresh(RECORD, RECORD.writtenAt - 60_000), true);
  });

  it('is thirty-six hours, the figure spec 03 consumes', () => {
    assert.equal(CATCH_UP_STALE_AFTER_MS, 36 * 60 * 60 * 1000);
  });
});
