/**
 * The plans funnel reports each step once, read off the Matomo requests
 * (M250/06).
 *
 * ── WHAT IS REAL AND WHAT IS STUBBED ─────────────────────────────────────
 *
 * REAL: the production build with analytics configured (`playwright.config.ts`
 * passes `MATOMO_URL` and `MATOMO_SITE_ID`), the tracker hook, the event level,
 * the production CSP, the account, the session and the plan page.
 *
 * STUBBED: the plan reads and the order (`plans-stub.ts`), and `matomo.js`
 * itself, by the stub tracker in `matomo-stub.ts`, which says what it does.
 * What is counted here is a REQUEST that passed the page's own `connect-src`,
 * not an array in memory.
 *
 * ── THE WALK ─────────────────────────────────────────────────────────────
 *
 * Offer seen on the plan page, a plan picked, the order sent, and the browser
 * sent back from "payment" with `?checkout=success`, by then a subscriber
 * (the webhook arrived), so the returning page draws no second offer. Each
 * step must reach Matomo exactly once, and a reload must not count the return
 * again.
 */
import { expect, test } from '@playwright/test';

import { E2E_APP_URL } from './env';
import { funnel, recordMatomo } from './matomo-stub';
import {
  FIXTURE_OFFER_BODY,
  NO_SUBSCRIPTION_VIEW,
  YEARLY_SUBSCRIBER_VIEW,
  openPlanPageSignedIn,
  routeOrder,
  routePlansCore,
  type PlansStub,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

test('the funnel sends offer seen, plan picked, order sent and back from payment, each once', async ({ page }) => {
  const events = await recordMatomo(page);
  // Mutable on purpose: the route reads it per request, and the webhook
  // "arrives" while the browser is away paying.
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
  await routePlansCore(page, stub);
  await routeOrder(page, [{ status: 200, json: { url: `${E2E_APP_URL}/settings/plan?checkout=success` } }]);

  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-card"][data-plan-key="yearly"]')).toBeVisible();
  await expect.poll(() => funnel(events)).toEqual(['offer-seen:plan-page']);

  // THE CONTROL that the recorder sees anything the page pushes at all, so the
  // "exactly once" readings below cannot pass against a deaf recorder.
  await page.evaluate(() => window._paq.push(['trackEvent', 'Control', 'probe', 'x']));
  await expect.poll(() => events.some((event) => event.category === 'Control')).toBe(true);

  await page.locator('[data-slot="plan-card"][data-plan-key="yearly"]').click();
  await expect.poll(() => funnel(events)).toEqual(['offer-seen:plan-page', 'plan-picked:yearly']);

  // The two consents are not funnel steps; ticking them sends nothing.
  await page.locator('[data-slot="plan-consent-terms"]').check();
  await page.locator('[data-slot="plan-consent-early-start"]').check();
  stub.planView = YEARLY_SUBSCRIBER_VIEW;
  await page.locator('[data-slot="plan-order-button"]').click();
  await page.waitForURL('**/settings/plan?checkout=success');

  await expect
    .poll(() => funnel(events))
    .toEqual(['offer-seen:plan-page', 'plan-picked:yearly', 'order-sent:yearly', 'payment-returned:paid']);
  // The marker leaves the address once it has been read.
  await expect.poll(() => new URL(page.url()).searchParams.has('checkout')).toBe(false);

  // A reload of the returned page counts nothing again.
  const pageviewsBefore = events.length;
  await page.reload();
  await expect
    .poll(() => events.length, { message: 'the reloaded page reached Matomo' })
    .toBeGreaterThan(pageviewsBefore);
  await page.waitForTimeout(500);
  expect(funnel(events)).toEqual([
    'offer-seen:plan-page',
    'plan-picked:yearly',
    'order-sent:yearly',
    'payment-returned:paid',
  ]);
});

test('a cancelled payment is reported as cancelled, not as paid', async ({ page }) => {
  const events = await recordMatomo(page);
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page, '?checkout=cancelled');
  await expect.poll(() => funnel(events)).toContain('payment-returned:cancelled');
  expect(funnel(events)).not.toContain('payment-returned:paid');
});
