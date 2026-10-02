/**
 * A SECOND press of Sign out while another tab still holds the diary.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * `deleteIndexedDbDatabase` armed its timer only when its request fired
 * `blocked`. The first press does fire it, so the first press reports the
 * failure after 3 s. A second press, with the other tab STILL open, queues its
 * `deleteDatabase` behind the first one that is still pending, and a queued
 * request never fires `blocked` of its own. It had no timer, so it never
 * settled: after the dialog's 15 s deadline both buttons were disabled (a
 * running sign-out cannot be closed) and the error was empty, and the person
 * had to reload the app. The wait is now bounded from the moment the request is
 * made, so the second press reports the same failure as the first.
 *
 * ── What is real here ────────────────────────────────────────────────────
 *
 * Everything, as in `sign-out-erase-blocked.spec.ts`: the "second tab" is a
 * second page of the same context that opens `openplate-primary` and keeps the
 * connection, with no `versionchange` handler.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * Closing the other tab and pressing once more must leave the page and remove
 * the diary database. Without it, a dialog that failed every erase would pass
 * the assertions above.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_APP_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';

/** The erase's blocked bound (3 s) plus slack, for the first press. */
const FIRST_REPORT_TIMEOUT_MS = 5_000;

/**
 * The second press has to report inside the dialog's own 15 s deadline, or the
 * person is stuck. The erase's overall cap is well under it.
 */
const SECOND_REPORT_TIMEOUT_MS = 15_000;

/** A document of this app's origin that is not the app, so nothing in it opens the diary but this spec. */
const HOLDER_PATH = '/robots.txt';

/** The name of the diary database, as `local-store/store.ts` names it. */
const PRIMARY_DB_NAME = 'openplate-primary';

async function openSignOutDialogFromTheMenu(page: Page): Promise<void> {
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await page
    .getByRole('menuitem')
    .filter({ has: page.locator('svg.lucide-log-out') })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

function confirmButton(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="alert-dialog-footer"] button').last();
}

function errorLayer(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="sign-out-error"]');
}

async function holdTheDiaryInASecondTab(page: Page): Promise<Page> {
  const second = await page.context().newPage();
  await second.goto(`${E2E_APP_URL}${HOLDER_PATH}`);
  await second.evaluate(
    (name) =>
      new Promise<void>((resolveOpen, rejectOpen) => {
        const open = indexedDB.open(name);
        open.addEventListener('error', () => rejectOpen(open.error));
        open.addEventListener('success', () => {
          Reflect.set(window, '__heldDiary', open.result);
          resolveOpen();
        });
      }),
    PRIMARY_DB_NAME,
  );
  return second;
}

async function databaseNames(page: Page): Promise<string[]> {
  const found = await page.evaluate(() => indexedDB.databases());
  return found.map((database) => database.name ?? '');
}

test('a second press of sign out while another tab holds the diary reports the failure again', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  const pathBefore = new URL(page.url()).pathname;

  const second = await holdTheDiaryInASecondTab(page);
  // CONTROL FOR THE HOLD: the diary database exists, so there is something to block.
  expect(await databaseNames(second)).toContain(PRIMARY_DB_NAME);

  await page.bringToFront();
  await openSignOutDialogFromTheMenu(page);
  await page.getByRole('alertdialog').getByRole('checkbox').check();
  await confirmButton(page).click();
  await expect(errorLayer(page)).toHaveText(/\S/, { timeout: FIRST_REPORT_TIMEOUT_MS });
  await expect(confirmButton(page)).toBeEnabled();

  // THE DEFECT: the other tab is still open, and the person presses again.
  // The alert is emptied while the sign-out runs and filled again on failure,
  // so wait for the button to be disabled first: a reading of the OLD text
  // would pass for a press that did nothing.
  await confirmButton(page).click();
  await expect(confirmButton(page)).toBeDisabled();
  await expect(errorLayer(page)).toHaveText(/\S/, { timeout: SECOND_REPORT_TIMEOUT_MS });
  await expect(confirmButton(page)).toBeEnabled({ timeout: SECOND_REPORT_TIMEOUT_MS });
  expect(new URL(page.url()).pathname, 'a failed erase keeps the page').toBe(pathBefore);

  // CONTROL: with the other tab closed, one more press leaves the page and
  // the diary database is gone from the device.
  await second.close();
  await Promise.all([page.waitForEvent('load'), confirmButton(page).click()]);
  await expect.poll(() => databaseNames(page), { timeout: FIRST_REPORT_TIMEOUT_MS }).not.toContain(PRIMARY_DB_NAME);
});
