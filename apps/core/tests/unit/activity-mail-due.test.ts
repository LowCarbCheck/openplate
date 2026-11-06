/**
 * The activity reminder rules as pure functions: the consent rule, both due
 * rules, the unsubscribe token, and the parsers for the body fields and the
 * admin settings patch.
 *
 * EVERY REFUSAL HAS ITS CONTROL. Each due test starts from one account that
 * IS due, asserts that, then changes exactly one fact and asserts that it is
 * not. A rule that refused everything fails the control; a rule that ignored
 * the fact fails the refusal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActivityMailConsentActive, type ActivityMailConsent } from '../../src/activity-mail/consent.js';
import {
  daysBefore,
  hasUsableAiAllowance,
  isActivityMailKind,
  isFirstScanDue,
  isQuietDue,
  wholeDaysBetween,
  type FirstScanCandidate,
  type QuietCandidate,
} from '../../src/activity-mail/due-rules.js';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../../src/activity-mail/unsubscribe-token.js';
import { parseActivityMailFields } from '../../src/activity-mail/consent-input.js';
import {
  DEFAULT_ACTIVITY_MAIL_SETTINGS,
  applyActivityMailPatch,
  isActivityMailOffered,
  parseActivityMailPatch,
} from '../../src/activity-mail/settings.js';
import type { AiLimitWindow } from '../../src/accounts/ai-allowance.js';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const NO_FREE_DEFAULT: AiLimitWindow = { limit: 0, period: 'day' };

function at(input: { daysAgo: number; hours?: number }): Date {
  return new Date(daysBefore({ now: NOW, days: input.daysAgo }).getTime() - (input.hours ?? 0) * HOUR_MS);
}

const ACTIVE: ActivityMailConsent = { optInAt: at({ daysAgo: 30 }), optOutAt: null };

/** Signed up eight days ago, never scanned, a standing free grant of 10. Due at 7 days. */
function dueFirstScan(): FirstScanCandidate {
  return {
    consent: ACTIVE,
    suspendedAt: null,
    firstScanMailSentAt: null,
    quietMailSentAt: null,
    createdAt: at({ daysAgo: 8 }),
    hasAiUsage: false,
    dailyAiLimit: 0,
    aiLimitPeriod: 'day',
    freeDailyAiLimit: 10,
    allowanceExpiresAt: null,
    trialScans: null,
    trialScansUsed: 0,
    trialEndsAt: null,
  };
}

function firstScanDue(account: FirstScanCandidate, days = 7): boolean {
  return isFirstScanDue({ account, context: { now: NOW, days }, instanceDefaultFreeAiLimit: NO_FREE_DEFAULT });
}

/** Last seen fifteen days ago, never mailed. Due at 14 days. */
function dueQuiet(): QuietCandidate {
  return {
    consent: ACTIVE,
    suspendedAt: null,
    lastSeenAt: at({ daysAgo: 15 }),
    quietMailSentAt: null,
    firstScanMailSentAt: null,
  };
}

function quietDue(account: QuietCandidate, days = 14): boolean {
  return isQuietDue({ account, context: { now: NOW, days } });
}

// ── consent ──────────────────────────────────────────────────────────────

test('consent is active with an opt-in and no opt-out, and not without an opt-in', () => {
  assert.equal(isActivityMailConsentActive({ optInAt: NOW, optOutAt: null }), true);
  assert.equal(isActivityMailConsentActive({ optInAt: null, optOutAt: null }), false);
  // An opt-out alone is no consent either.
  assert.equal(isActivityMailConsentActive({ optInAt: null, optOutAt: NOW }), false);
});

test('an opt-out after the opt-in withdraws, an opt-in after the opt-out restores, a tie withdraws', () => {
  const earlier = at({ daysAgo: 2 });
  const later = at({ daysAgo: 1 });
  assert.equal(isActivityMailConsentActive({ optInAt: earlier, optOutAt: later }), false);
  // The control: the same two instants the other way round.
  assert.equal(isActivityMailConsentActive({ optInAt: later, optOutAt: earlier }), true);
  assert.equal(isActivityMailConsentActive({ optInAt: earlier, optOutAt: new Date(earlier) }), false);
});

// ── first-scan ───────────────────────────────────────────────────────────

test('the first-scan control account is due', () => {
  assert.equal(firstScanDue(dueFirstScan()), true);
});

