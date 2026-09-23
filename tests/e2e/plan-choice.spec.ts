/**
 * The plan cards on the plan page, drawn from a stubbed offer (M250/02).
 *
 * WHAT IS REAL: the production build, the account, the session, the plan page,
 * the offer decoder and the card arithmetic. WHAT IS STUBBED: the handshake's
 * `plans: true` and the two plan reads, answered from
 * `tests/fixtures/plan-offer.json` (see `plans-stub.ts`).
 *
 * The expected figures are computed HERE, from the fixture's own numbers with
 * this file's own `Intl` call, and never imported from `plan-prices.ts`: the
 * app's arithmetic is the thing under test, and a spec that borrowed it would
 * agree with any mistake it made.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN, fill } from './copy';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW, openPlanPageSignedIn, routePlansCore } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The two prices the fixture offer holds, in cents. */
interface FixturePrices {
  monthlyCents: number;
  yearlyCents: number;
}

/** The part of the fixture this spec reads, validated rather than asserted. */
const fixtureSchema = z.object({ plans: z.array(z.object({ key: z.string(), grossCents: z.number() })) });

/** The fixture's two prices, parsed here rather than typed, so the spec follows the fixture. */
function fixturePrices(): FixturePrices {
  const offer = fixtureSchema.parse(JSON.parse(FIXTURE_OFFER_BODY));
  const monthlyCents = offer.plans.find((plan) => plan.key === 'monthly')?.grossCents;
  const yearlyCents = offer.plans.find((plan) => plan.key === 'yearly')?.grossCents;
  if (monthlyCents === undefined || yearlyCents === undefined) throw new Error('the fixture offer lost a plan');
  return { monthlyCents, yearlyCents };
}

/** A euro amount the way an English reader sees it. */
function euros(cents: number): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

function planCard(page: Page, key: string): Locator {
  return page.locator(`[data-slot="plan-card"][data-plan-key="${key}"]`);
}

/** The order button, named by the fixture offer's own label: the app writes none. */
function startButton(page: Page): Locator {
  return page.locator('[data-slot="plan-order-button"]');
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('the plan cards show both plans, the monthly equivalent and the saving', async ({ page }) => {
  const offerRequests = await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(page.getByRole('group', { name: EN.plan.choice.legend })).toBeVisible();
  const radios = page.getByRole('radio');
  await expect(radios).toHaveCount(2);
  // NOTHING IS PICKED for the person who arrived without a link naming a plan.
  for (const radio of await radios.all()) await expect(radio).not.toBeChecked();
  expect(offerRequests.locales, 'one offer read, in the page language').toEqual(['en']);

  const { monthlyCents, yearlyCents } = fixturePrices();
  const equivalent = euros(Math.round(yearlyCents / 12));
  const savingPercent = Math.floor(((monthlyCents * 12 - yearlyCents) * 100) / (monthlyCents * 12));
  // The fixture was chosen so the answer is the README's worked example.
  expect(savingPercent).toBe(33);

  const yearly = planCard(page, 'yearly');
  await expect(yearly.locator('[data-slot="plan-monthly-equivalent"]')).toHaveText(
    fill(EN.plan.choice.monthlyEquivalent, { price: equivalent }),
  );
  await expect(yearly.locator('[data-slot="plan-saving"]')).toHaveText(
    fill(EN.plan.choice.saving, { saving: `${savingPercent}%` }),
  );
  await expect(yearly.locator('[data-slot="plan-price"]')).toContainText(euros(yearlyCents));
  await expect(planCard(page, 'monthly').locator('[data-slot="plan-price"]')).toContainText(euros(monthlyCents));

  // THE CONTROL: the monthly card reserves the same two lines and shows neither.
  await expect(planCard(page, 'monthly').locator('[data-slot="plan-saving"]')).toBeHidden();
  await expect(planCard(page, 'monthly').locator('[data-slot="plan-monthly-equivalent"]')).toBeHidden();

  // The radio's accessible name carries the interval, the price and the term.
  const yearlyRadio = page.getByRole('radio', { name: EN.plan.choice.interval.year });
  await expect(yearlyRadio).toHaveAccessibleName(new RegExp(euros(yearlyCents).replace('.', '\\.')));
  await expect(yearlyRadio).toHaveAccessibleName(/Fixture term text for the yearly plan\./);
});

test('picking a plan clears its hint and moves nothing on the page', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);
  await expect(planCard(page, 'yearly')).toBeVisible();

  await expect(startButton(page)).toBeDisabled();
  await expect(page.getByText(EN.plan.choice.pickFirst)).toBeVisible();

  await settleAnimations(page);
  const before = await readTops(page);
  const actionLineBefore = await page
    .locator('[data-slot="plan-action-line"]')
    .evaluate((node) => node.getBoundingClientRect().top);
  const entriesBefore = (await readShiftEntries(page)).length;

  await planCard(page, 'yearly').click();
  await settleFrames(page);
  await settleAnimations(page);

  await expect(page.getByRole('radio', { name: EN.plan.choice.interval.year })).toBeChecked();
  // Still held: the order also needs both boxes (`plan-order.spec.ts`).
  await expect(startButton(page)).toBeDisabled();
  await expect(page.getByText(EN.plan.choice.pickFirst)).toBeHidden();

  const after = await readTops(page);
  const entries = (await readShiftEntries(page)).slice(entriesBefore);
  const report = entries.flatMap((entry) => entry.sources).join('\n');
  expect(movedBetween(before, after), `the pick moved something\n${report}`).toEqual([]);
  expect(shiftScoreAfter(entries, 0), `layout-shift after the pick\n${report}`).toBe(0);
  const actionLineAfter = await page
    .locator('[data-slot="plan-action-line"]')
    .evaluate((node) => node.getBoundingClientRect().top);
  expect(actionLineAfter).toBe(actionLineBefore);

  // THE CONTROL that the reading sees a move at all: pushing a line in above
  // the buttons must be reported by the same two readers.
  const controlBefore = await readTops(page);
  const controlEntries = (await readShiftEntries(page)).length;
  await page.locator('[data-slot="plan-choice"]').evaluate((node) => {
    const line = document.createElement('p');
    line.textContent = 'control line';
    line.style.height = '40px';
    node.after(line);
  });
  await settleFrames(page);
  expect(
    movedBetween(controlBefore, await readTops(page)).length,
    'CONTROL: an injected line must move the buttons',
  ).toBeGreaterThan(0);
  await expect
    .poll(async () => shiftScoreAfter((await readShiftEntries(page)).slice(controlEntries), 0), {
      message: 'CONTROL: an injected line must register a layout shift',
    })
    .toBeGreaterThan(0);
});

test('a link that names a plan arrives with that plan picked', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page, '?plan=yearly');
  await expect(page.getByRole('radio', { name: EN.plan.choice.interval.year })).toBeChecked();
  await expect(page.getByRole('radio', { name: EN.plan.choice.interval.month })).not.toBeChecked();
  await expect(page.getByText(EN.plan.choice.pickFirst)).toBeHidden();
});

test('an offer that does not decode draws no cards and no order, and says so', async ({ page }) => {
  // The checkout route the old button called is gone (410), so with no offer
  // there is nothing honest to press: unknown must not sell.
  const broken = JSON.stringify({ ...JSON.parse(FIXTURE_OFFER_BODY), plans: [{ key: 'yearly' }] });
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: broken });
  await openPlanPageSignedIn(page);
  await expect(page.getByText(EN.plan.order.unavailable)).toBeVisible();
  await expect(startButton(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(0);
});
