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

import { EN, fill } from './copy';
import { completeOnboarding, expectPhoneLayout, headerStatusText, logFoodManually } from './helpers';

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
  const atMs = await page.evaluate(([localDay, time]) => new Date(`${localDay}T${time}:00`).getTime(), [
    day,
    hhmm,
  ] as const);
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
  await page.goto('/add/search');

  const section = page.locator('[data-slot="usual-at-slot"]');
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-meal', 'breakfast');
  await expect(section.getByRole('heading', { name: EN.usual.title.breakfast, exact: true })).toBeVisible();

  const atBreakfast = await offeredNames(page);
  expect(atBreakfast.join(' | ')).toContain(BREAKFAST_NAME);
  expect(atBreakfast.join(' | '), 'the dinner habit must not be offered at breakfast').not.toContain(DINNER_NAME);

  ////////////////////////////////////////////////////////////////////////////
  // A tap opens a confirm dialog; accepting the default portion (100%,
  // today's exact recorded amount) files it into TODAY's breakfast.
  ////////////////////////////////////////////////////////////////////////////

  await section.locator('[data-slot="usual-offer"] button').filter({ hasText: BREAKFAST_NAME }).click();

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByRole('heading', { name: BREAKFAST_NAME, exact: true })).toBeVisible();
  await confirmDialog.getByRole('button', { name: EN.usual.confirm.add, exact: true }).click();

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
  await page.goto('/add/search');

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

/**
 * The two halves of `/add/search` must not be drawn in the same material.
 *
 * WHAT THIS IS ABOUT. The screen offers "your usual breakfast" as a row of
 * chips, and under it the foods you logged recently as a list of rows. Those
 * are two different invitations: one says "start here", the other says
 * "everything else". They used to share a surface exactly, `border-border
 * bg-card` on both, and the recent rows were three lines tall while the chips
 * were one, so the thing a person reaches for every morning was the lighter
 * object on the page.
 *
 * WHAT GOES RED WITHOUT THE FIX. All three reads below: the two backgrounds
 * resolved to the same rgb, the chip drew a hairline, and the row's text column
 * held three blocks instead of two.
 *
 * WHY COMPUTED COLOUR AND NOT A CLASS NAME. `bg-card` and `bg-accent` are both
 * tokens and both change with the theme; what a person sees is the resolved
 * value, and that is what a class-name check cannot read.
 */
