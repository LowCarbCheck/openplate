/**
 * ABSENCE IS NOT DELETION, against the REAL device store.
 *
 * ── Why this file exists at all, and why it is not more cases in the
 *    roundtrip suite ───────────────────────────────────────────────────────
 *
 * `sync-e2ee-roundtrip.test.ts` substitutes the bridge: its `readSnapshot` is
 * a literal and its `parseRemoteSnapshot` is a cast. That substitution is
 * correct for what THAT file is about (the protocol), and it is exactly why a
 * defect that lives BETWEEN the store and the stamping shipped unseen for
 * releases. A person lost her whole diary to it in production.
 *
 * So every case here drives the production verb `syncNow()` against the real
 * `local-store` on `fake-indexeddb`, and reads the result back off the service
 * by decrypting the blob. Nothing between the store and the wire is mocked.
 *
 * ── The three states, and the control that makes each one a statement ────
 *
 *  - the DATABASE IS GONE while the baseline in `localStorage` survives (an
 *    eviction): ZERO tombstones,
 *  - one row deleted through `deleteLocalFoodLog` on a healthy device: EXACTLY
 *    ONE tombstone. This is the control. Without it the case above passes
 *    against a function that never tombstones anything, which is a far worse
 *    bug than the one it replaces,
 *  - the disk holds MORE rows than memory (a partial load): tombstones
 *    withheld for that table, and the live entities still pushed.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import { createSyncAccount, markSyncPending, syncNow } from '../../app/lib/sync/sync-actions';
import type { SyncSetupOutcome } from '../../app/lib/sync/setup-flow';
import { closeSyncSession, getSyncVault, type SyncVault } from '../../app/lib/sync/sync-session';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import type { SyncPayload } from '../../app/lib/sync/engine/envelope/types';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import {
  deleteLocalFast,
  deleteLocalFoodLog,
  listLocalFasts,
  listLocalFoodLogs,
  putLocalFast,
  putLocalFoodLog,
  type LocalFast,
  type LocalFoodLog,
} from '../../app/lib/local-store';
import { getPrimaryStore, readPersistedTableRowCounts } from '../../app/lib/local-store/persist';
import { PRIMARY_DB_NAME } from '../../app/lib/local-store/store';
import { FASTS_TABLE, FOOD_LOGS_TABLE } from '../../app/lib/local-store/schema';
import { readLocalSnapshot } from '../../app/lib/sync/local-store-bridge';
import { getSyncSessionSnapshot } from '../../app/lib/sync/sync-session';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });
const PASSPHRASE = 'seventeen purple lanterns drifting';

let service: FakeSyncService;

before(async () => {
  service = await startFakeSyncService();
  await openTheDeviceStore();
});

after(async () => {
  await service.close();
});

/**
 * Opens the REAL device store once, without letting its autoLoad poll hold the
 * test process open. Copied deliberately from `sync-e2ee-roundtrip.test.ts`:
 * the reasoning is that file's, and the two must not drift.
 */
async function openTheDeviceStore(): Promise<void> {
  // SAFETY: the guard this satisfies is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;
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
  try {
    await readLocalSnapshot();
  } finally {
    globalThis.setInterval = scheduleInterval;
  }
}

