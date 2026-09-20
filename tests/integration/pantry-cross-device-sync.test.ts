/**
 * THE PANTRY TRAVELS BETWEEN A PERSON'S DEVICES (M240/02, ADR-0015).
 *
 * Until this milestone it did not, and that was a decision: M233/02 argued a
 * working list of what is in one fridge is stale within days and belongs to
 * the device that photographed the shelf. `mergeSnapshots` passed the local
 * list through with no guard at all, `canonicalize` never looked at it, and
 * the pantry wrote no delete-journal rows. The owner reversed it. A shopping
 * list that is only on the phone you left at home is not a shopping list, and
 * somebody who photographs a fridge on a tablet cooks from a phone.
 *
 * ── What is real here ────────────────────────────────────────────────────
 *
 * THE PHONE IS THE DEVICE'S OWN STORE, written through `replaceLocalPantry`,
 * the verb `/pantry` calls, onto a real TinyBase store on a real (fake-backed)
 * IndexedDB, with a real delete journal. It syncs through
 * `runSyncCycleUnlocked` over `readLocalSnapshot` and `applyMergedSnapshot`,
 * which is the production wiring minus the compartment.
 *
 * THE TABLET IS A SECOND DEVICE, through the same orchestrator, the same
 * stamping, the same merge and the same encrypted envelope, with a plain
 * object where the phone has IndexedDB. The store singleton is per PROCESS, so
 * two IndexedDB-backed devices cannot exist in one test run.
 *
 * THE SERVICE compare-and-swaps on `blobVersion` and never decrypts. Every
 * assertion about the account reads the decrypted blob.
 *
 * ── The cost the reversal accepts ────────────────────────────────────────
 *
 * A delete journal for a list that turns over every week. `replaceLocalPantry`
 * reconciles a WHOLE list in one transaction and journals every row it drops,
 * which is what lets a shortened shelf reach the account at all: without it an
 * evicted store and a person who emptied their fridge are the same act, and
 * ADR-0013 correctly refuses both.
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
import {
  forgetDeletedEntityKeys,
  listDeletedEntityKeys,
  listLocalPantryItems,
  replaceLocalPantry,
  SCHEMA_VERSION,
  type LocalPantryItem,
} from '../../app/lib/local-store';

const ACCOUNT_ID = 241;
const PHONE = 'device-phone';
const TABLET = 'device-tablet';
const NOW = Date.parse('2026-09-20T06:00:00Z');

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

/**
 * Lets the store's autosave reach the disk, so the next cycle's integrity read
 * describes the device the case just built.
 *
 * NOT DECORATION. `isTombstoneTrusted` asks the disk-versus-memory record as
 * its second gate, and between a write and its flush the disk still holds the
 * old rows, so `isTableLoaded.pantryItems` reads false and every tombstone
 * this cycle would mint is withheld. A healthy device settles in
 * milliseconds; a test that races it is asserting the scheduler.
 */
