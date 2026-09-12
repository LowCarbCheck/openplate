/**
 * THE BOOT ORDER PRODUCTION ACTUALLY TAKES, after a browser evicted IndexedDB.
 *
 * ── Why this is a separate file, and why that is the whole point ──────────
 *
 * `sync-eviction-not-deletion.test.ts` proves the FUNCTION. It opens the real
 * device store in its `before()` hook and then deletes the database, so the
 * store singleton is already cached and nothing re-runs the boot. The probe it
 * stages therefore finds a missing database, and the tombstones are withheld.
 *
 * Production never reaches that state. `persist.ts`'s `initPersistedStore`
 * calls `primeFreshDatabaseIfNeeded` FIRST, and on a database that is not there
 * that runs an empty save, which CREATES the database and its `t` object store.
 * Only then does anything read integrity. The evicted device therefore boots
 * into "the database exists, and every table in it is empty", which is
 * indistinguishable, to a disk-versus-memory comparison, from a person who
 * deleted their whole diary. That shipped in 0.29.1 and 0.29.2 with a green
 * gate, because the staging was wrong, not the assertions.
 *
 * So this file stages the real order:
 *
 *  - a FRESH PROCESS. Nothing in it touches the store singleton before the
 *    cycle does, so `initPersistedStore` runs inside the production verb,
 *    exactly where it runs on somebody's phone;
 *  - NO DATABASE ON DISK, which is what an eviction leaves;
 *  - a BASELINE and a BLOB that both name the diary, which is what survives an
 *    eviction (`localStorage`) and what the account still holds;
 *  - the production verb `syncNow()`, and the claim read back off the service
 *    by decrypting the blob.
 *
 * The seeding below goes over HTTP rather than through the store on purpose:
 * writing the two entries locally first would open the store, prime the
 * database, and put this file back in the state it exists to avoid.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import { createSyncAccount, markSyncPending, syncNow } from '../../app/lib/sync/sync-actions';
import type { SyncSetupOutcome } from '../../app/lib/sync/setup-flow';
import { closeSyncSession, getSyncSessionSnapshot, getSyncVault, type SyncVault } from '../../app/lib/sync/sync-session';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import { buildEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import { ENVELOPE_VERSION } from '../../app/lib/sync/engine/protocol';
import type { SyncPayload } from '../../app/lib/sync/engine/envelope/types';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { baselineFromPayload, type StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import {
  deleteLocalFast,
  deleteLocalFoodLog,
  deleteLocalSavedMeal,
  forgetDeletedEntityKeys,
  listDeletedEntityKeys,
  listLocalFasts,
  listLocalFoodLogs,
  listLocalSavedMeals,
  putLocalFoodLog,
  SCHEMA_VERSION,
  type LocalFast,
  type LocalFoodLog,
  type LocalSavedMeal,
} from '../../app/lib/local-store';
import { readLocalSnapshot } from '../../app/lib/sync/local-store-bridge';
import { readPersistedTableRowCounts } from '../../app/lib/local-store/persist';
import { PRIMARY_DB_NAME } from '../../app/lib/local-store/store';
import { entityKey, FOOD_LOGS_TABLE } from '../../app/lib/local-store/schema';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });
const PASSPHRASE = 'seventeen purple lanterns drifting';

let service: FakeSyncService;

before(async () => {
  service = await startFakeSyncService();
  // THE ONE THING THE HOOK DOES TO THE DEVICE, and it is not a store touch:
  // `persist.ts` refuses to open anything unless it believes it is in a
  // browser. The store singleton is deliberately left closed, so the first
  // thing that opens it is the sync cycle under test.
  // SAFETY: the guard this satisfies is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;
  // The store's autoLoad poll would hold this process open once the cycle
  // opens it, so every interval it schedules is unref'd. Installed for the
  // whole file rather than around one call, because the open happens deep
  // inside `syncNow()` where there is nothing to wrap.
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

after(async () => {
  closeSyncSession();
  await service.close();
});

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

function snapshotOf(
  foodLogs: LocalFoodLog[],
  passThrough: { fasts: LocalFast[]; savedMeals: LocalSavedMeal[] } = { fasts: [], savedMeals: [] },
): SyncedSnapshot {
  return {
    foods: [],
    foodLogs,
    weightEntries: [],
    profile: null,
    fasts: passThrough.fasts,
    savedMeals: passThrough.savedMeals,
    fastingSettings: null,
    privateStore: null,
  };
}

function fast(id: string): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 57_600_000,
    plannedStartAt: null,
    startedAt: 1_770_000_000_000,
    endedAt: 1_770_000_000_000 + 57_600_000,
    createdAt: 1_770_000_000_000,
  };
}

function savedMeal(id: string): LocalSavedMeal {
  return {
    id,
    name: `Meal ${id}`,
    items: [
      {
        name: 'Eggs',
        quantityGrams: 120,
        macros: { carbs: 1, fiber: 0, sugars: 0, polyols: null, protein: 12, fat: 10, kcal: 150 },
        source: 'manual',
        aiEstimated: false,
        curatedSource: null,
        foodId: null,
      },
    ],
    createdAt: 1_770_000_000_000,
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

/**
 * Puts a diary on the ACCOUNT and the matching baseline in `localStorage`,
 * without ever opening the device store.
 *
 * This is a device that synced yesterday, spelled from the outside. A version
 * that wrote the two entries locally and called `syncNow()` would be shorter
 * and would also open the store, prime the database, and destroy the one
 * condition this file is about.
 */
