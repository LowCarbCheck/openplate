/**
 * Marks and awards across two devices (M235/03).
 *
 * The milestone's central claim is one sentence: a person who uses a phone and
 * a tablet on the same day ends up holding every signal from both. It rests on
 * a design decision rather than on new merge code, so it is asserted directly
 * here instead of being inferred from the merge engine's own unit tests.
 *
 * THE MECHANISM, and why nothing in `sync/engine/merge/` was touched. The
 * merge is whole-record last-writer-wins per entity id, and `mergeEntityMaps`
 * passes an entity present on only ONE side through unchanged. A mark's row id
 * is `${dayKey}#${signal}`, so two devices recording two different signals on
 * one day write two DIFFERENT ids and neither one competes with the other. The
 * unit of the ROW is the unit of the FACT.
 *
 * THE CONTROL IS THE DIARY BESIDE IT. A food log edited on two devices DOES
 * lose the older write, in the same merge, with the same two payloads. Without
 * it, "both marks survived" would pass just as happily against a merge that had
 * quietly started keeping everything from both sides, and the assertion would
 * be saying nothing at all.
 *
 * THE SECOND CLAIM is the one that protects somebody else's device: neither
 * table has a delete verb, so neither is in `DELETE_JOURNAL_TAG_BY_TABLE`, so a
 * device whose IndexedDB was evicted mints NO trusted tombstone for a mark it
 * can no longer see. Its control is a food log in the identical state with a
 * journal row behind it, which must still mint one, or the test would pass
 * against a `stampSnapshot` that had stopped minting tombstones at all.
 */
import { HEALTHY_STORAGE, NOTHING_TO_ACCOUNT_FOR, withRecordedDeletes } from '../sync-integrity-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { entityKey, mergeSnapshots, stampSnapshot, SYNC_ENTITY_TYPES } from '../../app/lib/sync/snapshot-sync';
import type { StampedSnapshot, SyncBaseline } from '../../app/lib/sync/snapshot-sync';
import {
  ACTIVITY_MARKS_TABLE,
  AWARDS_TABLE,
  DELETE_JOURNAL_TAG_BY_TABLE,
  FOOD_LOGS_TABLE,
} from '../../app/lib/local-store/schema';
import type { LocalActivityMark, LocalAward, LocalFoodLog } from '../../app/lib/local-store/schema';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';

const NOW = 1_700_000_000_000;
const DAY = '2026-09-18';

/** A mark, with the id the pure core mints for it, which is what makes two signals two rows. */
function mark(signal: string, dayKey: string = DAY): LocalActivityMark {
  return { id: `${dayKey}#${signal}`, dayKey, signal };
}

/** An earned award, unseen unless the caller says otherwise. Its `key` IS its row id. */
function award(key: string, overrides: Partial<LocalAward> = {}): LocalAward {
  return { key, earnedAt: NOW, earnedOnDay: DAY, seenAt: null, ...overrides };
}

/** A food log, the control entity: an ordinary merged row two devices can both edit. */
function foodLog(id: string, name: string): LocalFoodLog {
  return {
    id,
    name,
    quantityGrams: 50,
    macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
    mealType: 'snack',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: DAY,
    loggedAt: NOW,
    createdAt: NOW,
    logBatchId: null,
  };
}

/** One device's snapshot: whatever this test is about, and nothing else. */
function snapshot({
  activityMarks = [],
  awards = [],
  foodLogs = [],
}: {
  activityMarks?: LocalActivityMark[];
  awards?: LocalAward[];
  foodLogs?: LocalFoodLog[];
}): SyncedSnapshot {
  return {
    foods: [],
    foodLogs,
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    pantryItems: [],
    activityMarks,
    awards,
    fastingSettings: null,
    privateStore: null,
  };
}

/**
 * One side of a merge, stamped by hand.
 *
 * The stamps are written out rather than produced by `stampSnapshot`, because
 * what every case below is about is which `(lamport, deviceId)` wins, and a
 * fixture that computed them would be asserting the stamping and the merge in
 * one breath.
 */
