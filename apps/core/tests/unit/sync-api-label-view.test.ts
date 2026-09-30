/**
 * `sync-api` prints the operator's label, and an instance older than the
 * field still prints an account.
 *
 * THE CONTROL IS THE OLDER BODY. The same account without a `label` key must
 * decode and print "none", so a decoder that demanded the key, or one that
 * printed a label it was never sent, fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonObject } from '../../src/lib/json.js';
import {
  decodeAccountPage,
  decodeSingleAccount,
  formatAccountDetail,
  formatAccountTable,
} from '../../scripts/sync-api/views.js';

/** An account body as `GET /v1/admin/accounts/:id` sends it, before the label existed. */
function olderAccount(id: number): JsonObject {
  return {
    id,
    email: `person-${id}@example.org`,
    displayName: null,
    role: 'member',
    dailyAiLimit: 0,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    trialScans: null,
    suspendedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    blob: null,
    keyRecordKinds: [],
  };
}

test('a labelled account prints its label in the detail and at the end of its row', () => {
  const account = decodeSingleAccount({ account: { ...olderAccount(7), label: 'Beta supporter' } });
  assert.equal(account.label, 'Beta supporter');
  assert.match(formatAccountDetail(account), /^label {11}Beta supporter$/m);

  const table = formatAccountTable(
    decodeAccountPage({ accounts: [{ ...olderAccount(7), label: 'Beta supporter' }, olderAccount(8)], total: 2 }),
  );
  const [header, labelled, plain] = table.split('\n');
  assert.match(header ?? '', /STANDING +LABEL$/);
  assert.match(labelled ?? '', /active +Beta supporter$/);
  assert.match(plain ?? '', /active$/);
});

test('an older instance with no label key still decodes, and prints none', () => {
  const account = decodeSingleAccount({ account: olderAccount(9) });
  assert.equal(account.label, null);
  assert.match(formatAccountDetail(account), /^label {11}none$/m);
});

test('the detail prints the standing free grant, and none for an older instance', () => {
  const granted = decodeSingleAccount({ account: { ...olderAccount(10), freeDailyAiLimit: 10 } });
  assert.match(formatAccountDetail(granted), /^free ai a day {3}10$/m);
  // THE CONTROL: the body from before the field reads as no free grant.
  assert.match(formatAccountDetail(decodeSingleAccount({ account: olderAccount(11) })), /^free ai a day {3}none$/m);
});
