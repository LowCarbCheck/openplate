/**
 * A REAL 0.35.1 PAYLOAD, AGAINST THIS ENGINE (M240 counsel item 7).
 *
 * ADR-0014 and ADR-0015 both argue that merging fasts and the pantry needs no
 * `SCHEMA_VERSION` bump, because a device still on 0.35.1 cannot lose anybody
 * a row. That argument was written from a reading of the old code and tested
 * against payloads this repository built by hand, and a hand-built payload
 * proves compatibility with nothing but the hand that built it.
 *
 * So `tests/fixtures/sync-payload-v0.35.1.json` was produced by the 0.35.1
 * ENGINE, out of a worktree at that tag with its own `node_modules`, over a
 * small fixed diary. Its README says how. What the old release actually wrote
 * is asserted here first, as the fixture's own shape, so a regenerated file
 * that stopped being an old-release payload fails loudly instead of quietly
 * making every claim below vacuous.
 *
 * THE DEVICE IS THE REAL STORE, on a real (fake-backed) IndexedDB, driven
 * through `runSyncCycleUnlocked`, `readLocalSnapshot` and
 * `applyMergedSnapshot`. A merge alone would prove that the RESULT keeps the
 * rows; only the apply proves that the rows are still on the device
 * afterwards, which is the claim a person cares about.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { buildEnvelope, parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import type { PulledBlob, PushBlobHttpResult, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import { entityKey, type StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
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
  deleteLocalFast,
  deleteLocalFoodLog,
  forgetDeletedEntityKeys,
  listDeletedEntityKeys,
  listLocalFasts,
  listLocalFoodLogs,
  listLocalPantryItems,
  listLocalSavedMeals,
  putLocalFast,
  putLocalFoodLog,
  replaceLocalPantry,
  SCHEMA_VERSION,
} from '../../app/lib/local-store';

const ACCOUNT_ID = 351;
const DEVICE = 'device-on-this-build';

/** The fixture, parsed rather than cast: a file that stopped being a payload must fail here. */
const oldPayloadSchema = z.object({
  snapshot: z.object({
    foodLogs: z.array(z.object({ id: z.string() }).loose()),
    fasts: z.array(z.object({ id: z.string() }).loose()),
    pantryItems: z.array(z.object({ id: z.string() }).loose()),
    savedMeals: z.array(z.object({ id: z.string() }).loose()),
  }).loose(),
  meta: z.object({
    perEntity: z.record(z.string(), z.object({ lamport: z.number(), deviceId: z.string() })),
    tombstones: z.array(z.object({ entityId: z.string(), entityType: z.string(), lamport: z.number(), deviceId: z.string() })),
  }),
});

/** The fixture's own text, read once. */
const FIXTURE_JSON: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/sync-payload-v0.35.1.json', import.meta.url)), 'utf8'),
);

/** The shape claim, checked at the boundary: the ids this file reads back and the meta the engine merges. */
const FIXTURE = oldPayloadSchema.parse(FIXTURE_JSON);

/**
 * The same file, typed for the engine.
 *
 * ONE ASSERTION FROM `unknown`, at the boundary and after the schema above has
 * run, which is the shape the anti-slop rule asks for: the parse is what
 * checks it, and this line only names the type the engine's own
 * `parseRemoteSnapshot` would have given a pulled blob.
 */
// SAFETY: `oldPayloadSchema.parse` has already accepted this exact value, and
// every collection the engine reads off it is one the schema named.
const OLD_PAYLOAD = FIXTURE_JSON as StampedSnapshot;

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

