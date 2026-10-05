/**
 * The plan page lists the biller's tiers, a subscriber moves between them, and
 * the order page says what happens to the person's data (M2/04, M2/05).
 *
 * WHAT IS REAL: the production build, the account, the session, the plan page,
 * the offer decoder, the tier list, the order client and the order block. WHAT
 * IS STUBBED: the handshake's `plans: true`, the plan and offer reads
 * (`plans-stub.ts`, the neutral fixture offer WITH TIERS, in the shape the
 * biller serves it) and `POST /v1/plans/order`, whose body is recorded and read
 * off the wire.
 *
 * NO TIER NAME OR PRICE IS PINNED. The names, the limits and the prices come
 * from the fixture file and are compared with what the page draws, so the page
 * is shown to display what the biller sent and nothing it was built with.
 *
 * THE MOVES. A subscriber on the middle tier presses "switch" on the higher
 * tier (the biller answers `effect: now`) and on the lower one (`period-end`).
 * Each says its effect in words BEFORE the order, from the tier ranks alone, and
 * AFTER it from the biller's own answer, which replaces the order block without
 * moving anything above it.
 *
 * THE LINKED TIER (M2/06). The website links a tier button to
 * `/settings/plan?tier=<id>&plan=<interval>` (through sign-up, which stores the
 * choice). A tier the offer sells is the pick of a first order, with the linked
 * interval, and its order block arrives IN THE SAME COMMIT as the list. An
 * unknown tier, a tier that is not on sale and no tier at all preselect nothing.
 *
 * THE CONTROLS: an offer with no tiers draws no list and the order block it
 * always had; a subscriber with no tier named gets no switch buttons; a move the
 * biller refuses keeps its order block and says so in the line that was already
 * there.
 *
 * @area plans-and-paywall
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_APP_URL } from './env';
import {
  installShiftObserver,
  readShiftEntries,
  readTops,
  movedBetween,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import {
  FIXTURE_OFFER_BODY,
  FIXTURE_TIERS_OFFER_BODY,
  MONTHLY_SUBSCRIBER_VIEW,
  NO_SUBSCRIPTION_VIEW,
  openPlanPageSignedIn,
  routeOrder,
  routePlansCore,
  subscriberOnTier,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

const priceSchema = z.object({ key: z.string(), grossCents: z.number() });

const tierSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isSold: z.boolean(),
  dailyAiLimit: z.number(),
  plans: z.array(priceSchema),
});

/** The part of the tiers fixture this spec reads, validated rather than asserted. */
const fixtureSchema = z.object({
  consentVersion: z.string(),
  tiers: z.array(tierSchema).min(4),
  texts: z.object({ button: z.string(), whatHappens: z.string() }),
});

const FIXTURE = fixtureSchema.parse(JSON.parse(FIXTURE_TIERS_OFFER_BODY));

/** The rank is the array order: the free entry, then the tiers lowest first. */
const [FREE, LOW, MIDDLE, HIGH] = FIXTURE.tiers;

if (FREE === undefined || LOW === undefined || MIDDLE === undefined || HIGH === undefined) {
  throw new Error('the tiers fixture lost a tier this spec reads');
}

/** A start instant at noon UTC, so the date reads the same in any time zone. */
const STARTS_AT = '2026-10-09T12:00:00.000Z';

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

function orderNote(page: Page): Locator {
  return page.locator('[data-slot="plan-order-note"]');
}

function moveResult(page: Page): Locator {
  return page.locator('[data-slot="plan-move-result"]');
}

/** The switch button of one tier. */
function switchButton(page: Page, id: string): Locator {
  return tierRow(page, id).locator('[data-slot="tier-switch"]');
}

/** The page-relative top of an element, so a scroll is not read as a move. */
function topOf(locator: Locator): Promise<number> {
  return locator.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
}

/** Ticks both consents, which a move asks for as a first order does. */
async function consent(page: Page): Promise<void> {
  await termsBox(page).check();
  await earlyStartBox(page).check();
}

