/**
 * The operator's label on the console's side: what the decoder accepts, what a
 * save sends, and that a core without the field still works.
 *
 * EVERY ASSERTION HAS A CONTROL. An older core's body with no `label` key is
 * the control for the decode, and an unchanged field is the control for the
 * save, so a decoder that demanded the key or a form that always sent it fails
 * here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ACCOUNT_LABEL_LENGTH, changedAccountLabel, readAccountLabel } from '../../app/lib/admin/account-label';
import { accountListSchema, accountResponseSchema, accountViewSchema } from '../../app/lib/admin/admin-wire';

/** An account as a core built before labels sends it: every field but `label`. */
const OLDER_CORE_ACCOUNT = {
  id: 7,
  email: 'anna@example.org',
  displayName: null,
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 3,
  allowanceExpiresAt: null,
  suspendedAt: null,
  invitesLeft: null,
  trialScans: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  lastSeenAt: null,
};

test('the bound is the core’s 40', () => {
  assert.equal(MAX_ACCOUNT_LABEL_LENGTH, 40);
});

test('a label the core sends is decoded as it came', () => {
  const parsed = accountViewSchema.parse({ ...OLDER_CORE_ACCOUNT, label: 'Beta supporter' });
  assert.equal(parsed.label, 'Beta supporter');
});

test('an older core with no label key still decodes, as no label, in the list and in the detail', () => {
  assert.equal(accountViewSchema.parse(OLDER_CORE_ACCOUNT).label, null);
  assert.equal(accountResponseSchema.parse({ account: OLDER_CORE_ACCOUNT }).account.label, null);
  assert.deepEqual(
    accountListSchema.parse({ accounts: [OLDER_CORE_ACCOUNT], total: 1 }).accounts.map((account) => account.label),
    [null],
  );
});

test('a null label and a malformed one both read as none, and the rest of the account survives', () => {
  assert.equal(accountViewSchema.parse({ ...OLDER_CORE_ACCOUNT, label: null }).label, null);
  const malformed = accountViewSchema.parse({ ...OLDER_CORE_ACCOUNT, label: 42 });
  assert.equal(malformed.label, null);
  assert.equal(malformed.aiUsedToday, 3, 'one odd field does not cost the page the account');
});

test('a typed label is sent trimmed, and a blank one takes the label away', () => {
  assert.equal(readAccountLabel('  Beta supporter '), 'Beta supporter');
  assert.equal(readAccountLabel('   '), null);
  assert.equal(readAccountLabel(''), null);
});

test('a save sends the label only when it changed', () => {
  // Changed: set, replaced, and taken away.
  assert.equal(changedAccountLabel({ typed: 'Beta supporter', current: null }), 'Beta supporter');
  assert.equal(changedAccountLabel({ typed: 'Early tester', current: 'Beta supporter' }), 'Early tester');
  assert.equal(changedAccountLabel({ typed: '  ', current: 'Beta supporter' }), null);

  // THE CONTROL: unchanged is not sent, including a field left empty on an
  // account with no label and a label that differs only by padding.
  assert.equal(changedAccountLabel({ typed: '', current: null }), undefined);
  assert.equal(changedAccountLabel({ typed: 'Beta supporter', current: 'Beta supporter' }), undefined);
  assert.equal(changedAccountLabel({ typed: ' Beta supporter ', current: 'Beta supporter' }), undefined);
});
