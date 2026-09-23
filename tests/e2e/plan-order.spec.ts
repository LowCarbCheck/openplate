/**
 * The order page, drawn from a stubbed offer (M245/04), and the move from the
 * monthly to the yearly plan on the same page (M245/07).
 *
 * WHAT IS REAL: the production build, the account, the session, the plan page,
 * the offer decoder, the order client and the order block. WHAT IS STUBBED: the
 * handshake's `plans: true`, the plan and offer reads (`plans-stub.ts`, texts
 * from the neutral fixture offer) and `POST /v1/plans/order`, whose body is
 * recorded so the consents it carries are read off the wire.
 *
 * No assertion pins a sentence: the order texts are the fixture's, read from
 * the fixture, and the app's own lines are read from the shipped catalog.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN, fill } from './copy';
import { E2E_APP_URL } from './env';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import {
  FIXTURE_OFFER_BODY,
  MONTHLY_SUBSCRIBER_VIEW,
  NO_SUBSCRIPTION_VIEW,
  YEARLY_SUBSCRIBER_VIEW,
  openPlanPageSignedIn,
  routeOrder,
  routePlansCore,
  type PlansStub,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The part of the fixture offer this spec reads, validated rather than asserted. */
const fixtureSchema = z.object({
  consentVersion: z.string(),
  texts: z.object({
    button: z.string(),
    paymentNote: z.string(),
    switchNote: z.string(),
    termsConsent: z.string(),
  }),
  links: z.object({ terms: z.string(), withdrawal: z.string() }),
});

const FIXTURE = fixtureSchema.parse(JSON.parse(FIXTURE_OFFER_BODY));

/** The fixture offer with a new version, standing in for a page the biller changed. */
const CHANGED_OFFER_BODY = JSON.stringify({ ...JSON.parse(FIXTURE_OFFER_BODY), consentVersion: 'fixture-consent-2' });

function orderBlock(page: Page): Locator {
  return page.locator('[data-slot="plan-order"]');
}

function orderButton(page: Page): Locator {
  return page.getByRole('button', { name: FIXTURE.texts.button });
}

function termsBox(page: Page): Locator {
  return page.locator('[data-slot="plan-consent-terms"]');
}

function earlyStartBox(page: Page): Locator {
  return page.locator('[data-slot="plan-consent-early-start"]');
}

function statusCard(page: Page): Locator {
  return page.locator('[data-slot="plan-status-card"]');
}

/**
 * Whether the order button is the last element of the block, in the markup
 * and on screen: no element after it, and nothing drawn lower. The boxes that
 * CONTAIN the button are not read, because their padding sits below it.
 */
function isButtonLast(block: Locator): Promise<boolean> {
  return block.evaluate((node) => {
    const button = node.querySelector('[data-slot="plan-order-button"]');
    const all = node.querySelectorAll('*');
    const last = all.item(all.length - 1);
    if (button === null) return false;
    const buttonBottom = button.getBoundingClientRect().bottom;
    const others = [...all].filter((element) => !element.contains(button));
    const lowest = Math.max(...others.map((element) => element.getBoundingClientRect().bottom));
    return (last === button || button.contains(last)) && lowest <= buttonBottom;
  });
}

/** Picks the yearly plan and ticks both boxes. */
async function pickYearlyAndConsent(page: Page): Promise<void> {
  await page.locator('[data-slot="plan-card"][data-plan-key="yearly"]').click();
  await termsBox(page).check();
  await earlyStartBox(page).check();
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('the button enables only after a pick and both boxes, and the order carries both consents', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  const orders = await routeOrder(page, [{ status: 200, json: { url: `${E2E_APP_URL}/settings/plan?checkout=cancelled` } }]);
  await openPlanPageSignedIn(page);

  await expect(orderButton(page)).toBeVisible();
  // NOTHING IS TICKED FOR THE PERSON.
  await expect(termsBox(page)).not.toBeChecked();
  await expect(earlyStartBox(page)).not.toBeChecked();
  await expect(orderButton(page)).toBeDisabled();

  await page.locator('[data-slot="plan-card"][data-plan-key="yearly"]').click();
  await expect(orderButton(page)).toBeDisabled();
  await termsBox(page).check();
  await expect(orderButton(page)).toBeDisabled();
  await earlyStartBox(page).check();
  await expect(orderButton(page)).toBeEnabled();

  // THE CONTROL: taking one tick back holds the button again.
  await termsBox(page).uncheck();
  await expect(orderButton(page)).toBeDisabled();
  await termsBox(page).check();
  await expect(orderButton(page)).toBeEnabled();

  // The terms link sits inside the consent and points where the offer says.
  await expect(page.getByRole('link', { name: EN.chrome.terms, exact: true })).toHaveAttribute(
    'href',
    FIXTURE.links.terms,
  );

  await orderButton(page).click();
  await page.waitForURL('**/settings/plan?checkout=cancelled');
  expect(orders.bodies).toEqual([
    {
      plan: 'yearly',
      locale: 'en',
      consentVersion: FIXTURE.consentVersion,
      consents: { terms: true, earlyStart: true },
    },
  ]);
  expect(orders.checkoutCalls, 'the page reached for the gone checkout route').toBe(0);
});

