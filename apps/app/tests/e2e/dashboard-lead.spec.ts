/**
 * The Overview hero leads with the person's main goal (layout F, operator
 * decision 2026-10-11).
 *
 * THE LEAD is the first budget row drawn large: a figure, a unit, a caption, an
 * 8 px meter and a scale line. Every other row follows as a compact ledger. The
 * unit tier pins the wording (`day-hero-lead.test.ts`); this file proves what
 * only a browser shows:
 *
 * - The lead says what is LEFT on a day with a limit, follows a logged food,
 *   and leads with protein once protein is the main goal.
 * - THE LEAD BOX IS ONE SIZE: empty, logged, over, and with no target, in all
 *   six languages at 360 px. The caption sits inside the figure's own height.
 * - THE PHOTO BUTTON STAYS WHERE IT IS. It is at the same height on an empty
 *   day, on a day with one food, and on a day where the "Like yesterday" row
 *   has come and gone, because that row sits UNDER the composer.
 * - The first paint is final: a `layout-shift` total of 0 on an empty day and
 *   on a logged one.
 * - Copying yesterday moves nothing at or above the composer.
 *
 * THE LEAD IS FOUND BY ITS SLOT, `[data-slot="budget-lead"]`, and its figure
 * by `budget-lead-figure`. Words are wordsmith-owned copy and are never pinned
 * here; the numbers are not copy.
 *
 * EVERY CLAIM HAS A CONTROL. A reading that cannot see the thing it denies
 * passes against anything, so each block pairs its absence with a case where
 * the same reading sees the presence.
 *
 * @area diary-and-add
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { EN } from './copy';
import { NARROW_PHONE_WIDTH, completeOnboarding, logFoodManually, useLanguage } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

/** One day's 20 g of net carbs: 100 g of a food with 20 g per 100 g. */
const LOGGED_FOOD = { name: 'Lead tier porridge', grams: '100', carbs: '20' } as const;

/** Yesterday's two foods, so the "Like yesterday" row is offered until today holds two. */
const YESTERDAY_FOODS = [
  { name: 'Lead tier oats', grams: '100', carbs: '20' },
  { name: 'Lead tier stew', grams: '100', carbs: '20' },
] as const;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * One field of the profile on DISK, as JSON, or `null` when absent. Polled by
 * the callers: the store saves after the transaction.
 *
 * @param page - a page on the app's origin.
 * @param field - the `LocalProfileGoals` field to read.
 * @returns the stored value, JSON-encoded, or `null`.
 */
async function profileFieldOnDisk(page: Page, field: 'mainGoal' | 'goalNetCarbsCeilingG'): Promise<string | null> {
  return page.evaluate(
    (fieldName) =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const read = db.transaction('t', 'readonly').objectStore('t').get('profileGoals');
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: TinyBase's IndexedDB persister stores one record per table as `{ k, v }`, with `v`
            // keyed by row id; the profile's one row `me` carries its entity as JSON in `entity`.
            const record = read.result as { v?: Record<string, { entity?: string }> } | undefined;
            const entity = record?.v?.me?.entity;
            if (entity === undefined) {
              resolve(null);
              return;
            }
            // SAFETY: written only by the primary store's `writeEntity`, as `JSON.stringify` of a plain object.
            const profile = JSON.parse(entity) as { mainGoal?: string | null; goalNetCarbsCeilingG?: number | null };
            const value = profile[fieldName];
            resolve(value === undefined || value === null ? null : JSON.stringify(value));
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the profile table could not be read'));
          });
        });
      }),
    field,
  );
}

/**
 * Types the net-carb ceiling on the targets card and waits for the disk.
 *
 * @param page - a page past onboarding.
 * @param grams - the ceiling to type.
 */
async function saveCarbCeiling(page: Page, grams: string): Promise<void> {
  await page.goto('/settings/nutrition');
  await page.locator('input[name="goalNetCarbsCeilingG"]').fill(grams);
  await page.getByRole('button', { name: EN.goals.save, exact: true }).click();
  await expect.poll(() => profileFieldOnDisk(page, 'goalNetCarbsCeilingG')).toBe(grams);
}

/**
 * Picks a main goal on the settings card, saves it, and waits for the disk.
 *
 * @param page - a page past onboarding.
 * @param goal - the main goal id.
 */
