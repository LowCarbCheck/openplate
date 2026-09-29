/**
 * The scan trial's wire and its count (M253/05): what an account read and a
 * proxied response may state, and when that count binds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindingTrialScans,
  decodeTrialEndsAt,
  decodeTrialScans,
  grantedTrialDays,
  readTrialScansLeft,
  withScansLeft,
} from '../../app/lib/plans/trial-scans';
import { resolveAllowanceLine } from '../../app/components/avatar-account-strip';

describe('decodeTrialScans', () => {
  it('reads a count the core states', () => {
    assert.deepEqual(decodeTrialScans({ granted: 10, left: 3 }), { granted: 10, left: 3 });
  });

  it('reads an absent key, a null and a broken value as no scan trial', () => {
    assert.equal(decodeTrialScans(undefined), null);
    assert.equal(decodeTrialScans(null), null);
    assert.equal(decodeTrialScans({ granted: 10, left: 11 }), null, 'more left than given');
    assert.equal(decodeTrialScans({ granted: 10, left: -1 }), null);
    assert.equal(decodeTrialScans({ granted: 2.5, left: 1 }), null);
  });
});

describe('readTrialScansLeft', () => {
  it('reads a whole number', () => {
    assert.equal(readTrialScansLeft(new Headers({ 'X-Trial-Scans-Left': '7' })), 7);
    assert.equal(readTrialScansLeft(new Headers({ 'X-Trial-Scans-Left': '0' })), 0);
  });

  it('reads nothing from an absent or garbled header, the control for the numbers above', () => {
    assert.equal(readTrialScansLeft(new Headers()), null);
    assert.equal(readTrialScansLeft(new Headers({ 'X-Trial-Scans-Left': '-1' })), null);
    assert.equal(readTrialScansLeft(new Headers({ 'X-Trial-Scans-Left': 'lots' })), null);
  });
});

describe('withScansLeft', () => {
  it('moves the count and keeps what was given', () => {
    assert.deepEqual(withScansLeft({ trial: { granted: 10, left: 3 }, left: 2 }), { granted: 10, left: 2 });
  });

  it('invents no trial for an account the app knows none of', () => {
    assert.equal(withScansLeft({ trial: null, left: 2 }), null);
  });

  it('never reads more left than given', () => {
    assert.deepEqual(withScansLeft({ trial: { granted: 10, left: 3 }, left: 12 }), { granted: 10, left: 10 });
  });
});

describe('bindingTrialScans', () => {
  const trialScans = { granted: 10, left: 3 };

  it('binds an account with no date', () => {
    assert.deepEqual(bindingTrialScans({ trialScans, allowanceExpiresAt: null }), trialScans);
  });

  it('does not bind an account with a date, which a payment or an operator set', () => {
    assert.equal(bindingTrialScans({ trialScans, allowanceExpiresAt: '2027-01-01T00:00:00.000Z' }), null);
  });
});

describe('the account strip on a scan trial', () => {
  const base = { aiComesFromTheInstance: true, dailyAiLimit: 20, aiUsedToday: 4, plansAvailable: true };

  it('says the free scans left instead of the per-day line', () => {
    assert.deepEqual(resolveAllowanceLine({ ...base, trialScans: { granted: 10, left: 3 } }), {
      kind: 'trial-scans',
      left: 3,
      granted: 10,
    });
  });

  it('keeps the per-day line without a binding count, the control for the case above', () => {
    assert.deepEqual(resolveAllowanceLine({ ...base, trialScans: null }), { kind: 'usage', used: 4, limit: 20 });
    assert.deepEqual(resolveAllowanceLine(base), { kind: 'usage', used: 4, limit: 20 });
  });
});

describe('decodeTrialEndsAt (M267)', () => {
  it('reads an instant the core states', () => {
    assert.equal(decodeTrialEndsAt('2026-10-13T09:00:00.000Z'), '2026-10-13T09:00:00.000Z');
  });

  it('reads an absent key, a null and a broken value as no end date, which never locks', () => {
    assert.equal(decodeTrialEndsAt(undefined), null);
    assert.equal(decodeTrialEndsAt(null), null);
    assert.equal(decodeTrialEndsAt('next tuesday'), null);
    assert.equal(decodeTrialEndsAt(''), null);
  });
});

describe('grantedTrialDays (M267)', () => {
  // The core ends a trial at local midnight after the fourteenth day, and the
  // sign-up day does not count (owner decision, 2026-09-29). So the time from
  // sign-up to end runs from just over 14 days to 15, and a count that rounded
  // that time would read 15 for most sign-ups. Every case below is one such
  // end, as the core writes it.
  it('reads fourteen for every sign-up time on the day, in Berlin', () => {
    const berlinEnd = '2026-10-13T22:00:00.000Z'; // 2026-10-14 00:00 CEST
    assert.equal(grantedTrialDays({ createdAt: '2026-09-29T08:00:00.000Z', trialEndsAt: berlinEnd }), 14); // 10:00
    assert.equal(grantedTrialDays({ createdAt: '2026-09-29T21:30:00.000Z', trialEndsAt: berlinEnd }), 14); // 23:30
    assert.equal(grantedTrialDays({ createdAt: '2026-09-28T22:05:00.000Z', trialEndsAt: berlinEnd }), 14); // 00:05
    // A sign-up at 00:10 the next day ends a day later, and is fourteen too.
    assert.equal(
      grantedTrialDays({ createdAt: '2026-09-29T22:10:00.000Z', trialEndsAt: '2026-10-14T22:00:00.000Z' }),
      14,
    );
  });

  it('reads fourteen across the change to winter time, and in UTC', () => {
    // 2026-10-20 12:00 CEST, ending 2026-11-04 00:00 CET.
    assert.equal(
      grantedTrialDays({ createdAt: '2026-10-20T10:00:00.000Z', trialEndsAt: '2026-11-03T23:00:00.000Z' }),
      14,
    );
    assert.equal(
      grantedTrialDays({ createdAt: '2026-09-29T23:30:00.000Z', trialEndsAt: '2026-10-14T00:00:00.000Z' }),
      14,
    );
    assert.equal(
      grantedTrialDays({ createdAt: '2026-09-29T00:00:00.004Z', trialEndsAt: '2026-10-14T00:00:00.000Z' }),
      14,
    );
  });

  it('CONTROL: another day count reads as itself, so fourteen is not a constant', () => {
    assert.equal(
      grantedTrialDays({ createdAt: '2026-09-29T08:00:00.000Z', trialEndsAt: '2026-10-06T22:00:00.000Z' }),
      7,
    );
    assert.equal(
      grantedTrialDays({ createdAt: '2026-09-29T08:00:00.000Z', trialEndsAt: '2026-09-30T22:00:00.000Z' }),
      1,
    );
  });

  it('knows no count without both instants, or with an end before the start', () => {
    assert.equal(grantedTrialDays({ createdAt: null, trialEndsAt: '2026-10-13T10:00:00.000Z' }), null);
    assert.equal(grantedTrialDays({ createdAt: '2026-09-29T10:00:00.000Z', trialEndsAt: null }), null);
    assert.equal(
      grantedTrialDays({ createdAt: '2026-10-13T10:00:00.000Z', trialEndsAt: '2026-09-29T10:00:00.000Z' }),
      null,
    );
  });
});
