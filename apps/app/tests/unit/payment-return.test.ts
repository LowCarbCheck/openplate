/**
 * `confirmationAfterRead`: what one answered read means after a payment
 * return, and the deadline on each side (2026-09-28).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAYMENT_POLL_DEADLINE_MS,
  PAYMENT_POLL_INTERVAL_MS,
  confirmationAfterRead,
} from '../../app/lib/plans/payment-return';

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
