/**
 * The erase box does not wait for ever on a read that never answers.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * The dialog counts what an erase would lose by reading the diary under the
 * sync orchestrator's Web Lock (`readUnsentOnDevice`). Another tab's hung sync
 * can hold that lock for good, and the read then never settles: the erase box
 * stayed disabled with the line "checking" for as long as the dialog was open,
 * so a person could sign out but could not even choose to erase. The dialog now
 * gives the read a deadline from the moment it opens (5 s) and treats a read
 * that has not answered by then as one that failed. That is the line "could not
 * be checked", and it is the allowed direction: over-warning, never an
 * all-clear for a device nobody looked at.
 *
 * ── What is real here ────────────────────────────────────────────────────
 *
 * The lock is the real one. A second page of the same browser context takes
 * `openplate-sync-orchestrator` and returns a promise that never settles, which
 * is exactly what a tab stuck inside a sync cycle does.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * The same dialog without a held lock answers with a count or the all-clear,
 * never with "could not be checked". Without it, a dialog that said "unchecked"
 * to everybody would pass the first test.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_APP_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';

/** The name of the lock, as `app/lib/sync/sync-lock.ts` names it. Duplicated on purpose: a rename must fail here. */
const ORCHESTRATOR_LOCK_NAME = 'openplate-sync-orchestrator';

/** A document of this app's origin that is not the app, so nothing in it takes a lock but this spec. */
const HOLDER_PATH = '/robots.txt';

/** The dialog's deadline is 5 s; the box must be usable within this, with slack for a slow machine. */
const BOX_ENABLED_WITHIN_MS = 7_000;

/** Takes the orchestrator lock in a second page and never lets go. Resolves once it is granted. */
async function holdTheOrchestratorLockForGood(page: Page): Promise<Page> {
  const holder = await page.context().newPage();
  await holder.goto(`${E2E_APP_URL}${HOLDER_PATH}`);
  await holder.evaluate(
    (name) =>
      new Promise<void>((resolveGranted) => {
        void navigator.locks.request(name, () => {
          resolveGranted();
          return new Promise<void>(() => {});
        });
      }),
    ORCHESTRATOR_LOCK_NAME,
  );
  return holder;
}

/** Opens the sign-out dialog through the header menu, the way a person on a phone does. */
async function openSignOutDialogFromTheMenu(page: Page): Promise<void> {
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await page
    .getByRole('menuitem')
    .filter({ has: page.locator('svg.lucide-log-out') })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

test('a read that never settles still frees the erase box, with the could-not-check line', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  const holder = await holdTheOrchestratorLockForGood(page);
  await page.bringToFront();
  await openSignOutDialogFromTheMenu(page);
  const dialog = page.getByRole('alertdialog');
  const eraseBox = dialog.getByRole('checkbox');

  // THE DEFECT: the box never became enabled. It must within the deadline.
  await expect(eraseBox).toBeEnabled({ timeout: BOX_ENABLED_WITHIN_MS });
  await eraseBox.check();
  await expect(dialog.locator('[data-slot="erase-notice"] [data-erase-line="unchecked"]')).toBeVisible();

  await holder.close();
});

test('while the read is out the disabled box says why, in a visually hidden note', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  const holder = await holdTheOrchestratorLockForGood(page);
  // CONTROL FOR THE HOLD: the second page really holds the lock.
  expect(
    await holder.evaluate(
      (name) => navigator.locks.query().then((state) => (state.held ?? []).some((lock) => lock.name === name)),
      ORCHESTRATOR_LOCK_NAME,
    ),
    'the second page holds the lock',
  ).toBe(true);

  await page.bringToFront();
  await openSignOutDialogFromTheMenu(page);
  const eraseBox = page.getByRole('alertdialog').getByRole('checkbox');
  await expect(eraseBox).toBeDisabled();
  await expect(eraseBox).toHaveAttribute('aria-describedby', /\S/);
  const waitingId = await eraseBox.getAttribute('aria-describedby');
  const waitingNote = page.locator(`[id="${waitingId}"]`);
  await expect(waitingNote).toHaveCount(1);
  expect(((await waitingNote.textContent()) ?? '').trim().length, 'the waiting note has words').toBeGreaterThan(0);
  expect(await waitingNote.evaluate((element) => element.className), 'visually hidden').toContain('sr-only');

  // The note goes with the wait, so nothing stale is read out once the box is usable.
  await expect(eraseBox).toBeEnabled({ timeout: BOX_ENABLED_WITHIN_MS });
  await expect(waitingNote).toHaveCount(0);

  await holder.close();
});

test('without a held lock the same dialog answers with a count or the all-clear', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  await openSignOutDialogFromTheMenu(page);
  const dialog = page.getByRole('alertdialog');
  const eraseBox = dialog.getByRole('checkbox');
  await expect(eraseBox).toBeEnabled({ timeout: BOX_ENABLED_WITHIN_MS });
  await eraseBox.check();

  const notice = dialog.locator('[data-slot="erase-notice"]');
  await expect(
    notice.locator('[data-erase-line="all-sent"], [data-erase-line="unsent-changes"]').first(),
  ).toBeVisible();
  await expect(notice.locator('[data-erase-line="unchecked"]')).toHaveCount(0);
});
