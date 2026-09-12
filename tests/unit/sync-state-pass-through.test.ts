/**
 * THE MIGRATION, and it is one field wide.
 *
 * The baseline grew a record of what the two pass-through collections held
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
 * device wrote down nothing about its fasts and saved meals", hands that one
 * cycle to the account's lists, and the baseline it commits carries the ids.
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
      baseline: {
        perEntity: {},
        tombstones: [],
        passThrough: { fasts: ['fast-one'], savedMeals: ['meal-one', 'meal-two'] },
      },
    }),
  );

  assert.deepEqual(parsed.baseline.passThrough, {
    fasts: ['fast-one'],
    savedMeals: ['meal-one', 'meal-two'],
  });
});

test('a device that has never synced records nothing, which is not the same as an empty list', () => {
  assert.equal(emptySyncState().baseline.passThrough, undefined);
});
