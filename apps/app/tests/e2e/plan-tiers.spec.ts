/**
 * The plan page lists the biller's tiers and the order page says what happens
 * to the person's data (M2/05).
 *
 * WHAT IS REAL: the production build, the account, the session, the plan page,
 * the offer decoder, the tier list, the order client and the order block. WHAT
 * IS STUBBED: the handshake's `plans: true`, the plan and offer reads
 * (`plans-stub.ts`, the neutral fixture offer WITH TIERS) and `POST
 * /v1/plans/order`, whose body is recorded and read off the wire.
 *
 * NO TIER NAME OR PRICE IS PINNED. The names, the limits and the prices come
 * from the fixture file and are compared with what the page draws, so the page
 * is shown to display what the biller sent and nothing it was built with.
 *
 * THE CONTROL is the same page with an offer that names no tiers: no list is
 * drawn, and the order block is the one it was before tiers.
 *
 * @area plans-and-paywall
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_APP_URL } from './env';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames, shiftScoreAfter } from './layout-shift';
import {
  FIXTURE_OFFER_BODY,
  FIXTURE_TIERS_OFFER_BODY,
  NO_SUBSCRIPTION_VIEW,
  openPlanPageSignedIn,
  routeOrder,
  routePlansCore,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

const priceSchema = z.object({ key: z.string(), grossCents: z.number() });

const tierSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  dailyAiLimit: z.number(),
  onSale: z.boolean(),
  prices: z.record(z.string(), priceSchema),
});

/** The part of the tiers fixture this spec reads, validated rather than asserted. */
const fixtureSchema = z.object({
  consentVersion: z.string(),
  tiers: z.array(tierSchema).min(3),
  whatHappens: z.string(),
  texts: z.object({ button: z.string() }),
});

const FIXTURE = fixtureSchema.parse(JSON.parse(FIXTURE_TIERS_OFFER_BODY));

/** The tier the walk orders: on sale, and its prices are not another tier's. */
const ORDERED = FIXTURE.tiers.find((tier) => tier.id === 'fixture-beta');
/** The tier that is listed and cannot be ordered. */
const CLOSED = FIXTURE.tiers.find((tier) => tier.onSale === false);

if (ORDERED === undefined || CLOSED === undefined) throw new Error('the tiers fixture lost a tier this spec reads');

function tierRows(page: Page): Locator {
  return page.locator('[data-slot="plan-tier"]');
}

function tierRow(page: Page, id: string): Locator {
  return page.locator(`[data-slot="plan-tier"][data-tier-id="${id}"]`);
}

function whatHappensBox(page: Page): Locator {
  return page.locator('[data-slot="plan-what-happens"]');
}

function termsBox(page: Page): Locator {
  return page.locator('[data-slot="plan-consent-terms"]');
}

function earlyStartBox(page: Page): Locator {
  return page.locator('[data-slot="plan-consent-early-start"]');
}

function orderButton(page: Page): Locator {
  return page.getByRole('button', { name: FIXTURE.texts.button });
}

/** The page-relative top of an element, so a scroll is not read as a move. */
function topOf(locator: Locator): Promise<number> {
  return locator.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('every tier the biller sends is listed from its own data, and one that is not on sale has no radio', async ({
  page,
}) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
  await expect(tierRows(page)).toHaveCount(FIXTURE.tiers.length + 1);
  for (const tier of FIXTURE.tiers) {
    const row = tierRow(page, tier.id);
    await expect(row.locator('[data-slot="tier-name"]')).toHaveText(tier.name);
    await expect(row.locator('[data-slot="tier-description"]')).toHaveText(tier.description);
  }

  // THE TIER THAT IS NOT ON SALE: listed with its note, and nothing to pick.
  await expect(tierRow(page, CLOSED.id).locator('[data-slot="tier-not-on-sale"]')).toHaveText(EN.plan.tiers.notOnSale);
  await expect(tierRow(page, CLOSED.id).locator('input[type="radio"]')).toHaveCount(0);
  // THE CONTROL: a tier on sale has the radio, so the line above can fail.
  await expect(tierRow(page, ORDERED.id).locator('input[type="radio"]')).toHaveCount(1);
});

test('picking a tier shows its prices, the data box sits above the two boxes, and the order names the tier', async ({
  page,
}) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  const orders = await routeOrder(page, [{ status: 200, json: { url: `${E2E_APP_URL}/settings/plan?checkout=cancelled` } }]);
  await openPlanPageSignedIn(page);

  // BEFORE A PICK there is no order block, so nothing can be ordered by accident.
  await expect(whatHappensBox(page)).toHaveCount(0);
  await tierRow(page, ORDERED.id).click();

  await expect(whatHappensBox(page)).toBeVisible();
  // THE BILLER'S LINES, as served, one paragraph each.
  for (const line of FIXTURE.whatHappens.split(/\n\s*\n/u)) {
    await expect(whatHappensBox(page).getByText(line, { exact: true })).toBeVisible();
  }
  // ABOVE THE BOXES, on screen and in the order of the markup.
  await expect(termsBox(page)).toBeVisible();
  expect(await topOf(whatHappensBox(page))).toBeLessThan(await topOf(termsBox(page)));
  expect(await topOf(whatHappensBox(page))).toBeLessThan(await topOf(earlyStartBox(page)));

  // THE ORDER CARRIES THE TIER and the plan the person picked.
  const [onlyPlan] = Object.values(ORDERED.prices);
  if (onlyPlan === undefined) throw new Error('the ordered tier has no price in the fixture');
  await page.locator(`[data-slot="plan-card"][data-plan-key="${onlyPlan.key}"]`).click();
  await termsBox(page).check();
  await earlyStartBox(page).check();
  await orderButton(page).click();
  await page.waitForURL('**/settings/plan?checkout=cancelled');
  expect(orders.bodies).toHaveLength(1);
  expect(orders.bodies[0]).toMatchObject({
    tier: ORDERED.id,
    plan: onlyPlan.key,
    consentVersion: FIXTURE.consentVersion,
    consents: { terms: true, earlyStart: true },
  });
});

test('nothing moves while the tier list settles, and picking a tier moves nothing above the tap', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();

  await settleAnimations(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  await settleFrames(page);
  const listTop = await topOf(page.locator('[data-slot="plan-tiers"]'));
  const firstRowTop = await topOf(tierRows(page).first());
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift on the plan page').toBe(0);

  // PICKING ADDS THE ORDER BLOCK BELOW THE LIST, the expansion the person asked for. Nothing above it moves.
  await tierRow(page, ORDERED.id).click();
  await expect(whatHappensBox(page)).toBeVisible();
  await settleFrames(page);
  expect(await topOf(page.locator('[data-slot="plan-tiers"]'))).toBe(listTop);
  expect(await topOf(tierRows(page).first())).toBe(firstRowTop);
});

test('the control: an offer with no tiers draws no tier list and the order block it always had', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(page.locator('[data-slot="plan-card"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="plan-tiers"]')).toHaveCount(0);
  await expect(whatHappensBox(page)).toHaveCount(0);
});
