/**
 * A DELETE THAT LANDS WHILE A CYCLE IS IN FLIGHT SURVIVES IT.
 *
 * The window is small and entirely ordinary: the cycle reads the device's
 * snapshot, the pull goes out, and while it is on the wire the person taps
 * delete on a row that was live in that read. The delete verb removes the row
 * and writes its journal key in the same transaction, both of which are done
 * before the pull comes back.
 *
 * The merge never heard about it. The row is in `merged`, and
 * `applyMergedSnapshot` only removes rows that `local` holds and `merged`
 * lacks, so nothing removes it and `importBackup` upserts it straight back onto
 * the device. The cycle then commits a baseline that names the row, the next
 * cycle reads it as live and mints nothing, and the delete is silently undone
 * with a stale journal row left behind it. Nothing on any screen says so.
 *
 * The invariant this file pins is one sentence: the apply never re-creates a
 * row this device has written down as deleted. The journal ROW is left alone,
 * which is what lets the second cycle below mint the tombstone the person
 * asked for.
 *
 * The store is the REAL one, on a real (fake-backed) IndexedDB, because the
 * journal and the upsert are both inside it and a fake would be free to agree
 * with itself.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import type { SyncPayload } from '../../app/lib/sync/engine/envelope/types';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import type { PulledBlob, PushBlobHttpResult, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
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

const ACCOUNT_ID = 91;
const MINE = 'device-mine';
/** The entry deleted while the cycle is on the wire. Every claim here is about this key. */
const DELETED_MIDFLIGHT = 'log-deleted-while-syncing';
/** An entry nobody touches, so an apply that wiped the table would not read as a pass. */
const KEPT = 'log-untouched';

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
  for (const entry of await listLocalFoodLogs()) await deleteLocalFoodLog(entry.id);
  await forgetPublishedDeletes([...(await readLocalSnapshot()).deletedEntityKeys]);
});

function foodLog(id: string, name: string): LocalFoodLog {
  return {
    id,
    name,
    quantityGrams: 150,
    macros: { carbs: 5, fiber: 1, sugars: 2, polyols: 0, protein: 18, fat: 7, kcal: 170 },
    mealType: 'dinner',
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

/**
 * Compare-and-swap on `blobVersion`, plus one hook: `onPull` runs INSIDE the
 * pull, which is the whole point of this file.
 */
function fakeService(dek: Uint8Array) {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  let onPull: (() => Promise<void>) | null = null;

  const client: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      // THE RACE, made deterministic. The person's tap lands here, after the
      // cycle read its snapshot and before the merge is computed.
      if (onPull !== null) {
        const run = onPull;
        onPull = null;
        await run();
      }
      if (stored === null) return null;
      return {
        blobVersion: stored.version,
        envelopeVersion: 1,
        ciphertext: stored.ciphertext,
        createdAt: '2026-08-04T10:00:00.000Z',
      };
    },
    async pushBlob(input): Promise<PushBlobHttpResult> {
      const current = stored?.version ?? 0;
      if (input.baseVersion !== current) return { status: 'conflict', currentVersion: current };
      stored = { version: current + 1, ciphertext: input.ciphertext };
      return { status: 'accepted', newVersion: stored.version };
    },
  };

  return {
    // SAFETY: the cycle reaches for `pullBlob` and `pushBlob` and nothing else.
    client: client as SyncHttpClient,
    duringNextPull(run: () => Promise<void>): void {
      onPull = run;
    },
    async read(): Promise<SyncPayload> {
      assert.ok(stored !== null, 'nothing is stored');
      return parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
    },
  };
}

/** The production wiring, minus the compartment, which no claim here is about. */
function deviceDeps(
  service: ReturnType<typeof fakeService>,
  dek: Uint8Array,
  state: ReturnType<typeof createSyncStateStore>,
) {
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
        integrity: {
          ...read.integrity,
          deletedEntityKeys: read.deletedEntityKeys,
          isCompartmentKnown: true,
          isCompartmentHeld: false,
          isCompartmentUnpublished: false,
        },
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

test('a delete that lands mid-cycle is not undone by that cycle, and publishes on the next', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });

  await putLocalFoodLog(foodLog(DELETED_MIDFLIGHT, 'Lentil soup'));
  await putLocalFoodLog(foodLog(KEPT, 'Rye bread'));

  // CYCLE 1. The snapshot read holds both entries. The tap lands inside the
  // pull, through the SAME verb the app uses, so the row goes and the journal
  // key is written in one transaction.
  service.duringNextPull(async () => {
    await deleteLocalFoodLog(DELETED_MIDFLIGHT);
  });
  const first = await runSyncCycleUnlocked(deviceDeps(service, dek, state));

  // NON-VACUITY: the cycle really wrote a blob, so `applySnapshot` really ran
  // with a `merged` that still named the deleted entry.
  assert.equal(first.pushed, true, 'precondition: the cycle must have applied and committed a payload');
  // SAFETY: the only payloads in this file are this build's own.
  const pushedFirst = (await service.read()).snapshot as { foodLogs: { id: string }[] };
  assert.deepEqual(
    pushedFirst.foodLogs.map((entry) => entry.id).toSorted(),
    [DELETED_MIDFLIGHT, KEPT].toSorted(),
    'precondition: the payload this cycle agreed with still carried the deleted entry',
  );

  // THE CLAIM, first half. Remove the journal filter from
  // `applyMergedSnapshot` and this list reads both ids: `importBackup` puts the
  // row back and the person's delete is gone with no trace on screen.
  assert.deepEqual(
    (await listLocalFoodLogs()).map((entry) => entry.id),
    [KEPT],
    'the apply must not re-create a row this device wrote down as deleted',
  );

  // THE CLAIM, second half. The key was NOT in the set this cycle read, so the
  // commit's prune does not touch it. That is the interlock: the row is the
  // only evidence the next cycle has.
  assert.deepEqual(
    [...(await readLocalSnapshot()).deletedEntityKeys],
    [`foodLog:${DELETED_MIDFLIGHT}`],
    'the journal row must survive the commit that never knew about it',
  );

  // CYCLE 2. The baseline names the entry, the snapshot lacks it, the journal
  // holds it, which is exactly the evidence `stampSnapshot` mints on.
  const second = await runSyncCycleUnlocked(deviceDeps(service, dek, state));
  assert.equal(second.pushed, true, 'the recorded delete must burn a blob version');
  assert.deepEqual(second.withheldTombstones, [], 'a recorded delete is never withheld');

  const payload = await service.read();
  assert.deepEqual(
    payload.syncMeta.tombstones.map((tombstone) => tombstone.entityId),
    [DELETED_MIDFLIGHT],
    'the account must carry the tombstone for the entry the person deleted',
  );
  // SAFETY: the only payloads in this file are this build's own.
  const pushedSecond = payload.snapshot as { foodLogs: { id: string }[] };
  assert.deepEqual(
    pushedSecond.foodLogs.map((entry) => entry.id),
    [KEPT],
    'and the row itself must be gone from the account',
  );
  assert.deepEqual(
    [...(await readLocalSnapshot()).deletedEntityKeys],
    [],
    'the journal row is spent once the account agreed',
  );
});
