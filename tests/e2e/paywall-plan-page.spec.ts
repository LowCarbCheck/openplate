/**
 * The plan page as the paywall's destination (owner decision, 2026-09-28).
 *
 * A locked person lands here, so the page says why above the plans, and says
 * that the data stays theirs with a way to take it out or delete it. A person
 * with free scans left is offered the way back to them. A person back from a
 * payment is told when the plan is active, polled every two seconds, and sent
 * on to the diary.
 *
 * NO LAYOUT SHIFT (the operator's rule): the notice arrives in the same paint
 * as the plans it heads, and the line that answers a payment return keeps one
 * box through all three of its states. Both are measured the way `DESIGN.md`
 * section 7 says, with `getBoundingClientRect` before and after and a
 * `layout-shift` total of 0, and each measurement has a control that moves
 * something on purpose and must read as moved.
 *
 * WHAT IS STUBBED: the core (`managed-core-stub.ts`), with the offer held
 * where a reading has to be taken before it lands.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { createGate, FIXTURE_OFFER_BODY, MONTHLY_SUBSCRIBER_VIEW, NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The checkout walk polls for several seconds on top of a sign-in. */
const WALK_BUDGET_MS = 90_000;

const COPY = z
  .object({
    paywall: z.object({
      heading: z.object({ scansUsed_other: z.string() }),
      body: z.string(),
      freeScansFirst: z.string(),
      returned: z.object({ active: z.string(), openDiary: z.string() }),
    }),
    meta: z.object({ dashboard: z.string() }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A member whose ten free scans are spent, with no plan: locked. */
function spentCore(overrides: Partial<ManagedCoreStub> = {}): ManagedCoreStub {
  return {
    trialScans: { granted: 10, left: 0 },
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    ...overrides,
  };
}

function notice(page: Page) {
  return page.locator('[data-slot="paywall-notice"]');
}

function returnLine(page: Page) {
  return page.locator('[data-slot="plan-return"]');
}

/** A device past onboarding and signed in, wherever the sign-in's navigation ended. */
async function signIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|settings\/plan)$/);
}

