/**
 * THE FREE TIER ENDS AFTER ITS SCANS OR ITS DAYS, WHICHEVER COMES FIRST (M267, owner decision 8).
 *
 * The paywall (`paywall.spec.ts`) locked the app when the free scans were used up. Since M267 the
 * core also writes an end date on a new account (`AccountView.trialEndsAt`) and publishes the day
 * count as `instance.trial.days`. Once that date has passed, the same standing check locks the app
 * with scans still left, and the plan page names the days, not the scans.
 *
 * WHAT IS REAL: the production build, the fake sync service's account and session, the
 * `_personal` layout's gate, the plan page and its heading. WHAT IS STUBBED
 * (`managed-core-stub.ts`): the handshake (`plans`, the free scans and days), `GET /plans/me`,
 * the offer, and the account facts on every auth answer, the end date and the creation instant
 * included.
 *
 * THE CONTROLS. The same account with its scans used up and its days still running is locked too,
 * and its heading names the scans, so a page that always said "days" fails. The same account
 * with scans and days left stays open, so a gate that locked on any end date fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { BOTTOM_BAR } from './clip-baseline';
import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding } from './helpers';
import { settleFrames } from './layout-shift';
import { routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** A sign-in and three screens outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/** How long a screen that should stay open is watched once the plan facts arrived. */
const OPEN_WATCH_MS = 1_200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day count the stubbed instance promises. A spec constant, never a number the app types. */
const TRIAL_DAYS = 14;

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({
    paywall: z.object({ heading: z.object({ scansUsed_other: z.string(), daysOver_other: z.string() }) }),
    meta: z.object({ dashboard: z.string() }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** An instant this many days from the moment the spec runs. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/**
 * A free tier that started fifteen days ago and ended by its fourteen days yesterday, with four
 * of its ten scans left. The overrides move one fact at a time.
 */
function core(overrides: Partial<ManagedCoreStub> = {}): ManagedCoreStub {
  return {
    trialScans: { granted: 10, left: 4 },
    trialEndsAt: daysFromNow(-1),
    createdAt: daysFromNow(-(TRIAL_DAYS + 1)),
    trialDays: TRIAL_DAYS,
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    ...overrides,
  };
}

/** A device past onboarding, signed in, and wherever the sign-in's own navigation ended. */
async function signIn(page: Page): Promise<string> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|settings\/plan)$/);
  return new URL(page.url()).pathname;
}

/** Resolves when the plan read of THIS page has been answered. Registered before the navigation it anchors. */
async function planRead(page: Page): Promise<void> {
  await page.waitForResponse((response) => response.url() === `${E2E_SYNC_SERVER_URL}/v1/plans/me`);
}

/** Asserts the plan page is on screen with this paywall heading. */
async function expectPaywall(page: Page, { heading, from }: { heading: string; from: string }): Promise<void> {
  await expect(page, `${from} did not end on the plan page`).toHaveURL(/\/settings\/plan$/, { timeout: 10_000 });
  await expect(page.locator('[data-slot="paywall-notice"] h2'), `${from}: the paywall heading`).toHaveText(heading);
}

test("the free tier's days are over with scans left: the app locks, and the plan page names the days", async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core());
  const heading = fill(COPY.paywall.heading.daysOver_other, { count: String(TRIAL_DAYS) });

  expect(await signIn(page), 'the sign-in landed past the paywall').toBe('/settings/plan');
  await expectPaywall(page, { heading, from: 'the sign-in' });

  await page.goto('/dashboard');
  await expectPaywall(page, { heading, from: 'a load of /dashboard' });

  await page.locator(`${BOTTOM_BAR} a[href="/diary"]`).click();
  await expectPaywall(page, { heading, from: 'a tap on the Diary tab' });
});

test('CONTROL: the free scans used up with days left lock too, and the heading names the scans', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ trialScans: { granted: 10, left: 0 }, trialEndsAt: daysFromNow(5) }));

  expect(await signIn(page)).toBe('/settings/plan');
  await expectPaywall(page, {
    heading: fill(COPY.paywall.heading.scansUsed_other, { count: '10' }),
    from: 'the sign-in',
  });
  await expect(page.locator('[data-slot="paywall-notice"] h2')).not.toHaveText(
    fill(COPY.paywall.heading.daysOver_other, { count: String(TRIAL_DAYS) }),
  );
});

test('CONTROL: scans and days both left, the app stays open', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ trialEndsAt: daysFromNow(5) }));

  expect(await signIn(page), 'the sign-in was sent to the plan page').toBe('/diary');
  const anchor = planRead(page);
  await page.goto('/dashboard');
  await anchor;
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page, '/dashboard was sent away').toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle(COPY.meta.dashboard);
});
