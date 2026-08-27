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
 * IndexedDB, no server and no locks — the algorithm is exercised directly.
 */
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
  // sync engine (see `mergeSnapshots`) — an empty array is the whole fixture.
  return {
    foods: [],
    foodLogs: logs,
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    // The owner-private compartment (M160/07). `null` is a device that has
    // never generated a share key — the ordinary case, and the one that must
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
  /** When set, the next push finds that another device wrote first — the real 409 race. */
  let interfereBeforeNextPush: (() => Promise<void>) | null = null;

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
    }): Promise<PushBlobHttpResult> {
      pushes += 1;
      if (interfereBeforeNextPush !== null) {
        const interfere = interfereBeforeNextPush;
        interfereBeforeNextPush = null;
        await interfere();
      }
      const current = stored?.version ?? 0;
      if (input.baseVersion !== current) return { status: 'conflict', currentVersion: current };
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
    /** Arranges for another device to win the race on the very next push. */
    raceOnNextPush(run: () => Promise<void>): void {
      interfereBeforeNextPush = run;
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
}: {
  dek: Uint8Array;
  http: SyncHttpClient;
  local: { current: SyncedSnapshot };
  deviceId: string;
  storage?: ReturnType<typeof createMemoryStorage>;
}) {
  return {
    accountId: ACCOUNT_ID,
    dek,
    http,
    state: createSyncStateStore({ storage, accountId: ACCOUNT_ID }),
    deviceId,
    readSnapshot: async () => local.current,
    applySnapshot: async ({ merged }: { merged: SyncedSnapshot }) => {
      local.current = merged;
    },
    // SAFETY: the only payload these cycles can pull back is one they pushed,
    // built from `local.current` — a `SyncedSnapshot` by construction.
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
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: { perEntity: {}, tombstones: [] },
    deviceId: 'device-1',
  });
  assert.equal(first.meta.perEntity['foodLog:a']?.lamport, 1);

  const unchanged = stampSnapshot({
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: first.baseline,
    deviceId: 'device-1',
  });
  assert.equal(unchanged.meta.perEntity['foodLog:a']?.lamport, 1, 'an untouched entity must not advance');

  const changed = stampSnapshot({
    snapshot: snapshot([log('a', 'Apple', 150)]),
    baseline: first.baseline,
    deviceId: 'device-1',
  });
  assert.equal(changed.meta.perEntity['foodLog:a']?.lamport, 2);
});

test('an entity that disappears becomes a tombstone above its last stamp', () => {
  const first = stampSnapshot({
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: { perEntity: {}, tombstones: [] },
    deviceId: 'device-1',
  });
  const deleted = stampSnapshot({ snapshot: snapshot([]), baseline: first.baseline, deviceId: 'device-1' });

  assert.deepEqual(deleted.meta.tombstones, [
    { entityId: 'a', entityType: 'foodLog', lamport: 2, deviceId: 'device-1' },
  ]);
  assert.equal(deleted.meta.perEntity['foodLog:a'], undefined);
});

test('a re-added entity outranks its own tombstone — deletions do not resurrect', () => {
  const created = stampSnapshot({
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: { perEntity: {}, tombstones: [] },
    deviceId: 'device-1',
  });
  const deleted = stampSnapshot({ snapshot: snapshot([]), baseline: created.baseline, deviceId: 'device-1' });
  const readded = stampSnapshot({
    snapshot: snapshot([log('a', 'Apple', 100)]),
    baseline: deleted.baseline,
    deviceId: 'device-1',
  });

  const liveStamp = readded.meta.perEntity['foodLog:a'];
  assert.ok(liveStamp !== undefined);
  assert.equal(liveStamp.lamport, 3, 'the live stamp must beat the tombstone at 2');
  assert.equal(readded.meta.tombstones.length, 0);
});

test('the merge is symmetric — both devices compute the identical result', () => {
  const a: StampedSnapshot = {
    snapshot: snapshot([log('a', 'Apple', 100)]),
    meta: { perEntity: { 'foodLog:a': { lamport: 2, deviceId: 'device-a' } }, tombstones: [] },
  };
  const b: StampedSnapshot = {
    snapshot: snapshot([log('b', 'Bread', 50)]),
    meta: { perEntity: { 'foodLog:b': { lamport: 1, deviceId: 'device-b' } }, tombstones: [] },
  };

  const fromA = mergeSnapshots({ local: a, remote: b });
  const fromB = mergeSnapshots({ local: b, remote: a });

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

  assert.equal(mergeSnapshots({ local: older, remote: newer }).snapshot.foodLogs[0]?.name, 'New name');

  const tie = mergeSnapshots({
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

  assert.equal(mergeSnapshots({ local: live, remote: deleted }).snapshot.foodLogs.length, 0);

  const editedAfterDelete: StampedSnapshot = {
    ...live,
    meta: { perEntity: { 'foodLog:a': { lamport: 3, deviceId: 'device-a' } }, tombstones: [] },
  };
  assert.equal(mergeSnapshots({ local: editedAfterDelete, remote: deleted }).snapshot.foodLogs.length, 1);
});

test('baselineFromPayload hashes what was agreed, so the next cycle sees no change', () => {
  const payload: StampedSnapshot = {
    snapshot: snapshot([log('a', 'Apple', 100)]),
    meta: { perEntity: { 'foodLog:a': { lamport: 4, deviceId: 'device-a' } }, tombstones: [] },
  };
  const baseline = baselineFromPayload(payload);
  const restamped = stampSnapshot({ snapshot: payload.snapshot, baseline, deviceId: 'device-b' });

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

test('a second cycle with nothing changed pushes NOTHING — boots must not burn blob versions', async () => {
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
  // produces this — the cycle pulls first — so it has to be staged.
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
  // SAFETY: as above — the stored payload is the one this cycle pushed.
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
        // SAFETY: same two-method surface as `fakeService`'s client — the cycle
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

  // Device two deletes one entry and syncs.
  deviceTwo.current = snapshot([log('a', 'Apple', 100)]);
  await runSyncCycleUnlocked(
    deps({ dek, http: service.client, local: deviceTwo, deviceId: 'device-2', storage: storageTwo }),
  );

  // Device one must adopt the deletion — not push its own stale copy back.
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
