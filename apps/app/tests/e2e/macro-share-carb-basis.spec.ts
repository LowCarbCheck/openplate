/**
 * The calorie share of a day that mixes the two carb conventions (operator
 * report, 2026-10-13, "Was du gegessen hast" showed 7 % carbs for a day whose
 * net carbs and fibre alone made 35.6 g of carbs).
 *
 * THE BUG. A food from the EU panel (`carbBasis: 'available'`, the BLS and
 * curated LowCarbCheck foods) prints carbs WITHOUT fibre. A food from the US
 * panel, an AI estimate or an old entry (`'total'` or no basis at all) prints
 * carbs WITH fibre. The day's carb figure was the plain sum of both, and the
 * ratio bar read that sum as total carbs, so every fibre gram of an EU food
 * dropped out of the carb share.
 *
 * THE DAY. Two logged foods, with figures chosen so that the old arithmetic
 * and the right one give different whole percents:
 *
 *   EU food   available  carbs  6.0  fibre  8.6  protein 40.0  fat 80.0
 *   US food   total      carbs 21.0  fibre 19.4  protein 34.0  fat 46.5
 *
 *   net carbs    6.0 + (21.0 - 19.4)  =  7.6 g
 *   fibre        8.6 + 19.4           = 28.0 g
 *   total carbs  (6.0 + 8.6) + 21.0   = 35.6 g   (the old sum read 27.0 g)
 *
 * The calorie share counts net carbs at 4 kcal per gram and fibre at 2 (EU
 * Regulation 1169/2011, Annex XIV): 4 x 7.6 + 2 x 28 = 86.4 kcal of carbs
 * against 296 kcal of protein and 1138.5 kcal of fat, so 6 / 19 / 75 percent.
 * The old arithmetic read 7 / 19 / 74.
 *
 * WHAT IS CLAIMED.
 *
 *  1. The diary's "What you ate" block, on calories, says 6 / 19 / 75, and
 *     the bar reads out the same three numbers.
 *  2. On grams the carb cell is the TOTAL carbs (35.6 g of 264.1 g, 13 %), not
 *     the old sum.
 *  3. The Insights energy split for the same day says the same percents as the
 *     diary does, in its row for that day and in the range average.
 *
 * THE CONTROLS. The figures the old arithmetic gives are computed in the spec
 * and must differ from the right ones, otherwise this walk would pass against
 * the unfixed build too. The Insights half has its own control: the same food
 * logged as `'total'` only, which the old arithmetic got right, must give the
 * calorie share of 4 x (carbs - fibre) + 2 x fibre as well.
 *
 * @area diary-and-add
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding } from './helpers';

/** One seeded food: the per-serving macros and the panel convention its carbs were read from. */
interface SeedFood {
  name: string;
  carbBasis: 'available' | 'total';
  carbs: number;
  fiber: number;
  protein: number;
  fat: number;
}

/** The two foods of the day described above, in grams. */
const EU_FOOD: SeedFood = { name: 'EU panel food', carbBasis: 'available', carbs: 6, fiber: 8.6, protein: 40, fat: 80 };
const US_FOOD: SeedFood = { name: 'US panel food', carbBasis: 'total', carbs: 21, fiber: 19.4, protein: 34, fat: 46.5 };

/** The shares a day gets, in the order the cells are drawn (carbs, protein, fat), as whole percents. */
type Shares = [number, number, number];

/** Whole percents of three energy amounts. */
function percentsOf(energy: [number, number, number]): Shares {
  const total = energy[0] + energy[1] + energy[2];
  return [
    Math.round((energy[0] / total) * 100),
    Math.round((energy[1] / total) * 100),
    Math.round((energy[2] / total) * 100),
  ];
}

/** The sums of a seeded day, in grams, beside the old sum of the printed carb figures. */
interface DaySums {
  netCarbs: number;
  fiber: number;
  totalCarbs: number;
  printedCarbs: number;
  protein: number;
  fat: number;
}

/** The day's sums, with every carb figure brought onto one basis. */
function sumsOf(foods: readonly SeedFood[]): DaySums {
  const sum = (pick: (food: SeedFood) => number): number => foods.reduce((acc, food) => acc + pick(food), 0);
  return {
    netCarbs: sum((food) => (food.carbBasis === 'available' ? food.carbs : food.carbs - food.fiber)),
    fiber: sum((food) => food.fiber),
    totalCarbs: sum((food) => (food.carbBasis === 'available' ? food.carbs + food.fiber : food.carbs)),
    printedCarbs: sum((food) => food.carbs),
    protein: sum((food) => food.protein),
    fat: sum((food) => food.fat),
  };
}