async function saveMainGoal(page: Page, goal: string): Promise<void> {
  await page.goto('/settings/nutrition');
  await page.locator(`[data-slot="main-goal-options"] label:has(input[value="${goal}"])`).click();
  await page.getByRole('button', { name: EN.settings.mainGoal.save, exact: true }).click();
  await expect.poll(async () => JSON.parse((await profileFieldOnDisk(page, 'mainGoal')) ?? 'null')).toBe(goal);
}

/** The lead block, once the Overview has drawn it. */
async function openLead(page: Page): Promise<Locator> {
  await page.goto('/dashboard');
  const lead = page.locator('[data-slot="budget-lead"]');
  await expect(lead).toBeVisible();
  await settleAnimations(page);
  await settleFrames(page);
  return lead;
}

/** The figure the lead prints, as text with the unit stripped. */
async function figureOf(lead: Locator): Promise<string> {
  const text = (await lead.locator('[data-slot="budget-lead-figure"]').textContent()) ?? '';
  const figure = /^[~\d.,\s  ]+/u.exec(text)?.[0];
  if (figure === undefined) throw new Error(`the lead's figure "${text}" starts with no number`);
  return figure.replaceAll(/[\s  ]/gu, '');
}

/** The lead's height in CSS px. */
async function heightOf(lead: Locator): Promise<number> {
  const box = await lead.boundingBox();
  if (box === null) throw new Error('the lead has no box to measure');
  return Math.round(box.height * 10) / 10;
}

/** The plate photo button's top, in page coordinates. */
async function photoTop(page: Page): Promise<number> {
  const button = page.getByRole('button', { name: EN.launcher.platePhoto, exact: true });
  await expect(button).toBeVisible();
  return page.evaluate((name) => {
    const found = [...document.querySelectorAll('main button')].find(
      (candidate) => (candidate.textContent ?? '').trim() === name,
    );
    if (found === undefined) throw new Error('the photo button is not on the page');
    return Math.round((found.getBoundingClientRect().top + window.scrollY) * 10) / 10;
  }, EN.launcher.platePhoto);
}

test('the lead says what is left, follows a logged food, and shows the limit', async ({ page }) => {
  await completeOnboarding(page);

  // CONTROL FIRST: a device with no ceiling draws NO meter, a dashed stand-in,
  // so the meter asserted below is the ceiling and not a lead that always draws one.
  const noTarget = await openLead(page);
  await expect(noTarget).toHaveAttribute('data-metric', 'netCarbs');
  await expect(noTarget.locator('[data-slot="budget-track"]')).toHaveCount(0);
  await expect(noTarget.locator('[data-slot="budget-track-none"]')).toHaveCount(1);
  expect(await figureOf(noTarget), 'with no target the figure is the plain day total').toBe('0');
  const noTargetHeight = await heightOf(noTarget);

  await saveCarbCeiling(page, '100');
  const empty = await openLead(page);
  await expect(empty.locator('[data-slot="budget-track"]')).toHaveCount(1);
  await expect(empty.locator('[data-slot="budget-track-none"]')).toHaveCount(0);
  expect(await figureOf(empty), 'an empty day has the whole limit still to spend').toBe('100');
  const heights = [noTargetHeight, await heightOf(empty)];

  await logFoodManually(page, LOGGED_FOOD);
  const logged = await openLead(page);
  expect(await figureOf(logged), '20 g eaten of 100 g leaves 80 g').toBe('80');
  // Read now: a locator is live, and the next `openLead` reloads the page under it.
  const loggedTone = await logged.getAttribute('data-tone');
  heights.push(await heightOf(logged));

  // Over: the figure turns into the excess and the tone says so.
  await saveCarbCeiling(page, '15');
  const over = await openLead(page);
  expect(await figureOf(over), '20 g eaten against 15 g is 5 g over').toBe('5');
  await expect(over).toHaveAttribute('data-tone', 'over');
  heights.push(await heightOf(over));
  // ONE BOX: no target, an empty day, a logged day and an over day are the same height.
  expect(new Set(heights).size, `the lead changed height between states: ${heights.join(', ')}`).toBe(1);
  // CONTROL: the state before it was not over, so the attribute can be either.
  expect(loggedTone).toBe('default');
});

