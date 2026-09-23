/**
 * The scan trial's wire and its count (M253/05): what an account read and a
 * proxied response may state, and when that count binds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindingTrialScans,
  decodeTrialScans,
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
