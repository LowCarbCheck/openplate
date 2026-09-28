/**
 * THE MIGRATION, and it is one field wide.
 *
 * The baseline grew a record of what the pass-through collections held
 * (`SyncBaseline.passThrough`), and every baseline already sitting in somebody's
 * `localStorage` was written without it. The field is therefore OPTIONAL, and
 * `STATE_FORMAT_VERSION` did not move.
 *
 * Both halves of that are load-bearing and neither is obvious:
 *
 *  - a REQUIRED field would fail the whole parse, and `parseSyncState` is
 *    deliberately fail-soft, so the device would silently fall back to an empty
 *    state. That costs a full re-push, and worse, it throws away the tombstones
 *    the baseline carries, which are what keep other devices' deletes buried;
 *  - a version BUMP would do the same thing on purpose.
 *
 * An absent record is not an empty one. `mergeSnapshots` reads it as "this
 * device wrote down nothing about its saved meals", hands that one cycle to
 * the account's list, and the baseline it commits carries the ids.
 *
 * ── THE SECOND MIGRATION, and it goes the other way (M240/01, ADR-0014) ──
 *
 * The record used to carry a `fasts` list beside the saved meals. A fast is a
 * merged entity now, so its ids live in `baseline.perEntity` with a stamp and
 * a content hash, and the bare list says strictly less than that. The schema
 * no longer names the key, and zod STRIPS it: a state written by 0.35.1 or
 * older must still parse whole, because discarding it is the fail-soft cost
 * the whole file exists to avoid. `STATE_FORMAT_VERSION` did not move for that
 * either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptySyncState, parseSyncState } from '../../app/lib/sync/sync-state';

/** A state string exactly as a build before this field wrote one: a baseline, and no `passThrough` key. */
const STATE_WITHOUT_THE_FIELD = JSON.stringify({
  formatVersion: 1,
  lastBlobVersion: 7,
  lastSyncedAt: 1_770_000_000_000,
  baseline: {
    perEntity: { 'foodLog:a': { lamport: 3, deviceId: 'device-yesterday', hash: 'abc' } },
    tombstones: [{ lamport: 2, deviceId: 'device-yesterday', entityId: 'b', entityType: 'foodLog' }],
  },
});

test('a baseline written before the pass-through ids existed still parses, whole', () => {
  const parsed = parseSyncState(STATE_WITHOUT_THE_FIELD);

  // NON-VACUITY: this really is the fail-soft path's other outcome. A rejected
  // parse returns `emptySyncState()`, so a test that only looked at
  // `passThrough` being undefined would pass just as happily against a discard.
  assert.notDeepEqual(parsed, emptySyncState(), 'the old state must be kept, not discarded and rebuilt');
  assert.equal(parsed.lastBlobVersion, 7);
  assert.deepEqual(Object.keys(parsed.baseline.perEntity), ['foodLog:a']);
  assert.equal(parsed.baseline.tombstones.length, 1, 'and the tombstones must survive, or buried entries come back');
  assert.equal(parsed.baseline.passThrough, undefined, 'with nothing invented for the collections it never recorded');
});

test('a baseline that carries the ids parses them through unchanged', () => {
  const parsed = parseSyncState(
    JSON.stringify({
      formatVersion: 1,
      lastBlobVersion: 8,
      lastSyncedAt: 1_770_000_000_000,
      baseline: { perEntity: {}, tombstones: [], passThrough: { savedMeals: ['meal-one', 'meal-two'] } },
    }),
  );

  assert.deepEqual(parsed.baseline.passThrough, { savedMeals: ['meal-one', 'meal-two'] });
});

test('a 0.35.1 state that still carries a fasts list parses whole, and the list is dropped', () => {
  // The upgrade path, and the direction it must NOT fail in. A schema that
  // rejected the extra key would discard the baseline and the tombstones with
  // it, which is the fail-soft cost the first test in this file is about.
  const parsed = parseSyncState(
    JSON.stringify({
      formatVersion: 1,
      lastBlobVersion: 9,
      lastSyncedAt: 1_770_000_000_000,
      baseline: {
        perEntity: { 'foodLog:a': { lamport: 3, deviceId: 'device-yesterday', hash: 'abc' } },
        tombstones: [{ lamport: 2, deviceId: 'device-yesterday', entityId: 'b', entityType: 'foodLog' }],
        passThrough: { fasts: ['fast-one'], savedMeals: ['meal-one'] },
      },
    }),
  );

  assert.notDeepEqual(parsed, emptySyncState(), 'a state written by the previous release must be kept, not rebuilt');
  assert.equal(parsed.baseline.tombstones.length, 1, 'or buried entries come back on the next pull');
  assert.deepEqual(
    parsed.baseline.passThrough,
    { savedMeals: ['meal-one'] },
    'the stale fast ids are dropped, because `perEntity` carries every fast now',
  );
});

test('a device that has never synced records nothing, which is not the same as an empty list', () => {
  assert.equal(emptySyncState().baseline.passThrough, undefined);
});
