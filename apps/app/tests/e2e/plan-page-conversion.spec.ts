/**
 * The plan page sells: tier cards with computed figures, the recommended card,
 * a hero with a real usage meter, and a compact status for a subscriber (owner
 * report, 2026-11-02: "rows of small monochrome text in identical boxes", a tall
 * empty box under the renewal date, and a primary button on top of the page).
 *
 * WHAT IS REAL: the production build, the account, the session, the offer decoder
 * and the page. WHAT IS STUBBED: the handshake, the plan and offer reads
 * (`plans-stub.ts`, the neutral tiers fixture) and the account's allowance facts.
 *
 * NO FIGURE IS PINNED AS THE PAGE'S OWN. The multiple and the saving are computed
 * here again from the fixture's numbers, and every sentence comes from the catalog.
 *
 * @area plans-and-paywall
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN, fill } from './copy';
import { PHONE_HEIGHT, PHONE_WIDTH } from './helpers';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames, shiftScoreAfter } from './layout-shift';
import {
  FIXTURE_OFFER_BODY,
  FIXTURE_TIERS_OFFER_BODY,
  NO_SUBSCRIPTION_VIEW,
  openPlanPageSignedIn,
  routeAccountAllowance,
  routePlansCore,
  subscriberOnTier,
  type AccountAllowance,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** A desktop wide enough for the sidebar and three columns. */
const DESKTOP = { width: 1280, height: 900 } as const;

/** A week from now: the window a spec's quota counts in. */
const NEXT_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();

/** The keys this spec reads, parsed so a renamed key fails on load. */
const COPY = z
  .object({
    plan: z.object({
      vatNote: z.string(),
      tiers: z.object({
        recommended: z.string(),
        multiple: z.string(),
        saving: z.string(),
        choose: z.string(),
        chosen: z.string(),
      }),
      meter: z.object({ scans_other: z.string(), week_other: z.string() }),
    }),
    featureGate: z.object({ names: z.object({ voice: z.string(), chat: z.string(), pantry: z.string() }) }),
    paywall: z.object({ returned: z.object({ openDiary: z.string() }) }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

const fixtureSchema = z.looseObject({
  tiers: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      isSold: z.boolean(),
      dailyAiLimit: z.number(),
      plans: z.array(z.looseObject({ key: z.string(), grossCents: z.number() })),
    }),
  ),
});

const FIXTURE = fixtureSchema.parse(JSON.parse(FIXTURE_TIERS_OFFER_BODY));
const [FREE, LOW, MIDDLE, HIGH] = FIXTURE.tiers;
if (FREE === undefined || LOW === undefined || MIDDLE === undefined || HIGH === undefined) {
  throw new Error('the tiers fixture lost a tier this spec reads');
}

/** What a spec changes on a fixture tier. */
interface TierPatch {
  recommended?: boolean;
  dailyAiLimit?: number;
  plans?: readonly { key: string; grossCents: number }[];
}

/** The fixture's body with these tiers patched, by id, and every other byte as served. */
function offerBodyWith(patches: Readonly<Record<string, TierPatch>>): string {
  const tiers = FIXTURE.tiers.map((tier) => Object.assign({}, tier, patches[tier.id]));
  return JSON.stringify(Object.assign({}, FIXTURE, { tiers }));
}

/** The same fixture with the biller's flag on the middle tier. */
const RECOMMENDED_BODY = offerBodyWith({ [MIDDLE.id]: { recommended: true } });

function tierRow(page: Page, id: string): Locator {
  return page.locator(`[data-slot="plan-tier"][data-tier-id="${id}"]`);
}

function hero(page: Page): Locator {
  return page.locator('[data-slot="plan-hero"]');
}

function meter(page: Page): Locator {
  return page.locator('[data-slot="plan-meter"]');
}

/** The computed colour of a Tailwind class, read off a probe, so no token is typed here. */
async function colourOf(page: Page, input: { className: string; property: 'backgroundColor' | 'borderTopColor' }): Promise<string> {
  return page.evaluate(({ className, property }) => {
    const probe = document.createElement('div');
    probe.className = className;
    document.body.append(probe);
    const colour = getComputedStyle(probe)[property];
    probe.remove();
    return colour;
  }, input);
}