/** See `fasts-cross-device-sync.test.ts`: the integrity read races the persister without this. */
async function settleAutosave(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

async function quietDevice(): Promise<void> {
  for (const log of await listLocalFoodLogs()) await deleteLocalFoodLog(log.id);
  for (const entry of await listLocalFasts()) await deleteLocalFast(entry.id);
  await replaceLocalPantry([]);
  await forgetDeletedEntityKeys(await listDeletedEntityKeys());
  await settleAutosave();
  assert.deepEqual(await listLocalFoodLogs(), []);
  assert.deepEqual(await listLocalFasts(), []);
  assert.deepEqual(await listLocalPantryItems(), []);
  assert.deepEqual(await listDeletedEntityKeys(), []);
}

beforeEach(quietDevice);
after(quietDevice);

/** Compare-and-swap on a version, seeded with whatever payload a case needs. */
function fakeService(dek: Uint8Array) {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  const client: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      if (stored === null) return null;
      return {
        blobVersion: stored.version,
        envelopeVersion: 1,
        ciphertext: stored.ciphertext,
        createdAt: '2026-09-19T09:00:00.000Z',
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
    async seed(payload: StampedSnapshot): Promise<void> {
      const version = (stored?.version ?? 0) + 1;
      const envelope = await buildEnvelope({
        payload: { snapshot: payload.snapshot, syncMeta: payload.meta },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      stored = { version, ciphertext: envelope.ciphertext };
    },
    async onTheAccount(): Promise<StampedSnapshot> {
      assert.ok(stored !== null, 'the account must be holding a blob');
      const payload = await parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      // SAFETY: the only payloads this file stores are ones it wrote.
      return { snapshot: payload.snapshot as SyncedSnapshot, meta: payload.syncMeta };
    },
  };
}

async function runCycle(service: ReturnType<typeof fakeService>, dek: Uint8Array): Promise<void> {
  await settleAutosave();
  await runSyncCycleUnlocked({
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state: createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID }),
    deviceId: DEVICE,
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
    applySnapshot: async ({ merged, local }) => {
      await applyMergedSnapshot({
        merged: recomposeSnapshot({ shareable: merged, ownerPrivate: await readLocalOwnerPrivateRegion() }),
        // SAFETY: `applyMergedSnapshot` reads only the shareable collections.
        local: local as ShareableSnapshot,
      });
    },
    assertPulledSnapshot: async () => {},
    forgetPublishedDeletes,
    // SAFETY: the fixture and this file's own pushes are the only payloads here.
    parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
  });
}

function foodLog(id: string, name: string) {
  return {
    id,
    name,
    quantityGrams: 120,
    macros: { carbs: 4, fiber: 1, sugars: 1, polyols: 0, protein: 20, fat: 6, kcal: 160 },
    mealType: 'lunch' as const,
    source: 'manual' as const,
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-19',
    loggedAt: 1_789_000_000_000,
    createdAt: 1_789_000_000_000,
    logBatchId: null,
  };
}

// ---------------------------------------------------------------------------

test('THE FIXTURE IS WHAT 0.35.1 WROTE, which is what makes every claim below mean anything', () => {
  // The old release passed fasts, the pantry and saved meals through from its
  // own local side and built `meta.perEntity` inside a loop over MERGED
  // candidates, so it carries those rows with NO stamp beside them. A
  // regenerated file that carried stamps would be this build's output wearing
  // the old file's name, and every assertion after this would be vacuous.
  assert.deepEqual(FIXTURE.snapshot.fasts.map((row) => row.id).toSorted(), ['fast-old-done', 'fast-old-open']);
  assert.deepEqual(FIXTURE.snapshot.pantryItems.map((row) => row.id).toSorted(), ['pantry-old-butter', 'pantry-old-eggs']);
  assert.deepEqual(FIXTURE.snapshot.savedMeals.map((row) => row.id), ['meal-old']);
  assert.deepEqual(
    Object.keys(FIXTURE.meta.perEntity).toSorted(),
    ['foodLog:log-kept'],
    'the old engine stamped its food log and nothing else, which is the whole compatibility question',
  );
  assert.deepEqual(
    FIXTURE.meta.tombstones.map((entry) => entityKey(entry.entityType, entry.entityId)),
    ['foodLog:log-removed'],
    'and it really did tombstone the entry the person deleted',
  );
});

test('a fresh device ADOPTS the old release fasts, pantry and saved meals', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await service.seed(OLD_PAYLOAD);

  await runCycle(service, dek);

  assert.deepEqual(
    (await listLocalFasts()).map((row) => row.id).toSorted(),
    ['fast-old-done', 'fast-old-open'],
    'an unstamped fast must still reach a device on this build',
  );
  assert.deepEqual(
    (await listLocalPantryItems()).map((row) => row.id).toSorted(),
    ['pantry-old-butter', 'pantry-old-eggs'],
  );
  assert.deepEqual((await listLocalSavedMeals()).map((row) => row.id), ['meal-old']);
  assert.deepEqual((await listLocalFoodLogs()).map((row) => row.id), ['log-kept']);
});

