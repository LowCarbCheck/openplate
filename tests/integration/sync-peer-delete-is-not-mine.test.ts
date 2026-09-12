/**
 * A PEER'S DELETE IS NOT THIS DEVICE'S DELETE, even when the cycle that
 * applied it never got to commit.
 *
 * `applyMergedSnapshot` removes the rows a merge resolved as buried
 * elsewhere. Routing those removals through the ordinary `deleteLocal*` verbs
 * made this device write them into its own DELETE JOURNAL, which is the record
 * of deletes IT performed and the only thing that authorises a tombstone.
 *
 * A committed cycle hid that: `commitState` prunes every key in
 * `merged.meta.tombstones`, so the impure rows went away a moment after they
 * arrived. The sequence below is the one that does not reach the commit:
 *
 *  1. this device holds the entry the peer deleted, plus one entry of its own
 *     that the account has never seen, so the cycle has something to push;
 *  2. the push is REFUSED with a 400. `pushOrHeal` applies the merge, which is
 *     the whole point of that path, and rethrows. No commit, and so no prune.
 *     A tab closed between the apply and the commit reaches the same state with
 *     no refusal involved;
 *  3. the peer re-adds the entry;
 *  4. the next cycle finds the entry in the baseline and not on the device, and
 *     it is the JOURNAL alone that decides whether that absence is a delete.
 *
 * With a journalled apply, step 4 mints a tombstone at a lamport the peer's
 * re-add has to beat, and a device-id tie can bury an entry nobody deleted.
 *
 * The store here is the REAL one, on a real (fake-backed) IndexedDB, because
 * the journal is a table in it and a fake would be free to be empty.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { buildEnvelope, parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import type { SyncPayload } from '../../app/lib/sync/engine/envelope/types';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { PulledBlob, PushBlobHttpResult, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import { baselineFromPayload, entityKey, type StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import {
  partitionSnapshot,
  recomposeSnapshot,
  type ShareableSnapshot,
  type SyncedSnapshot,
} from '../../app/lib/sync/snapshot-partition';
import {
  applyMergedSnapshot,
  forgetPublishedDeletes,
  readLocalOwnerPrivateRegion,
  readLocalSnapshot,
} from '../../app/lib/sync/local-store-bridge';
import {
  deleteLocalFoodLog,
  listLocalFoodLogs,
  putLocalFoodLog,
  SCHEMA_VERSION,
  type LocalFoodLog,
} from '../../app/lib/local-store';

const ACCOUNT_ID = 77;
/** The peer that deleted the entry. Its id beats this device's on a lamport tie, which is what makes step 2 a removal. */
const PEER = 'device-peer';
const MINE = 'device-mine';
/**
 * The device that put the entry back, and its id LOSES a tie to this one.
 *
 * That is not a convenience, it is the defect's only teeth. A minted tombstone
 * is stamped at `baseline.lamport + 1`, which is exactly the lamport a re-add
 * carries, so the two always TIE and `pickMergeWinner` decides on device id.
 * A re-add from a device that outranks this one survives the bug by luck; this
 * one does not, and half of every account's peers are on this side of the
 * comparison.
 */
const REVIVER = 'device-alto';
/** The entry the PEER deleted. Every claim in this file is about this key. */
const SHARED = 'log-the-peer-deleted';
/** An entry only this device has, so the cycle has a push to make and a 400 to be refused with. */
const LOCAL_ONLY = 'log-only-here';

before(() => {
  // SAFETY: `persist.ts` refuses to open a store unless it believes it is in a
  // browser; the guard is `globalThis.window !== undefined`.
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
});

