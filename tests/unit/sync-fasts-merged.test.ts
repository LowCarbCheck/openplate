/**
 * A FAST IS A MERGED SYNC ENTITY (M240/01, ADR-0014).
 *
 * It was a pass-through until this milestone, and this file used to pin that:
 * `mergeSnapshots` handed the local list straight back, `flattenSnapshot`
 * never stamped a fast, and a fast round-tripped through the JSON backup only.
 * The cost was that a fast lived on exactly one device. Erase it, lose it, or
 * open the app on a new tablet, and the fasting history was gone while the
 * routine beside it travelled fine.
 *
 * Every claim below is the reversal of one this file used to make:
 *
 *  - a fast IS in `SYNC_ENTITY_TYPES`, so it is stamped, diffed and tombstoned;
 *  - a remote fast IS adopted, and two devices' fasts both survive;
 *  - a removal DOES travel, through the delete journal and a tombstone;
 *  - a fast starting, ending or being deleted DOES make this device push.
 *
 * THE EVICTION AND JOURNAL CASES ARE KEPT, re-expressed for a merged entity.
 * They used to be answered by `decidePassThrough` reading the baseline's list
 * of ids; they are answered now by `isTombstoneTrusted`, the ordinary
 * ADR-0013 machinery, which asks the same two questions in the same order: did
 * this device write the delete down, and can it speak for the table at all.
 *
 * AND THE ONE THING M240/01 DELIBERATELY DID NOT BUILD: a merge-time answer to
 * "at most one open fast". Two devices that each started one offline keep
 * BOTH, on both devices, and the screen resolves it the way it has resolved a
 * backup restore since M132.
 */
import { EVICTED_STORAGE, HEALTHY_STORAGE, NOTHING_TO_ACCOUNT_FOR, withRecordedDeletes } from '../sync-integrity-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  baselineFromPayload,
  entityKey,
  FASTING_SETTINGS_ENTITY_ID,
  mergeSnapshots,
  payloadsEqual,
  SYNC_ENTITY_TYPES,
  stampSnapshot,
} from '../../app/lib/sync/snapshot-sync';
import type { SnapshotIntegrity, StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import { FASTS_TABLE } from '../../app/lib/local-store/schema';
import type { LocalFast, LocalFastingSettings } from '../../app/lib/local-store/schema';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import { selectCurrentFast, selectFastHistory } from '../../app/models/fasting';

const HOUR = 3_600_000;
const T = Date.parse('2026-08-06T20:00:00Z');

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

function snapshot(fasts: LocalFast[]): SyncedSnapshot {
  // `savedMeals` is the one collection still passed through (see
  // `snapshot-sync.ts`); an empty array is enough, since every assertion in
  // this file is about fasts.
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts,
    savedMeals: [],
    pantryItems: [],
    activityMarks: [],
    awards: [],
    fastingSettings: null,
    privateStore: null,
  };
}

/** A payload with NO stamps at all, the shape a hand-built fixture or a pre-stamping peer produces. */
function payload(fasts: LocalFast[]): StampedSnapshot {
  return { snapshot: snapshot(fasts), meta: { perEntity: {}, tombstones: [] } };
}

/** A payload whose fasts carry explicit stamps, which is what decides a merge. */
function stampedPayload(fasts: LocalFast[], stamp: { lamport: number; deviceId: string }): StampedSnapshot {
  return {
    snapshot: snapshot(fasts),
    meta: {
      perEntity: Object.fromEntries(fasts.map((entry) => [entityKey(SYNC_ENTITY_TYPES.fast, entry.id), stamp])),
      tombstones: [],
    },
  };
}

function fastKey(id: string): string {
  return entityKey(SYNC_ENTITY_TYPES.fast, id);
}

function mergeBoth(a: StampedSnapshot, b: StampedSnapshot) {
  return {
    aFirst: mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: a, remote: b }),
    bFirst: mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: b, remote: a }),
  };
}

// ---------------------------------------------------------------------------
// A fast travels
// ---------------------------------------------------------------------------

