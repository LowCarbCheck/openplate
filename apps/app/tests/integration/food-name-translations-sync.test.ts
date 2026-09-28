/**
 * A FOOD'S NAMES TRAVEL TO THE PERSON'S OTHER DEVICE (M251/03).
 *
 * `nameTranslations` is one optional field on four entities: the food log, the
 * personal food, the saved-meal item and the pantry row. Sync carries entities
 * field by field through the backup schemas, and zod strips a key it does not
 * know, so a field the schemas forgot passes every unit test and arrives on
 * the second device as nothing (M240 found fields that did not travel).
 *
 * ── What is real here ────────────────────────────────────────────────────
 *
 * THE PHONE IS THE DEVICE'S OWN STORE, written through the verbs the app
 * calls, on a real TinyBase store over a (fake-backed) IndexedDB, synced by
 * `runSyncCycleUnlocked` over `readLocalSnapshot` and `applyMergedSnapshot`.
 *
 * THE PULLED BLOB IS PARSED BY THE PRODUCTION PARSER on both devices,
 * `parseRemoteSnapshot`, which runs the backup chain. The pantry test beside
 * this one casts the payload instead, which is right for its subject and
 * would see nothing here: the cast is exactly the seam that could drop the
 * field. A test that substitutes its subject sees nothing.
 *
 * THE TABLET is a second device through the same orchestrator, holding a
 * plain object, because the store singleton is per process.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import type { PulledBlob, PushBlobHttpResult, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import { partitionSnapshot, recomposeSnapshot, type ShareableSnapshot, type SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import {
  applyMergedSnapshot,
  forgetPublishedDeletes,
  parseRemoteSnapshot,
  readLocalOwnerPrivateRegion,
  readLocalSnapshot,
} from '../../app/lib/sync/local-store-bridge';
import {
  deleteLocalFood,
  deleteLocalFoodLog,
  deleteLocalSavedMeal,
  forgetDeletedEntityKeys,
  listDeletedEntityKeys,
  listLocalFoodLogs,
  listLocalFoods,
  listLocalSavedMeals,
  putLocalFood,
  putLocalFoodLog,
  putLocalSavedMeal,
  replaceLocalPantry,
  listLocalPantryItems,
  SCHEMA_VERSION,
  type LocalFoodLog,
  type LocalPersonalFood,
} from '../../app/lib/local-store';
import { savedMealItemFromLog } from '../../app/lib/local-store/saved-meals';
import { displayFoodName } from '../../app/lib/food-name';

const ACCOUNT_ID = 251;
const NOW = Date.parse('2026-09-23T08:00:00Z');
const NAMES = { en: 'Apple', de: 'Apfel', fr: 'Pomme', it: 'Mela', es: 'Manzana', tr: 'Elma' };

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

/** Lets the store's autosave reach the disk, so a cycle's integrity read describes the device the case built. */
async function settleAutosave(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Every case starts on a phone that holds nothing and has written nothing down. */
async function quietPhone(): Promise<void> {
  for (const log of await listLocalFoodLogs()) await deleteLocalFoodLog(log.id);
  for (const food of await listLocalFoods()) await deleteLocalFood(food.id);
  for (const meal of await listLocalSavedMeals()) await deleteLocalSavedMeal(meal.id);
  await replaceLocalPantry([]);
  await forgetDeletedEntityKeys(await listDeletedEntityKeys());
  await settleAutosave();
}

beforeEach(quietPhone);
after(quietPhone);

function translatedLog(id: string, overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id,
    name: 'Apfel',
    nameTranslations: NAMES,
    quantityGrams: 150,
    macros: { carbs: 20, fiber: 3, sugars: 15, polyols: null, protein: 0.5, fat: 0.2, kcal: 80 },
    mealType: 'snack',
    source: 'plate_ai',
    aiEstimated: true,
    curatedSource: null,
    foodId: 'food-1',
    dayKey: '2026-09-23',
    loggedAt: NOW,
    createdAt: NOW,
    logBatchId: null,
    ...overrides,
  };
}

function translatedFood(): LocalPersonalFood {
  return {
    id: 'food-1',
    name: 'Apfel',
    nameTranslations: NAMES,
    brand: null,
    macrosPer100g: { carbs: 13, fiber: 2, sugars: 10, polyols: null, protein: 0.3, fat: 0.1, kcal: 52 },
    source: 'plate_ai',
    createdAt: NOW,
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

/** The account: compare-and-swap on a version, never a decrypt. */
function fakeService(dek: Uint8Array) {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  const client: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      if (stored === null) return null;
      return { blobVersion: stored.version, envelopeVersion: 1, ciphertext: stored.ciphertext, createdAt: '2026-09-23T09:00:00.000Z' };
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
    /** What the account holds, decrypted and parsed by the PRODUCTION parser. */
    async parsedAccount(): Promise<SyncedSnapshot> {
      assert.ok(stored !== null, 'the account must be holding a blob');
      const payload = await parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      return parseRemoteSnapshot({ snapshot: payload.snapshot, schemaVersion: SCHEMA_VERSION });
    },
  };
}

type Service = ReturnType<typeof fakeService>;

function phoneDevice({ service, dek }: { service: Service; dek: Uint8Array }) {
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });
  return {
    async cycle(): Promise<boolean> {
      await settleAutosave();
      const result = await runSyncCycleUnlocked({
        accountId: ACCOUNT_ID,
        dek,
        http: service.client,
        state,
        deviceId: 'device-phone',
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
        // THE PRODUCTION PARSER, never a cast: it is the seam under test.
        parseRemoteSnapshot,
      });
      return result.pushed;
    },
  };
}