test('the button is the last thing in the order block', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);
  await expect(orderButton(page)).toBeVisible();

  expect(await isButtonLast(orderBlock(page))).toBe(true);

  // THE CONTROL: a line added after the button is seen by the same reading.
  await orderBlock(page).evaluate((node) => {
    const line = document.createElement('p');
    line.textContent = 'control line';
    node.querySelector('[data-slot="plan-order-button"]')?.after(line);
  });
  expect(await isButtonLast(orderBlock(page))).toBe(false);
});

test('a failed order says so above the button, moves nothing, and can be tried again', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  const orders = await routeOrder(page, [{ status: 502, json: { error: 'checkout-failed' } }]);
  await openPlanPageSignedIn(page);
  await pickYearlyAndConsent(page);
  await expect(orderButton(page)).toBeEnabled();

  await settleAnimations(page);
  const before = await readTops(page);
  // PAGE-relative, for `readTops`' reason: the click scrolls the button into
  // view once the free card (M250/10) has put it below the fold, and a scroll
  // is not a shift.
  const buttonTopBefore = await orderButton(page).evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  const entriesBefore = (await readShiftEntries(page)).length;

  await orderButton(page).click();
  const line = page.locator('[data-slot="plan-action-line"]');
  await expect(line).toHaveText(EN.plan.order.failed);
  await expect(line).toHaveAttribute('role', 'alert');
  await settleFrames(page);
  await settleAnimations(page);

  const entries = (await readShiftEntries(page)).slice(entriesBefore);
  const report = entries.flatMap((entry) => entry.sources).join('\n');
  expect(movedBetween(before, await readTops(page)), `the failure moved something\n${report}`).toEqual([]);
  expect(shiftScoreAfter(entries, 0), `layout-shift after the failure\n${report}`).toBe(0);
  expect(await orderButton(page).evaluate((node) => node.getBoundingClientRect().top + window.scrollY)).toBe(
    buttonTopBefore,
  );

  // Retry is possible: the button works again and the boxes stay ticked.
  await expect(orderButton(page)).toBeEnabled();
  await orderButton(page).click();
  await expect.poll(() => orders.bodies.length).toBe(2);

  // THE CONTROL that the reading sees a move at all.
  const controlBefore = await readTops(page);
  const controlEntries = (await readShiftEntries(page)).length;
  await page.locator('[data-slot="plan-choice"]').evaluate((node) => {
    const extra = document.createElement('p');
    extra.textContent = 'control line';
    extra.style.height = '40px';
    node.after(extra);
  });
  await settleFrames(page);
  expect(movedBetween(controlBefore, await readTops(page)).length, 'CONTROL: nothing moved').toBeGreaterThan(0);
  await expect
    .poll(async () => shiftScoreAfter((await readShiftEntries(page)).slice(controlEntries), 0), {
      message: 'CONTROL: an injected line must register a layout shift',
    })
    .toBeGreaterThan(0);
});

