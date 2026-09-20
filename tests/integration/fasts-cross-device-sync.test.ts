/**
 * A FAST TRAVELS BETWEEN A PERSON'S DEVICES (M240/01, ADR-0014).
 *
 * Until this milestone it did not. `mergeSnapshots` handed the local `fasts`
 * list straight back, `canonicalize` never looked at it, and the account never
 * held a fast anybody could get back. Erase the phone, lose it, or open the
 * app on a tablet, and the fasting history was gone while the routine beside
 * it synced perfectly. This file is the proof that the reversal works, and it
 * is deliberately the shape of the thing a person does rather than the shape
 * of the functions that do it.
 *
 * ── What is real here ────────────────────────────────────────────────────
 *
 * THE PHONE IS THE DEVICE'S OWN STORE. It writes through `createLocalFast`,
 * `endLocalFast` and `deleteLocalFast`, the same verbs `/fasting` calls, onto
 * a real TinyBase store on a real (fake-backed) IndexedDB, with a real delete
 * journal. It syncs through `runSyncCycleUnlocked` over `readLocalSnapshot`
 * and `applyMergedSnapshot`, which is the production wiring minus the
 * compartment, exactly as `sync-peer-delete-is-not-mine.test.ts` drives it.
 * Every claim about what lands ON a device is read back out of that store.
 *
 * THE TABLET IS A SECOND DEVICE, through the same orchestrator, the same
 * stamping, the same merge and the same encrypted envelope, with a plain
 * object where the phone has IndexedDB. The store singleton is per PROCESS, so
 * two IndexedDB-backed devices cannot exist in one test run; this is the
 * neighbours' answer to that and it fakes nothing the merge reads.
 *
 * THE SERVICE compare-and-swaps on `blobVersion` and never decrypts, which is
 * the real service's position. Every assertion about the account reads the
 * decrypted blob, never an in-memory copy of what we hoped was sent.
 *
 * ── The one question with two truthful answers ───────────────────────────
 *
 * `createLocalFast` refuses a second open fast on one device. Two devices
 * offline can each start one, and M132 declined to merge fasts at all rather
 * than answer that. ADR-0014 merges them and still declines to answer it in
 * the merge: BOTH survive, on both devices, the screen shows the
 * latest-started as current and the other as still open with a Remove, and a
 * Remove travels like any other delete. The cases below drive that in BOTH
 * merge orders, because a merge whose result depends on who syncs first does
 * not converge.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { buildEnvelope, parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import type { PulledBlob, PushBlobHttpResult, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import {
  createMemoryStorage,
  createSyncStateStore,
  type KeyValueStorage,
  type SyncStateStore,
} from '../../app/lib/sync/sync-state';
import { entityKey, SYNC_ENTITY_TYPES, type StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
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
import { eraseDeviceData } from '../../app/lib/local-store/device-erase';
import { selectCurrentFast, selectFastHistory } from '../../app/models/fasting';
import {
  createLocalFast,
  deleteLocalFast,
  endLocalFast,
  forgetDeletedEntityKeys,
  listDeletedEntityKeys,
  listLocalFasts,
  putLocalFast,
  SCHEMA_VERSION,
  type LocalFast,
} from '../../app/lib/local-store';

const ACCOUNT_ID = 240;
const PHONE = 'device-phone';
const TABLET = 'device-tablet';
const HOUR = 3_600_000;
const T = Date.parse('2026-09-20T06:00:00Z');

before(() => {
  // SAFETY: `persist.ts` refuses to open a store unless it believes it is in a
  // browser; the guard is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;
  // The store's autoLoad poll would hold this process open after the last
  // assertion, so every interval it schedules is unref'd.
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

/**
 * The store singleton is per PROCESS, so every case starts by putting the
 * phone back to a device that holds no fast and has written nothing down.
 *
 * The removals go through `deleteLocalFast`, which journals, and the journal
 * is then emptied: that pair is how the neighbouring files spell "these rows
 * are not here and this device never recorded removing one", which is the only
 * honest starting state for a case about what a device can prove.
 */
