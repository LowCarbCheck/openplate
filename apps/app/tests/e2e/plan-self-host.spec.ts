/**
 * The plan choice starts with the free way: run openplate yourself (M250/10).
 *
 * Owner, 2026-09-23: the page with the options should show first that the
 * whole thing is free when you host it yourself. It is information and not an
 * option, so what is checked is what it must NOT be as much as what it is:
 *
 * - it comes first, and links the self-hosting guide;
 * - it sits outside the radio group: two radios, both paid, and the arrow keys
 *   move between those two and never onto it;
 * - pressing it picks nothing, so the order button stays held. The control is
 *   the same press on a paid card, which picks that plan;
 * - a subscriber moving to the yearly plan is not shown it. The control there
 *   is the order itself, drawn on the same page.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import {
  FIXTURE_OFFER_BODY,
  MONTHLY_SUBSCRIBER_VIEW,
  NO_SUBSCRIPTION_VIEW,
  openPlanPageSignedIn,
  routePlansCore,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The self-hosting guide, as `app/lib/brand.ts` names it. */
const GUIDE_URL = 'https://openplate.de/docs/app/self-hosting';

function freeCard(page: Page) {
  return page.locator('[data-slot="plan-self-host"]');
}

/** Whether the focused element is one of the plan radios. */
async function focusIsPlanRadio(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    return focused instanceof HTMLInputElement && focused.type === 'radio' && focused.name === 'plan';
  });
}

test('the free card comes first, links the guide, and is no part of the choice', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);

  const card = freeCard(page);
  const choice = page.locator('[data-slot="plan-choice"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText(EN.plan.selfHost.title);
  const cardBox = await card.boundingBox();
  const choiceBox = await choice.boundingBox();
  expect(cardBox !== null && choiceBox !== null && cardBox.y < choiceBox.y, 'the free card is not first').toBe(true);

  const link = card.getByRole('link', { name: EN.plan.selfHost.link });
  await expect(link).toHaveAttribute('href', GUIDE_URL);
  await expect(link).toHaveAttribute('target', '_blank');

  // OUTSIDE THE GROUP. The control is the same query finding the two paid cards.
  await expect(choice.locator('[data-slot="plan-self-host"]')).toHaveCount(0);
  await expect(choice.locator('[data-slot="plan-card"]')).toHaveCount(2);
  await expect(page.locator('input[type="radio"]')).toHaveCount(2);
  await expect(card.locator('input')).toHaveCount(0);

  // Square corners.
  expect(await card.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe('0px');
});

test('pressing the free card picks nothing; pressing a paid card picks it', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);
  const orderButton = page.locator('[data-slot="plan-order-button"]');

  await freeCard(page).getByText(EN.plan.selfHost.title).click();
  await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
  await expect(orderButton).toBeDisabled();

  // THE CONTROL: the same press on a paid card is a pick.
  await page.locator('[data-slot="plan-card"][data-plan-key="monthly"]').click();
  await expect(page.locator('input[type="radio"][value="monthly"]')).toBeChecked();
});

test('the keyboard reaches the guide as a link, and the arrow keys never leave the paid plans', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await freeCard(page).getByRole('link').focus();
  await page.keyboard.press('Tab');
  // THE CONTROL for the arrow walk below: focus did arrive in the group.
  expect(await focusIsPlanRadio(page)).toBe(true);
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp']) {
    await page.keyboard.press(key);
    expect(await focusIsPlanRadio(page), `${key} left the plan radios`).toBe(true);
  }
});

test('a subscriber moving to the yearly plan is not shown the free card', async ({ page }) => {
  await routePlansCore(page, { planView: MONTHLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page, '?plan=yearly');
  await expect(page.locator('[data-slot="plan-order"]')).toHaveAttribute('data-order-mode', 'switch');
  await expect(freeCard(page)).toHaveCount(0);
});