function cssOf(locator: Locator, property: 'borderTopWidth' | 'borderTopColor' | 'backgroundColor' | 'boxShadow'): Promise<string> {
  return locator.evaluate((node, name) => getComputedStyle(node)[name], property);
}

/** Whether the page scrolls sideways, read as the browser reports it. */
function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/** The page's own coordinates of an element, so a scroll is not read as a move. */
function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  return locator.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height };
  });
}

/** A free person on the plan page, with the offer the spec names. */
async function openAsFree(page: Page, offerBody: string, allowance: Partial<AccountAllowance> = {}): Promise<void> {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody });
  await routeAccountAllowance(page, {
    dailyAiLimit: 10,
    allowanceExpiresAt: null,
    freeDailyAiLimit: 10,
    freeAiLimitPeriod: 'week',
    ...allowance,
  });
  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
}

test.describe('the cards', () => {
  test('the recommended card is highlighted in teal, with its filled badge and filled press', async ({ page }) => {
    await openAsFree(page, RECOMMENDED_BODY);
    const card = tierRow(page, MIDDLE.id);
    const neutral = tierRow(page, LOW.id);
    const primaryFill = await colourOf(page, { className: 'bg-primary', property: 'backgroundColor' });
    const primaryBorder = await colourOf(page, { className: 'border border-primary', property: 'borderTopColor' });

    await expect(card.locator('[data-slot="tier-recommended"]')).toHaveText(COPY.plan.tiers.recommended);
    expect(await cssOf(card, 'borderTopWidth')).toBe('2px');
    expect(await cssOf(card, 'borderTopColor')).toBe(primaryBorder);
    expect(await cssOf(card.locator('[data-slot="tier-recommended"]'), 'backgroundColor')).toBe(primaryFill);
    expect(await cssOf(card.locator('[data-slot="tier-cta"]'), 'backgroundColor')).toBe(primaryFill);

    // THE CONTROLS: the card beside it is neutral in each of the same readings.
    await expect(neutral.locator('[data-slot="tier-recommended"]')).toHaveCount(0);
    expect(await cssOf(neutral, 'borderTopWidth')).toBe('1px');
    expect(await cssOf(neutral, 'borderTopColor')).not.toBe(primaryBorder);
    expect(await cssOf(neutral.locator('[data-slot="tier-cta"]'), 'backgroundColor')).not.toBe(primaryFill);

    // Square, whatever the card says. A radius here would break DESIGN.md section 1.
    expect(await card.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).toBe('0px');
  });

  test('control: an offer without the flag highlights nothing', async ({ page }) => {
    await openAsFree(page, FIXTURE_TIERS_OFFER_BODY);
    await expect(page.locator('[data-slot="tier-recommended"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="plan-tier"][data-recommended="true"]')).toHaveCount(0);
    expect(await cssOf(tierRow(page, MIDDLE.id), 'borderTopWidth')).toBe('1px');
  });

  test('every sold card shows its computed multiple, its saving and a press with the biller\'s name', async ({ page }) => {
    await openAsFree(page, FIXTURE_TIERS_OFFER_BODY);
    for (const tier of [LOW, MIDDLE, HIGH]) {
      const row = tierRow(page, tier.id);
      await expect(row.locator('[data-slot="tier-figure"]')).toHaveText(String(tier.dailyAiLimit));
      const multiple = Math.floor((tier.dailyAiLimit * 10) / FREE.dailyAiLimit) / 10;
      await expect(row.locator('[data-slot="tier-multiple"]')).toHaveText(
        fill(COPY.plan.tiers.multiple, { multiple: new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(multiple) }),
      );
      const monthly = tier.plans.find((plan) => plan.key === 'monthly')?.grossCents ?? 0;
      const yearly = tier.plans.find((plan) => plan.key === 'yearly')?.grossCents ?? 0;
      const percent = Math.floor(((monthly * 12 - yearly) * 100) / (monthly * 12));
      await expect(row.locator('[data-slot="tier-saving"]')).toHaveText(fill(COPY.plan.tiers.saving, { percent: String(percent) }));
      await expect(row.locator('[data-slot="tier-cta"]')).toHaveText(fill(COPY.plan.tiers.choose, { name: tier.name }));
    }
    await expect(page.locator('[data-slot="plan-vat-note"]')).toHaveText(COPY.plan.vatNote);
  });

  test('control: a figure that cannot be computed draws nothing, and its box stays', async ({ page }) => {
    const body = offerBodyWith({
      [FREE.id]: { dailyAiLimit: 0 },
      [LOW.id]: { plans: LOW.plans.filter((plan) => plan.key === 'yearly') },
    });
    await openAsFree(page, body);
    const row = tierRow(page, LOW.id);
    // A free entry with no scans has no multiple anywhere.
    await expect(row.locator('[data-slot="tier-multiple"]')).toHaveClass(/invisible/u);
    await expect(row.locator('[data-slot="tier-multiple"]')).not.toContainText('x');
    await expect(tierRow(page, HIGH.id).locator('[data-slot="tier-multiple"]')).toHaveClass(/invisible/u);
    // No monthly plan to compare with: no saving there, and a saving on its neighbour.
    await expect(row.locator('[data-slot="tier-saving"]')).toHaveClass(/invisible/u);
    await expect(tierRow(page, MIDDLE.id).locator('[data-slot="tier-saving"]')).not.toHaveClass(/invisible/u);
  });

  test('voice and chat are not drawn, though the biller lists them', async ({ page }) => {
    await openAsFree(page, FIXTURE_TIERS_OFFER_BODY);
    const features = tierRow(page, HIGH.id).locator('[data-slot="tier-feature"]');
    expect(await features.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-feature')))).toEqual([
      'fasting',
      'pantry',
    ]);
    const tiers = page.locator('[data-slot="plan-tiers"]');
    await expect(tiers.getByText(COPY.featureGate.names.voice, { exact: false })).toHaveCount(0);
    await expect(tiers.getByText(COPY.featureGate.names.chat, { exact: false })).toHaveCount(0);
    // THE CONTROL: this reading finds a feature that has a screen.
    await expect(tiers.getByText(COPY.featureGate.names.pantry, { exact: false }).first()).toBeAttached();
  });

  test('three columns on a desktop, a stack on a phone, and no sideways scroll on either', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openAsFree(page, RECOMMENDED_BODY);
    const sold = [LOW, MIDDLE, HIGH].map((tier) => tierRow(page, tier.id));
    await settleFrames(page);
    const desktop = await Promise.all(sold.map(boxOf));
    expect(new Set(desktop.map((box) => box.y)).size, 'one row').toBe(1);
    expect(new Set(desktop.map((box) => box.x)).size, 'three columns').toBe(3);
    expect(new Set(desktop.map((box) => box.height)).size, 'equal height').toBe(1);
    expect(await overflowsSideways(page), 'desktop').toBe(false);

    await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
    await settleFrames(page);
    const phone = await Promise.all(sold.map(boxOf));
    expect(new Set(phone.map((box) => box.x)).size, 'one column').toBe(1);
    expect(new Set(phone.map((box) => box.y)).size, 'three rows').toBe(3);
    expect(await overflowsSideways(page), 'phone').toBe(false);

    // THE CONTROL: this reading does see a page that scrolls sideways.
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.id = 'overflow-control';
      wide.style.width = '4000px';
      wide.style.height = '1px';
      document.body.append(wide);
    });
    expect(await overflowsSideways(page), 'the control').toBe(true);
    await page.locator('#overflow-control').evaluate((node) => node.remove());
  });

  test('a pick changes colour, never size, moves nothing, and brings the order into view', async ({ page }) => {
    await installShiftObserver(page);
    await page.setViewportSize(DESKTOP);
    await openAsFree(page, RECOMMENDED_BODY);
    const card = tierRow(page, LOW.id);
    const other = tierRow(page, MIDDLE.id);
    const heroBox = hero(page);
    // BEFORE THE PRESS nothing is ordered and the page is at its top.
    await expect(page.locator('[data-slot="plan-order"]')).toHaveCount(0);
    await settleAnimations(page);
    await settleFrames(page);
    const before = { card: await boxOf(card), other: await boxOf(other), hero: await boxOf(heroBox) };
    const fillBefore = await cssOf(card, 'backgroundColor');
    const shiftsBefore = (await readShiftEntries(page)).length;

    await card.click();
    await expect(card).toHaveAttribute('data-picked', 'true');
    await expect(page.locator('[data-slot="plan-order"]')).toBeVisible();
    await settleAnimations(page);
    await settleFrames(page);

    expect(await boxOf(card), 'the card keeps its box').toEqual(before.card);
    expect(await boxOf(other), 'its neighbour keeps its box').toEqual(before.other);
    expect(await boxOf(heroBox), 'the hero keeps its box').toEqual(before.hero);
    expect(await cssOf(card, 'backgroundColor'), 'the colour did change').not.toBe(fillBefore);
    await expect(card.locator('[data-slot="tier-cta"]')).toHaveText(fill(COPY.plan.tiers.chosen, { name: LOW.name }));
    expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift').toBe(0);

    // THE ORDER IS ON SCREEN: the press was answered by a scroll to it.
    await expect.poll(() => page.evaluate(() => window.scrollY), 'the press scrolled').toBeGreaterThan(0);
    await expect(page.locator('[data-slot="plan-order"]')).toBeInViewport();
  });

  test('control: an arrow key walking the radios picks and does not throw the page around', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openAsFree(page, RECOMMENDED_BODY);
    const radio = tierRow(page, LOW.id).locator('input[type="radio"]');
    await radio.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tierRow(page, MIDDLE.id)).toHaveAttribute('data-picked', 'true');
    await settleFrames(page);
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  });
});

