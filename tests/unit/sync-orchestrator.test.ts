/**
 * The sync orchestrator and the pure merge core underneath it.
 *
 * The properties worth guarding here are the ones whose failure is SILENT:
 *  - a `409` that terminates instead of retrying strands a device forever;
 *  - a baseline that isn't refreshed re-pushes the whole store on every boot;
 *  - a tombstone that loses to a stale live value resurrects a deleted entry;
 *  - a merge that isn't symmetric never converges, it ping-pongs.
 *
 * Everything the cycle touches is injected, so these run with no browser, no
 * IndexedDB, no server and no locks, the algorithm is exercised directly.
 */
import {
  EVICTED_STORAGE,
  HEALTHY_STORAGE,
  NOTHING_TO_ACCOUNT_FOR,
  withRecordedDeletes,
} from '../sync-integrity-fixtures';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { buildEnvelope, parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import type { SyncPayload } from '../../app/lib/sync/engine/envelope/types';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import { SCHEMA_VERSION, type LocalStoreSnapshot } from '../../app/lib/local-store';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import {
  baselineFromPayload,
  contentHash,
  mergeSnapshots,
  payloadsEqual,
  stableStringify,
  stampSnapshot,
  type StampedSnapshot,
} from '../../app/lib/sync/snapshot-sync';
import { createMemoryStorage, createSyncStateStore, emptySyncState } from '../../app/lib/sync/sync-state';
import type { PushBlobHttpResult, PulledBlob, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { FASTS_TABLE } from '../../app/lib/local-store/schema';

const ACCOUNT_ID = 42;

function log(id: string, name: string, grams: number): LocalStoreSnapshot['foodLogs'][number] {
  return {
    id,
    name,
    quantityGrams: grams,
    macros: { carbs: 1, fiber: 0, sugars: 0, polyols: 0, protein: 2, fat: 3, kcal: 40 },
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

function snapshot(logs: LocalStoreSnapshot['foodLogs']): SyncedSnapshot {
  // `fasts` is required on the snapshot since v7 but is never merged by the
  // sync engine (see `mergeSnapshots`), an empty array is the whole fixture.
  return {
    foods: [],
    foodLogs: logs,
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    fastingSettings: null,
    // The owner-private compartment (M160/07). `null` is a device that has
    // never generated a share key, the ordinary case, and the one that must
    // not make the cycle behave differently.
    privateStore: null,
  };
}

/**
 * An in-memory sync service that honours the ONE rule the cycle depends on:
 * compare-and-swap on `blobVersion`. Everything else about the protocol is
 * covered by the integration suite; this is just enough server to test the
 * loop.
 */
function fakeService(dek: Uint8Array) {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  let pushes = 0;
  /** Every `shrinkAcknowledged` this service was sent, in order. See `protocol.ts`. */
  const shrinkFlags: boolean[] = [];
  /** When set, the next push finds that another device wrote first, the real 409 race. */
  let interfereBeforeNextPush: (() => Promise<void>) | null = null;
  /** When set, the next push is REFUSED with a `400`, the shape of the service's shrink guard. */
  let refuseNextPush = false;

  /** Only the two calls the cycle makes; the rest of the transport is the integration suite's job. */
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
    async pushBlob(input: {
      baseVersion: number;
      envelopeVersion: number;
      ciphertext: Uint8Array;
      shrinkAcknowledged: boolean;
    }): Promise<PushBlobHttpResult> {
      pushes += 1;
      shrinkFlags.push(input.shrinkAcknowledged);
      if (interfereBeforeNextPush !== null) {
        const interfere = interfereBeforeNextPush;
        interfereBeforeNextPush = null;
        await interfere();
      }
      const current = stored?.version ?? 0;
      if (input.baseVersion !== current) return { status: 'conflict', currentVersion: current };
      // THE SHRINK GUARD, as the service spells it: a refusal is a `400`, which
      // the HTTP client turns into a thrown `invalid`. Nothing is written.
      if (refuseNextPush) {
        refuseNextPush = false;
        throw new SyncRequestError({ kind: 'invalid', status: 400, message: 'This push would delete more than half' });
      }
      stored = { version: current + 1, ciphertext: input.ciphertext };
      return { status: 'accepted', newVersion: stored.version };
    },
  };

  return {
    // SAFETY: `runSyncCycleUnlocked` reaches for `pullBlob` and `pushBlob` and
    // nothing else, and `client` implements both with the real signatures.
    client: client as SyncHttpClient,
    get pushes() {
      return pushes;
    },
    get shrinkFlags(): readonly boolean[] {
      return shrinkFlags;
    },
    /** Arranges for another device to win the race on the very next push. */
    raceOnNextPush(run: () => Promise<void>): void {
      interfereBeforeNextPush = run;
    },
    /** Arranges for the service to REFUSE the very next push, writing nothing. */
    refuseTheNextPush(): void {
      refuseNextPush = true;
    },
    /** Writes a payload directly, as if another device had pushed it. */
    async seed(payload: SyncPayload, version: number): Promise<void> {
      const envelope = await buildEnvelope({
        payload,
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      stored = { version, ciphertext: envelope.ciphertext };
    },
    async read(): Promise<SyncPayload> {
      assert.ok(stored !== null, 'nothing stored');
      return parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
    },
    get version(): number {
      return stored?.version ?? 0;
    },
  };
}

function deps({
  dek,
  http,
  local,
  deviceId,
  storage = createMemoryStorage(),
  deleted = new Set<string>(),
}: {
  dek: Uint8Array;
  http: SyncHttpClient;
  local: { current: SyncedSnapshot };
  deviceId: string;
  storage?: ReturnType<typeof createMemoryStorage>;
  /**
   * This device's DELETE JOURNAL, the entity keys it recorded as deleted
   * (M225). Empty by default, because dropping an entity from a fixture
   * snapshot is not a delete any more than a browser eviction is: the app
   * writes the key down in the delete verb's own transaction, and a fixture
   * that wants a tombstone has to say so here too.
   *
   * Mutable and shared with `forgetPublishedDeletes` below, so a fixture can
   * watch the prune happen the way production does.
   */
  deleted?: Set<string>;
}) {
  return {
    accountId: ACCOUNT_ID,
    dek,
    http,
    state: createSyncStateStore({ storage, accountId: ACCOUNT_ID }),
    deviceId,
    readSnapshot: async () => ({ snapshot: local.current, integrity: withRecordedDeletes(HEALTHY_STORAGE, [...deleted]) }),
    applySnapshot: async ({ merged }: { merged: SyncedSnapshot }) => {
      local.current = merged;
    },
    forgetPublishedDeletes: async (keys: string[]) => {
      for (const key of keys) deleted.delete(key);
    },
    // No compartment in play in this file: every fixture's `privateStore` is
    // `null`, so there is nothing for the veto to inspect. Named rather than
    // defaulted, because `SyncCycleDeps` makes it required on purpose
    // (M164/06).
    assertPulledSnapshot: async () => {},
    // SAFETY: the only payload these cycles can pull back is one they pushed,
    // built from `local.current`, a `SyncedSnapshot` by construction.
    parseRemoteSnapshot: ({ snapshot: raw }: { snapshot: unknown }) => raw as SyncedSnapshot,
  };
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

test('stableStringify ignores key ORDER, so an unchanged entity never looks changed', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
});

test('an unchanged entity keeps its stamp; a changed one advances it', () => {
  const first = stampSnapshot({
    integrity: HEALTHY_STORAGE,
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: { perEntity: {}, tombstones: [] },
    deviceId: 'device-1',
  });
  assert.equal(first.meta.perEntity['foodLog:a']?.lamport, 1);

  const unchanged = stampSnapshot({
    integrity: HEALTHY_STORAGE,
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: first.baseline,
    deviceId: 'device-1',
  });
  assert.equal(unchanged.meta.perEntity['foodLog:a']?.lamport, 1, 'an untouched entity must not advance');

  const changed = stampSnapshot({
    integrity: HEALTHY_STORAGE,
    snapshot: snapshot([log('a', 'Apple', 150)]),
    baseline: first.baseline,
    deviceId: 'device-1',
  });
  assert.equal(changed.meta.perEntity['foodLog:a']?.lamport, 2);
});

test('an entity that disappears becomes a tombstone above its last stamp', () => {
  const first = stampSnapshot({
    integrity: HEALTHY_STORAGE,
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: { perEntity: {}, tombstones: [] },
    deviceId: 'device-1',
  });
  // THE DELETE IS RECORDED, because the app records it (M225): dropping an
  // entity from a snapshot is what an eviction looks like too, and only the
  // journal tells the two apart.
  const deleted = stampSnapshot({
    snapshot: snapshot([]),
    baseline: first.baseline,
    deviceId: 'device-1',
    integrity: withRecordedDeletes(HEALTHY_STORAGE, ['foodLog:a']),
  });

  assert.deepEqual(deleted.minted, deleted.meta.tombstones, 'a first delete is all minted, nothing carried forward');
  assert.deepEqual(deleted.meta.tombstones, [
    { entityId: 'a', entityType: 'foodLog', lamport: 2, deviceId: 'device-1' },
  ]);
  assert.equal(deleted.meta.perEntity['foodLog:a'], undefined);
});

test('a re-added entity outranks its own tombstone, deletions do not resurrect', () => {
  const created = stampSnapshot({
    integrity: HEALTHY_STORAGE,
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: { perEntity: {}, tombstones: [] },
    deviceId: 'device-1',
  });
  const deleted = stampSnapshot({
    snapshot: snapshot([]),
    baseline: created.baseline,
    deviceId: 'device-1',
    integrity: withRecordedDeletes(HEALTHY_STORAGE, ['foodLog:a']),
  });
  const readded = stampSnapshot({
    integrity: HEALTHY_STORAGE,
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: deleted.baseline,
    deviceId: 'device-1',
  });

  const liveStamp = readded.meta.perEntity['foodLog:a'];
  assert.ok(liveStamp !== undefined);
  assert.equal(liveStamp.lamport, 3, 'the live stamp must beat the tombstone at 2');
  assert.equal(readded.meta.tombstones.length, 0);
});

test('the merge is symmetric, both devices compute the identical result', () => {
  const a: StampedSnapshot = {
    snapshot: snapshot([log('a', 'Apple', 100)]),
    meta: { perEntity: { 'foodLog:a': { lamport: 2, deviceId: 'device-a' } }, tombstones: [] },
  };
  const b: StampedSnapshot = {
    snapshot: snapshot([log('b', 'Bread', 50)]),
    meta: { perEntity: { 'foodLog:b': { lamport: 1, deviceId: 'device-b' } }, tombstones: [] },
  };

  const fromA = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: a, remote: b });
  const fromB = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: b, remote: a });

  assert.equal(payloadsEqual(fromA, fromB), true);
  assert.deepEqual(
    fromA.snapshot.foodLogs.map((entry) => entry.id),
    ['a', 'b'],
  );
});

test('a higher Lamport wins; an equal one breaks on deviceId, never on time', () => {
  const older: StampedSnapshot = {
    snapshot: snapshot([log('a', 'Old name', 100)]),
    meta: { perEntity: { 'foodLog:a': { lamport: 1, deviceId: 'zzz' } }, tombstones: [] },
  };
  const newer: StampedSnapshot = {
    snapshot: snapshot([log('a', 'New name', 100)]),
    meta: { perEntity: { 'foodLog:a': { lamport: 5, deviceId: 'aaa' } }, tombstones: [] },
  };

  assert.equal(mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: older, remote: newer }).snapshot.foodLogs[0]?.name, 'New name');

  const tie = mergeSnapshots({
    ...NOTHING_TO_ACCOUNT_FOR,
    integrity: HEALTHY_STORAGE,
    local: { ...older, meta: { perEntity: { 'foodLog:a': { lamport: 5, deviceId: 'zzz' } }, tombstones: [] } },
    remote: newer,
  });
  assert.equal(tie.snapshot.foodLogs[0]?.name, 'Old name', 'lexicographically higher deviceId wins the tie');
});