test('the lead leads with protein once protein is the main goal, and the rest follow as a ledger', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, LOGGED_FOOD);

  // CONTROL: by default the lead is net carbs, and net carbs is NOT in the ledger.
  const byDefault = await openLead(page);
  await expect(byDefault).toHaveAttribute('data-metric', 'netCarbs');
  await expect(page.locator('[data-slot="budget-ledger"] [data-metric="netCarbs"]')).toHaveCount(0);

  await saveMainGoal(page, 'protein');
  const lead = await openLead(page);
  await expect(lead).toHaveAttribute('data-metric', 'protein');
  // Protein always has a target, the reference intake, so its lead draws a meter.
  await expect(lead.locator('[data-slot="budget-track"]')).toHaveCount(1);
  // The ledger is one bordered block, and net carbs has moved into it.
  await expect(page.locator('[data-slot="budget-ledger"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="budget-ledger"] [data-metric="netCarbs"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="budget-ledger"] [data-metric="protein"]')).toHaveCount(0);
  // Eaten 0 g of protein: a floor with nothing eaten is not "reached".
  await expect(lead).toHaveAttribute('data-tone', 'default');
});

test('every ledger row is a compact line, not a card', async ({ page }) => {
  await completeOnboarding(page);
  await saveCarbCeiling(page, '100');
  await logFoodManually(page, LOGGED_FOOD);
  await openLead(page);

  const heights = await page
    .locator('[data-slot="budget-ledger"] [data-slot="budget-row"]')
    .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(heights.length, 'the ledger holds the rows after the lead').toBeGreaterThanOrEqual(2);
  for (const height of heights) {
    expect(height, `a ledger row is ${height} px`).toBeGreaterThanOrEqual(36);
    expect(height, `a ledger row is ${height} px`).toBeLessThanOrEqual(56);
  }
  // CONTROL: the list is the ledger, bordered, with no status dots (the meter carries the colour).
  await expect(page.locator('[data-slot="budget-ledger"]')).toHaveCSS('border-top-width', '1px');
  expect(await page.locator('[data-slot="budget-ledger"] .rounded-full').count()).toBe(0);
});

test('the photo button is at the same height on an empty day, a logged day and after Copy', async ({ page }) => {
  await completeOnboarding(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  for (const food of YESTERDAY_FOODS) {
    await logFoodManually(page, { ...food, date: yesterday });
  }
  const row = page.locator('[data-slot="repeat-yesterday-row"]');

  await openLead(page);
  await expect(row, 'an empty today with a fuller yesterday offers the row').toHaveCount(1);
  const emptyTop = await photoTop(page);

  await logFoodManually(page, LOGGED_FOOD);
  await openLead(page);
  await expect(row, 'one food of two: the row is still offered').toHaveCount(1);
  expect(await photoTop(page), 'the photo button moved when the first food was logged').toBe(emptyTop);

  await logFoodManually(page, { ...LOGGED_FOOD, name: 'Lead tier second' });
  await openLead(page);
  await expect(row, 'today holds as many as yesterday: no row').toHaveCount(0);
  expect(await photoTop(page), 'the photo button moved when the row went').toBe(emptyTop);

  // CONTROL: the reading CAN see a move. A 40 px box pushed in above the composer shifts it.
  await page.evaluate(() => {
    const strip = [...document.querySelectorAll('main button')].find((button) =>
      (button.textContent ?? '').includes('photo'),
    );
    const spacer = document.createElement('div');
    spacer.style.height = '40px';
    strip?.closest('div')?.before(spacer);
  });
  expect(await photoTop(page)).toBeGreaterThan(emptyTop);
});

test('the first paint of the Overview is final, on an empty day and on a logged one', async ({ page }) => {
  await installShiftObserver(page);
  await completeOnboarding(page);
  await saveCarbCeiling(page, '100');

  await openLead(page);
  const emptyEntries = await readShiftEntries(page);
  expect(shiftScoreAfter(emptyEntries, 0), `empty day: ${JSON.stringify(emptyEntries)}`).toBe(0);

  await logFoodManually(page, LOGGED_FOOD);
  // The first food earns an award note, which arrives AFTER the hero and pushes
  // the streak card below it down. That arrival is real and is not the hero's
  // (the note is its own late answer), so the page is opened once to take it
  // in, and the first paint is measured on the second open.
  await openLead(page);
  await openLead(page);
  const loggedEntries = await readShiftEntries(page);
  expect(shiftScoreAfter(loggedEntries, 0), `logged day: ${JSON.stringify(loggedEntries)}`).toBe(0);

  // CONTROL: the observer sees a shift when one is made. A block inserted at
  // the top of `main` pushes the lead down, and that must be recorded.
  const before = (await readShiftEntries(page)).length;
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '60px';
    document.querySelector('main')?.prepend(spacer);
  });
  await expect.poll(async () => shiftScoreAfter(await readShiftEntries(page), before)).toBeGreaterThan(0);
});

