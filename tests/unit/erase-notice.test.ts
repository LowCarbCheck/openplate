/**
 * Unit tests for `#app/lib/sync/erase-notice`: what the sign-out dialog says
 * about an erase, and the count it says it from.
 *
 * ── The defect these exist for ───────────────────────────────────────────
 *
 * The dialog used to count the retired log outbox, which nothing had written
 * since M117/03, so it told every person that everything had reached the
 * server, directly above the box that erases the diary. The count now comes
 * from the sync engine's own stamping, the live diary against the baseline
 * this device last agreed with the account, and these tests pin both halves:
 * the count ({@link countUnsentChanges}) and the sentences
 * ({@link resolveEraseNotice}).
 *
 * EVERY BASELINE HERE IS THE ENGINE'S. `agreedBaseline` stamps a snapshot and
 * rebuilds the baseline from the stamped payload, which is exactly what
 * `orchestrator.ts`'s `commitState` stores after a push. A hand-typed baseline
 * would test the count against a record the engine never writes.
 *
 * THE FIRST CASE OF EACH BLOCK IS ITS CONTROL: a device that matches its
 * baseline counts zero, and a read with nothing in it gets the all-clear. Every
 * later case differs from its control by one fact, so a count that ignored
 * that fact fails there.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HEALTHY_STORAGE } from '../sync-integrity-fixtures';
import {
  countUnsentChanges,
  holdsUncheckedRows,
  resolveEraseNotice,
  type UnsentOnDevice,
} from '../../app/lib/sync/erase-notice';
import { baselineFromPayload, stampSnapshot, type SyncBaseline } from '../../app/lib/sync/snapshot-sync';
import { partitionSnapshot, type SealedPrivateStore } from '../../app/lib/sync/snapshot-partition';
import { emptySyncState } from '../../app/lib/sync/sync-state';
import type { LocalSnapshotRead } from '../../app/lib/sync/local-store-bridge';
import { DELETE_JOURNAL_TAG_BY_TABLE, entityKey, FOOD_LOGS_TABLE } from '../../app/lib/local-store/schema';
import type {
  LocalFast,
  LocalFoodLog,
  LocalPantryItem,
  LocalSavedMeal,
  LocalSharePeer,
  LocalStoreSnapshot,
} from '../../app/lib/local-store';

const DEVICE_ID = 'phone-under-test';

function foodLog(id: string, name = 'Lentil soup'): LocalFoodLog {
  return {
    id,
    name,
    quantityGrams: 300,
    macros: { carbs: 18, fiber: 6, sugars: 2, polyols: 0, protein: 12, fat: 4, kcal: 220 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-18',
    loggedAt: 1_789_000_000_000,
    createdAt: 1_789_000_000_000,
    logBatchId: null,
  };
}

function fast(id: string): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 57_600_000,
    plannedStartAt: null,
    startedAt: 1_789_000_000_000,
    endedAt: 1_789_000_000_000 + 57_600_000,
    createdAt: 1_789_000_000_000,
  };
}

function savedMeal(id: string): LocalSavedMeal {
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
    createdAt: 1_789_000_000_000,
  };
}

function pantryItem(id: string): LocalPantryItem {
  return {
    id,
    name: 'Spinach',
    amount: null,
    unit: null,
    category: 'produce',
    source: 'manual',
    createdAt: 1_789_000_000_000,
    updatedAt: 1_789_000_000_000,
  };
}

function sharePeer(id: string): LocalSharePeer {
  return { id, accountId: Number(id), publicKeyRaw: 'AAAA', label: 'Dr. Meier', createdAt: 1_789_000_000_000 };
}

/** A device snapshot, both regions, holding only what the case names. */
function deviceSnapshot(overrides: Partial<LocalStoreSnapshot> = {}): LocalStoreSnapshot {
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    fastingSettings: null,
    savedMeals: [],
    pantryItems: [],
    activityMarks: [],
    awards: [],
    shareIdentity: null,
    sharePeers: [],
    researchIdentity: null,
    studyEnrolments: [],
    ...overrides,
  };
}

/** A read of a healthy device: its database is there and every table loaded. */
function readOf(snapshot: LocalStoreSnapshot, deletedEntityKeys: readonly string[] = []): LocalSnapshotRead {
  return {
    snapshot,
    integrity: { hasPersistedDatabase: true, isTableLoaded: {} },
    deletedEntityKeys: new Set(deletedEntityKeys),
  };
}