test('a tombstone beats an older live value, and loses to a newer one', () => {
  const live: StampedSnapshot = {
    snapshot: snapshot([log('a', 'Apple', 100)]),
    meta: { perEntity: { 'foodLog:a': { lamport: 1, deviceId: 'device-a' } }, tombstones: [] },
  };
  const deleted: StampedSnapshot = {
    snapshot: snapshot([]),
    meta: {
      perEntity: {},
      tombstones: [{ entityId: 'a', entityType: 'foodLog', lamport: 2, deviceId: 'device-b' }],
    },
  };

  assert.equal(mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: live, remote: deleted }).snapshot.foodLogs.length, 0);

  const editedAfterDelete: StampedSnapshot = {
    ...live,
    meta: { perEntity: { 'foodLog:a': { lamport: 3, deviceId: 'device-a' } }, tombstones: [] },
  };
  assert.equal(mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: editedAfterDelete, remote: deleted }).snapshot.foodLogs.length, 1);
});

test('baselineFromPayload hashes what was agreed, so the next cycle sees no change', () => {
  const payload: StampedSnapshot = {
    snapshot: snapshot([log('a', 'Apple', 100)]),
    meta: { perEntity: { 'foodLog:a': { lamport: 4, deviceId: 'device-a' } }, tombstones: [] },
  };
  const baseline = baselineFromPayload(payload);
  const restamped = stampSnapshot({ snapshot: payload.snapshot, baseline, deviceId: 'device-b', integrity: HEALTHY_STORAGE });

  assert.deepEqual(restamped.meta.perEntity['foodLog:a'], { lamport: 4, deviceId: 'device-a' });
});

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

