/**
 * Throttle decisions, including the two properties that keep it from becoming
 * a weapon: buckets are per-IP-and-account (so nobody can lock a victim out
 * from elsewhere), and the store cannot be grown without bound by cycling
 * fake keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail } from '../../src/lib/verifier.js';
import {
  DEFAULT_THROTTLE_CONFIG,
  accountThrottleKey,
  MAX_THROTTLE_ENTRIES,
  createThrottleStore,
  evaluateThrottle,
  findOverflowKeys,
  findStaleKeys,
  isEntryStale,
  registerFailure,
  shouldSweep,
  throttleKey,
} from '../../src/lib/throttle.js';

const NOW = 1_000_000;

test('throttleKey separates namespaces, IPs and identifiers', () => {
  assert.notEqual(
    throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: 'a@b.test' }),
    throttleKey({ namespace: 'signup', ip: '1.1.1.1', identifier: 'a@b.test' }),
  );
  // The anti-lockout property: the same victim from a different IP is a
  // different bucket.
  assert.notEqual(
    throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: 'a@b.test' }),
    throttleKey({ namespace: 'login', ip: '2.2.2.2', identifier: 'a@b.test' }),
  );
  assert.equal(
    throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: ' A@B.TEST ' }),
    throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: 'a@b.test' }),
  );
});

test('throttleKey folds an identifier exactly as the account lookup does, NFKC included', () => {
  // Fullwidth Latin reaches the same account through `normalizeEmail`, so it
  // must reach the same bucket. A trim and a lowercase alone gave it its own.
  assert.equal(
    throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: '\uFF41nna@example.org' }),
    throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: 'anna@example.org' }),
  );
  assert.equal(normalizeEmail('\uFF41nna@example.org'), 'anna@example.org');
});

test('accountThrottleKey separates accounts and namespaces, and ignores the address', () => {
  assert.notEqual(
    accountThrottleKey({ namespace: 'passphrase', accountId: 1 }),
    accountThrottleKey({ namespace: 'passphrase', accountId: 2 }),
  );
  assert.notEqual(
    accountThrottleKey({ namespace: 'passphrase', accountId: 1 }),
    accountThrottleKey({ namespace: 'login', accountId: 1 }),
  );
});

test('the free allowance is exhausted before any lockout', () => {
  let record = registerFailure(undefined, NOW);
  for (let attempt = 2; attempt <= DEFAULT_THROTTLE_CONFIG.freeAttempts; attempt += 1) {
    record = registerFailure(record, NOW);
  }
  assert.equal(evaluateThrottle(record, NOW).locked, false);

  record = registerFailure(record, NOW);
  const decision = evaluateThrottle(record, NOW);
  assert.equal(decision.locked, true);
  assert.equal(decision.retryAfterMs, DEFAULT_THROTTLE_CONFIG.baseLockoutMs);
});

test('lockouts grow exponentially and stop at the ceiling', () => {
  let record = registerFailure(undefined, NOW);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    record = registerFailure(record, NOW);
  }
  assert.equal(evaluateThrottle(record, NOW).retryAfterMs, DEFAULT_THROTTLE_CONFIG.maxLockoutMs);
});

test('an idle bucket restarts its failure count', () => {
  const old = registerFailure(undefined, NOW);
  const later = NOW + DEFAULT_THROTTLE_CONFIG.attemptResetMs + 1;
  assert.equal(registerFailure(old, later).failures, 1);
});

test('a lock lifts once its instant passes', () => {
  let record = registerFailure(undefined, NOW);
  for (let attempt = 0; attempt < DEFAULT_THROTTLE_CONFIG.freeAttempts; attempt += 1) {
    record = registerFailure(record, NOW);
  }
  assert.equal(evaluateThrottle(record, NOW).locked, true);
  assert.equal(evaluateThrottle(record, NOW + DEFAULT_THROTTLE_CONFIG.baseLockoutMs).locked, false);
});

test('stale entries are droppable and overflow eviction is oldest-first', () => {
  const stale = { failures: 1, lastFailureAt: NOW - DEFAULT_THROTTLE_CONFIG.attemptResetMs - 1, lockedUntil: null };
  const fresh = { failures: 1, lastFailureAt: NOW, lockedUntil: null };
  assert.equal(isEntryStale(stale, NOW, DEFAULT_THROTTLE_CONFIG), true);
  assert.equal(isEntryStale(fresh, NOW, DEFAULT_THROTTLE_CONFIG), false);
  assert.deepEqual(
    findStaleKeys(
      [
        ['stale', stale],
        ['fresh', fresh],
      ],
      NOW,
    ),
    ['stale'],
  );
  assert.deepEqual(
    findOverflowKeys({
      entries: [
        ['new', fresh],
        ['old', stale],
      ],
      maxEntries: 1,
      now: NOW,
    }),
    ['old'],
  );
  assert.deepEqual(findOverflowKeys({ entries: [['only', fresh]], maxEntries: MAX_THROTTLE_ENTRIES, now: NOW }), []);
});

test('overflow eviction never picks a locked entry, even the oldest one', () => {
  const locked = { failures: 9, lastFailureAt: NOW - 1000, lockedUntil: NOW + 60_000 };
  const older = { failures: 1, lastFailureAt: NOW - 500, lockedUntil: null };
  const newer = { failures: 1, lastFailureAt: NOW, lockedUntil: null };
  assert.deepEqual(
    findOverflowKeys({
      entries: [
        ['locked', locked],
        ['newer', newer],
        ['older', older],
      ],
      maxEntries: 1,
      now: NOW,
    }),
    ['older', 'newer'],
  );
  // Everything locked: nothing is evicted, and the store runs over its cap
  // until the locks lift.
  assert.deepEqual(findOverflowKeys({ entries: [['locked', locked]], maxEntries: 0, now: NOW }), []);
});

test('a flood of junk identifiers cannot clear a lock in the store', () => {
  const store = createThrottleStore();
  const victim = throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: 'anna@example.org' });
  for (let attempt = 0; attempt <= DEFAULT_THROTTLE_CONFIG.freeAttempts; attempt += 1) {
    store.recordFailure(victim, NOW);
  }
  assert.equal(store.check(victim, NOW).locked, true);

  // More junk buckets than the cap, every one of them newer than the lock.
  for (let index = 0; index < MAX_THROTTLE_ENTRIES + 5; index += 1) {
    store.recordFailure(throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: `junk${index}@x.test` }), NOW + 1);
  }
  assert.equal(store.check(victim, NOW + 2).locked, true);
});

test('shouldSweep is time-gated', () => {
  assert.equal(shouldSweep(NOW, NOW + 1, 1000), false);
  assert.equal(shouldSweep(NOW, NOW + 1000, 1000), true);
});

test('the store locks after repeated failures and clears on success', () => {
  const store = createThrottleStore();
  const key = throttleKey({ namespace: 'login', ip: '1.1.1.1', identifier: 'a@b.test' });

  for (let attempt = 0; attempt <= DEFAULT_THROTTLE_CONFIG.freeAttempts; attempt += 1) {
    store.recordFailure(key, NOW);
  }
  assert.equal(store.check(key, NOW).locked, true);

  store.clear(key);
  assert.equal(store.check(key, NOW).locked, false);
});
