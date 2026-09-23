/**
 * The trial recap names what the person did with AI (M250/05).
 *
 * Near the end of a trial the countdown carries one more line, and the plan
 * page carries the same line above the offer: how many meals were logged with
 * AI during the trial. This walk logs a real meal through the real scan and a
 * hand-typed food through the real form, so the count is read off the diary
 * the app wrote, and the window starts at the account's real creation date,
 * which the session carries from the service's own account view.
 *
 * STUBBED: the vision endpoint's answer, the handshake's `plans: true`, the
 * plan reads and the account's allowance (`plans-stub.ts`).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, connectStubAiProvider, logFoodManually, signInFixtureAccount } from './helpers';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The endpoint `connectStubAiProvider` connects. */
const STUB_PROVIDER_URL = `${E2E_APP_URL}/e2e-stub-provider/v1`;

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Two items on one plate, so the count has to fold one intake's rows into one meal. */
const IDENTIFICATION = JSON.stringify({
  foods: ['Recap tier rye bread', 'Recap tier butter'].map((name) => ({
    name,
    estimatedGrams: 30,
    confidence: 'high',
    portionHint: null,
    macrosPer100g: { carbs: 40, fiber: 6, sugars: null, polyols: null, protein: 8, fat: 10, kcal: 300 },
    macroSource: 'estimated',
    carbBasis: null,
    brand: null,
    servingSize: null,
  })),
  unreadable: false,
  unreadableReason: null,
  notes: null,
});

/** An allowance that ends at local noon two days from today: three calendar days left, inside the recap's reach. */
function noonInTwoDays(): string {
  const end = new Date();
  end.setDate(end.getDate() + 2);
  end.setHours(12, 0, 0, 0);
  return end.toISOString();
}

function headerStatus(page: Page): Locator {
  return page.locator('header [data-slot="header-status"]');
}

function recapLine(page: Page): Locator {
  return page.locator('[data-slot="plan-trial-recap"]');
}

/** A signed-in device in the last days of a trial, with the stub provider connected. */
async function startTrialDevice(page: Page): Promise<void> {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  // THE TRIAL STARTS NOW: the fixture account is shared by the whole run, and
  // a meal an earlier spec synced into it must not count here.
  await routeAccountAllowance(page, {
    dailyAiLimit: 20,
    allowanceExpiresAt: noonInTwoDays(),
    createdAt: new Date().toISOString(),
  });
  await page.route(`${STUB_PROVIDER_URL}/chat/completions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: IDENTIFICATION } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    }),
  );
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await connectStubAiProvider(page);
  // A food typed by hand: in the trial, and NOT an AI meal.
  await logFoodManually(page, { name: 'Recap tier hand-typed apple', grams: '100' });
}

/** Photographs one plate and logs both of its items. */
async function logOnePlateWithAi(page: Page): Promise<void> {
  await page.goto('/add/photo');
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();
  await page.getByRole('button', { name: EN.scan.review.confirmAndLog }).click();
  await page.waitForURL('**/diary**');
}

/** The plan page, reached by a document load, once its cards are drawn. */
async function openPlanPage(page: Page): Promise<void> {
  await page.goto('/settings/plan');
  await expect(page.getByRole('group', { name: EN.plan.choice.legend })).toBeVisible({ timeout: 10_000 });
}

test('near the end of a trial, the countdown and the plan page name the meals logged with AI', async ({ page }) => {
  await startTrialDevice(page);
  await logOnePlateWithAi(page);

  // ONE MEAL: a two-item plate is one intake, and the hand-typed food is not AI.
  const recap = fill(EN.plan.recap.meals_one, { count: '1' });

  await page.goto('/diary');
  await expect(headerStatus(page)).toContainText(fill(EN.plan.countdown.daysLeft_other, { count: '3' }), {
    timeout: 10_000,
  });
  await expect(headerStatus(page)).toContainText(recap);

  await openPlanPage(page);
  await expect(recapLine(page)).toHaveText(recap);
});

test('with no meal logged with AI there is no recap line, on the plan page or in the countdown', async ({ page }) => {
  await startTrialDevice(page);

  // THE ANCHORS: the countdown and the plan cards are drawn, so everything the
  // recap waits for has been read. THE CONTROL is the test above, where the
  // same two queries find the line.
  await page.goto('/diary');
  await expect(headerStatus(page)).toContainText(fill(EN.plan.countdown.daysLeft_other, { count: '3' }), {
    timeout: 10_000,
  });
  // No second line at all: the status row's text is the countdown's alone.
  const countdownOnly = fill(EN.plan.countdown.daysLeft_other, { count: '3' }) + EN.plan.countdown.action;
  await expect(headerStatus(page)).toHaveText(countdownOnly);

  await openPlanPage(page);
  await expect(recapLine(page)).toHaveCount(0);
});

test('on a scan trial with three scans or fewer left, the countdown sums up the meals so far (M253/05)', async ({
  page,
}) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await routeAccountAllowance(page, {
    dailyAiLimit: 20,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: 3 },
    createdAt: new Date().toISOString(),
  });
  await page.route(`${STUB_PROVIDER_URL}/chat/completions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: IDENTIFICATION } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    }),
  );
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await connectStubAiProvider(page);
  await logOnePlateWithAi(page);

  const recap = fill(EN.plan.recap.mealsSoFar_one, { count: '1' });
  await page.goto('/diary');
  await expect(headerStatus(page)).toContainText(fill(EN.plan.countdown.scansLeft_other, { count: '3' }), {
    timeout: 10_000,
  });
  await expect(headerStatus(page)).toContainText(recap);
  // THE CONTROL: the dated sentence is not what a scan trial reads.
  await expect(headerStatus(page)).not.toContainText(fill(EN.plan.recap.meals_one, { count: '1' }));

  await openPlanPage(page);
  await expect(recapLine(page)).toHaveText(recap);
});
