/**
 * The AI limit turns into an offer (M250/04).
 *
 * A scan refused because the allowance ended used to end at a sentence and a
 * bare link. On an instance that sells plans it now ends at the compact offer:
 * the lowest monthly price and one button to the plan page. On an instance
 * that sells nothing the refusal stays exactly as it was.
 *
 * WHAT IS REAL: the production build, the account and session, the scan
 * screen, the refusal classifier (`failure-cause.ts` reads the `403` code the
 * way it reads a managed instance's), the offer decoder and the card.
 * WHAT IS STUBBED: the vision endpoint, which answers the refusal; the
 * handshake's `plans: true`, the plan reads and Matomo (`plans-stub.ts`,
 * `matomo-stub.ts`).
 *
 * The expected price is computed HERE, from the fixture's own cents with this
 * file's own `Intl` call, never imported from `plan-prices.ts`.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN, fill } from './copy';
import { E2E_APP_URL, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { funnel, recordMatomo } from './matomo-stub';
import {
  createGate,
  FIXTURE_OFFER_BODY,
  NO_SUBSCRIPTION_VIEW,
  routeAccountAllowance,
  routePlansCore,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The fake provider: this app's own origin, on a path nothing serves. See `scan-review.spec.ts`. */
const VISION_BASE_URL = `${E2E_APP_URL}/e2e-ai-limit/v1`;

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The part of the fixture offer this spec reads. */
const fixtureSchema = z.object({
  plans: z.array(z.object({ interval: z.enum(['month', 'year']), grossCents: z.number() })),
});

/** The "from" line the card should state, from the fixture's own numbers. */
function expectedFromLine(): string {
  const { plans } = fixtureSchema.parse(JSON.parse(FIXTURE_OFFER_BODY));
  const cents = Math.min(
    ...plans.map((plan) => (plan.interval === 'year' ? Math.round(plan.grossCents / 12) : plan.grossCents)),
  );
  const price = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  return fill(EN.plan.offer.from, { price });
}

function offerCard(page: Page): Locator {
  return page.locator('[data-slot="plan-offer-compact"]');
}

/**
 * The vision endpoint refuses every scan the way the AI proxy does: once an
 * allowance has ended by default, or with the code a spec names.
 */
async function refuseEveryScan(page: Page, code = 'allowance-expired'): Promise<void> {
  await page.route(`${VISION_BASE_URL}/models`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );
  await page.route(`${VISION_BASE_URL}/chat/completions`, (route) =>
    route.fulfill({ status: 403, json: { error: { code } } }),
  );
}

/** A signed-in device with the refusing endpoint connected through the real settings form. */
async function signInWithProvider(page: Page): Promise<void> {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill('e2e-ai-limit-model');
  await page.locator('input[name="baseUrl"]').fill(VISION_BASE_URL);
  await page.locator('input[name="apiKey"]').fill('e2e-not-a-real-key');
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();
  await page.waitForURL('**/diary');
}

