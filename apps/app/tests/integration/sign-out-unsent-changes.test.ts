/**
 * What the sign-out dialog counts, against the REAL sync cycle.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The dialog counted the retired log outbox, which nothing had written since
 * M117/03, so it told every person that everything on the device had reached
 * the server, directly above the box that erases the diary. A person whose
 * last push had failed was invited to destroy the only copy of what it held.
 *
 * ── Why this drives the real cycle ───────────────────────────────────────
 *
 * The count is read off the sync BASELINE, which only `orchestrator.ts`'s
 * `commitState` writes, and off the device store, which only the app's own
 * verbs write. A test that built the baseline by hand would be asserting the
 * count against a record of its own invention, which is the seam that hid a
 * lost diary once already. So both sides are the production ones: the diary is
 * written with `putLocalFoodLog` into the real store over `fake-indexeddb`, the
 * baseline is written by `syncNow()` against the protocol-faithful fake
 * service, and "reached the server" is checked by DECRYPTING WHAT THE SERVICE
 * HOLDS, never by trusting the count to agree with itself.
 *
 * The cases share one process and one device, so they run in order and each
 * one starts from where the last left it. The service is closed in the last
 * one on purpose: that is the failed push.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import { createSyncAccount, syncNow } from '../../app/lib/sync/sync-actions';
import type { SyncSetupOutcome } from '../../app/lib/sync/setup-flow';
import { closeSyncSession, getSyncVault, type SyncVault } from '../../app/lib/sync/sync-session';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { readUnsentOnDevice, resolveEraseNotice, type UnsentOnDevice } from '../../app/lib/sync/erase-notice';
import { putLocalFoodLog, type LocalFoodLog } from '../../app/lib/local-store';
import { enqueueFeedbackReport } from '../../app/lib/local-store/feedback-outbox';
import { recordFeedbackConsent } from '../../app/lib/feedback/feedback-consent';
import { buildFeedbackMeasurements } from '../../app/lib/feedback/feedback-report';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });
const PASSPHRASE = 'seventeen purple lanterns drifting';

/**
 * How many cycles a settled device may need. The cycle writes awards after it
 * has pushed (`reconcileAwardsQuietly`), and in the app the store listener
 * carries those on the next cycle; here the next cycle is called by hand.
 */
const MAX_SETTLING_CYCLES = 3;

let service: FakeSyncService;
let isServiceOpen = false;

before(async () => {
  service = await startFakeSyncService();
  isServiceOpen = true;
  // SAFETY: the guard this satisfies is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;
  // The store's autoLoad poll would hold this process open once the first
  // write opens it, so every interval it schedules is unref'd.
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

  const email = `unsent-${Date.now()}@example.org`;
  const outcome: SyncSetupOutcome = await createSyncAccount({
    serverUrl: service.url,
    inviteToken: service.createInvite({ email }),
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  assert.equal(outcome.status, 'ready', 'the signup must open a session');
});

after(async () => {
  closeSyncSession();
  if (isServiceOpen) await service.close();
});

function requireVault(): SyncVault {
  const vault = getSyncVault();
  assert.ok(vault !== null, 'expected an open sync session');
  return vault;
}

function foodLog(id: string): LocalFoodLog {
  return {
    id,
    name: `Soup ${id}`,
    quantityGrams: 300,
    macros: { carbs: 18, fiber: 6, sugars: 2, polyols: 0, protein: 12, fat: 4, kcal: 220 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-18',
    loggedAt: 1_789_000_000_000,
    createdAt: 1_789_000_000_000,
    logBatchId: null,
  };
}

/** What the dialog would read right now, through the production reader. */
async function unsentNow(): Promise<UnsentOnDevice> {
  return readUnsentOnDevice({ accountId: requireVault().accountId });
}

/** Runs cycles until the device counts nothing unsent, or the bound runs out. */
async function syncUntilSettled(): Promise<UnsentOnDevice> {
  let unsent = await unsentNow();
  for (let cycle = 1; cycle <= MAX_SETTLING_CYCLES && unsent.changes > 0; cycle += 1) {
    await syncNow();
    unsent = await unsentNow();
  }
  return unsent;
}

/** The food log ids the SERVICE holds, decrypted. Never an in-memory copy of what we hoped was sent. */
async function foodLogIdsOnTheService(): Promise<string[]> {
  const vault = requireVault();
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
  // carries whatever schema version wrote it. This build wrote it, and only the
  // food log ids are read.
  const snapshot = decrypted.payload.snapshot as { foodLogs: { id: string }[] };
  return snapshot.foodLogs.map((log) => log.id).toSorted();
}

test('an entry logged after the last sync is counted, and the dialog gives no all-clear', async () => {
  await syncNow();
  const settled = await syncUntilSettled();
  // CONTROL: a device that has just synced counts nothing. Without it the case
  // below could pass on a count that is simply never zero.
  assert.equal(settled.changes, 0, 'control: a synced device has nothing unsent');

  await putLocalFoodLog(foodLog('logged-offline'));
  const unsent = await unsentNow();

  assert.ok(unsent.changes >= 1, `the new entry is counted (counted ${unsent.changes})`);
  const lines = resolveEraseNotice({ read: { status: 'done', unsent }, isSyncing: false, hasSession: true });
  assert.ok(!lines.some((line) => line.kind === 'all-sent'), 'no all-clear above the erase box');
  assert.ok(
    lines.some((line) => line.kind === 'unsent-changes'),
    'the dialog names the unsent change',
  );
});

test('after a cycle carries the entry, the count is zero and the entry is on the service', async () => {
  // A cycle first, unconditionally, so the push below never depends on the
  // count this file is testing.
  await syncNow();
  const unsent = await syncUntilSettled();

  assert.equal(unsent.changes, 0);
  // THE CLAIM, CHECKED WHERE IT IS ABOUT: the service holds the entry.
  assert.ok((await foodLogIdsOnTheService()).includes('logged-offline'), 'the service holds the entry');
  assert.deepEqual(resolveEraseNotice({ read: { status: 'done', unsent }, isSyncing: false, hasSession: true }), [
    { kind: 'all-sent' },
  ]);
});

test('a queued report is counted beside the diary', async () => {
  assert.equal((await unsentNow()).reports, 0, 'control: no report is queued yet');

  await enqueueFeedbackReport({
    userId: requireVault().accountId,
    logId: 'logged-offline',
    logBatchId: null,
    measurements: buildFeedbackMeasurements({
      name: 'Soup logged-offline',
      quantityGrams: 300,
      loggedAt: 1_789_000_000_000,
      source: 'manual',
      aiEstimated: false,
      macros: { carbs: 18, fiber: 6, sugars: 2, polyols: 0, protein: 12, fat: 4, kcal: 220 },
    }),
    consent: recordFeedbackConsent({ nowMs: 1_789_000_000_000 }),
    exportPhoto: async () => null,
  });

  assert.equal((await unsentNow()).reports, 1);
});

test('an entry whose push failed is still counted', async () => {
  await putLocalFoodLog(foodLog('push-failed'));
  // THE FAILED PUSH: the service is gone, the way it is on a train.
  await service.close();
  isServiceOpen = false;
  await assert.rejects(syncNow(), 'the cycle must fail without a service');

  const unsent = await unsentNow();
  assert.ok(unsent.changes >= 1, `the entry the push did not carry is counted (counted ${unsent.changes})`);
});
