/**
 * The pure half of the per-network trial share (M270 spec 12): the default
 * bound, and the keyed name a network's counter row carries. The statements
 * and the proxy are proven in `tests/integration/trial-network-share.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrialNetworkHasher, defaultTrialNetworkDailyLimit } from '../../src/ai/trial-network.js';
import { rateLimitKeyForIp } from '../../src/lib/client-address.js';

const PEPPER = 'a-trial-address-pepper-that-is-long-enough-0123';
const DAY = '2026-10-01';

test('the default share is a tenth of the trial ceiling, rounded down, and at least one unit', () => {
  assert.equal(defaultTrialNetworkDailyLimit(1000), 100);
  assert.equal(defaultTrialNetworkDailyLimit(1009), 100);
  assert.equal(defaultTrialNetworkDailyLimit(20), 2);
  assert.equal(defaultTrialNetworkDailyLimit(19), 1);
  assert.equal(defaultTrialNetworkDailyLimit(1), 1);
});

test('two addresses in one /64 get one name, and the next /64 another', () => {
  const hash = createTrialNetworkHasher(PEPPER);
  const named = (address: string): string => hash({ networkKey: rateLimitKeyForIp(address), day: DAY });
  assert.equal(named('2001:db8:1:2::1'), named('2001:db8:1:2:ffff:ffff:ffff:9'));
  // THE CONTROL.
  assert.notEqual(named('2001:db8:1:2::1'), named('2001:db8:1:3::1'));
});

test('the name is a keyed hash: no address in it, another day or another pepper is another name', () => {
  const hash = createTrialNetworkHasher(PEPPER);
  const today = hash({ networkKey: '203.0.113.7', day: DAY });
  assert.match(today, /^[0-9a-f]{64}$/);
  assert.ok(!today.includes('203.0.113.7'));
  assert.equal(hash({ networkKey: '203.0.113.7', day: DAY }), today, 'the same network on the same day');
  assert.notEqual(hash({ networkKey: '203.0.113.7', day: '2026-10-02' }), today, 'the next day cannot be linked');
  assert.notEqual(hash({ networkKey: '203.0.113.8', day: DAY }), today);
  assert.notEqual(createTrialNetworkHasher(`${PEPPER}x`)({ networkKey: '203.0.113.7', day: DAY }), today);
});
