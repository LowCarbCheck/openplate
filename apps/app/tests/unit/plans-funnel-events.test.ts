/**
 * The four plans funnel events (M250/06), asserted against the `_paq` queue
 * Matomo drains.
 *
 * Each step is one event with one word from a fixed list. What is asserted is
 * the exact queue entry, the tier (product: it fires at `product`, not at
 * `pageviews`), and that no argument can carry anything else.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  __resetAnalyticsEventLevelForTests,
  setAnalyticsEventLevel,
  trackOfferSeen,
  trackOrderSent,
  trackPaymentReturned,
  trackPlanPicked,
} from '../../app/lib/matomo-events';

/** A bare `window` carrying an empty `_paq`, the same stub `analytics-event-levels.test.ts` uses. */
function stubWindow(): unknown[][] {
  const paq: unknown[][] = [];
  Object.defineProperty(globalThis, 'window', { value: { _paq: paq }, configurable: true, writable: true });
  return paq;
}

/** Every funnel step, once. */
function fireEveryStep(): void {
  trackOfferSeen('plan-page');
  trackPlanPicked('yearly');
  trackOrderSent('yearly');
  trackPaymentReturned('paid');
}

afterEach(() => {
  __resetAnalyticsEventLevelForTests();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('the plans funnel', () => {
  it('sends one event per step, each naming only its fixed word', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel('product');
    fireEveryStep();
    assert.deepEqual(paq, [
      ['trackEvent', 'Plans', 'offer-seen', 'plan-page'],
      ['trackEvent', 'Plans', 'plan-picked', 'yearly'],
      ['trackEvent', 'Plans', 'order-sent', 'yearly'],
      ['trackEvent', 'Plans', 'payment-returned', 'paid'],
    ]);
  });

  it('sends nothing on an instance that counts pageviews only', () => {
    // THE CONTROL for the case above: the same four calls, one level lower.
    const paq = stubWindow();
    setAnalyticsEventLevel('pageviews');
    fireEveryStep();
    assert.deepEqual(paq, []);
  });

  it('takes no parameter a person could have typed', () => {
    // The unions are the guard; this pins that nobody widened one to string.
    const source = readFileSync(fileURLToPath(new URL('../../app/lib/matomo-events.ts', import.meta.url)), 'utf8');
    const signatures = [
      ...source.matchAll(
        /export function (trackOfferSeen|trackPlanPicked|trackOrderSent|trackPaymentReturned)\(([^)]*)\)/g,
      ),
    ].map((match) => match[2]);
    assert.deepEqual(signatures, [
      'placement: OfferPlacement',
      'key: PlanKey',
      'key: PlanKey',
      'outcome: PaymentReturn',
    ]);
  });
});
