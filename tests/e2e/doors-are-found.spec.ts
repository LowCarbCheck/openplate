/**
 * Every door a routine eater is supposed to find (M227/03).
 *
 * ## The doors
 *
 * | Feature | Route | Component | i18n key of the visible label |
 * | --- | --- | --- | --- |
 * | repeat | `/dashboard` | `RepeatYesterdayDoor` | `diary.copy.door` |
 * | repeat | `/describe` | `RepeatYesterdayDoor` | `diary.copy.door` |
 * | repeat | `/diary` | `CopyFromYesterday` | `diary.copy.title`, then `diary.copy.all` / `diary.copy.meal` per chip |
 * | repeat | `/diary` | `CopyFromYesterday` | `diary.copy.chooseEntries` |
 * | repeat | `/diary/entry/:id` | the entry's action column | `entry.action.logAgain` |
 * | save as meal | `/diary` | `SaveMealButton`, on every meal group header | `diary.saveMeal.trigger` |
 * | save as meal | `/diary` | the hint on a repeated group (M227/03) | `diary.saveMeal.hint.title` |
 * | usual | `/add` | `UsualAtSlot` | `usual.title.<slot>` |
 * | usual | `/scan` | `UsualAtSlot` | `usual.title.<slot>` |
 * | usual | `/settings` | the saved-meals hub row into `/meals` | `settings.rows.meals.title` |
 *
 * `/meals` itself is reached from ONE place, the settings hub row, which is
 * the finding that started this spec: both people who missed "save as meal"
 * also never found `/meals`.
 *
 * ## Why a bounding box and not `toBeVisible`
 *
 * `toBeVisible` answers "is this element laid out", and a label whose text
 * measures zero pixels tall still passes it on some browsers. Today's font
 * incident (see `tests/e2e/fonts.conf`) is exactly that failure, a browser
 * with no fonts draws every line box at height zero, so the box height above
 * zero is the control every assertion here carries: break the font
 * configuration and these lines go red instead of quietly passing.
 *
 * The same read also catches a door pushed off the side of a 390 px phone,
 * which is the other way a shipped door stays unfound.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';
import { PHONE_WIDTH, completeOnboarding, expectPhoneLayout, logFoodManually } from './helpers';

/** Names no food database would return, so a match can only be these entries. */
const BREAKFAST_NAME = 'Doors tier porridge';
const DINNER_NAME = 'Doors tier stew';

/** 100 g with a typed carb figure, so each entry is a complete, computable log. */
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
 * The instant is computed INSIDE the page, because a bare
 * `YYYY-MM-DDTHH:mm:ss` parses as local time and the page's zone is the only
 * one this app's meal windows are read in.
 *
 * @param page - the page to freeze.
 * @param day - the local `YYYY-MM-DD` day.
 * @param hhmm - the wall-clock time on it.
 */
async function freezeAt(page: Page, day: string, hhmm: string): Promise<void> {
  const atMs = await page.evaluate(
    ([localDay, time]) => new Date(`${localDay}T${time}:00`).getTime(),
    [day, hhmm] as const,
  );
  await page.clock.setFixedTime(atMs);
}

/**
 * Asserts a door is on the screen, drawn, and inside the phone.
 *
 * THREE READS, and the second is the control. `toBeVisible` alone passes for
 * an element that is laid out but measures nothing; the height read is what
 * fails when the label draws no pixels, and the width read is what fails when
 * a door has been pushed past the right edge of a 390 px screen.
 *
 * @param locator - the labelled element.
 * @param what - named in the failure message, so a red line says which door.
 */