/** The calorie share the fixed rule gives: 4 kcal per net carb gram, 2 per fibre gram, 4 per protein gram, 9 per fat gram. */
function rightShares(foods: readonly SeedFood[]): Shares {
  const day = sumsOf(foods);
  return percentsOf([4 * day.netCarbs + 2 * day.fiber, 4 * day.protein, 9 * day.fat]);
}

/** The calorie share the unfixed build drew: the printed carb figures summed as they came, at 4 kcal per gram. */
function oldShares(foods: readonly SeedFood[]): Shares {
  const day = sumsOf(foods);
  return percentsOf([4 * day.printedCarbs, 4 * day.protein, 9 * day.fat]);
}

/** The gram share of the carb cell: total carbs over total carbs, fibre, protein and fat. */
function rightCarbGramPercent(foods: readonly SeedFood[]): number {
  const day = sumsOf(foods);
  return Math.round((day.totalCarbs / (day.totalCarbs + day.fiber + day.protein + day.fat)) * 100);
}

/** The carb cell's gram share the unfixed build drew. */
function oldCarbGramPercent(foods: readonly SeedFood[]): number {
  const day = sumsOf(foods);
  return Math.round((day.printedCarbs / (day.printedCarbs + day.fiber + day.protein + day.fat)) * 100);
}

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Writes the foods onto each of the days into the primary store and resolves
 * once the transaction has committed. Every food carries its reported calories
 * as the app itself would derive them, so no entry is left without a figure.
 */
async function logFoodsOnDays(
  page: Page,
  input: { days: readonly string[]; foods: readonly SeedFood[] },
): Promise<void> {
  await page.evaluate(
    ({ days, foods }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells: Record<string, { entity: string }> = {};
          for (const dayKey of days) {
            foods.forEach((food, index) => {
              const id = `carb-basis-${dayKey}-${index}`;
              const loggedAt = Date.parse(`${dayKey}T12:00:00Z`) + index * 60_000;
              const netCarbs = food.carbBasis === 'available' ? food.carbs : food.carbs - food.fiber;
              cells[id] = {
                entity: JSON.stringify({
                  id,
                  name: food.name,
                  quantityGrams: 100,
                  macros: {
                    carbs: food.carbs,
                    fiber: food.fiber,
                    sugars: null,
                    polyols: 0,
                    protein: food.protein,
                    fat: food.fat,
                    kcal: 4 * netCarbs + 2 * food.fiber + 4 * food.protein + 9 * food.fat,
                  },
                  carbBasis: food.carbBasis,
                  mealType: 'lunch',
                  source: 'manual',
                  aiEstimated: false,
                  curatedSource: null,
                  foodId: null,
                  dayKey,
                  loggedAt,
                  createdAt: loggedAt,
                  logBatchId: null,
                }),
              };
            });
          }
          const transaction = db.transaction('t', 'readwrite');
          transaction.objectStore('t').put({ k: 'foodLogs', v: cells });
          transaction.addEventListener('complete', () => {
            db.close();
            resolve();
          });
          transaction.addEventListener('error', () => {
            db.close();
            reject(new Error('the food logs could not be written'));
          });
        });
      }),
    input,
  );
}

/** The percents the diary's visible macro cells print, in draw order. */
async function visibleCellPercents(page: Page): Promise<number[]> {
  const texts = await page.locator('[data-slot="macro-share"]:visible').allTextContents();
  return texts.map((text) => Number(/(\d+)/u.exec(text)?.[1]));
}

/** The percents the bar reads out to a screen reader, in segment order. */
async function barPercents(page: Page): Promise<number[]> {
  const text = (await page.locator('[data-slot="macro-ratio-bar"] .sr-only').textContent()) ?? '';
  return Array.from(text.matchAll(/(\d+)\s?%/gu), (match) => Number(match[1]));
}

/** The percents in a piece of text, in reading order. */
function percentsIn(text: string | null): number[] {
  return Array.from((text ?? '').matchAll(/(\d+)\s?%/gu), (match) => Number(match[1]));
}

/** The energy split row of `date` on Insights, as the percents its sentence reads out (carbs, protein, fat). */
async function splitRowPercents(page: Page, date: string): Promise<number[]> {
  const row = page.locator(`[data-slot="macro-split-row"][data-date="${date}"] .sr-only`);
  await expect(row).toBeAttached();
  return percentsIn(await row.textContent());
}

