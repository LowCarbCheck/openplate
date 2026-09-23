/**
 * The trial countdown in the header's status slot (M250/03).
 *
 * WHAT IS REAL: the production build, the account, the session, the shell,
 * the status channel and its header row, `planStanding`. WHAT IS STUBBED: the
 * handshake's `plans: true`, `GET /plans/me`, and the account's allowance
 * (`plans-stub.ts`), because the fake service models the sync protocol and a
 * trial is a fact about a consumer instance.
 *
 * Every absence below has a control that shows the line through the same
 * query, and every "never shown" waits for the read that would have drawn it
 * before it looks, so a check cannot pass by looking too early.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { funnel, recordMatomo } from './matomo-stub';
import { createGate, NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** Where `trial-countdown.ts` keeps the day the line was closed. Transcribed, so a rename fails here. */
const CLOSED_DAY_STORAGE_KEY = 'openplate:trial-countdown-closed:v1';

/** A daily allowance the trial grants. Any number above zero. */
const TRIAL_DAILY_LIMIT = 20;

/** The header's status row. The page title is drawn in the same box when it is empty. */
function headerStatus(page: Page): Locator {
  return page.locator('header [data-slot="header-status"]');
}

/** The countdown's one button, found by its role and the bundle's own label. */
function countdownAction(page: Page): Locator {
  return headerStatus(page).getByRole('button', { name: EN.plan.countdown.action, exact: true });
}

/**
 * An allowance that ends at local noon `days` calendar days from today, so the
 * countdown says `days + 1` (today included) whatever time the run starts.
 */
function noonInDays(days: number): string {
  const end = new Date();
  end.setDate(end.getDate() + days);
  end.setHours(12, 0, 0, 0);
  return end.toISOString();
}

/** A moment later today: ten minutes from now, and never past the last millisecond of today. */
function laterToday(): string {
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return new Date(Math.min(now + 10 * 60 * 1000, endOfToday.getTime())).toISOString();
}

/** A device past onboarding and signed in, standing on the diary. */
async function signIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
}

/**
 * Waits until the plan read has been answered and the page has drawn what it
 * answered. The anchor a "not shown" check needs: before this, nothing could
 * have been shown yet.
 */
async function waitForPlanRead(page: Page): Promise<void> {
  await page.waitForResponse((response) => response.url() === `${E2E_SYNC_SERVER_URL}/v1/plans/me`);
  await settleFrames(page);
  await settleFrames(page);
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('the countdown shows during a trial, moves nothing, links to the plan page and stays closed for the day', async ({
  page,
}) => {
  const events = await recordMatomo(page);
  const gate = createGate();
  const requests = await routePlansCore(page, {
    planView: NO_SUBSCRIPTION_VIEW,
    offerBody: null,
    planViewGate: gate.promise,
  });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: noonInDays(4) });
  await signIn(page);

  // ── It arrives without moving anything ──────────────────────────────
  // The plan read is HELD, so this reading is the diary before the
  // countdown exists, taken once the page has stopped moving on its own.
  await expect.poll(() => requests.planViews, { message: 'the shell never asked for the plan' }).toBeGreaterThan(0);
  await settleAnimations(page);
  await settleFrames(page);
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  gate.open();
  const expected = fill(EN.plan.countdown.daysLeft_other, { count: '5' });
  await expect(headerStatus(page)).toContainText(expected, { timeout: 10_000 });
  await expect(countdownAction(page)).toBeVisible();
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'the countdown moved the diary').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while it arrived').toBe(0);
  // THE FUNNEL counts it once, at its own placement, and nothing else.
  await expect.poll(() => funnel(events)).toEqual(['offer-seen:countdown']);

  // ── Its button goes to the plan page, and the line goes with it ─────
  await countdownAction(page).click();
  await page.waitForURL('**/settings/plan');
  await expect(countdownAction(page)).toHaveCount(0);

  // ── Closed, it stays closed today ───────────────────────────────────
  await page.goto('/diary');
  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  await settleFrames(page);
  const topsOpen = await readTops(page);
  const shiftsOpen = (await readShiftEntries(page)).length;
  await headerStatus(page).getByRole('button', { name: EN.chrome.status.dismiss, exact: true }).click();
  await expect(countdownAction(page)).toHaveCount(0);
  await settleFrames(page);
  expect(movedBetween(topsOpen, await readTops(page)), 'closing the countdown moved the diary').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsOpen), 'layout-shift while it closed').toBe(0);

  const closedOn = await page.evaluate((key) => localStorage.getItem(key), CLOSED_DAY_STORAGE_KEY);
  expect(closedOn, 'closing did not record the day').toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await page.reload();
  await waitForPlanRead(page);
  await expect(page.locator('header h1')).toBeVisible();
  await expect(countdownAction(page)).toHaveCount(0);

  // THE CONTROL: the same reload with the recorded day taken away shows the
  // line again, so the absence above is the closed day and not a page that
  // never draws it after a reload.
  await page.evaluate((key) => localStorage.removeItem(key), CLOSED_DAY_STORAGE_KEY);
  await page.reload();
  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
});

test('the last day says today', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: laterToday() });
  await signIn(page);

  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  await expect(headerStatus(page)).toContainText(EN.plan.countdown.lastDay);
});

test('no countdown after the trial ended', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: noonInDays(-1) });
  const planRead = waitForPlanRead(page);
  await signIn(page);
  await planRead;

  await expect(page.locator('header h1')).toBeVisible();
  await expect(countdownAction(page)).toHaveCount(0);
});

test('no countdown on an instance without plans, which is never asked for one', async ({ page }) => {
  // No `routePlansCore`: the fake's own handshake, which sells nothing.
  let planReads = 0;
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/plans/me`, (route) => {
    planReads += 1;
    return route.fulfill({ json: NO_SUBSCRIPTION_VIEW });
  });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: noonInDays(4) });
  await signIn(page);

  // THE ANCHOR: the settings hub names the account only once the session and
  // its account read have landed, which is everything the countdown waits for.
  await page.goto('/settings');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
  await settleFrames(page);
  await expect(page.locator('header h1')).toBeVisible();
  await expect(countdownAction(page)).toHaveCount(0);
  expect(planReads, 'an instance without plans was asked for a plan').toBe(0);
});

test('on a scan trial the countdown counts free scans, not days (M253/05)', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  // NO DATE and a count: the core's scan trial. A future date would lift the
  // count, which the day cases above are.
  await routeAccountAllowance(page, {
    dailyAiLimit: TRIAL_DAILY_LIMIT,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: 7 },
  });
  await signIn(page);

  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  await expect(headerStatus(page)).toContainText(fill(EN.plan.countdown.scansLeft_other, { count: '7' }));
  // THE CONTROL: the same slot says no days, so the text above is the scans
  // sentence and not a day sentence that happens to share a word.
  await expect(headerStatus(page)).not.toContainText(fill(EN.plan.countdown.daysLeft_other, { count: '7' }));
});

test('a spent scan trial shows no countdown (M253/05)', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, {
    dailyAiLimit: TRIAL_DAILY_LIMIT,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: 0 },
  });
  const planRead = waitForPlanRead(page);
  await signIn(page);
  await planRead;

  // THE ANCHOR is the header title, drawn once the plan read has landed; the
  // control is the test above, where the same query finds the line.
  await expect(page.locator('header h1')).toBeVisible();
  await expect(countdownAction(page)).toHaveCount(0);
});