async function quietPhone(): Promise<void> {
  for (const entry of await listLocalFasts()) await deleteLocalFast(entry.id);
  await forgetDeletedEntityKeys(await listDeletedEntityKeys());
  await settleAutosave();
  assert.deepEqual(await listLocalFasts(), [], 'the phone must start each case holding no fast');
  assert.deepEqual(await listDeletedEntityKeys(), [], 'and having written nothing down');
}

/**
 * Lets the store's autosave reach the disk, so the next cycle's integrity read
 * describes the device the case just built.
 *
 * NOT DECORATION, and `sync-eviction-not-deletion.test.ts` carries the same
 * line for the same reason. `isTombstoneTrusted` asks the disk-versus-memory
 * record as its second gate, and between a write and its flush the disk still
 * holds the old rows, so `isTableLoaded.fasts` reads false and every tombstone
 * this cycle would mint is withheld. A healthy device settles in
 * milliseconds; a test that races it is asserting the scheduler, not the rule.
 */
async function settleAutosave(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(quietPhone);

after(quietPhone);

function fast(id: string, overrides: Partial<LocalFast> = {}): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 16 * HOUR,
    plannedStartAt: null,
    startedAt: T,
    endedAt: null,
    createdAt: T,
    ...overrides,
  };
}

function emptySnapshot(): SyncedSnapshot {
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    pantryItems: [],
    activityMarks: [],
    awards: [],
    fastingSettings: null,
    privateStore: null,
  };
}

// ---------------------------------------------------------------------------
// The account: compare-and-swap on a version, and nothing else
// ---------------------------------------------------------------------------

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
      stored = { version: current + 1, ciphertext: input.ciphertext };
      return { status: 'accepted', newVersion: stored.version };
    },
  };
  return {
    // SAFETY: the cycle reaches for `pullBlob` and `pushBlob` and nothing else.
    client: client as SyncHttpClient,
    version(): number {
      return stored?.version ?? 0;
    },
    /** THE FASTS THE ACCOUNT ACTUALLY HOLDS, decrypted, never an in-memory copy of what was sent. */
    async fastsOnTheAccount(): Promise<LocalFast[]> {
      assert.ok(stored !== null, 'the account must be holding a blob');
      const payload = await parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      // SAFETY: `SyncPayload.snapshot` is `unknown` on the wire because the
      // envelope carries whatever schema version wrote it. What this file put
      // there is this build's own `SyncedSnapshot`.
      return (payload.snapshot as SyncedSnapshot).fasts;
    },
    async tombstonesOnTheAccount(): Promise<string[]> {
      assert.ok(stored !== null, 'the account must be holding a blob');
      const payload = await parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      return payload.syncMeta.tombstones.map((entry) => entityKey(entry.entityType, entry.entityId)).toSorted();
    },
    /** Writes a blob straight onto the account, for the one case that needs a payload this build would never produce. */
    async seed(payload: StampedSnapshot): Promise<void> {
      const version = (stored?.version ?? 0) + 1;
      const envelope = await buildEnvelope({
        payload: { snapshot: payload.snapshot, syncMeta: payload.meta },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      stored = { version, ciphertext: envelope.ciphertext };
    },
  };
}

type Service = ReturnType<typeof fakeService>;

// ---------------------------------------------------------------------------
// The phone: the real store, the real bridge
// ---------------------------------------------------------------------------

function phoneDevice({ service, dek, state }: { service: Service; dek: Uint8Array; state: SyncStateStore }) {
  return {
    state,
    async cycle(): Promise<boolean> {
      // THE FLUSH BELONGS HERE, not at one call site. Every cycle in this file
      // follows a write through a real store verb, and every one of them would
      // otherwise be racing the persister (see {@link settleAutosave}).
      await settleAutosave();
      const result = await runSyncCycleUnlocked({
        accountId: ACCOUNT_ID,
        dek,
        http: service.client,
        state,
        deviceId: PHONE,
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
            // SAFETY: `applyMergedSnapshot` reads only the shareable collections,
            // and a `SyncedSnapshot` IS the shareable region plus the sealed
            // compartment, which is the one member it does not touch.
            local: local as ShareableSnapshot,
          });
        },
        assertPulledSnapshot: async () => {},
        forgetPublishedDeletes,
        // SAFETY: the only payloads in this file are this build's own.
        parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
      });
      return result.pushed;
    },
    async fasts(): Promise<LocalFast[]> {
      return (await listLocalFasts()).toSorted((a, b) => (a.id < b.id ? -1 : 1));
    },
    async fastIds(): Promise<string[]> {
      return (await listLocalFasts()).map((entry) => entry.id).toSorted();
    },
  };
}