/** The range average of the Insights energy split, as the percents it prints (carbs, protein, fat). */
async function splitAveragePercents(page: Page): Promise<number[]> {
  const average = page.locator('[data-slot="macro-split-average"] p').last();
  await expect(average).toBeVisible();
  return percentsIn(await average.textContent());
}

test('a day of an EU-panel food and a US-panel food gets one calorie share in the diary and on Insights', async ({
  page,
}) => {
  const mixed = [EU_FOOD, US_FOOD];
  const expected = rightShares(mixed);

  // THE CONTROLS of the walk. The right share must differ from what the unfixed
  // build drew, in the carb cell and in the carb cell of the gram share, or a
  // build that still sums the printed figures would pass.
  expect(expected, 'CONTROL: the right calorie share is not the old one').not.toEqual(oldShares(mixed));
  expect(rightCarbGramPercent(mixed), 'CONTROL: the right gram share is not the old one').not.toBe(
    oldCarbGramPercent(mixed),
  );
  expect(expected, 'the figures of the day are the ones the report is built on').toEqual([6, 19, 75]);

  await completeOnboarding(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const days = [shiftDay(today, -2), shiftDay(today, -1), today];
  await logFoodsOnDays(page, { days, foods: mixed });

  //////////////////////////////////////////////////////////////////////////
  // 1. THE DIARY, on calories (the default).
  //////////////////////////////////////////////////////////////////////////
  await page.goto('/diary');
  await expect(page.locator('[data-slot="meal-group"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="macro-ratio-bar"]')).toHaveAttribute('data-basis', 'kcal');
  await expect(page.locator('[data-slot="macro-share"]:visible')).toHaveCount(3);
  expect(await visibleCellPercents(page), 'the cells state the calorie share of the mixed day').toEqual(expected);
  expect(await barPercents(page), 'the bar reads out the same shares').toEqual(expected);

  //////////////////////////////////////////////////////////////////////////
  // 2. THE DIARY, on grams. The carb cell is total carbs.
  //////////////////////////////////////////////////////////////////////////
  await page.locator('#what-you-ate-basis-grams').click();
  await expect(page.locator('[data-slot="macro-ratio-bar"]')).toHaveAttribute('data-basis', 'grams');
  await expect(page.locator('[data-slot="macro-share"]:visible')).toHaveCount(4);
  const gramPercents = await visibleCellPercents(page);
  expect(gramPercents[0], 'the carb cell by grams is total carbs over all four').toBe(rightCarbGramPercent(mixed));
  await page.locator('#what-you-ate-basis-kcal').click();
  await expect(page.locator('[data-slot="macro-ratio-bar"]')).toHaveAttribute('data-basis', 'kcal');

  //////////////////////////////////////////////////////////////////////////
  // 3. INSIGHTS, the same day. Its row and the range average say what the
  // diary said. Each of the three days is the same day, so the average is too.
  //////////////////////////////////////////////////////////////////////////
  await page.goto('/trends?tab=nutrition&range=7');
  await expect(page.locator('[data-slot="macro-split-card"]')).toHaveAttribute('data-basis', 'kcal');
  expect(await splitRowPercents(page, today), 'the Insights row for the day agrees with the diary').toEqual(expected);
  expect(await splitAveragePercents(page), 'the Insights average of three identical days agrees too').toEqual(expected);
});

test('a day of one US-panel food counts its fibre at 2 kcal per gram, not 4', async ({ page }) => {
  const usOnly = [US_FOOD];
  const expected = rightShares(usOnly);
  // CONTROLS. The rule is the claim, so the two ways it could be got wrong
  // must both read differently: the old figure (printed carbs at 4 kcal, fibre
  // included) and a share that took fibre out of the carbs and counted nothing for it.
  expect(expected, 'CONTROL: the right share is not the old one').not.toEqual(oldShares(usOnly));
  const fibreAtZero = percentsOf([4 * (US_FOOD.carbs - US_FOOD.fiber), 4 * US_FOOD.protein, 9 * US_FOOD.fat]);
  expect(expected, 'CONTROL: fibre at 2 kcal per gram is not fibre at 0').not.toEqual(fibreAtZero);

  await completeOnboarding(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await logFoodsOnDays(page, { days: [today], foods: usOnly });

  await page.goto('/diary');
  await expect(page.locator('[data-slot="meal-group"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="macro-share"]:visible')).toHaveCount(3);
  expect(await visibleCellPercents(page)).toEqual(expected);
  expect(await barPercents(page)).toEqual(expected);
});
