/**
 * The scan screen's usage line states the ACCOUNT's free scans on a scan
 * trial, not this browser's own count (M253/11 item 1).
 *
 * THE DEFECT. After ten trial scans on production the screen said "AI usage
 * this month: 2 scans · cost unknown for your model". That line is read from
 * a log kept in this browser's own storage (`ai-usage-log.ts`), so it counts
 * only the scans THIS browser made since its storage was last cleared, and it
 * prices a managed scan as if the person had configured the model. The core
 * counts the trial per account (`AccountView.trialScans`, moved between reads
 * by `X-Trial-Scans-Left`), and that is the count this screen now states.
 *
 * THE SETUP reproduces the live mismatch on purpose: the account has already
 * spent eight of its ten scans on another device, this browser makes the last
 * two. A line that read the device log would say 2; the account says 10.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { PIXEL_PNG, routeManagedCore, routeManagedProxy, signInManaged, trialAccountStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';

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

/** The muted line at the foot of the capture card. */
function usageLine(page: Page) {
  return page.locator('main [data-slot="card"] p.text-xs').filter({ hasText: /\d/ }).last();
}

/** Photographs one plate on the scan screen and waits for the review. */
async function scanOnePlate(page: Page): Promise<void> {
  await page.goto(`${server.url}/add/photo`);
  await page
    .locator('[data-slot="card"] input[type="file"][capture]')
    .first()
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible({ timeout: 10_000 });
}

test('after the last two of ten free scans the line states ten of ten, not two', async ({ page }) => {
  test.setTimeout(90_000);
  const stub = trialAccountStub(2);
  const counter = { left: 2 };
  await routeManagedCore(page, stub);
  await routeManagedProxy(page, counter);
  await signInManaged(page, server.url);

  await scanOnePlate(page);
  await scanOnePlate(page);
  // The core's own count after the two scans.
  stub.trialScans = { granted: 10, left: counter.left };

  await page.goto(`${server.url}/add/photo`);
  await expect(usageLine(page)).toHaveText(fill(EN.scan.capture.trialScansUsed, { used: '10', granted: '10' }), {
    timeout: 10_000,
  });
});

test('control: a paid account keeps the per-device line, which counts the scan it made', async ({ page }) => {
  test.setTimeout(90_000);
  const stub = { ...trialAccountStub(0), trialScans: null, allowanceExpiresAt: '2030-01-01T00:00:00.000Z' };
  await routeManagedCore(page, stub);
  await routeManagedProxy(page, { left: 0 });
  await signInManaged(page, server.url);

  await scanOnePlate(page);
  await page.goto(`${server.url}/add/photo`);
  const line = usageLine(page);
  await expect(line).toContainText('1', { timeout: 10_000 });
  await expect(line).not.toHaveText(fill(EN.scan.capture.trialScansUsed, { used: '1', granted: '10' }));
});
