/**
 * The free tier's days left, next to its scans left (owner decision
 * 2026-09-30, openplate-core 0.25.0, M267/06).
 *
 * A new account on the paid instance is free until it has spent 10 photo
 * scans or 14 days have passed, whichever comes first. The account page and
 * the avatar menu already state the scans left; this is the day line beside
 * them, read from `AccountView.trialEndsAt`.
 *
 * WHAT IS REAL: the production build as a managed instance, the sign-in, the
 * session, the account page and the avatar menu. WHAT IS STUBBED: the
 * handshake, the plan reads and the account facts (`managed-core-stub.ts`).
 *
 * THE OWNER'S WORDING is the one sentence pinned here, and only through the
 * shipped catalog (`copy.ts`), so the check reads whatever the bundle says.
 *
 * THE CONTROL is the account with no scan trial (the "Beta supporter"
 * standing): the same end date on the wire, the page read to its allowance
 * line, and no day line.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames } from './layout-shift';
import { routeManagedCore, signInManaged, trialAccountStub, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

const HOUR_MS = 60 * 60 * 1000;

/** Five days and two hours ahead: rounded up, that is 6 days. */
const ENDS_IN_MS = (5 * 24 + 2) * HOUR_MS;

/** The day count {@link ENDS_IN_MS} must draw. */
const EXPECTED_DAYS = '6';

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A trial end `ENDS_IN_MS` from the moment the test runs. */
function trialEnd(): string {
  return new Date(Date.now() + ENDS_IN_MS).toISOString();
}

/** Every shift this document recorded, as a total and one readable failure message. */
async function shiftReport(page: Page): Promise<{ total: number; detail: string }> {
  const entries = await readShiftEntries(page);
  return {
    total: entries.reduce((sum, entry) => sum + entry.value, 0),
    detail: entries.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`).join('\n'),
  };
}

test('a scan-trial account reads its days left beside its scans left, and nothing moves', async ({ page }) => {
  test.setTimeout(90_000);
  const stub: ManagedCoreStub = { ...trialAccountStub(4), trialEndsAt: trialEnd(), trialDays: 14 };
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);

  await installShiftObserver(page);
  await page.goto(`${server.url}/settings/account`);
  const daysLine = fill(EN.account.allowance.trialDaysLeft_other, { count: EXPECTED_DAYS });
  const scansLine = fill(EN.account.allowance.trialScans, { left: '4', granted: '10' });
  const main = page.locator('main');
  await expect(main.getByText(scansLine).first()).toBeVisible({ timeout: 10_000 });
  await expect(main.getByText(daysLine).first()).toBeVisible();
  // The identity line and the allowance card both carry it.
  await expect(main.locator('[data-slot="trial-days-left"]')).toHaveCount(2);
  const nameField = page.locator('#account-display-name');
  const topBefore = await nameField.evaluate((element) => element.getBoundingClientRect().top);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
  await settleFrames(page);
  const topAfter = await nameField.evaluate((element) => element.getBoundingClientRect().top);
  expect(topAfter).toBe(topBefore);

  // THE WHOLE LOAD, but the header: the brand word swaps from the fallback
  // face to the web font on every document load, which is not this line.
  const entries = await readShiftEntries(page);
  const outsideHeader = entries.filter((entry) => entry.headerSources.length < entry.sources.length);
  const report = await shiftReport(page);
  expect(
    outsideHeader.reduce((sum, entry) => sum + entry.value, 0),
    report.detail,
  ).toBe(0);

  // THE AVATAR MENU'S ACCOUNT STRIP says it too, under the scans.
  await page.locator('header').getByRole('button', { name: EN.chrome.deviceMenuLabel, exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText(scansLine)).toBeVisible();
  await expect(menu.getByText(daysLine)).toBeVisible();
});

test('control: an account with no scan trial reads no day line, even with an end date on the wire', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stub: ManagedCoreStub = { ...trialAccountStub(0), trialScans: null, trialEndsAt: trialEnd() };
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);

  await page.goto(`${server.url}/settings/account`);
  const main = page.locator('main');
  // READ TO THE ALLOWANCE LINE FIRST, so the absence below is a page that
  // drew its account facts and not a page that drew nothing yet.
  const todayLine = fill(EN.account.allowance.today, { used: '0', limit: '20' });
  await expect(main.getByText(todayLine).first()).toBeVisible({ timeout: 10_000 });
  await expect(main.locator('[data-slot="trial-days-left"]')).toHaveCount(0);
  await expect(main.getByText(fill(EN.account.allowance.trialDaysLeft_other, { count: EXPECTED_DAYS }))).toHaveCount(0);

  await page.locator('header').getByRole('button', { name: EN.chrome.deviceMenuLabel, exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText(todayLine)).toBeVisible();
  await expect(menu.locator('[data-slot="trial-days-left"]')).toHaveCount(0);
});