function foodLog(id: string, name: string): LocalFoodLog {
  return {
    id,
    name,
    quantityGrams: 120,
    macros: { carbs: 4, fiber: 1, sugars: 1, polyols: 0, protein: 20, fat: 6, kcal: 160 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-08-04',
    loggedAt: 1_770_000_000_000,
    createdAt: 1_770_000_000_000,
    logBatchId: null,
  };
}

function expectReady(outcome: SyncSetupOutcome): string {
  assert.equal(outcome.status, 'ready', 'a signup must complete and open a session');
  return outcome.email;
}

function requireVault(): SyncVault {
  const vault = getSyncVault();
  assert.ok(vault !== null, 'expected an open sync session');
  return vault;
}

/** A brand-new account with a session open on this device. */
async function signUpFresh(label: string): Promise<string> {
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.org`;
  return expectReady(
    await createSyncAccount({
      serverUrl: service.url,
      inviteToken: service.createInvite({ email }),
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
    }),
  );
}

/** The two halves of a blob these tests read: what it deletes, and which entries it carries. */
interface BlobOnTheService {
  tombstones: SyncPayload['syncMeta']['tombstones'];
  foodLogIds: string[];
  /** Not a tombstone question at all: `fasts` are passed through whole, so this is the WHOLE list the account now has. */
  fastIds: string[];
}

/** THE PAYLOAD THE SERVICE ACTUALLY HOLDS, decrypted. Never an in-memory copy of what we hoped was sent. */
async function payloadOnTheService(vault: SyncVault): Promise<BlobOnTheService> {
  const pulled = await vault.http.pullBlob();
  assert.ok(pulled !== null, 'the service must be holding a blob');
  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: vault.accountId,
    dek: vault.dek,
  });
  // SAFETY: `SyncPayload.snapshot` is `unknown` on the wire because the
  // envelope carries whatever schema version wrote it. What this file pushed a
  // line earlier is this build's own `SyncedSnapshot`, and only its food logs
  // are read.
  const snapshot = decrypted.payload.snapshot as { foodLogs: { id: string }[]; fasts: { id: string }[] };
  return {
    tombstones: decrypted.payload.syncMeta.tombstones,
    foodLogIds: snapshot.foodLogs.map((log) => log.id).toSorted(),
    fastIds: snapshot.fasts.map((entry) => entry.id).toSorted(),
  };
}

/** Empties the in-memory store the way a fresh page load leaves it before any successful load. */
async function emptyTheInMemoryStore(): Promise<void> {
  (await getPrimaryStore()).delTables();
}

/** Removes every row this file may have left behind, so each case starts from a device it wrote itself. */
async function clearTheDiary(): Promise<void> {
  for (const log of await listLocalFoodLogs()) await deleteLocalFoodLog(log.id);
  for (const entry of await listLocalFasts()) await deleteLocalFast(entry.id);
}

/** Lets the store's autosave run to completion, so the next disk write is the last word. */
async function settleAutosave(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

/**
 * Puts a row into the persisted database WITHOUT going through the store.
 *
 * The only way to build "the disk holds more than memory does" in one process:
 * every ordinary write reaches both, and the autosave that follows a delete
 * would erase any disk-only row written before it. Reaches into the persister's
 * own `t` object store, which `persist.ts` already documents as the one
 * implementation detail this codebase reads.
 */
/**
 * One row of the persister's `t` object store: a table id and that table's
 * whole content. Generic in the row, because this file writes both a food log
 * and a fast this way and the two tables hold different records.
 */
interface PersistedTableRow<TRow> {
  k: string;
  v: Record<string, TRow>;
}

async function putRowOnDiskOnly<TRow>(tableId: string, rowId: string, row: TRow): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PRIMARY_DB_NAME);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(new Error('could not open the persisted database')));
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('t', 'readwrite');
    const objectStore = transaction.objectStore('t');
    const read = objectStore.get(tableId);
    read.addEventListener('success', () => {
      // SAFETY: `persist.ts` documents the persister's row shape as
      // `{k: tableId, v: tableContent}`, and this file only ever reads back
      // what that persister wrote.
      const existing = read.result as PersistedTableRow<TRow> | undefined;
      objectStore.put({ k: tableId, v: { ...existing?.v, [rowId]: row } });
    });
    transaction.addEventListener('complete', () => {
      db.close();
      resolve();
    });
    transaction.addEventListener('error', () => {
      db.close();
      reject(new Error('could not write the disk-only row'));
    });
  });
}

// ---------------------------------------------------------------------------

test('a device whose IndexedDB was evicted publishes NO tombstones', async () => {
  await clearTheDiary();
  await signUpFresh('evicted');
  const vault = requireVault();

  await putLocalFoodLog(foodLog('log-evicted-1', 'Lentil soup'));
  await putLocalFoodLog(foodLog('log-evicted-2', 'Rye bread'));
  markSyncPending();
  await syncNow();

  // NON-VACUITY 1: the baseline really names both entries, so the cycle below
  // has something it COULD tombstone. Without this the assertion at the end
  // passes on an empty baseline.
  const baseline = vault.state.load().baseline;
  const namedEntities = Object.keys(baseline.perEntity).filter((key) => key.startsWith('foodLog:'));
  assert.equal(namedEntities.length, 2, 'the first cycle must commit a baseline naming both entries');

  // THE EVICTION. The browser took IndexedDB and left `localStorage`, so the
  // rows are gone from memory and from disk, and the baseline above survives.
  await emptyTheInMemoryStore();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PRIMARY_DB_NAME);
    request.addEventListener('success', () => resolve());
    request.addEventListener('error', () => reject(new Error('could not delete the database')));
    request.addEventListener('blocked', () => resolve());
  });

  // NON-VACUITY 2: the device really is in the evicted state at the moment the
  // cycle runs. A database that quietly came back would make this an ordinary
  // bulk-delete test wearing the wrong name.
  assert.deepEqual(await readPersistedTableRowCounts(PRIMARY_DB_NAME), { kind: 'absent' }, 'the database must be gone');
  assert.equal((await readLocalSnapshot()).integrity.hasPersistedDatabase, false);
  assert.equal((await listLocalFoodLogs()).length, 0, 'and the device must read as empty');

  markSyncPending();
  await syncNow();

  // THE CLAIM.
  const payload = await payloadOnTheService(vault);
  assert.deepEqual(payload.tombstones, [], 'an eviction must publish no deletes at all');

  // POSITIVE: the entries are still on the service, and the device got them
  // back through the ordinary apply path rather than being stranded empty.
  assert.deepEqual(payload.foodLogIds, ['log-evicted-1', 'log-evicted-2'], 'the account must still hold both entries');
  assert.equal((await listLocalFoodLogs()).length, 2, 'and the device must have been repopulated');

  // AND THE PERSON WAS TOLD. A silent heal is how the defect survived.
  assert.deepEqual(getSyncSessionSnapshot().storageHealNotice, { kind: 'restored', entryCount: 2 });

  closeSyncSession();
});

test('THE CONTROL: one row deleted on a healthy device publishes EXACTLY ONE tombstone', async () => {
  await clearTheDiary();
  await signUpFresh('deleted');
  const vault = requireVault();

  await putLocalFoodLog(foodLog('log-kept', 'Lentil soup'));
  await putLocalFoodLog(foodLog('log-removed', 'Rye bread'));
  markSyncPending();
  await syncNow();

  // A REAL DELETE, through the verb a person's tap reaches. The database stays
  // where it is, so disk and memory agree and the delete is trusted.
  await deleteLocalFoodLog('log-removed');
  // AND THE AUTOSAVE HAS TO LAND FIRST, which this line used to leave to luck.
  // `isTombstoneTrusted` asks the disk-versus-memory record as its second gate,
  // and between the delete and the flush the disk still holds the row, so
  // `isTableLoaded.foodLogs` reads false and the tombstone is withheld. A
  // healthy device settles in milliseconds; a test that races it is asserting
  // the scheduler, not the rule.
  await settleAutosave();
  markSyncPending();
  await syncNow();

  const payload = await payloadOnTheService(vault);
  assert.equal(payload.tombstones.length, 1, 'a genuine delete must still be published');
  assert.deepEqual(
    { entityType: payload.tombstones[0]?.entityType, entityId: payload.tombstones[0]?.entityId },
    { entityType: 'foodLog', entityId: 'log-removed' },
  );
  assert.deepEqual(payload.foodLogIds, ['log-kept']);

  // AND NOBODY WAS TOLD ANYTHING, because nothing went wrong. The notice is
  // for a device that lost its copy, not for a person who deleted a meal.
  assert.deepEqual(getSyncSessionSnapshot().storageHealNotice, { kind: 'none' });

  closeSyncSession();
});

test('a PARTIAL load withholds that table’s deletes and still pushes the live entities', async () => {
  await clearTheDiary();
  await signUpFresh('partial');
  const vault = requireVault();

  await putLocalFoodLog(foodLog('log-partial-1', 'Lentil soup'));
  await putLocalFoodLog(foodLog('log-partial-2', 'Rye bread'));
  markSyncPending();
  await syncNow();

  // THE PARTIAL LOAD, built in the only order that survives autosave: take the
  // row out of MEMORY first, let the autosave that follows settle, and only
  // then put it back on DISK behind the store's back. Doing it the other way
  // round has the autosave overwrite the disk a moment later and the state
  // quietly becomes an ordinary delete, which is what the first draft of this
  // test measured.
  const store = await getPrimaryStore();
  store.delRow(FOOD_LOGS_TABLE, 'log-partial-2');

  // A LIVE CHANGE RIDES ALONG, so the cycle below is not merely a no-op: the
  // rule is "withhold the delete", never "refuse the cycle".
  await putLocalFoodLog(foodLog('log-partial-3', 'Walnuts'));
  await settleAutosave();
  await putRowOnDiskOnly(FOOD_LOGS_TABLE, 'log-partial-2', foodLog('log-partial-2', 'Rye bread'));

  // NON-VACUITY: the disk really is ahead of memory at the moment the cycle
  // reads, and the bridge really reports that table as not loaded.
  const onDisk = await readPersistedTableRowCounts(PRIMARY_DB_NAME);
  assert.equal(onDisk.kind, 'present', 'the probe must have read the database');
  assert.equal(onDisk.kind === 'present' ? onDisk.counts[FOOD_LOGS_TABLE] : null, 3, 'the disk must hold all three rows');
  assert.equal((await listLocalFoodLogs()).length, 2, 'and memory must hold two');
  assert.equal((await readLocalSnapshot()).integrity.isTableLoaded[FOOD_LOGS_TABLE], false);

  markSyncPending();
  await syncNow();

  const payload = await payloadOnTheService(vault);
  assert.deepEqual(payload.tombstones, [], 'a partial load must publish no deletes');
  assert.ok(payload.foodLogIds.includes('log-partial-3'), 'the live entity must still have been published');
  assert.ok(
    payload.foodLogIds.includes('log-partial-2'),
    'and the entry memory could not see must still be on the account',
  );

  closeSyncSession();
});

// ---------------------------------------------------------------------------
// The collections no tombstone can protect
// ---------------------------------------------------------------------------

function fast(id: string): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 57_600_000,
    plannedStartAt: null,
    startedAt: 1_770_000_000_000,
    endedAt: 1_770_057_600_000,
    createdAt: 1_770_000_000_000,
  };
}

test('a PARTIAL load of the fasts table does not push a shortened list over the account', async () => {
  await clearTheDiary();
  await signUpFresh('fasts-partial');
  const vault = requireVault();

  await putLocalFoodLog(foodLog('log-fasts-1', 'Lentil soup'));
  await putLocalFast(fast('fast-kept'));
  markSyncPending();
  await syncNow();

  // NON-VACUITY 1: the fast really reached the account. `fasts` are passed
  // through, never stamped, so nothing else in this file would notice if the
  // very first cycle had already dropped them.
  assert.deepEqual((await payloadOnTheService(vault)).fastIds, ['fast-kept'], 'the account must hold the fast');

  // NON-VACUITY 2: the probe really counts this table. The whole rule rests on
  // `fasts` being an ordinary table in the same store, and that is checked
  // here rather than assumed.
  const fastsOnDisk = await readPersistedTableRowCounts(PRIMARY_DB_NAME);
  assert.equal(fastsOnDisk.kind === 'present' ? fastsOnDisk.counts[FASTS_TABLE] : null, 1);
  assert.equal((await readLocalSnapshot()).integrity.isTableLoaded[FASTS_TABLE], true);

  // THE PARTIAL LOAD, built in the one order that survives autosave (see the
  // food-log case above): out of MEMORY first, let the autosave settle, then
  // back onto DISK behind the store.
  const store = await getPrimaryStore();
  store.delRow(FASTS_TABLE, 'fast-kept');

  // A live change rides along, because the loss only happens on a cycle that
  // pushes, and a device that half loaded one table still logs meals.
  await putLocalFoodLog(foodLog('log-fasts-2', 'Walnuts'));
  await settleAutosave();
  await putRowOnDiskOnly(FASTS_TABLE, 'fast-kept', fast('fast-kept'));

  // NON-VACUITY 3: the device really cannot see the fast at the moment the
  // cycle reads, and the bridge really reports that table as not loaded.
  assert.equal((await listLocalFasts()).length, 0, 'memory must have lost the fast');
  assert.equal((await readLocalSnapshot()).integrity.isTableLoaded[FASTS_TABLE], false);

  markSyncPending();
  await syncNow();

  const payload = await payloadOnTheService(vault);
  assert.ok(payload.foodLogIds.includes('log-fasts-2'), 'the cycle must really have pushed');
  assert.deepEqual(payload.fastIds, ['fast-kept'], 'and the fast memory could not see must still be on the account');

  closeSyncSession();
});