test('the old release TOMBSTONE survives: the entry it buried stays buried', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await service.seed(OLD_PAYLOAD);

  await runCycle(service, dek);

  assert.equal(
    (await listLocalFoodLogs()).some((row) => row.id === 'log-removed'),
    false,
    'a delete the old device published must not be undone by a build that reads its blob',
  );
  const account = await service.onTheAccount();
  assert.deepEqual(
    account.meta.tombstones.map((entry) => entityKey(entry.entityType, entry.entityId)),
    ['foodLog:log-removed'],
    'and this build must carry it forward, or every peer resurrects the row',
  );
});

test('this device LOSES NOTHING when an old release payload arrives over rows it already holds', async () => {
  // The direction the compatibility argument is really about. This device
  // holds a fast, a pantry row and a food log of its own; the account's blob
  // was written by 0.35.1 and names none of them and stamps none of them. Read
  // naively that is "the account has no fasts and no pantry", and ADR-0013's
  // rule is the only thing between that reading and a wipe.
  const dek = generateDek();
  const service = fakeService(dek);

  await putLocalFoodLog(foodLog('log-mine', 'Omelette'));
  await putLocalFast({
    id: 'fast-mine',
    protocolId: '16:8',
    targetDurationMs: 57_600_000,
    plannedStartAt: null,
    startedAt: 1_789_000_000_000,
    endedAt: null,
    createdAt: 1_789_000_000_000,
  });
  await replaceLocalPantry([
    {
      id: 'pantry-mine',
      name: 'Spinach',
      amount: null,
      unit: null,
      category: 'other',
      source: 'manual',
      createdAt: 1_789_000_000_000,
      updatedAt: 1_789_000_000_000,
    },
  ]);
  await service.seed(OLD_PAYLOAD);

  await runCycle(service, dek);

  assert.ok((await listLocalFasts()).some((row) => row.id === 'fast-mine'), 'this device fast must survive');
  assert.ok((await listLocalPantryItems()).some((row) => row.id === 'pantry-mine'), 'this device pantry row must survive');
  assert.ok((await listLocalFoodLogs()).some((row) => row.id === 'log-mine'), 'this device food log must survive');

  const account = await service.onTheAccount();
  assert.deepEqual(
    account.snapshot.fasts.map((row) => row.id).toSorted(),
    ['fast-mine', 'fast-old-done', 'fast-old-open'],
    'and this device publishes both its own and the old release rows back',
  );
  assert.deepEqual(
    account.snapshot.pantryItems.map((row) => row.id).toSorted(),
    ['pantry-mine', 'pantry-old-butter', 'pantry-old-eggs'],
  );
  assert.deepEqual(
    account.meta.tombstones.map((entry) => entityKey(entry.entityType, entry.entityId)),
    ['foodLog:log-removed'],
    'with nothing new buried on the way',
  );
});

test('THE CONTROL: an unstamped row is adopted at lamport 0, so any real edit outranks it', async () => {
  // Without this, "the rows arrived" would pass just as happily against an
  // engine that invented a high stamp for them, which would make an old
  // device's stale copy win against a real edit made on this build.
  const dek = generateDek();
  const service = fakeService(dek);
  await service.seed(OLD_PAYLOAD);

  await runCycle(service, dek);

  const account = await service.onTheAccount();
  assert.equal(
    account.meta.perEntity[entityKey('fast', 'fast-old-open')]?.lamport,
    0,
    'a row the old release never stamped enters at 0, so a real edit anywhere outranks it',
  );
  assert.equal(
    account.meta.perEntity[entityKey('foodLog', 'log-kept')]?.lamport,
    1,
    'while a row it DID stamp keeps that stamp, carried rather than inflated',
  );
});
