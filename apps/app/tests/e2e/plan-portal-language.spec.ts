/**
 * The manage button opens Stripe's portal in the page language (2026-09-30).
 *
 * The button posts `{ locale }` to `/v1/plans/portal`, the same language the
 * order carries, and the biller hands it to the portal. What is asserted here
 * is the body the page sent; the biller's own tests follow it to Stripe.
 *
 * Each case is the other's control: a page that sent one fixed language, or
 * none, fails one of them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { E2E_APP_URL } from './env';
import { useLanguage } from './helpers';
import { FIXTURE_OFFER_BODY, YEARLY_SUBSCRIBER_VIEW, openPlanPageSignedIn, routePlansCore, routePortal } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The manage button's label in one shipped bundle. */
function manageLabel(language: 'en' | 'fr'): string {
  return z
    .object({ plan: z.object({ manage: z.string() }) })
    .parse(JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${language}/common.json`), 'utf8'))).plan
    .manage;
}

/** Where the stubbed portal sends the browser: a page of this app. */
const RETURN_TO = `${E2E_APP_URL}/settings`;

/** A yearly subscriber on the plan page, drawn in `language`, with the portal route recording. */
async function openPlanPageIn(page: Page, language: 'en' | 'fr') {
  await routePlansCore(page, { planView: YEARLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_OFFER_BODY });
  const portal = await routePortal(page, RETURN_TO);
  await openPlanPageSignedIn(page);
  // The onboarding walk reads English, so the language changes on the plan
  // page itself, through a reload.
  await useLanguage(page, language);
  await page.reload();
  await expect(page.locator('[data-slot="plan-status-card"]')).toBeVisible();
  return portal;
}

test('a French plan page opens the portal in French', async ({ page }) => {
  const portal = await openPlanPageIn(page, 'fr');

  await page.getByRole('button', { name: manageLabel('fr') }).click();

  await page.waitForURL(RETURN_TO);
  expect(portal.bodies).toEqual([{ locale: 'fr' }]);
});

test('CONTROL: an English plan page opens it in English', async ({ page }) => {
  const portal = await openPlanPageIn(page, 'en');

  await page.getByRole('button', { name: manageLabel('en') }).click();

  await page.waitForURL(RETURN_TO);
  expect(portal.bodies).toEqual([{ locale: 'en' }]);
});
