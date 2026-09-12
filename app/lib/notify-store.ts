/**
 * THE CATCH-UP RECORD'S OWN DATABASE, and nothing else.
 *
 * One key, overwritten. The app writes it on every visit and after every log;
 * the service worker reads it when a push arrives and turns it into the
 * notification's words.
 *
 * ── Why it is not in the main store ──────────────────────────────────────
 *
 * A push handler runs in the service worker, in its own global scope, with the
 * page possibly closed. Opening the app's primary database from there means a
 * second handle on a database the page may be upgrading, and the app has
 * already paid for that once: a push-time read of the main store hung the
 * integration tier with green ticks and no summary. So the catch-up gets a
 * tiny database of its own, with one object store, one record, and no
 * migrations to block on.
 *
 * ── Why raw IndexedDB ────────────────────────────────────────────────────
 *
 * The worker reads this with the raw API, because a worker cannot import the
 * app's store layer. Writing the app side through the same raw API is what
 * guarantees the two agree about the database name, the store name and the
 * key; every one of the three is exported from here, so neither side spells
 * one out a second time.
 *
 * Nothing in here throws at a caller. A browser with no usable IndexedDB
 * (private mode on some platforms, a storage quota refusal) simply has no
 * catch-up record, and the worker's generic fallback line covers that case.
 */

import { z } from 'zod';

/** The dedicated database. Spelled ONCE, here; the worker reads the same literal. */
export const NOTIFY_DB_NAME = 'openplate-notify';

/** The one object store in it. */
export const CATCH_UP_STORE_NAME = 'catchUp';

/** The one key in that store. Overwritten, never appended to: there is one current catch-up. */
export const CATCH_UP_RECORD_KEY = 'current';

/** The database version. Bump only when the store layout changes. */
const NOTIFY_DB_VERSION = 1;

/**
 * How old a record may be before a reader must ignore it, in milliseconds.
 *
 * Thirty-six hours: long enough that a device that missed a day still has
 * yesterday's words, short enough that nothing from the day before yesterday
 * is ever presented as this morning's.
 */
export const CATCH_UP_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * The stored catch-up, exactly as the service worker reads it back.
 *
 * A SCHEMA rather than a bare interface, because the read path crosses an I/O
 * boundary: a record written by an older build, a half-written row, or a
 * hand-edited one all arrive as `unknown` and are parsed here rather than
 * asserted. A row that fails to parse reads as "no record", which is the state
 * the worker's generic fallback line already covers.
 */
export const catchUpRecordSchema = z.object({
  /** The day the words are about, device-local `YYYY-MM-DD`. */
  forDay: z.string(),
  title: z.string(),
  body: z.string(),
  /** Where a tap goes. */
  url: z.string(),
  /** The language the words were written in, so a worker never mixes two. */
  locale: z.string(),
  /** Epoch-ms the record was written, the only thing freshness is judged on. */
  writtenAt: z.number(),
});

export type CatchUpRecord = z.infer<typeof catchUpRecordSchema>;

/** Whether this process can talk to IndexedDB at all. False on the server. */
function hasIndexedDb(): boolean {
  return globalThis.indexedDB !== undefined;
}

/** Wraps one IndexedDB request as a promise. Rejection is the request's own error. */
function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), {
      once: true,
    });
  });
}

/**
 * Opens (and, on first use, creates) the notify database.
 *
 * @returns the open database.
 */
function openNotifyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTIFY_DB_NAME, NOTIFY_DB_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CATCH_UP_STORE_NAME)) db.createObjectStore(CATCH_UP_STORE_NAME);
      },
      { once: true },
    );
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')), {
      once: true,
    });
    request.addEventListener('blocked', () => reject(new Error('IndexedDB open blocked')), { once: true });
  });
}

/**
 * Writes the catch-up record, replacing whatever was there.
 *
 * @param record - the words, the day they are about and the instant they were written.
 */
export async function putCatchUpRecord(record: CatchUpRecord): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openNotifyDb();
  try {
    const transaction = db.transaction(CATCH_UP_STORE_NAME, 'readwrite');
    await requestAsPromise(transaction.objectStore(CATCH_UP_STORE_NAME).put(record, CATCH_UP_RECORD_KEY));
  } finally {
    db.close();
  }
}

/**
 * Reads the catch-up record back.
 *
 * @returns the stored record, or `null` when nothing has been written yet.
 */
export async function readCatchUpRecord(): Promise<CatchUpRecord | null> {
  if (!hasIndexedDb()) return null;
  const db = await openNotifyDb();
  try {
    const transaction = db.transaction(CATCH_UP_STORE_NAME, 'readonly');
    const stored = await requestAsPromise<unknown>(
      transaction.objectStore(CATCH_UP_STORE_NAME).get(CATCH_UP_RECORD_KEY),
    );
    const parsed = catchUpRecordSchema.safeParse(stored);
    return parsed.success ? parsed.data : null;
  } finally {
    db.close();
  }
}

/** Deletes the record. Used by the device erase path, which takes every local trace with it. */
export async function clearCatchUpRecord(): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openNotifyDb();
  try {
    const transaction = db.transaction(CATCH_UP_STORE_NAME, 'readwrite');
    await requestAsPromise(transaction.objectStore(CATCH_UP_STORE_NAME).delete(CATCH_UP_RECORD_KEY));
  } finally {
    db.close();
  }
}

/**
 * Whether a record is recent enough to show. A record written in the FUTURE
 * (a stepped device clock) is fresh, not stale: the words are still the last
 * ones the device wrote.
 *
 * @param record - the stored record.
 * @param nowMs - the clock reading to judge against; never read internally.
 * @returns true while the record is inside the freshness window.
 */
export function isCatchUpFresh(record: CatchUpRecord, nowMs: number): boolean {
  return nowMs - record.writtenAt < CATCH_UP_STALE_AFTER_MS;
}