// ---------------------------------------------------------------------------
// The tablet: the same engine over a plain object
// ---------------------------------------------------------------------------

function tabletDevice({ service, dek }: { service: Service; dek: Uint8Array }) {
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });
  let held: LocalFast[] = [];
  const journal = new Set<string>();
  return {
    state,
    /** What a write verb leaves behind: the row in the list. */
    hold(next: LocalFast[]): void {
      held = next;
    },
    /** What `deleteLocalFast` writes in the delete verb's own transaction. */
    record(id: string): void {
      journal.add(entityKey(SYNC_ENTITY_TYPES.fast, id));
      held = held.filter((entry) => entry.id !== id);
    },
    fastIds(): string[] {
      return held.map((entry) => entry.id).toSorted();
    },
    fasts(): LocalFast[] {
      return held.toSorted((a, b) => (a.id < b.id ? -1 : 1));
    },
    async cycle(): Promise<boolean> {
      const result = await runSyncCycleUnlocked({
        accountId: ACCOUNT_ID,
        dek,
        http: service.client,
        state,
        deviceId: TABLET,
        readSnapshot: async () => ({
          snapshot: { ...emptySnapshot(), fasts: held },
          integrity: {
            hasPersistedDatabase: true,
            isTableLoaded: {},
            isCompartmentKnown: true,
            isCompartmentHeld: false,
            isCompartmentUnpublished: false,
            deletedEntityKeys: new Set(journal),
          },
        }),
        applySnapshot: async ({ merged }) => {
          held = merged.fasts;
        },
        assertPulledSnapshot: async () => {},
        forgetPublishedDeletes: async (keys) => {
          for (const key of keys) journal.delete(key);
        },
        // SAFETY: the only payloads in this file are this build's own.
        parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
      });
      return result.pushed;
    },
  };
}

/**
 * A phone and a tablet on one fresh account.
 *
 * `phoneStorage` is handed back because the erase case needs it: the sync
 * baseline lives there, in `localStorage` on a real device, and taking it with
 * the rows is the whole of what an erase has to get right.
 */
function twoDevices() {
  const dek = generateDek();
  const service = fakeService(dek);
  const phoneStorage = createMemoryStorage();
  const phone = phoneDevice({
    service,
    dek,
    state: createSyncStateStore({ storage: phoneStorage, accountId: ACCOUNT_ID }),
  });
  return { dek, service, phoneStorage, phone, tablet: tabletDevice({ service, dek }) };
}

/** A second sign-in on the same device: a fresh state store over the storage the erase just touched. */
function signInAgain({ service, dek, storage }: { service: Service; dek: Uint8Array; storage: KeyValueStorage }) {
  return phoneDevice({ service, dek, state: createSyncStateStore({ storage, accountId: ACCOUNT_ID }) });
}

// ---------------------------------------------------------------------------

