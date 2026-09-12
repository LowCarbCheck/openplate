/**
 * The fasting/sync boundary (M132): `mergeSnapshots` must leave `fasts`
 * EXACTLY as the local device holds them, no matter what the remote payload
 * says.
 *
 * Fasts are deliberately absent from `SYNC_ENTITY_TYPES` and `flattenSnapshot`,
 * so they are never stamped, diffed, tombstoned or adopted. That is a scope
 * boundary, not an oversight, "at most one open fast" across two devices is a
 * genuinely hard question (two phones each holding a running fast have two
 * truthful answers) and it needs its own design pass rather than falling out of
 * last-writer-wins.
 *
 * The failure modes this file exists to catch are both silent:
 *
 * - a bare `fasts: []` in the merge result would EMPTY the device's fasts on
 *   the very first sync, and
 * - adding fasts to `flattenSnapshot` would let a peer running an older build
 *   (which sends no fasts at all) tombstone every fast this device has.
 *
 * The second half of this file is the CONTRAST, and it is what keeps the first
 * half honest: the fasting ROUTINE (`fastingSettings`) sits in the same
 * feature and takes the opposite path. It IS stamped, IS merged, and a second
 * device DOES adopt it, because a routine is a preference like the profile
 * row, while a fast is an event with a cross-device invariant. Without the
 * contrast, "fasting is not synced" reads as a rule about the feature instead
 * of a decision about one entity.
 */
import {
  EVICTED_STORAGE,
  HEALTHY_STORAGE,
  NO_PASS_THROUGH_RECORD,
  NOTHING_TO_ACCOUNT_FOR,
  passThroughEvidence,
} from '../sync-integrity-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  entityKey,
  FASTING_SETTINGS_ENTITY_ID,
  mergeSnapshots,
  SYNC_ENTITY_TYPES,
  stampSnapshot,
} from '../../app/lib/sync/snapshot-sync';
import type { SnapshotIntegrity } from '../../app/lib/sync/snapshot-sync';
import { FASTS_TABLE, SAVED_MEALS_TABLE } from '../../app/lib/local-store/schema';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalFast, LocalFastingSettings } from '../../app/lib/local-store/schema';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';

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
  // `savedMeals` rides through the same pass-through path as `fasts` (see
  // `snapshot-sync.ts`), an empty array here is enough, since this file's
  // assertions are all about `fasts`, not saved meals.
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts,
    savedMeals: [],
    fastingSettings: null,
    privateStore: null,
  };
}

function payload(fasts: LocalFast[]): StampedSnapshot {
  return { snapshot: snapshot(fasts), meta: { perEntity: {}, tombstones: [] } };
}