test('a first sync pushes the local store and records the new version', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const local = { current: snapshot([log('a', 'Apple', 100)]) };
  const storage = createMemoryStorage();

  const result = await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  assert.deepEqual(result.pushed, true);
  assert.equal(result.blobVersion, 1);
  const stored = await service.read();
  // SAFETY: the payload was written by the cycle above from `local.current`,
  // so its `snapshot` is the `SyncedSnapshot` that went in.
  assert.equal((stored.snapshot as SyncedSnapshot).foodLogs[0]?.id, 'a');
  assert.equal(
    createSyncStateStore({ storage, accountId: ACCOUNT_ID }).load().lastBlobVersion,
    1,
    'the baseline must record the version it agreed with',
  );
});

test('a second cycle with nothing changed pushes NOTHING, boots must not burn blob versions', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const local = { current: snapshot([log('a', 'Apple', 100)]) };
  const storage = createMemoryStorage();
  const cycleDeps = deps({ dek, http: service.client, local, deviceId: 'device-1', storage });

  await runSyncCycleUnlocked(cycleDeps);
  const pushesAfterFirst = service.pushes;
  const second = await runSyncCycleUnlocked(cycleDeps);

  assert.equal(second.pushed, false);
  assert.equal(service.pushes, pushesAfterFirst, 'an unchanged store must not issue a second push');
  assert.equal(service.version, 1);
});

test('two devices that diverge both converge on the union', async () => {
  const dek = generateDek();
  const service = fakeService(dek);

  const deviceOne = { current: snapshot([log('a', 'Apple', 100)]) };
  const deviceTwo = { current: snapshot([log('b', 'Bread', 50)]) };
  const storageOne = createMemoryStorage();
  const storageTwo = createMemoryStorage();

  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceOne, deviceId: 'device-1', storage: storageOne }),
  );
  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceTwo, deviceId: 'device-2', storage: storageTwo }),
  );

  assert.deepEqual(
    deviceTwo.current.foodLogs.map((entry) => entry.id).toSorted(),
    ['a', 'b'],
    'device two must merge rather than overwrite',
  );

  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceOne, deviceId: 'device-1', storage: storageOne }),
  );
  assert.deepEqual(deviceOne.current.foodLogs.map((entry) => entry.id).toSorted(), ['a', 'b']);
});

