/**
 * Sign-out with the erase box ticked, while a second tab holds the diary.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * The dialog rendered only while the session was open, and the first step of a
 * sign-out publishes "signed out". So the dialog UNMOUNTED at the start of its
 * own work. When the erase then failed, because another tab held the database,
 * `setError` wrote to a component that no longer existed and the hard
 * navigation never ran: the person saw a signed-out app, the diary still on the
 * device, and no message at all. The fix keeps the dialog mounted above the
 * routes until the sign-out has finished, and this is the browser proof.
 *
 * ── What is real here ────────────────────────────────────────────────────
 *
 * EVERYTHING. The device, onboarding, the fixture account, the sign-in, the
 * header menu and the dialog are the production build's own. The "second tab"
 * is a second page in the same browser context that opens `openplate-primary`
 * and keeps the connection, with no `versionchange` handler, which is exactly
 * what a second openplate tab does to a delete (`device-erase.ts`).
 *
 * ── Why it reads data attributes and not sentences ───────────────────────
 *
 * The copy belongs to the wordsmith pass. The error paragraph carries
 * `data-slot="sign-out-error"`, and the controls are found by role and icon.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * (a) With the other tab closed, the same dialog's confirm button works: the
 * page leaves and the database is gone. Without it, a dialog that failed every
 * erase would pass the error assertion.
 * (b) A dialog opened from the header menu and cancelled leaves the menu
 * openable and the page clickable. The menu used to take focus back on close
 * and could leave `pointer-events: none` on the body.
 * (c) The notice never flips to the "could not be checked" line while the
 * erase runs or after it failed. The session closes at the first step of the
 * sign-out, and a notice that followed it would warn about a device it can no
 * longer see. A `MutationObserver` records any moment that line is on screen,
 * and a planted line proves the recorder can see one.
 * (d) The error has its box before it is needed, and its ANNOUNCEMENT is a
 * real one. A sizer layer (`sign-out-error-sizer`, `invisible`, `aria-hidden`)
 * holds the fixed sentence so the box is reserved from the tick, and the
 * `role="alert"` node is EMPTY until the failure and then receives the text,
 * because a screen reader announces text arriving in a live region, not a node
 * becoming visible. The confirm button does not move when the sentence arrives.
 * (e) Cancel after a failed erase leaves the diary for the sign-out's own
 * destination, by a hard navigation. The session was closed at the first step,
 * and the revalidation that would have sent the person on was skipped while the
 * sign-out ran, so a Cancel that only closed the dialog left a signed-out
 * person on a diary page. Cancel from an idle dialog still keeps the page.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_APP_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import { settleAnimations } from './layout-shift';

/** How long the dialog may take to report a blocked erase: the erase's own 3 s bound, plus slack. */
const REPORT_TIMEOUT_MS = 5_000;

/** A document of this app's origin that is not the app, so nothing in it opens the diary but this spec. */
const HOLDER_PATH = '/robots.txt';

/**
 * Where a sign-out that did not erase leaves for on this tier (`signOutDestination`
 * with `locksDevice: false`): the open instance the smoke tier runs, so the
 * dashboard. A managed instance would say `/welcome`; `sign-out-managed.spec.ts`
 * holds that side.
 */
const OPEN_TIER_DESTINATION = '/dashboard';

/** The name of the diary database, as `local-store/store.ts` names it. */
const PRIMARY_DB_NAME = 'openplate-primary';

/** Opens the sign-out dialog through the header menu, the way a person on a phone does. */
async function openSignOutDialogFromTheMenu(page: Page): Promise<void> {
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await page
    .getByRole('menuitem')
    .filter({ has: page.locator('svg.lucide-log-out') })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

/** The dialog's confirm button: the last one in its footer, after Cancel. */
function confirmButton(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="alert-dialog-footer"] button').last();
}

/** The dialog's cancel button: the first one in its footer. */
function cancelButton(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="alert-dialog-footer"] button').first();
}

/**
 * A second page of this origin that opens the diary database and holds it,
 * with no `versionchange` handler, so a delete of that database is blocked.
 */
