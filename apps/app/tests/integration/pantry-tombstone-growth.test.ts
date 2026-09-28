/**
 * WHAT TWO HUNDRED FRIDGE PHOTOGRAPHS COST THE BLOB (M240 counsel item 3).
 *
 * ── The worry, and the part of it that is real ───────────────────────────
 *
 * The baseline NEVER compacts its tombstones: `stampSnapshot` carries every
 * one forward unconditionally, and `selectCompactableTombstones` in
 * `engine/merge/merge-entities.ts` has no production caller anywhere. The blob
 * is capped at `MAX_BLOB_BYTES` (2 MiB) and a push over it is a 413 that stops
 * sync. M240/02 made the pantry a merged entity with journalled removals, and
 * the review asked whether a person who re-photographs a shelf is quietly
 * filling their blob with tombstones.
 *
 * ── The measurement, which is the point of this file ─────────────────────
 *
 * They are not, and the reason is upstream of sync. `nextPantry`
 * (`app/lib/pantry-merge.ts`) is ADDITIVE on the photo and text paths: a
 * capture merges into the stored shelf by name and REMOVES nothing, because
 * the rows a camera did not see are things it could not see rather than things
 * the person threw away. Only an edit made from the LIST reconciles rows away.
 * So a re-scan writes no journal row, mints no tombstone, and the growth the
 * worry describes needs somebody to delete a line by hand, which is the same
 * rate as deleting a food log.
 *
 * Two hundred captures of a sixteen row shelf is roughly four years of weekly
 * photographs. This file runs them through the real store, the real capture
 * merge and the real sync cycle, and states the bound.
 *
 * THE CONTROL IS THE LIST EDIT. The same store, one removal made the way a
 * person makes one, does mint exactly one tombstone. Without it, "no
 * tombstones" would pass just as happily against a build whose pantry stopped
 * journalling at all, which is the defect M240/02 exists to avoid.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import { MAX_BLOB_BYTES } from '../../app/lib/sync/engine/protocol';
import type { PulledBlob, PushBlobHttpResult, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { createMemoryStorage, createSyncStateStore, type SyncStateStore } from '../../app/lib/sync/sync-state';
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
import { nextPantry, type PantryDraftRow } from '../../app/lib/pantry-merge';
import {
  forgetDeletedEntityKeys,
  listDeletedEntityKeys,
  listLocalPantryItems,
  replaceLocalPantry,
  SCHEMA_VERSION,
} from '../../app/lib/local-store';

const ACCOUNT_ID = 242;
const DEVICE = 'device-phone';
const NOW = Date.parse('2026-09-20T06:00:00Z');

/** Four years of weekly fridge photographs, near enough. */
const CAPTURES = 200;
/** Ingredients that live on the shelf across the whole run. */
const SHELF_ROWS = 16;
/**
 * How many of them any one photograph actually finds.
 *
 * FEWER THAN THE SHELF HOLDS, on purpose, and it is what makes the control
 * below able to fail. A camera sees what is at the front, so every capture
 * names a different twelve. A capture path that RECONCILED (the behaviour the
 * review assumed) would read the four it did not see as removals, journal
 * them, and mint four tombstones per photograph.
 */
const ROWS_SEEN_PER_CAPTURE = 12;

/**
 * THE BOUND THIS FILE STATES, and it is deliberately generous.
 *
 * A sixteen row pantry plus its sixteen `meta.perEntity` stamps serializes to
 * a few kilobytes. 64 KiB is a thirty-second of the 2 MiB the service accepts,
 * so a payload that crossed it would be carrying something this test did not
 * put there, which is exactly the growth the review was asking about.
 */
const PAYLOAD_BOUND_BYTES = 64 * 1024;

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

async function quietPhone(): Promise<void> {
  await replaceLocalPantry([]);
  await forgetDeletedEntityKeys(await listDeletedEntityKeys());
  await settleAutosave();
  assert.deepEqual(await listLocalPantryItems(), []);
  assert.deepEqual(await listDeletedEntityKeys(), []);
}

beforeEach(quietPhone);
after(quietPhone);

/** What one photograph of the shelf hands the review form: a rotating twelve of the sixteen. */
function shelfDrafts(capture: number): PantryDraftRow[] {
  return Array.from({ length: ROWS_SEEN_PER_CAPTURE }, (_unused, offset) => {
    const index = (capture + offset) % SHELF_ROWS;
    return {
      key: `row-${index}`,
      name: `Ingredient ${index}`,
      amount: '2',
      unit: 'piece' as const,
      category: 'other' as const,
    };
  });
}

