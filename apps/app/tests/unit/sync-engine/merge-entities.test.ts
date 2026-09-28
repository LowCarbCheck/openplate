import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  liveCandidate,
  mergeEntityMaps,
  nextLamport,
  pickMergeWinner,
  selectCompactableTombstones,
  tombstoneCandidate,
} from '../../../app/lib/sync/engine/merge/merge-entities';
import type { MergeCandidate, Tombstone } from '../../../app/lib/sync/engine/merge/types';

test('pickMergeWinner: higher lamport wins', () => {
  const a: MergeCandidate<string> = { entityId: 'e1', lamport: 2, deviceId: 'device-a', value: 'a-value' };
  const b: MergeCandidate<string> = { entityId: 'e1', lamport: 5, deviceId: 'device-b', value: 'b-value' };
  assert.equal(pickMergeWinner(a, b), b);
  assert.equal(pickMergeWinner(b, a), b);
});

test('pickMergeWinner: tie breaks on deviceId (stable, never wall-clock)', () => {
  const a: MergeCandidate<string> = { entityId: 'e1', lamport: 3, deviceId: 'device-a', value: 'a-value' };
  const b: MergeCandidate<string> = { entityId: 'e1', lamport: 3, deviceId: 'device-z', value: 'z-value' };
  // 'device-z' > 'device-a' lexicographically — same result regardless of argument order.
  assert.equal(pickMergeWinner(a, b), b);
  assert.equal(pickMergeWinner(b, a), b);
});

test('mergeEntityMaps: an entity present on only one side passes through unchanged', () => {
  const local = { e1: liveCandidate('e1', { lamport: 1, deviceId: 'a' }, 'local-only') };
  const remote = { e2: liveCandidate('e2', { lamport: 1, deviceId: 'b' }, 'remote-only') };
  const merged = mergeEntityMaps(local, remote);
  assert.equal(merged.e1?.value, 'local-only');
  assert.equal(merged.e2?.value, 'remote-only');
});

test('mergeEntityMaps: a shared entity id resolves via pickMergeWinner', () => {
  const local = { e1: liveCandidate('e1', { lamport: 1, deviceId: 'a' }, 'stale-local') };
  const remote = { e1: liveCandidate('e1', { lamport: 4, deviceId: 'b' }, 'fresh-remote') };
  const merged = mergeEntityMaps(local, remote);
  assert.equal(merged.e1?.value, 'fresh-remote');
});

test('a tombstone can beat a concurrent live edit deterministically (same lamport rule)', () => {
  const tombstone: Tombstone = { entityId: 'e1', entityType: 'foodLog', lamport: 5, deviceId: 'device-b' };
  const liveEdit = liveCandidate('e1', { lamport: 3, deviceId: 'device-a' }, { name: 'still alive, but older' });
  const merged = mergeEntityMaps({ e1: liveEdit }, { e1: tombstoneCandidate(tombstone) });
  assert.equal(merged.e1?.value, null); // the tombstone (higher lamport) wins — the entity is deleted.
});

test('nextLamport is max(seen) + 1', () => {
  assert.equal(nextLamport([]), 1);
  assert.equal(nextLamport([3]), 4);
  assert.equal(nextLamport([1, 5, 2]), 6);
});

test('selectCompactableTombstones drops only tombstones older than the retention window', () => {
  const now = Date.UTC(2026, 0, 100); // arbitrary fixed "now"
  const oneDayMs = 24 * 60 * 60 * 1000;
  const tombstones: Tombstone[] = [
    { entityId: 'old', entityType: 'foodLog', lamport: 1, deviceId: 'a' },
    { entityId: 'recent', entityType: 'foodLog', lamport: 2, deviceId: 'a' },
  ];
  const createdAtByEntity = new Map([
    ['old', now - 100 * oneDayMs],
    ['recent', now - 5 * oneDayMs],
  ]);

  const compactable = selectCompactableTombstones({
    tombstones,
    nowMs: now,
    createdAtMs: (t) => createdAtByEntity.get(t.entityId) ?? now,
    retentionDays: 90,
  });

  assert.deepEqual(
    compactable.map((t) => t.entityId),
    ['old'],
  );
});