/** Takes one photo and waits for the refusal whose headline the spec names. */
async function scanAndBeRefused(page: Page, title = EN.scan.errors.titles.allowanceExpired): Promise<void> {
  await page.goto('/add/photo');
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('an ended allowance turns into the offer, whose price fills its box without moving anything', async ({ page }) => {
  const events = await recordMatomo(page);
  const offerGate = createGate();
  const requests = await routePlansCore(page, {
    planView: NO_SUBSCRIPTION_VIEW,
    offerBody: FIXTURE_OFFER_BODY,
    offerGate: offerGate.promise,
  });
  await refuseEveryScan(page);
  await signInWithProvider(page);
  await scanAndBeRefused(page);

  // ── The card is there before its price, holding the price's line ────
  await expect(offerCard(page)).toBeVisible();
  const priceLine = offerCard(page).locator('[data-slot="plan-offer-price"]');
  await expect(priceLine).toBeHidden();
  await expect.poll(() => requests.locales.length, { message: 'the card never asked for the offer' }).toBe(1);
  await settleFrames(page);
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  // ── The offer arrives ────────────────────────────────────────────────
  offerGate.open();
  await expect(priceLine).toBeVisible();
  await expect(priceLine).toHaveText(expectedFromLine());
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'the price moved the scan screen').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while the price arrived').toBe(0);
  // SEEN MEANS ON SCREEN (`use-offer-seen.ts`). Below the refusal on a phone
  // the card starts under the fold, so it is counted once it is scrolled to.
  await offerCard(page).scrollIntoViewIfNeeded();
  await expect.poll(() => funnel(events)).toEqual(['offer-seen:ai-limit']);

  // ── One button, to the plan page, which starts nothing by itself ────
  await offerCard(page).getByRole('link', { name: EN.aiIntake.plansLink, exact: true }).click();
  await page.waitForURL('**/settings/plan');
  expect(funnel(events), 'following the card sent an order').toEqual(['offer-seen:ai-limit']);
});

test('an instance that sells nothing keeps the refusal as it was, and never asks for an offer', async ({ page }) => {
  // No `routePlansCore`: the fake's own handshake, which sells nothing.
  let offerReads = 0;
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/plans/`),
    (route) => {
      offerReads += 1;
      return route.fulfill({ status: 404, json: { error: 'not found' } });
    },
  );
  await refuseEveryScan(page);
  await signInWithProvider(page);
  await scanAndBeRefused(page);

  // THE ANCHOR is the refusal above, drawn in the same render as the card
  // would be. THE CONTROL is the first test, where the same query finds it.
  await settleFrames(page);
  await expect(offerCard(page)).toHaveCount(0);
  expect(offerReads, 'an instance without plans was asked for its plans').toBe(0);
});

test('spent free scans turn into the same offer, headed with the number given (M253/05)', async ({ page }) => {
  const events = await recordMatomo(page);
  const offerGate = createGate();
  const requests = await routePlansCore(page, {
    planView: NO_SUBSCRIPTION_VIEW,
    offerBody: FIXTURE_OFFER_BODY,
    offerGate: offerGate.promise,
  });
  await routeAccountAllowance(page, {
    dailyAiLimit: 20,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: 0 },
  });
  await refuseEveryScan(page, 'trial-scans-spent');
  await signInWithProvider(page);
  await scanAndBeRefused(page, fill(EN.scan.errors.titles.trialScansSpent_other, { count: '10' }));

  await expect(offerCard(page)).toBeVisible();
  const priceLine = offerCard(page).locator('[data-slot="plan-offer-price"]');
  await expect.poll(() => requests.locales.length, { message: 'the card never asked for the offer' }).toBe(1);
  await settleFrames(page);
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  offerGate.open();
  await expect(priceLine).toHaveText(expectedFromLine());
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'the price moved the scan screen').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while the price arrived').toBe(0);
  await offerCard(page).scrollIntoViewIfNeeded();
  // The header's "free AI scans used" line (M253/11) is an offer of its own
  // and counts as `offer-seen:countdown` once per load; this card is the
  // `ai-limit` one.
  await expect
    .poll(() => funnel(events).filter((event) => event !== 'offer-seen:countdown'))
    .toEqual(['offer-seen:ai-limit']);
});

test('the control: a refusal no plan answers draws no offer on the same instance (M253/05)', async ({ page }) => {
  const requests = await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await refuseEveryScan(page, 'ai-not-allowed');
  await signInWithProvider(page);
  await scanAndBeRefused(page, EN.scan.errors.titles.aiNotAllowed);

  // THE ANCHOR is the refusal above, drawn in the same render as the card.
  await settleFrames(page);
  await expect(offerCard(page)).toHaveCount(0);
  expect(requests.locales, 'an offer was read for a refusal no plan answers').toEqual([]);
});
