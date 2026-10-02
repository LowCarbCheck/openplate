/**
 * The sign-out dialog on a managed instance, before anybody asks to erase.
 *
 * ── The defect this file encodes (operator report, 2026-10-02) ───────────
 *
 * On a managed instance a plain sign-out only HIDES the diary: the device is
 * locked until the account signs in again and nothing is deleted. The dialog
 * still opened with "N changes have not reached the server, an erase loses
 * them" and a pointer to the backup, all of it BEFORE the erase box was
 * ticked, so a plain sign-out read as if it removed data. The operator found
 * it confusing. The erase warnings now appear only after the person ticks the
 * box (ADR-0016, amended 2026-10-02): the cost of an erase shows before an
 * erase can be CONFIRMED, and the tick can be undone while the confirm cannot.
 *
 * ── What is real and what is stubbed ─────────────────────────────────────
 *
 * REAL: the production build as a managed instance, the sign-in, the session,
 * the header menu and the dialog. STUBBED: the account facts
 * (`managed-core-stub.ts`), the same stub `avatar-shows-name.spec.ts` uses.
 *
 * ── Why it reads data attributes and not sentences ───────────────────────
 *
 * The copy belongs to the wordsmith pass. `data-erase-line` names a line the
 * dialog said and `data-slot="erase-region"` is the box that holds them.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * After the tick, the same dialog shows a `data-erase-line`. Without it a
 * dialog that never showed an erase line at all would pass the absence checks.
 *
 * ── The note on /settings/account (the sign-out copy, 2026-10-02) ─────────
 *
 * The note under the sign-out button said "Your diary stays on this one", which
 * is wrong on a managed instance: the diary stays on the device but is locked
 * and hidden until the next sign-in. The note now carries `data-diary`, and the
 * managed tier must say `account`. The open tier's twin is in
 * `sign-out-unsent.spec.ts`, which must say `device` for the same element, so a
 * note that carried `account` everywhere would fail there.
 *
 * ── Where a sign-out the person chose lands (2026-10-02) ─────────────────
 *
 * It used to land on `/`, the account front door, while a session the SERVER
 * ended lands on `/welcome`: two different "you are signed out" screens for
 * one state. Both now end on `/welcome`, and the document is never asked for
 * `/` on the way. The open tier's twin is in `sign-out-unsent.spec.ts`, which
 * must end on `/dashboard`, so a destination that was `/welcome` everywhere
 * would fail there.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCOUNT_EMAIL } from './env';
import { EN } from './copy';
import { recordDocumentPaths } from './helpers';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** One sign-in, one onboarding and a dialog fit in this. */
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
const ACCOUNT_STUB: ManagedCoreStub = {
  trialScans: null,
  allowanceExpiresAt: null,
  dailyAiLimit: 20,
  invitesLeft: null,
  memberInvites: false,
  planView: NO_SUBSCRIPTION_VIEW,
  plans: false,
  displayName: null,
};

/** Opens the sign-out dialog through the header menu, the way a person on a phone does. */
async function openSignOutDialogFromTheMenu(page: Page): Promise<void> {
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await page
    .getByRole('menuitem')
    .filter({ has: page.locator('svg.lucide-log-out') })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

test('a plain managed sign-out names no erase cost until the erase box is ticked', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);
  await expect(page.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible({ timeout: 10_000 });

  await openSignOutDialogFromTheMenu(page);
  const dialog = page.getByRole('alertdialog');
  const checkbox = dialog.getByRole('checkbox');
  // THE READ HAS SETTLED when the box can be ticked, so an absence below is
  // not a line that simply had not arrived yet.
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();

  // THE OPERATOR'S REPORT, stated as state: nothing about an erase is said, and
  // the box that holds those lines is not even on the page.
  await expect(dialog.locator('[data-erase-line]')).toHaveCount(0);
  await expect(dialog.locator('[data-slot="erase-region"]')).toHaveCount(0);

  // CONTROL: ticking the box brings the lines. Without it, a dialog that never
  // said anything about an erase would pass the two checks above.
  await checkbox.check();
  await expect(dialog.locator('[data-slot="erase-region"]')).toHaveCount(1);
  await expect(dialog.locator('[data-erase-line]').first()).toBeVisible();

  // And unticking takes them away again: the tick can be undone, and so can what it showed.
  await checkbox.uncheck();
  await expect(dialog.locator('[data-erase-line]')).toHaveCount(0);
  await expect(dialog.locator('[data-slot="erase-region"]')).toHaveCount(0);
});

test('the sign-out note on the account page says the diary stays in the account', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/settings/account`);
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();

  // ONE note, and it names where the diary stays. The lower page waits for the
  // handshake, so the auto-wait is what carries this past the first paint.
  const note = page.locator('p[data-diary]');
  await expect(note).toHaveCount(1, { timeout: 10_000 });
  await expect(note).toHaveAttribute('data-diary', 'account');
});

test('a plain managed sign-out lands on the welcome screen and is never sent through the front page', async ({
  page,
}) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);
  await expect(page.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible({ timeout: 10_000 });

  await openSignOutDialogFromTheMenu(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('checkbox')).toBeEnabled();

  // Recording starts at the confirm, so only the sign-out's own navigations count.
  const documents = recordDocumentPaths(page);
  await dialog.getByRole('button', { name: EN.signOut.confirm, exact: true }).click();

  await page.waitForURL((url) => url.pathname === '/welcome');
  // THE SAME SCREEN a session the server ended reaches, and the way there was
  // one document load: `/` was never asked for.
  expect(documents, 'the document the sign-out asked for').toContain('/welcome');
  expect(documents, 'the front page is never a stop on the way out').not.toContain('/');
});
