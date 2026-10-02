/**
 * The plan page after a purchase: the status card for a subscriber, the order
 * for somebody without a plan, and a thank-you that shows once (M250/07).
 *
 * The same page, the same stubbed core (`plans-stub.ts`), and only the plan
 * view differs between the cases, so each is the other's control: a page that
 * drew the card for everybody, or the order for everybody, fails one of them.
 *
 * @area plans-and-paywall
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN, fill } from './copy';
import {
  FIXTURE_OFFER_BODY,
  NO_SUBSCRIPTION_VIEW,
  YEARLY_SUBSCRIBER_VIEW,
  openPlanPageSignedIn,
  routePlansCore,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The line a return from a payment says once the plan is live (2026-09-28), from the shipped English bundle. */
const PLAN_ACTIVE = z
  .object({ paywall: z.object({ returned: z.object({ active: z.string() }) }) })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8'))).paywall
  .returned.active;

/** The period end of the fixture yearly subscriber, as an English reader sees it. */
function yearlyPeriodEnd(): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(YEARLY_SUBSCRIBER_VIEW.currentPeriodEnd));
}

function statusCard(page: Page) {
  return page.locator('[data-slot="plan-status-card"]');
}

test('a yearly subscriber sees their plan, the year turning monthly and the manage button', async ({ page }) => {
  const offerRequests = await routePlansCore(page, { planView: YEARLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(statusCard(page)).toHaveAttribute('data-plan-key', 'yearly');
  await expect(statusCard(page).getByText(EN.plan.card.name.year, { exact: true })).toBeVisible();
  await expect(
    statusCard(page).getByText(fill(EN.plan.card.yearThenMonthly, { date: yearlyPeriodEnd() })),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: EN.plan.manage })).toBeVisible();

  // Nothing is sold to somebody who already pays: no cards, no start button,
  // and the offer was never even asked for.
  await expect(page.locator('[data-slot="plan-order-button"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(0);
  expect(offerRequests.locales).toEqual([]);
});

test('a person without a plan sees the order instead of a status card', async ({ page }) => {
  // THE CONTROL for the case above: the same page and the same offer, no plan.
  const offerRequests = await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2);
  await expect(page.locator('[data-slot="plan-order-button"]')).toBeVisible();
  await expect(statusCard(page)).toHaveCount(0);
  expect(offerRequests.locales).toEqual(['en']);
});

test('the line after a payment shows once, and a reload does not repeat it', async ({ page }) => {
  await routePlansCore(page, { planView: YEARLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page, '?checkout=success');

  // The plan is live on the first poll, so the line says so at once. The
  // "thank you, it can take a moment" line is the state before that, and
  // `paywall-plan-page.spec.ts` walks the whole poll.
  const thanks = page.getByText(PLAN_ACTIVE, { exact: true });
  await expect(thanks).toBeVisible();
  await expect(statusCard(page)).toBeVisible();
  // The marker leaves the address, and the thank-you stays where it was.
  await expect.poll(() => new URL(page.url()).searchParams.has('checkout')).toBe(false);
  await expect(thanks).toBeVisible();

  // A reload is not a second return.
  await page.reload();
  await expect(statusCard(page)).toBeVisible();
  await expect(thanks).toHaveCount(0);
});