test('copying yesterday moves nothing at or above the composer', async ({ page }) => {
  await installShiftObserver(page);
  await completeOnboarding(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  for (const food of YESTERDAY_FOODS) {
    await logFoodManually(page, { ...food, date: yesterday });
  }
  await openLead(page);
  const row = page.locator('[data-slot="repeat-yesterday-row"]');
  await expect(row).toHaveCount(1);

  const composerTop = await photoTop(page);
  const before = await readTops(page);
  const entriesBefore = (await readShiftEntries(page)).length;
  await row.getByRole('button').click();
  await expect(row, 'the row goes once its entries are copied').toHaveCount(0);
  await settleAnimations(page);
  await settleFrames(page);
  const moved = movedBetween(before, await readTops(page));

  // The pantry door is BELOW the composer and takes the row's place, so it
  // moves up. That is the control: the reading sees a move when there is one.
  expect(moved.length, 'the row left and nothing below it moved, so the reading is blind').toBeGreaterThan(0);
  const aboveOrAt = moved.filter(({ element }) => (before[element] ?? Number.POSITIVE_INFINITY) <= composerTop);
  expect(aboveOrAt, `the copy moved ${JSON.stringify(aboveOrAt)}`).toEqual([]);
  expect(await photoTop(page)).toBe(composerTop);
  // The browser's own entries, scoped to the hero. The award note a first food
  // earns arrives below the composer and pushes the streak card, which is not
  // this claim. The lead's figure may gain a digit, which moves its caption
  // sideways in the same line, so only VERTICAL motion of a hero node counts.
  const heroSource = /budget-|verdict-slot|repeat-yesterday|Plate photo|surface-brand/u;
  const heroMoves = (await readShiftEntries(page))
    .slice(entriesBefore)
    .flatMap((entry) => entry.sources)
    .filter((source) => heroSource.test(source))
    .filter((source) => !/dy 0 px/u.test(source));
  expect(heroMoves, 'a hero node moved up or down').toEqual([]);
});

for (const locale of SUPPORTED_LANGUAGES) {
  test(`the lead is one size on an empty day, a logged day and over, at 360 px (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: 844 });
    await completeOnboarding(page);
    await saveCarbCeiling(page, '100');
    const heights: Record<string, number> = {};

    await useLanguage(page, locale);
    heights.empty = await heightOf(await openLead(page));

    await useLanguage(page, 'en');
    await logFoodManually(page, LOGGED_FOOD);
    await useLanguage(page, locale);
    heights.logged = await heightOf(await openLead(page));

    await useLanguage(page, 'en');
    await saveCarbCeiling(page, '15');
    const englishCaption = await (await openLead(page)).locator('[data-slot="budget-lead-caption"]').textContent();
    await useLanguage(page, locale);
    const over = await openLead(page);
    heights.over = await heightOf(over);

    expect(heights, `the lead changed size between states in ${locale}`).toEqual({
      empty: heights.empty,
      logged: heights.empty,
      over: heights.empty,
    });
    // The caption wraps INSIDE the figure's own height: it never makes the row taller.
    const rows = await over.evaluate((element) => {
      const figure = element.querySelector('[data-slot="budget-lead-figure"]')?.getBoundingClientRect();
      const caption = element.querySelector('[data-slot="budget-lead-caption"]')?.getBoundingClientRect();
      return {
        figure: figure?.height ?? 0,
        caption: caption?.height ?? 0,
        scroll: element.scrollWidth,
        client: element.clientWidth,
      };
    });
    expect(rows.caption, `the ${locale} caption is taller than the figure`).toBeLessThanOrEqual(rows.figure + 1);
    expect(rows.scroll, `the ${locale} lead scrolls sideways`).toBeLessThanOrEqual(rows.client);
    // CONTROL: the language really changed, so the three readings are not three English ones.
    const words = ((await over.locator('[data-slot="budget-lead-caption"]').textContent()) ?? '').trim();
    expect(words.length).toBeGreaterThan(0);
    if (locale !== 'en') expect(words).not.toBe((englishCaption ?? '').trim());
  });
}
