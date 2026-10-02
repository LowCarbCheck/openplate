/**
 * `/welcome` says WHY a session the server ended is over, and says it truthfully.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * A suspended account was classified as `reauth-required`, so `/welcome` told a
 * suspended person to sign in again, and that sign-in cannot work: the account
 * is suspended. `endStaleAttempt` also ignored the real failure and always
 * published `reauth-required`, so even a refresh the core answered with
 * `403 account-suspended` read as "your session ended".
 *
 * The reason line now carries `data-reason`: `suspended` for a suspension,
 * `reauth-required` for a revoked or expired session. On a managed instance
 * the second one also says the device hid the diary (a different sentence, the
 * same `data-reason`), and that is asked of the instance policy, never of the
 * mode name.
 *
 * ── What is real and what is stubbed ─────────────────────────────────────
 *
 * REAL: the production build as a managed instance, the sign-in, the session
 * the device saved, the resume on the next load, the device lock and the
 * redirect to `/welcome`. STUBBED (`managed-core-stub.ts`): the account facts,
 * and the one answer under test, the refresh a resumed session spends first
 * (`refreshRefusal`).
 *
 * ── Why it reads a data attribute and not a sentence ─────────────────────
 *
 * The copy belongs to the wordsmith pass.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * A REVOKED token (`401`) on the same path gives `data-reason="reauth-required"`
 * and no `suspended` line. Without it a screen that said `suspended` for every
 * ended session would pass the suspension check, and a screen that showed no
 * reason at all would fail it for the wrong reason.
 */
import { expect, test } from '@playwright/test';

import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** One sign-in, one onboarding and a reload fit in this. */
const TEST_BUDGET_MS = 90_000;

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A signed-in account on an instance that sells nothing, so no paywall stands in the way. */
function accountStub(): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: false,
    displayName: null,
  };
}

/** The reason line on `/welcome`, whatever it says. */
const REASON_LINE = '[data-reason]';

test('a suspended account is told so on the welcome screen, not asked to sign in again', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  const stub = accountStub();
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);
  await expect(page.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible({ timeout: 10_000 });

  // The administrator suspends the account. The next load resumes the saved
  // session, spends the refresh token, and meets `403 account-suspended`.
  stub.refreshRefusal = 'suspended';
  await page.goto(`${server.url}/diary`);

  await page.waitForURL((url) => url.pathname === '/welcome');
  await expect(page.locator('[data-reason="suspended"]')).toHaveCount(1, { timeout: 10_000 });
  // The one line, and it is not the sign-in-again line.
  await expect(page.locator(REASON_LINE)).toHaveCount(1);
  await expect(page.locator('[data-reason="reauth-required"]')).toHaveCount(0);
});

test('a revoked session still asks the person to sign in again (control)', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  const stub = accountStub();
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);
  await expect(page.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible({ timeout: 10_000 });

  stub.refreshRefusal = 'unauthorized';
  await page.goto(`${server.url}/diary`);

  await page.waitForURL((url) => url.pathname === '/welcome');
  await expect(page.locator('[data-reason="reauth-required"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('[data-reason="suspended"]')).toHaveCount(0);
});
