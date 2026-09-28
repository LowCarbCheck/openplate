/**
 * The More sheet stays open when the person opened it after a navigation had already started.
 *
 * THE DEFECT (reported 2026-09-27 by the author of b271e2f, which fixed the same race in the add
 * sheet). The More sheet was open only while the location it was opened on was still the current
 * one: `MoreSheetProvider` compared the key it was opened on with `useLocation().key`, and dropped
 * the sheet in the render where the key changed. That render is the one where React COMMITS a new
 * location, not the moment the navigation starts. On a slow phone the two are far apart: the
 * person taps a link, the old screen is still on show with the bar under it, and they tap More.
 * The sheet opens on the old key, then the new location commits and the sheet shuts again, with no
 * tap from anybody.
 *
 * HOW THIS SPEC MAKES THE RACE CERTAIN, with no CPU throttling, the way
 * `add-sheet-outlives-a-pending-navigation.spec.ts` does. One page task clicks the diary's
 * "Previous day" link and then the More tab. The link starts a client navigation whose loader reads
 * IndexedDB, so it always commits AFTER the tab has opened the sheet.
 *
 * WHAT IT PROVES, and the control that makes each claim able to fail:
 *
 * - The sheet opened during a pending navigation is still open once that navigation has landed.
 *   A mutation observer records that the sheet did open inside the gap, so a sheet that never
 *   opened cannot pass for one that stayed. RED before the fix (e3216f0): the watcher saw the sheet
 *   open, and the `data-state` read on the dialog found it `closed`, then gone.
 * - A tile inside the sheet still closes it. The control for the claim above: the same dialog
 *   locator reads as gone after a tile is used, so "still open" is not a locator that sees an open
 *   dialog everywhere.
 * - Every other way out still closes it: the close key, a tap on the overlay, and Back. Escape,
 *   Forward and widening past `md` are `mark-opens-more.spec.ts`'s. The controls were run by hand:
 *   with the sheet's link and `popstate` closes taken out, the tile line and the Back line failed;
 *   with Radix's close ignored, the close key and overlay lines failed.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding } from './helpers';
import { settleAnimations, settleFrames } from './layout-shift';

/** The More sheet, found by the title it announces. */
function moreSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: EN.nav.more, exact: true });
}

/** The bar's More tab. */
function moreTab(page: Page): Locator {
  return page.locator('[data-slot="bottom-nav-more"]');
}

/** The day in the address, or `null` for today's bare `/diary`. */
function viewedDay(page: Page): string | null {
  return new URL(page.url()).searchParams.get('date');
}

test.describe('the More sheet and a navigation that is already under way', () => {
  test.beforeEach(async ({ page }) => {
    await completeOnboarding(page);
    await expect(moreTab(page)).toBeVisible();
  });

  test('a sheet opened while the diary is moving to another day stays open when the day lands', async ({
    page,
  }) => {
    const previousDay = page.getByRole('link', { name: EN.diary.nav.previousDay, exact: true });
    await expect(previousDay).toBeVisible();
    const hrefBefore = String(await previousDay.getAttribute('href'));
    const targetDay = new URL(hrefBefore, page.url()).searchParams.get('date');
    expect(targetDay, 'the previous-day link names a day').not.toBeNull();

    // ONE TASK: a watcher for the sheet, then the navigation starts, then More is tapped before
    // the navigation can commit.
    await page.evaluate(
      ({ label, sheetTitle }) => {
        const watcher = new MutationObserver(() => {
          const opened = [...document.querySelectorAll('[role="dialog"]')].some(
            (dialog) => dialog.textContent?.includes(sheetTitle) === true,
          );
          if (opened) document.documentElement.dataset.moreSheetOpened = 'true';
        });
        watcher.observe(document.body, { childList: true, subtree: true });
        const link = document.querySelector(`a[aria-label="${label}"]`);
        const tab = document.querySelector('[data-slot="bottom-nav-more"]');
        if (!(link instanceof HTMLElement) || !(tab instanceof HTMLElement)) {
          throw new Error('the previous-day link or the More tab is missing');
        }
        link.click();
        tab.click();
      },
      { label: EN.diary.nav.previousDay, sheetTitle: EN.nav.more },
    );

    // THE DAY HAS COMMITTED, read off the screen rather than the address: the address changes
    // before React renders the new day, and it is that render that dropped the sheet. Once the
    // diary shows the earlier day, its own previous-day link points one day further back. Found by
    // its attribute, not its role: the open sheet is modal, so the page behind it is hidden from
    // the accessibility tree.
    await expect.poll(() => viewedDay(page)).toBe(targetDay);
    await expect(page.locator(`a[aria-label="${EN.diary.nav.previousDay}"]`)).not.toHaveAttribute('href', hrefBefore);
    await settleFrames(page);

    // THE SHEET DID OPEN IN THE GAP, so the claim below is about staying open, not about opening.
    await expect(page.locator('html'), 'the More tab opened the sheet during the navigation').toHaveAttribute(
      'data-more-sheet-opened',
      'true',
    );

    // THE CLAIM, read after the commit and its render.
    await expect(moreSheet(page), 'the sheet the person opened is still open').toHaveAttribute('data-state', 'open');
    await expect(moreTab(page), 'the tab still says the sheet is open').toHaveAttribute('aria-expanded', 'true');

    // THE CONTROL. A tile inside the sheet closes it, so the locator above can read "gone".
    await moreSheet(page).getByRole('link', { name: EN.nav.trends, exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/trends');
    await expect(moreSheet(page), 'a tile closes the sheet').toHaveCount(0);
    await expect(moreTab(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('the close key closes the sheet', async ({ page }) => {
    await moreTab(page).tap();
    await expect(moreSheet(page)).toHaveAttribute('data-state', 'open');
    await moreSheet(page).getByRole('button', { name: EN.ui.sheet.close, exact: true }).tap();
    await expect(moreSheet(page), 'the close key closes the sheet').toHaveCount(0);
  });

  test('a tap on the overlay closes the sheet', async ({ page }) => {
    await moreTab(page).tap();
    await expect(moreSheet(page)).toHaveAttribute('data-state', 'open');
    await settleAnimations(page);
    // THE TOP OF THE SCREEN is overlay while the sheet is open: the sheet rests at the bottom.
    const sheetBox = await moreSheet(page).boundingBox();
    if (sheetBox === null) throw new Error('the open sheet has no box');
    expect(sheetBox.y, 'there is overlay above the sheet to tap').toBeGreaterThan(40);
    await page.touchscreen.tap(sheetBox.width / 2, 20);
    await expect(moreSheet(page), 'a tap on the overlay closes the sheet').toHaveCount(0);
  });

  test('Back closes the sheet', async ({ page }) => {
    // A PUSHED client navigation, so there is an entry to go Back from: one level deeper, because
    // this app replaces a sideways tap (`use-app-navigate.ts`).
    await page.goto('/settings');
    await page.locator('main a[href="/settings/ai"]').first().click();
    await page.waitForURL((url) => url.pathname === '/settings/ai');
    await expect(moreSheet(page)).toHaveCount(0);

    await moreTab(page).tap();
    await expect(moreSheet(page)).toHaveAttribute('data-state', 'open');

    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/settings');
    await settleFrames(page);
    await expect(moreSheet(page), 'Back closes the sheet').toHaveCount(0);
  });
});
