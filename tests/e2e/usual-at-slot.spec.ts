/**
 * "Your usual <slot>", offered at the slot's time (M227/01).
 *
 * WHY THE CLOCK AND NOT A SCREENSHOT. The claim is that WHAT IS OFFERED
 * changes with the time of day. Proving it needs the page to believe it is a
 * different hour, which is Playwright's clock, and it needs the absence half
 * asserted as a DOM count rather than as a picture, because "the porridge is
 * not there" and "the section failed to render" look identical in a
 * screenshot.
 *
 * THE CONTROL IS A SECOND HABIT, not a second screenshot. The fixture logs a
 * breakfast food AND a dinner food on the same two past days, so at 19:00 the
 * section is still on the screen, still offering something, and simply
 * offering the other thing. Without that, an absence assertion would pass just
 * as happily against a section that had stopped rendering altogether, which is
 * the vacuous check this repo's CLAUDE.md names.
 *
 * WHY THE FIXTURE IS BACK-DATED. The ranking counts DISTINCT DAYS, so one
 * entry is a coincidence and two days are a habit. Both foods are logged on
 * the two days before today, through the real `/add` manual form with its real
 * meal picker.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, expectPhoneLayout, logFoodManually } from './helpers';

/** Names no food database would return, so a match can only be these entries. */
const BREAKFAST_NAME = 'Smoke tier porridge';
const DINNER_NAME = 'Smoke tier stew';

/** 100 g with a typed carb figure, so the entry is a complete, computable log. */
const PORTION_GRAMS = '100';
const PORTION_CARBS = '20';

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Freezes the page's clock at a wall-clock hour on a local day.
 *
 * The instant is computed INSIDE the page: a bare `YYYY-MM-DDTHH:mm:ss` with
 * no zone parses as local time, and the page's local zone is the only one this
 * app's meal windows are read in. Computing it in node would silently use the
 * runner's zone instead.
 */
async function freezeAt(page: Page, day: string, hhmm: string): Promise<void> {
  const atMs = await page.evaluate(
    ([localDay, time]) => new Date(`${localDay}T${time}:00`).getTime(),
    [day, hhmm] as const,
  );
  await page.clock.setFixedTime(atMs);
}

/** The names offered by the section, in rank order, or `[]` when it renders nothing. */
async function offeredNames(page: Page): Promise<string[]> {
  const section = page.locator('[data-slot="usual-at-slot"]');
  if ((await section.count()) === 0) return [];
  return section.locator('[data-slot="usual-offer"] button').allInnerTexts();
}

test('the usual is offered at the slot it is eaten at, and not at the others', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  const twoDaysAgo = shiftDay(today, -2);

  // One breakfast habit and one dinner habit, each on TWO separate days.
  for (const day of [twoDaysAgo, yesterday]) {
    await logFoodManually(page, {
      name: BREAKFAST_NAME,
      grams: PORTION_GRAMS,
      carbs: PORTION_CARBS,
      mealType: 'breakfast',
      date: day,
    });
    await logFoodManually(page, {
      name: DINNER_NAME,
      grams: PORTION_GRAMS,
      carbs: PORTION_CARBS,
      mealType: 'dinner',
      date: day,
    });
  }

  ////////////////////////////////////////////////////////////////////////////
  // 08:00: the section is breakfast's
  ////////////////////////////////////////////////////////////////////////////

  await freezeAt(page, today, '08:00');
  await page.goto('/add');

  const section = page.locator('[data-slot="usual-at-slot"]');
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-meal', 'breakfast');
  await expect(section.getByRole('heading', { name: EN.usual.title.breakfast, exact: true })).toBeVisible();

  const atBreakfast = await offeredNames(page);
  expect(atBreakfast.join(' | ')).toContain(BREAKFAST_NAME);
  expect(atBreakfast.join(' | '), 'the dinner habit must not be offered at breakfast').not.toContain(DINNER_NAME);

  ////////////////////////////////////////////////////////////////////////////
  // One tap files it into TODAY's breakfast
  ////////////////////////////////////////////////////////////////////////////

  await section.locator('[data-slot="usual-offer"] button').filter({ hasText: BREAKFAST_NAME }).click();
  await page.waitForURL('**/diary**');

  // The MEAL GROUP, not merely the page: an entry that landed under "no meal"
  // would still put the name somewhere in `main`, so the assertion is scoped
  // to the group the section promised.
  const breakfastGroup = page.locator('[data-slot="meal-group"][data-meal="breakfast"]');
  await expect(breakfastGroup).toBeVisible();
  await expect(breakfastGroup.getByText(BREAKFAST_NAME).first()).toBeVisible();

  // CONTROL for that assertion: the same food is NOT in the dinner group, so
  // the locator above is reading the slot and not the whole day.
  const dinnerGroup = page.locator('[data-slot="meal-group"][data-meal="dinner"]');
  if ((await dinnerGroup.count()) > 0) {
    await expect(dinnerGroup.getByText(BREAKFAST_NAME)).toHaveCount(0);
  }

  ////////////////////////////////////////////////////////////////////////////
  // 19:00: the same screen, the other slot
  ////////////////////////////////////////////////////////////////////////////

  await freezeAt(page, today, '19:00');
  await page.goto('/add');

  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-meal', 'dinner');
  await expect(section.getByRole('heading', { name: EN.usual.title.dinner, exact: true })).toBeVisible();

  const atDinner = await offeredNames(page);
  // THE CLAIM. The breakfast food was eaten on three days now, more than the
  // dinner food, and it is still not offered here.
  expect(atDinner.join(' | '), 'a breakfast-only food must not be offered at dinner').not.toContain(BREAKFAST_NAME);
  // THE CONTROL. The section is alive and offering, so the line above is about
  // the slot and not about a section that stopped rendering.
  expect(atDinner.join(' | ')).toContain(DINNER_NAME);

  await expectPhoneLayout(page);
});