test('a fast started on the phone reaches the tablet after one cycle each', async () => {
  const { service, phone, tablet } = twoDevices();

  // THE REAL WRITE VERB, the one `/fasting` calls when somebody taps start.
  const started = await createLocalFast({
    protocolId: '16:8',
    targetDurationMs: 16 * HOUR,
    plannedStartAt: null,
    startedAt: T,
  });

  assert.equal(await phone.cycle(), true, 'starting a fast must be a reason to push, by itself');
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id),
    [started.id],
    'and the fast has to be ON the account, not merely in a version number',
  );

  await tablet.cycle();

  assert.deepEqual(tablet.fastIds(), [started.id], 'the other device must end up holding it');
  assert.equal(tablet.fasts()[0]?.startedAt, T, 'with the instant the person actually started it');
});

test('a fast started on the tablet reaches the phone store, through the real apply', async () => {
  // THE DIRECTION THAT WRITES INDEXEDDB, which is the half a merge alone
  // cannot prove: `applyMergedSnapshot` has to put the row in the store, or
  // the person sees a synced tick and an empty history.
  const { service, phone, tablet } = twoDevices();

  tablet.hold([fast('from-the-tablet')]);
  assert.equal(await tablet.cycle(), true);

  await phone.cycle();

  assert.deepEqual(await phone.fastIds(), ['from-the-tablet'], 'the fast must be readable out of the device store');
  assert.equal((await phone.fasts())[0]?.targetDurationMs, 16 * HOUR, 'with its target intact');
  assert.deepEqual(await service.tombstonesOnTheAccount(), [], 'and nothing was buried on the way');
});

test('ending a fast on the tablet reaches the phone, and the end is the one that was declared', async () => {
  const { phone, tablet } = twoDevices();

  const started = await createLocalFast({
    protocolId: '16:8',
    targetDurationMs: 16 * HOUR,
    plannedStartAt: null,
    startedAt: T,
  });
  await phone.cycle();
  await tablet.cycle();
  assert.deepEqual(tablet.fastIds(), [started.id], 'precondition: both devices hold the running fast');

  const endedAt = T + 17 * HOUR;
  const running = tablet.fasts()[0];
  assert.ok(running !== undefined);
  tablet.hold([{ ...running, endedAt, mood: 'good' }]);
  assert.equal(await tablet.cycle(), true, 'ending a fast must push');

  await phone.cycle();

  const onThePhone = (await phone.fasts())[0];
  assert.equal(onThePhone?.endedAt, endedAt, 'the end recorded over there must land here');
  assert.equal(onThePhone?.mood, 'good', 'and so must the reflection written with it');
});

test('deleting a fast on the phone removes it from the tablet', async () => {
  const { service, phone, tablet } = twoDevices();

  const kept = await createLocalFast({
    protocolId: '16:8',
    targetDurationMs: 16 * HOUR,
    plannedStartAt: null,
    startedAt: T - 48 * HOUR,
  });
  await endLocalFast(kept.id, { endedAt: T - 32 * HOUR });
  await putLocalFast(fast('the-one-deleted', { startedAt: T - 24 * HOUR, endedAt: T - 8 * HOUR }));
  await phone.cycle();
  await tablet.cycle();
  assert.deepEqual(tablet.fastIds(), [kept.id, 'the-one-deleted'].toSorted(), 'precondition: the tablet holds both');

  // THE REAL DELETE VERB, which removes the row and journals the removal in
  // one transaction. The journal row is what authorises the tombstone.
  await deleteLocalFast('the-one-deleted');
  assert.equal(await phone.cycle(), true, 'a deletion must push on its own');
  assert.deepEqual(
    await service.tombstonesOnTheAccount(),
    ['fast:the-one-deleted'],
    'and it travels as a tombstone, which is what makes it reach another device',
  );

  await tablet.cycle();

  assert.deepEqual(tablet.fastIds(), [kept.id], 'the deletion must land on the other device');
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id),
    [kept.id],
    'and the account must not be holding it either',
  );
});