test('a CAS race lost BETWEEN the pull and the push is retried, not surfaced', async () => {
  const dek = generateDek();
  const service = fakeService(dek);

  const deviceOne = { current: snapshot([log('a', 'Apple', 100)]) };
  const deviceTwo = { current: snapshot([log('b', 'Bread', 50)]) };
  const storageOne = createMemoryStorage();
  const storageTwo = createMemoryStorage();

  // The genuine race: device two reads the world, and device one commits
  // before device two's own write lands. Nothing about ordinary divergence
  // produces this, the cycle pulls first, so it has to be staged.
  service.raceOnNextPush(async () => {
    await runSyncCycleUnlocked(
      deps({ dek, http: service.client, local: deviceOne, deviceId: 'device-1', storage: storageOne }),
    );
  });

  const result = await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceTwo, deviceId: 'device-2', storage: storageTwo }),
  );

  assert.equal(result.attempts, 2, 'the first attempt must have lost the CAS and been retried');
  assert.equal(result.pushed, true);
  assert.deepEqual(
    deviceTwo.current.foodLogs.map((entry) => entry.id).toSorted(),
    ['a', 'b'],
    'the retry must MERGE the winner rather than clobber it',
  );

  const stored = await service.read();
  // SAFETY: as above, the stored payload is the one this cycle pushed.
  assert.deepEqual((stored.snapshot as SyncedSnapshot).foodLogs.map((entry) => entry.id).toSorted(), ['a', 'b']);
});

test('a service that never stops changing fails loudly instead of spinning', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const alwaysConflicting: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    pullBlob: service.client.pullBlob.bind(service.client),
    pushBlob: async () => ({ status: 'conflict', currentVersion: 0 }),
  };

  await assert.rejects(
    () =>
      runSyncCycleUnlocked({
        // SAFETY: same two-method surface as `fakeService`'s client, the cycle
        // calls nothing else on the transport.
        ...deps({
          dek,
          http: alwaysConflicting as SyncHttpClient,
          local: { current: snapshot([log('a', 'A', 1)]) },
          deviceId: 'd',
        }),
        maxAttempts: 3,
      }),
    /could not settle after 3 attempts/,
  );
});

test('a deletion on one device propagates to the other rather than being re-uploaded', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const deviceOne = { current: snapshot([log('a', 'Apple', 100), log('b', 'Bread', 50)]) };
  const deviceTwo = { current: snapshot([]) };
  const storageOne = createMemoryStorage();
  const storageTwo = createMemoryStorage();

  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceOne, deviceId: 'device-1', storage: storageOne }),
  );
  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceTwo, deviceId: 'device-2', storage: storageTwo }),
  );
  assert.equal(deviceTwo.current.foodLogs.length, 2);

  // Device two deletes one entry and syncs. The journal row is what the app's
  // `deleteLocalFoodLog` writes in the same transaction as the row removal.
  deviceTwo.current = snapshot([log('a', 'Apple', 100)]);
  const deletedOnTwo = new Set(['foodLog:b']);
  await runSyncCycleUnlocked(
    deps({
      dek,
      http: service.client,
      local: deviceTwo,
      deviceId: 'device-2',
      storage: storageTwo,
      deleted: deletedOnTwo,
    }),
  );
  // THE PRUNE, observed rather than assumed: the delete is published and agreed,
  // so the journal row that authorised it is gone.
  assert.deepEqual([...deletedOnTwo], [], 'a published delete must be forgotten from the journal');

  // Device one must adopt the deletion, not push its own stale copy back.
  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceOne, deviceId: 'device-1', storage: storageOne }),
  );
  assert.deepEqual(
    deviceOne.current.foodLogs.map((entry) => entry.id),
    ['a'],
  );
});

test('an over-cap blob fails with a size error before the request is made', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  // Random names defeat gzip, so the plaintext really does exceed the cap.
  const huge = Array.from({ length: 40_000 }, (_, index) =>
    log(`id-${index}`, crypto.randomUUID() + crypto.randomUUID(), index),
  );
  const local = { current: snapshot(huge) };

  await assert.rejects(
    () => runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1' })),
    /sync limit/,
  );
  assert.equal(service.pushes, 0, 'the oversized blob must never reach the wire');
});

test('a blob this device cannot decrypt is refused with a readable reason, not a cipher error', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await service.seed({ snapshot: snapshot([log('a', 'Apple', 100)]), syncMeta: { perEntity: {}, tombstones: [] } }, 1);

  const wrongDek = generateDek();
  await assert.rejects(
    () =>
      runSyncCycleUnlocked(
        deps({
          dek: wrongDek,
          http: service.client,
          local: { current: snapshot([]) },
          deviceId: 'device-1',
        }),
      ),
    /could not be decrypted/,
  );
});

test('a corrupt persisted state is rebuilt rather than fatal', () => {
  const storage = createMemoryStorage({ 'openplate.sync.state.v1:42': '{not json' });
  const store = createSyncStateStore({ storage, accountId: ACCOUNT_ID });

  assert.deepEqual(store.load(), emptySyncState());
});

// ---------------------------------------------------------------------------
// `shrinkAcknowledged`: the client's half of the service's shrink refusal
// ---------------------------------------------------------------------------