function payload({
  snapshot: taken,
  deviceId,
  lamport = 1,
}: {
  snapshot: SyncedSnapshot;
  deviceId: string;
  lamport?: number;
}): StampedSnapshot {
  const perEntity: StampedSnapshot['meta']['perEntity'] = {};
  for (const entry of taken.activityMarks)
    perEntity[entityKey(SYNC_ENTITY_TYPES.activityMark, entry.id)] = { lamport, deviceId };
  for (const entry of taken.awards) perEntity[entityKey(SYNC_ENTITY_TYPES.award, entry.key)] = { lamport, deviceId };
  for (const entry of taken.foodLogs) perEntity[entityKey(SYNC_ENTITY_TYPES.log, entry.id)] = { lamport, deviceId };
  return { snapshot: taken, meta: { perEntity, tombstones: [] } };
}

/** The merge under test, with the pass-through evidence every case here is indifferent to. */
function merge(local: StampedSnapshot, remote: StampedSnapshot) {
  return mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });
}

describe('mergeSnapshots, marks and awards across two devices', () => {
  it('keeps every signal from both devices when a phone and a tablet are used on the same day', () => {
    // The phone logged food, the tablet ran a fast, both on 2026-09-18. Two
    // signals, two row ids, and nothing to resolve.
    const phone = payload({ snapshot: snapshot({ activityMarks: [mark('log.food')] }), deviceId: 'phone' });
    const tablet = payload({ snapshot: snapshot({ activityMarks: [mark('fast.run')] }), deviceId: 'tablet' });

    const merged = merge(phone, tablet);

    assert.deepEqual(
      merged.snapshot.activityMarks.map((entry) => entry.id).toSorted(),
      [`${DAY}#fast.run`, `${DAY}#log.food`],
      "a signal recorded on the other device must not be dropped by this device's pull",
    );
  });

  it('control: a food log loses the older write, so the case above is about the row id and not about a merge that keeps everything', () => {
    // The SAME merge, the same two devices, one entity id on both sides. The
    // higher Lamport stamp wins and the other device's version is gone, which
    // is the accepted whole-record trade-off the marks design works around
    // rather than changes.
    const phone = payload({
      snapshot: snapshot({ foodLogs: [foodLog('lunch', 'Salad, as typed on the phone')] }),
      deviceId: 'phone',
      lamport: 1,
    });
    const tablet = payload({
      snapshot: snapshot({ foodLogs: [foodLog('lunch', 'Salad, edited on the tablet')] }),
      deviceId: 'tablet',
      lamport: 2,
    });

    const merged = merge(phone, tablet);

    assert.equal(merged.snapshot.foodLogs.length, 1, 'one entity id is one row, whatever the two devices wrote');
    assert.equal(
      merged.snapshot.foodLogs[0]?.name,
      'Salad, edited on the tablet',
      'the higher Lamport stamp must win, or this file is not testing a last-writer-wins merge at all',
    );
  });

  it('adopts a mark this device never had, so an empty local list is filled by the account', () => {
    // The pass-through stance would have published the empty local list whole
    // and dropped the peer's row, silently: the streak would simply read lower.
    const fresh = payload({ snapshot: snapshot({}), deviceId: 'fresh' });
    const account = payload({ snapshot: snapshot({ activityMarks: [mark('weight.log')] }), deviceId: 'phone' });

    assert.deepEqual(
      merge(fresh, account).snapshot.activityMarks.map((entry) => entry.id),
      [`${DAY}#weight.log`],
    );
  });

  it('converges on ONE row when two devices earn the same award concurrently', () => {
    // Same catalog key, so the same row id, so one row. Which `earnedAt`
    // survives is decided by the stamps and is accepted: both devices are
    // describing the same achievement and nothing branches on the number.
    const phone = payload({
      snapshot: snapshot({ awards: [award('explorer.log.food', { earnedAt: NOW })] }),
      deviceId: 'phone',
      lamport: 1,
    });
    const tablet = payload({
      snapshot: snapshot({ awards: [award('explorer.log.food', { earnedAt: NOW + 60_000 })] }),
      deviceId: 'tablet',
      lamport: 2,
    });

    const merged = merge(phone, tablet);

    assert.deepEqual(
      merged.snapshot.awards.map((entry) => entry.key),
      ['explorer.log.food'],
      'one catalog key must never become two rows',
    );
    assert.equal(merged.snapshot.awards[0]?.earnedAt, NOW + 60_000, 'the higher stamp decides, as it does everywhere');
  });

  it('is deterministic and symmetric, so two devices merging the same pair land on the same lists', () => {
    const phone = payload({
      snapshot: snapshot({ activityMarks: [mark('log.food')], awards: [award('explorer.log.food')] }),
      deviceId: 'phone',
    });
    const tablet = payload({
      snapshot: snapshot({ activityMarks: [mark('fast.run')], awards: [award('explorer.fast.run')] }),
      deviceId: 'tablet',
    });

    const here = merge(phone, tablet);
    const there = merge(tablet, phone);

    assert.deepEqual(here.snapshot.activityMarks, there.snapshot.activityMarks);
    assert.deepEqual(here.snapshot.awards, there.snapshot.awards);
  });
});