test('a stale page is read again, keeps the pick, clears both boxes and says why', async ({ page }) => {
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
  const offers = await routePlansCore(page, stub);
  const orders = await routeOrder(page, [
    { status: 400, json: { error: 'order-stale-version' } },
    { status: 200, json: { url: `${E2E_APP_URL}/settings/plan?checkout=cancelled` } },
  ]);
  await openPlanPageSignedIn(page);
  await pickYearlyAndConsent(page);
  expect(offers.locales).toEqual(['en']);

  // The biller changed the page while the person read it.
  stub.offerBody = CHANGED_OFFER_BODY;
  await orderButton(page).click();

  await expect(page.locator('[data-slot="plan-action-line"]')).toHaveText(EN.plan.order.stale);
  await expect.poll(() => offers.locales).toEqual(['en', 'en']);
  await expect(page.getByRole('radio', { name: EN.plan.choice.interval.year })).toBeChecked();
  await expect(termsBox(page)).not.toBeChecked();
  await expect(earlyStartBox(page)).not.toBeChecked();
  await expect(orderButton(page)).toBeDisabled();

  // Confirmed again, the order names the page the person now read.
  await termsBox(page).check();
  await earlyStartBox(page).check();
  await orderButton(page).click();
  await page.waitForURL('**/settings/plan?checkout=cancelled');
  expect(orders.bodies.map((body) => z.object({ consentVersion: z.string() }).parse(body).consentVersion)).toEqual([
    FIXTURE.consentVersion,
    'fixture-consent-2',
  ]);
});

test('an account that already pays is shown its plan instead of the order', async ({ page }) => {
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
  await routePlansCore(page, stub);
  await routeOrder(page, [{ status: 409, json: { error: 'order-already-subscribed' } }]);
  await openPlanPageSignedIn(page);
  await pickYearlyAndConsent(page);
  await expect(statusCard(page)).toHaveCount(0);

  // Paid in another tab; the webhook has arrived by the time the page asks.
  stub.planView = YEARLY_SUBSCRIBER_VIEW;
  await orderButton(page).click();

  await expect(statusCard(page)).toHaveAttribute('data-plan-key', 'yearly');
  await expect(orderBlock(page)).toHaveCount(0);
  await expect(page.getByText(EN.plan.order.alreadySubscribed)).toBeVisible();
});

test('a monthly subscriber orders the yearly plan on the same page, and the move is booked', async ({ page }) => {
  const offers = await routePlansCore(page, { planView: MONTHLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_OFFER_BODY });
  const startsAt = MONTHLY_SUBSCRIBER_VIEW.currentPeriodEnd;
  const orders = await routeOrder(page, [{ status: 200, json: { switched: { plan: 'yearly', startsAt } } }]);
  await openPlanPageSignedIn(page);

  // The status card first, with the link, and no order until it is followed.
  await expect(statusCard(page)).toHaveAttribute('data-plan-key', 'monthly');
  await expect(orderBlock(page)).toHaveCount(0);
  expect(offers.locales).toEqual([]);

  await page.getByRole('link', { name: EN.plan.card.orderYearly }).click();
  await expect(orderBlock(page)).toHaveAttribute('data-order-mode', 'switch');
  const longDate = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(startsAt));
  await expect(page.locator('[data-slot="plan-order-note"]')).toHaveText(FIXTURE.texts.switchNote.replace('{date}', longDate));
  await expect(page.getByText(FIXTURE.texts.paymentNote)).toHaveCount(0);
  // The yearly plan alone, and picked, because it is the only thing on offer.
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: EN.plan.choice.interval.year })).toBeChecked();
  await expect(orderButton(page)).toBeDisabled();

  await termsBox(page).check();
  await earlyStartBox(page).check();
  await orderButton(page).click();

  await expect(page.locator('[data-slot="plan-switch-booked"]')).toHaveText(
    fill(EN.plan.card.switchBooked, { date: longDate }),
  );
  await expect(orderBlock(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: EN.plan.card.orderYearly })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/settings/plan');
  expect(orders.bodies).toEqual([
    {
      plan: 'yearly',
      locale: 'en',
      consentVersion: FIXTURE.consentVersion,
      consents: { terms: true, earlyStart: true },
    },
  ]);
});

test('CONTROL: a yearly subscriber finds no link to order a plan', async ({ page }) => {
  await routePlansCore(page, { planView: YEARLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page, '?plan=yearly');
  await expect(statusCard(page)).toHaveAttribute('data-plan-key', 'yearly');
  await expect(page.getByRole('link', { name: EN.plan.card.orderYearly })).toHaveCount(0);
  await expect(orderBlock(page)).toHaveCount(0);
});
