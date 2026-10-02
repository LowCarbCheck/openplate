/**
 * The add sheet stays open when the person opened it after a navigation had already started.
 *
 * THE DEFECT (found 2026-09-27, chasing a timeout in `add-method-switcher.spec.ts`). The bar's
 * plus opens the add sheet, and the sheet closed itself in an effect keyed on the location. That
 * effect runs when React COMMITS a location, not when the navigation starts. On a slow phone the
 * two are far apart: the person taps "Add to diary", the address changes, the old screen is still
 * on show with the bar under it, and they tap the plus. The sheet opens, then the diary commits
 * and the effect shuts it again, with no tap from anybody. With the CPU slowed six times,
 * `add-method-switcher.spec.ts` "logging the opened food clears the search draft" lost its sheet
 * this way in 19 of 20 runs and timed out waiting for the search door.
 *
 * HOW THIS SPEC MAKES THE RACE CERTAIN, with no CPU throttling. One page task clicks the diary's
 * "Previous day" link and then the plus. The link starts a client navigation whose loader reads
 * IndexedDB, so it always commits AFTER the plus has opened the sheet: the order a slow phone
 * produces by chance, produced every time.
 *
 * WHAT IT PROVES, and the control that makes each claim able to fail:
 *
 * - The sheet opened during a pending navigation is still open once that navigation has landed,
 *   and its search door carries the day that landed. RED before the fix: the sheet was gone
 *   (`toBeVisible` on the dialog failed).
 * - A door inside the sheet still closes it. The control for the claim above: the same dialog
 *   locator reads as gone after a door is used, so "still open" is not a locator that sees an
 *   open dialog everywhere.
 * - Back closes it. The page the sheet was opened on is gone, so the sheet goes with it.
 *
 * @area diary-and-add
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding } from './helpers';
import { settleFrames } from './layout-shift';

/** The add sheet, by its title, which is its accessible name. */
function addSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: EN.launcher.sheetTitle });
}

/** The bar's raised plus. */
function plus(page: Page): Locator {
  return page.locator('[data-slot="bottom-nav-add"]');
}

/** The day in the address, or `null` for today's bare `/diary`. */
function viewedDay(page: Page): string | null {
  return new URL(page.url()).searchParams.get('date');
}

test.describe('the add sheet and a navigation that is already under way', () => {
  test.beforeEach(async ({ page }) => {
    await completeOnboarding(page);
    await expect(plus(page)).toBeVisible();
  });

  test('a sheet opened while the diary is moving to another day stays open when the day lands', async ({
    page,
  }) => {
    const previousDay = page.getByRole('link', { name: EN.diary.nav.previousDay, exact: true });
    await expect(previousDay).toBeVisible();
    const hrefBefore = String(await previousDay.getAttribute('href'));
    const targetDay = new URL(hrefBefore, page.url()).searchParams.get('date');
    expect(targetDay, 'the previous-day link names a day').not.toBeNull();

    // ONE TASK: the navigation starts, then the plus is tapped before it can commit.
    await page.evaluate((label) => {
      const link = document.querySelector(`a[aria-label="${label}"]`)
        ?? [...document.querySelectorAll('a')].find((anchor) => anchor.textContent?.trim() === label);
      const button = document.querySelector('[data-slot="bottom-nav-add"]');
      if (!(link instanceof HTMLElement) || !(button instanceof HTMLElement)) {
        throw new Error('the previous-day link or the plus is missing');
      }
      link.click();
      button.click();
    }, EN.diary.nav.previousDay);

    // THE DAY HAS COMMITTED, read off the screen rather than the address: the address changes
    // before React renders the new day, and it is the render that ran the old closing effect.
    // Once the diary shows the earlier day, its own previous-day link points one day further back.
    // Found by its attribute, not its role: the open sheet is modal, so the page behind it is
    // hidden from the accessibility tree.
    await expect.poll(() => viewedDay(page)).toBe(targetDay);
    await expect(page.locator(`a[aria-label="${EN.diary.nav.previousDay}"]`)).not.toHaveAttribute('href', hrefBefore);
    await settleFrames(page);

    // THE CLAIM, read after the commit and its effects.
    await expect(addSheet(page), 'the sheet the person opened is still open').toHaveAttribute('data-state', 'open');
    const searchDoor = addSheet(page).getByRole('link', { name: EN.launcher.searchFoods, exact: true });
    await expect(searchDoor, 'the sheet follows the day that landed').toHaveAttribute(
      'href',
      new RegExp(`date=${targetDay}`),
    );

    // THE CONTROL. A door inside the sheet closes it, so the locator above can read "gone".
    await searchDoor.click();
    await page.waitForURL((url) => url.pathname === '/add/search');
    await expect(addSheet(page), 'a door closes the sheet').toHaveCount(0);
  });

  test('Back closes the sheet', async ({ page }) => {
    // A PUSHED client navigation, so there is an entry to go Back from: the sheet's search door.
    await plus(page).click();
    await addSheet(page).getByRole('link', { name: EN.launcher.searchFoods, exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/add/search');
    await expect(addSheet(page)).toHaveCount(0);

    await plus(page).click();
    await expect(addSheet(page)).toHaveAttribute('data-state', 'open');

    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/diary');
    await settleFrames(page);
    await expect(addSheet(page), 'Back closes the sheet').toHaveCount(0);
  });
});
