/**
 * One meal slot across days, on the real chart.
 *
 * WHY GEOMETRY AND NOT A SCREENSHOT. The claim this spec defends is
 * arithmetic drawn as a picture: with the snack filter on, a day's bar has to
 * be the SNACK's net carbs, not the day's. A screenshot of a shorter bar
 * cannot tell "the dinner was dropped" from "the axis rescaled", so every
 * assertion here is a `getBoundingClientRect` height in CSS pixels, read off
 * the bar element for a named day.
 *
 * THE FIXTURE IS BUILT SO THE AXIS CANNOT MOVE. `buildTrendChart` picks its
 * vertical top from the tallest value it is given, so a naive two-day fixture
 * would let the snack view rescale and hand back a snack bar that is TALLER
 * than the all-meals one. The three days below are chosen so the tallest
 * value is 40 g in both views, which pins one shared axis:
 *
 *   two days ago   snack 20 g                     all 20 g   snack 20 g
 *   yesterday      snack 40 g                     all 40 g   snack 40 g   <- the control
 *   today          snack 30 g + dinner 10 g       all 40 g   snack 30 g   <- the claim
 *
 * Yesterday is the CONTROL: its bar must measure the SAME in both views. If
 * the filter ever collapsed to "draw everything a bit shorter", today's
 * assertion would still pass and yesterday's would not.
 *
 * WHY THREE DAYS AND NOT TWO. Under `MIN_TREND_DAYS` logged days the chart is
 * replaced outright by the sparse notice, so a two-day fixture has no bars to
 * measure at all.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, expectPhoneLayout, logFoodManually } from './helpers';

/** Names no food database would return, so a match can only be these entries. */
const SNACK_NAME = 'Smoke tier snack';
const DINNER_NAME = 'Smoke tier dinner';

/** 100 g, so the per-100 g carbs typed in are also the entry's net carbs. */
const PORTION_GRAMS = '100';

/** The rendered plot is 176 CSS px tall (`h-44`), so a few px of rounding is noise and 20 is not. */
const CLEAR_DIFFERENCE_PX = 20;

/** How close two heights must be to count as the same bar. */
const SAME_HEIGHT_TOLERANCE_PX = 1.5;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The height in CSS pixels of the bar drawn for `date`, and the state it was drawn in. */
async function readBar(page: Page, date: string): Promise<{ height: number; fill: string }> {
  const bar = page.locator(`[data-slot="trend-bar"][data-date="${date}"]`);
  await expect(bar).toBeAttached();
  return bar.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    fill: element.getAttribute('data-fill') ?? '',
  }));
}

test('the snack filter charts the snack alone, day by day', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  const twoDaysAgo = shiftDay(today, -2);

  await logFoodManually(page, {
    name: SNACK_NAME,
    grams: PORTION_GRAMS,
    carbs: '20',
    mealType: 'snack',
    date: twoDaysAgo,
  });
  await logFoodManually(page, {
    name: SNACK_NAME,
    grams: PORTION_GRAMS,
    carbs: '40',
    mealType: 'snack',
    date: yesterday,
  });
  await logFoodManually(page, { name: SNACK_NAME, grams: PORTION_GRAMS, carbs: '30', mealType: 'snack' });
  await logFoodManually(page, { name: DINNER_NAME, grams: PORTION_GRAMS, carbs: '10', mealType: 'dinner' });

  // M239/02: the chart moved to the Nutrition tab, so the slot controls this
  // spec is about are no longer on the plain `/trends` URL.
  await page.goto('/trends?tab=nutrition');
  const controls = page.locator('[data-slot="trend-slot-controls"]');
  await expect(controls).toBeVisible();

  const allMeals = {
    today: await readBar(page, today),
    yesterday: await readBar(page, yesterday),
    twoDaysAgo: await readBar(page, twoDaysAgo),
  };

  await controls.getByRole('link', { name: EN.add.meal.snack, exact: true }).click();
  await expect(controls.getByRole('link', { name: EN.add.meal.snack, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );

  const snackOnly = {
    today: await readBar(page, today),
    yesterday: await readBar(page, yesterday),
    twoDaysAgo: await readBar(page, twoDaysAgo),
  };

  // Every day has a real snack bar. `empty` is the "nothing logged" hairline,
  // which HAS a height, so the state is checked as well as the number.
  for (const [label, bar] of Object.entries(snackOnly)) {
    expect(bar.fill, `${label} must be drawn as a bar, not as an empty slot`).not.toBe('empty');
    expect(bar.height, `${label} must have a snack bar taller than nothing`).toBeGreaterThan(0);
  }

  // THE CLAIM: today's dinner is gone from today's bar.
  expect(snackOnly.today.height).toBeLessThan(allMeals.today.height - CLEAR_DIFFERENCE_PX);

  // THE CONTROL: yesterday was snack only, so its bar cannot have moved. This
  // is what separates "the dinner was dropped" from "the axis rescaled".
  expect(Math.abs(snackOnly.yesterday.height - allMeals.yesterday.height)).toBeLessThanOrEqual(
    SAME_HEIGHT_TOLERANCE_PX,
  );
  expect(Math.abs(snackOnly.twoDaysAgo.height - allMeals.twoDaysAgo.height)).toBeLessThanOrEqual(
    SAME_HEIGHT_TOLERANCE_PX,
  );

  // The goal line is NOT asserted here. This device has no goal set, so the
  // line is absent in both views and a `toHaveCount(0)` could never go red,
  // which is worse than no check. `buildTrendChart`'s unit tests carry that
  // claim instead, with the whole-day control that makes it fail.

  // Back to all meals, and today's bar is whole again.
  await controls.getByRole('link', { name: EN.trends.slot.all, exact: true }).click();
  await expect.poll(async () => (await readBar(page, today)).height).toBeGreaterThan(snackOnly.today.height);

  await expectPhoneLayout(page);
});