describe('mergeSnapshots and fasts', () => {
  it('ADOPTS a fast this device has never seen, which a pass-through never did', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: stampedPayload([fast('on-the-account')], { lamport: 1, deviceId: 'phone' }),
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id),
      ['on-the-account'],
      'a fast the account holds must reach the device that pulled it',
    );
  });

  it('keeps BOTH devices fasts, because two different ids never contend', () => {
    const phone = stampedPayload([fast('phone-fast')], { lamport: 1, deviceId: 'phone' });
    const tablet = stampedPayload([fast('tablet-fast', { startedAt: T - 40 * HOUR, endedAt: T - 24 * HOUR })], {
      lamport: 1,
      deviceId: 'tablet',
    });

    const { aFirst, bFirst } = mergeBoth(phone, tablet);

    assert.deepEqual(aFirst.snapshot.fasts.map((entry) => entry.id).toSorted(), ['phone-fast', 'tablet-fast']);
    // THE CONTROL that keeps the line above honest: a merge that simply
    // preferred one side would pass it and fail this.
    assert.deepEqual(bFirst.snapshot.fasts.map((entry) => entry.id).toSorted(), ['phone-fast', 'tablet-fast']);
  });

  it('takes the HIGHER-stamped copy of one fast, in either direction', () => {
    const running = stampedPayload([fast('shared')], { lamport: 3, deviceId: 'phone' });
    const ended = stampedPayload([fast('shared', { endedAt: T + 17 * HOUR, mood: 'good' })], {
      lamport: 4,
      deviceId: 'tablet',
    });

    const { aFirst, bFirst } = mergeBoth(running, ended);

    assert.equal(aFirst.snapshot.fasts[0]?.endedAt, T + 17 * HOUR, 'the end reached the device that was still running it');
    // THE CONTROL: the lower stamp must lose even when it is the local side.
    assert.equal(bFirst.snapshot.fasts[0]?.endedAt, T + 17 * HOUR, 'and the older copy must not win by being local');
  });

  it('applies a peer TOMBSTONE, so a fast deleted over there leaves this device', () => {
    const local = stampedPayload([fast('deleted-elsewhere')], { lamport: 2, deviceId: 'phone' });
    const remote: StampedSnapshot = {
      snapshot: snapshot([]),
      meta: {
        perEntity: {},
        tombstones: [{ entityId: 'deleted-elsewhere', entityType: SYNC_ENTITY_TYPES.fast, lamport: 3, deviceId: 'tablet' }],
      },
    };

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(merged.snapshot.fasts, [], 'a delete performed on the other device must land here');
    assert.deepEqual(merged.meta.tombstones.map((entry) => entry.entityId), ['deleted-elsewhere']);
  });

  it('THE CONTROL for the tombstone: a LOWER-stamped one loses to the live row', () => {
    // Without this, the case above passes against a merge that lets any
    // tombstone win, which is how a re-added fast keeps vanishing.
    const local = stampedPayload([fast('re-added')], { lamport: 5, deviceId: 'phone' });
    const remote: StampedSnapshot = {
      snapshot: snapshot([]),
      meta: {
        perEntity: {},
        tombstones: [{ entityId: 're-added', entityType: SYNC_ENTITY_TYPES.fast, lamport: 2, deviceId: 'tablet' }],
      },
    };

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(merged.snapshot.fasts.map((entry) => entry.id), ['re-added']);
  });

  it('puts a fast in the synced entity-type catalog, beside the routine', () => {
    assert.deepEqual(Object.values(SYNC_ENTITY_TYPES), [
      'personalFood',
      'foodLog',
      'weightEntry',
      'profile',
      // THE REVERSAL (M240/01): a fast is a merged entity now. It was absent
      // from this list for the whole of M132's life, which is what kept it on
      // one device.
      'fast',
      // AND THE PANTRY (M240/02, ADR-0015), the last pass-through with no
      // guard at all, merged one milestone later for the same reason.
      'pantryItem',
      'fastingSettings',
      'activityMark',
      'award',
      'privateStore',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Stamping: a fast is diffed like every other merged row
// ---------------------------------------------------------------------------

describe('stampSnapshot and fasts', () => {
  it('stamps a fast, and advances the stamp only when the fast changes', () => {
    const first = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });
    assert.equal(first.meta.perEntity[fastKey('mine')]?.lamport, 1, 'a new fast is stamped and therefore pushable');

    const unchanged = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine')]),
      baseline: first.baseline,
      deviceId: 'device-a',
    });
    assert.equal(unchanged.meta.perEntity[fastKey('mine')]?.lamport, 1, 'an idle cycle must not burn a blob version');

    const ended = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine', { endedAt: T + 16 * HOUR })]),
      baseline: unchanged.baseline,
      deviceId: 'device-a',
    });
    assert.equal(ended.meta.perEntity[fastKey('mine')]?.lamport, 2, 'ending a fast is a change the account must hear');
  });

  it('mints a tombstone for a deleted fast, because the delete verb wrote it down', () => {
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    const afterDelete = stampSnapshot({
      // `deleteLocalFast` removes the row and journals `fast:mine` in the same
      // transaction; this fixture is that transaction's other half.
      integrity: withRecordedDeletes(HEALTHY_STORAGE, [fastKey('mine')]),
      snapshot: snapshot([]),
      baseline: synced.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(
      afterDelete.meta.tombstones.map((entry) => `${entry.entityType}:${entry.entityId}`),
      [fastKey('mine')],
      'a deletion has to reach the account, or it comes back on the next pull for ever',
    );
    assert.deepEqual(afterDelete.withheld, []);
  });

  it('WITHHOLDS the tombstone when nothing was written down: an absence is not a deletion', () => {
    // ADR-0013, one entity over. The device no longer holds the fast and never
    // recorded removing it, so the honest reading is "I lost it".
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    const afterLoss = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([]),
      baseline: synced.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(afterLoss.meta.tombstones, [], 'a device that recorded no delete must claim none');
    assert.deepEqual(
      afterLoss.withheld.map((entry) => entry.entityId),
      ['mine'],
      'and the cycle must say so, so the person can be told and the journal row kept',
    );
  });

  it('WITHHOLDS it on an EVICTED device even with the journal key, because the journal died with the diary', () => {
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    const evicted = stampSnapshot({
      integrity: withRecordedDeletes(EVICTED_STORAGE, [fastKey('mine')]),
      snapshot: snapshot([]),
      baseline: synced.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(evicted.meta.tombstones, [], 'a device with no database may not delete anything on the account');
    assert.deepEqual(evicted.withheld.map((entry) => entry.entityId), ['mine']);
  });

  it('WITHHOLDS it when only the fasts TABLE failed to load, however complete the journal is', () => {
    // BOTH SIGNALS, ALWAYS. The database is there, so the whole-database
    // signal says nothing; only the per-table one can tell that this one list
    // was half read, and a journal row beside a half-read table is honest
    // about one fast and silent about the rest.
    const halfRead: SnapshotIntegrity = {
      ...HEALTHY_STORAGE,
      isTableLoaded: { [FASTS_TABLE]: false },
      deletedEntityKeys: new Set([fastKey('mine')]),
    };
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    const afterHalfRead = stampSnapshot({
      integrity: halfRead,
      snapshot: snapshot([]),
      baseline: synced.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(afterHalfRead.meta.tombstones, []);
    assert.deepEqual(afterHalfRead.withheld.map((entry) => entry.entityId), ['mine']);
  });
});

// ---------------------------------------------------------------------------
// A fast makes the device push
// ---------------------------------------------------------------------------

describe('payloadsEqual and fasts', () => {
  it('sees a NEW fast, an ENDED one and a DELETED one, so each pushes on its own', () => {
    const account = stampedPayload([fast('mine')], { lamport: 1, deviceId: 'phone' });

    assert.equal(payloadsEqual(account, stampedPayload([], { lamport: 1, deviceId: 'phone' })), false, 'a fast that is only on one side is a difference');
    assert.equal(
      payloadsEqual(account, stampedPayload([fast('mine', { endedAt: T + 16 * HOUR })], { lamport: 2, deviceId: 'phone' })),
      false,
      'ending a fast must make this device push',
    );
    assert.equal(
      payloadsEqual(account, {
        snapshot: snapshot([]),
        meta: { perEntity: {}, tombstones: [{ entityId: 'mine', entityType: SYNC_ENTITY_TYPES.fast, lamport: 2, deviceId: 'phone' }] },
      }),
      false,
      'deleting a fast must make this device push',
    );
  });

  it('THE CONTROL: two payloads holding the same fasts in a different ORDER are equal', () => {
    // An unstable trigger is a worse defect than the one it replaces: a device
    // that writes a blob version on every boot burns the retention window.
    const one = stampedPayload([fast('a'), fast('b', { id: 'b' })], { lamport: 1, deviceId: 'phone' });
    const other = stampedPayload([fast('b', { id: 'b' }), fast('a')], { lamport: 1, deviceId: 'phone' });

    assert.equal(payloadsEqual(one, other), true, 'the order a list comes back from the store in is not a change');
  });
});

// ---------------------------------------------------------------------------
// The baseline records a fast as a MERGED entity, not as a pass-through id
// ---------------------------------------------------------------------------

describe('baselineFromPayload and fasts', () => {
  it('records every fast in perEntity, and records no pass-through fasts list', () => {
    const baseline = baselineFromPayload(stampedPayload([fast('mine')], { lamport: 4, deviceId: 'tablet' }));

    assert.deepEqual(Object.keys(baseline.perEntity), [fastKey('mine')]);
    assert.equal(baseline.perEntity[fastKey('mine')]?.lamport, 4);
    assert.deepEqual(baseline.passThrough, { savedMeals: [] }, 'the fasts id list went with the pass-through stance');
  });
});

// ---------------------------------------------------------------------------
// TWO OPEN FASTS ARE A STATE THE MERGE MAY PRODUCE, and must
// ---------------------------------------------------------------------------

/**
 * `createLocalFast` refuses a second open fast on ONE device. Two devices
 * offline can each start one, and M240/01 deliberately does NOT adjudicate
 * that in the merge: both survive, on both devices, and the screen answers it
 * the way it has answered a backup restore since M132. `selectCurrentFast`
 * shows the latest-started as current, `selectFastHistory` renders the other
 * as still open with a Remove action, and a Remove is a journalled delete that
 * travels.
 *
 * An earlier draft of M240/01 deleted every open fast but the earliest inside
 * `mergeSnapshots`. It was reversed because it silently dropped a row the
 * person can see, and dropped the one the screen calls current.
 */
describe('mergeSnapshots and two open fasts', () => {
  /** Two devices, each with an open fast it started offline. The phone started FIRST. */
  const phoneOpen = stampedPayload([fast('phone-fast', { startedAt: T })], { lamport: 1, deviceId: 'phone' });
  const tabletOpen = stampedPayload([fast('tablet-fast', { startedAt: T + 3 * HOUR })], {
    lamport: 1,
    deviceId: 'tablet',
  });

  it('keeps BOTH, and buries neither', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: phoneOpen,
      remote: tabletOpen,
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id).toSorted(),
      ['phone-fast', 'tablet-fast'],
      'a merge must not decide for the person which of their two fasts was real',
    );
    assert.deepEqual(merged.meta.tombstones, [], 'and it must bury neither of them');
  });

  it('NEVER INVENTS AN END for either of them, which was M132 objection', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: phoneOpen,
      remote: tabletOpen,
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.endedAt),
      [null, null],
      'a merge must not write a duration nobody declared',
    );
  });

  it('CONVERGES: both merge orders produce a byte-identical payload', () => {
    const { aFirst, bFirst } = mergeBoth(phoneOpen, tabletOpen);

    assert.deepEqual(aFirst.snapshot, bFirst.snapshot);
    assert.deepEqual(aFirst.meta, bFirst.meta);
    assert.equal(payloadsEqual(aFirst, bFirst), true);
  });

  it('IS STABLE: merging the result again changes nothing', () => {
    const once = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: phoneOpen,
      remote: tabletOpen,
    });
    const twice = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: once,
      remote: once,
    });

    assert.deepEqual(twice.snapshot.fasts.map((entry) => entry.id).toSorted(), ['phone-fast', 'tablet-fast']);
    assert.equal(payloadsEqual(once, twice), true);
  });

  it('leaves BOTH devices picking the same current fast, the latest-started one', () => {
    // THE SCREEN IS WHERE THIS IS ANSWERED. Both devices hold the same two
    // rows after the merge, and `selectCurrentFast` is a pure function of the
    // list, so both show the same fast as current with no merge rule at all.
    const { aFirst, bFirst } = mergeBoth(phoneOpen, tabletOpen);

    assert.equal(selectCurrentFast(aFirst.snapshot.fasts)?.id, 'tablet-fast');
    assert.equal(
      selectCurrentFast(bFirst.snapshot.fasts)?.id,
      'tablet-fast',
      'the two devices must not disagree about which fast is running',
    );
    assert.deepEqual(
      selectFastHistory(aFirst.snapshot.fasts).map((entry) => entry.id),
      ['phone-fast'],
      'and the other one stays visible, so the person can remove it',
    );
  });

  it('carries a REMOVE from one device to the other, which is how the person resolves it', () => {
    // The person taps Remove on the phone's leftover row. `deleteLocalFast`
    // journals it, `stampSnapshot` mints the tombstone, and the merge applies
    // it on the other side.
    const both = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: phoneOpen,
      remote: tabletOpen,
    });
    const afterRemove = stampSnapshot({
      integrity: withRecordedDeletes(HEALTHY_STORAGE, [fastKey('phone-fast')]),
      snapshot: snapshot([fast('tablet-fast', { startedAt: T + 3 * HOUR })]),
      baseline: baselineFromPayload(both),
      deviceId: 'phone',
    });

    assert.deepEqual(
      afterRemove.meta.tombstones.map((entry) => `${entry.entityType}:${entry.entityId}`),
      [fastKey('phone-fast')],
      'a Remove the person performed must reach the account',
    );

    const onTheTablet = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: both,
      remote: { snapshot: snapshot([fast('tablet-fast', { startedAt: T + 3 * HOUR })]), meta: afterRemove.meta },
    });

    assert.deepEqual(
      onTheTablet.snapshot.fasts.map((entry) => entry.id),
      ['tablet-fast'],
      'and the other device must end up with the one fast the person kept',
    );
  });

  it('THE CONTROL: one open fast beside three ended ones is left completely alone', () => {
    const history = [
      fast('open', { startedAt: T }),
      fast('ended-one', { id: 'ended-one', startedAt: T - 48 * HOUR, endedAt: T - 32 * HOUR }),
      fast('ended-two', { id: 'ended-two', startedAt: T - 24 * HOUR, endedAt: T - 8 * HOUR }),
      fast('cancelled', { id: 'cancelled', startedAt: T - 72 * HOUR, endedAt: T - 72 * HOUR }),
    ];
    const local = stampedPayload(history, { lamport: 1, deviceId: 'phone' });

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote: local });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id).toSorted(),
      ['cancelled', 'ended-one', 'ended-two', 'open'],
    );
    assert.deepEqual(merged.meta.tombstones, []);
  });
});

