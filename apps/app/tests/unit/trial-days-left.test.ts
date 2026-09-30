/**
 * The free tier's days left, drawn beside its scans left (owner decision
 * 2026-09-30): whole days, rounded DOWN but never below 1 while it runs, and
 * only for a scan trial that still runs. Every boundary has a control a step
 * away that answers differently.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { trialDaysLeft } from '../../app/lib/plans/trial-scans';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NOW = new Date('2026-09-30T12:00:00.000Z');
const RUNNING = { granted: 10, left: 4 };

/** The ISO instant `ms` after {@link NOW}. */
function endsIn(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

/** The count for a running scan trial that ends `ms` after {@link NOW}. */
function daysLeftFor(ms: number): number | null {
  return trialDaysLeft({ trialScans: RUNNING, trialEndsAt: endsIn(ms), now: NOW });
}

describe('trialDaysLeft', () => {
  it('says 14 right after sign-up, with 14 days and 14 hours left', () => {
    assert.equal(daysLeftFor((14 * 24 + 14) * HOUR_MS), 14);
  });

  it('CONTROL: 14 days 14 hours never reads 15, the count rounded up', () => {
    assert.notEqual(daysLeftFor((14 * 24 + 14) * HOUR_MS), 15);
  });

  it('rounds 30 hours down to 1 day', () => {
    assert.equal(daysLeftFor(30 * HOUR_MS), 1);
  });

  it('CONTROL: 48 hours is 2 days, so the 1 above is not a constant', () => {
    assert.equal(daysLeftFor(48 * HOUR_MS), 2);
  });

  it('counts exactly 24 hours as 1 day', () => {
    assert.equal(daysLeftFor(24 * HOUR_MS), 1);
  });

  it('CONTROL: one minute short of 48 hours is still 1 day, so the step is at the whole day', () => {
    assert.equal(daysLeftFor(48 * HOUR_MS - MINUTE_MS), 1);
  });

  it('says 1 day in the last minute, never 0', () => {
    assert.equal(daysLeftFor(MINUTE_MS), 1);
  });

  it('draws nothing at the end instant and after it', () => {
    assert.equal(daysLeftFor(0), null, 'the end instant counts as ended');
    assert.equal(daysLeftFor(-MINUTE_MS), null);
  });

  it('CONTROL: the same trial one minute before its end still draws a day', () => {
    assert.notEqual(daysLeftFor(MINUTE_MS), null);
  });

  it('draws nothing for no end date, an absent key or an unreadable end', () => {
    assert.equal(trialDaysLeft({ trialScans: RUNNING, trialEndsAt: null, now: NOW }), null);
    assert.equal(trialDaysLeft({ trialScans: RUNNING, trialEndsAt: undefined, now: NOW }), null);
    assert.equal(trialDaysLeft({ trialScans: RUNNING, trialEndsAt: 'not a date', now: NOW }), null);
  });

  it('CONTROL: the same trial with a readable end draws its days', () => {
    assert.equal(trialDaysLeft({ trialScans: RUNNING, trialEndsAt: endsIn(3 * 24 * HOUR_MS), now: NOW }), 3);
  });

  it('draws nothing without a binding scan trial: no trial, or a paid window bindingTrialScans dropped', () => {
    assert.equal(trialDaysLeft({ trialScans: null, trialEndsAt: endsIn(3 * 24 * HOUR_MS), now: NOW }), null);
  });

  it('draws nothing once the free scans are spent, which ended the trial first', () => {
    const spent = { granted: 10, left: 0 };
    assert.equal(trialDaysLeft({ trialScans: spent, trialEndsAt: endsIn(3 * 24 * HOUR_MS), now: NOW }), null);
  });

  it('CONTROL: one scan left keeps the day line', () => {
    const lastScan = { granted: 10, left: 1 };
    assert.equal(trialDaysLeft({ trialScans: lastScan, trialEndsAt: endsIn(3 * 24 * HOUR_MS), now: NOW }), 3);
  });
});
