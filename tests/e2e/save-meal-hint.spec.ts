/**
 * "Save this as a meal?", offered on the third identical day (M227/03).
 *
 * THE CONTROL IS THE OTHER MEAL GROUP ON THE SAME SCREEN. Dinner is logged
 * identically on TWO days, breakfast on THREE, and both groups are read in the
 * same breath. Without that, "the hint is on breakfast" would pass just as
 * happily against a hint pinned to every group in the app, which is the
 * vacuous assertion this repository's CLAUDE.md names.
 *
 * THE DISMISSAL IS PROVEN ACROSS A RELOAD, not across a re-render. The claim
 * is that it persists, and a component that merely hid the hint in local state
 * would satisfy every check short of loading the page again.
 */
import { expect, test } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, expectPhoneLayout, logFoodManually } from './helpers';

/** Names no food database would return, so a match can only be these entries. */
const BREAKFAST_NAME = 'Hint tier porridge';
const DINNER_NAME = 'Hint tier stew';

/** The same portion every day: one gram of difference would break the run on purpose. */
const PORTION_GRAMS = '100';
const PORTION_CARBS = '20';

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

test('the diary offers to save a breakfast eaten three days running, once', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  const twoDaysAgo = shiftDay(today, -2);

  // THREE identical breakfasts, and only TWO identical dinners.
  for (const day of [twoDaysAgo, yesterday, undefined]) {
    await logFoodManually(page, {
      name: BREAKFAST_NAME,
      grams: PORTION_GRAMS,
      carbs: PORTION_CARBS,
      mealType: 'breakfast',
      date: day,
    });
  }
  for (const day of [yesterday, undefined]) {
    await logFoodManually(page, {
      name: DINNER_NAME,
      grams: PORTION_GRAMS,
      carbs: PORTION_CARBS,
      mealType: 'dinner',
      date: day,
    });
  }

  await page.goto('/diary');

  const breakfastGroup = page.locator('[data-slot="meal-group"][data-meal="breakfast"]');
  const dinnerGroup = page.locator('[data-slot="meal-group"][data-meal="dinner"]');
  const breakfastHint = breakfastGroup.locator('[data-slot="save-meal-hint"]');
  const dinnerHint = dinnerGroup.locator('[data-slot="save-meal-hint"]');

  ////////////////////////////////////////////////////////////////////////////
  // The claim, and its control one group down the page
  ////////////////////////////////////////////////////////////////////////////

  await expect(breakfastHint).toBeVisible();
  await expect(breakfastHint.getByText(EN.diary.saveMeal.hint.title, { exact: true })).toBeVisible();
  const box = await breakfastHint.boundingBox();
  expect(box, 'the hint must have a box to measure').not.toBeNull();
  expect(box?.height ?? 0, 'the hint must draw something taller than nothing').toBeGreaterThan(0);

  // THE CONTROL: dinner is two days old, not three, and its group is on the
  // same screen, rendered by the same component.
  await expect(dinnerGroup, 'the control group must be on the screen').toBeVisible();
  await expect(dinnerHint, 'two identical days must not be offered a hint').toHaveCount(0);

  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // Dismissed once, gone after a reload
  ////////////////////////////////////////////////////////////////////////////

  await breakfastHint.getByRole('button', { name: EN.diary.saveMeal.hint.dismiss, exact: true }).click();
  await expect(breakfastHint).toHaveCount(0);

  await page.reload();
  await expect(breakfastGroup, 'the diary must still be showing the breakfast group').toBeVisible();
  await expect(breakfastHint, 'a dismissed hint must not come back on reload').toHaveCount(0);

  // The door the hint pointed at is still there, so the dismissal hid the
  // nudge and not the feature.
  await expect(breakfastGroup.getByLabel(EN.diary.saveMeal.trigger, { exact: true })).toBeVisible();
  await expectPhoneLayout(page);
});