test('deleting a fast on the tablet removes it from the phone store', async () => {
  // The other direction, and the one that exercises `removeEntitiesWithoutJournal`'s
  // new `fastIds`: a peer's tombstone has to take the row out of IndexedDB,
  // and the removal must NOT enter this device's own delete journal.
  const { phone, tablet } = twoDevices();

  await putLocalFast(fast('deleted-over-there', { endedAt: T + 16 * HOUR }));
  await phone.cycle();
  await tablet.cycle();
  assert.deepEqual(tablet.fastIds(), ['deleted-over-there']);

  tablet.record('deleted-over-there');
  assert.equal(await tablet.cycle(), true);

  await phone.cycle();

  assert.deepEqual(await phone.fastIds(), [], 'the row the peer buried has to leave this store');
  assert.deepEqual(
    await listDeletedEntityKeys(),
    [],
    'and applying a peer delete must never write this device a journal row it could claim later',
  );
});


// ---------------------------------------------------------------------------
// An erase takes the baseline with the rows, so the account puts them back
// ---------------------------------------------------------------------------

test('an erase plus a fresh sign-in restores the fasts from the account, it never publishes an empty list', async () => {
  const { service, dek, phoneStorage, phone } = twoDevices();

  await putLocalFast(fast('one', { startedAt: T - 48 * HOUR, endedAt: T - 32 * HOUR }));
  await putLocalFast(fast('two', { startedAt: T - 24 * HOUR, endedAt: T - 8 * HOUR }));
  await phone.cycle();
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['one', 'two'],
    'precondition: the account holds both fasts',
  );
  // NON-VACUITY: the baseline really names them, so the cycle after the erase
  // has something it COULD tombstone. Without this the claim below passes
  // against a device that never synced.
  assert.deepEqual(
    Object.keys(phone.state.load().baseline.perEntity)
      .filter((key) => key.startsWith('fast:'))
      .toSorted(),
    ['fast:one', 'fast:two'],
  );

  // THE ERASE, through the real verb. `deleteDatabase` is a no-op here because
  // the store singleton is already open in this process and cannot be dropped;
  // the rows are removed and the journal emptied instead, which is the state a
  // deleted database leaves behind. What the real function does that matters
  // is the FIRST line of it: the baseline key goes.
  await eraseDeviceData({ accountId: ACCOUNT_ID }, { storage: phoneStorage, deleteDatabase: async () => undefined });
  await quietPhone();

  const afterSignIn = signInAgain({ service, dek, storage: phoneStorage });
  assert.deepEqual(afterSignIn.state.load().baseline.perEntity, {}, 'the erase must have taken the baseline too');

  await afterSignIn.cycle();

  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['one', 'two'],
    'an erased device must never publish its emptiness over the account',
  );
  assert.deepEqual(await afterSignIn.fastIds(), ['one', 'two'], 'and the fasts must come back onto the device');
});

test('THE CONTROL: a RECORDED deletion of the same two fasts does empty the account', async () => {
  // Without this, the case above passes against a merge that can never publish
  // a shorter list, which would make every deleted fast come back on the next
  // sync, on every device, forever. The only difference is the evidence: the
  // delete verb wrote both removals down, and the baseline survived.
  const { service, phone } = twoDevices();

  await putLocalFast(fast('one', { startedAt: T - 48 * HOUR, endedAt: T - 32 * HOUR }));
  await putLocalFast(fast('two', { startedAt: T - 24 * HOUR, endedAt: T - 8 * HOUR }));
  await phone.cycle();

  await deleteLocalFast('one');
  await deleteLocalFast('two');
  await phone.cycle();

  assert.deepEqual(await service.fastsOnTheAccount(), [], 'a deletion the person performed must reach the account');
  assert.deepEqual(await service.tombstonesOnTheAccount(), ['fast:one', 'fast:two']);
});

// ---------------------------------------------------------------------------
// Two open fasts: both survive, and the person resolves it
// ---------------------------------------------------------------------------

/**
 * The offline double start: the phone began a fast at T, the tablet began a
 * different one three hours later, and neither device knew about the other.
 * Both are open, both are truthful, and M240/01 keeps both.
 */