/** The journal key the delete verbs write for one food log. */
function deletedLogKey(id: string): string {
  return entityKey(DELETE_JOURNAL_TAG_BY_TABLE[FOOD_LOGS_TABLE], id);
}

/**
 * The baseline a cycle commits after pushing `snapshot` from an empty start:
 * stamp it, then rebuild the baseline from the stamped payload, which is
 * `commitState`'s `baselineFromPayload(merged)`.
 *
 * @param compartment - the sealed compartment the pushed payload carried, if any.
 */
function agreedBaseline(snapshot: LocalStoreSnapshot, compartment: SealedPrivateStore | null = null): SyncBaseline {
  const synced = { ...partitionSnapshot(snapshot).shareable, privateStore: compartment };
  const stamped = stampSnapshot({
    snapshot: synced,
    baseline: emptySyncState().baseline,
    deviceId: DEVICE_ID,
    integrity: HEALTHY_STORAGE,
  });
  return baselineFromPayload({ snapshot: synced, meta: stamped.meta });
}

const NOTHING_UNSENT: UnsentOnDevice = { changes: 0, reports: 0, hasUncheckedRows: false };

describe('resolveEraseNotice', () => {
  it('gives the all-clear when nothing was counted, and only then', () => {
    assert.deepEqual(
      resolveEraseNotice({ read: { status: 'done', unsent: NOTHING_UNSENT }, isSyncing: false, hasSession: true }),
      [{ kind: 'all-sent' }],
    );
  });

  it('names the unsent changes and gives no all-clear beside them', () => {
    const lines = resolveEraseNotice({
      read: { status: 'done', unsent: { ...NOTHING_UNSENT, changes: 3 } },
      isSyncing: false,
      hasSession: true,
    });
    assert.deepEqual(lines, [{ kind: 'unsent-changes', count: 3 }]);
  });

  it('names a queued report even when the diary itself is all sent', () => {
    const lines = resolveEraseNotice({
      read: { status: 'done', unsent: { ...NOTHING_UNSENT, reports: 1 } },
      isSyncing: false,
      hasSession: true,
    });
    assert.deepEqual(lines, [{ kind: 'unsent-reports', count: 1 }]);
  });

  it('names both counts, changes first, when both are waiting', () => {
    const lines = resolveEraseNotice({
      read: { status: 'done', unsent: { changes: 2, reports: 4, hasUncheckedRows: false } },
      isSyncing: false,
      hasSession: true,
    });
    assert.deepEqual(lines, [
      { kind: 'unsent-changes', count: 2 },
      { kind: 'unsent-reports', count: 4 },
    ]);
  });

  it('says what the check does not cover, under the all-clear and under a count alike', () => {
    const unchecked = { ...NOTHING_UNSENT, hasUncheckedRows: true };
    assert.deepEqual(
      resolveEraseNotice({ read: { status: 'done', unsent: unchecked }, isSyncing: false, hasSession: true }),
      [{ kind: 'all-sent' }, { kind: 'not-covered' }],
    );
    assert.deepEqual(
      resolveEraseNotice({
        read: { status: 'done', unsent: { ...unchecked, changes: 1 } },
        isSyncing: false,
        hasSession: true,
      }),
      [{ kind: 'unsent-changes', count: 1 }, { kind: 'not-covered' }],
    );
  });

  it('says it is checking while the read is out, rather than claiming anything', () => {
    assert.deepEqual(resolveEraseNotice({ read: { status: 'pending' }, isSyncing: false, hasSession: true }), [
      { kind: 'checking' },
    ]);
  });

  it('waits out a running sync instead of vouching for a baseline that is about to move', () => {
    // The same read the first case gave the all-clear for.
    assert.deepEqual(
      resolveEraseNotice({ read: { status: 'done', unsent: NOTHING_UNSENT }, isSyncing: true, hasSession: true }),
      [{ kind: 'checking' }],
    );
  });

  it('says it could not check when the read failed, and never that everything was sent', () => {
    assert.deepEqual(resolveEraseNotice({ read: { status: 'failed' }, isSyncing: false, hasSession: true }), [
      { kind: 'unchecked' },
    ]);
  });

  it('says it could not check when nobody is signed in, whatever an earlier read said', () => {
    assert.deepEqual(
      resolveEraseNotice({ read: { status: 'done', unsent: NOTHING_UNSENT }, isSyncing: false, hasSession: false }),
      [{ kind: 'unchecked' }],
    );
  });
});