function tabletDevice({ service, dek }: { service: Service; dek: Uint8Array }) {
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });
  let held: SyncedSnapshot = emptySnapshot();
  return {
    hold(next: Partial<SyncedSnapshot>): void {
      held = { ...held, ...next };
    },
    held(): SyncedSnapshot {
      return held;
    },
    async cycle(): Promise<boolean> {
      const result = await runSyncCycleUnlocked({
        accountId: ACCOUNT_ID,
        dek,
        http: service.client,
        state,
        deviceId: 'device-tablet',
        readSnapshot: async () => ({
          snapshot: held,
          integrity: {
            hasPersistedDatabase: true,
            isTableLoaded: {},
            isCompartmentKnown: true,
            isCompartmentHeld: false,
            isCompartmentUnpublished: false,
            deletedEntityKeys: new Set<string>(),
          },
        }),
        applySnapshot: async ({ merged }) => {
          held = { ...merged, privateStore: null };
        },
        assertPulledSnapshot: async () => {},
        forgetPublishedDeletes: async () => {},
        parseRemoteSnapshot,
      });
      return result.pushed;
    },
  };
}

function twoDevices() {
  const dek = generateDek();
  const service = fakeService(dek);
  return { service, phone: phoneDevice({ service, dek }), tablet: tabletDevice({ service, dek }) };
}

test('a food logged with its names on the phone reaches the tablet with every name, on all four entities', async () => {
  const { service, phone, tablet } = twoDevices();

  // THE REAL WRITE VERBS, the ones the review, "save as meal" and `/pantry` call.
  const log = translatedLog('log-1');
  await putLocalFood(translatedFood());
  await putLocalFoodLog(log);
  await putLocalSavedMeal({ id: 'meal-1', name: 'Snack', items: [savedMealItemFromLog(log)], createdAt: NOW });
  await replaceLocalPantry([
    {
      id: 'pantry-1',
      name: 'Eier',
      nameTranslations: { de: 'Eier', en: 'Eggs', fr: 'Œufs' },
      amount: 6,
      unit: 'piece',
      category: 'dairy',
      source: 'photo',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);

  assert.equal(await phone.cycle(), true, 'the phone must push');
  const account = await service.parsedAccount();
  assert.deepEqual(account.foodLogs[0]?.nameTranslations, NAMES, 'the account must hold the log’s names');

  await tablet.cycle();

  const held = tablet.held();
  assert.deepEqual(held.foodLogs.find((entry) => entry.id === 'log-1')?.nameTranslations, NAMES);
  assert.deepEqual(held.foods.find((entry) => entry.id === 'food-1')?.nameTranslations, NAMES);
  assert.deepEqual(held.savedMeals[0]?.items[0]?.nameTranslations, NAMES);
  assert.deepEqual(held.pantryItems[0]?.nameTranslations, { de: 'Eier', en: 'Eggs', fr: 'Œufs' });
  const arrived = held.foodLogs[0];
  assert.ok(arrived);
  assert.equal(displayFoodName(arrived, 'fr'), 'Pomme', 'and the second device reads it in French');
});

test('a food logged on the tablet lands in the phone store with its names, through the real apply', async () => {
  // THE DIRECTION THAT WRITES INDEXEDDB, which a merge alone cannot prove.
  const { phone, tablet } = twoDevices();

  tablet.hold({ foodLogs: [translatedLog('log-2', { foodId: null })] });
  assert.equal(await tablet.cycle(), true);

  await phone.cycle();

  const stored = (await listLocalFoodLogs()).find((entry) => entry.id === 'log-2');
  assert.ok(stored, 'the row must be readable out of the device store');
  assert.deepEqual(stored.nameTranslations, NAMES);
  assert.equal(displayFoodName(stored, 'tr'), 'Elma');
});

test('control: a row saved before M251 travels with no names and reads as its own name everywhere', async () => {
  const { phone, tablet } = twoDevices();
  const { nameTranslations: _dropped, ...legacy } = translatedLog('log-3', { foodId: null });
  await putLocalFoodLog(legacy);

  await phone.cycle();
  await tablet.cycle();

  const arrived = tablet.held().foodLogs.find((entry) => entry.id === 'log-3');
  assert.ok(arrived);
  assert.equal(arrived.nameTranslations, undefined);
  assert.equal(displayFoodName(arrived, 'fr'), 'Apfel');
  assert.equal((await listLocalPantryItems()).length, 0);
});