test('shrinkAcknowledged is true ONLY for a cycle that published deletes it could prove', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const local = { current: snapshot([log('a', 'Apple', 100), log('b', 'Bread', 50)]) };
  const storage = createMemoryStorage();

  // Cycle 1: two new entries, no deletes at all.
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));
  assert.deepEqual(service.shrinkFlags, [false], 'a cycle with no deletes must not claim a shrink');

  // Cycle 2: a REAL delete on a healthy device, recorded in the journal.
  local.current = snapshot([log('a', 'Apple', 100)]);
  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted: new Set(['foodLog:b']) }),
  );
  assert.deepEqual(service.shrinkFlags, [false, true], 'a proven delete must acknowledge the shrink');

  // CYCLE 3, THE ONE THIS TEST WAS MISSING (M225). Nothing new is deleted, but
  // the baseline still carries cycle 2's tombstone and always will: it never
  // compacts. A flag computed from `meta.tombstones` is therefore true here,
  // and stays true for the rest of this device's life, which switches the
  // service's shrink guard off for exactly the devices most likely to need it.
  // Compute it from `stamped.meta.tombstones` again and this line goes red.
  local.current = snapshot([log('a', 'Apple', 100), log('c', 'Cheese', 30)]);
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));
  assert.deepEqual(
    service.shrinkFlags,
    [false, true, false],
    'a cycle that deleted nothing must not acknowledge a shrink, however old its tombstones are',
  );
});

test('a genuine bulk delete is trusted whole and acknowledged, however much of the diary it takes', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const wholeDiary = Array.from({ length: 10 }, (_, index) => log(`log-${index}`, `Meal ${index}`, 100 + index));
  const local = { current: snapshot(wholeDiary) };
  const storage = createMemoryStorage();

  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  // Somebody deletes eight of their ten entries, one tap at a time. Every one
  // of those taps wrote a journal row, so there is nothing partial about the
  // evidence and nothing here is a ratio: the RULE is per entity, and a device
  // that recorded eight deletes may publish eight.
  const kept = wholeDiary.slice(0, 2);
  const removed = wholeDiary.slice(2).map((entry) => `foodLog:${entry.id}`);
  local.current = snapshot(kept);
  const deleted = new Set(removed);
  const result = await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }),
  );

  assert.deepEqual(result.withheldTombstones, [], 'a recorded delete is never withheld, whatever the proportion');
  const pushed = await service.read();
  assert.equal(pushed.syncMeta.tombstones.length, 8, 'all eight deletes must be published');
  assert.deepEqual(
    service.shrinkFlags,
    [false, true],
    'and the shrink must be acknowledged, or the service refuses a deletion the person meant',
  );
  assert.deepEqual([...deleted], [], 'the published journal rows are pruned');
});

test('a REFUSED push heals the device before the error leaves, so the next cycle can settle', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const storage = createMemoryStorage();

  // The account holds a diary this device cannot see. Its own snapshot is
  // empty, so the push shrinks, and the service turns it back.
  await service.seed(
    {
      snapshot: snapshot([log('a', 'Apple', 100), log('b', 'Bread', 50)]),
      syncMeta: { perEntity: { 'foodLog:a': { lamport: 1, deviceId: 'device-2' } }, tombstones: [] },
    },
    1,
  );
  const local = { current: snapshot([log('c', 'Cheese', 30)]) };
  service.refuseTheNextPush();

  await assert.rejects(
    () => runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage })),
    (cause: unknown) => cause instanceof SyncRequestError && cause.kind === 'invalid',
  );

  // THE CLAIM. The pulled diary was applied on the way out, so the device is no
  // longer missing rows its account holds. Before this, the throw skipped
  // `applySnapshot`, the merge was discarded, and every later cycle repeated
  // the same refused push against the same empty device: a livelock with an
  // empty diary on screen and the repair one completed request away.
  assert.deepEqual(
    local.current.foodLogs.map((entry) => entry.id).toSorted(),
    ['a', 'b', 'c'],
    'the pulled entries must have reached the device even though the push was refused',
  );

  // AND IT SETTLES. Nothing was committed, so this cycle stamps the healed
  // snapshot, which no longer shrinks, and the service takes it.
  const settled = await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));
  assert.equal(settled.pushed, true, 'the next cycle must succeed rather than repeat the refusal');
  // SAFETY: `SyncPayload.snapshot` is `unknown` on the wire because the envelope
  // carries whatever schema version wrote it. What this test put there is this
  // file's own fixture shape, and only the ids are read.
  const settledSnapshot = (await service.read()).snapshot as { foodLogs: { id: string }[] };
  assert.deepEqual(settledSnapshot.foodLogs.map((entry) => entry.id).toSorted(), ['a', 'b', 'c']);
});

test('shrinkAcknowledged is false when ANY tombstone was withheld', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const local = { current: snapshot([log('a', 'Apple', 100), log('b', 'Bread', 50)]) };
  const storage = createMemoryStorage();

  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  // The same device after an eviction: the baseline names both entries and the
  // store reads empty with no database behind it.
  local.current = snapshot([]);
  const result = await runSyncCycleUnlocked({
    ...deps({ dek, http: service.client, local, deviceId: 'device-1', storage }),
    readSnapshot: async () => ({ snapshot: local.current, integrity: EVICTED_STORAGE }),
  });

  assert.equal(result.withheldTombstones.length, 2, 'both deletes must have been withheld');
  // NON-VACUITY: the flag never went true, on any push this whole test made.
  assert.ok(
    !service.shrinkFlags.includes(true),
    'a device that could not prove a delete must never acknowledge a shrink',
  );
});

// ---------------------------------------------------------------------------
// The pass-through collections, through a whole cycle
// ---------------------------------------------------------------------------