async function holdTheDiaryInASecondTab(page: Page): Promise<Page> {
  const second = await page.context().newPage();
  await second.goto(`${E2E_APP_URL}${HOLDER_PATH}`);
  await second.evaluate(
    (name) =>
      new Promise<void>((resolveOpen, rejectOpen) => {
        const open = indexedDB.open(name);
        open.addEventListener('error', () => rejectOpen(open.error));
        open.addEventListener('success', () => {
          // Kept on `window` so nothing collects the connection.
          Reflect.set(window, '__heldDiary', open.result);
          resolveOpen();
        });
      }),
    PRIMARY_DB_NAME,
  );
  return second;
}

/** The dialog's error node: the `role="alert"` one, in the erase region from the tick, EMPTY until a failure. */
function errorLayer(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="sign-out-error"]');
}

/**
 * Waits for the failure to be ANNOUNCED: the alert node has the sentence in it.
 * Not `toBeVisible`: the empty alert fills its grid cell, so it counts as
 * visible from the tick, and waiting on that would return before any failure.
 */
async function expectTheErrorToBeAnnounced(page: Page): Promise<void> {
  await expect(errorLayer(page)).toHaveText(/\S/, { timeout: REPORT_TIMEOUT_MS });
}

/** The invisible layer that holds the fixed sentence, so the box is reserved before the alert has any text. */
function errorSizer(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="sign-out-error-sizer"]');
}

/** The confirm button's top edge, from the top of the viewport (the dialog is fixed). */
async function confirmTop(page: Page): Promise<number> {
  return confirmButton(page).evaluate((element) => Math.round(element.getBoundingClientRect().top * 10) / 10);
}

/**
 * Starts recording whether the "could not be checked" line is ever on screen.
 * Returns a reader for the answer. The line is looked up in the whole document
 * on every DOM change, so a moment between two polls is not missed.
 */
