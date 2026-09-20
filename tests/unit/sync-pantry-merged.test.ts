/**
 * THE PANTRY IS A MERGED SYNC ENTITY (M240/02, ADR-0015).
 *
 * It was a pass-through until this milestone, and the file that used to stand
 * here pinned that: `mergeSnapshots` left `pantryItems` exactly as the local
 * device held them, whatever the remote payload said, and with no
 * `decidePassThrough` guard around it, because the pantry wrote no
 * delete-journal rows for the guard to read.
 *
 * M233/02's argument was that a working list of what is in one fridge is stale
 * within days and belongs to the device that photographed the shelf. The owner
 * reversed it: a shopping list that is only on the phone you left at home is
 * not a shopping list. The cost is the delete journal M233/02 declined to pay,
 * and every removal path now writes one.
 *
 * Every claim below is the reversal of one this file used to make:
 *
 *  - a pantry row IS in `SYNC_ENTITY_TYPES`, so it is stamped and tombstoned;
 *  - a remote row IS adopted, and two devices' shelves both survive;
 *  - a removal DOES travel, through the journal and a tombstone;
 *  - photographing a shelf DOES make this device push.
 *
 * THE EVICTION CASE IS KEPT, re-expressed. It used to be answered by "the
 * local list always wins"; it is answered now by `isTombstoneTrusted`, the
 * ordinary ADR-0013 machinery, which is a strictly better answer: an evicted
 * device repopulates from the account instead of keeping its emptiness.
 *
 * THE CONTROL IS STILL THE TABLE BESIDE IT. Personal foods have always been a
 * synced entity, so every case here that asserts the remote payload was read
 * has a neighbour that would notice a merge which stopped reading it.
 */
import {
  EVICTED_STORAGE,
  HEALTHY_STORAGE,
  NOTHING_TO_ACCOUNT_FOR,
  withRecordedDeletes,
} from '../sync-integrity-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  baselineFromPayload,
  entityKey,
  mergeSnapshots,
  payloadsEqual,
  stampSnapshot,
  SYNC_ENTITY_TYPES,
} from '../../app/lib/sync/snapshot-sync';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalPantryItem, LocalPersonalFood } from '../../app/lib/local-store/schema';
import { PANTRY_ITEMS_TABLE } from '../../app/lib/local-store/schema';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';

const NOW = 1_700_000_000_000;

function pantryItem(id: string, overrides: Partial<LocalPantryItem> = {}): LocalPantryItem {
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

function food(id: string): LocalPersonalFood {
  return {
    id,
    name: `Food ${id}`,
    brand: null,
    macrosPer100g: { carbs: 1, fiber: 0, sugars: 0, polyols: null, protein: 12, fat: 10, kcal: 150 },
    source: 'user',
    createdAt: NOW,
  };
}

/** One side of a merge: a pantry, and the foods that are the control beside it. */
function snapshot(pantryItems: LocalPantryItem[], foods: LocalPersonalFood[] = []): SyncedSnapshot {
  return {
    foods,
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    pantryItems,
    activityMarks: [],
    awards: [],
    fastingSettings: null,
    privateStore: null,
  };
}

function payload(pantryItems: LocalPantryItem[], foods: LocalPersonalFood[] = []): StampedSnapshot {
  return { snapshot: snapshot(pantryItems, foods), meta: { perEntity: {}, tombstones: [] } };
}

/** The ids the merge would write, sorted, so the order the merge chose is not asserted. */
function mergedPantryIds(local: StampedSnapshot, remote: StampedSnapshot): string[] {
  const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });
  return merged.snapshot.pantryItems.map((item) => item.id).toSorted();
}

/** A payload whose pantry rows carry explicit stamps, which is what decides a merge. */
function stampedPayload(items: LocalPantryItem[], stamp: { lamport: number; deviceId: string }): StampedSnapshot {
  return {
    snapshot: snapshot(items),
    meta: {
      perEntity: Object.fromEntries(items.map((item) => [pantryKey(item.id), stamp])),
      tombstones: [],
    },
  };
}