/** A subscriber on the middle tier, the plan page open and its tier list drawn. */
async function openAsSubscriber(
  page: Page,
  planView: ReturnType<typeof subscriberOnTier> = subscriberOnTier(MIDDLE.id),
): Promise<void> {
  await routePlansCore(page, { planView, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('every entry the biller sends is listed from its own data, the free one first and without a radio', async ({
  page,
}) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
  await expect(tierRows(page)).toHaveCount(FIXTURE.tiers.length);
  // THE ORDER SERVED IS THE ORDER DRAWN.
  expect(await tierRows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tier-id')))).toEqual(
    FIXTURE.tiers.map((tier) => tier.id),
  );
  for (const tier of FIXTURE.tiers) {
    const row = tierRow(page, tier.id);
    await expect(row.locator('[data-slot="tier-name"]')).toHaveText(tier.name);
    await expect(row.locator('[data-slot="tier-description"]')).toHaveText(tier.description);
  }

  // THE FREE ENTRY: marked as the reader's own, and nothing to pick.
  await expect(tierRow(page, FREE.id).locator('[data-slot="tier-current"]')).toHaveText(EN.plan.tiers.current);
  await expect(tierRow(page, FREE.id).locator('input[type="radio"]')).toHaveCount(0);
  // THE CONTROL: a sold tier has the radio, so the line above can fail.
  await expect(tierRow(page, MIDDLE.id).locator('input[type="radio"]')).toHaveCount(1);
  // A first order has no switch button: it is a payment, not a move.
  await expect(page.locator('[data-slot="tier-switch"]')).toHaveCount(0);
});

test('picking a tier shows its prices, the data box sits above the two boxes, and the order names the tier', async ({
  page,
}) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  const orders = await routeOrder(page, [{ status: 200, json: { url: `${E2E_APP_URL}/settings/plan?checkout=cancelled` } }]);
  await openPlanPageSignedIn(page);

  // BEFORE A PICK there is no order block, so nothing can be ordered by accident.
  await expect(whatHappensBox(page)).toHaveCount(0);
  await tierRow(page, MIDDLE.id).click();

  await expect(whatHappensBox(page)).toBeVisible();
  // THE BILLER'S LINES, as served, one paragraph each.
  for (const line of FIXTURE.texts.whatHappens.split(/\n\s*\n/u)) {
    await expect(whatHappensBox(page).getByText(line, { exact: true })).toBeVisible();
  }
  // ABOVE THE BOXES, on screen and in the order of the markup.
  await expect(termsBox(page)).toBeVisible();
  expect(await topOf(whatHappensBox(page))).toBeLessThan(await topOf(termsBox(page)));
  expect(await topOf(whatHappensBox(page))).toBeLessThan(await topOf(earlyStartBox(page)));

  // THE ORDER CARRIES THE TIER and the plan the person picked, and nothing else about money.
  const monthly = MIDDLE.plans.find((plan) => plan.key === 'monthly');
  if (monthly === undefined) throw new Error('the picked tier has no monthly price in the fixture');
  await page.locator('[data-slot="plan-card"][data-plan-key="monthly"]').click();
  await consent(page);
  await orderButton(page).click();
  await page.waitForURL('**/settings/plan?checkout=cancelled');
  expect(orders.bodies).toEqual([
    {
      plan: 'monthly',
      tier: MIDDLE.id,
      locale: 'en',
      consentVersion: FIXTURE.consentVersion,
      consents: { terms: true, earlyStart: true },
    },
  ]);
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
  await tierRow(page, MIDDLE.id).click();
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

test('an upgrade says it takes effect now before the order, and what the biller answered after it', async ({ page }) => {
  await routePlansCore(page, { planView: subscriberOnTier(MIDDLE.id), offerBody: FIXTURE_TIERS_OFFER_BODY });
  const orders = await routeOrder(page, [
    { status: 200, json: { switched: { plan: 'monthly', tier: HIGH.id, effect: 'now', startsAt: STARTS_AT } } },
  ]);
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();

  // EVERY OTHER SOLD TIER HAS A SWITCH BUTTON, the own tier says it is the yearly plan, the free entry has none.
  await expect(tierRow(page, MIDDLE.id).locator('[data-slot="tier-current"]')).toHaveText(EN.plan.tiers.current);
  await expect(switchButton(page, LOW.id)).toBeVisible();
  await expect(switchButton(page, HIGH.id)).toBeVisible();
  await expect(switchButton(page, MIDDLE.id)).toHaveText(EN.plan.tiers.switchYearly);
  await expect(switchButton(page, FREE.id)).toHaveCount(0);

  await settleAnimations(page);
  const tops = await readTops(page);
  // THE READING STARTS HERE: what the hub before this page shifted is not this page's.
  const shiftsBefore = (await readShiftEntries(page)).length;
  await switchButton(page, HIGH.id).click();

  // BEFORE THE ORDER: the effect, from the ranks alone, in place of the payment note.
  await expect(orderNote(page)).toHaveText(EN.plan.move.effectNow);
  await expect(page.locator('[data-slot="plan-order"]')).toHaveAttribute('data-order-mode', 'move');
  // THE SAME TWO BOXES as a first order, and the privacy box above them.
  await expect(termsBox(page)).toBeVisible();
  await expect(whatHappensBox(page)).toBeVisible();
  await page.locator('[data-slot="plan-card"][data-plan-key="monthly"]').click();
  await expect(orderButton(page)).toBeDisabled();
  await consent(page);
  await expect(orderButton(page)).toBeEnabled();

  await orderButton(page).click();

  // AFTER: the biller's own effect, in the place the order block had.
  await expect(moveResult(page)).toHaveText(EN.plan.move.doneNow);
  await expect(moveResult(page)).toHaveAttribute('data-effect', 'now');
  await expect(page.locator('[data-slot="plan-order"]')).toHaveCount(0);
  expect(orders.bodies).toEqual([
    {
      plan: 'monthly',
      tier: HIGH.id,
      locale: 'en',
      consentVersion: FIXTURE.consentVersion,
      consents: { terms: true, earlyStart: true },
    },
  ]);
  // NOTHING ABOVE THE ORDER MOVED: the tier list stands where it did.
  await settleFrames(page);
  const after = await readTops(page);
  const moved = movedBetween(
    Object.fromEntries(Object.entries(tops).filter(([key]) => key in after)),
    after,
  );
  expect(moved, 'something above the order moved').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift on the plan page').toBe(0);
});

test('a downgrade says it takes effect at the end of the paid period, and shows the day the biller names', async ({
  page,
}) => {
  await routePlansCore(page, { planView: subscriberOnTier(MIDDLE.id), offerBody: FIXTURE_TIERS_OFFER_BODY });
  const orders = await routeOrder(page, [
    { status: 200, json: { switched: { plan: 'yearly', tier: LOW.id, effect: 'period-end', startsAt: STARTS_AT } } },
  ]);
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();

  await switchButton(page, LOW.id).click();
  await expect(orderNote(page)).toHaveText(EN.plan.move.effectPeriodEnd);
  // THE CONTROL for the sentence above: the upgrade's sentence is not on screen.
  await expect(page.getByText(EN.plan.move.effectNow)).toHaveCount(0);
  await page.locator('[data-slot="plan-card"][data-plan-key="yearly"]').click();
  await consent(page);
  await orderButton(page).click();

  await expect(moveResult(page)).toHaveAttribute('data-effect', 'period-end');
  const [head = '', tail = ''] = EN.plan.move.donePeriodEnd.split('{{date}}');
  const text = await moveResult(page).innerText();
  expect(text.startsWith(head) && text.endsWith(tail), 'the line is the catalog sentence').toBe(true);
  expect(text, 'the line names the day the biller sent').toContain('2026');
  expect(orders.bodies).toMatchObject([{ plan: 'yearly', tier: LOW.id }]);
});

test('a monthly subscriber can move to the yearly plan of their own tier, at the end of the period', async ({ page }) => {
  await openAsSubscriber(page);
  const orders = await routeOrder(page, [
    { status: 200, json: { switched: { plan: 'yearly', tier: MIDDLE.id, effect: 'period-end', startsAt: STARTS_AT } } },
  ]);

  await switchButton(page, MIDDLE.id).click();
  await expect(orderNote(page)).toHaveText(EN.plan.move.effectPeriodEnd);
  // ONLY THE YEARLY PLAN is offered on the own tier, and it needs no pick.
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="plan-card"][data-plan-key="yearly"]')).toBeVisible();
  await consent(page);
  await orderButton(page).click();
  await expect(moveResult(page)).toBeVisible();
  expect(orders.bodies).toMatchObject([{ plan: 'yearly', tier: MIDDLE.id }]);
});

test('a yearly subscriber has no switch on their own tier, and the control: the others still have one', async ({
  page,
}) => {
  await openAsSubscriber(page, subscriberOnTier(MIDDLE.id, 'yearly'));
  await expect(switchButton(page, MIDDLE.id)).toHaveCount(0);
  await expect(switchButton(page, HIGH.id)).toBeVisible();
  await expect(switchButton(page, LOW.id)).toBeVisible();
});

test('a move the biller refuses keeps the order block and says so in the line that was already there', async ({
  page,
}) => {
  await routePlansCore(page, { planView: subscriberOnTier(MIDDLE.id), offerBody: FIXTURE_TIERS_OFFER_BODY });
  await routeOrder(page, [{ status: 409, json: { error: 'order-already-subscribed' } }]);
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();

  await switchButton(page, HIGH.id).click();
  await page.locator('[data-slot="plan-card"][data-plan-key="monthly"]').click();
  await consent(page);
  const line = page.locator('[data-slot="plan-action-line"]');
  // THERE WITH NOTHING TO SAY: `invisible` keeps its box, so it is attached and not shown.
  await expect(line).toBeAttached();
  expect((await line.boundingBox())?.height ?? 0, 'the line has its box before it speaks').toBeGreaterThan(0);
  const buttonTop = await topOf(orderButton(page));
  const shiftsBefore = (await readShiftEntries(page)).length;

  await orderButton(page).click();

  await expect(line).toHaveText(EN.plan.order.moveRefused);
  await expect(line).toHaveAttribute('role', 'alert');
  await settleFrames(page);
  // THE LINE HAD ITS BOX: the button did not move, the order block is still there, and nothing shifted.
  expect(await topOf(orderButton(page))).toBe(buttonTop);
  await expect(page.locator('[data-slot="plan-order"]')).toBeVisible();
  await expect(moveResult(page)).toHaveCount(0);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift after the refusal').toBe(0);
});

test('the control: a subscriber whose biller names no tier gets no switch buttons and the status card it always had', async ({
  page,
}) => {
  // THE SAME VIEW with no `tier` key, which is what a biller older than the field sends.
  await routePlansCore(page, { planView: MONTHLY_SUBSCRIBER_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await openPlanPageSignedIn(page);

  await expect(page.locator('[data-slot="plan-status-card"]')).toBeVisible();
  await settleFrames(page);
  await expect(page.locator('[data-slot="tier-switch"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="plan-tiers"]')).toHaveCount(0);
});

/** What the observer below saw at the first change that drew the tier list. */
const listSightingSchema = z.array(z.enum(['list-only', 'list-and-order']));

/**
 * Records, at the first DOM change that draws the tier list, whether the order
 * block was drawn in that same change. A MutationObserver callback runs before
 * the next render commits, so an order block that arrived one render after the
 * list is seen as `list-only`, which a later `toBeVisible` could never tell.
 * Call before the first `goto`.
 */
async function watchOrderWithList(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sightings: string[] = [];
    Object.defineProperty(window, '__orderWithList', { value: sightings });
    new MutationObserver(() => {
      if (sightings.length > 0) return;
      if (document.querySelector('[data-slot="plan-tiers"]') === null) return;
      sightings.push(document.querySelector('[data-slot="plan-order"]') === null ? 'list-only' : 'list-and-order');
    }).observe(document, { childList: true, subtree: true });
  });
}

/** The first sighting of the list, or `none` when it has not been drawn. */
async function firstListSighting(page: Page): Promise<'list-only' | 'list-and-order' | 'none'> {
  const raw = await page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__orderWithList')?.value);
  return listSightingSchema.parse(raw)[0] ?? 'none';
}

/** The checked state of every tier radio, by tier id, so a preselect is read off the page. */
async function checkedTierIds(page: Page): Promise<string[]> {
  return tierRows(page).evaluateAll((rows) =>
    rows
      .filter((row) => row.querySelector('input[type="radio"]:checked') !== null)
      .map((row) => row.getAttribute('data-tier-id') ?? ''),
  );
}

test('a linked tier the offer sells is the pick, with the linked interval, from the first paint of the list', async ({
  page,
}) => {
  await watchOrderWithList(page);
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  const orders = await routeOrder(page, [
    { status: 200, json: { url: `${E2E_APP_URL}/settings/plan?checkout=cancelled` } },
  ]);
  await openPlanPageSignedIn(page, `?tier=${MIDDLE.id}&plan=yearly`);

  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
  // THE TIER IS PICKED and no other, the order block is there, and the yearly card is the chosen one.
  expect(await checkedTierIds(page)).toEqual([MIDDLE.id]);
  await expect(whatHappensBox(page)).toBeVisible();
  await expect(page.locator('[data-slot="plan-card"][data-plan-key="yearly"] input')).toBeChecked();
  await expect(page.locator('[data-slot="plan-card"][data-plan-key="monthly"] input')).not.toBeChecked();
  // THE ORDER BLOCK CAME WITH THE LIST, in one commit, so nothing arrived under a list already drawn.
  expect(await firstListSighting(page)).toBe('list-and-order');

  await settleAnimations(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  const tops = await readTops(page);
  await settleFrames(page);
  expect(movedBetween(tops, await readTops(page)), 'something moved after the first paint').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift on the plan page').toBe(0);

  // THE PRESELECT IS WHAT IS ORDERED: the order names the linked tier and the linked interval.
  await consent(page);
  await orderButton(page).click();
  await page.waitForURL('**/settings/plan?checkout=cancelled');
  expect(orders.bodies).toEqual([
    {
      plan: 'yearly',
      tier: MIDDLE.id,
      locale: 'en',
      consentVersion: FIXTURE.consentVersion,
      consents: { terms: true, earlyStart: true },
    },
  ]);
});

/** The raw offer with every key kept (the schema above strips what this spec does not read), so a variant stays a valid offer. */
const rawOfferSchema = z.looseObject({ tiers: z.array(z.looseObject({ id: z.string() })) });

/** An offer whose middle tier is not on sale, the rest of the served body untouched. */
function middleUnsoldOfferBody(): string {
  const raw = rawOfferSchema.parse(JSON.parse(FIXTURE_TIERS_OFFER_BODY));
  return JSON.stringify(
    Object.assign({}, raw, {
      tiers: raw.tiers.map((tier) => (tier.id === MIDDLE.id ? Object.assign({}, tier, { isSold: false }) : tier)),
    }),
  );
}

const MIDDLE_UNSOLD_OFFER_BODY: string = middleUnsoldOfferBody();

const NOTHING_PRESELECTED: ReadonlyArray<{ name: string; search: string; offerBody: string }> = [
  { name: 'no tier in the link', search: '?plan=yearly', offerBody: FIXTURE_TIERS_OFFER_BODY },
  {
    name: 'a tier the offer does not list',
    search: '?tier=no-such-tier&plan=yearly',
    offerBody: FIXTURE_TIERS_OFFER_BODY,
  },
  { name: 'the free entry', search: `?tier=${FREE.id}&plan=yearly`, offerBody: FIXTURE_TIERS_OFFER_BODY },
  { name: 'a tier that is not on sale', search: `?tier=${MIDDLE.id}&plan=yearly`, offerBody: MIDDLE_UNSOLD_OFFER_BODY },
  { name: 'a tier that is not a label', search: '?tier=Not_A_Label&plan=yearly', offerBody: FIXTURE_TIERS_OFFER_BODY },
];

for (const { name, search, offerBody } of NOTHING_PRESELECTED) {
  test(`the control: ${name} preselects no tier, and the list is drawn alone`, async ({ page }) => {
    await watchOrderWithList(page);
    await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody });
    await openPlanPageSignedIn(page, search);

    await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
    await expect(tierRows(page)).toHaveCount(FIXTURE.tiers.length);
    expect(await checkedTierIds(page)).toEqual([]);
    await expect(page.locator('[data-slot="plan-order"]')).toHaveCount(0);
    // THE SIGHTING PROBE CAN FAIL: here it reads the list alone, in the test above the list with its order block.
    expect(await firstListSighting(page)).toBe('list-only');
    // AN IGNORED LINK IS NO ERROR: the page says nothing about it, and a tier can still be picked.
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await tierRow(page, HIGH.id).click();
    expect(await checkedTierIds(page)).toEqual([HIGH.id]);
    await expect(whatHappensBox(page)).toBeVisible();
  });
}
