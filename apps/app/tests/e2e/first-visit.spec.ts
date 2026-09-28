/**
 * The first thing a person meets: an empty device, the front door, the
 * questionnaire, the diary.
 *
 * WHAT THIS CATCHES that no other tier can. Every route in this app is
 * client-only, so a hydration failure renders a perfect server HTML document
 * and then dies silently: `curl` says 200, the unit tier renders the component
 * happily, and the person sees a page where nothing responds. `pageerror` is
 * the read that sees it, so it is collected for the whole walk and asserted at
 * the end rather than per step.
 */
import { expect, test } from '@playwright/test';

import { completeOnboarding, expectPhoneLayout } from './helpers';

test('a fresh device walks from the front door to the diary, with no page errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expectPhoneLayout(page);

  await completeOnboarding(page);

  await expect(page).toHaveURL(/\/diary$/u);
  // NON-VACUITY: the URL alone would be satisfied by a blank screen. The
  // chrome only renders inside `_personal`, so a visible header is the
  // evidence that the app itself is up.
  await expect(page.locator('header').first()).toBeVisible();
  await expectPhoneLayout(page);

  expect(pageErrors, 'the walk must raise no uncaught page error').toEqual([]);
});
