/**
 * A food that was logged does not come back as an open portion step when the way out was
 * overtaken.
 *
 * THE DEFECT (found 2026-09-27, chasing a timeout in `add-method-switcher.spec.ts`). On
 * `/add/search`, "Add to diary" writes the entry, clears the search draft and redirects to the
 * diary. A person who taps the method switcher's Search (or the bar's plus and its search door)
 * before that redirect lands sends the router to `/add/search` again, and the router drops the
 * redirect. The screen is the same route, so React never unmounts it, and the food it had open
 * stayed open in component state: the portion step of a food already in the diary, one tap away
 * from logging it a second time. With the CPU slowed six times, "logging the opened food clears
 * the search draft" met this in 5 of 20 runs once the add sheet race was fixed.
 *
 * HOW THIS SPEC MAKES IT CERTAIN, with no CPU throttling: one page task clicks "Add to diary"
 * and then the switcher's Search link. The log's write is asynchronous, so the second navigation
 * always starts while the first is still in its action.
 *
 * WHAT IT PROVES, and the control that makes it able to fail:
 *
 * - After the overtaken log, the screen is the search step, with no grams field, and the diary
 *   holds the entry: the log did land, so there is nothing left to finish on that step. RED
 *   before the fix: the search box was absent and the portion step was still up.
 * - THE CONTROL: the same one-task tap on Search with no log keeps the portion step. A draft
 *   survives a switch (M255/01), so the grams reader must find the field there; a reader that
 *   never saw the field would pass the claim above for nothing.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, logFoodManually } from './helpers';

/** A food nobody else's walk logs, so a match can only be this one. */
const FOOD = 'Overtaken log rye bread';

/** The portion typed before the log, different from the food's default so it is recognisable. */
const PORTION_GRAMS = '150';

/** Opens the food's portion step from the search and types the portion. */
async function openPortionStep(page: Page): Promise<void> {
  await page.goto(`/add/search?q=${encodeURIComponent(FOOD)}`);
  await page.locator('[data-slot="search-result-row"]').filter({ hasText: FOOD }).first().click();
  await page.locator('input[name="quantityGrams"]').fill(PORTION_GRAMS);
}

/**
 * Clicks the switcher's Search link, after "Add to diary" when `alsoLog` is set, in ONE task.
 *
 * @param page - a page on the portion step.
 * @param alsoLog - whether "Add to diary" is clicked first.
 */
async function tapSearchInOneTask(page: Page, { alsoLog }: { alsoLog: boolean }): Promise<void> {
  await page.evaluate(
    ({ submitLabel, searchLabel, shouldLog }) => {
      const submit = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === submitLabel);
      const search = document.querySelector('[data-method="search"]');
      if (!(submit instanceof HTMLElement) || !(search instanceof HTMLElement)) {
        throw new Error(`the portion step's submit or the switcher's ${searchLabel} is missing`);
      }
      if (shouldLog) submit.click();
      search.click();
    },
    { submitLabel: EN.add.portion.submit, searchLabel: EN.add.methods.search, shouldLog: alsoLog },
  );
}

/** How many times the food's name appears in the diary's `main`, entries and quick-add chip alike. */
async function foodMentionsInDiary(page: Page): Promise<number> {
  await page.locator('[data-slot="bottom-nav-shell"] nav').getByRole('link', { name: EN.nav.diary, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/diary');
  await expect(page.locator('main').getByText(FOOD).first()).toBeVisible();
  return page.locator('main').getByText(FOOD).count();
}

test.describe('the search screen after a log whose redirect was overtaken', () => {
  test.beforeEach(async ({ page }) => {
    await completeOnboarding(page);
    await logFoodManually(page, { name: FOOD, grams: '100', carbs: '40' });
  });

  test('shows the search step, not the portion step of the food just logged', async ({ page }) => {
    const mentionsBefore = await foodMentionsInDiary(page);
    await openPortionStep(page);

    await tapSearchInOneTask(page, { alsoLog: true });

    await expect(page.locator('#food-search'), 'the search step is on screen').toBeVisible();
    await expect(page.locator('input[name="quantityGrams"]'), 'no portion step is left open').toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/add/search');

    // The log landed, so clearing the step lost nothing.
    expect(await foodMentionsInDiary(page), 'the diary holds the new entry').toBeGreaterThan(mentionsBefore);
  });

  test('control: the same tap with no log keeps the portion step and its grams', async ({ page }) => {
    await openPortionStep(page);

    await tapSearchInOneTask(page, { alsoLog: false });

    await expect(page.locator('input[name="quantityGrams"]'), 'the draft kept the portion step').toHaveValue(
      PORTION_GRAMS,
    );
    await expect(page.locator('#food-search')).toHaveCount(0);
  });
});