// ---------------------------------------------------------------------------
// A DECLARED END IS NEVER LOST
// ---------------------------------------------------------------------------

/**
 * `setLocalFastStart` refuses to touch a fast that has ended, but it reads
 * THIS device's copy, and a device that has not synced holds one that is still
 * running. The person ends the fast on their phone and adjusts its start on a
 * stale tablet; both stamps land at the same lamport because both were made
 * against the same baseline; `pickMergeWinner` breaks that tie on DEVICE ID,
 * so half the time the reopened copy wins and the end the person declared is
 * gone (M240 counsel item 2).
 */
describe('mergeSnapshots and a fast one device already ended', () => {
  const ENDED_AT = T + 17 * HOUR;
  /** The phone ended it, with the reflection that was declared in the same act. */
  const ended = fast('shared', { endedAt: ENDED_AT, mood: 'good', note: 'steady' });
  /** The stale tablet only moved the start, so its copy is still running. */
  const reopened = fast('shared', { startedAt: T - 2 * HOUR });

  it('CARRIES THE END onto the winner when the reopened copy wins on device id', () => {
    // BOTH AT LAMPORT 4, which is what a pair of edits made against one
    // baseline produces, so the DEVICE ID decides. 'zzz-tablet' beats
    // 'aaa-phone', so without the rule the merged fast is open and the end is
    // lost.
    const phone = stampedPayload([ended], { lamport: 4, deviceId: 'aaa-phone' });
    const tablet = stampedPayload([reopened], { lamport: 4, deviceId: 'zzz-tablet' });

    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: phone,
      remote: tablet,
    });
    const survivor = merged.snapshot.fasts[0];

    assert.equal(survivor?.endedAt, ENDED_AT, 'an end the person declared must survive a stale edit');
    assert.equal(survivor?.startedAt, T - 2 * HOUR, 'and the winner keeps the field it actually changed');
    assert.equal(survivor?.mood, 'good', 'with the reflection declared in the same act as the end');
    assert.equal(survivor?.note, 'steady');
  });

  it('CONVERGES: the other merge order gives a byte-identical payload', () => {
    const phone = stampedPayload([ended], { lamport: 4, deviceId: 'aaa-phone' });
    const tablet = stampedPayload([reopened], { lamport: 4, deviceId: 'zzz-tablet' });

    const { aFirst, bFirst } = mergeBoth(phone, tablet);

    assert.deepEqual(aFirst.snapshot, bFirst.snapshot);
    assert.deepEqual(aFirst.meta, bFirst.meta);
    assert.equal(aFirst.snapshot.fasts[0]?.endedAt, ENDED_AT);
  });

  it('IS IDEMPOTENT: merging the result again changes nothing', () => {
    const phone = stampedPayload([ended], { lamport: 4, deviceId: 'aaa-phone' });
    const tablet = stampedPayload([reopened], { lamport: 4, deviceId: 'zzz-tablet' });
    const once = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: phone, remote: tablet });
    const twice = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: once, remote: once });

    assert.deepEqual(twice.snapshot.fasts, once.snapshot.fasts);
    assert.equal(payloadsEqual(once, twice), true);
  });

  it('works the other way round too, when the ENDED copy is the one that wins', () => {
    // Nothing to rescue here, and the result must be the same fast. This is
    // what makes the rule a repair rather than a preference for one side.
    const phone = stampedPayload([ended], { lamport: 4, deviceId: 'zzz-phone' });
    const tablet = stampedPayload([reopened], { lamport: 4, deviceId: 'aaa-tablet' });

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: phone, remote: tablet });

    assert.equal(merged.snapshot.fasts[0]?.endedAt, ENDED_AT);
    assert.equal(merged.snapshot.fasts[0]?.startedAt, T, 'and the winner keeps ITS start, which is the phone one');
  });

  it('THE CONTROL: a fast neither side ended stays open', () => {
    // Without this, "the end survives" would pass against a merge that stamped
    // an end onto anything, which is the invention ADR-0014 forbids.
    const phone = stampedPayload([fast('shared')], { lamport: 4, deviceId: 'aaa-phone' });
    const tablet = stampedPayload([reopened], { lamport: 4, deviceId: 'zzz-tablet' });

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: phone, remote: tablet });

    assert.equal(merged.snapshot.fasts[0]?.endedAt, null, 'a merge must never write an end nobody declared');
  });

  it('THE CONTROL: a HIGHER-stamped real reopen is not a stale edit, but its end still stands', () => {
    // The rule is about the END, not about the stamps. A device that genuinely
    // outranks the other still keeps the end, because an end is a declaration
    // and a start adjustment is not a retraction of one.
    const phone = stampedPayload([ended], { lamport: 4, deviceId: 'aaa-phone' });
    const tablet = stampedPayload([reopened], { lamport: 9, deviceId: 'aaa-tablet' });

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: phone, remote: tablet });

    assert.equal(merged.snapshot.fasts[0]?.endedAt, ENDED_AT);
  });

  it('THE CONTROL: a fast only one side holds is untouched', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: stampedPayload([fast('only-here')], { lamport: 1, deviceId: 'phone' }),
      remote: stampedPayload([], { lamport: 1, deviceId: 'tablet' }),
    });

    assert.equal(merged.snapshot.fasts[0]?.endedAt, null);
    assert.equal(merged.snapshot.fasts[0]?.mood, undefined, 'and no reflection key is invented for it');
  });
});

