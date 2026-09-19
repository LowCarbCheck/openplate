/**
 * A SAVED MEAL REACHES THE ACCOUNT BY ITSELF, AND THEN THE DEVICE GOES QUIET.
 *
 * Two claims, and the second one is the dangerous half.
 *
 * Saved meals are published by `mergeSnapshots` but were invisible to
 * `payloadsEqual`, so a person who only created, renamed or deleted one sent
 * nothing at all: the cycle compared two payloads that canonicalized the same,
 * called itself clean, and waited for an unrelated food log to push the blob
 * and carry the meal along. Erase or lose that phone first and the meal was
 * never anywhere else.
 *
 * The fix is a push trigger, and a push trigger that is not STABLE is a worse
 * defect than the one it replaces: a device that writes a new blob version on
 * every boot burns the 5-version retention window and turns opening the app
 * into a write. So every change below is followed by TWO idle cycles, and the
 * blob version is read off the service after each one. The unit file
 * `tests/unit/sync-saved-meals-push.test.ts` makes the same claims against
 * `payloadsEqual` directly; this one makes them against the real
 * `runSyncCycleUnlocked`, a real envelope, and a store that CASes on
 * `blobVersion`, which is the only place the JSON round trip is real. A
 * comparison that survives two hand-built objects and not a serialized blob
 * would pass there and push forever here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import type { LocalFoodLog, LocalSavedMeal } from '../../app/lib/local-store';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import type { PushBlobHttpResult, PulledBlob, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { HEALTHY_STORAGE } from '../sync-integrity-fixtures';

const ACCOUNT_ID = 42;
const T = Date.parse('2026-09-18T09:00:00Z');

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
    dayKey: '2026-09-18',
    loggedAt: T,
    createdAt: T,
    logBatchId: null,
  };
}

/**
 * A saved meal with OPTIONAL FIELDS LEFT OFF, which is what the store hands
 * back for a meal built out of plain manual rows.
 *
 * Deliberate: `portion`, `attribution`, `netCarbsPer100g`, `carbBasis` and
 * `micronutrientsPer100g` are all `?:` on `LocalSavedMealItem`, so the local
 * read carries absent keys while the pulled copy has been through
 * `JSON.stringify`, which drops them again. If those two ever stopped
 * comparing equal, the idle cycles below would push.
 */
function savedMeal(id: string, overrides: Partial<LocalSavedMeal> = {}): LocalSavedMeal {
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
    createdAt: T,
    ...overrides,
  };
}

function snapshotOf(savedMeals: LocalSavedMeal[]): SyncedSnapshot {
  return {
    foods: [],
    foodLogs: [foodLog('log-1', 'Lentil soup')],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals,
    pantryItems: [],
    activityMarks: [],
    awards: [],
    fastingSettings: null,
    privateStore: null,
  };
}

/**
 * Just enough service to test the loop: compare-and-swap on `blobVersion`, and
 * nothing else.
 *
 * It takes no key and never decrypts, which is the real service's position
 * too. Everything below is asserted from the OUTSIDE of the envelope: a blob
 * version that moved, or a second device that pulled the blob and opened it
 * with the key it already holds.
 */
function fakeService() {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  const client: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      if (stored === null) return null;
      return {
        blobVersion: stored.version,
        envelopeVersion: 1,
        ciphertext: stored.ciphertext,
        createdAt: '2026-09-18T10:00:00.000Z',
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
  };
}

/**
 * ONE DEVICE, driven through as many cycles as a test asks for.
 *
 * The device's saved meals are a mutable field rather than a closure argument
 * because that is what a store is: the cycles below change it between calls,
 * exactly as a person tapping "save as meal" would, and every cycle re-reads
 * it.
 */
function device({ service, dek }: { service: ReturnType<typeof fakeService>; dek: Uint8Array }) {
  const state = createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID });
  let savedMeals: LocalSavedMeal[] = [];
  const journal = new Set<string>();
  return {
    hold(next: LocalSavedMeal[]): void {
      savedMeals = next;
    },
    /** What `deleteLocalSavedMeal` writes in the delete verb's own transaction. */
    record(key: string): void {
      journal.add(key);
    },
    journalSize(): number {
      return journal.size;
    },
    async cycle(): Promise<boolean> {
      const result = await runSyncCycleUnlocked({
        accountId: ACCOUNT_ID,
        dek,
        http: service.client,
        state,
        deviceId: 'device-phone',
        readSnapshot: async () => ({
          snapshot: snapshotOf(savedMeals),
          integrity: { ...HEALTHY_STORAGE, deletedEntityKeys: new Set(journal) },
        }),
        applySnapshot: async ({ merged }) => {
          savedMeals = merged.savedMeals;
        },
        assertPulledSnapshot: async () => {},
        forgetPublishedDeletes: async (keys) => {
          for (const key of keys) journal.delete(key);
        },
        // SAFETY: the only payload this cycle can pull back is one this file wrote.
        parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
      });
      return result.pushed;
    },
  };
}

