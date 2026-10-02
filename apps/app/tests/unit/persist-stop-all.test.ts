/**
 * `stopAllPersisters`, against the REAL photos store singleton over
 * `fake-indexeddb`.
 *
 * ── The defect (2026-10-02) ──────────────────────────────────────────────
 *
 * An erase deleted `openplate-photos`, and the page that ran it still had the
 * photos store open. That store's `startAutoLoad` poll opens its database
 * versionless about once a second, and on a deleted database that open creates
 * an empty v1 database again. `sign-out-other-tab.spec.ts` caught one left
 * behind under load. `persist.ts` names this mechanism 7.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * The first test reproduces the defect: a delete with the store still running
 * is undone by the poll. Without it, "the database stayed gone" below could
 * pass only because the poll never ran in this process. The second test is the
 * same delete after `stopAllPersisters`, watched for longer than two polls.
 *
 * The two tests share one module, and the stop is for good in a page, so
 * their order is the point: the control runs first.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { deleteIndexedDbDatabase } from '../../app/lib/local-store/device-erase';
import { getPhotosStore, stopAllPersisters } from '../../app/lib/local-store/persist';
import { PHOTOS_DB_NAME } from '../../app/lib/local-store/store';

/** TinyBase's poll interval is one second; two of them and a margin. */
const POLL_WATCH_MS = 2_500;

/** How long the control waits for the poll to recreate the database. A safety net, not a latency claim. */
const RECREATE_TIMEOUT_MS = 5_000;
const WATCH_STEP_MS = 50;

async function photosDatabaseExists(): Promise<boolean> {
  const databases = await indexedDB.databases();
  return databases.some((database) => database.name === PHOTOS_DB_NAME);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

before(() => {
  // SAFETY: the guard this satisfies is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;
  // The store's autoLoad poll would hold this process open, so every interval
  // it schedules is unref'd, as `outbox-retired-table.test.ts` does.
  const scheduleInterval = globalThis.setInterval;
  function unrefdSetInterval<TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ): NodeJS.Timeout {
    return scheduleInterval(callback, delay, ...args).unref();
  }
  // SAFETY: the DOM overload answers a `number`; in node the handle carries `unref`.
  globalThis.setInterval = unrefdSetInterval as typeof globalThis.setInterval;
});

describe('stopAllPersisters', () => {
  it('CONTROL: with the store still running, the poll recreates a deleted database', async () => {
    await getPhotosStore();
    assert.equal(await photosDatabaseExists(), true, 'the store started, so its database is on disk');

    await deleteIndexedDbDatabase(PHOTOS_DB_NAME);
    assert.equal(await photosDatabaseExists(), false, 'the delete went through');

    let isRecreated = false;
    for (let waited = 0; waited < RECREATE_TIMEOUT_MS && !isRecreated; waited += WATCH_STEP_MS) {
      await sleep(WATCH_STEP_MS);
      isRecreated = await photosDatabaseExists();
    }
    assert.equal(isRecreated, true, 'the poll did not recreate the database, so the next test proves nothing');
  });

  it('after the stop, a deleted database stays deleted and no getter starts a persister', async () => {
    // The control left the store running over its recreated database.
    assert.equal(await photosDatabaseExists(), true);

    await stopAllPersisters();
    await deleteIndexedDbDatabase(PHOTOS_DB_NAME);
    assert.equal(await photosDatabaseExists(), false, 'the delete went through');

    await sleep(POLL_WATCH_MS);
    assert.equal(await photosDatabaseExists(), false, 'a poll recreated the database after the stop');

    await assert.rejects(() => getPhotosStore(), /stopped every store for an erase/);
    await sleep(POLL_WATCH_MS);
    assert.equal(await photosDatabaseExists(), false, 'the refused getter still opened the database');
  });
});