async function offlineDoubleStart() {
  const devices = twoDevices();
  const onThePhone = await createLocalFast({
    protocolId: '16:8',
    targetDurationMs: 16 * HOUR,
    plannedStartAt: null,
    startedAt: T,
  });
  devices.tablet.hold([fast('tablet-fast', { startedAt: T + 3 * HOUR })]);
  return { ...devices, phoneFastId: onThePhone.id };
}

test('two devices each holding an open fast end up with BOTH, when the phone syncs first', async () => {
  const { service, phone, tablet, phoneFastId } = await offlineDoubleStart();

  await phone.cycle();
  await tablet.cycle();
  await phone.cycle();

  const both = [phoneFastId, 'tablet-fast'].toSorted();
  assert.deepEqual(await phone.fastIds(), both, 'a merge must not decide for the person which fast was real');
  assert.deepEqual(tablet.fastIds(), both, 'and both devices must hold the same two rows');
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id).toSorted(),
    both,
    'and so must the account',
  );
  assert.deepEqual(await service.tombstonesOnTheAccount(), [], 'with neither of them buried');
});

test('they reach the SAME two rows when the tablet syncs first, which is the convergence claim', async () => {
  const { service, phone, tablet, phoneFastId } = await offlineDoubleStart();

  await tablet.cycle();
  await phone.cycle();
  await tablet.cycle();

  const both = [phoneFastId, 'tablet-fast'].toSorted();
  assert.deepEqual(await phone.fastIds(), both);
  assert.deepEqual(tablet.fastIds(), both, 'the merge order must not change the answer');
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id).toSorted(),
    both,
  );
  assert.deepEqual(await service.tombstonesOnTheAccount(), []);
});

test('both devices pick the SAME current fast, the latest-started one, and neither end is invented', async () => {
  // THE SCREEN IS WHERE THIS IS ANSWERED, not the merge. `selectCurrentFast`
  // is a pure function of the list, and after the merge both devices hold the
  // same list, so both show the same fast as current with no rule anywhere.
  const { phone, tablet, phoneFastId } = await offlineDoubleStart();

  await phone.cycle();
  await tablet.cycle();
  await phone.cycle();

  assert.equal(selectCurrentFast(await phone.fasts())?.id, 'tablet-fast', 'the latest start is the running one');
  assert.equal(selectCurrentFast(tablet.fasts())?.id, 'tablet-fast', 'and the two devices must not disagree');
  assert.deepEqual(
    selectFastHistory(await phone.fasts()).map((entry) => entry.id),
    [phoneFastId],
    'the other one stays visible in history, so the person can remove it',
  );
  assert.deepEqual(
    (await phone.fasts()).map((entry) => entry.endedAt),
    [null, null],
    'and neither was given an end instant nobody declared',
  );
});

test('a Remove on one device reaches the other, which is how the person resolves it', async () => {
  const { service, phone, tablet, phoneFastId } = await offlineDoubleStart();

  await phone.cycle();
  await tablet.cycle();
  await phone.cycle();
  assert.equal((await phone.fastIds()).length, 2, 'precondition: the phone holds both open fasts');

  // THE REMOVE ACTION on the leftover history row, which is `deleteLocalFast`.
  await deleteLocalFast(phoneFastId);
  assert.equal(await phone.cycle(), true, 'a Remove must push on its own');
  await tablet.cycle();

  assert.deepEqual(tablet.fastIds(), ['tablet-fast'], 'the Remove must reach the other device');
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id),
    ['tablet-fast'],
    'and the account must not be holding it either',
  );
  assert.deepEqual(await service.tombstonesOnTheAccount(), [`fast:${phoneFastId}`]);
});