function fakeService(dek: Uint8Array) {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  const client: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      if (stored === null) return null;
      return {
        blobVersion: stored.version,
        envelopeVersion: 1,
        ciphertext: stored.ciphertext,
        createdAt: '2026-09-20T07:00:00.000Z',
      };
    },
    async pushBlob(input): Promise<PushBlobHttpResult> {
      const current = stored?.version ?? 0;
      if (input.baseVersion !== current) return { status: 'conflict', currentVersion: current };
      // THE SERVICE'S OWN LIMIT, asserted where the service asserts it. A push
      // over `MAX_BLOB_BYTES` is a 413 in production and sync simply stops.
      assert.ok(
        input.ciphertext.byteLength <= MAX_BLOB_BYTES,
        `a push of ${input.ciphertext.byteLength} bytes would be refused by the service`,
      );
      stored = { version: current + 1, ciphertext: input.ciphertext };
      return { status: 'accepted', newVersion: stored.version };
    },
  };
  return {
    // SAFETY: the cycle reaches for `pullBlob` and `pushBlob` and nothing else.
    client: client as SyncHttpClient,
    byteLength(): number {
      return stored?.ciphertext.byteLength ?? 0;
    },
    async tombstones(): Promise<string[]> {
      assert.ok(stored !== null, 'the account must be holding a blob');
      const payload = await parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      return payload.syncMeta.tombstones.map((entry) => `${entry.entityType}:${entry.entityId}`).toSorted();
    },
  };
}

async function runCycle(
  service: ReturnType<typeof fakeService>,
  dek: Uint8Array,
  state: SyncStateStore,
): Promise<void> {
  await settleAutosave();
  await runSyncCycleUnlocked({
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state,
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
    // SAFETY: the only payloads in this file are this build's own.
    parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
  });
}

// ---------------------------------------------------------------------------

test(`${CAPTURES} fridge photographs mint no tombstones and keep the payload small`, async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });

  for (let capture = 0; capture < CAPTURES; capture += 1) {
    // THE REAL CAPTURE PATH, `path: 'photo'`, which is what `/pantry` hands
    // `replaceLocalPantry` after somebody confirms a reading.
    await replaceLocalPantry(
      nextPantry({
        stored: await listLocalPantryItems(),
        rows: shelfDrafts(capture),
        path: 'photo',
        now: NOW + capture * 86_400_000,
      }),
    );
  }
  await runCycle(service, dek, state);

  // NON-VACUITY: the shelf really is there, and it is still twelve rows rather
  // than two thousand four hundred, because the capture merge matches by name.
  // The union of every capture, merged by name: sixteen rows, not 2400.
  assert.equal((await listLocalPantryItems()).length, SHELF_ROWS, 'the shelf must be merged, not accumulated');
  assert.deepEqual(
    await listDeletedEntityKeys(),
    [],
    'a photograph removes nothing, so it writes no journal row and mints no tombstone',
  );
  assert.deepEqual(await service.tombstones(), [], 'and the account carries none either');
  assert.ok(
    service.byteLength() < PAYLOAD_BOUND_BYTES,
    `${CAPTURES} captures wrote ${service.byteLength()} bytes, over the stated ${PAYLOAD_BOUND_BYTES} byte bound`,
  );
});

test('THE CONTROL: one removal made from the LIST does mint exactly one tombstone', async () => {
  // Without this, "no tombstones" above would pass just as happily against a
  // build whose pantry had stopped journalling, which is the defect M240/02
  // exists to avoid: an evicted device would then be indistinguishable from
  // somebody who emptied their fridge.
  const dek = generateDek();
  const service = fakeService(dek);
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });

  await replaceLocalPantry(nextPantry({ stored: [], rows: shelfDrafts(0), path: 'photo', now: NOW }));
  await runCycle(service, dek, state);

  // The list path, with one line taken out, which is how a person removes one.
  await replaceLocalPantry(
    nextPantry({
      stored: await listLocalPantryItems(),
      rows: shelfDrafts(0).slice(1),
      path: 'manual',
      now: NOW + 86_400_000,
    }),
  );
  await runCycle(service, dek, state);

  assert.equal((await listLocalPantryItems()).length, ROWS_SEEN_PER_CAPTURE - 1);
  const tombstones = await service.tombstones();
  assert.equal(tombstones.length, 1, 'a removal the person made must reach the account as a tombstone');
  assert.match(tombstones[0] ?? '', /^pantryItem:/);
});