after(async () => {
  for (const log of await listLocalFoodLogs()) await deleteLocalFoodLog(log.id);
  await forgetPublishedDeletes([...(await readLocalSnapshot()).deletedEntityKeys]);
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

function snapshotOf(logs: LocalFoodLog[]): SyncedSnapshot {
  return {
    foods: [],
    foodLogs: logs,
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    fastingSettings: null,
    privateStore: null,
  };
}

/**
 * Compare-and-swap on `blobVersion`, plus one switch: `refusePush` makes the
 * next push answer a 400 the way the service's shrink guard does, judged and
 * not written.
 */
function fakeService(dek: Uint8Array) {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  let refusePush = false;
  const client: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      if (stored === null) return null;
      return {
        blobVersion: stored.version,
        envelopeVersion: 1,
        ciphertext: stored.ciphertext,
        createdAt: '2026-08-04T10:00:00.000Z',
      };
    },
    async pushBlob(input): Promise<PushBlobHttpResult> {
      if (refusePush) {
        throw new SyncRequestError({ kind: 'invalid', status: 400, message: 'This push would delete too much.' });
      }
      const current = stored?.version ?? 0;
      if (input.baseVersion !== current) return { status: 'conflict', currentVersion: current };
      stored = { version: current + 1, ciphertext: input.ciphertext };
      return { status: 'accepted', newVersion: stored.version };
    },
  };
  return {
    // SAFETY: the cycle reaches for `pullBlob` and `pushBlob` and nothing else.
    client: client as SyncHttpClient,
    refuseNextPushes(): void {
      refusePush = true;
    },
    acceptPushesAgain(): void {
      refusePush = false;
    },
    async read(): Promise<SyncPayload> {
      assert.ok(stored !== null, 'nothing is stored');
      return parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
    },
    async seed(payload: StampedSnapshot, version: number): Promise<void> {
      const envelope = await buildEnvelope({
        payload: { snapshot: payload.snapshot, syncMeta: payload.meta },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      stored = { version, ciphertext: envelope.ciphertext };
    },
  };
}

/** The production wiring, minus the compartment, which no claim here is about. */
function deviceDeps(service: ReturnType<typeof fakeService>, dek: Uint8Array, state: ReturnType<typeof createSyncStateStore>) {
  return {
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state,
    deviceId: MINE,
    readSnapshot: async () => {
      const read = await readLocalSnapshot();
      const { shareable } = partitionSnapshot(read.snapshot);
      return {
        snapshot: { ...shareable, privateStore: null },
        integrity: { ...read.integrity, deletedEntityKeys: read.deletedEntityKeys, isCompartmentKnown: true },
      };
    },
    applySnapshot: async ({ merged, local }: { merged: SyncedSnapshot; local: SyncedSnapshot }) => {
      await applyMergedSnapshot({
        merged: recomposeSnapshot({ shareable: merged, ownerPrivate: await readLocalOwnerPrivateRegion() }),
        // SAFETY: `applyMergedSnapshot` reads only the shareable collections,
        // and a `SyncedSnapshot` IS the shareable region plus the sealed
        // compartment, which is the one member it does not touch.
        local: local as ShareableSnapshot,
      });
    },
    assertPulledSnapshot: async () => {},
    forgetPublishedDeletes,
    // SAFETY: the only payloads in this file are this build's own.
    parseRemoteSnapshot: ({ snapshot }: { snapshot: unknown }) => snapshot as SyncedSnapshot,
  };
}

// ---------------------------------------------------------------------------

test('a peer delete applied on a cycle that never commits is not claimed by this device', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });

  // YESTERDAY: both devices agreed on the shared entry, stamped by THIS device.
  await putLocalFoodLog(foodLog(SHARED, 'Lentil soup'));
  await putLocalFoodLog(foodLog(LOCAL_ONLY, 'Rye bread'));
  const agreed: StampedSnapshot = {
    snapshot: snapshotOf([foodLog(SHARED, 'Lentil soup')]),
    meta: { perEntity: { [entityKey('foodLog', SHARED)]: { lamport: 2, deviceId: MINE } }, tombstones: [] },
  };
  state.save({
    formatVersion: state.load().formatVersion,
    lastBlobVersion: 1,
    lastSyncedAt: 1_770_000_000_000,
    baseline: baselineFromPayload(agreed),
  });

  // STEP 1: the PEER deleted it, concurrently, at the same lamport. The tie
  // goes to the peer on device id, so the merge below really does remove the
  // row, which is what gives a journalling apply something to record.
  await service.seed(
    {
      snapshot: snapshotOf([]),
      meta: {
        perEntity: {},
        tombstones: [{ entityType: 'foodLog', entityId: SHARED, lamport: 2, deviceId: PEER }],
      },
    },
    1,
  );

  // NON-VACUITY 1: the baseline names the shared entry, so every cycle below
  // has something it COULD tombstone. Without this the claims are empty.
  assert.ok(
    state.load().baseline.perEntity[entityKey('foodLog', SHARED)] !== undefined,
    'the baseline must name the entry the peer deleted',
  );

  // STEP 2: the push is refused. `pushOrHeal` applies the merge and rethrows.
  service.refuseNextPushes();
  await assert.rejects(
    runSyncCycleUnlocked(deviceDeps(service, dek, state)),
    (cause: unknown) => cause instanceof SyncRequestError && cause.status === 400,
    'the refused push must reach the caller',
  );

  // NON-VACUITY 2: the apply really ran, so a journalling apply really had its
  // chance. Without this the journal is empty because nothing was removed.
  assert.deepEqual(
    (await listLocalFoodLogs()).map((log) => log.id).toSorted(),
    [LOCAL_ONLY],
    'the merge must have removed the entry the peer deleted',
  );
  // AND NON-VACUITY 3: the cycle did NOT commit, which is the whole premise.
  // A commit would prune the journal and hide the defect.
  assert.equal(state.load().lastBlobVersion, 1, 'a refused push must not advance the committed version');

  // THE CLAIM, first half: this device did not write the peer's act down.
  assert.deepEqual(
    [...(await readLocalSnapshot()).deletedEntityKeys],
    [],
    'a delete this device did not perform must not be in its journal',
  );

  // STEP 3: the entry is put back, by a device whose id loses a tie to this one.
  await service.seed(
    {
      snapshot: snapshotOf([foodLog(SHARED, 'Lentil soup')]),
      meta: {
        perEntity: { [entityKey('foodLog', SHARED)]: { lamport: 3, deviceId: REVIVER } },
        tombstones: [],
      },
    },
    2,
  );

  // STEP 4: the next cycle, which is the one that used to mint.
  service.acceptPushesAgain();
  const settled = await runSyncCycleUnlocked(deviceDeps(service, dek, state));
  assert.equal(settled.pushed, true, 'precondition: this device still had its own entry to publish');

  // THE CLAIM, second half, read back off the service rather than any in-memory
  // copy. A journalled apply mints a tombstone here at lamport 3, ties with the
  // re-add and wins on device id, and this is where the entry disappears for
  // everybody.
  const payload = await service.read();
  assert.deepEqual(
    payload.syncMeta.tombstones.filter((tombstone) => tombstone.entityId === SHARED),
    [],
    'this device must publish no delete for an entry it never deleted',
  );
  // SAFETY: the only payloads in this file are this build's own.
  const snapshot = payload.snapshot as { foodLogs: { id: string }[] };
  assert.deepEqual(
    snapshot.foodLogs.map((log) => log.id).toSorted(),
    [LOCAL_ONLY, SHARED].toSorted(),
    'so the re-added entry survives on the account, alongside this device\u2019s own',
  );
  assert.deepEqual(
    (await listLocalFoodLogs()).map((log) => log.id).toSorted(),
    [LOCAL_ONLY, SHARED].toSorted(),
    'and it comes back on the device',
  );
});
