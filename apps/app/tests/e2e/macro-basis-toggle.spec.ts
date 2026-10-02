/**
 * The macro share is by CALORIES unless the person switches it to grams
 * (operator request, 2026-10-01). The diary's "What you ate" block carries a
 * small kcal/g control on its title row, and this spec walks it at the phone
 * width on a day with one logged food whose macros are known:
 *
 *  1. the default reads the calorie share: three cells in view, the fibre cell
 *     kept as an invisible box, and the visible percents equal to the ones the
 *     bar reads out;
 *  2. a tap on "g" moves the cells and the bar to the gram share, computed here
 *     from the same macros, and MOVES NOTHING ELSE: the browser's own
 *     `layout-shift` total is 0 and the top of every link and button in `main`
 *     is where it was (DESIGN.md section 7);
 *  3. the choice is kept: a reload shows grams;
 *  4. a tap on "kcal" is the default again, and so is a device with nothing
 *     stored.
 *
 * ONE TEST PER LOCALE, because the German words are the long ones ("Kohlen-
 * hydrate", "Ballaststoffe") and a cell that wraps differently between the two
 * modes is exactly the shift this checks for.
 *
 * THE CONTROLS are inside the walk: the gram percents must DIFFER from the
 * calorie ones (or the "they changed" claim would pass against a control that
 * did nothing), and the shift reading is taken with scroll anchoring off, so a
 * shift cannot be absorbed by the browser scrolling the page back.
 *
 * @area diary-and-add
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { completeOnboarding, useLanguage } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  turnOffScrollAnchoring,
  type ShiftEntry,
} from './layout-shift';

/** Where the preference lives; the key is the contract with `app/lib/macro-share-basis.ts`. */
const STORAGE_KEY = 'openplate:macro-share-basis';

/** The tap floor for a thumb, in CSS px. */
const TAP_FLOOR_PX = 44;

/** The one logged food, in grams of each macro. Carbs are TOTAL carbs, fibre sits inside them and also has its own share by grams. */
const FOOD = { carbs: 20, fiber: 5, protein: 30, fat: 15 };

/** The calorie share of {@link FOOD}, in the order the cells are drawn (carbs, protein, fat): 4, 4 and 9 kcal per gram. */
function expectedKcalPercents(): number[] {
  const energy = [FOOD.carbs * 4, FOOD.protein * 4, FOOD.fat * 9];
  const total = energy.reduce((sum, kcal) => sum + kcal, 0);
  return energy.map((kcal) => Math.round((kcal / total) * 100));
}

/** The gram share of {@link FOOD}, in the order the cells are drawn (carbs, fibre, protein, fat). */
function expectedGramPercents(): number[] {
  const grams = [FOOD.carbs, FOOD.fiber, FOOD.protein, FOOD.fat];
  const total = grams.reduce((sum, value) => sum + value, 0);
  return grams.map((value) => Math.round((value / total) * 100));
}

/** Writes today's single food into the primary store and resolves once the transaction committed. */
async function logTheFood(page: Page): Promise<void> {
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await page.evaluate(
    ({ dayKey, food }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const id = 'basis-seed-0';
          const loggedAt = Date.parse(`${dayKey}T12:00:00Z`);
          const entity = {
            id,
            name: 'Macro basis test food',
            quantityGrams: 100,
            macros: {
              carbs: food.carbs,
              fiber: food.fiber,
              sugars: null,
              polyols: 0,
              protein: food.protein,
              fat: food.fat,
              kcal: food.carbs * 4 + food.protein * 4 + food.fat * 9,
            },
            mealType: 'lunch',
            source: 'manual',
            aiEstimated: false,
            curatedSource: null,
            foodId: null,
            dayKey,
            loggedAt,
            createdAt: loggedAt,
            logBatchId: null,
          };
          const transaction = db.transaction('t', 'readwrite');
          transaction.objectStore('t').put({ k: 'foodLogs', v: { [id]: { entity: JSON.stringify(entity) } } });
          transaction.addEventListener('complete', () => {
            db.close();
            resolve();
          });
          transaction.addEventListener('error', () => {
            db.close();
            reject(new Error('the food log could not be written'));
          });
        });
      }),
    { dayKey: today, food: FOOD },
  );
}

