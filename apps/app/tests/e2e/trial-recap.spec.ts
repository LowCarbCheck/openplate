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

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { logOnePlateWithAi, routeStubPlateAnswer } from './ai-plate-stub';
import { EN, catalogFor, fill } from './copy';
import {
  completeOnboarding,
  connectStubAiProvider,
  doesStatusRowFit,
  logFoodManually,
  signInFixtureAccount,
} from './helpers';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore } from './plans-stub';

test.use({ serviceWorkers: 'block' });

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
  await routeStubPlateAnswer(page);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await connectStubAiProvider(page);
  // A food typed by hand: in the trial, and NOT an AI meal.
  await logFoodManually(page, { name: 'Recap tier hand-typed apple', grams: '100' });
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
  // No second line at all: the status row's text is the countdown's alone,
  // its action's words following the sentence after one space (2026-09-28).
  const countdownOnly = `${fill(EN.plan.countdown.daysLeft_other, { count: '3' })} ${EN.plan.countdown.action}`;
  await expect(headerStatus(page)).toHaveText(countdownOnly);

  await openPlanPage(page);
  await expect(recapLine(page)).toHaveCount(0);
});

/** The free scans left in the scan-trial cases: three, the most the recap line is drawn for. */
const SCANS_LEFT_NEAR_THE_END = 3;

/** A signed-in device on a scan trial with three scans left, one plate already logged with AI. */
async function startScanTrialDeviceWithOneAiMeal(page: Page): Promise<void> {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await routeAccountAllowance(page, {
    dailyAiLimit: 20,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: SCANS_LEFT_NEAR_THE_END },
    createdAt: new Date().toISOString(),
  });
  await routeStubPlateAnswer(page);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await connectStubAiProvider(page);
  await logOnePlateWithAi(page);
}

test('on a scan trial with three scans or fewer left, the countdown sums up the meals so far (M253/05)', async ({
  page,
}) => {
  await startScanTrialDeviceWithOneAiMeal(page);

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

test('with its recap line below, the scan count and its action fit two lines at 390 px in all six languages', async ({
  page,
}) => {
  // THE TWO-LINE LAYOUT, drawn for real: three scans left and one meal logged
  // with AI give the countdown its recap line, which leaves the sentence two
  // lines instead of three (the buyer walk, 2026-09-28). Each language's
  // sentence and label are then written into that row.
  await startScanTrialDeviceWithOneAiMeal(page);
  await page.goto('/diary');
  await expect(headerStatus(page)).toContainText(fill(EN.plan.recap.mealsSoFar_one, { count: '1' }), {
    timeout: 10_000,
  });

  const clipped: string[] = [];
  for (const locale of SUPPORTED_LANGUAGES) {
    const countdown = catalogFor(locale).plan.countdown;
    const words = {
      sentence: fill(countdown.scansLeft_other, { count: String(SCANS_LEFT_NEAR_THE_END) }),
      label: countdown.action,
    };
    if (!(await doesStatusRowFit(page, words))) clipped.push(`${locale}: ${words.sentence} ${words.label}`);
  }
  expect(clipped, 'these counts are cut off beside a recap line at 390 px').toEqual([]);

  // THE CONTROL: the English sentence four times over does not fit two lines.
  const fourTimes = fill(EN.plan.countdown.scansLeft_other, { count: String(SCANS_LEFT_NEAR_THE_END) }).repeat(4);
  expect(
    await doesStatusRowFit(page, { sentence: fourTimes, label: EN.plan.countdown.action }),
    'the fit reading cannot see a clipped line',
  ).toBe(false);
});
