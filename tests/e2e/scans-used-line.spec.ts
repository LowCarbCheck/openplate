/**
 * At zero free AI scans the header says so and links to the plans (M253/11,
 * owner decision on item 5).
 *
 * THE GAP. `planStanding` reads a spent scan trial as `trial-ended`, and the
 * countdown draws nothing for that, so the header went from "1 free AI scan
 * left" to silence. The person learned the trial was over only from the
 * eleventh scan's refusal.
 *
 * WHERE IT IS DRAWN. In the header's status slot, as the countdown is, and not
 * as a row in flow like the update ribbon. The update ribbon sits above the
 * header and pushes the whole page down when it arrives (its own file says so),
 * and this line can only be decided after the account has been read, which is
 * after the first paint. The status slot sits inside the header's fixed box, so
 * the line arrives without moving anything, and the check below requires a
 * layout-shift total of 0.
 *
 * WHO SEES IT: a scan-trial account at zero, on every page but the plan page.
 * Not an account with scans left (it sees the count), not a subscriber, not a
 * standing grant with no count.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { installShiftObserver, readShiftEntries, settleFrames } from './layout-shift';
import { routeManagedCore, signInManaged, trialAccountStub, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { MONTHLY_SUBSCRIBER_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** The header's status row. */
function headerStatus(page: Page) {
  return page.locator('header [data-slot="header-status"]');
}

/** Signs in with the stub installed, then opens the diary in a fresh document with the shift observer running. */
async function openDiary(page: Page, stub: ManagedCoreStub): Promise<void> {
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);
  await installShiftObserver(page);
  await page.goto(`${server.url}/diary`);
}

/** Waits until every read the header could still be waiting for has answered. */
async function settleReads(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await settleFrames(page);
}

test('at zero free scans the header says so, links to the plans, and moves nothing', async ({ page }) => {
  await openDiary(page, trialAccountStub(0));

  await expect(headerStatus(page)).toContainText(EN.plan.countdown.scansUsed, { timeout: 10_000 });
  await settleReads(page);
  const entries = await readShiftEntries(page);
  const moved = entries.filter((entry) => !entry.sources.every((source) => source.startsWith('span "openplate"')));
  expect(
    moved.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`),
    'something moved while the line arrived',
  ).toEqual([]);

  await headerStatus(page).getByRole('button', { name: EN.plan.countdown.action, exact: true }).click();
  await page.waitForURL('**/settings/plan');
  // Not on the plan page itself: the page is the answer to the line.
  await settleReads(page);
  await expect(page.locator('header').first()).not.toContainText(EN.plan.countdown.scansUsed);
});

test('control: with scans left the header counts instead', async ({ page }) => {
  await openDiary(page, trialAccountStub(2));
  // THE ANCHOR: the same slot, read by the same session, says the count.
  await expect(headerStatus(page)).toContainText(fill(EN.plan.countdown.scansLeft_other, { count: '2' }), {
    timeout: 10_000,
  });
  await expect(page.locator('header').first()).not.toContainText(EN.plan.countdown.scansUsed);
});

test('a subscriber and a standing grant never see it', async ({ page }) => {
  const subscriber: ManagedCoreStub = {
    ...trialAccountStub(0),
    allowanceExpiresAt: '2030-01-01T00:00:00.000Z',
    planView: MONTHLY_SUBSCRIBER_VIEW,
  };
  await openDiary(page, subscriber);
  await expect(page.locator('main')).toBeVisible();
  await settleReads(page);
  await expect(page.locator('header').first()).not.toContainText(EN.plan.countdown.scansUsed);

  const standing: ManagedCoreStub = { ...trialAccountStub(0), trialScans: null };
  await page.unrouteAll({ behavior: 'wait' });
  await routeManagedCore(page, standing);
  await page.goto(`${server.url}/diary`);
  await expect(page.locator('main')).toBeVisible();
  await settleReads(page);
  await expect(page.locator('header').first()).not.toContainText(EN.plan.countdown.scansUsed);
});
