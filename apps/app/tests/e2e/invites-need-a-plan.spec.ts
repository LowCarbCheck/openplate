/**
 * A free trial cannot invite yet, and the account page says so (M253/11,
 * owner decision on item 4).
 *
 * THE DEFECT. A trial account read "Invitations you have left: 2". Each member
 * invitation is a new ten-scan trial, so a free account could mint free
 * accounts. The owner decided invitations open once the account holds a paid
 * plan. The core now answers `invitesLeft: 0` with `invitesNeedAPlan: true`
 * for such an account, and `403 invites-need-a-plan` on the route
 * (`PROTOCOL.md` §5.15 and §5.21, openplate-core 72350f0).
 *
 * WHAT IS CHECKED: the invite card of an unpaid trial says invitations open
 * with a plan, links to the plans, and has no address field; a paid member
 * sees the count and the field; an older core, which sends no
 * `invitesNeedAPlan`, keeps today's "all used" sentence for a zero.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL } from './env';
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

/** The invite card, found by its heading. */
function inviteSection(page: Page) {
  return page.locator('section').filter({ hasText: EN.account.invites.title });
}

/** Signs in with the stub and opens the account page. */
async function openAccount(page: Page, stub: ManagedCoreStub): Promise<void> {
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/settings/account`);
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();
}

test('an unpaid trial is told invitations open with a plan, with a link and no address field', async ({ page }) => {
  await openAccount(page, trialAccountStub(4));

  const section = inviteSection(page);
  await expect(section).toContainText(EN.account.invites.needsPlan, { timeout: 10_000 });
  await expect(section.getByRole('link', { name: EN.account.invites.needsPlanLink, exact: true })).toHaveAttribute(
    'href',
    '/settings/plan',
  );
  await expect(section.locator('input[type="email"]')).toHaveCount(0);
  await expect(section).not.toContainText(EN.account.invites.none);
});

test('control: a paid member sees the count and the address field', async ({ page }) => {
  await openAccount(page, {
    ...trialAccountStub(4),
    allowanceExpiresAt: '2030-01-01T00:00:00.000Z',
    invitesLeft: 2,
    invitesNeedAPlan: false,
    planView: MONTHLY_SUBSCRIBER_VIEW,
  });

  const section = inviteSection(page);
  await expect(section).toContainText(fill(EN.account.invites.left, { left: '2' }), { timeout: 10_000 });
  await expect(section.locator('input[type="email"]')).toHaveCount(1);
  await expect(section).not.toContainText(EN.account.invites.needsPlan);
});

test('an older core that sends no invitesNeedAPlan keeps the all-used sentence for a zero', async ({ page }) => {
  await openAccount(page, { ...trialAccountStub(4), invitesNeedAPlan: undefined });

  const section = inviteSection(page);
  await expect(section).toContainText(EN.account.invites.none, { timeout: 10_000 });
  await expect(section).not.toContainText(EN.account.invites.needsPlan);
});