describe('countUnsentChanges', () => {
  const synced = deviceSnapshot({ foodLogs: [foodLog('a'), foodLog('b')] });
  const baseline = agreedBaseline(synced);

  it('counts nothing on a device that matches the baseline it last agreed', () => {
    assert.equal(countUnsentChanges({ read: readOf(synced), baseline }), 0);
  });

  it('counts a row logged after the last sync', () => {
    const now = deviceSnapshot({ foodLogs: [foodLog('a'), foodLog('b'), foodLog('c')] });
    assert.equal(countUnsentChanges({ read: readOf(now), baseline }), 1);
  });

  it('counts a row edited after the last sync', () => {
    const now = deviceSnapshot({ foodLogs: [foodLog('a', 'Lentil soup, large'), foodLog('b')] });
    assert.equal(countUnsentChanges({ read: readOf(now), baseline }), 1);
  });

  it('counts a delete the journal wrote down', () => {
    const now = deviceSnapshot({ foodLogs: [foodLog('a')] });
    assert.equal(countUnsentChanges({ read: readOf(now, [deletedLogKey('b')]), baseline }), 1);
  });

  it('does not count a row that is merely missing, which is an eviction and not a change', () => {
    // The same snapshot as the case above, without the journal row.
    const now = deviceSnapshot({ foodLogs: [foodLog('a')] });
    assert.equal(countUnsentChanges({ read: readOf(now), baseline }), 0);
  });

  it('counts a journalled delete from a table the device only half read, which the push would withhold', () => {
    const now = deviceSnapshot({ foodLogs: [foodLog('a')] });
    const halfRead: LocalSnapshotRead = {
      ...readOf(now, [deletedLogKey('b')]),
      integrity: { hasPersistedDatabase: true, isTableLoaded: { [FOOD_LOGS_TABLE]: false } },
    };
    assert.equal(countUnsentChanges({ read: halfRead, baseline }), 1);
  });

  it('does not count a row created and deleted between two syncs, which the account never saw', () => {
    assert.equal(countUnsentChanges({ read: readOf(synced, [deletedLogKey('never-synced')]), baseline }), 0);
  });

  it('counts every row on a device that has never finished a cycle', () => {
    const now = deviceSnapshot({ foodLogs: [foodLog('a'), foodLog('b'), foodLog('c')] });
    assert.equal(countUnsentChanges({ read: readOf(now), baseline: emptySyncState().baseline }), 3);
  });

  it('counts a row brought back over its own tombstone', () => {
    const afterDelete = deviceSnapshot({ foodLogs: [foodLog('a')] });
    const stamped = stampSnapshot({
      snapshot: { ...partitionSnapshot(afterDelete).shareable, privateStore: null },
      baseline,
      deviceId: DEVICE_ID,
      integrity: { ...HEALTHY_STORAGE, deletedEntityKeys: new Set([deletedLogKey('b')]) },
    });
    const withTombstone = stamped.baseline;
    assert.equal(withTombstone.tombstones.length, 1, 'fixture: the delete of b is in the baseline');

    assert.equal(countUnsentChanges({ read: readOf(afterDelete), baseline: withTombstone }), 0, 'control');
    assert.equal(countUnsentChanges({ read: readOf(synced), baseline: withTombstone }), 1);
  });

  it('does not read the compartment it cannot open as a delete', () => {
    const compartment: SealedPrivateStore = { ciphertext: 'c', cdkWrapPassphrase: 'p', cdkWrapRecovery: 'r' };
    const withCompartment = agreedBaseline(synced, compartment);
    assert.ok(
      Object.keys(withCompartment.perEntity).some((key) => key.startsWith('privateStore:')),
      'fixture',
    );

    assert.equal(countUnsentChanges({ read: readOf(synced), baseline: withCompartment }), 0);
  });
});

describe('holdsUncheckedRows', () => {
  it('is false for a diary the check can compare in full', () => {
    assert.equal(holdsUncheckedRows(deviceSnapshot({ foodLogs: [foodLog('a')] })), false);
  });

  it('is true for each kind of row the check cannot compare', () => {
    assert.equal(holdsUncheckedRows(deviceSnapshot({ fasts: [fast('f')] })), true, 'a fast');
    assert.equal(holdsUncheckedRows(deviceSnapshot({ savedMeals: [savedMeal('m')] })), true, 'a saved meal');
    assert.equal(holdsUncheckedRows(deviceSnapshot({ pantryItems: [pantryItem('p')] })), true, 'a pantry item');
    assert.equal(holdsUncheckedRows(deviceSnapshot({ sharePeers: [sharePeer('12')] })), true, 'a pinned peer');
  });
});