/**
 * `fasts` and `savedMeals` are not merged: whichever side the merge picks is
 * the whole list that reaches the wire. Which side that is used to be "local,
 * always", and on a device that cannot vouch for its own storage that published
 * an emptiness nobody asked for, over an account that still held the rows. No
 * tombstone is involved anywhere, so M224's guard never sees these two.
 */
function fast(id: string): LocalStoreSnapshot['fasts'][number] {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 57_600_000,
    plannedStartAt: null,
    startedAt: 1_770_000_000_000,
    endedAt: null,
    createdAt: 1_770_000_000_000,
  };
}

function savedMeal(id: string): LocalStoreSnapshot['savedMeals'][number] {
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

/** The account as another device left it: one entry, one fast, one saved meal. */
async function seedTheAccount(service: ReturnType<typeof fakeService>): Promise<void> {
  await service.seed(
    {
      snapshot: {
        ...snapshot([log('a', 'Apple', 100)]),
        fasts: [fast('on-the-account')],
        savedMeals: [savedMeal('on-the-account')],
      },
      syncMeta: { perEntity: { 'foodLog:a': { lamport: 1, deviceId: 'device-other' } }, tombstones: [] },
    },
    1,
  );
}

/** What the service is holding now, read back by decrypting the blob rather than trusting an in-memory copy. */
async function pushedLists(service: ReturnType<typeof fakeService>): Promise<{ fasts: string[]; savedMeals: string[] }> {
  const payload = await service.read();
  // SAFETY: `SyncPayload.snapshot` is `unknown` on the wire because the
  // envelope carries whatever schema version wrote it; the only thing that
  // ever reached this fake service is this build's own `SyncedSnapshot`.
  const pushed = payload.snapshot as SyncedSnapshot;
  return {
    fasts: pushed.fasts.map((entry) => entry.id).toSorted(),
    savedMeals: pushed.savedMeals.map((entry) => entry.id).toSorted(),
  };
}

test('an EVICTED device pushes the account fasts and saved meals back, not its own emptiness', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTheAccount(service);

  // The device reads empty because its database is gone. The new entry is what
  // makes this cycle push at all, which is the moment the loss used to happen.
  const local = { current: snapshot([log('b', 'Bread', 50)]) };
  const result = await runSyncCycleUnlocked({
    ...deps({ dek, http: service.client, local, deviceId: 'device-1' }),
    readSnapshot: async () => ({ snapshot: local.current, integrity: EVICTED_STORAGE }),
  });

  // NON-VACUITY: a cycle that pushed nothing would leave the seeded blob
  // standing and the assertions below would say nothing at all.
  assert.equal(result.pushed, true, 'this cycle must really have rewritten the blob');
  assert.deepEqual(await pushedLists(service), {
    fasts: ['on-the-account'],
    savedMeals: ['on-the-account'],
  });
});

/** A device that agrees with the account, so the baseline it commits RECORDS both pass-through ids. */
function snapshotHoldingBoth(logs: LocalStoreSnapshot['foodLogs']): SyncedSnapshot {
  return { ...snapshot(logs), fasts: [fast('on-the-account')], savedMeals: [savedMeal('on-the-account')] };
}

/**
 * The same device on its NEXT cycle, with the two lists cleared and one entry
 * added.
 *
 * The account's own `a` is still here on purpose. Dropping it would leave a
 * baseline entry this device cannot prove, which is a WITHHELD tombstone, and a
 * withheld tombstone forbids `shrinkAcknowledged` all by itself. Every flag
 * asserted below would then be right for a reason that is not the one under
 * test. The added `c` is what makes the cycle push at all: `payloadsEqual`
 * weighs neither pass-through collection, so a list emptying is never by itself
 * a reason to burn a blob version.
 */
function snapshotAfterClearing(): SyncedSnapshot {
  return snapshot([log('a', 'Apple', 100), log('b', 'Bread', 50), log('c', 'Cheese', 30)]);
}

test('THE CONTROL: a device that RECORDED both removals publishes none of either', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTheAccount(service);
  const storage = createMemoryStorage();
  const deleted = new Set<string>();

  // CYCLE 1 is what makes this a control rather than a coincidence: the device
  // agrees with the account, so the baseline it commits names both ids, and the
  // removals below are removals of ids this device can be held to.
  const local = { current: snapshotHoldingBoth([log('b', 'Bread', 50)]) };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }));
  const recorded = storage.getItem('openplate.sync.state.v1:42') ?? '';
  assert.ok(recorded.includes('on-the-account'), 'precondition: the baseline records what the account holds');

  // CYCLE 2: the person clears both, one tap each, and each tap wrote a journal
  // row. Without this case, the eviction test above passes against a merge that
  // always prefers the remote, which would resurrect every fast and every saved
  // meal anybody ever deleted.
  local.current = snapshotAfterClearing();
  deleted.add('fast:on-the-account');
  deleted.add('savedMeal:on-the-account');
  const result = await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }),
  );

  assert.equal(result.pushed, true);
  assert.deepEqual(await pushedLists(service), { fasts: [], savedMeals: [] }, 'a recorded deletion must still stick');
});

