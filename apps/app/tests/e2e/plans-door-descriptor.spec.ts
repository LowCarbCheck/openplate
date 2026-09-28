/**
 * A cached instance descriptor must not open the plan page (M245/05).
 *
 * ── THE REPORT ───────────────────────────────────────────────────────────
 *
 * 2026-09-23, from the design session: `/settings/plan` opened on the local
 * preview while the local core's `/health` answered `plans: false`. The
 * hypothesis handed over was a descriptor from ANOTHER instance in the same
 * origin's storage. This tier found no persisted descriptor anywhere: the one
 * cache is `readCachedServerInstance`'s module-scope map, keyed on the server
 * URL and alive for the whole tab. So the path that reproduces is the same URL
 * whose answer changed while a tab sat open (a core restarted with its biller
 * switched off), followed by a CLIENT navigation, which runs the plan page's
 * gate against the tab's first answer instead of the server's current one.
 *
 * ── THE WALK ─────────────────────────────────────────────────────────────
 *
 * The settings hub is opened while the handshake says `plans: true`, which
 * fills the tab's cache and draws the plan row. Then the stub starts answering
 * `plans: false`, and the plan row is clicked. The gate must ask `/health`
 * again and answer the 404 the service itself answers.
 *
 * THE CONTROL is the same walk with the door left open: the same click reaches
 * the order, so the 404 above is the door and not a walk that never arrived.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCOUNT_EMAIL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW, routePlansCore, type PlansStub } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The plan row on the settings hub, drawn only while the tab's descriptor says the door is open. */
function planRow(page: Page) {
  return page.locator('a[href="/settings/plan"]');
}

/**
 * Stands a signed-in device on the settings hub with the plan row drawn, so
 * the tab's cached descriptor says `plans: true`.
 */
async function openHubWithPlanRow(page: Page, stub: PlansStub): Promise<{ healthReads: () => number }> {
  const requests = await routePlansCore(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await page.goto('/settings');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
  await expect(planRow(page)).toBeVisible();
  return { healthReads: () => requests.healthReads };
}

test('a descriptor cached while the door was open does not open the plan page once it shut', async ({ page }) => {
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY, plans: true };
  const { healthReads } = await openHubWithPlanRow(page, stub);
  const readsWhileOpen = healthReads();

  // The operator switches the biller off while this tab sits open.
  stub.plans = false;
  await planRow(page).click();
  await page.waitForURL('**/settings/plan');

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  await expect(page.locator('[data-slot="plan-choice"]')).toHaveCount(0);
  expect(healthReads(), 'the gate asked the server again instead of trusting the tab').toBeGreaterThan(
    readsWhileOpen,
  );
});

test('CONTROL: the same walk with the door still open reaches the order', async ({ page }) => {
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY, plans: true };
  await openHubWithPlanRow(page, stub);

  await planRow(page).click();
  await page.waitForURL('**/settings/plan');

  await expect(page.locator('[data-slot="plan-choice"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: '404' })).toHaveCount(0);
});

test('a full load after the door shut answers 404, as it always did', async ({ page }) => {
  // The document-load path: a fresh tab has no cache to be stale, so this
  // passed before the fix too. It stays so the fix cannot trade one path for
  // the other.
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY, plans: true };
  await openHubWithPlanRow(page, stub);
  stub.plans = false;
  await page.goto('/settings/plan');
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
});
