/**
 * What the NEXT sign-in sees after an erase (M201 spec 02).
 *
 * ── The failure this file exists to make impossible ──────────────────────
 *
 * The diary is IndexedDB and the sync baseline is a localStorage key. Erasing
 * the first without the second leaves a device that believes it is up to date,
 * and the belief is acted on twice over:
 *
 *  1. it asks the server for nothing, so the diary stays empty, and
 *  2. worse, `stampSnapshot` reads "every entity I knew is gone from the live
 *     snapshot" and emits a TOMBSTONE for each one. The next push then deletes
 *     the account's diary on the server, from the copy that no longer has it.
 *
 * Neither shows an error. So this drives the real `eraseDeviceData` over the
 * real `SyncStateStore` and the real stamping and merging engine, and asserts
 * the recovery rather than the field: after an erase, a pull brings the rows
 * back, and no tombstone is manufactured on the way.
 *
 * The defect is asserted too, in the same shapes, so the test would fail if
 * `eraseDeviceData` ever stopped taking the baseline with the rows: without
 * that half these fixtures produce the deletion described above.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { eraseDeviceData, type DeviceEraseDeps } from '../../app/lib/local-store/device-erase';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import {
  baselineFromPayload,
  mergeSnapshots,
  stampSnapshot,
  type StampedSnapshot,
} from '../../app/lib/sync/snapshot-sync';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import type { LocalStoreSnapshot } from '../../app/lib/local-store';

const ACCOUNT_ID = 7;
const DEVICE_ID = 'device-under-test';

function foodLog(id: string): LocalStoreSnapshot['foodLogs'][number] {
  return {
    id,
    name: 'Lentil soup',
    quantityGrams: 300,
    macros: { carbs: 18, fiber: 6, sugars: 2, polyols: 0, protein: 12, fat: 4, kcal: 220 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-01',
    loggedAt: 1_780_000_000_000,
    createdAt: 1_780_000_000_000,
    logBatchId: null,
  };
}

function snapshotOf(logs: LocalStoreSnapshot['foodLogs']): SyncedSnapshot {
  return {
    foods: [],
    foodLogs: logs,
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    fastingSettings: null,
    privateStore: null,
  };
}

/** The account's diary as the server holds it: one logged meal, stamped by this device. */
function serverPayload(): StampedSnapshot {
  const snapshot = snapshotOf([foodLog('log-1')]);
  const { meta } = stampSnapshot({ snapshot, baseline: { perEntity: {}, tombstones: [] }, deviceId: DEVICE_ID });
  return { snapshot, meta };
}

/** A device that has synced that diary: rows locally, and a baseline saying so. */
function syncedDevice() {
  const storage = createMemoryStorage();
  const state = createSyncStateStore({ storage, accountId: ACCOUNT_ID });
  const remote = serverPayload();
  state.save({
    formatVersion: 1,
    lastBlobVersion: 4,
    lastSyncedAt: 1_780_000_000_000,
    baseline: baselineFromPayload(remote),
  });
  // The databases are a no-op here: what this file is about is the localStorage
  // half, and the IndexedDB half has its own unit test.
  const eraseDeps: DeviceEraseDeps = { storage, deleteDatabase: async () => undefined };
  return { storage, eraseDeps };
}

describe('signing in after erase re-downloads the diary', () => {
  it('re-download: a pulled diary is adopted, because the erase took the baseline too', async () => {
    const { storage, eraseDeps } = syncedDevice();

    await eraseDeviceData({ accountId: ACCOUNT_ID }, eraseDeps);

    // What the next sign-in loads for this account.
    const state = createSyncStateStore({ storage, accountId: ACCOUNT_ID }).load();
    assert.equal(state.lastBlobVersion, 0, 'the device must ask for the blob rather than assume it has it');
    assert.deepEqual(state.baseline, { perEntity: {}, tombstones: [] });

    // The erased device stamps its empty diary against that empty baseline,
    // then merges the pulled one.
    const local = stampSnapshot({ snapshot: snapshotOf([]), baseline: state.baseline, deviceId: DEVICE_ID });
    assert.deepEqual(local.meta.tombstones, [], 'an erased device must not claim anything was deleted');

    const merged = mergeSnapshots({
      local: { snapshot: snapshotOf([]), meta: local.meta },
      remote: serverPayload(),
    });
    assert.equal(merged.snapshot.foodLogs.length, 1, 'the diary comes back');
    assert.equal(merged.snapshot.foodLogs[0]?.id, 'log-1');
    assert.deepEqual(merged.meta.tombstones, [], 'and nothing is marked deleted on the way');
  });

  it('after erase there is no stale marker left to make an empty diary look correct', async () => {
    // The counter-case, built from the same fixtures: a baseline that survived
    // the rows turns the very next stamp into a delete instruction. This is
    // what the single-step erase prevents, and it is asserted so the prevention
    // has something to be measured against.
    const { storage, eraseDeps } = syncedDevice();
    const staleBaseline = createSyncStateStore({ storage, accountId: ACCOUNT_ID }).load().baseline;

    const wouldHappen = stampSnapshot({ snapshot: snapshotOf([]), baseline: staleBaseline, deviceId: DEVICE_ID });
    assert.equal(wouldHappen.meta.tombstones.length, 1, 'a kept baseline turns an erased diary into a deletion');

    await eraseDeviceData({ accountId: ACCOUNT_ID }, eraseDeps);
    const after = createSyncStateStore({ storage, accountId: ACCOUNT_ID }).load().baseline;
    assert.deepEqual(after.perEntity, {}, 'and the erase removed exactly that');
  });
});