describe('stampSnapshot, marks and awards', () => {
  it('mints no new Lamport stamp for a mark that was re-written identically', () => {
    // A person who opens the app ten times a day fires the same signal ten
    // times. `putLocalActivityMark` writes the row once, the content hash never
    // moves, and this is the half of that promise that lives in sync: no new
    // stamp, so no push, so nothing for a peer to merge.
    const taken = snapshot({ activityMarks: [mark('log.food')] });
    const first = stampSnapshot({
      snapshot: taken,
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'phone',
      integrity: HEALTHY_STORAGE,
    });

    const second = stampSnapshot({
      snapshot: taken,
      baseline: first.baseline,
      deviceId: 'phone',
      integrity: HEALTHY_STORAGE,
    });

    const key = entityKey(SYNC_ENTITY_TYPES.activityMark, `${DAY}#log.food`);
    assert.equal(first.meta.perEntity[key]?.lamport, 1, 'the first sight of a mark is a change');
    assert.deepEqual(
      second.meta.perEntity[key],
      first.meta.perEntity[key],
      'an unchanged row must carry its stamp forward',
    );
  });

  it('mints no trusted tombstone for a mark the baseline names and the store lost, while a journalled food log still mints one', () => {
    // THE EVICTION, from the side that matters: this device's baseline names
    // both entities and its snapshot holds neither. The journal can hold the
    // food log's key, because a delete verb wrote it. It can NEVER hold the
    // mark's, because no verb anywhere removes a mark, which is what makes the
    // mark's absence unpublishable.
    const markKey = entityKey(SYNC_ENTITY_TYPES.activityMark, `${DAY}#log.food`);
    const logKey = entityKey(SYNC_ENTITY_TYPES.log, 'lunch');
    const baseline: SyncBaseline = {
      perEntity: {
        [markKey]: { lamport: 3, deviceId: 'phone', hash: 'whatever-it-was' },
        [logKey]: { lamport: 3, deviceId: 'phone', hash: 'whatever-it-was' },
      },
      tombstones: [],
    };

    const stamped = stampSnapshot({
      snapshot: snapshot({}),
      baseline,
      deviceId: 'phone',
      integrity: withRecordedDeletes(HEALTHY_STORAGE, [logKey]),
    });

    assert.deepEqual(
      stamped.minted.map((tombstone) => entityKey(tombstone.entityType, tombstone.entityId)),
      [logKey],
      'THE CONTROL: a food log the person deleted must still be published as deleted',
    );
    assert.deepEqual(
      stamped.withheld.map((tombstone) => entityKey(tombstone.entityType, tombstone.entityId)),
      [markKey],
      "a device that lost its store must never delete another device's record of what the person did",
    );
  });

  it('keeps both tables out of the delete journal map, which is what the case above rests on', () => {
    // Widened to plain strings so the absence can be asserted at all: the map's
    // own key union does not contain the names being looked for, which is the
    // point.
    const journalled: string[] = Object.keys(DELETE_JOURNAL_TAG_BY_TABLE);

    assert.ok(
      !journalled.includes(ACTIVITY_MARKS_TABLE),
      'a mark gained a delete verb without this file being rewritten',
    );
    assert.ok(!journalled.includes(AWARDS_TABLE), 'an award gained a delete verb without this file being rewritten');
    // The control: the same probe finds a table that IS journalled.
    assert.ok(journalled.includes(FOOD_LOGS_TABLE), 'the probe cannot see the map at all');
  });

  it('carries both tables in the synced entity-type catalog, which is what makes them merged rather than passed through', () => {
    const synced: string[] = Object.values(SYNC_ENTITY_TYPES);

    assert.ok(
      synced.includes('activityMark'),
      'a mark stopped being a stamped entity, so a peer can no longer adopt one',
    );
    assert.ok(synced.includes('award'), 'an award stopped being a stamped entity');
    // The control: the same probe does not find a collection that is genuinely
    // passed through, so it is reading the catalog rather than saying yes.
    assert.ok(!synced.includes('pantryItem'), 'the probe cannot see the catalog at all');
  });
});