test('THE OTHER CONTROL: the same removals with nothing recorded leave the account holding both', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTheAccount(service);
  const storage = createMemoryStorage();

  const local = { current: snapshotHoldingBoth([log('b', 'Bread', 50)]) };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  // Byte for byte the cycle above, with the journal left empty. This is the
  // shape of the loss: the storage signals all read healthy, because a primed
  // empty database always does, and the only difference is that nobody wrote a
  // removal down.
  local.current = snapshotAfterClearing();
  const result = await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  assert.equal(result.pushed, true, 'the new entry must still reach the account');
  assert.deepEqual(await pushedLists(service), { fasts: ['on-the-account'], savedMeals: ['on-the-account'] });
});

test('a PARTIAL load is weighed per table: the half-read list is spared, the one beside it is not', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTheAccount(service);
  const storage = createMemoryStorage();
  const deleted = new Set<string>();

  const local = { current: snapshotHoldingBoth([log('b', 'Bread', 50)]) };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }));

  // The database is there, so the whole-database signal says nothing. Both
  // removals are recorded, so the journal says nothing against either. Only the
  // per-table signal can tell that the fasts table was half read, and it is
  // enough on its own to spare that one list.
  local.current = snapshotAfterClearing();
  deleted.add('fast:on-the-account');
  deleted.add('savedMeal:on-the-account');
  const result = await runSyncCycleUnlocked({
    ...deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }),
    readSnapshot: async () => ({
      snapshot: local.current,
      integrity: {
        hasPersistedDatabase: true,
        isTableLoaded: { [FASTS_TABLE]: false },
        isCompartmentKnown: true,
        deletedEntityKeys: new Set(deleted),
      },
    }),
  });

  assert.equal(result.pushed, true);
  assert.deepEqual(await pushedLists(service), { fasts: ['on-the-account'], savedMeals: [] });

  // AND THE JOURNAL IS EMPTY, both rows spent. This line USED TO KEEP
  // `fast:on-the-account`, on the old rule that a removal the merge refused
  // should be retried from its journal row. That rule left four classes of key
  // in the journal forever, so the prune is now by CYCLE rather than by
  // outcome: a key the cycle read was weighed by that cycle, and this one was,
  // it lost, and the fast is back on the device where the applied snapshot put
  // it. A key that describes a live row is not evidence of anything.
  assert.deepEqual([...deleted], [], 'every key this cycle weighed is spent, whichever way it went');
});

test('a push whose only removals are recorded saved meals still acknowledges the shrink', async () => {
  // THE SECOND HALF OF `shrinkAcknowledged`. Saved meals are not merged, so
  // clearing forty of them mints no tombstone at all, and a flag built from
  // `minted` alone leaves that push looking like an unexplained shrink. The
  // service refuses it, and the person who meant it is told nothing useful.
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTheAccount(service);
  const storage = createMemoryStorage();
  const deleted = new Set<string>();

  const local = { current: snapshotHoldingBoth([log('b', 'Bread', 50)]) };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }));

  // The REMOVALS in this push are only the saved meal, which is what the flag
  // below is about.
  local.current = {
    ...snapshotAfterClearing(),
    fasts: [fast('on-the-account')],
    savedMeals: [],
  };
  deleted.add('savedMeal:on-the-account');
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }));

  assert.deepEqual(await pushedLists(service), { fasts: ['on-the-account'], savedMeals: [] });
  assert.equal(service.shrinkFlags.at(-1), true, 'a recorded pass-through removal is a shrink the client meant');
});

test('THE CONTROL: the same push with nothing recorded acknowledges nothing, and the account keeps its list', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTheAccount(service);
  const storage = createMemoryStorage();

  const local = { current: snapshotHoldingBoth([log('b', 'Bread', 50)]) };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  // Without this case the test above passes against a flag that is simply
  // always true, which switches the service's shrink guard off for everybody.
  local.current = { ...snapshotAfterClearing(), fasts: [fast('on-the-account')] };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  assert.equal(service.shrinkFlags.at(-1), false, 'nothing was proven, so nothing may be acknowledged');
  assert.deepEqual(
    (await pushedLists(service)).savedMeals,
    ['on-the-account'],
    'and the envelope must carry the account list back, not this device silence',
  );
});

/** The account as another device left it, holding TWO saved meals and one entry. */
async function seedTwoSavedMeals(service: ReturnType<typeof fakeService>): Promise<void> {
  await service.seed(
    {
      snapshot: {
        ...snapshot([log('a', 'Apple', 100)]),
        fasts: [],
        savedMeals: [savedMeal('first'), savedMeal('second')],
      },
      syncMeta: { perEntity: { 'foodLog:a': { lamport: 1, deviceId: 'device-other' } }, tombstones: [] },
    },
    1,
  );
}

/** The same device holding both of them, so cycle 1 commits a baseline that names both ids. */
function snapshotHoldingTwoSavedMeals(): SyncedSnapshot {
  return { ...snapshot([log('a', 'Apple', 100)]), savedMeals: [savedMeal('first'), savedMeal('second')] };
}