test('first-scan needs active consent', () => {
  assert.equal(firstScanDue({ ...dueFirstScan(), consent: { optInAt: null, optOutAt: null } }), false);
  assert.equal(firstScanDue({ ...dueFirstScan(), consent: { optInAt: at({ daysAgo: 30 }), optOutAt: NOW } }), false);
});

test('first-scan skips a suspended account', () => {
  assert.equal(firstScanDue({ ...dueFirstScan(), suspendedAt: at({ daysAgo: 1 }) }), false);
});

test('first-scan goes once per account, ever', () => {
  assert.equal(firstScanDue({ ...dueFirstScan(), firstScanMailSentAt: at({ daysAgo: 60 }) }), false);
});

test('first-scan never follows a quiet mail, however long ago it went', () => {
  // The control: the same account with no quiet mail is due.
  assert.equal(firstScanDue({ ...dueFirstScan(), quietMailSentAt: null }), true);
  assert.equal(firstScanDue({ ...dueFirstScan(), quietMailSentAt: at({ daysAgo: 2 }) }), false);
  assert.equal(firstScanDue({ ...dueFirstScan(), quietMailSentAt: at({ daysAgo: 400 }) }), false);
});

test('first-scan skips an account that ever had a photo read', () => {
  assert.equal(firstScanDue({ ...dueFirstScan(), hasAiUsage: true }), false);
});

test('first-scan opens at exactly days after sign-up and not an hour before', () => {
  assert.equal(firstScanDue({ ...dueFirstScan(), createdAt: at({ daysAgo: 7 }) }), true);
  assert.equal(firstScanDue({ ...dueFirstScan(), createdAt: at({ daysAgo: 6, hours: 23 }) }), false);
});

test('first-scan closes seven days after it opened', () => {
  assert.equal(firstScanDue({ ...dueFirstScan(), createdAt: at({ daysAgo: 13, hours: 23 }) }), true);
  assert.equal(firstScanDue({ ...dueFirstScan(), createdAt: at({ daysAgo: 14 }) }), false);
});

test('first-scan follows the configured days', () => {
  const account = { ...dueFirstScan(), createdAt: at({ daysAgo: 4 }) };
  assert.equal(firstScanDue(account, 3), true);
  assert.equal(firstScanDue(account, 7), false);
});

test('first-scan skips an account with no AI allowance', () => {
  assert.equal(firstScanDue({ ...dueFirstScan(), freeDailyAiLimit: 0 }), false);
  // The control: the instance default gives back what the account lacks.
  assert.equal(
    isFirstScanDue({
      account: { ...dueFirstScan(), freeDailyAiLimit: 0 },
      context: { now: NOW, days: 7 },
      instanceDefaultFreeAiLimit: { limit: 5, period: 'day' },
    }),
    true,
  );
});

test('a scan trial counts only while it has scans and days left', () => {
  const trial: FirstScanCandidate = {
    ...dueFirstScan(),
    freeDailyAiLimit: 0,
    dailyAiLimit: 50,
    trialScans: 10,
    trialScansUsed: 0,
    trialEndsAt: at({ daysAgo: -3 }),
  };
  assert.equal(firstScanDue(trial), true);
  assert.equal(firstScanDue({ ...trial, trialScansUsed: 10 }), false);
  assert.equal(firstScanDue({ ...trial, trialEndsAt: at({ daysAgo: 1 }) }), false);
});

test('an expired paid window with no other grant is no allowance', () => {
  const paid = { ...dueFirstScan(), freeDailyAiLimit: 0, dailyAiLimit: 50, allowanceExpiresAt: at({ daysAgo: -1 }) };
  assert.equal(hasUsableAiAllowance({ account: paid, instanceDefaultFreeAiLimit: NO_FREE_DEFAULT, now: NOW }), true);
  assert.equal(
    hasUsableAiAllowance({
      account: { ...paid, allowanceExpiresAt: at({ daysAgo: 1 }) },
      instanceDefaultFreeAiLimit: NO_FREE_DEFAULT,
      now: NOW,
    }),
    false,
  );
});

// ── quiet ────────────────────────────────────────────────────────────────

test('the quiet control account is due', () => {
  assert.equal(quietDue(dueQuiet()), true);
});

test('quiet needs active consent and an unsuspended account', () => {
  assert.equal(quietDue({ ...dueQuiet(), consent: { optInAt: null, optOutAt: null } }), false);
  assert.equal(quietDue({ ...dueQuiet(), suspendedAt: at({ daysAgo: 1 }) }), false);
});