/**
 * The summed score of the shifts after the first `since`, LEAVING OUT the ones
 * whose every source is a bar segment.
 *
 * The segments ARE the data the switch changes: the calorie share and the gram
 * share are different widths, so the browser records a score of about 0.0005
 * for the segments' own edges moving, which is the picture being redrawn and
 * not the page being pushed. Anything else that moves in the same entry, or in
 * an entry of its own, still counts in full. The control at the end of the walk
 * proves a real push is not filtered out.
 */
function shiftScoreBesideTheBar(entries: readonly ShiftEntry[], since: number): number {
  return entries
    .slice(since)
    .filter(
      (entry) =>
        entry.sources.length === 0 || !entry.sources.every((source) => source.startsWith('div[macro-ratio-segment]')),
    )
    .reduce((sum, entry) => sum + entry.value, 0);
}

/** The percents the visible macro cells print, in draw order. */
async function visibleCellPercents(page: Page): Promise<number[]> {
  const texts = await page.locator('[data-slot="macro-share"]:visible').allTextContents();
  return texts.map((text) => Number(/(\d+)/u.exec(text)?.[1]));
}

/** The percents the bar reads out to a screen reader, in segment order. */
async function barPercents(page: Page): Promise<number[]> {
  const text = (await page.locator('[data-slot="macro-ratio-bar"] .sr-only').textContent()) ?? '';
  return Array.from(text.matchAll(/(\d+)\s?%/gu), (match) => Number(match[1]));
}

/** The toggle's box: both buttons, so a size change in either one shows. */
async function toggleBoxes(page: Page): Promise<{ width: number; height: number }[]> {
  return page.locator('[data-slot="macro-basis-toggle"] button').evaluateAll((buttons) =>
    buttons.map((button) => ({
      width: Math.round(button.getBoundingClientRect().width),
      height: Math.round(button.getBoundingClientRect().height),
    })),
  );
}

/** Whether the person's choice is stored as `value`, or not stored at all when `null`. */
function storedChoice(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

/** The day's card has drawn, so the macro block can be read. */
async function waitForTheDay(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="meal-group"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="macro-ratio-bar"]')).toBeVisible();
}

/** The toggle's button for a basis, found by the id the component gives it, which no language changes. */
function optionOf(page: Page, option: 'kcal' | 'grams'): Locator {
  return page.locator(`#what-you-ate-basis-${option}`);
}