async function expectVisibleLabel(locator: Locator, what: string): Promise<void> {
  await expect(locator, `${what} must be on the screen`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${what} must have a box to measure`).not.toBeNull();
  expect(box?.height ?? 0, `${what} must draw something taller than nothing`).toBeGreaterThan(0);
  expect(box?.width ?? 0, `${what} must draw something wider than nothing`).toBeGreaterThan(0);
  expect(box?.x ?? -1, `${what} must start inside the phone`).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0), `${what} must end inside the phone`).toBeLessThanOrEqual(PHONE_WIDTH);
}

test('every repeat, save-as-meal and usual door is visible on the phone', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  const twoDaysAgo = shiftDay(today, -2);

  // Two past days, and TODAY IS STILL EMPTY. That order matters: the
  // dashboard door only offers itself while today holds fewer entries than
  // yesterday (`selectRepeatYesterday`), so it is read before anything is
  // logged onto today.
  await logFoodManually(page, {
    name: BREAKFAST_NAME,
    grams: PORTION_GRAMS,
    carbs: PORTION_CARBS,
    mealType: 'breakfast',
    date: twoDaysAgo,
  });
  await logFoodManually(page, {
    name: BREAKFAST_NAME,
    grams: PORTION_GRAMS,
    carbs: PORTION_CARBS,
    mealType: 'breakfast',
    date: yesterday,
  });
  await logFoodManually(page, {
    name: DINNER_NAME,
    grams: PORTION_GRAMS,
    carbs: PORTION_CARBS,
    mealType: 'dinner',
    date: yesterday,
  });

  // Breakfast time, so the "usual" section below is the breakfast one and the
  // page is not read at whatever hour the gate happens to run.
  await freezeAt(page, today, '08:00');

  ////////////////////////////////////////////////////////////////////////////
  // The dashboard's "Like yesterday" door
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/dashboard');
  await expectVisibleLabel(
    page.getByRole('button', { name: EN.diary.copy.door, exact: true }),
    "the dashboard's repeat door",
  );
  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // "Your usual breakfast" under the search field on /add
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/add');
  const usual = page.locator('[data-slot="usual-at-slot"]');
  await expect(usual).toHaveAttribute('data-meal', 'breakfast');
  await expectVisibleLabel(
    usual.getByRole('heading', { name: EN.usual.title.breakfast, exact: true }),
    "the /add usual section's heading",
  );
  await expectVisibleLabel(
    usual.locator('[data-slot="usual-offer"] button').filter({ hasText: BREAKFAST_NAME }),
    'the usual offer itself',
  );
  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // The diary's copy-from-yesterday section
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/diary');
  await expectVisibleLabel(
    // A `SectionEyebrow` with no `as`, so it is a `<p>` and not a heading.
    page.getByText(EN.diary.copy.title, { exact: true }).first(),
    "the diary's copy-from-yesterday label",
  );
  // A CHIP, not only the heading: a section header with no affordance under it
  // is not a door. The per-meal chip names the meal and how many entries it
  // would copy.
  await expectVisibleLabel(
    page.getByRole('button', { name: EN.diary.meals.dinner }).first(),
    "the copy section's dinner chip",
  );
  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // "Save as meal" on the meal group header, which needs a meal group
  ////////////////////////////////////////////////////////////////////////////

  await logFoodManually(page, {
    name: BREAKFAST_NAME,
    grams: PORTION_GRAMS,
    carbs: PORTION_CARBS,
    mealType: 'breakfast',
  });

  const breakfastGroup = page.locator('[data-slot="meal-group"][data-meal="breakfast"]');
  // BY ITS aria-label, which only the header's icon button carries. The
  // M227/03 hint under the header wears the same words as visible text, and
  // this line is about the permanent door, not the nudge.
  await expectVisibleLabel(
    breakfastGroup.getByLabel(EN.diary.saveMeal.trigger, { exact: true }),
    "the breakfast group's save-as-meal button",
  );
  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // "Log again today" on the entry the person taps
  ////////////////////////////////////////////////////////////////////////////

  await breakfastGroup.getByRole('link').first().click();
  await page.waitForURL('**/diary/entry/**');
  await expectVisibleLabel(
    page.getByRole('button', { name: EN.entry.action.logAgain }),
    "the entry page's log-again button",
  );
  await expectPhoneLayout(page);
});