async function settleAutosave(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

/**
 * The store singleton is per PROCESS, so every case starts by putting the
 * phone back to a device that holds no pantry row and has written nothing down.
 *
 * `replaceLocalPantry([])` is the real verb and it JOURNALS every row it drops,
 * which is exactly what a case must not inherit, so the journal is emptied
 * after it.
 */
async function quietPhone(): Promise<void> {
  await replaceLocalPantry([]);
  await forgetDeletedEntityKeys(await listDeletedEntityKeys());
  await settleAutosave();
  assert.deepEqual(await listLocalPantryItems(), [], 'the phone must start each case with an empty shelf');
  assert.deepEqual(await listDeletedEntityKeys(), [], 'and having written nothing down');
}

beforeEach(quietPhone);

after(quietPhone);

function item(id: string, overrides: Partial<LocalPantryItem> = {}): LocalPantryItem {
  return {
    id,
    name: `Item ${id}`,
    amount: null,
    unit: null,
    category: 'other',
    source: 'photo',
    createdAt: NOW,
    updatedAt: NOW,
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
  async function open() {
    assert.ok(stored !== null, 'the account must be holding a blob');
    return parseEnvelope({
      envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
      dek,
      aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
    });
  }
  return {
    // SAFETY: the cycle reaches for `pullBlob` and `pushBlob` and nothing else.
    client: client as SyncHttpClient,
    version(): number {
      return stored?.version ?? 0;
    },
    /** THE SHELF THE ACCOUNT ACTUALLY HOLDS, decrypted, never an in-memory copy of what was sent. */
    async pantryOnTheAccount(): Promise<LocalPantryItem[]> {
      // SAFETY: `SyncPayload.snapshot` is `unknown` on the wire; what this file
      // put there is this build's own `SyncedSnapshot`.
      return ((await open()).snapshot as SyncedSnapshot).pantryItems;
    },
    async tombstonesOnTheAccount(): Promise<string[]> {
      return (await open()).syncMeta.tombstones.map((entry) => entityKey(entry.entityType, entry.entityId)).toSorted();
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
      // THE FLUSH BELONGS HERE, not at one call site: every cycle in this file
      // follows a write through the real store verb.
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
            // SAFETY: `applyMergedSnapshot` reads only the shareable collections.
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
    async pantry(): Promise<LocalPantryItem[]> {
      return (await listLocalPantryItems()).toSorted((a, b) => (a.id < b.id ? -1 : 1));
    },
    async pantryIds(): Promise<string[]> {
      return (await listLocalPantryItems()).map((entry) => entry.id).toSorted();
    },
  };
}

// ---------------------------------------------------------------------------
// The tablet: the same engine over a plain object
// ---------------------------------------------------------------------------

function tabletDevice({ service, dek }: { service: Service; dek: Uint8Array }) {
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });
  let held: LocalPantryItem[] = [];
  const journal = new Set<string>();
  return {
    state,
    hold(next: LocalPantryItem[]): void {
      held = next;
    },
    /** What `replaceLocalPantry` writes when it drops a row: the removal, and the journal key. */
    record(id: string): void {
      journal.add(entityKey(SYNC_ENTITY_TYPES.pantryItem, id));
      held = held.filter((entry) => entry.id !== id);
    },
    pantryIds(): string[] {
      return held.map((entry) => entry.id).toSorted();
    },
    pantry(): LocalPantryItem[] {
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
          snapshot: { ...emptySnapshot(), pantryItems: held },
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
          held = merged.pantryItems;
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

/** A phone and a tablet on one fresh account. `phoneStorage` is where the erase case reaches. */
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

test('a shelf photographed on the phone reaches the tablet after one cycle each', async () => {
  const { service, phone, tablet } = twoDevices();

  // THE REAL WRITE VERB, the one `/pantry` calls when somebody confirms a
  // reading.
  await replaceLocalPantry([item('eggs'), item('butter')]);

  assert.equal(await phone.cycle(), true, 'photographing a shelf must be a reason to push, by itself');
  assert.deepEqual(
    (await service.pantryOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['butter', 'eggs'],
    'and the shelf has to be ON the account, not merely in a version number',
  );

  await tablet.cycle();

  assert.deepEqual(tablet.pantryIds(), ['butter', 'eggs'], 'the other device must end up holding it');
});

test('a row added on the tablet reaches the phone store, through the real apply', async () => {
  // THE DIRECTION THAT WRITES INDEXEDDB, which a merge alone cannot prove.
  const { service, phone, tablet } = twoDevices();

  tablet.hold([item('courgette', { amount: 2, unit: 'piece' })]);
  assert.equal(await tablet.cycle(), true);

  await phone.cycle();

  assert.deepEqual(await phone.pantryIds(), ['courgette'], 'the row must be readable out of the device store');
  assert.equal((await phone.pantry())[0]?.amount, 2, 'with its amount intact');
  assert.deepEqual(await service.tombstonesOnTheAccount(), [], 'and nothing was removed on the way');
});

test('correcting a line on the tablet reaches the phone', async () => {
  const { phone, tablet } = twoDevices();

  await replaceLocalPantry([item('eggs', { amount: 6, unit: 'piece' })]);
  await phone.cycle();
  await tablet.cycle();
  assert.deepEqual(tablet.pantryIds(), ['eggs'], 'precondition: both devices hold the row');

  const stored = tablet.pantry()[0];
  assert.ok(stored !== undefined);
  tablet.hold([{ ...stored, amount: 12, updatedAt: NOW + 60_000 }]);
  assert.equal(await tablet.cycle(), true, 'an edit must push');

  await phone.cycle();

  assert.equal((await phone.pantry())[0]?.amount, 12, 'the correction made over there must land here');
});

test('removing a row on the phone removes it from the tablet', async () => {
  const { service, phone, tablet } = twoDevices();

  await replaceLocalPantry([item('eggs'), item('used-up')]);
  await phone.cycle();
  await tablet.cycle();
  assert.deepEqual(tablet.pantryIds(), ['eggs', 'used-up'], 'precondition: the tablet holds both');

  // THE REAL REMOVAL PATH. `/pantry` never deletes one row at a time: it hands
  // `replaceLocalPantry` the whole list the person left on screen, and the
  // reconcile journals every row it drops.
  await replaceLocalPantry([item('eggs')]);
  assert.equal(await phone.cycle(), true, 'a removal must push on its own');
  assert.deepEqual(
    await service.tombstonesOnTheAccount(),
    ['pantryItem:used-up'],
    'and it travels as a tombstone, which is what makes it reach another device',
  );

  await tablet.cycle();

  assert.deepEqual(tablet.pantryIds(), ['eggs'], 'the removal must land on the other device');
  assert.deepEqual(
    (await service.pantryOnTheAccount()).map((entry) => entry.id),
    ['eggs'],
    'and the account must not be holding it either',
  );
});

test('removing a row on the tablet removes it from the phone store', async () => {
  // The direction that exercises `removeEntitiesWithoutJournal`'s new
  // `pantryItemIds`: a peer's tombstone has to take the row out of IndexedDB,
  // and the removal must NOT enter this device's own delete journal.
  const { phone, tablet } = twoDevices();

  await replaceLocalPantry([item('removed-over-there')]);
  await phone.cycle();
  await tablet.cycle();
  assert.deepEqual(tablet.pantryIds(), ['removed-over-there']);

  tablet.record('removed-over-there');
  assert.equal(await tablet.cycle(), true);

  await phone.cycle();

  assert.deepEqual(await phone.pantryIds(), [], 'the row the peer removed has to leave this store');
  assert.deepEqual(
    await listDeletedEntityKeys(),
    [],
    'and applying a peer removal must never write this device a journal row it could claim later',
  );
});

test('a RECREATED store restores the shelf from the account instead of publishing an empty one', async () => {
  // ADR-0013, for the collection that had no evidence at all before M240/02.
  // The rows are gone and nothing was written down, which is what an eviction
  // plus `persist.ts`'s boot-time prime leaves behind.
  const { service, phone } = twoDevices();

  await replaceLocalPantry([item('eggs'), item('butter')]);
  await phone.cycle();
  assert.deepEqual(
    (await service.pantryOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['butter', 'eggs'],
    'precondition: the account holds the shelf',
  );

  // THE EVICTION: the rows leave and the journal leaves with them, because
  // they are rows in the same database.
  await replaceLocalPantry([]);
  await forgetDeletedEntityKeys(await listDeletedEntityKeys());

  await phone.cycle();

  assert.deepEqual(
    (await service.pantryOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['butter', 'eggs'],
    'a device that cannot prove a removal must not publish one',
  );
  assert.deepEqual(await phone.pantryIds(), ['butter', 'eggs'], 'and the shelf must come back onto the device');
});

test('THE CONTROL: a RECORDED removal of the same two rows does empty the account', async () => {
  // Without this, the case above passes against a merge that can never publish
  // a shorter list, which would make every removed row come back on the next
  // sync, forever. The only difference is the evidence: `replaceLocalPantry`
  // wrote both removals down and the journal was left alone.
  const { service, phone } = twoDevices();

  await replaceLocalPantry([item('eggs'), item('butter')]);
  await phone.cycle();

  await replaceLocalPantry([]);

  await phone.cycle();

  assert.deepEqual(await service.pantryOnTheAccount(), [], 'a removal the person performed must reach the account');
  assert.deepEqual(await service.tombstonesOnTheAccount(), ['pantryItem:butter', 'pantryItem:eggs']);
});

test('an erase plus a fresh sign-in restores the shelf, it never publishes an empty list', async () => {
  const { service, dek, phoneStorage, phone } = twoDevices();

  await replaceLocalPantry([item('eggs'), item('butter')]);
  await phone.cycle();
  // NON-VACUITY: the baseline really names both rows, so the cycle after the
  // erase has something it COULD tombstone.
  assert.deepEqual(
    Object.keys(phone.state.load().baseline.perEntity)
      .filter((key) => key.startsWith('pantryItem:'))
      .toSorted(),
    ['pantryItem:butter', 'pantryItem:eggs'],
  );

  // THE ERASE, through the real verb. `deleteDatabase` is a no-op because the
  // store singleton is already open in this process; the rows are removed and
  // the journal emptied instead, which is what a deleted database leaves
  // behind. What matters is the FIRST line of the real function: the baseline
  // key goes.
  await eraseDeviceData({ accountId: ACCOUNT_ID }, { storage: phoneStorage, deleteDatabase: async () => undefined });
  await quietPhone();

  const afterSignIn = signInAgain({ service, dek, storage: phoneStorage });
  assert.deepEqual(afterSignIn.state.load().baseline.perEntity, {}, 'the erase must have taken the baseline too');

  await afterSignIn.cycle();

  assert.deepEqual(
    (await service.pantryOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['butter', 'eggs'],
    'an erased device must never publish its emptiness over the account',
  );
  assert.deepEqual(await afterSignIn.pantryIds(), ['butter', 'eggs'], 'and the shelf must come back');
});

test('a payload written by 0.35.1 never removes this device pantry rows', async () => {
  // WHAT 0.35.1 PUBLISHED: `meta.perEntity` was built inside the loop over
  // MERGED candidates and a pantry row was not one, so an old device strips
  // every `pantryItem:*` stamp; and `pantryItems` came straight off its own
  // local side, which on a device that never photographed a shelf is empty.
  //
  // Read naively that blob says "the account has no pantry". A device whose
  // baseline names two rows must not read it as a removal, and ADR-0013's rule
  // is what stops it.
  const { service, phone } = twoDevices();

  await replaceLocalPantry([item('eggs'), item('butter')]);
  await phone.cycle();

  await service.seed({ snapshot: emptySnapshot(), meta: { perEntity: {}, tombstones: [] } });

  await phone.cycle();

  assert.deepEqual(await phone.pantryIds(), ['butter', 'eggs'], 'an old device must lose nobody a shelf');
  assert.deepEqual(
    (await service.pantryOnTheAccount()).map((entry) => entry.id).toSorted(),
    ['butter', 'eggs'],
    'and this device puts them straight back on the account',
  );
  assert.deepEqual(await service.tombstonesOnTheAccount(), [], 'with nothing marked removed on the way');
});

test('a 0.35.1 payload that DOES carry a shelf is adopted, at the stamp a stampless row gets', async () => {
  const { service, phone } = twoDevices();

  await service.seed({
    snapshot: { ...emptySnapshot(), pantryItems: [item('written-by-0-35-1')] },
    meta: { perEntity: {}, tombstones: [] },
  });

  await phone.cycle();

  assert.deepEqual(await phone.pantryIds(), ['written-by-0-35-1'], 'a shelf an old build left must arrive');
  assert.equal(
    phone.state.load().baseline.perEntity[entityKey(SYNC_ENTITY_TYPES.pantryItem, 'written-by-0-35-1')]?.lamport,
    0,
    'stamped 0, so the first real edit anywhere outranks it',
  );
});

test('the pair goes QUIET once they agree: four more cycles write no blob version', async () => {
  const { service, phone, tablet } = twoDevices();

  await replaceLocalPantry([item('eggs')]);
  tablet.hold([item('butter')]);
  await phone.cycle();
  await tablet.cycle();
  await phone.cycle();
  await tablet.cycle();
  const settled = service.version();

  assert.equal(await phone.cycle(), false, 'the phone has nothing left to say');
  assert.equal(await tablet.cycle(), false, 'nor has the tablet');
  assert.equal(await phone.cycle(), false);
  assert.equal(await tablet.cycle(), false);
  assert.equal(service.version(), settled, 'four idle cycles must write no blob version');
});
