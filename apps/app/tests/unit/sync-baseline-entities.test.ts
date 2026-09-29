/**
 * `hasSyncBaselineEntities`: the onboarding gate's evidence that a device
 * synced a diary for this account before (M224), and what does NOT count as
 * that evidence (M265/03).
 *
 * THE DEFECT. Every account's first sync writes the owner-private compartment
 * into the baseline, `privateStore:me` at lamport 1, whether or not the
 * account has a diary. A buyer who chose a plan on the pricing page pays
 * before the questionnaire, the app syncs on the order page, and the gate then
 * read "a baseline and no profile" as a lost diary and sent them to the
 * recovery screen. The first baseline below is the one the browser tier
 * recorded on that buyer's device.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStorage, hasSyncBaselineEntities, syncBaselineStorageKey } from '../../app/lib/sync/sync-state';
import { PRIVATE_STORE_ENTITY_KEY, PROFILE_ENTITY_ID, SYNC_ENTITY_TYPES } from '../../app/lib/sync/snapshot-sync';

const ACCOUNT_ID = 2;

/** One stamped entity, the shape `perEntity` holds per key. */
const STAMP = { lamport: 1, deviceId: 'f1f29282-d199-4f82-bafb-d27957d90861', hash: 'b79e8c3ae373e4d6' };

/** A stored baseline naming exactly these entity keys, in the persisted format. */
function storageWithBaseline(keys: readonly string[]) {
  const perEntity = Object.fromEntries(keys.map((key) => [key, STAMP]));
  return createMemoryStorage({
    [syncBaselineStorageKey(ACCOUNT_ID)]: JSON.stringify({
      formatVersion: 1,
      lastBlobVersion: 1,
      lastSyncedAt: 1_790_673_399_551,
      baseline: { perEntity, tombstones: [], passThrough: { savedMeals: [], savedMealsHash: '741638a59ba5e8c2' } },
    }),
  });
}

describe('hasSyncBaselineEntities', () => {
  it('does not count the owner-private compartment alone, which every account writes on its first sync', () => {
    assert.equal(PRIVATE_STORE_ENTITY_KEY, 'privateStore:me', 'the key the browser tier recorded');
    const storage = storageWithBaseline([PRIVATE_STORE_ENTITY_KEY]);
    assert.equal(hasSyncBaselineEntities({ accountId: ACCOUNT_ID, storage }), false);
  });

  // THE CONTROL, through the same storage: a diary entity beside the
  // compartment is the evidence M224 was written for, and still counts.
  it('counts a baseline that names a diary entity, the evicted device M224 protects', () => {
    const profileKey = `${SYNC_ENTITY_TYPES.profile}:${PROFILE_ENTITY_ID}`;
    const storage = storageWithBaseline([PRIVATE_STORE_ENTITY_KEY, profileKey]);
    assert.equal(hasSyncBaselineEntities({ accountId: ACCOUNT_ID, storage }), true);
    assert.equal(hasSyncBaselineEntities({ accountId: ACCOUNT_ID, storage: storageWithBaseline([profileKey]) }), true);
  });

  it('is false with no stored baseline, and for another account', () => {
    assert.equal(hasSyncBaselineEntities({ accountId: ACCOUNT_ID, storage: createMemoryStorage() }), false);
    const storage = storageWithBaseline([`${SYNC_ENTITY_TYPES.profile}:${PROFILE_ENTITY_ID}`]);
    assert.equal(hasSyncBaselineEntities({ accountId: ACCOUNT_ID + 1, storage }), false);
  });
});
