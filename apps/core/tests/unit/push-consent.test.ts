/**
 * The push tick sends nothing to an account that does not hold the instance's
 * current consent to health data (owner decision, 2026-09-29).
 *
 * WHY THE SCHEDULER AND NOT ONLY THE ROUTES. `requireHealthConsent` refuses a
 * new subscription to such an account, but a subscription registered before
 * the instance asked, or before its wording changed, is already in the table,
 * and the minute tick reads the table rather than a route. A catch-up says
 * what the person logged today and a fast alert says when their fast ends:
 * both are health data, sent on the operator's behalf.
 *
 * EVERY REFUSAL HAS A TWIN in the same tick: an account that holds the
 * version still gets its push, so a scheduler that stopped sending to
 * everybody fails as surely as one that sent to everybody.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPushTick } from '../../src/push/push-scheduler.js';
import { createSilentLogger } from '../../src/logger.js';
import type { InstanceHealthConsent } from '../../src/protocol.js';
import { createFakePushStore, type FakePushStore } from './fake-push-store.js';

/** A fixed zone with no changeover near the instant below. */
const ZONE = 'Europe/Berlin';
/** 09:00 Berlin in winter, past the 08:00 catch-up minute. */
const MORNING = new Date('2026-01-15T08:00:00Z');
const TODAY = '2026-01-15';
const EIGHT_AM = 8 * 60;
const VERSION = '2026-09-28';

/**
 * Three accounts with a catch-up due at this minute and one fast alert due:
 * one agreed to the current wording, one never agreed, one agreed to an older
 * wording. Each account's consent is set on the account, not on the device.
 */
function seedThreeAccounts(): FakePushStore {
  const store = createFakePushStore();
  const accounts = [
    { accountId: 1, name: 'agreed', version: VERSION },
    { accountId: 2, name: 'never-agreed', version: null },
    { accountId: 3, name: 'older-wording', version: '2026-01-01' },
  ];
  for (const account of accounts) {
    store.seed({
      endpoint: `https://push.example.org/${account.name}`,
      accountId: account.accountId,
      timeZone: ZONE,
      catchUpMinute: EIGHT_AM,
      lastSeenDay: TODAY,
    });
    // The second kind, so the rule is shown to be about the account and not about the catch-up.
    store.seed({
      endpoint: `https://push.example.org/${account.name}/fast`,
      accountId: account.accountId,
      timeZone: ZONE,
      fastTargetEnabled: true,
      wakeAt: new Date(MORNING.getTime() - 60_000),
      lastSeenDay: TODAY,
    });
    store.setAccountConsent({ accountId: account.accountId, version: account.version });
  }
  return store;
}

/** Runs one tick and answers the endpoints the sender was asked for, in order. */
async function endpointsSent(input: {
  store: FakePushStore;
  healthConsent: InstanceHealthConsent | null;
}): Promise<string[]> {
  const sent: string[] = [];
  await runPushTick({
    store: input.store,
    sender: async (subscription) => {
      sent.push(subscription.endpoint);
    },
    logger: createSilentLogger(),
    now: () => MORNING,
    healthConsent: input.healthConsent,
  });
  return sent.toSorted();
}

test('an instance that asks for a consent pushes only to the account that holds its current version', async () => {
  const store = seedThreeAccounts();
  assert.deepEqual(await endpointsSent({ store, healthConsent: { version: VERSION } }), [
    'https://push.example.org/agreed',
    'https://push.example.org/agreed/fast',
  ]);
});

test('a withheld push writes no mark, so it goes out once the person agrees', async () => {
  const store = seedThreeAccounts();
  await endpointsSent({ store, healthConsent: { version: VERSION } });
  // NOT MARKED AS SENT: the row still says the catch-up has not gone out today.
  assert.equal(store.rows.get('https://push.example.org/never-agreed')?.lastCatchUpDay, null);
  assert.notEqual(store.rows.get('https://push.example.org/never-agreed/fast')?.wakeAt, null);

  store.setAccountConsent({ accountId: 2, version: VERSION });
  assert.deepEqual(await endpointsSent({ store, healthConsent: { version: VERSION } }), [
    'https://push.example.org/never-agreed',
    'https://push.example.org/never-agreed/fast',
  ]);
});

test('the twin: an instance that asks for no consent pushes to every account, as before', async () => {
  const store = seedThreeAccounts();
  assert.deepEqual(await endpointsSent({ store, healthConsent: null }), [
    'https://push.example.org/agreed',
    'https://push.example.org/agreed/fast',
    'https://push.example.org/never-agreed',
    'https://push.example.org/never-agreed/fast',
    'https://push.example.org/older-wording',
    'https://push.example.org/older-wording/fast',
  ]);
});