// ---------------------------------------------------------------------------

test('a CREATED saved meal pushes once, and the two cycles after it push nothing', async () => {
  const dek = generateDek();
  const service = fakeService();
  const phone = device({ service, dek });

  // THE ACCOUNT ALREADY HOLDS THE DIARY, so the food log is not what pushes
  // below. Without this, the first cycle would push because the blob is
  // missing entirely, and the test would prove nothing about saved meals.
  await phone.cycle();
  assert.equal(service.version(), 1, 'the seed cycle wrote the blob');
  assert.equal(await phone.cycle(), false, 'and a device with nothing new sends nothing');
  assert.equal(service.version(), 1);

  phone.hold([savedMeal('sunday-breakfast')]);

  assert.equal(await phone.cycle(), true, 'a new saved meal must reach the account on its own');
  assert.equal(service.version(), 2);

  // THE TRAP. An unstable trigger pushes here, and on every cycle after it,
  // forever.
  assert.equal(await phone.cycle(), false, 'the cycle after the push must send nothing');
  assert.equal(await phone.cycle(), false, 'and so must the one after that');
  assert.equal(service.version(), 2, 'two idle cycles wrote no blob version');
});

test('a RENAMED saved meal pushes once, and the device goes quiet again', async () => {
  const dek = generateDek();
  const service = fakeService();
  const phone = device({ service, dek });

  phone.hold([savedMeal('sunday-breakfast')]);
  await phone.cycle();
  await phone.cycle();
  assert.equal(service.version(), 1, 'the device and the account agree before the rename');

  phone.hold([savedMeal('sunday-breakfast', { name: 'Sunday brunch' })]);

  assert.equal(await phone.cycle(), true, 'a rename must reach the account');
  assert.equal(service.version(), 2);
  assert.equal(await phone.cycle(), false);
  assert.equal(await phone.cycle(), false);
  assert.equal(service.version(), 2, 'two idle cycles after a rename wrote no blob version');
});

test('a DELETED saved meal pushes once, spends its journal row, and the device goes quiet', async () => {
  const dek = generateDek();
  const service = fakeService();
  const phone = device({ service, dek });

  phone.hold([savedMeal('sunday-breakfast')]);
  await phone.cycle();
  await phone.cycle();
  assert.equal(service.version(), 1);

  // THE DELETE VERB'S TWO HALVES: the row leaves the list, and the removal is
  // written down. Without the journal row `decidePassThrough` refuses the
  // shorter list and hands the meal back, which is the eviction guard doing
  // its job and is asserted in `sync-saved-meals-passthrough.test.ts`.
  phone.hold([]);
  phone.record('savedMeal:sunday-breakfast');

  assert.equal(await phone.cycle(), true, 'a deletion must reach the account');
  assert.equal(service.version(), 2);
  assert.equal(phone.journalSize(), 0, 'the published removal spends its journal row');

  assert.equal(await phone.cycle(), false);
  assert.equal(await phone.cycle(), false);
  assert.equal(service.version(), 2, 'two idle cycles after a deletion wrote no blob version');
});

test('the saved meal survives the round trip, it is on the account and not just in a version number', async () => {
  // NON-VACUITY for all three tests above. A cycle can push for any number of
  // reasons; this one proves the blob the push wrote actually holds the meal,
  // by starting a SECOND device whose store is empty and letting the merge
  // hand it the account's list.
  const dek = generateDek();
  const service = fakeService();
  const phone = device({ service, dek });

  phone.hold([savedMeal('sunday-breakfast', { name: 'Sunday brunch' })]);
  await phone.cycle();

  // The second device's baseline is empty, which `decidePassThrough` reads as
  // accounting for nothing, so the account's list stands.
  const tablet = device({ service, dek });
  await tablet.cycle();

  const onTheTablet = await new Promise<LocalSavedMeal[]>((resolve) => {
    void runSyncCycleUnlocked({
      accountId: ACCOUNT_ID,
      dek,
      http: service.client,
      state: createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID }),
      deviceId: 'device-tablet',
      readSnapshot: async () => ({ snapshot: snapshotOf([]), integrity: HEALTHY_STORAGE }),
      applySnapshot: async ({ merged }) => resolve(merged.savedMeals),
      assertPulledSnapshot: async () => {},
      forgetPublishedDeletes: async () => {},
      // SAFETY: the only payload this cycle can pull back is one this file wrote.
      parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
    });
  });

  assert.deepEqual(
    onTheTablet.map((entry) => entry.name),
    ['Sunday brunch'],
    'the meal the phone pushed must be readable off the account',
  );
});