// ---------------------------------------------------------------------------
// The contrast: the fasting ROUTINE, merged as one singleton record
// ---------------------------------------------------------------------------

const SETTINGS_KEY = entityKey(SYNC_ENTITY_TYPES.fastingSettings, FASTING_SETTINGS_ENTITY_ID);

function settings(overrides: Partial<LocalFastingSettings> = {}): LocalFastingSettings {
  return {
    routineProtocolId: '16:8',
    routineStartMinute: 1_200,
    routineCustomHours: null,
    extendedAcknowledgedAt: null,
    updatedAt: T,
    ...overrides,
  };
}

/** A payload carrying one routine at an explicit Lamport stamp. */
function routinePayload(
  fastingSettings: LocalFastingSettings | null,
  stamp: { lamport: number; deviceId: string } | null = null,
): StampedSnapshot {
  return {
    snapshot: { ...snapshot([]), fastingSettings },
    meta: { perEntity: stamp === null ? {} : { [SETTINGS_KEY]: stamp }, tombstones: [] },
  };
}

describe('mergeSnapshots and the fasting routine', () => {
  it('adopts a remote routine onto a device that has none', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: routinePayload(null),
      remote: routinePayload(settings({ routineProtocolId: '20:4' }), { lamport: 1, deviceId: 'tablet' }),
    });

    assert.equal(merged.snapshot.fastingSettings?.routineProtocolId, '20:4');
  });

  it('keeps the HIGHER-stamped record, and the older one loses', () => {
    const older = routinePayload(settings({ routineProtocolId: '16:8' }), { lamport: 3, deviceId: 'phone' });
    const newer = routinePayload(settings({ routineProtocolId: '72h' }), { lamport: 4, deviceId: 'tablet' });

    assert.equal(
      mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: older, remote: newer }).snapshot
        .fastingSettings?.routineProtocolId,
      '72h',
      'the higher stamp must win when it arrives from the remote side',
    );
    // THE CONTROL, and it is the half that makes the line above mean anything:
    // swapping the two sides must swap nothing. A merge that simply preferred
    // `remote` would pass the first assertion and fail this one.
    assert.equal(
      mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: newer, remote: older }).snapshot
        .fastingSettings?.routineProtocolId,
      '72h',
      'the lower stamp must lose even when it is the local side',
    );
  });

  it('orders by the Lamport stamp and NOT by the record own updatedAt', () => {
    // Wall-clock time is never an ordering authority here: it drifts, and
    // across two devices it is routinely wrong. This pins that rule with the
    // two signals pointing in OPPOSITE directions, which is the only way the
    // assertion can tell them apart.
    const wallClockNewer = routinePayload(settings({ routineProtocolId: '16:8', updatedAt: T + 10 * HOUR }), {
      lamport: 2,
      deviceId: 'phone',
    });
    const lamportNewer = routinePayload(settings({ routineProtocolId: '36h', updatedAt: T - 10 * HOUR }), {
      lamport: 5,
      deviceId: 'tablet',
    });

    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: wallClockNewer,
      remote: lamportNewer,
    });

    assert.equal(merged.snapshot.fastingSettings?.routineProtocolId, '36h');
    assert.equal(merged.snapshot.fastingSettings?.updatedAt, T - 10 * HOUR);
  });

  it('never stamps a routine this device has not set, `null` is not an answer competing in the merge', () => {
    const stamped = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: { ...snapshot([]), fastingSettings: null },
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    assert.deepEqual(Object.keys(stamped.meta.perEntity), []);
    assert.deepEqual(stamped.meta.tombstones, []);
  });
});

