/**
 * The tab strip atop `/trends` (M239/02): four review sections that live in
 * the URL, and the page's new name in the menu.
 *
 * THE CONTROL IS THE CHART. The claim under test is that Goals and the chart
 * are DIFFERENT tabs: the goal grid must be missing while on Meals, and the
 * chart's bars must be gone once the goals tab replaces it. A check that only
 * ever looked at the goals tab could not tell "the grid moved here" from "the
 * grid was always here too", the before/after pair is what makes it mean
 * something.
 *
 * THREE LOGGED SNACK DAYS, not one. Under `MIN_TREND_DAYS` (3) the chart
 * itself is replaced by the sparse notice, so a chart with only one logged
 * day would already show no bars on the Meals tab, and the "gone after
 * switching to Goals" assertion would prove nothing.
 */
import { expect, test } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, logFoodManually } from './helpers';

/** A name no food database would return, so the diary entry can only be this one. */
const SNACK_NAME = 'Smoke tier insights snack';

/** 100 g, so the per-100 g carbs typed in are also the entry's net carbs. */
const PORTION_GRAMS = '100';

/** The chart window this walk opens on, and the value the URL must keep across a tab switch. */
const RANGE_DAYS = 30;

/** The meal slot this walk opens on, and the value the URL must keep across a tab switch. */
const SLOT = 'snack';

/** The narrow end of the phone budget this strip is written against. */
const NARROW_PHONE_WIDTH = 360;

/** A generous height so the resize below is about width, not a second budget. */
const NARROW_PHONE_HEIGHT = 844;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

test('switching tabs keeps range and slot in the URL, and the drawer names the page Insights', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  for (const daysAgo of [0, 1, 2]) {
    await logFoodManually(page, {
      name: SNACK_NAME,
      grams: PORTION_GRAMS,
      carbs: '20',
      mealType: 'snack',
      date: daysAgo === 0 ? undefined : shiftDay(today, -daysAgo),
    });
  }

  await page.goto(`/trends?tab=meals&range=${RANGE_DAYS}&slot=${SLOT}`);

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL, on the Meals tab: the chart is drawn, the goal grid is not.
  //
  // `.toBeAttached()`, not `.toBeVisible()`: an SVG `<line>` bar's bounding
  // box is one CSS pixel wide (it is a vertical stroke, not a filled box), and
  // Chromium's actionability check reads that as "hidden" even though the bar
  // is drawn and on screen, the same reason the existing chart specs never
  // call `.toBeVisible()` on this element either.
  ////////////////////////////////////////////////////////////////////////////

  await expect(page.locator('[data-slot="trend-bar"]:not([data-fill="empty"])').first()).toBeAttached();
  await expect(page.getByText(EN.trends.grid.titleActivity)).toHaveCount(0);

  const tabStrip = page.locator('[data-slot="insights-tab-strip"]');
  await tabStrip.getByRole('tab', { name: EN.trends.tabs.goals, exact: true }).click();

  ////////////////////////////////////////////////////////////////////////////
  // THE CLAIM: the URL keeps range and slot, the goal grid replaces the chart.
  ////////////////////////////////////////////////////////////////////////////

  await expect(page).toHaveURL(new RegExp(`tab=goals`));
  await expect(page).toHaveURL(new RegExp(`range=${RANGE_DAYS}`));
  await expect(page).toHaveURL(new RegExp(`slot=${SLOT}`));

  await expect(page.getByText(EN.trends.grid.titleActivity)).toBeVisible();
  await expect(page.locator('[data-slot="trend-bar"]')).toHaveCount(0);

  await expect(tabStrip.getByRole('tab', { name: EN.trends.tabs.goals, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  ////////////////////////////////////////////////////////////////////////////
  // The strip fits a narrow phone: no sideways scroll at 360 px.
  ////////////////////////////////////////////////////////////////////////////

  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: NARROW_PHONE_HEIGHT });
  await expect
    .poll(() => tabStrip.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);

  ////////////////////////////////////////////////////////////////////////////
  // The drawer, the mobile menu this viewport shows, names the page Insights.
  ////////////////////////////////////////////////////////////////////////////

  await page.getByRole('button', { name: EN.chrome.logoMenuLabel }).click();
  await expect(page.getByRole('link', { name: EN.nav.trends, exact: true })).toBeVisible();
});
