/**
 * The device locks: one task at a time, per name.
 *
 * ── Why a second lock got a test ─────────────────────────────────────────
 *
 * Until M201 there was one lock in this module and one fallback chain beside
 * it. The token lock (M201, the 0.10.3 silent sign-out) is the second, and it
 * is reachable from INSIDE the first: a sync cycle holds the orchestrator lock,
 * an HTTP 401 sends the auth client through a refresh, and the refresh takes
 * the token lock. Sharing one chain between the two names would have made that
 * a deadlock on every browser without the Web Locks API, and `node:test` is one
 * of them, so the interleaving below is the check, not the API surface.
 *
 * There is no `navigator.locks` here, so every test in this file exercises the
 * FALLBACK path. That is the path that can deadlock; the Web Locks path is the
 * browser's problem and it already keeps names apart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDeviceLock, withSyncOrchestratorLock } from '../../app/lib/sync/sync-lock';

/** Resolves on demand, so a test can hold a lock open and watch what the other caller does. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

test('createDeviceLock runs two tasks under one name strictly in turn', async () => {
  const lock = createDeviceLock('openplate-test-lock');
  const order: string[] = [];
  const first = gate();

  const a = lock(async () => {
    order.push('a:start');
    await first.wait;
    order.push('a:end');
  });
  const b = lock(async () => {
    order.push('b:start');
    order.push('b:end');
  });

  // B must not have started: A is still holding the lock open.
  assert.deepEqual(order, ['a:start'], 'the second task must wait for the first to finish');
  first.open();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('a failed task does not poison the lock for every later one', async () => {
  const lock = createDeviceLock('openplate-test-lock-failures');
  await assert.rejects(
    lock(async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(await lock(async () => 'after'), 'after');
});

test('two names do not wait for each other, the deadlock a shared chain would make', async () => {
  const outer = createDeviceLock('openplate-test-outer');
  const inner = createDeviceLock('openplate-test-inner');

  // The shape of a sync cycle whose 401 sends the auth client through a
  // refresh: the inner lock is taken while the outer one is still held.
  const result = await outer(async () => inner(async () => 'reached'));

  assert.equal(result, 'reached');
});

test('the orchestrator lock still serializes', async () => {
  const order: string[] = [];
  const first = gate();

  const a = withSyncOrchestratorLock(async () => {
    order.push('a:start');
    await first.wait;
    order.push('a:end');
  });
  const b = withSyncOrchestratorLock(async () => {
    order.push('b:start');
  });

  assert.deepEqual(order, ['a:start']);
  first.open();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start']);
});
