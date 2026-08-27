/**
 * The fasting/sync boundary (M132): `mergeSnapshots` must leave `fasts`
 * EXACTLY as the local device holds them, no matter what the remote payload
 * says.
 *
 * Fasts are deliberately absent from `SYNC_ENTITY_TYPES` and `flattenSnapshot`,
 * so they are never stamped, diffed, tombstoned or adopted. That is a scope
 * boundary, not an oversight — "at most one open fast" across two devices is a
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
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots, SYNC_ENTITY_TYPES, stampSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalFast, LocalStoreSnapshot } from '../../app/lib/local-store/schema';

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

function snapshot(fasts: LocalFast[]): LocalStoreSnapshot {
  // `savedMeals` rides through the same pass-through path as `fasts` (see
  // `snapshot-sync.ts`) — an empty array here is enough, since this file's
  // assertions are all about `fasts`, not saved meals.
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts,
    savedMeals: [],
    shareIdentity: null,
    sharePeers: [],
  };
}

function payload(fasts: LocalFast[]): StampedSnapshot {
  return { snapshot: snapshot(fasts), meta: { perEntity: {}, tombstones: [] } };
}

describe('mergeSnapshots and fasts', () => {
  it('keeps the local fasts when the remote payload has none', () => {
    const local = payload([fast('mine')]);

    const merged = mergeSnapshots({ local, remote: payload([]) });

    assert.deepEqual(merged.snapshot.fasts, [fast('mine')]);
  });

  it('ignores the remote fasts entirely — nothing is adopted across devices', () => {
    const local = payload([fast('mine')]);
    const remote = payload([fast('theirs', { id: 'theirs', startedAt: T + HOUR })]);

    const merged = mergeSnapshots({ local, remote });

    assert.deepEqual(
      merged.snapshot.fasts.map((entry) => entry.id),
      ['mine'],
      "a peer's fast must never appear on this device",
    );
  });

  it('keeps an empty local list empty even when the remote is full', () => {
    const merged = mergeSnapshots({ local: payload([]), remote: payload([fast('theirs')]) });

    assert.deepEqual(merged.snapshot.fasts, []);
  });

  it('is stable under repeated merges — no drift, no accumulation', () => {
    const local = payload([fast('mine'), fast('older', { id: 'older', endedAt: T + 9 * HOUR })]);
    const remote = payload([fast('theirs')]);

    const once = mergeSnapshots({ local, remote });
    const twice = mergeSnapshots({ local: once, remote });

    assert.deepEqual(twice.snapshot.fasts, local.snapshot.fasts);
  });

  it('never stamps or tombstones a fast — no fast id reaches the wire meta', () => {
    // `flattenSnapshot` is private, so this asserts the observable consequence:
    // stamping a snapshot that holds a fast produces no entity key for it, and
    // deleting it later therefore produces no tombstone either.
    const stamped = stampSnapshot({
      snapshot: snapshot([fast('mine')]),
      baseline: { perEntity: {}, tombstones: [] },
      deviceId: 'device-a',
    });

    assert.deepEqual(Object.keys(stamped.meta.perEntity), []);
    assert.deepEqual(stamped.meta.tombstones, []);

    const afterDelete = stampSnapshot({
      snapshot: snapshot([]),
      baseline: stamped.baseline,
      deviceId: 'device-a',
    });

    assert.deepEqual(afterDelete.meta.tombstones, [], 'a removed fast must not produce a tombstone');
  });

  it('keeps fasts out of the synced entity-type catalog', () => {
    assert.deepEqual(Object.values(SYNC_ENTITY_TYPES), [
      'personalFood',
      'foodLog',
      'weightEntry',
      'profile',
      'shareIdentity',
      'sharePeer',
    ]);
  });
});