async function seedAsIfThisDeviceHadSynced(
  vault: SyncVault,
  logs: LocalFoodLog[],
  passThrough: { fasts: LocalFast[]; savedMeals: LocalSavedMeal[] } = { fasts: [], savedMeals: [] },
): Promise<void> {
  const payload: StampedSnapshot = {
    snapshot: snapshotOf(logs, passThrough),
    meta: {
      perEntity: Object.fromEntries(
        logs.map((log) => [entityKey('foodLog', log.id), { lamport: 1, deviceId: 'device-yesterday' }]),
      ),
      tombstones: [],
    },
  };
  const envelope = await buildEnvelope({
    payload: { snapshot: payload.snapshot, syncMeta: payload.meta },
    dek: vault.dek,
    aadFields: { accountId: vault.accountId, blobVersion: 1, payloadSchemaVersion: SCHEMA_VERSION },
  });
  const pushed = await vault.http.pushBlob({
    baseVersion: 0,
    envelopeVersion: ENVELOPE_VERSION,
    ciphertext: envelope.ciphertext,
    shrinkAcknowledged: false,
  });
  assert.equal(pushed.status, 'accepted', 'the seeded blob must be stored');
  vault.state.save({
    formatVersion: vault.state.load().formatVersion,
    lastBlobVersion: 1,
    lastSyncedAt: 1_770_000_000_000,
    baseline: baselineFromPayload(payload),
  });
}

/** What one decrypted blob says the account holds. Named, because an anonymous return type here would widen on every read. */
interface ServicePayloadView {
  tombstones: SyncPayload['syncMeta']['tombstones'];
  foodLogIds: string[];
  fastIds: string[];
  savedMealIds: string[];
}

/** THE PAYLOAD THE SERVICE ACTUALLY HOLDS, decrypted. Never an in-memory copy of what we hoped was sent. */
async function payloadOnTheService(vault: SyncVault): Promise<ServicePayloadView> {
  const pulled = await vault.http.pullBlob();
  assert.ok(pulled !== null, 'the service must be holding a blob');
  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: vault.accountId,
    dek: vault.dek,
  });
  // SAFETY: `SyncPayload.snapshot` is `unknown` on the wire because the envelope
  // carries whatever schema version wrote it. What this file put there is this
  // build's own `SyncedSnapshot`, and only its ids are read.
  const snapshot = decrypted.payload.snapshot as {
    foodLogs: { id: string }[];
    fasts: { id: string }[];
    savedMeals: { id: string }[];
  };
  return {
    tombstones: decrypted.payload.syncMeta.tombstones,
    foodLogIds: snapshot.foodLogs.map((log) => log.id).toSorted(),
    fastIds: snapshot.fasts.map((entry) => entry.id).toSorted(),
    savedMealIds: snapshot.savedMeals.map((entry) => entry.id).toSorted(),
  };
}

