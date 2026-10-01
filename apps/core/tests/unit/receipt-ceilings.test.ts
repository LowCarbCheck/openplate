/**
 * `legal/receipt-ceilings.ts` (M270/11): the rule that picks between the three
 * daily receipt ceilings, and the in-memory per-network ledger.
 *
 * `tests/integration/legal-declarations.test.ts` proves both wired into the
 * real route, against Postgres. This file proves the edges with an explicit
 * clock: a count equal to its cap still sends, the narrowest ceiling is named,
 * the ledger's window trails, and a busy network costs a bounded array.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkReceiptLedger, decideReceipt, RECEIPT_WINDOW_MS } from '../../src/legal/receipt-ceilings.js';

const UNDER = { count: 1, cap: 10 };

test('a receipt goes out while every count is at or under its cap', () => {
  assert.deepEqual(decideReceipt({ address: UNDER, network: UNDER, instance: UNDER }), { kind: 'send' });
  // A count EQUAL to the cap still sends: a cap of 3 means three receipts.
  assert.deepEqual(
    decideReceipt({
      address: { count: 3, cap: 3 },
      network: { count: 10, cap: 10 },
      instance: { count: 200, cap: 200 },
    }),
    { kind: 'send' },
  );
});

test('each ceiling alone skips the receipt once its count passes the cap, and names itself', () => {
  assert.deepEqual(decideReceipt({ address: { count: 4, cap: 3 }, network: UNDER, instance: UNDER }), {
    kind: 'skip',
    ceiling: 'address',
    cap: 3,
  });
  assert.deepEqual(decideReceipt({ address: UNDER, network: { count: 11, cap: 10 }, instance: UNDER }), {
    kind: 'skip',
    ceiling: 'network',
    cap: 10,
  });
  assert.deepEqual(decideReceipt({ address: UNDER, network: UNDER, instance: { count: 201, cap: 200 } }), {
    kind: 'skip',
    ceiling: 'instance',
    cap: 200,
  });
});

test('with several ceilings passed, the narrowest is the one named', () => {
  const over = { count: 99, cap: 1 };
  assert.equal(decideReceipt({ address: over, network: over, instance: over }).kind, 'skip');
  assert.deepEqual(decideReceipt({ address: over, network: over, instance: over }), {
    kind: 'skip',
    ceiling: 'address',
    cap: 1,
  });
  assert.deepEqual(decideReceipt({ address: UNDER, network: over, instance: over }), {
    kind: 'skip',
    ceiling: 'network',
    cap: 1,
  });
});

test('the ledger counts per network, this declaration included', () => {
  const ledger = createNetworkReceiptLedger({ cap: 10 });
  assert.equal(ledger.record({ network: '2001:db8:1:2::/64', atMs: 1_000 }), 1);
  assert.equal(ledger.record({ network: '2001:db8:1:2::/64', atMs: 2_000 }), 2);
  // CONTROL: another network starts at one.
  assert.equal(ledger.record({ network: '198.51.100.7', atMs: 3_000 }), 1);
  assert.equal(ledger.record({ network: '2001:db8:1:2::/64', atMs: 4_000 }), 3);
});

test('the ledger window trails: a declaration ages out exactly one window later', () => {
  const ledger = createNetworkReceiptLedger({ cap: 10 });
  ledger.record({ network: 'n', atMs: 0 });
  ledger.record({ network: 'n', atMs: 1_000 });
  // At exactly one window after the first, the first is out and the second is in.
  assert.equal(ledger.record({ network: 'n', atMs: RECEIPT_WINDOW_MS }), 2);
  assert.equal(ledger.record({ network: 'n', atMs: RECEIPT_WINDOW_MS + 1_001 }), 2);
});

test('a busy network keeps at most cap plus one timestamps, and still reads as over', () => {
  const ledger = createNetworkReceiptLedger({ cap: 3 });
  const counts = Array.from({ length: 50 }, (_, index) => ledger.record({ network: 'n', atMs: index }));
  assert.deepEqual(counts.slice(0, 5), [1, 2, 3, 4, 4]);
  assert.equal(counts.at(-1), 4, 'past the cap the count stops at cap plus one, which is still over it');
  assert.equal(
    decideReceipt({ address: UNDER, network: { count: counts.at(-1) ?? 0, cap: 3 }, instance: UNDER }).kind,
    'skip',
  );
});

test('a network idle for a whole window is forgotten by the sweep and starts again at one', () => {
  const ledger = createNetworkReceiptLedger({ cap: 3, windowMs: 10_000 });
  for (let index = 0; index < 5; index += 1) ledger.record({ network: 'quiet', atMs: index });
  // An hour and more later, another network's call runs the sweep.
  ledger.record({ network: 'other', atMs: 2 * 60 * 60 * 1000 });
  assert.equal(ledger.record({ network: 'quiet', atMs: 2 * 60 * 60 * 1000 + 1 }), 1);
});