test('the pair goes QUIET once they agree: four more cycles write no blob version', async () => {
  // An unstable merge is a worse defect than the one it replaces. A device
  // that writes a blob version on every cycle burns the five-version
  // retention window and turns opening the app into a write.
  const { service, phone, tablet } = await offlineDoubleStart();

  await phone.cycle();
  await tablet.cycle();
  await phone.cycle();
  const settled = service.version();

  assert.equal(await phone.cycle(), false, 'the phone has nothing left to say');
  assert.equal(await tablet.cycle(), false, 'nor has the tablet');
  assert.equal(await phone.cycle(), false);
  assert.equal(await tablet.cycle(), false);
  assert.equal(service.version(), settled, 'four idle cycles must write no blob version');
});

// ---------------------------------------------------------------------------
// The previous release: a payload with no fast stamps deletes nothing
// ---------------------------------------------------------------------------

test('a payload written by 0.35.1 never deletes this device fasts', async () => {
  // WHAT 0.35.1 PUBLISHED, read off its own `mergeSnapshots`: `meta.perEntity`
  // was built inside the loop over MERGED candidates, and a fast was not one,
  // so an old device STRIPS every `fast:*` stamp; and `fasts` came from
  // `decidePassThrough`, so the list it sends is its own, which on a device
  // that never started a fast is empty.
  //
  // Read naively, that blob says "the account has no fasts and never stamped
  // one". A device whose baseline names two of them must not read it as a
  // deletion, and ADR-0013's rule is what stops it: only this device's own
  // delete journal can turn an absence into a tombstone.
  const { service, phone } = twoDevices();

  await putLocalFast(fast('one', { startedAt: T - 48 * HOUR, endedAt: T - 32 * HOUR }));
  await putLocalFast(fast('two', { startedAt: T - 24 * HOUR, endedAt: T - 8 * HOUR }));
  await phone.cycle();
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['one', 'two'],
    'precondition: the account holds both, stamped',
  );

  await service.seed({ snapshot: emptySnapshot(), meta: { perEntity: {}, tombstones: [] } });

  await phone.cycle();

  assert.deepEqual(await phone.fastIds(), ['one', 'two'], 'an old device stripping the stamps must lose nobody a fast');
  assert.deepEqual(
    (await service.fastsOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['one', 'two'],
    'and this device puts them straight back on the account',
  );
  assert.deepEqual(await service.tombstonesOnTheAccount(), [], 'with nothing marked deleted on the way');
});

test('a 0.35.1 payload that DOES carry a fast is adopted, at the stamp a stampless row gets', async () => {
  // The other direction. An old device passed its own fasts through, so a blob
  // it wrote can hold a fast with no stamp beside it. Stamp 0 loses to anything
  // that ever carried a real stamp, and still beats nothing at all, which is
  // what lets a person upgrade one device and keep the other's history.
  const { service, phone } = twoDevices();

  await service.seed({
    snapshot: { ...emptySnapshot(), fasts: [fast('written-by-0-35-1', { endedAt: T + 16 * HOUR })] },
    meta: { perEntity: {}, tombstones: [] },
  });

  await phone.cycle();

  assert.deepEqual(await phone.fastIds(), ['written-by-0-35-1'], 'a fast an old build left on the account must arrive');
  assert.equal(
    phone.state.load().baseline.perEntity[entityKey(SYNC_ENTITY_TYPES.fast, 'written-by-0-35-1')]?.lamport,
    0,
    'stamped 0, so the first real edit anywhere outranks it',
  );
});

test('the baseline a fast leaves behind is a stamped entity, not a pass-through id list', async () => {
  // The migration, from the device's side. A state written by 0.35.1 carried
  // `passThrough.fasts`; this build records the fasts in `perEntity` with a
  // stamp and a content hash, and records no fast ids in `passThrough` at all.
  const { phone } = twoDevices();

  await putLocalFast(fast('one', { endedAt: T + 16 * HOUR }));
  await phone.cycle();

  const baseline = phone.state.load().baseline;
  assert.ok(baseline.perEntity[entityKey(SYNC_ENTITY_TYPES.fast, 'one')] !== undefined);
  assert.deepEqual(baseline.passThrough?.savedMeals, [], 'the fasts id list went with the pass-through stance');
});