/** Holds every offer read until the returned gate is opened. Registered after the stub, so it answers first. */
async function holdTheOffer(page: Page) {
  const gate = createGate();
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/plans/offer`),
    async (route) => {
      await gate.promise;
      await route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE_OFFER_BODY });
    },
  );
  return gate;
}

/** Pushes the top of `main` down by 40 px, the way a late line would. */
async function pushMainDown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '40px';
    document.querySelector('main')?.prepend(spacer);
  });
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('a locked person reads why, above the plans, and how to take the data out, and nothing moves', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, spentCore());
  const offer = await holdTheOffer(page);
  await signIn(page);
  await expect(page).toHaveURL(/\/settings\/plan$/);

  // The offer is held, so nothing below the header is drawn yet.
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(0);
  await settleAnimations(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  offer.open();
  await expect(notice(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2);
  const topsOnArrival = await readTops(page);
  await settleAnimations(page);
  const topsSettled = await readTops(page);

  expect(movedBetween(topsOnArrival, topsSettled), 'something moved after the notice arrived').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while the page filled').toBe(0);

  // ── What it says ────────────────────────────────────────────────────
  await expect(notice(page).locator('h2')).toHaveText(fill(COPY.paywall.heading.scansUsed_other, { count: '10' }));
  await expect(notice(page)).toContainText(COPY.paywall.body);
  await expect(notice(page).locator('a[href="/settings/data"]')).toBeVisible();
  await expect(notice(page).locator('a[href="/settings/account"]')).toBeVisible();
  // Above the plans it heads.
  const noticeBox = await notice(page).boundingBox();
  const firstCard = await page.locator('[data-slot="plan-card"]').first().boundingBox();
  if (noticeBox === null || firstCard === null) throw new Error('the notice or the first plan card has no box');
  expect(noticeBox.y + noticeBox.height, 'the notice sits below the plans').toBeLessThanOrEqual(firstCard.y);
  // A locked person is not offered free scans they do not have.
  await expect(page.getByRole('link', { name: COPY.paywall.freeScansFirst })).toHaveCount(0);

  // THE CONTROL for both readings above: a line pushed in above the page
  // after the fact must read as moved, and as a shift.
  const shiftsBeforeControl = (await readShiftEntries(page)).length;
  await pushMainDown(page);
  await settleFrames(page);
  expect(movedBetween(topsSettled, await readTops(page)).length, 'the control moved nothing').toBeGreaterThan(0);
  expect(
    shiftScoreAfter(await readShiftEntries(page), shiftsBeforeControl),
    'the control was no shift',
  ).toBeGreaterThan(0);

  // The data line's link works while locked.
  await notice(page).locator('a[href="/settings/data"]').click();
  await expect(page).toHaveURL(/\/settings\/data$/);
});

test('with free scans left, the plan page offers them first, and that link opens the diary', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, spentCore({ trialScans: { granted: 10, left: 4 } }));
  await signIn(page);
  await page.goto('/settings/plan');
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2, { timeout: 10_000 });

  // No notice: nothing is locked.
  await expect(notice(page)).toHaveCount(0);
  const link = page.getByRole('link', { name: COPY.paywall.freeScansFirst, exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle(COPY.meta.dashboard);
});

test('back from a payment, the page polls until the plan is active, and the diary opens', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = spentCore();
  await routeManagedCore(page, stub);
  await signIn(page);
  await expect(page).toHaveURL(/\/settings\/plan$/);

  // THE WEBHOOK LANDS LATE: every read answers "no plan" until two poll
  // intervals after the return, and "active" from then on.
  let flipAt = Number.POSITIVE_INFINITY;
  const readsAt: number[] = [];
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/plans/me`, (route) => {
    readsAt.push(Date.now());
    return route.fulfill({ json: Date.now() >= flipAt ? MONTHLY_SUBSCRIBER_VIEW : NO_SUBSCRIPTION_VIEW });
  });

  const returnedAt = Date.now();
  flipAt = returnedAt + 4_500;
  await page.goto('/settings/plan?checkout=success');

  // ── Checking: the box is there, and holds its size ──────────────────
  await expect(returnLine(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(EN.plan.returned.success)).toBeVisible();
  // Nothing is sold while the payment is being confirmed.
  await expect(page.locator('[data-slot="plan-order-button"]')).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  await waitForFonts(page);
  await settleAnimations(page);
  const boxChecking = await returnLine(page).boundingBox();
  const shiftsBefore = (await readShiftEntries(page)).length;

  // ── Active ──────────────────────────────────────────────────────────
  await expect(page.getByText(COPY.paywall.returned.active, { exact: true })).toBeVisible({ timeout: 15_000 });
  const boxActive = await returnLine(page).boundingBox();
  expect(boxActive, 'the return line changed its box').toEqual(boxChecking);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift when the plan turned active').toBe(
    0,
  );
  expect(
    readsAt.filter((at) => at >= returnedAt).length,
    'the page read the plan once or twice rather than polling it',
  ).toBeGreaterThanOrEqual(3);
  await expect(page.locator('[data-slot="plan-status-card"]')).toBeVisible();

  // ── The diary opens, and the gate agrees ────────────────────────────
  await page.getByRole('link', { name: COPY.paywall.returned.openDiary, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle(COPY.meta.dashboard);
});

test('THE CONTROL for the poll: a return whose plan never turns active never says it is active', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, spentCore());
  await signIn(page);
  const readsAt: number[] = [];
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/plans/me`, (route) => {
    readsAt.push(Date.now());
    return route.fulfill({ json: NO_SUBSCRIPTION_VIEW });
  });
  const returnedAt = Date.now();
  await page.goto('/settings/plan?checkout=success');
  await expect(page.getByText(EN.plan.returned.success)).toBeVisible({ timeout: 10_000 });
  // Long enough for three polls, which is what the case above needed.
  await expect
    .poll(() => readsAt.filter((at) => at >= returnedAt).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);
  await expect(page.getByText(COPY.paywall.returned.active, { exact: true })).toBeHidden();
  await expect(page.getByRole('link', { name: COPY.paywall.returned.openDiary, exact: true })).toBeHidden();
});

/** Waits for the page's fonts, so a font swap in the header is not read as the page moving. */
async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
