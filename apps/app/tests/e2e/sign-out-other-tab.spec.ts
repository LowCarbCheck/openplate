/**
 * A SECOND open tab is told when another tab signs out.
 *
 * ── The defect this file encodes (2026-10-02) ────────────────────────────
 *
 * Two tabs of the same account, both on the diary. Tab 1 signs out. Tab 2 said
 * nothing and kept showing the diary until its access token failed to refresh,
 * about 15 minutes later, and then it said "Your session ended", which reads
 * as if the SERVER had ended it. The person had chosen to sign out on this
 * device, and the other tab of the same device carried on as if nothing had
 * happened. After an ERASE the tab was worse than stale: its TinyBase
 * persisters were still alive and could write the rows back into a database
 * that had just been deleted (the danger `sign-out-flow.ts` names for the
 * current tab only).
 *
 * The device lock and the sync baseline are `localStorage` keys, and the
 * browser tells every OTHER tab of the origin when one changes. The tab now
 * listens (`use-leave-when-another-tab-signs-out.ts`) and leaves by a hard
 * navigation, so its in-memory stores die with the document.
 *
 * ── What is real and what is stubbed ─────────────────────────────────────
 *
 * REAL: the production build as a managed instance, the sign-in, two pages in
 * ONE browser context (one `localStorage`, which is what two tabs share), the
 * header menu and the dialog. STUBBED: the account facts (`managed-core-stub.ts`).
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * (a) A third page on `/imprint`, a public page that does not mount the
 * personal layout, does NOT move in the same test where the diary tab does.
 * Without it a listener that sent EVERY tab of the origin away would pass.
 * (b) The diary tab moving is the positive control for (a): if the event never
 * arrived in this run, (a) would pass for the wrong reason.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** One sign-in, two tabs and a dialog fit in this. */
const TEST_BUDGET_MS = 120_000;

/** How long the other tab may take to leave once the first one has signed out. */
const LEAVE_BUDGET_MS = 3_000;

/** How long a tab that must NOT move is watched, after the one that must has moved. */
const STAY_WATCH_MS = 1_500;

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

/** A second tab of the same context, on the diary and signed in from the shared device storage. */
async function openDiaryTab(page: Page): Promise<Page> {
  const tab = await page.context().newPage();
  await routeManagedCore(tab, ACCOUNT_STUB);
  await tab.goto(`${server.url}/dashboard`);
  await expect(tab.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible({ timeout: 10_000 });
  expect(new URL(tab.url()).pathname, 'the second tab is on the diary').toBe('/dashboard');
  return tab;
}

/** Signs tab 1 in and leaves it on the diary. */
async function signInFirstTab(page: Page): Promise<void> {
  await routeManagedCore(page, ACCOUNT_STUB);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/dashboard`);
  await expect(page.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible({ timeout: 10_000 });
}

/** Opens the dialog in `page`, optionally ticks the erase box, and confirms. */
async function signOut(page: Page, options: { erase: boolean }): Promise<void> {
  await openSignOutDialogFromTheMenu(page);
  const dialog = page.getByRole('alertdialog');
  const checkbox = dialog.getByRole('checkbox');
  await expect(checkbox).toBeEnabled();
  if (options.erase) await checkbox.check();
  await dialog.getByRole('button', { name: EN.signOut.confirm, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/welcome');
}

test('a plain sign-out in one tab sends the other diary tab to the welcome screen', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await signInFirstTab(page);
  const other = await openDiaryTab(page);

  await signOut(page, { erase: false });

  // THE DEFECT, stated as state: the other tab has left the diary. It used to
  // sit on `/dashboard` for the lifetime of its access token.
  await other.waitForURL((url) => url.pathname === '/welcome', { timeout: LEAVE_BUDGET_MS });
});

test('an erasing sign-out in one tab sends the other diary tab away too', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await signInFirstTab(page);
  const other = await openDiaryTab(page);

  await signOut(page, { erase: true });

  await other.waitForURL((url) => url.pathname === '/welcome', { timeout: LEAVE_BUDGET_MS });
});

/** The sync baseline keys and the diary databases this origin holds, read from `page`. */
async function leftOnTheDevice(page: Page): Promise<{ baselines: string[]; databases: string[] }> {
  return page.evaluate(async () => ({
    baselines: Object.keys(localStorage).filter((key) => key.startsWith('openplate.sync.state.v1')),
    databases: (await indexedDB.databases()).map((database) => database.name ?? ''),
  }));
}

test('an erase in one tab is not written back by the other tab', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await signInFirstTab(page);
  const other = await openDiaryTab(page);

  await signOut(page, { erase: true });
  // The other tab's persisters and its sync cycle are what wrote the baseline,
  // the outbox and the photo database back, within a few seconds of the erase.
  await other.waitForTimeout(STAY_WATCH_MS * 3);

  const left = await leftOnTheDevice(page);
  // THE DANGER NAMED IN `sign-out-flow.ts`, stated as state. A baseline that
  // outlives the diary is the silent empty diary of `device-erase.ts`.
  expect(left.baselines, 'the erased account keeps no sync baseline').toEqual([]);
  expect(left.databases, 'the erase deleted the outbox').not.toContain('openplate-outbox');
  expect(left.databases, 'the erase deleted the photos').not.toContain('openplate-photos');
});

test('a public page in a third tab stays where it is when the diary tabs leave', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await signInFirstTab(page);
  const diaryTab = await openDiaryTab(page);
  const publicTab = await page.context().newPage();
  await routeManagedCore(publicTab, ACCOUNT_STUB);
  await publicTab.goto(`${server.url}/imprint`);
  expect(new URL(publicTab.url()).pathname, 'the third tab is on a public page').toBe('/imprint');

  await signOut(page, { erase: false });

  // THE POSITIVE CONTROL: the diary tab did move in this very run, so the
  // event reached this context and the stay below is a real answer.
  await diaryTab.waitForURL((url) => url.pathname === '/welcome', { timeout: LEAVE_BUDGET_MS });
  await publicTab.waitForTimeout(STAY_WATCH_MS);
  expect(new URL(publicTab.url()).pathname, 'a page that shows no diary has nothing to leave').toBe('/imprint');
});
