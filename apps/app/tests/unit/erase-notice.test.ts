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
  holdsOwnerPrivateRows,
  holdsUnsentSavedMeals,
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

const NOTHING_UNSENT: UnsentOnDevice = {
  changes: 0,
  reports: 0,
  hasUnsentSavedMeals: false,
  hasOwnerPrivateRows: false,
};

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
      read: { status: 'done', unsent: { ...NOTHING_UNSENT, changes: 2, reports: 4 } },
      isSyncing: false,
      hasSession: true,
    });
    assert.deepEqual(lines, [
      { kind: 'unsent-changes', count: 2 },
      { kind: 'unsent-reports', count: 4 },
    ]);
  });

  it('names UNSENT SAVED MEALS on their own line, under the all-clear and under a count alike', () => {
    const unsentMeals = { ...NOTHING_UNSENT, hasUnsentSavedMeals: true };
    assert.deepEqual(
      resolveEraseNotice({ read: { status: 'done', unsent: unsentMeals }, isSyncing: false, hasSession: true }),
      [{ kind: 'all-sent' }, { kind: 'saved-meals-unsent' }],
    );
    assert.deepEqual(
      resolveEraseNotice({
        read: { status: 'done', unsent: { ...unsentMeals, changes: 1 } },
        isSyncing: false,
        hasSession: true,
      }),
      [{ kind: 'unsent-changes', count: 1 }, { kind: 'saved-meals-unsent' }],
    );
  });

  it('names the SEALED KEYS on a line of their own, which is a different claim', () => {
    // THE SPLIT (M240/03). One blanket sentence used to cover saved meals and
    // the keys together, so a person with an ordinary sharing key pair and no
    // unsent meals was told their meals might be lost. Two lines, two claims,
    // each shown only when it is true.
    assert.deepEqual(
      resolveEraseNotice({
        read: { status: 'done', unsent: { ...NOTHING_UNSENT, hasOwnerPrivateRows: true } },
        isSyncing: false,
        hasSession: true,
      }),
      [{ kind: 'all-sent' }, { kind: 'keys-not-covered' }],
    );
  });

  it('names both, meals first, when both are true', () => {
    assert.deepEqual(
      resolveEraseNotice({
        read: {
          status: 'done',
          unsent: { ...NOTHING_UNSENT, hasUnsentSavedMeals: true, hasOwnerPrivateRows: true },
        },
        isSyncing: false,
        hasSession: true,
      }),
      [{ kind: 'all-sent' }, { kind: 'saved-meals-unsent' }, { kind: 'keys-not-covered' }],
    );
  });

  it('THE CONTROL: neither line is drawn when there is nothing to say', () => {
    // Without this, every case above passes against a resolver that pushes both
    // lines unconditionally, which is the defect the split exists to fix.
    assert.deepEqual(
      resolveEraseNotice({ read: { status: 'done', unsent: NOTHING_UNSENT }, isSyncing: false, hasSession: true }),
      [{ kind: 'all-sent' }],
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

  it('COUNTS A FAST AND A PANTRY ROW, which it could not see before they were merged', () => {
    // M240/01 and M240/02 made both merged entities, so `stampSnapshot` inside
    // this count stamps them like a food log. Before that neither could be
    // compared at all, and the dialog said so in a blanket sentence instead.
    const diaryOnly = deviceSnapshot({ foodLogs: [foodLog('a')] });
    const withBoth = deviceSnapshot({
      foodLogs: [foodLog('a')],
      fasts: [fast('f')],
      pantryItems: [pantryItem('p')],
    });

    assert.equal(
      countUnsentChanges({ read: readOf(withBoth), baseline: agreedBaseline(diaryOnly) }),
      2,
      'a fast and a pantry row the account has not seen are two unsent changes',
    );
    // THE CONTROL: the same two rows, already on the account, count nothing.
    assert.equal(countUnsentChanges({ read: readOf(withBoth), baseline: agreedBaseline(withBoth) }), 0);
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

/**
 * A baseline that agreed with exactly these saved meals: their ids AND the
 * hash of their content, which is what `baselineFromPayload` commits.
 */
function baselineAgreeing(savedMeals: LocalSavedMeal[]): SyncBaseline {
  return baselineFromPayload({
    snapshot: { ...partitionSnapshot(deviceSnapshot({ savedMeals })).shareable, privateStore: null },
    meta: { perEntity: {}, tombstones: [] },
  });
}

/** A baseline that recorded these ids and NO content hash, which is every pre-M240 state. */
function baselineRecordingIdsOnly(savedMeals: string[]): SyncBaseline {
  return { perEntity: {}, tombstones: [], passThrough: { savedMeals } };
}

describe('holdsUnsentSavedMeals', () => {
  it('is false when the id set already matches the baseline', () => {
    // THE WHOLE POINT OF THE CHANGE (M240/03). The sentence this feeds used to
    // fire on the mere PRESENCE of a saved meal, so a person whose meals were
    // all on the account was warned about them on every sign-out, for ever.
    const meals = [savedMeal('m'), savedMeal('n')];
    assert.equal(
      holdsUnsentSavedMeals({ snapshot: deviceSnapshot({ savedMeals: meals }), baseline: baselineAgreeing(meals) }),
      false,
    );
  });

  it('is true for a meal added since the baseline', () => {
    assert.equal(
      holdsUnsentSavedMeals({
        snapshot: deviceSnapshot({ savedMeals: [savedMeal('m'), savedMeal('n')] }),
        baseline: baselineAgreeing([savedMeal('m')]),
      }),
      true,
    );
  });

  it('is true for a meal REMOVED since the baseline, which the account has not heard either', () => {
    assert.equal(
      holdsUnsentSavedMeals({
        snapshot: deviceSnapshot({ savedMeals: [savedMeal('m')] }),
        baseline: baselineAgreeing([savedMeal('m'), savedMeal('n')]),
      }),
      true,
    );
  });

  it('is true for a meal edited without changing its id, which an id set cannot see', () => {
    // M240 counsel item 4, and the reason ADR-0016's first answer was
    // reversed. A rename moves no id, so the check said "all sent" over a box
    // that erases the diary. `canonicalize` would push it on the next cycle,
    // and signing out on a train is exactly when there is no next cycle.
    const stored = savedMeal('m');
    assert.equal(
      holdsUnsentSavedMeals({
        snapshot: deviceSnapshot({ savedMeals: [{ ...stored, name: 'Sunday brunch' }] }),
        baseline: baselineAgreeing([stored]),
      }),
      true,
    );
  });

  it('THE CONTROL: the same meals in a different ORDER are not an edit', () => {
    // Without this, the case above passes against a hash taken over the list
    // as the store happened to return it, which would warn on every sign-out
    // and teach people to click through the warning.
    const meals = [savedMeal('m'), savedMeal('n')];
    assert.equal(
      holdsUnsentSavedMeals({
        snapshot: deviceSnapshot({ savedMeals: meals.toReversed() }),
        baseline: baselineAgreeing(meals),
      }),
      false,
    );
  });

  it('WARNS when the baseline recorded ids but no content hash, which is every state written before M240', () => {
    // The migration, and the direction it has to fail in: a device that cannot
    // vouch for its meals warns about them rather than reassuring somebody
    // over an erase.
    assert.equal(
      holdsUnsentSavedMeals({
        snapshot: deviceSnapshot({ savedMeals: [savedMeal('m')] }),
        baseline: baselineRecordingIdsOnly(['m']),
      }),
      true,
    );
    // And a device with no meals has nothing to warn about either way.
    assert.equal(
      holdsUnsentSavedMeals({ snapshot: deviceSnapshot({}), baseline: baselineRecordingIdsOnly([]) }),
      false,
    );
  });

  it('treats a baseline that recorded NOTHING as vouching for nothing', () => {
    // A baseline from before the ids were kept, or from a device that has never
    // finished a cycle. An absent record is not an empty one, which is the same
    // rule `decidePassThrough` follows.
    assert.equal(
      holdsUnsentSavedMeals({
        snapshot: deviceSnapshot({ savedMeals: [savedMeal('m')] }),
        baseline: emptySyncState().baseline,
      }),
      true,
    );
    // And a device with no meals has nothing to lose either way.
    assert.equal(
      holdsUnsentSavedMeals({ snapshot: deviceSnapshot({}), baseline: emptySyncState().baseline }),
      false,
    );
  });

  it('ignores a fast and a pantry row, which the COUNT now covers', () => {
    // THE INVERSION (M240/01, M240/02). Both were "cannot compare" rows until
    // they became merged entities; `countUnsentChanges` stamps them now, so
    // naming them here would warn twice about one change.
    assert.equal(
      holdsUnsentSavedMeals({
        snapshot: deviceSnapshot({ fasts: [fast('f')], pantryItems: [pantryItem('p')] }),
        baseline: baselineAgreeing([]),
      }),
      false,
    );
  });
});

describe('holdsOwnerPrivateRows', () => {
  it('is true for a pinned peer, and false for a diary with none', () => {
    assert.equal(holdsOwnerPrivateRows(deviceSnapshot({ sharePeers: [sharePeer('12')] })), true, 'a pinned peer');
    assert.equal(holdsOwnerPrivateRows(deviceSnapshot({ foodLogs: [foodLog('a')] })), false, 'an ordinary diary');
  });

  it('ignores every shared row, however many there are', () => {
    // The control that keeps the line above a claim about the COMPARTMENT: a
    // device full of diary, fasts, meals and pantry rows and no key material
    // must draw no key line at all.
    assert.equal(
      holdsOwnerPrivateRows(
        deviceSnapshot({
          foodLogs: [foodLog('a')],
          fasts: [fast('f')],
          savedMeals: [savedMeal('m')],
          pantryItems: [pantryItem('p')],
        }),
      ),
      false,
    );
  });
});
