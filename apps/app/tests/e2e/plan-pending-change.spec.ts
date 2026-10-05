/**
 * A booked downgrade on the plan page, and the card that is declined on an
 * upgrade (M2, openplate-billing `feat/m2-tiers`).
 *
 * A downgrade takes effect at the end of the paid period, so until then the
 * subscription is on one tier and booked to move to another. The biller names
 * the booked tier and the day on `GET /plans/me`; the status card says it
 * ("Switches to <tier> on <day>") and offers "Keep <current tier>", which posts
 * `POST /v1/plans/pending-change/cancel`. An upgrade is paid at once, and a
 * declined card answers 402 `payment-failed`: the person stays on the old tier.
 *
 * WHAT IS REAL: the production build, the account, the session, the plan page,
 * the decoders, the status card, the order client and the cancel client. WHAT
 * IS STUBBED: the handshake's `plans: true`, the plan and offer reads, the
 * order route and the cancel route (`plans-stub.ts`). Tier names come from the
 * neutral tiers fixture and are compared with what the page draws.
 *
 * LAYOUT IS READ, NEVER PHOTOGRAPHED. The slot for the line and the button is
 * reserved from the first paint for a tier subscriber, so the line arriving, the
 * line leaving and a refused card move nothing: each test reads
 * `getBoundingClientRect` before and after and a `layout-shift` total of 0.
 *
 * THE CONTROLS: a subscriber the biller puts on no tier gets no slot; a view
 * with nothing booked has the slot empty; the empty slot and the full one are
 * the same height; a second press, which the biller answers with 409
 * `no-pending-change`, ends the same way as the first.
 *
 * @area plans-and-paywall
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
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
  FIXTURE_TIERS_OFFER_BODY,
  MONTHLY_SUBSCRIBER_VIEW,
  createGate,
  openPlanPageSignedIn,
  routeOrder,
  routePendingCancel,
  routePlansCore,
  subscriberOnTier,
  subscriberWithPendingChange,
  type PlansStub,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

const fixtureSchema = z.object({
  consentVersion: z.string(),
  tiers: z.array(z.object({ id: z.string(), name: z.string() })).min(4),
  texts: z.object({ button: z.string() }),
});

const FIXTURE = fixtureSchema.parse(JSON.parse(FIXTURE_TIERS_OFFER_BODY));
const [, LOW, MIDDLE, HIGH] = FIXTURE.tiers;

if (LOW === undefined || MIDDLE === undefined || HIGH === undefined) {
  throw new Error('the tiers fixture lost a tier this spec reads');
}

/** A start instant at noon UTC, so the date reads the same in any time zone. */
const PENDING_AT = '2026-10-09T12:00:00.000Z';

/** The subscriber on the middle tier with a downgrade to the lowest tier booked. */
const BOOKED_VIEW = subscriberWithPendingChange({ tier: MIDDLE.id, pendingTier: LOW.id, pendingChangeAt: PENDING_AT });

/** The same subscriber with nothing booked, what the biller answers after the change is taken back. */
const PLAIN_VIEW = subscriberOnTier(MIDDLE.id);

/** The status card's pending slot. */
function slotOf(page: Page): Locator {
  return page.locator('[data-slot="plan-pending-change"]');
}

function keepButton(page: Page): Locator {
  return page.locator('[data-slot="plan-pending-keep"]');
}

/** The one reported line under the status card, empty and invisible until a portal press fails. */
function reportLine(page: Page): Locator {
  return page.locator('[data-slot="plan-portal-line"]');
}

function pendingLine(page: Page): Locator {
  return page.locator('[data-slot="plan-pending-line"]');
}

function statusCard(page: Page): Locator {
  return page.locator('[data-slot="plan-status-card"]');
}

/** The page-relative top and height of an element, so a scroll is not read as a move. */
async function rectOf(locator: Locator): Promise<{ top: number; height: number }> {
  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: rect.height };
  });
}

/** What the line says for the booked view, from the shipped catalog and the day the biller named. */
function expectedLine() {
  const [head = '', afterTier = ''] = EN.plan.pending.line.split('{{tier}}');
  const [mid = '', tail = ''] = afterTier.split('{{date}}');
  return { head, mid, tail };
}

