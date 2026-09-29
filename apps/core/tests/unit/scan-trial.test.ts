/**
 * The scan trial's pure rules (M253): what the account view says, when the
 * gate applies, and the keyed mailbox hash. Since M267 also the clock: when a
 * trial with `TRIAL_DAYS` ends, and which of its two limits ended it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_ID_PATTERN,
  isScanGated,
  trialEndedBy,
  trialEndsAtFor,
  trialScansView,
} from '../../src/accounts/scan-trial.js';
import { createTrialAddressHasher } from '../../src/accounts/trial-address.js';

test('the view is granted and left, never negative, and null without a trial', () => {
  assert.deepEqual(trialScansView({ granted: 10, used: 3 }), { granted: 10, left: 7 });
  assert.deepEqual(trialScansView({ granted: 2, used: 5 }), { granted: 2, left: 0 });
  assert.equal(trialScansView({ granted: null, used: 0 }), null);
});

test('the gate applies to a trial with no date, and a date of any kind lifts it', () => {
  assert.equal(isScanGated({ trialScans: 10, allowanceExpiresAt: null }), true);
  // THE CONTROLS: a paid window, and no trial at all.
  assert.equal(isScanGated({ trialScans: 10, allowanceExpiresAt: new Date('2027-01-01T00:00:00Z') }), false);
  assert.equal(isScanGated({ trialScans: null, allowanceExpiresAt: null }), false);
});

test('an intake id is 16 to 64 URL-safe characters, so a UUID fits with or without dashes', () => {
  assert.equal(INTAKE_ID_PATTERN.test('2f9d0b416c3a4e579f10000000000001'), true);
  assert.equal(INTAKE_ID_PATTERN.test('2f9d0b41-6c3a-4e57-9f10-000000000001'), true);
  assert.equal(INTAKE_ID_PATTERN.test('short'), false);
  assert.equal(INTAKE_ID_PATTERN.test('x'.repeat(65)), false);
  assert.equal(INTAKE_ID_PATTERN.test('has spaces in it here'), false);
});

test('the mailbox hash is keyed, one-way, and shared by every spelling of one mailbox', () => {
  const hash = createTrialAddressHasher('a-pepper-that-is-long-enough-for-this-test');
  const other = createTrialAddressHasher('another-pepper-that-is-long-enough-for-it');
  assert.equal(hash('a.n.n.a+x@gmail.com'), hash('anna@gmail.com'));
  assert.match(hash('anna@gmail.com'), /^[0-9a-f]{64}$/);
  assert.equal(hash('anna@gmail.com').includes('anna'), false);
  // THE CONTROLS: another key gives another hash, and another mailbox too.
  assert.notEqual(other('anna@gmail.com'), hash('anna@gmail.com'));
  assert.notEqual(hash('bert@gmail.com'), hash('anna@gmail.com'));
});

// ── the clock (M267) ───────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CREATED = new Date('2026-10-01T15:00:00.000Z');

test('a new trial ends fourteen days after it starts, to the millisecond', () => {
  const endsAt = trialEndsAtFor({ startedAt: CREATED, days: 14 });
  assert.equal(endsAt?.toISOString(), '2026-10-15T15:00:00.000Z');
  assert.equal(endsAt?.getTime(), CREATED.getTime() + 14 * MS_PER_DAY);
});

test('an instance without TRIAL_DAYS, or an invite row written before it, starts a trial with no end date', () => {
  // THE CONTROL for the date above: no day count, no date. This is what every
  // account created before M267 keeps.
  assert.equal(trialEndsAtFor({ startedAt: CREATED, days: null }), null);
});

/** A scan trial with no allowance date, overridable per test. */
function trial(overrides: Partial<Parameters<typeof trialEndedBy>[0]> = {}): Parameters<typeof trialEndedBy>[0] {
  return {
    trialScans: 10,
    trialScansUsed: 3,
    trialEndsAt: new Date(CREATED.getTime() + 14 * MS_PER_DAY),
    allowanceExpiresAt: null,
    now: new Date(CREATED.getTime() + 2 * MS_PER_DAY),
    ...overrides,
  };
}

test('a trial with scans and days left has not ended', () => {
  assert.equal(trialEndedBy(trial()), null);
});

test('the days end the trial at its end date, and the boundary instant counts as ended', () => {
  const endsAt = new Date(CREATED.getTime() + 14 * MS_PER_DAY);
  assert.equal(trialEndedBy(trial({ now: new Date(endsAt.getTime() - 1) })), null, 'the last millisecond still works');
  assert.equal(trialEndedBy(trial({ now: endsAt })), 'days');
  assert.equal(trialEndedBy(trial({ now: new Date(endsAt.getTime() + MS_PER_DAY) })), 'days');
});

test('an account from before the day limit keeps its trial with no end date, however late it is', () => {
  const muchLater = new Date(CREATED.getTime() + 400 * MS_PER_DAY);
  assert.equal(trialEndedBy(trial({ trialEndsAt: null, now: muchLater })), null);
  // THE CONTROL: the same account, the same instant, with an end date, has ended.
  assert.equal(trialEndedBy(trial({ now: muchLater })), 'days');
});

test('used-up scans end the trial first, before the days are over and after', () => {
  assert.equal(trialEndedBy(trial({ trialScansUsed: 10 })), 'scans');
  // Both limits spent: the scans came first, because a trial past its date
  // is refused before it can spend another scan.
  const late = new Date(CREATED.getTime() + 20 * MS_PER_DAY);
  assert.equal(trialEndedBy(trial({ trialScansUsed: 10, now: late })), 'scans');
  // An operator lowering the grant below what was used reads as spent too.
  assert.equal(trialEndedBy(trial({ trialScans: 2, trialScansUsed: 3 })), 'scans');
});

test('a paid account is never refused by the free tier, whatever its trial says', () => {
  const late = new Date(CREATED.getTime() + 20 * MS_PER_DAY);
  const paidUntil = new Date(late.getTime() + 30 * MS_PER_DAY);
  assert.equal(trialEndedBy(trial({ allowanceExpiresAt: paidUntil, now: late })), null, 'days over, but paid');
  assert.equal(
    trialEndedBy(trial({ allowanceExpiresAt: paidUntil, trialScansUsed: 10 })),
    null,
    'scans used, but paid',
  );
  // THE CONTROL: the same two accounts without the paid date have ended.
  assert.equal(trialEndedBy(trial({ now: late })), 'days');
  assert.equal(trialEndedBy(trial({ trialScansUsed: 10 })), 'scans');
});

test('an account with no scan trial never ends one', () => {
  assert.equal(trialEndedBy(trial({ trialScans: null, trialScansUsed: 0, trialEndsAt: null })), null);
});
