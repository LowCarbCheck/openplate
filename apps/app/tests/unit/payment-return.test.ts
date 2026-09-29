/**
 * `confirmationAfterRead`: what one answered read means after a payment
 * return, and the deadline on each side (2026-09-28). `paymentReturnDoorFor`:
 * where the link after a confirmed payment leads (M265/03).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAYMENT_POLL_DEADLINE_MS,
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_RETURN_HREF,
  confirmationAfterRead,
  paymentReturnDoorFor,
} from '../../app/lib/plans/payment-return';
import type { OnboardingGateOutcome } from '../../app/lib/onboarding-gate';

describe('confirmationAfterRead', () => {
  it('confirms a live plan, even on the very first read', () => {
    assert.equal(confirmationAfterRead({ isSubscribed: true, elapsedMs: 0 }), 'confirmed');
  });

  it('confirms a live plan that arrives after the deadline, rather than calling it slow', () => {
    assert.equal(confirmationAfterRead({ isSubscribed: true, elapsedMs: PAYMENT_POLL_DEADLINE_MS * 2 }), 'confirmed');
  });

  it('keeps checking up to the last millisecond before the deadline', () => {
    assert.equal(confirmationAfterRead({ isSubscribed: false, elapsedMs: PAYMENT_POLL_DEADLINE_MS - 1 }), 'checking');
  });

  it('says slow from the deadline on', () => {
    assert.equal(confirmationAfterRead({ isSubscribed: false, elapsedMs: PAYMENT_POLL_DEADLINE_MS }), 'slow');
  });

  it('asks every two seconds for up to a minute, the brief the page was built to', () => {
    assert.equal(PAYMENT_POLL_INTERVAL_MS, 2_000);
    assert.equal(PAYMENT_POLL_DEADLINE_MS, 60_000);
  });
});

describe('paymentReturnDoorFor (M265/03)', () => {
  it('leads to the questionnaire exactly where the gate would send the person there', () => {
    assert.equal(paymentReturnDoorFor('onboard'), 'onboarding');
    assert.equal(PAYMENT_RETURN_HREF.onboarding, '/onboarding');
  });

  // THE CONTROL, one per other answer. An onboarded account keeps the diary,
  // a device with logs is stamped by the gate on the way in, and a possible
  // data loss and a session still reopening are left for the gate to decide
  // at the diary's door rather than answered here with a wizard.
  it('keeps the diary for every other answer of the gate', () => {
    const others = [
      'pass',
      'self-heal',
      'recover',
      'wait',
      'welcome',
      'exempt',
    ] satisfies OnboardingGateOutcome['kind'][];
    for (const gate of others) assert.equal(paymentReturnDoorFor(gate), 'diary', gate);
    assert.equal(PAYMENT_RETURN_HREF.diary, '/dashboard');
  });
});