/**
 * Leaves this process's shared device store and session the way each case
 * below needs to find them: no diary, no open session, no sticky notice.
 *
 * The store singleton is per PROCESS, so a case that ran before this one has
 * already written rows and already published a notice, and `openSyncVault`
 * deliberately carries a notice across a sign-in. Neither is a bug; both would
 * make a later case pass or fail for a reason that is not its own.
 */
async function startFromAQuietDevice(): Promise<void> {
  closeSyncSession();
  for (const log of await listLocalFoodLogs()) await deleteLocalFoodLog(log.id);
  // THE TWO PASS-THROUGH COLLECTIONS GO TOO. The store singleton is per
  // process, so a case that ran before this one left its fasts and saved meals
  // behind, and the next case's local list would start out holding them.
  for (const entry of await listLocalFasts()) await deleteLocalFast(entry.id);
  for (const meal of await listLocalSavedMeals()) await deleteLocalSavedMeal(meal.id);
  // The deletes just written to the journal are this device's, not the next
  // case's: forget every key the journal holds, not only the food logs, so a
  // case that left fast or saved-meal rows in it does not leak them forward.
  // An empty key list is a legitimate journal, not "nothing to forget", so
  // this must run even when `listDeletedEntityKeys` comes back empty.
  await forgetDeletedEntityKeys(await listDeletedEntityKeys());
  assert.deepEqual(await listDeletedEntityKeys(), [], 'the delete journal must be empty once this device is quiet');
}

// ---------------------------------------------------------------------------

test('THE BOOT ORDER: an evicted device primes an empty database, then syncs, and deletes nothing', async () => {
  // FIRST IN THE FILE, deliberately: it is the only case that needs a process
  // whose store singleton has never been opened.
  await signUpFresh('boot-order');
  const vault = requireVault();
  // THE ACCOUNT ALSO HOLDS TWO FASTS AND A SAVED MEAL, which are the two
  // collections sync passes through whole rather than merging. No tombstone is
  // involved anywhere in them, so the tombstone rule above cannot protect them:
  // whichever side's list the merge picks is the entire list that reaches the
  // account, and an evicted device used to be that side.
  await seedAsIfThisDeviceHadSynced(
    vault,
    [foodLog('log-boot-1', 'Lentil soup'), foodLog('log-boot-2', 'Rye bread')],
    { fasts: [fast('fast-boot-1'), fast('fast-boot-2')], savedMeals: [savedMeal('meal-boot-1')] },
  );

  // NON-VACUITY 1: the baseline really names both entries, so the cycle below
  // has something it COULD tombstone. Without this the claim at the end passes
  // against an empty baseline, which is no claim at all.
  const named = Object.keys(vault.state.load().baseline.perEntity).filter((key) => key.startsWith('foodLog:'));
  assert.deepEqual(named.toSorted(), ['foodLog:log-boot-1', 'foodLog:log-boot-2']);
  // And the same for the pass-through pair, which is recorded as plain ids
  // rather than as stamped entities. Without this the fasts claim at the end
  // passes against a baseline that never knew about them, which is the state
  // where the remote list wins for the wrong reason.
  assert.deepEqual(vault.state.load().baseline.passThrough, {
    fasts: ['fast-boot-1', 'fast-boot-2'],
    savedMeals: ['meal-boot-1'],
  });

  // NON-VACUITY 2: this is genuinely the evicted state at the moment of the
  // boot. The probe has not been used before in this process, and it never
  // creates a database as a side effect, so `absent` here is the disk itself
  // saying there is nothing.
  assert.deepEqual(
    await readPersistedTableRowCounts(PRIMARY_DB_NAME),
    { kind: 'absent' },
    'the eviction must have left no database at all',
  );

  // THE BOOT, spelled out. This is the first thing in this process to open the
  // store singleton, so `initPersistedStore` runs here exactly as it runs on a
  // phone: prime, then load, then read. `syncNow()` below reads the same
  // already-open store, so nothing is staged differently for it, this line
  // only puts the boot where it can be looked at.
  const boot = await readLocalSnapshot();

  // NON-VACUITY 3: the device is now in the state the defect lives in, and it
  // is the state a disk-versus-memory check calls healthy. The prime created
  // the database, so the probe says `present` with zero rows in every table,
  // and the integrity record the cycle weighs says `hasPersistedDatabase: true`
  // with nothing to contradict it. The EMPTY JOURNAL beside it is the only
  // thing between this device and a published wipe.
  assert.deepEqual(
    await readPersistedTableRowCounts(PRIMARY_DB_NAME),
    { kind: 'present', counts: {} },
    'the boot must have primed an empty database, which is exactly what makes the old evidence lie',
  );
  assert.equal(boot.integrity.hasPersistedDatabase, true, 'and the old evidence must indeed read as healthy');
  assert.deepEqual(boot.integrity.isTableLoaded, {}, 'with no table able to contradict it');
  assert.equal(boot.deletedEntityKeys.size, 0, 'while the journal, which fails with the diary, is empty');
  assert.deepEqual(await listLocalFasts(), [], 'and the device really holds none of the fasts the account does');
  assert.deepEqual(await listLocalSavedMeals(), [], 'nor the saved meal');

  markSyncPending();
  await syncNow();

  // THE CLAIM.
  const payload = await payloadOnTheService(vault);
  assert.deepEqual(payload.tombstones, [], 'an evicted device must publish no deletes');
  assert.deepEqual(payload.foodLogIds, ['log-boot-1', 'log-boot-2'], 'and the account keeps its diary');
  // THE PASS-THROUGH HALF. These two have no tombstone to withhold, so the only
  // thing standing between them and an empty list is the baseline's record of
  // what the account held, weighed against a journal that names nothing.
  assert.deepEqual(payload.fastIds, ['fast-boot-1', 'fast-boot-2'], 'and its fasts');
  assert.deepEqual(payload.savedMealIds, ['meal-boot-1'], 'and its saved meals');

  // AND THE DEVICE HEALS: the pull put the rows back through the ordinary apply
  // path, which is what makes withholding the tombstones survivable rather than
  // merely quiet.
  assert.deepEqual(
    (await listLocalFoodLogs()).map((log) => log.id).toSorted(),
    ['log-boot-1', 'log-boot-2'],
    'the entries must be back on the device',
  );
  assert.deepEqual(
    (await listLocalFasts()).map((entry) => entry.id).toSorted(),
    ['fast-boot-1', 'fast-boot-2'],
    'and so must the fasts, through the ordinary apply path',
  );
  closeSyncSession();
});

