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

// THE RULE (owner decision, 2026-09-29, BGB 187(1) and 188(1)): the sign-up
// day does not count, and the trial ends at the end of the 14th day after it,
// at local midnight in TRIAL_TIME_ZONE. Every case below also shows that the
// old rule, sign-up plus 14 x 24 hours, gives another instant, so the case
// can tell the two rules apart.

const BERLIN = 'Europe/Berlin';

/** The rule this replaced: exactly `days` x 24 hours after the sign-up. */
function oldRule(input: { startedAt: Date; days: number }): string {
  return new Date(input.startedAt.getTime() + input.days * MS_PER_DAY).toISOString();
}

/** A wall clock reading and the zone's UTC offset at that moment, `00:00:00` and `GMT+02:00`. */
interface WallClockReading {
  time: string;
  offset: string;
}

/** The wall clock and the UTC offset of an instant in a zone, read with Intl on its own. */
function wallClock(input: { instant: Date; timeZone: string }): WallClockReading {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: input.timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(input.instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return { time: `${part('hour')}:${part('minute')}:${part('second')}`, offset: part('timeZoneName') };
}

test('Berlin: a sign-up at 10:00 and one at 23:30 on the same day end at the same instant, local midnight', () => {
  const morning = new Date('2026-09-29T08:00:00.000Z'); // 10:00 CEST
  const lateEvening = new Date('2026-09-29T21:30:00.000Z'); // 23:30 CEST
  const expected = '2026-10-13T22:00:00.000Z'; // 2026-10-14 00:00 CEST
  assert.equal(trialEndsAtFor({ startedAt: morning, days: 14, timeZone: BERLIN })?.toISOString(), expected);
  assert.equal(trialEndsAtFor({ startedAt: lateEvening, days: 14, timeZone: BERLIN })?.toISOString(), expected);
  // THE CONTROL: the old rule ends the two at different instants, neither of them this one.
  assert.notEqual(oldRule({ startedAt: morning, days: 14 }), expected);
  assert.notEqual(oldRule({ startedAt: lateEvening, days: 14 }), expected);
});

test('Berlin: a sign-up at 00:10 ends one day later than one at 23:50 the day before', () => {
  const justAfterMidnight = new Date('2026-09-29T22:10:00.000Z'); // 2026-09-30 00:10 CEST
  const justBeforeMidnight = new Date('2026-09-29T21:50:00.000Z'); // 2026-09-29 23:50 CEST
  const later = trialEndsAtFor({ startedAt: justAfterMidnight, days: 14, timeZone: BERLIN });
  const earlier = trialEndsAtFor({ startedAt: justBeforeMidnight, days: 14, timeZone: BERLIN });
  assert.equal(earlier?.toISOString(), '2026-10-13T22:00:00.000Z');
  assert.equal(later?.toISOString(), '2026-10-14T22:00:00.000Z');
  // Both sign-ups fall on 2026-09-29 in UTC: a rule that read the UTC date would end them together.
  // THE CONTROL: under the old rule the two ends are twenty minutes apart, not a day.
  assert.equal(
    new Date(oldRule({ startedAt: justAfterMidnight, days: 14 })).getTime() -
      new Date(oldRule({ startedAt: justBeforeMidnight, days: 14 })).getTime(),
    20 * 60 * 1000,
  );
});

test('Berlin: a trial across the last Sunday of March ends at local midnight in summer time', () => {
  const startedAt = new Date('2027-03-20T11:00:00.000Z'); // 12:00 CET, before 2027-03-28
  const endsAt = trialEndsAtFor({ startedAt, days: 14, timeZone: BERLIN });
  assert.equal(endsAt?.toISOString(), '2027-04-03T22:00:00.000Z'); // 2027-04-04 00:00 CEST
  assert.ok(endsAt);
  assert.deepEqual(wallClock({ instant: endsAt, timeZone: BERLIN }), { time: '00:00:00', offset: 'GMT+02:00' });
  // THE CONTROL: the old rule lands at 13:00 local.
  assert.equal(wallClock({ instant: new Date(oldRule({ startedAt, days: 14 })), timeZone: BERLIN }).time, '13:00:00');
});

test('Berlin: a trial across the last Sunday of October ends at local midnight in winter time', () => {
  const startedAt = new Date('2026-10-20T10:00:00.000Z'); // 12:00 CEST, before 2026-10-25
  const endsAt = trialEndsAtFor({ startedAt, days: 14, timeZone: BERLIN });
  assert.equal(endsAt?.toISOString(), '2026-11-03T23:00:00.000Z'); // 2026-11-04 00:00 CET
  assert.ok(endsAt);
  assert.deepEqual(wallClock({ instant: endsAt, timeZone: BERLIN }), { time: '00:00:00', offset: 'GMT+01:00' });
  // THE CONTROL: the old rule lands at 11:00 local.
  assert.equal(wallClock({ instant: new Date(oldRule({ startedAt, days: 14 })), timeZone: BERLIN }).time, '11:00:00');
});

test('UTC, the default zone: the trial ends at UTC midnight after the fourteenth day', () => {
  const startedAt = new Date('2026-09-29T23:30:00.000Z');
  assert.equal(trialEndsAtFor({ startedAt, days: 14, timeZone: 'UTC' })?.toISOString(), '2026-10-14T00:00:00.000Z');
  assert.equal(
    trialEndsAtFor({ startedAt: CREATED, days: 14, timeZone: 'UTC' })?.toISOString(),
    '2026-10-16T00:00:00.000Z',
  );
  // THE CONTROL: the old rule gives 23:30 and 15:00.
  assert.equal(oldRule({ startedAt, days: 14 }), '2026-10-13T23:30:00.000Z');
  assert.equal(oldRule({ startedAt: CREATED, days: 14 }), '2026-10-15T15:00:00.000Z');
});

test('an instance without TRIAL_DAYS, or an invite row written before it, starts a trial with no end date', () => {
  // THE CONTROL for the dates above: no day count, no date, in any zone. This
  // is what every account created before M267 keeps.
  assert.equal(trialEndsAtFor({ startedAt: CREATED, days: null, timeZone: 'UTC' }), null);
  assert.equal(trialEndsAtFor({ startedAt: CREATED, days: null, timeZone: BERLIN }), null);
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