describe('mergeSnapshots and fasts', () => {
  it('keeps the local fasts when the remote payload has none', () => {
    const local = payload([fast('mine')]);

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote: payload([]) });

    assert.deepEqual(merged.snapshot.fasts, [fast('mine')]);
  });

  it('ignores the remote fasts entirely, nothing is adopted across devices', () => {
    const local = payload([fast('mine')]);
    const remote = payload([fast('theirs', { id: 'theirs', startedAt: T + HOUR })]);

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id),
      ['mine'],
      "a peer's fast must never appear on this device",
    );
  });

  it('keeps an empty local list empty even when the remote is full', () => {
    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: payload([]), remote: payload([fast('theirs')]) });

    assert.deepEqual(merged.snapshot.fasts, []);
  });

  it('is stable under repeated merges, no drift, no accumulation', () => {
    const local = payload([fast('mine'), fast('older', { id: 'older', endedAt: T + 9 * HOUR })]);
    const remote = payload([fast('theirs')]);

    const once = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });
    const twice = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: once, remote });

    assert.deepEqual(twice.snapshot.fasts, local.snapshot.fasts);
  });

  it('never stamps or tombstones a fast, no fast id reaches the wire meta', () => {
    // `flattenSnapshot` is private, so this asserts the observable consequence:
    // stamping a snapshot that holds a fast produces no entity key for it, and
    // deleting it later therefore produces no tombstone either.
    const stamped = stampSnapshot({
    integrity: HEALTHY_STORAGE,
      snapshot: snapshot([fast('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    assert.deepEqual(Object.keys(stamped.meta.perEntity), []);
    assert.deepEqual(stamped.meta.tombstones, []);

    const afterDelete = stampSnapshot({
    integrity: HEALTHY_STORAGE,
      snapshot: snapshot([]),
      baseline: stamped.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(afterDelete.meta.tombstones, [], 'a removed fast must not produce a tombstone');
  });

  it('keeps fasts out of the synced entity-type catalog, while the routine is in it', () => {
    assert.deepEqual(Object.values(SYNC_ENTITY_TYPES), [
      'personalFood',
      'foodLog',
      'weightEntry',
      'profile',
      // The contrast, pinned in the one place a future edit would have to pass
      // through: the routine is merged, the fasts beside it are not.
      'fastingSettings',
      'privateStore',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The boundary of the pass-through: a device that cannot vouch for its storage
// ---------------------------------------------------------------------------

/** A device whose fasts table did NOT finish loading, while everything else about the store is fine. */
const FASTS_TABLE_NOT_LOADED: SnapshotIntegrity = {
  hasPersistedDatabase: true,
  isTableLoaded: { [FASTS_TABLE]: false },
  isCompartmentKnown: true,
  // Nothing here is about the compartment either: these fixtures reach
  // `mergeSnapshots`, which never weighs the seal.
  isCompartmentHeld: false,
  isCompartmentUnpublished: false,
  // Nothing here is about a delete: these fixtures test the two PASS-THROUGH
  // collections, which carry no tombstones and therefore no journal rows.
  deletedEntityKeys: new Set(),
};

describe('mergeSnapshots, fasts, and what the device can prove', () => {
  it('does NOT let an evicted device empty the account: the remote fasts survive', () => {
    // The eviction, one door over from the tombstones M224 fixed. The device
    // holds no fasts because its database is gone, not because anybody deleted
    // one, and a pass-through would push that emptiness over the account.
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: EVICTED_STORAGE,
      local: payload([]),
      remote: payload([fast('on-the-account')]),
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id),
      ['on-the-account'],
      'a device with no storage must not be the side that decides the list is empty',
    );
  });

  it('THE CONTROL: a HEALTHY device with no fasts keeps the list empty, local is authoritative', () => {
    // Without this, the case above passes against a merge that always prefers
    // the remote, which would resurrect every fast anybody ever deleted.
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([fast('on-the-account')]),
    });

    assert.deepEqual(merged.snapshot.fasts, [], 'zero fasts on a healthy device is a real state, not a gap');
  });

  it('THE CONTROL, the other half: a healthy device with fasts still ignores the remote list', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: payload([fast('mine')]),
      remote: payload([fast('theirs')]),
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id),
      ['mine'],
      'an ordinary cycle is unchanged: nothing is adopted across devices',
    );
  });

  it('reads the fasts TABLE, so a partial load that dropped only that table is caught too', () => {
    // The database is still there, so `hasPersistedDatabase` says nothing at
    // all here. Only the per-table signal can tell that this one list was half
    // read, and a short list pushed over the account is the same loss as an
    // empty one.
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: FASTS_TABLE_NOT_LOADED,
      local: payload([fast('the-one-that-loaded')]),
      remote: payload([fast('the-one-that-loaded'), fast('the-one-memory-missed')]),
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id).toSorted(),
      ['the-one-memory-missed', 'the-one-that-loaded'],
      'a half-read table must not be the side that decides what the account holds',
    );
  });
});

// ---------------------------------------------------------------------------
// The second half of the pass-through rule: a short list must be ACCOUNTED FOR
// ---------------------------------------------------------------------------

/**
 * The device the storage signals call perfectly healthy, and which has lost
 * everything.
 *
 * `persist.ts` primes an empty database before anything reads integrity, so an
 * evicted device boots into "the database is there, every table agrees at
 * zero". That is what `HEALTHY_STORAGE` spells, and it is exactly the state
 * this rule exists to catch: nothing about the storage can tell it from a
 * person who cleared their fasts. Only the baseline and the journal can.
 */
describe('mergeSnapshots, fasts, and accounting for the ids the baseline named', () => {
  it('refuses a local list that dropped two fasts with nothing recorded: the remote list stands', () => {
    const merged = mergeSnapshots({
      ...passThroughEvidence({ fasts: ['fast-one', 'fast-two'] }),
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([fast('fast-one'), fast('fast-two', { id: 'fast-two' })]),
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id).toSorted(),
      ['fast-one', 'fast-two'],
      'two ids this device cannot account for are two ids it may not publish as gone',
    );
    assert.deepEqual(merged.passThrough.refused, [FASTS_TABLE], 'and the cycle must say which table it refused');
    assert.deepEqual(merged.passThrough.published, []);
  });

  it('lets the same list stand once both removals are in the delete journal', () => {
    const merged = mergeSnapshots({
      ...passThroughEvidence({
        fasts: ['fast-one', 'fast-two'],
        journal: ['fast:fast-one', 'fast:fast-two'],
      }),
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([fast('fast-one'), fast('fast-two', { id: 'fast-two' })]),
    });

    assert.deepEqual(merged.snapshot.fasts, [], 'a recorded removal is a fact, and it must reach the account');
    assert.deepEqual(merged.passThrough.published.toSorted(), ['fast:fast-one', 'fast:fast-two']);
    assert.deepEqual(merged.passThrough.refused, []);
  });

  it('treats a baseline from before the ids were kept as accounting for nothing', () => {
    // The migration, and the direction it fails in. An absent record is not an
    // empty one: it says this device never wrote down what the account held, so
    // its shorter list proves nothing and the account's stands for one cycle.
    const merged = mergeSnapshots({
      ...NO_PASS_THROUGH_RECORD,
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([fast('on-the-account')]),
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id),
      ['on-the-account'],
      'a baseline that recorded nothing cannot license an empty list',
    );
    assert.deepEqual(
      merged.passThrough.refused,
      [FASTS_TABLE, SAVED_MEALS_TABLE],
      'the record is absent for BOTH collections, so both hand this cycle to the account',
    );
  });

  it('still refuses a half-read table, however complete the journal is', () => {
    // BOTH SIGNALS, ALWAYS. A journal row is honest here and the snapshot
    // around it is still wrong: the table was half read, so the ids it did not
    // reach are not in the local list either, and publishing it would take them
    // with it.
    const merged = mergeSnapshots({
      ...passThroughEvidence({ fasts: ['fast-one'], journal: ['fast:fast-one'] }),
      integrity: FASTS_TABLE_NOT_LOADED,
      local: payload([]),
      remote: payload([fast('fast-one'), fast('never-reached-memory', { id: 'never-reached-memory' })]),
    });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id).toSorted(),
      ['fast-one', 'never-reached-memory'],
      'a proven delete does not make a half-read table speak for the rest of its rows',
    );
    assert.deepEqual(merged.passThrough.refused, [FASTS_TABLE]);
  });
});

