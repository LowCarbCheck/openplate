/**
 * A sign-out whose logout request never gets an answer still ends.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * Pass 1 of the sign-out work made a RUNNING sign-out impossible to close:
 * Escape and Cancel are ignored while it runs, because a dialog that vanished
 * mid-erase would leave the person guessing what state the device was in. That
 * is only safe if the run always ENDS. `SyncAuthClient.logout()` awaited a
 * fetch with no timeout, so a captive portal or a half-open connection left a
 * spinner nobody could close, where before Pass 1 Escape would at least have
 * shut the dialog.
 *
 * The logout is best effort by design: the local session is cleared BEFORE the
 * request goes out, so nothing on the device depends on the answer. The client
 * now stops waiting after four seconds.
 *
 * ── What is real and what is stubbed ─────────────────────────────────────
 *
 * REAL: the production build, onboarding, the fixture account's sign-in, the
 * settings page, the dialog and the hard navigation that ends a sign-out.
 * STUBBED: one thing. `page.route` takes the logout POST and never answers it,
 * which is what a connection that accepted the request and then went quiet
 * looks like from the page. The preflight is let through, so the POST itself
 * is the request that hangs.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * The same sign-out, on the same page, without the route, leaves quickly. Both
 * timings are measured, each is held against its own bound, and the hung one
 * must be the slower of the two: a route that never matched anything would
 * leave the second sign-out as fast as the first and fail that comparison.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCOUNT_EMAIL } from './env';
import { EN } from './copy';
import { completeOnboarding, signInFixtureAccount } from './helpers';

/** The page must have left this soon after the confirm, with the logout hanging. */
const HUNG_LEAVE_BUDGET_MS = 10_000;

/** With an answering server a sign-out leaves well inside this. */
const FAST_LEAVE_BUDGET_MS = 5_000;

/** Two sign-ins, two dialogs and a four second wait. */
const TEST_BUDGET_MS = 90_000;

/** The logout request, whichever origin the core is on. */
const LOGOUT_URL = '**/v1/auth/logout';

/** `/settings/account` on a document load, once the session has been restored from the device. */
async function openAccountSettings(page: Page): Promise<void> {
  await page.goto('/settings/account');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();
}

/**
 * Confirms a plain sign-out and returns how long the page took to leave.
 *
 * @param page - a signed-in page.
 * @param leaveBudgetMs - how long to wait for the page to end up on `/dashboard`.
 * @returns the milliseconds from the confirm click to the landing.
 */
async function signOutAndTimeTheLeave(page: Page, leaveBudgetMs: number): Promise<number> {
  await openAccountSettings(page);
  await page.locator('button:has(svg.lucide-log-out)').first().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  // THE READ HAS SETTLED when the box can be ticked, so the confirm is the real one.
  await expect(dialog.getByRole('checkbox')).toBeEnabled();

  const startedAt = Date.now();
  await dialog.getByRole('button', { name: EN.signOut.confirm, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: leaveBudgetMs });
  return Date.now() - startedAt;
}

test('a sign-out whose logout never answers still leaves, and a normal one is quicker', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  // CONTROL FIRST: the server answers, and the sign-out leaves quickly.
  const fastMs = await signOutAndTimeTheLeave(page, FAST_LEAVE_BUDGET_MS);
  expect(fastMs, 'a sign-out the server answers').toBeLessThan(FAST_LEAVE_BUDGET_MS);

  // THE DEFECT: the same sign-out with the logout request swallowed. The
  // preflight goes on to the fake core, so only the POST hangs.
  await signInFixtureAccount(page);
  await page.route(LOGOUT_URL, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    // Never answered, never continued.
  });
  const hungMs = await signOutAndTimeTheLeave(page, HUNG_LEAVE_BUDGET_MS);
  expect(hungMs, 'a sign-out whose logout hangs').toBeLessThan(HUNG_LEAVE_BUDGET_MS);

  // CONTROL OF THE CONTROL: the route really held something back. Without
  // this, a route that matched nothing would let both sign-outs pass alike.
  expect(hungMs, 'the hung sign-out waited for the bound the fast one did not').toBeGreaterThan(fastMs);
});