for (const locale of ['en', 'de'] as const satisfies readonly LanguageCode[]) {
  test(`the macro share reads by calories, switches to grams without moving anything, and is kept (${locale})`, async ({
    page,
  }) => {
    await installShiftObserver(page);
    await turnOffScrollAnchoring(page);
    await completeOnboarding(page);
    await logTheFood(page);
    await useLanguage(page, locale);
    await page.goto('/diary');
    await waitForTheDay(page);

    //////////////////////////////////////////////////////////////////////////
    // 1. THE DEFAULT IS CALORIES. Nothing was stored, and three cells are in
    // view with fibre held as an invisible box.
    //////////////////////////////////////////////////////////////////////////
    expect(await storedChoice(page), 'a device that never tapped the control stores nothing').toBeNull();
    await expect(optionOf(page, 'kcal')).toHaveAttribute('aria-pressed', 'true');
    await expect(optionOf(page, 'grams')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-slot="macro-ratio-bar"]')).toHaveAttribute('data-basis', 'kcal');
    await expect(page.locator('[data-slot="macro-ratio-segment"]')).toHaveCount(3);
    await expect(page.locator('[data-slot="macro-share-cell"]')).toHaveCount(4);
    await expect(page.locator('[data-slot="macro-share-cell"][data-macro="fiber"]')).toBeHidden();

    const kcalPercents = expectedKcalPercents();
    expect(await visibleCellPercents(page), 'the cells state the calorie share of the logged food').toEqual(
      kcalPercents,
    );
    expect(await barPercents(page), 'the bar reads out the same shares').toEqual(kcalPercents);

    // The control sits on the title row at the phone floor, and both options are one size.
    const kcalBoxes = await toggleBoxes(page);
    expect(kcalBoxes).toHaveLength(2);
    for (const box of kcalBoxes) {
      expect(box.height, 'the toggle reaches the touch floor').toBeGreaterThanOrEqual(TAP_FLOOR_PX);
      expect(box.width, 'the toggle reaches the touch floor').toBeGreaterThanOrEqual(TAP_FLOOR_PX);
    }
    expect(kcalBoxes[0]?.width, 'both options are drawn at one width').toBe(kcalBoxes[1]?.width);

    //////////////////////////////////////////////////////////////////////////
    // 2. A TAP ON "g". The baseline is taken with the target in view, so the
    // tap itself scrolls nothing.
    //////////////////////////////////////////////////////////////////////////
    await optionOf(page, 'grams').scrollIntoViewIfNeeded();
    await settleAnimations(page);
    const topsBefore = await readTops(page);
    const insightsLink = page.locator('[data-slot="day-summary-insights-link"]');
    const linkTopBefore = await insightsLink.evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY,
    );
    const shiftsBefore = (await readShiftEntries(page)).length;

    await optionOf(page, 'grams').click();
    await expect(optionOf(page, 'grams')).toHaveAttribute('aria-pressed', 'true');
    await settleAnimations(page);

    const gramPercents = expectedGramPercents();
    expect(gramPercents, 'CONTROL: the gram share differs from the calorie share, so a dead control fails').not.toEqual(
      kcalPercents,
    );
    await expect(page.locator('[data-slot="macro-ratio-bar"]')).toHaveAttribute('data-basis', 'grams');
    await expect(page.locator('[data-slot="macro-ratio-segment"]')).toHaveCount(4);
    await expect(page.locator('[data-slot="macro-share"]:visible')).toHaveCount(4);
    expect(await visibleCellPercents(page), 'the cells now state the gram share').toEqual(gramPercents);
    expect(await barPercents(page), 'the bar reads out the gram share').toEqual(gramPercents);
    expect(await storedChoice(page)).toBe('grams');

    // NOTHING MOVED. The score is the browser's own; the tops are ours, and they
    // name the element when one moves.
    const shiftEntries = await readShiftEntries(page);
    const shiftDetail = shiftEntries
      .slice(shiftsBefore)
      .map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`)
      .join('\n');
    expect(
      shiftScoreBesideTheBar(shiftEntries, shiftsBefore),
      `${locale}: the switch shifted layout:\n${shiftDetail}`,
    ).toBe(0);
    expect(movedBetween(topsBefore, await readTops(page)), `${locale}: something moved when "g" was tapped`).toEqual(
      [],
    );
    const linkTopAfter = await insightsLink.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    expect(linkTopAfter, `${locale}: the block below the macro cells stayed put`).toBe(linkTopBefore);
    expect(await toggleBoxes(page), 'the control keeps its size when its choice changes').toEqual(kcalBoxes);

    //////////////////////////////////////////////////////////////////////////
    // 3. THE CHOICE IS KEPT. A reload draws grams.
    //////////////////////////////////////////////////////////////////////////
    await page.reload();
    await waitForTheDay(page);
    await expect(optionOf(page, 'grams')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-slot="macro-ratio-bar"]')).toHaveAttribute('data-basis', 'grams');
    expect(await visibleCellPercents(page), 'grams survived the reload').toEqual(gramPercents);

    //////////////////////////////////////////////////////////////////////////
    // 4. "kcal" IS THE DEFAULT AGAIN, and so is a device with nothing stored.
    //////////////////////////////////////////////////////////////////////////
    await optionOf(page, 'kcal').click();
    await expect(optionOf(page, 'kcal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-slot="macro-ratio-bar"]')).toHaveAttribute('data-basis', 'kcal');
    expect(await visibleCellPercents(page), 'the cells are back on the calorie share').toEqual(kcalPercents);
    expect(await barPercents(page)).toEqual(kcalPercents);

    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
    await waitForTheDay(page);
    await expect(optionOf(page, 'kcal')).toHaveAttribute('aria-pressed', 'true');
    expect(await visibleCellPercents(page), 'nothing stored reads by calories').toEqual(kcalPercents);

    //////////////////////////////////////////////////////////////////////////
    // THE RED CONTROL for the shift reading. Push the block down by 40 px, the
    // way a line that appeared late would, and the same reader must report it.
    // Without this the zero in step 2 could be a reader that sees nothing.
    //////////////////////////////////////////////////////////////////////////
    await settleAnimations(page);
    const shiftsBeforePush = (await readShiftEntries(page)).length;
    await page.locator('[data-slot="macro-breakdown"]').evaluate((element) => {
      const spacer = document.createElement('div');
      spacer.style.height = '40px';
      element.before(spacer);
    });
    await settleFrames(page);
    expect(
      shiftScoreBesideTheBar(await readShiftEntries(page), shiftsBeforePush),
      'the shift reader must report a block pushed down by 40 px',
    ).toBeGreaterThan(0);
  });
}