function pantryKey(id: string): string {
  return entityKey(SYNC_ENTITY_TYPES.pantryItem, id);
}

describe('mergeSnapshots and pantryItems', () => {
  it('ADOPTS a pantry row this device has never seen, which a pass-through never did', () => {
    assert.deepEqual(
      mergedPantryIds(payload([]), stampedPayload([pantryItem('on-the-account')], { lamport: 1, deviceId: 'tablet' })),
      ['on-the-account'],
      'a shelf photographed on the tablet must reach the phone somebody shops with',
    );
  });

  it('keeps BOTH devices rows, because two different ids never contend', () => {
    const phone = stampedPayload([pantryItem('phone-row')], { lamport: 1, deviceId: 'phone' });
    const tablet = stampedPayload([pantryItem('tablet-row')], { lamport: 1, deviceId: 'tablet' });

    assert.deepEqual(mergedPantryIds(phone, tablet), ['phone-row', 'tablet-row']);
    // THE CONTROL that keeps the line above honest: a merge that preferred one
    // side would pass it and fail this.
    assert.deepEqual(mergedPantryIds(tablet, phone), ['phone-row', 'tablet-row']);
  });

  it('takes the HIGHER-stamped copy of one row, in either direction', () => {
    const older = stampedPayload([pantryItem('eggs', { amount: 6 })], { lamport: 3, deviceId: 'phone' });
    const newer = stampedPayload([pantryItem('eggs', { amount: 12 })], { lamport: 4, deviceId: 'tablet' });

    const forward = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: older, remote: newer });
    const backward = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: newer, remote: older });

    assert.equal(forward.snapshot.pantryItems[0]?.amount, 12, 'the later edit must reach the other device');
    assert.equal(backward.snapshot.pantryItems[0]?.amount, 12, 'and it must not lose by being the remote side');
  });

  it('applies a peer TOMBSTONE, so a row removed over there leaves this device', () => {
    const local = stampedPayload([pantryItem('used-up')], { lamport: 2, deviceId: 'phone' });
    const remote: StampedSnapshot = {
      snapshot: snapshot([]),
      meta: {
        perEntity: {},
        tombstones: [{ entityId: 'used-up', entityType: SYNC_ENTITY_TYPES.pantryItem, lamport: 3, deviceId: 'tablet' }],
      },
    };

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(merged.snapshot.pantryItems, [], 'a removal performed on the other device must land here');
  });

  it('THE CONTROL for the tombstone: a LOWER-stamped one loses to the live row', () => {
    const local = stampedPayload([pantryItem('re-added')], { lamport: 5, deviceId: 'phone' });
    const remote: StampedSnapshot = {
      snapshot: snapshot([]),
      meta: {
        perEntity: {},
        tombstones: [{ entityId: 're-added', entityType: SYNC_ENTITY_TYPES.pantryItem, lamport: 2, deviceId: 'tablet' }],
      },
    };

    assert.deepEqual(
      mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote }).snapshot.pantryItems.map(
        (entry) => entry.id,
      ),
      ['re-added'],
    );
  });

  it('is stable under repeated merges, no drift, no accumulation', () => {
    const local = stampedPayload([pantryItem('mine'), pantryItem('other')], { lamport: 1, deviceId: 'phone' });
    const remote = stampedPayload([pantryItem('theirs')], { lamport: 1, deviceId: 'tablet' });

    const once = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });
    const twice = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local: once, remote: once });

    assert.deepEqual(twice.snapshot.pantryItems, once.snapshot.pantryItems);
    assert.equal(payloadsEqual(once, twice), true, 'an unstable merge pushes at its peer for ever');
  });

  it('THE CONTROL: the table beside it merges the SAME way, so nothing here is special-cased', () => {
    const local = payload([pantryItem('mine')], [food('my-food')]);
    const remote = payload([pantryItem('theirs')], [food('their-food')]);

    const merged = mergeSnapshots({ ...NOTHING_TO_ACCOUNT_FOR, integrity: HEALTHY_STORAGE, local, remote });

    assert.deepEqual(merged.snapshot.foods.map((entry) => entry.id).toSorted(), ['my-food', 'their-food']);
    assert.deepEqual(merged.snapshot.pantryItems.map((entry) => entry.id).toSorted(), ['mine', 'theirs']);
  });

  it('puts the pantry IN the synced entity-type catalog', () => {
    const synced: string[] = Object.values(SYNC_ENTITY_TYPES);

    assert.ok(synced.includes('pantryItem'), 'the pantry must be a stamped entity, or nothing above it can travel');
    // The control: the same probe can still see the rest of the catalog.
    assert.ok(synced.includes('personalFood'));
  });
});