test('THE CONTROL: a RECORDED fast deletion on the same boot does reach the account', async () => {
  // Without this case the claim above passes against a merge that always keeps
  // the account's list, which would make every deleted fast and every deleted
  // saved meal come back on the next sync, on every device, forever.
  await startFromAQuietDevice();
  await signUpFresh('boot-order-pass-through-control');
  const vault = requireVault();
  await seedAsIfThisDeviceHadSynced(vault, [foodLog('log-pt-1', 'Lentil soup')], {
    fasts: [fast('fast-pt-1'), fast('fast-pt-2')],
    savedMeals: [],
  });

  // This device pulls the account's fasts down first, so what it deletes below
  // is a row it actually holds, which is the only way a person can delete one.
  markSyncPending();
  await syncNow();
  assert.deepEqual(
    (await listLocalFasts()).map((entry) => entry.id).toSorted(),
    ['fast-pt-1', 'fast-pt-2'],
    'precondition: both fasts reached the device',
  );

  await deleteLocalFast('fast-pt-2');
  // A second entry is what makes the cycle push at all: neither pass-through
  // collection is weighed by `payloadsEqual`, so a fast leaving is never by
  // itself a reason to write a new blob version.
  await putLocalFoodLog(foodLog('log-pt-2', 'Rye bread'));
  markSyncPending();
  await syncNow();

  const payload = await payloadOnTheService(vault);
  assert.deepEqual(payload.fastIds, ['fast-pt-1'], 'a deletion the device wrote down must reach the account');
  assert.deepEqual(payload.tombstones, [], 'and it travels as a shorter list, never as a tombstone');
  closeSyncSession();
});