// ---------------------------------------------------------------------------
// The previous release: a payload with no fast stamps must delete nothing
// ---------------------------------------------------------------------------

describe('a payload written by 0.35.1, where fasts were passed through', () => {
  /**
   * What 0.35.1 republished, read off its own `mergeSnapshots`: its
   * `perEntity` was built inside the loop over MERGED candidates, so it
   * carried no `fast:*` key at all, and its snapshot held whatever its own
   * local list was, which on a device that had never started a fast is empty.
   */
  const previousRelease: StampedSnapshot = { snapshot: snapshot([]), meta: { perEntity: {}, tombstones: [] } };

  it('never deletes this device fasts, because it carries no tombstone for one', () => {
    const local = stampedPayload([fast('mine')], { lamport: 3, deviceId: 'phone' });

    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local,
      remote: previousRelease,
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id),
      ['mine'],
      'an old device stripping the stamps must not read as the person deleting the fast',
    );
    assert.deepEqual(merged.meta.tombstones, []);
    assert.equal(merged.meta.perEntity[fastKey('mine')]?.lamport, 3, 'and this device re-publishes the stamp it stripped');
  });

  it('is adopted at stamp 0 when it DOES carry a fast, so any real stamp outranks it', () => {
    // The other direction: 0.35.1 passed its own local fasts through, so a
    // blob it wrote can hold a fast with no stamp beside it. Stamp 0 loses to
    // anything that ever carried a real stamp, and still beats nothing.
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([fast('written-by-the-old-build')]),
    });

    assert.deepEqual(merged.snapshot.fasts.map((entry) => entry.id), ['written-by-the-old-build']);
    assert.equal(merged.meta.perEntity[fastKey('written-by-the-old-build')]?.lamport, 0);
  });
});