test.describe('the free entry', () => {
  test('is a strip with the current mark, smaller than a card and with nothing to press', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openAsFree(page, RECOMMENDED_BODY);
    const strip = tierRow(page, FREE.id);
    await expect(strip).toHaveAttribute('data-kind', 'free');
    await expect(strip.locator('[data-slot="tier-current"]')).toHaveText(EN.plan.tiers.current);
    await expect(strip.locator('input, button, [data-slot="tier-cta"]')).toHaveCount(0);
    const stripBox = await boxOf(strip);
    const cardBox = await boxOf(tierRow(page, LOW.id));
    expect(stripBox.height, 'a strip, not a card').toBeLessThan(cardBox.height / 2);
  });
});

test.describe('the hero', () => {
  test('a free person reads their count from the real quota, with a teal bar and when it starts again', async ({ page }) => {
    await openAsFree(page, RECOMMENDED_BODY, {
      aiQuota: { kind: 'free', limit: 10, period: 'week', used: 7, resetsAt: NEXT_WEEK },
    });
    await expect(hero(page)).toBeVisible();
    await expect(meter(page)).toHaveAttribute('data-state', 'read');
    await expect(page.locator('[data-slot="plan-meter-sentence"]')).toHaveText(
      fill(COPY.plan.meter.week_other, { used: '7', count: '10' }),
    );
    const bar = page.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '7');
    await expect(bar).toHaveAttribute('aria-valuemax', '10');
    const share = await page
      .locator('[data-slot="plan-meter-fill"]')
      .evaluate((fillNode) => fillNode.getBoundingClientRect().width / (fillNode.parentElement?.getBoundingClientRect().width ?? 1));
    expect(share).toBeCloseTo(0.7, 2);
    expect(await cssOf(page.locator('[data-slot="plan-meter-fill"]'), 'backgroundColor')).toBe(
      await colourOf(page, { className: 'bg-primary', property: 'backgroundColor' }),
    );
    await expect(page.locator('[data-slot="plan-meter-reset"]')).not.toHaveClass(/invisible/u);
    // ONE HERO ON THE SCREEN (DESIGN.md section 2).
    await expect(page.locator('.surface-brand')).toHaveCount(1);
  });

  test('control: no quota read draws no meter and invents no number, and the box stays', async ({ page }) => {
    await openAsFree(page, RECOMMENDED_BODY);
    await expect(hero(page)).toBeVisible();
    await expect(meter(page)).toHaveAttribute('data-state', 'empty');
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(meter(page)).toBeHidden();
    await expect(page.locator('[data-slot="plan-meter-sentence"]')).toHaveText(/^\s*$/u);
    expect((await boxOf(meter(page))).height, 'the box is reserved').toBeGreaterThan(40);
  });

  test('a scan trial counts its free scans, not the burst limit its quota names', async ({ page }) => {
    await openAsFree(page, RECOMMENDED_BODY, {
      freeDailyAiLimit: undefined,
      freeAiLimitPeriod: undefined,
      dailyAiLimit: 200,
      trialScans: { granted: 10, left: 7 },
      aiQuota: { kind: 'trial', limit: 200, period: 'day', used: 3, resetsAt: NEXT_WEEK },
    });
    await expect(page.locator('[data-slot="plan-meter-sentence"]')).toHaveText(
      fill(COPY.plan.meter.scans_other, { used: '3', count: '10' }),
    );
    await expect(page.locator('[data-slot="plan-meter-sentence"]')).not.toContainText('200');
    await expect(page.locator('[data-slot="plan-meter-reset"]')).toHaveClass(/invisible/u);
  });

  test('a locked person reads why, inside the hero, with the way to their data', async ({ page }) => {
    await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: RECOMMENDED_BODY });
    await routeAccountAllowance(page, { dailyAiLimit: 20, allowanceExpiresAt: null, trialScans: { granted: 10, left: 0 } });
    await openPlanPageSignedIn(page);
    await expect(hero(page).locator('[data-slot="paywall-notice"]')).toBeVisible();
    await expect(page.locator('[data-slot="plan-meter-sentence"]')).toHaveText(
      fill(COPY.plan.meter.scans_other, { used: '10', count: '10' }),
    );
    await expect(page.locator('[data-slot="plan-meter"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  });

  test('control: an offer with no tiers draws today\'s page, with no hero and no cards', async ({ page }) => {
    await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
    await routeAccountAllowance(page, {
      dailyAiLimit: 10,
      allowanceExpiresAt: null,
      freeDailyAiLimit: 10,
      freeAiLimitPeriod: 'week',
      aiQuota: { kind: 'free', limit: 10, period: 'week', used: 7, resetsAt: NEXT_WEEK },
    });
    await openPlanPageSignedIn(page);
    await expect(page.locator('[data-slot="plan-order"]')).toBeVisible();
    await expect(hero(page)).toHaveCount(0);
    await expect(meter(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="plan-tiers"]')).toHaveCount(0);
  });
});

test.describe('a subscriber', () => {
  test('reads a compact status with no empty box, the own tier marked and no push down to the recommended tier', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await routePlansCore(page, { planView: subscriberOnTier(HIGH.id), offerBody: RECOMMENDED_BODY });
    await openPlanPageSignedIn(page);
    await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
    await settleFrames(page);
    // THE TALL BOX WAS THE RESERVED SLOT: nothing booked, no slot at all.
    await expect(page.locator('[data-slot="plan-pending-change"]')).toHaveCount(0);
    await expect(tierRow(page, HIGH.id).locator('[data-slot="tier-current"]')).toHaveText(EN.plan.tiers.current);
    await expect(page.locator('[data-slot="tier-recommended"]')).toHaveCount(0);
    await expect(hero(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="tier-switch"]').first()).toBeVisible();
    // THE CONTROL: a subscriber below the recommended tier does see it.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await routePlansCore(page, { planView: subscriberOnTier(LOW.id), offerBody: RECOMMENDED_BODY });
    await page.reload();
    await expect(page.locator('[data-slot="plan-tiers"]')).toBeVisible();
    await expect(tierRow(page, MIDDLE.id).locator('[data-slot="tier-recommended"]')).toBeVisible();
    await expect(tierRow(page, MIDDLE.id).locator('[data-slot="tier-switch"]')).toBeVisible();
  });

  test('a confirmed payment no longer puts a primary button on top of the page', async ({ page }) => {
    await routePlansCore(page, { planView: subscriberOnTier(LOW.id), offerBody: RECOMMENDED_BODY });
    await openPlanPageSignedIn(page, '?checkout=success');
    const link = page.locator('[data-slot="plan-return"]').getByRole('link', { name: COPY.paywall.returned.openDiary });
    await expect(link).toBeVisible();
    await settleAnimations(page);
    const primary = await colourOf(page, { className: 'bg-primary', property: 'backgroundColor' });
    expect(await cssOf(link, 'backgroundColor')).not.toBe(primary);
    // THE CONTROL: the probe reads a real colour, and the same reading finds one on a filled button.
    expect(primary).not.toBe('rgba(0, 0, 0, 0)');
  });
});