test('the usual shelf is drawn heavier than the recently logged list', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));

  // TWICE, on two past days: two days make it a habit (so it is offered as a
  // usual), and more than one log makes the recent row print its own count.
  for (const day of [shiftDay(today, -2), shiftDay(today, -1)]) {
    await logFoodManually(page, {
      name: BREAKFAST_NAME,
      grams: PORTION_GRAMS,
      carbs: PORTION_CARBS,
      mealType: 'breakfast',
      date: day,
    });
  }

  await freezeAt(page, today, '08:00');
  await page.goto('/add/search');

  const pill = page.locator('[data-slot="usual-at-slot"] [data-slot="usual-offer"] button').first();
  const row = page.locator('[data-slot="search-result-row"]').first();
  await expect(pill, 'the habit must be offered').toBeVisible();
  await expect(row, 'the same food must also be in the recent list').toBeVisible();

  const surfaces = await pill.evaluate((chip, rowSelector) => {
    const listRow = document.querySelector(rowSelector);
    if (listRow === null) throw new Error('no search result row to compare against');
    const chipStyle = getComputedStyle(chip);
    const rowStyle = getComputedStyle(listRow);
    return {
      chip: {
        background: chipStyle.backgroundColor,
        borderWidth: Number.parseFloat(chipStyle.borderTopWidth),
        borderStyle: chipStyle.borderTopStyle,
      },
      row: {
        background: rowStyle.backgroundColor,
        borderWidth: Number.parseFloat(rowStyle.borderTopWidth),
        borderStyle: rowStyle.borderTopStyle,
      },
    };
  }, '[data-slot="search-result-row"]');

  // NON-VACUITY: a reader that came back with two empty strings would satisfy
  // an inequality and say nothing.
  expect(surfaces.chip.background, 'the chip must resolve a real fill').toMatch(/^rgb/u);
  expect(surfaces.row.background, 'the row must resolve a real fill').toMatch(/^rgb/u);
  expect(surfaces.chip.background, 'the shelf and the list must not share a surface').not.toBe(surfaces.row.background);
  // The chip is a solid block, the row is a hairline box. Two ways of being a
  // surface, so the eye ranks them without reading either.
  expect(surfaces.chip.borderWidth === 0 || surfaces.chip.borderStyle === 'none').toBe(true);
  expect(surfaces.row.borderWidth, 'the list row keeps its hairline').toBeGreaterThan(0);

  // THE ROW IS TWO BLOCKS. The per-100g footnote moved into the facts line, so
  // a name over a facts line is the whole row; it used to be a third line.
  const facts = row.locator('[data-slot="search-result-facts"]');
  await expect(facts).toHaveCount(1);
  expect(
    await facts.evaluate((element) => element.parentElement?.childElementCount ?? -1),
    'a result row is a name and a facts line, nothing else',
  ).toBe(2);

  // HOW OFTEN, READABLE. The food was logged on two days, so the count is
  // printed, and it is a filled chip rather than the quietest grey on the row.
  const count = row.locator('[data-slot="logged-count"]');
  await expect(count, 'a food logged more than once says so').toHaveCount(1);
  expect(
    await count.evaluate((element) => getComputedStyle(element).backgroundColor),
    'the count chip must be filled, not bare text',
  ).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/u);

  await expectPhoneLayout(page);
});

test('the confirm dialog scales the portion before logging it', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  const twoDaysAgo = shiftDay(today, -2);

  // The habit, on two past days, so it is offered today. Both past logs stay
  // at PORTION_GRAMS, so 100 g is the "unscaled" figure the control below
  // checks is GONE from today's entry.
  for (const day of [twoDaysAgo, yesterday]) {
    await logFoodManually(page, {
      name: BREAKFAST_NAME,
      grams: PORTION_GRAMS,
      carbs: PORTION_CARBS,
      mealType: 'breakfast',
      date: day,
    });
  }

  await freezeAt(page, today, '08:00');
  await page.goto('/add');

  const section = page.locator('[data-slot="usual-at-slot"]');
  await expect(section).toBeVisible();
  await section.locator('[data-slot="usual-offer"] button').filter({ hasText: BREAKFAST_NAME }).click();

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();

  // Two "+" taps along the fixed steps (50/75/100/125/150/200) move the
  // default 100% to 150%, one and a half times the recorded portion.
  const increase = confirmDialog.getByRole('button', { name: EN.usual.confirm.increase });
  await increase.click();
  await increase.click();
  await expect(confirmDialog.locator('output')).toHaveText('150%');

  await confirmDialog.getByRole('button', { name: EN.usual.confirm.add, exact: true }).click();
  await page.waitForURL('**/diary**');

  // THE CLAIM. Today's entry weighs 150 g, 1.5 times the 100 g every past log
  // of this habit was recorded at.
  const scaledGrams = Number(PORTION_GRAMS) * 1.5;
  const entryLink = page.locator('a').filter({ hasText: BREAKFAST_NAME });
  await expect(entryLink).toHaveCount(1);
  await expect(entryLink.locator('[data-slot="entry-facts"]')).toContainText(`${scaledGrams} g`);
  // THE CONTROL. The recorded, unscaled figure is NOT what got logged: a
  // stepper that silently no-opped would leave this exact text on the page.
  await expect(entryLink.locator('[data-slot="entry-facts"]')).not.toContainText(`${PORTION_GRAMS} g`);

  // The same confirmation toast the direct tap always published, unchanged.
  await expect.poll(() => headerStatusText(page)).toBe(fill(EN.usual.toast.logged_one, { name: BREAKFAST_NAME }));
});