test('quiet needs a last-seen instant', () => {
  assert.equal(quietDue({ ...dueQuiet(), lastSeenAt: null }), false);
});

test('quiet opens at the configured days and closes seven days later', () => {
  assert.equal(quietDue({ ...dueQuiet(), lastSeenAt: at({ daysAgo: 14 }) }), true);
  assert.equal(quietDue({ ...dueQuiet(), lastSeenAt: at({ daysAgo: 13, hours: 23 }) }), false);
  assert.equal(quietDue({ ...dueQuiet(), lastSeenAt: at({ daysAgo: 20, hours: 23 }) }), true);
  // Turning the kind on never reaches the accounts that left months ago.
  assert.equal(quietDue({ ...dueQuiet(), lastSeenAt: at({ daysAgo: 21 }) }), false);
  assert.equal(quietDue({ ...dueQuiet(), lastSeenAt: at({ daysAgo: 120 }) }), false);
});

test('quiet goes once per spell, and again after the person came back', () => {
  // Mailed after the person was last seen: this spell is done.
  assert.equal(quietDue({ ...dueQuiet(), quietMailSentAt: at({ daysAgo: 1 }) }), false);
  // Mailed in an earlier spell, then seen again: a new spell.
  assert.equal(quietDue({ ...dueQuiet(), quietMailSentAt: at({ daysAgo: 40 }) }), true);
});

test('quiet never follows a first-scan mail inside the quiet days', () => {
  assert.equal(quietDue({ ...dueQuiet(), firstScanMailSentAt: at({ daysAgo: 10 }) }), false);
  assert.equal(quietDue({ ...dueQuiet(), firstScanMailSentAt: at({ daysAgo: 15 }) }), true);
});

test('whole days round down, so a mail never claims a day that has not passed', () => {
  assert.equal(wholeDaysBetween({ from: at({ daysAgo: 7 }), to: NOW }), 7);
  assert.equal(wholeDaysBetween({ from: at({ daysAgo: 7, hours: 23 }), to: NOW }), 7);
  assert.equal(wholeDaysBetween({ from: at({ daysAgo: 8 }), to: NOW }), 8);
});

test('the kind guard accepts the two kinds and nothing else', () => {
  assert.equal(isActivityMailKind('first-scan'), true);
  assert.equal(isActivityMailKind('quiet'), true);
  assert.equal(isActivityMailKind('First-Scan'), false);
  assert.equal(isActivityMailKind(undefined), false);
  assert.equal(isActivityMailKind(null), false);
});

// ── the unsubscribe token ────────────────────────────────────────────────

const KEY = 'a'.repeat(64);

test('a signed token verifies to its account', () => {
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: signUnsubscribeToken({ key: KEY, accountId: 42 }) }), 42);
});

test('a token under another key, for another id, or with another mac is refused', () => {
  const token = signUnsubscribeToken({ key: KEY, accountId: 42 });
  const [, mac = ''] = token.split('.');
  assert.equal(verifyUnsubscribeToken({ key: 'b'.repeat(64), token }), null);
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: `43.${mac}` }), null);
  const otherMac = signUnsubscribeToken({ key: KEY, accountId: 43 }).split('.')[1] ?? '';
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: `42.${otherMac}` }), null);
  // The control: the two pieces put back together still verify.
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: `42.${mac}` }), 42);
});

test('a truncated, padded, signed or zero-led token is refused', () => {
  const token = signUnsubscribeToken({ key: KEY, accountId: 42 });
  const [, mac = ''] = token.split('.');
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: token.slice(0, -1) }), null);
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: `${token}=` }), null);
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: `${token}.x` }), null);
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: `+42.${mac}` }), null);
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: `042.${mac}` }), null);
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: '' }), null);
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: '42' }), null);
});

test('an id beyond a Postgres integer is refused before any mac is computed', () => {
  const huge = signUnsubscribeToken({ key: KEY, accountId: 2_147_483_648 });
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: huge }), null);
  // The control: the largest integer itself verifies.
  const largest = signUnsubscribeToken({ key: KEY, accountId: 2_147_483_647 });
  assert.equal(verifyUnsubscribeToken({ key: KEY, token: largest }), 2_147_483_647);
});

// ── the body fields ──────────────────────────────────────────────────────