// ---------------------------------------------------------------------------
// Stamping: a pantry row is diffed like every other merged row
// ---------------------------------------------------------------------------

describe('stampSnapshot and pantryItems', () => {
  it('stamps a row, and advances the stamp only when the row changes', () => {
    const first = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([pantryItem('eggs')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });
    assert.equal(first.meta.perEntity[pantryKey('eggs')]?.lamport, 1, 'a photographed shelf must be pushable');

    const unchanged = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([pantryItem('eggs')]),
      baseline: first.baseline,
      deviceId: 'device-a',
    });
    assert.equal(unchanged.meta.perEntity[pantryKey('eggs')]?.lamport, 1, 'an idle cycle must not burn a blob version');

    const edited = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([pantryItem('eggs', { amount: 12, updatedAt: NOW + 1000 })]),
      baseline: unchanged.baseline,
      deviceId: 'device-a',
    });
    assert.equal(edited.meta.perEntity[pantryKey('eggs')]?.lamport, 2, 'correcting a line is a change the account needs');
  });

  it('mints a tombstone for a removed row, because the removal was written down', () => {
    // `replaceLocalPantry` drops the row and journals `pantryItem:eggs` in the
    // same transaction; this fixture is that transaction's other half.
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([pantryItem('eggs')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    const afterRemoval = stampSnapshot({
      integrity: withRecordedDeletes(HEALTHY_STORAGE, [pantryKey('eggs')]),
      snapshot: snapshot([]),
      baseline: synced.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(
      afterRemoval.meta.tombstones.map((entry) => `${entry.entityType}:${entry.entityId}`),
      [pantryKey('eggs')],
      'a row the person took off the list must not come back on the next pull',
    );
  });

  it('WITHHOLDS it when nothing was written down: an absence is not a removal', () => {
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([pantryItem('eggs')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    const afterLoss = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([]),
      baseline: synced.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(afterLoss.meta.tombstones, [], 'a device that recorded no removal must claim none');
    assert.deepEqual(afterLoss.withheld.map((entry) => entry.entityId), ['eggs']);
  });

  it('WITHHOLDS it on an EVICTED device even with the journal key', () => {
    // THE EVICTION CASE, re-expressed. The pass-through answered it by letting
    // the local list always win, which kept the emptiness; ADR-0013's rule
    // answers it better, by putting the account's shelf back.
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([pantryItem('eggs')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    const evicted = stampSnapshot({
      integrity: withRecordedDeletes(EVICTED_STORAGE, [pantryKey('eggs')]),
      snapshot: snapshot([]),
      baseline: synced.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(evicted.meta.tombstones, [], 'a device with no database may not empty the account shelf');
    assert.deepEqual(evicted.withheld.map((entry) => entry.entityId), ['eggs']);
  });

  it('WITHHOLDS it when only the pantry TABLE failed to load', () => {
    const halfRead = {
      ...HEALTHY_STORAGE,
      isTableLoaded: { [PANTRY_ITEMS_TABLE]: false },
      deletedEntityKeys: new Set([pantryKey('eggs')]),
    };
    const synced = stampSnapshot({
      integrity: HEALTHY_STORAGE,
      snapshot: snapshot([pantryItem('eggs')]),
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
    assert.deepEqual(afterHalfRead.withheld.map((entry) => entry.entityId), ['eggs']);
  });
});

// ---------------------------------------------------------------------------
// A photographed shelf makes the device push
// ---------------------------------------------------------------------------

describe('payloadsEqual and pantryItems', () => {
  it('sees a NEW row, an EDITED one and a REMOVED one, so each pushes on its own', () => {
    const account = stampedPayload([pantryItem('eggs')], { lamport: 1, deviceId: 'phone' });

    assert.equal(payloadsEqual(account, stampedPayload([], { lamport: 1, deviceId: 'phone' })), false);
    assert.equal(
      payloadsEqual(account, stampedPayload([pantryItem('eggs', { amount: 12 })], { lamport: 2, deviceId: 'phone' })),
      false,
      'correcting a line must make this device push',
    );
    assert.equal(
      payloadsEqual(account, {
        snapshot: snapshot([]),
        meta: {
          perEntity: {},
          tombstones: [{ entityId: 'eggs', entityType: SYNC_ENTITY_TYPES.pantryItem, lamport: 2, deviceId: 'phone' }],
        },
      }),
      false,
      'taking a row off the list must make this device push',
    );
  });

  it('THE CONTROL: the same rows in a different ORDER are equal', () => {
    const one = stampedPayload([pantryItem('a'), pantryItem('b')], { lamport: 1, deviceId: 'phone' });
    const other = stampedPayload([pantryItem('b'), pantryItem('a')], { lamport: 1, deviceId: 'phone' });

    assert.equal(payloadsEqual(one, other), true, 'the order a list comes back from the store in is not a change');
  });
});

// ---------------------------------------------------------------------------
// The baseline records a pantry row as a MERGED entity
// ---------------------------------------------------------------------------

describe('baselineFromPayload and pantryItems', () => {
  it('records every row in perEntity, and no pantry ids in passThrough', () => {
    const baseline = baselineFromPayload(stampedPayload([pantryItem('eggs')], { lamport: 4, deviceId: 'tablet' }));

    assert.deepEqual(Object.keys(baseline.perEntity), [pantryKey('eggs')]);
    assert.equal(baseline.perEntity[pantryKey('eggs')]?.lamport, 4);
    assert.deepEqual(baseline.passThrough, { savedMeals: [] }, 'the pantry never had a pass-through id list to lose');
  });
});

// ---------------------------------------------------------------------------
// The previous release: a payload with no pantry stamps removes nothing
// ---------------------------------------------------------------------------

describe('a payload written by 0.35.1, where the pantry was passed through', () => {
  it('never removes this device pantry rows, because it carries no tombstone for one', () => {
    const local = stampedPayload([pantryItem('eggs')], { lamport: 3, deviceId: 'phone' });
    const previousRelease: StampedSnapshot = { snapshot: snapshot([]), meta: { perEntity: {}, tombstones: [] } };

    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local,
      remote: previousRelease,
    });

    assert.deepEqual(merged.snapshot.pantryItems.map((entry) => entry.id), ['eggs']);
    assert.deepEqual(merged.meta.tombstones, []);
    assert.equal(merged.meta.perEntity[pantryKey('eggs')]?.lamport, 3, 'and this device re-publishes the stamp');
  });

  it('is adopted at stamp 0 when it DOES carry a shelf, so any real stamp outranks it', () => {
    const merged = mergeSnapshots({
      ...NOTHING_TO_ACCOUNT_FOR,
      integrity: HEALTHY_STORAGE,
      local: payload([]),
      remote: payload([pantryItem('written-by-the-old-build')]),
    });

    assert.deepEqual(merged.snapshot.pantryItems.map((entry) => entry.id), ['written-by-the-old-build']);
    assert.equal(merged.meta.perEntity[pantryKey('written-by-the-old-build')]?.lamport, 0);
  });
});