test('a cycle whose ONLY change is two recorded saved-meal removals still pushes', async () => {
  // THE ADOPT PATH IS BLIND TO THESE TWO LISTS. `canonicalize` weighs neither
  // `fasts` nor `savedMeals`, so this cycle's payload compares EQUAL to the
  // blob that still holds both meals. Adopting it would commit a baseline that
  // no longer names them and prune the journal rows that prove the removal, and
  // the next real push would then shrink the blob with nothing left to declare.
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTwoSavedMeals(service);
  const storage = createMemoryStorage();
  const deleted = new Set<string>();

  const local = { current: snapshotHoldingTwoSavedMeals() };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }));

  // CYCLE 2: two taps, two journal rows, and NOTHING else moved. No entry is
  // added, so the food logs are byte for byte what the account already holds.
  local.current = { ...snapshotHoldingTwoSavedMeals(), savedMeals: [] };
  deleted.add('savedMeal:first');
  deleted.add('savedMeal:second');
  const result = await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }),
  );

  assert.equal(result.pushed, true, 'a published removal must burn a blob version, equal payload or not');
  assert.equal(service.shrinkFlags.at(-1), true, 'and it must declare the shrink while the journal still proves it');
  assert.deepEqual(await pushedLists(service), { fasts: [], savedMeals: [] });
  assert.deepEqual([...deleted], [], 'both journal rows are spent once the account agreed');
});

test('THE CONTROL: the same two removals with nothing recorded adopt, and the account keeps both meals', async () => {
  // Without this case the test above passes against a cycle that simply never
  // adopts anything, which would burn a blob version on every boot.
  const dek = generateDek();
  const service = fakeService(dek);
  await seedTwoSavedMeals(service);
  const storage = createMemoryStorage();

  const local = { current: snapshotHoldingTwoSavedMeals() };
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  local.current = { ...snapshotHoldingTwoSavedMeals(), savedMeals: [] };
  const result = await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  assert.equal(result.pushed, false, 'nothing was proven, so there is nothing to publish');
  assert.deepEqual(
    local.current.savedMeals.map((entry) => entry.id).toSorted(),
    ['first', 'second'],
    'and the applied snapshot carries the account list back to this device',
  );
});

// ---------------------------------------------------------------------------
// The journal prune: after a commit, the journal holds only deletes recorded
// AFTER that cycle's read
// ---------------------------------------------------------------------------

test('a key that was never synced at all is forgotten on commit', async () => {
  // CREATED AND DELETED BETWEEN TWO CYCLES. No baseline ever named the entry,
  // no blob ever carried it, so `stampSnapshot` mints no tombstone for it and
  // the merge has nothing to publish. On the old rule, tombstones plus a
  // pass-through diff, nothing in the cycle could ever name this key, and it
  // sat in the journal for the life of the device. Multiply by every entry
  // somebody logs and undoes in the same minute.
  const dek = generateDek();
  const service = fakeService(dek);
  const local = { current: snapshot([log('a', 'Apple', 100)]) };
  const storage = createMemoryStorage();

  // Cycle 1 commits a baseline naming only `a`.
  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  // Between the cycles the person logs `b` and takes it straight back out. The
  // delete verb wrote the journal row; the snapshot never carried `b` to the
  // wire. `c` is what makes cycle 2 push at all.
  local.current = snapshot([log('a', 'Apple', 100), log('c', 'Cheese', 30)]);
  const deleted = new Set(['foodLog:b']);
  const result = await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }),
  );

  // NON-VACUITY: the cycle really committed, and it really minted nothing for
  // `b`. Without both, an empty journal below would mean nothing happened.
  assert.equal(result.pushed, true, 'precondition: the cycle must have committed a payload');
  const pushed = await service.read();
  assert.deepEqual(
    pushed.syncMeta.tombstones.filter((tombstone) => tombstone.entityId === 'b'),
    [],
    'precondition: an entry no baseline ever named mints no tombstone',
  );

  // THE CLAIM. Put the old rule back, forget only `merged.meta.tombstones`
  // plus the pass-through diff, and this line reads `['foodLog:b']`.
  assert.deepEqual([...deleted], [], 'a key this cycle weighed and could not publish is still spent');
});

test('a cycle REFUSED with a 400 after the apply forgets nothing', async () => {
  // THE ORDERING RULE. The journal row is the only thing that can re-authorise
  // a delete, so it may only be dropped behind a committed baseline that
  // carries the tombstone. `pushOrHeal` applies the merge and rethrows on a
  // 400; nothing was stored and nothing was committed, so nothing was weighed.
  const dek = generateDek();
  const service = fakeService(dek);
  const local = { current: snapshot([log('a', 'Apple', 100), log('b', 'Bread', 50)]) };
  const storage = createMemoryStorage();

  await runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage }));

  local.current = snapshot([log('a', 'Apple', 100)]);
  const deleted = new Set(['foodLog:b']);
  service.refuseTheNextPush();
  await assert.rejects(
    () => runSyncCycleUnlocked(deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted })),
    (cause: unknown) => cause instanceof SyncRequestError && cause.kind === 'invalid',
    'precondition: the refusal must reach the caller',
  );

  // THE CLAIM. Move either `forgetPublishedDeletes` call above its
  // `commitState`, or add one to the `catch` in `pushOrHeal`, and this line
  // reads `[]`, which is a delete nothing on this device or its account can
  // still prove.
  assert.deepEqual([...deleted], ['foodLog:b'], 'a cycle that stored nothing must prune nothing');

  // AND IT SETTLES: the surviving row is what lets the next cycle publish the
  // delete for real, which is the reason the rule is worth keeping.
  const settled = await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local, deviceId: 'device-1', storage, deleted }),
  );
  assert.equal(settled.pushed, true);
  const pushed = await service.read();
  assert.deepEqual(
    pushed.syncMeta.tombstones.map((tombstone) => tombstone.entityId),
    ['b'],
    'the delete reaches the account on the next cycle',
  );
  assert.deepEqual([...deleted], [], 'and only then is its journal row spent');
});