test('THE CONTROL: the same boot, with the deletes recorded, publishes exactly those deletes', async () => {
  // Without this case the test above passes against a `stampSnapshot` that
  // never tombstones anything, which is a worse defect than the one it
  // replaces: every delete anybody makes would come back on the next sync, on
  // every device, forever.
  //
  // It runs on the same primed database the first test left behind, which is
  // the ordinary healthy device: rows in memory, rows on disk, a journal.
  await startFromAQuietDevice();
  await signUpFresh('boot-order-control');
  const vault = requireVault();

  await putLocalFoodLog(foodLog('log-control-1', 'Lentil soup'));
  await putLocalFoodLog(foodLog('log-control-2', 'Rye bread'));
  markSyncPending();
  await syncNow();
  assert.deepEqual(
    (await payloadOnTheService(vault)).foodLogIds,
    ['log-control-1', 'log-control-2'],
    'precondition: both entries reached the account',
  );

  await deleteLocalFoodLog('log-control-2');
  markSyncPending();
  await syncNow();

  const payload = await payloadOnTheService(vault);
  assert.equal(payload.tombstones.length, 1, 'a recorded delete must be published');
  assert.equal(payload.tombstones[0]?.entityId, 'log-control-2');
  assert.deepEqual(payload.foodLogIds, ['log-control-1'], 'and only the deleted entry goes');
  closeSyncSession();
});

test('an offline write on a freshly primed database pushes the new rows and withholds the old', async () => {
  // The other half of withholding, and the reason it is not a refusal: a cycle
  // that declines to publish a delete must still publish everything the person
  // wrote. This device was evicted, was typed into offline, and now syncs.
  await startFromAQuietDevice();
  await signUpFresh('offline-after-eviction');
  const vault = requireVault();
  await seedAsIfThisDeviceHadSynced(vault, [foodLog('log-old-1', 'Lentil soup'), foodLog('log-old-2', 'Rye bread')]);

  await putLocalFoodLog(foodLog('log-new-1', 'Omelette'));
  await putLocalFoodLog(foodLog('log-new-2', 'Walnuts'));

  markSyncPending();
  await syncNow();

  const payload = await payloadOnTheService(vault);
  assert.deepEqual(payload.tombstones, [], 'the entries this device cannot see are not deletes');
  assert.deepEqual(
    payload.foodLogIds,
    ['log-new-1', 'log-new-2', 'log-old-1', 'log-old-2'],
    'the new entries must reach the account, and the old ones must survive',
  );
  closeSyncSession();
});

test('a device that lost its copy and got nothing back is not told its entries were restored', async () => {
  // `remote === null`: the account has no blob at all, so nothing comes back
  // through the merge, the withheld entities drop out of the baseline, and the
  // notice used to say "your entries were restored from your account" anyway.
  await startFromAQuietDevice();
  await signUpFresh('no-blob');
  const vault = requireVault();

  // A baseline with no blob behind it, the shape a device is left in when the
  // account's blob was never written (or was rolled back) while this device's
  // `localStorage` survived.
  const payload: StampedSnapshot = {
    snapshot: snapshotOf([foodLog('log-ghost', 'Lentil soup')]),
    meta: { perEntity: { 'foodLog:log-ghost': { lamport: 1, deviceId: 'device-yesterday' } }, tombstones: [] },
  };
  vault.state.save({
    formatVersion: vault.state.load().formatVersion,
    lastBlobVersion: 0,
    lastSyncedAt: 1_770_000_000_000,
    baseline: baselineFromPayload(payload),
  });
  assert.equal(await vault.http.pullBlob(), null, 'precondition: the account holds no blob');

  markSyncPending();
  await syncNow();

  // NON-VACUITY: the delete really was withheld, so there really was something
  // for the notice to describe. Without this the assertion below passes on a
  // cycle that withheld nothing.
  assert.deepEqual((await payloadOnTheService(vault)).tombstones, [], 'the delete must have been withheld');
  assert.deepEqual(
    getSyncSessionSnapshot().storageHealNotice,
    { kind: 'none' },
    'nothing came back, so nothing may be reported as restored',
  );
  closeSyncSession();
});

// A last, quiet guard on the one table this file never names: the journal is
// device-local bookkeeping and must never reach the service. A key here would
// hand the account a list of what somebody deleted.
test('the delete journal never reaches the wire', async () => {
  const observed = JSON.stringify(service.observed);
  assert.ok(!observed.includes('deletedEntities'), 'the journal table must not appear in any request');
  assert.ok(!observed.includes(FOOD_LOGS_TABLE), 'nor may any store table id, which would mean the store leaked');
});