// ---------------------------------------------------------------------------
// The contrast: the fasting ROUTINE is merged, last-writer-wins
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
  it('adopts a remote routine onto a device that has none, the opposite of the fasts above', () => {
    // A pass-through would keep `null` here and look like it had worked, which
    // is the failure this whole entity is in the catalog to avoid.
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
      mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: older, remote: newer }).snapshot.fastingSettings?.routineProtocolId,
      '72h',
      'the higher stamp must win when it arrives from the remote side',
    );
    // THE CONTROL, and it is the half that makes the line above mean anything:
    // swapping the two sides must swap nothing. A merge that simply preferred
    // `remote` would pass the first assertion and fail this one.
    assert.equal(
      mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: newer, remote: older }).snapshot.fastingSettings?.routineProtocolId,
      '72h',
      'the lower stamp must lose even when it is the local side',
    );
  });

  it('orders by the Lamport stamp and NOT by the record own updatedAt', () => {
    // Wall-clock time is never an ordering authority here: it drifts, and
    // across two devices it is routinely wrong. This pins that rule with the
    // two signals pointing in OPPOSITE directions, which is the only way the
    // assertion can tell them apart.
    const wallClockNewer = routinePayload(
      settings({ routineProtocolId: '16:8', updatedAt: T + 10 * HOUR }),
      { lamport: 2, deviceId: 'phone' },
    );
    const lamportNewer = routinePayload(
      settings({ routineProtocolId: '36h', updatedAt: T - 10 * HOUR }),
      { lamport: 5, deviceId: 'tablet' },
    );

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: wallClockNewer, remote: lamportNewer });

    assert.equal(merged.snapshot.fastingSettings?.routineProtocolId, '36h');
    assert.equal(merged.snapshot.fastingSettings?.updatedAt, T - 10 * HOUR);
  });

  it('stamps the routine on the wire, and advances the stamp only when it changes', () => {
    const first = stampSnapshot({
    integrity: HEALTHY_STORAGE,
      snapshot: { ...snapshot([]), fastingSettings: settings() },
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });
    assert.equal(first.meta.perEntity[SETTINGS_KEY]?.lamport, 1);

    // Unchanged content carries the previous stamp forward untouched, so a
    // boot that changes nothing does not burn a blob version.
    const unchanged = stampSnapshot({
    integrity: HEALTHY_STORAGE,
      snapshot: { ...snapshot([]), fastingSettings: settings() },
      baseline: first.baseline,
      deviceId: 'device-a',
    });
    assert.equal(unchanged.meta.perEntity[SETTINGS_KEY]?.lamport, 1);

    // A real edit advances it. `updatedAt` alone is enough, which is the one
    // job that field does for sync.
    const edited = stampSnapshot({
    integrity: HEALTHY_STORAGE,
      snapshot: { ...snapshot([]), fastingSettings: settings({ updatedAt: T + HOUR }) },
      baseline: unchanged.baseline,
      deviceId: 'device-a',
    });
    assert.equal(edited.meta.perEntity[SETTINGS_KEY]?.lamport, 2);
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