test('absent fields stay absent, and booleans and languages pass', () => {
  assert.deepEqual(parseActivityMailFields({ activityMail: undefined, language: undefined }), {
    ok: true,
    value: { activityMail: undefined, language: undefined },
  });
  assert.deepEqual(parseActivityMailFields({ activityMail: true, language: 'de' }), {
    ok: true,
    value: { activityMail: true, language: 'de' },
  });
  assert.deepEqual(parseActivityMailFields({ activityMail: false, language: undefined }), {
    ok: true,
    value: { activityMail: false, language: undefined },
  });
});

test('a non-boolean activityMail and an unknown language are refused', () => {
  assert.equal(parseActivityMailFields({ activityMail: 'true', language: undefined }).ok, false);
  assert.equal(parseActivityMailFields({ activityMail: 1, language: undefined }).ok, false);
  assert.equal(parseActivityMailFields({ activityMail: null, language: undefined }).ok, false);
  assert.equal(parseActivityMailFields({ activityMail: true, language: 'nl' }).ok, false);
  assert.equal(parseActivityMailFields({ activityMail: true, language: 'DE' }).ok, false);
});

// ── the admin settings ───────────────────────────────────────────────────

test('both kinds are off by default, and the handshake offers nothing then', () => {
  assert.equal(DEFAULT_ACTIVITY_MAIL_SETTINGS.firstScan.enabled, false);
  assert.equal(DEFAULT_ACTIVITY_MAIL_SETTINGS.quiet.enabled, false);
  assert.equal(isActivityMailOffered({ isMailConfigured: true, settings: DEFAULT_ACTIVITY_MAIL_SETTINGS }), false);
});

test('the offer needs a real mailer AND one kind on', () => {
  const on = applyActivityMailPatch({ current: DEFAULT_ACTIVITY_MAIL_SETTINGS, patch: { quiet: { enabled: true } } });
  assert.equal(isActivityMailOffered({ isMailConfigured: true, settings: on }), true);
  assert.equal(isActivityMailOffered({ isMailConfigured: false, settings: on }), false);
});

test('a partial patch changes only what it names', () => {
  const patched = applyActivityMailPatch({
    current: DEFAULT_ACTIVITY_MAIL_SETTINGS,
    patch: { firstScan: { days: 10 } },
  });
  assert.deepEqual(patched, { firstScan: { enabled: false, days: 10 }, quiet: { enabled: false, days: 14 } });
});

test('the days bounds are 3 to 30 and 7 to 60, with the bounds in the message', () => {
  assert.deepEqual(parseActivityMailPatch({ firstScan: { days: 3 } }), { ok: true, value: { firstScan: { days: 3 } } });
  assert.deepEqual(parseActivityMailPatch({ firstScan: { days: 30 } }), {
    ok: true,
    value: { firstScan: { days: 30 } },
  });
  assert.deepEqual(parseActivityMailPatch({ firstScan: { days: 2 } }), {
    ok: false,
    reason: 'activityMail.firstScan.days must be a whole number from 3 to 30',
  });
  assert.equal(parseActivityMailPatch({ firstScan: { days: 31 } }).ok, false);
  assert.deepEqual(parseActivityMailPatch({ quiet: { days: 7 } }), { ok: true, value: { quiet: { days: 7 } } });
  assert.deepEqual(parseActivityMailPatch({ quiet: { days: 60 } }), { ok: true, value: { quiet: { days: 60 } } });
  assert.deepEqual(parseActivityMailPatch({ quiet: { days: 61 } }), {
    ok: false,
    reason: 'activityMail.quiet.days must be a whole number from 7 to 60',
  });
  assert.equal(parseActivityMailPatch({ quiet: { days: 6 } }).ok, false);
  assert.equal(parseActivityMailPatch({ quiet: { days: 14.5 } }).ok, false);
  assert.equal(parseActivityMailPatch({ quiet: { days: '14' } }).ok, false);
});

test('an unknown field, a non-boolean switch or a non-object is refused', () => {
  assert.equal(parseActivityMailPatch({ quiet: { enabeld: true } }).ok, false);
  assert.equal(parseActivityMailPatch({ weekly: { enabled: true } }).ok, false);
  assert.equal(parseActivityMailPatch({ quiet: { enabled: 'yes' } }).ok, false);
  assert.equal(parseActivityMailPatch({ quiet: true }).ok, false);
  assert.equal(parseActivityMailPatch(null).ok, false);
  // The control: the same switch spelled right.
  assert.deepEqual(parseActivityMailPatch({ quiet: { enabled: true } }), {
    ok: true,
    value: { quiet: { enabled: true } },
  });
});
