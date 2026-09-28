/**
 * An account made in this browser does not report a storage loss on every
 * page load (M253/11 item 6).
 *
 * THE DEFECT. The live test's fresh account logged "SyncStorageHeal: a sync
 * cycle withheld deletes: this device could not prove they happened" 13 times.
 * Reproduced here: once per document load, with `withheldCount: 1` and
 * `entityTypes: ["privateStore"]`. An account created through `/join` pushes
 * its sealed compartment in its first cycle, so the sync baseline holds it.
 * Every later document load starts a session that has not opened the
 * compartment yet (`sealOwnerPrivateRegion` answers `unknown` before the first
 * pull, as `sync-actions.ts` records), so the cycle rightly withholds the
 * compartment's tombstone. Nothing was lost and nothing was evicted, and the
 * heal still logged an eviction report and asked for persistent storage again.
 * The fixture account never showed it, because the setup creates it outside a
 * browser and no compartment reaches its baseline.
 *
 * THE WITHHOLDING IS UNCHANGED. Only the report leaves out a compartment that
 * this cycle could not see (`reportableWithheld` in `storage-heal.ts`, whose
 * unit test keeps a HELD compartment, the real shrink, reported).
 *
 * THE CONTROL is the build before the fix, where this check counted one
 * warning per load. The account is new per run, made through the fake
 * service's `__e2e__` invite seam, so the shared fixture account is untouched.
 */
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_SYNC_SERVER_URL } from './env';
import { routeManagedCore, trialAccountStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** How many document loads the check makes after the account exists. */
const LOADS = 3;

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** Mints an invite on the fake service for a new address. */
async function mintInvite(email: string): Promise<string> {
  const response = await fetch(`${E2E_SYNC_SERVER_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

/** Creates the account through `/join` and finishes onboarding. */
async function joinInBrowser(page: Page, inviteToken: string): Promise<void> {
  await page.goto(`${server.url}/join#server=${encodeURIComponent(E2E_SYNC_SERVER_URL)}&invite=${inviteToken}`);
  const passwords = page.locator('main input[type="password"]');
  await expect(passwords.first()).toBeVisible({ timeout: 10_000 });
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('main form button[type="submit"]').last().click();
  await page.waitForURL(/\/(diary|onboarding)/, { timeout: 60_000 });
  if (!page.url().includes('/onboarding')) return;
  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();
  await page.waitForURL('**/diary');
}

test('a document load of an account made in this browser reports no storage loss', async ({ page }) => {
  test.setTimeout(120_000);
  const healWarnings: string[] = [];
  let loadsSeen = 0;
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('SyncStorageHeal')) healWarnings.push(message.text());
  });
  await routeManagedCore(page, trialAccountStub(10));
  // THE ANCHOR: every load below must have finished a sync cycle, or a zero
  // would only say that no cycle ran.
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/sync/blob`, async (route) => {
    if (route.request().method() === 'GET') loadsSeen += 1;
    await route.continue();
  });

  await joinInBrowser(page, await mintInvite(`fresh-${Date.now()}@example.invalid`));
  await expect.poll(() => loadsSeen, { timeout: 15_000 }).toBeGreaterThan(0);

  for (let load = 1; load <= LOADS; load += 1) {
    const before = loadsSeen;
    await page.goto(`${server.url}/diary`);
    await expect
      .poll(() => loadsSeen, { timeout: 15_000, message: 'a load finished no sync cycle' })
      .toBeGreaterThan(before);
  }
  await page.waitForLoadState('networkidle');
  // The heal runs at the END of a cycle, after the pull counted above. A last
  // load that is not observed would let its warning arrive after the check, so
  // one more pull is awaited: the cycle before it has then finished.
  const lastPulls = loadsSeen;
  await page.goto(`${server.url}/diary`);
  await expect.poll(() => loadsSeen, { timeout: 15_000 }).toBeGreaterThan(lastPulls);

  expect(healWarnings).toEqual([]);
});