async function openWith(page: Page, stub: PlansStub): Promise<void> {
  await routePlansCore(page, stub);
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('a booked downgrade shows the tier it moves to, the day, and a button that keeps the current tier', async ({
  page,
}) => {
  await openWith(page, { planView: BOOKED_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(slotOf(page)).toHaveAttribute('data-state', 'booked');
  const { head, mid, tail } = expectedLine();
  const text = await pendingLine(page).innerText();
  expect(text.startsWith(head + LOW.name + mid), 'the line names the booked tier').toBe(true);
  expect(text.endsWith(tail), 'the line is the catalog sentence').toBe(true);
  expect(text, 'the line names the day the biller sent').toContain('2026');
  await expect(keepButton(page)).toHaveText(EN.plan.pending.keep.replace('{{tier}}', MIDDLE.name));
  await expect(keepButton(page)).toBeEnabled();
  // The slot lives in the status card, not beside it.
  await expect(statusCard(page).locator('[data-slot="plan-pending-change"]')).toHaveCount(1);
});

test('the control: nothing booked leaves the slot empty with its box, and no line names a tier', async ({ page }) => {
  await openWith(page, { planView: PLAIN_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
  await settleFrames(page);

  await expect(slotOf(page)).toHaveAttribute('data-state', 'empty');
  await expect(keepButton(page)).toBeHidden();
  await expect(pendingLine(page)).toHaveText(/^\s*$/u);
  // THE BOX IS THERE: an empty slot is as tall as the button that will fill it, and then some.
  expect((await rectOf(slotOf(page))).height).toBeGreaterThan(44);
});

test('the control: a subscriber the biller puts on no tier gets the status card it always had, with no slot', async ({
  page,
}) => {
  await openWith(page, { planView: MONTHLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);
  await expect(statusCard(page)).toBeVisible();
  await settleFrames(page);
  await expect(slotOf(page)).toHaveCount(0);
  await expect(keepButton(page)).toHaveCount(0);
});

test('the line arrives with the offer and moves nothing: the card, the report line under it and the layout stay put', async ({
  page,
}) => {
  const offerGate = createGate();
  await openWith(page, { planView: BOOKED_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY, offerGate: offerGate.promise });
  await openPlanPageSignedIn(page);

  // THE CARD IS DRAWN, THE OFFER IS NOT: no tier has a name yet, so the slot is empty and reserved.
  await expect(statusCard(page)).toBeVisible();
  await expect(slotOf(page)).toHaveAttribute('data-state', 'empty');
  await settleAnimations(page);
  await settleFrames(page);
  const slotBefore = await rectOf(slotOf(page));
  const cardBefore = await rectOf(statusCard(page));
  const reportBefore = await rectOf(reportLine(page));
  const shiftsBefore = (await readShiftEntries(page)).length;

  offerGate.open();
  await expect(slotOf(page)).toHaveAttribute('data-state', 'booked');
  await settleFrames(page);

  expect(await rectOf(slotOf(page))).toEqual(slotBefore);
  expect(await rectOf(statusCard(page))).toEqual(cardBefore);
  expect(await rectOf(reportLine(page)), 'what sits below the card moved').toEqual(reportBefore);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift when the line arrived').toBe(0);
});

test('Keep cancels the change over a bodiless POST, reads the plan again and the line goes without moving anything', async ({
  page,
}) => {
  const stub: PlansStub = { planView: BOOKED_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY };
  const reads = await routePlansCore(page, stub);
  const cancels = await routePendingCancel(
    page,
    [{ status: 200, json: { kept: { plan: 'monthly', tier: MIDDLE.id } } }],
    // After the cancel the biller's next `GET /plans/me` carries no booked change.
    () => {
      stub.planView = PLAIN_VIEW;
    },
  );
  await openPlanPageSignedIn(page);
  await expect(slotOf(page)).toHaveAttribute('data-state', 'booked');
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();

  await settleAnimations(page);
  await settleFrames(page);
  const readsBefore = reads.planViews;
  const tops = await readTops(page);
  const slotBefore = await rectOf(slotOf(page));
  const cardBefore = await rectOf(statusCard(page));
  const shiftsBefore = (await readShiftEntries(page)).length;

  await keepButton(page).click();

  await expect(slotOf(page)).toHaveAttribute('data-state', 'empty');
  await expect.poll(() => reads.planViews, 'the plan was read again after the cancel').toBeGreaterThan(readsBefore);
  expect(cancels.methods).toEqual(['POST']);
  // THE BILLER READS NO BODY: nothing is sent that could name a price or a tier.
  expect(cancels.bodies.every((body) => body === null || body === '')).toBe(true);
  // THE LINE LEFT, AND THE PAGE DID NOT MOVE.
  await settleFrames(page);
  expect(await rectOf(slotOf(page))).toEqual(slotBefore);
  expect(await rectOf(statusCard(page))).toEqual(cardBefore);
  const after = await readTops(page);
  const moved = movedBetween(Object.fromEntries(Object.entries(tops).filter(([key]) => key in after)), after);
  expect(moved, 'something moved when the change was taken back').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift on keeping the tier').toBe(0);
  // THE TIER IS STILL THE ONE THE PERSON HAD.
  await expect(page.locator(`[data-slot="plan-tier"][data-tier-id="${MIDDLE.id}"] [data-slot="tier-current"]`)).toHaveText(
    EN.plan.tiers.current,
  );
});

test('a second press is answered 409 no-pending-change, and that ends the same way: the change is gone', async ({
  page,
}) => {
  const stub: PlansStub = { planView: BOOKED_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY };
  await routePlansCore(page, stub);
  // The first answer is already "nothing booked": somebody took it back on another device.
  const cancels = await routePendingCancel(page, [{ status: 409, json: { error: 'no-pending-change' } }], () => {
    stub.planView = PLAIN_VIEW;
  });
  await openPlanPageSignedIn(page);
  await expect(slotOf(page)).toHaveAttribute('data-state', 'booked');

  await keepButton(page).click();

  await expect(slotOf(page)).toHaveAttribute('data-state', 'empty');
  expect(cancels.methods).toEqual(['POST']);
  // NOT AN ERROR: the report line stays empty.
  await expect(reportLine(page)).not.toHaveAttribute('role', 'alert');
});

test('a Stripe failure is said in the sentence\'s own place, adds no line, and the button works again', async ({
  page,
}) => {
  await openWith(page, { planView: BOOKED_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  const cancels = await routePendingCancel(page, [{ status: 502, json: { error: 'pending-change-cancel-failed' } }]);
  await openPlanPageSignedIn(page);
  await expect(slotOf(page)).toHaveAttribute('data-state', 'booked');
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();

  await settleAnimations(page);
  await settleFrames(page);
  // THE CONTROL: before the press the sentence is the booked change and nothing is an alert.
  await expect(pendingLine(page)).not.toHaveAttribute('role', 'alert');
  await expect(pendingLine(page)).toContainText(LOW.name);
  const tops = await readTops(page);
  const slotBefore = await rectOf(slotOf(page));
  const reportBefore = await rectOf(reportLine(page));
  const shiftsBefore = (await readShiftEntries(page)).length;

  await keepButton(page).click();

  await expect(pendingLine(page)).toHaveText(EN.plan.pending.keepFailed);
  await expect(pendingLine(page)).toHaveAttribute('role', 'alert');
  // THE CHANGE IS STILL BOOKED and the person can press again.
  await expect(slotOf(page)).toHaveAttribute('data-state', 'booked');
  await expect(keepButton(page)).toBeEnabled();
  expect(cancels.methods).toEqual(['POST']);
  await settleFrames(page);
  expect(await rectOf(slotOf(page))).toEqual(slotBefore);
  expect(await rectOf(reportLine(page))).toEqual(reportBefore);
  const after = await readTops(page);
  expect(movedBetween(Object.fromEntries(Object.entries(tops).filter(([key]) => key in after)), after)).toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift after the failure').toBe(0);
});

test('a downgrade booked on this page shows its line at once, from the order answer, and Keep takes it back', async ({
  page,
}) => {
  const stub: PlansStub = { planView: PLAIN_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY };
  await routePlansCore(page, stub);
  // The order answer names the booked change at the top level, beside `switched`.
  await routeOrder(page, [
    {
      status: 200,
      json: {
        switched: { plan: 'monthly', tier: LOW.id, effect: 'period-end', startsAt: PENDING_AT },
        pendingTier: LOW.id,
        pendingChangeAt: PENDING_AT,
      },
    },
  ]);
  await routePendingCancel(page, [{ status: 200, json: { kept: { plan: 'monthly', tier: MIDDLE.id } } }]);
  await openPlanPageSignedIn(page);
  await expect(slotOf(page)).toHaveAttribute('data-state', 'empty');

  await page.locator(`[data-slot="plan-tier"][data-tier-id="${LOW.id}"] [data-slot="tier-switch"]`).click();
  await page.locator('[data-slot="plan-card"][data-plan-key="monthly"]').click();
  await page.locator('[data-slot="plan-consent-terms"]').check();
  await page.locator('[data-slot="plan-consent-early-start"]').check();
  await page.getByRole('button', { name: FIXTURE.texts.button }).click();

  // THE PLAN READ STILL SAYS NOTHING BOOKED (the stub is not updated), yet the card has the line.
  await expect(slotOf(page)).toHaveAttribute('data-state', 'booked');
  await expect(pendingLine(page)).toContainText(LOW.name);

  await keepButton(page).click();
  await expect(slotOf(page)).toHaveAttribute('data-state', 'empty');
});

test('a declined card on an upgrade says so above the button, and the plan, the card and the layout stay as they were', async ({
  page,
}) => {
  await openWith(page, { planView: PLAIN_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  const orders = await routeOrder(page, [{ status: 402, json: { error: 'payment-failed' } }]);
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();

  await page.locator(`[data-slot="plan-tier"][data-tier-id="${HIGH.id}"] [data-slot="tier-switch"]`).click();
  await page.locator('[data-slot="plan-card"][data-plan-key="monthly"]').click();
  await page.locator('[data-slot="plan-consent-terms"]').check();
  await page.locator('[data-slot="plan-consent-early-start"]').check();
  const orderButton = page.getByRole('button', { name: FIXTURE.texts.button });
  const line = page.locator('[data-slot="plan-action-line"]');
  // THE CONTROL: before the press the page says nothing about a card.
  await expect(page.getByText(EN.plan.order.paymentFailed)).toHaveCount(0);

  await settleAnimations(page);
  await settleFrames(page);
  const cardBefore = await rectOf(statusCard(page));
  const buttonBefore = await rectOf(orderButton);
  const tops = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  await orderButton.click();

  await expect(line).toHaveText(EN.plan.order.paymentFailed);
  await expect(line).toHaveAttribute('role', 'alert');
  expect(orders.bodies).toHaveLength(1);
  // THE PERSON STAYS ON THE OLD TIER: no result line, the order block is still there, the own tier is still marked.
  await expect(page.locator('[data-slot="plan-move-result"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="plan-order"]')).toBeVisible();
  await expect(page.locator(`[data-slot="plan-tier"][data-tier-id="${MIDDLE.id}"] [data-slot="tier-current"]`)).toHaveText(
    EN.plan.tiers.current,
  );
  await expect(slotOf(page)).toHaveAttribute('data-state', 'empty');
  // NOTHING MOVED: the status card, the button under the line, everything above the order.
  await settleFrames(page);
  expect(await rectOf(statusCard(page))).toEqual(cardBefore);
  expect(await rectOf(orderButton)).toEqual(buttonBefore);
  const after = await readTops(page);
  expect(movedBetween(Object.fromEntries(Object.entries(tops).filter(([key]) => key in after)), after)).toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift after the refusal').toBe(0);
  // AND THE BUTTON WORKS AGAIN: the same order can be pressed once more.
  await expect(orderButton).toBeEnabled();
});