async function watchForTheUncheckedLine(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const selector = '[data-erase-line="unchecked"]';
    Reflect.set(window, '__sawUnchecked', document.querySelector(selector) !== null);
    new MutationObserver(() => {
      if (document.querySelector(selector) !== null) Reflect.set(window, '__sawUnchecked', true);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  return () => page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__sawUnchecked')?.value === true);
}

/** The names of the databases this origin holds. */
async function databaseNames(page: Page): Promise<string[]> {
  const found = await page.evaluate(() => indexedDB.databases());
  return found.map((database) => database.name ?? '');
}

test('a failed erase on sign-out says so inside the dialog, and the retry signs out', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  const pathBefore = new URL(page.url()).pathname;

  const second = await holdTheDiaryInASecondTab(page);
  // CONTROL FOR THE HOLD: the diary database exists, so there is something to block.
  expect(await databaseNames(second)).toContain(PRIMARY_DB_NAME);

  await page.bringToFront();
  await openSignOutDialogFromTheMenu(page);
  await page.getByRole('alertdialog').getByRole('checkbox').check();

  // THE ERROR HAS ITS BOX BEFORE IT IS NEEDED (d): the alert node is in the
  // erase region from the tick and holds NO TEXT, and the sizer layer that
  // reserves the box holds the sentence, hidden from sight and from a screen
  // reader. A live region announces text arriving in it.
  await expect(errorLayer(page)).toHaveCount(1);
  await expect(errorLayer(page)).toHaveAttribute('role', 'alert');
  expect(await errorLayer(page).textContent(), 'the alert is empty until the failure').toBe('');
  await expect(errorSizer(page)).toHaveCount(1);
  await expect(errorSizer(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(errorSizer(page)).not.toBeVisible();
  expect((await errorSizer(page).textContent())?.trim().length, 'the sizer holds the sentence').toBeGreaterThan(0);
  await settleAnimations(page);
  const topBeforeThePress = await confirmTop(page);
  await confirmButton(page).click();

  // THE DEFECT, stated as state: the error is on screen, in the dialog, and
  // the page has not gone anywhere.
  await expectTheErrorToBeAnnounced(page);
  expect(new URL(page.url()).pathname).toBe(pathBefore);
  // (d) CONTROL: the alert was empty a moment ago and has the sentence now
  // (the same node, so the announcement is text arriving), and the button
  // under it did not move for the sentence.
  expect((await errorLayer(page).textContent())?.trim().length, 'the alert received the sentence').toBeGreaterThan(0);
  expect(await errorLayer(page).textContent()).toBe(await errorSizer(page).textContent());
  await settleAnimations(page);
  expect(await confirmTop(page), 'the error layer must not move the confirm button').toBe(topBeforeThePress);

  // CONTROL (a): close the other tab and press confirm again. The page must
  // leave, and the diary must be gone from the device.
  await second.close();
  await expect(confirmButton(page)).toBeEnabled();
  await Promise.all([page.waitForEvent('load'), confirmButton(page).click()]);
  await expect.poll(() => databaseNames(page), { timeout: REPORT_TIMEOUT_MS }).not.toContain(PRIMARY_DB_NAME);
});

test('cancelling after a failed erase leaves the diary for the sign-out destination', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  const pathBefore = new URL(page.url()).pathname;
  // The destination is not the page the person is on, or this would prove nothing.
  expect(pathBefore).not.toBe(OPEN_TIER_DESTINATION);

  const second = await holdTheDiaryInASecondTab(page);
  await page.bringToFront();
  await openSignOutDialogFromTheMenu(page);
  await page.getByRole('alertdialog').getByRole('checkbox').check();
  await confirmButton(page).click();
  await expectTheErrorToBeAnnounced(page);
  // The session is closed and the revalidation was skipped: the person is
  // still on the diary page, with the error and the retry in front of them.
  expect(new URL(page.url()).pathname).toBe(pathBefore);

  // THE DEFECT: Cancel closed the dialog and left a signed-out person on a
  // diary page. It now ends the visit with the hard navigation the sign-out
  // itself would have made.
  await cancelButton(page).click();
  await page.waitForURL((url) => url.pathname === OPEN_TIER_DESTINATION, {
    timeout: REPORT_TIMEOUT_MS,
    waitUntil: 'commit',
  });

  await second.close();
});

test('cancelling an untouched dialog keeps the page, and no document is loaded', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  const pathBefore = new URL(page.url()).pathname;
  await page.evaluate(() => Reflect.set(window, '__stillHere', true));

  await openSignOutDialogFromTheMenu(page);
  await cancelButton(page).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // CONTROL for the failed-erase test above: its navigation is the failure's
  // doing. A cancel from idle must not leave, or that test would pass for a
  // Cancel that always navigates. The marker survives only in the same document.
  await page.waitForTimeout(1_000);
  expect(new URL(page.url()).pathname).toBe(pathBefore);
  expect(await page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__stillHere')?.value === true)).toBe(true);
});

test('a dialog opened from the header menu and cancelled leaves the menu and the page usable', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  await openSignOutDialogFromTheMenu(page);
  await cancelButton(page).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // CONTROL (b): the body takes clicks, and the menu opens again.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none');
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await expect(page.getByRole('menu')).toBeVisible();
});

test('a blocked erase never turns the notice into the could-not-check line', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  const second = await holdTheDiaryInASecondTab(page);
  await page.bringToFront();
  await openSignOutDialogFromTheMenu(page);
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('checkbox').check();

  // From the tick on, every DOM change is checked for the line. A device that
  // has a session and a settled read has no business saying it cannot be read.
  const sawUnchecked = await watchForTheUncheckedLine(page);
  await expect(dialog.locator('[data-erase-line]').first()).toBeVisible();
  await confirmButton(page).click();

  // RUNNING: the button is disabled and the session is closing under the dialog.
  await expect(dialog.locator('[data-erase-line="unchecked"]')).toHaveCount(0);
  // BLOCKED: the error is on screen, and the notice is still the lines it had.
  await expectTheErrorToBeAnnounced(page);
  await expect(dialog.locator('[data-erase-line="unchecked"]')).toHaveCount(0);
  expect(await sawUnchecked(), 'the could-not-check line was on screen at some moment').toBe(false);

  // CONTROL: the recorder sees that line when one is planted, so the `false`
  // above is a reading and not a recorder that cannot fire.
  await page.evaluate(() => {
    const planted = document.createElement('span');
    planted.dataset.eraseLine = 'unchecked';
    planted.dataset.e2ePlanted = '';
    document.body.append(planted);
  });
  await expect.poll(sawUnchecked).toBe(true);
  await page.evaluate(() => document.querySelector('[data-e2e-planted]')?.remove());

  await second.close();
});
