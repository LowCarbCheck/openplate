/**
 * The last free scan keeps its review on screen (the paywall, 2026-09-28).
 *
 * THE DEFECT, found by `scan-trial-managed.spec.ts` while the paywall was
 * built. The proxy states the scans left with every answer, so the answer to
 * the last free scan brings the count to zero. The scan's own action then
 * revalidated the layout on the same address, the paywall read zero, and the
 * review of the plate the person had just scanned was replaced by the plan
 * page. The rule now: a navigation is decided, the page on screen is left
 * alone, so the person keeps the plate and meets the plan page on the next
 * page they open.
 *
 * WHAT IS REAL: the production build as a MANAGED instance, so AI goes through
 * the managed credential and the app reads `X-Trial-Scans-Left`. WHAT IS
 * STUBBED: the core and its AI proxy (`managed-core-stub.ts`).
 *
 * @area plans-and-paywall
 */
import { expect, test } from '@playwright/test';

import { BOTTOM_BAR } from './clip-baseline';
import { EN } from './copy';
import { PIXEL_PNG, routeManagedCore, routeManagedProxy, signInManaged, trialAccountStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** A sign-in, a scan and a tap outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/** Past the moment a revalidation after the scan would have redirected. */
const REVIEW_WATCH_MS = 1_500;

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

test('the last free scan keeps its review on screen, and the next page opened is the plan page', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = trialAccountStub(1);
  const counter = { left: 1 };
  await routeManagedCore(page, stub);
  await routeManagedProxy(page, counter);
  await signInManaged(page, server.url);
  await expect(page, 'one free scan left is not locked').toHaveURL(/\/diary$/);

  await page.goto(`${server.url}/add/photo`);
  await page
    .locator('[data-slot="card"] input[type="file"][capture]')
    .first()
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible({ timeout: 10_000 });
  expect(counter.left, 'the proxy did not spend the last scan').toBe(0);
  // The core's own count, from now on.
  stub.trialScans = { granted: 10, left: 0 };

  // ── The review stays ────────────────────────────────────────────────
  await page.waitForTimeout(REVIEW_WATCH_MS);
  await expect(page).toHaveURL(/\/add\/photo/);
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();

  // THE CONTROL: the account IS locked now, so the next page is the plan
  // page. Without this, a gate that never locked would pass the check above.
  await page.locator(`${BOTTOM_BAR} a[href="/diary"]`).click();
  await expect(page).toHaveURL(/\/settings\/plan$/, { timeout: 10_000 });
  await expect(page.locator('[data-slot="paywall-notice"]')).toBeVisible();
});
