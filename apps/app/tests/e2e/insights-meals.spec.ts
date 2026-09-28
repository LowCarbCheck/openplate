/**
 * The Meals tab (M239/04), on the real page: per-slot averages, the "logged
 * on N of M days" caption, and the day-by-day share bar.
 *
 * WHAT IS CLAIMED.
 *
 * - Breakfast's average is the mean of the days IT was logged, never the
 *   whole visible range: day B (dinner only) must not enter it.
 * - "Logged on N of M days" is read straight off the shipped English catalog
 *   (`copy.ts`), never transcribed, the same discipline every spec here
 *   follows. `M` is the calendar length of the chosen range (the same
 *   "logged {{days}} of the last {{total}} days" convention the Goals grid
 *   already uses), so at the 7-day range it reads "of 7 days" even though
 *   only 3 of those days carry any log at all.
 * - THE CONTROL: dinner is ALSO logged on 2 of the 7 days (day A and day B),
 *   the identical count as breakfast, but its average is a different number.
 *   A version that averaged over the wrong days, or that confused which slot
 *   owns which figure, would pass the count check and fail this one.
 * - With no slot chosen, the day-by-day share bar draws one bar per day of
 *   the range, and every logged day's segments add up to the bar's own width,
 *   measured with `getBoundingClientRect`, never a screenshot.
 *
 * THE FIXTURE. Three logged days, the least `MIN_TREND_DAYS` lets a chart
 * draw, net-carb-only entries (fiber/polyols zeroed, so net carbs === carbs):
 *
 *   day A   breakfast 20 g, dinner 200 g
 *   day B                    dinner 300 g
 *   day C   breakfast 30 g
 *
 * Breakfast: logged on A and C, mean (20+30)/2 = 25.
 * Dinner: logged on A and B, mean (200+300)/2 = 250, the same count as
 * breakfast's two days, a different number entirely.
 *
 * WHY THE DIARY IS WRITTEN STRAIGHT INTO INDEXEDDB. The manual form has no
 * way to log two different meals with two different macro figures inside one
 * short test run without flaking on its own animations; the rows are written
 * in the exact shape the primary store persists, the same layout
 * `insights-range.spec.ts` / `insights-nutrition.spec.ts` already use, and the
 * page is then loaded fresh.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { completeOnboarding, expectPhoneLayout } from './helpers';

/** The daily range the tab is opened on, so every row is one day, not a week. */
const DAILY_RANGE = 7;

/** How close two widths must be to count as the same, in CSS pixels. */
const PIXEL_TOLERANCE = 1.5;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** One seeded log: its day, its slot, and how many grams of carbohydrate it carries. */
interface SeedLog {
  dayKey: string;
  mealType: 'breakfast' | 'dinner';
  carbs: number;
}

/**
 * Writes the logs into the primary store's `foodLogs` table on disk and
 * resolves once the transaction has committed. Same IndexedDB layout
 * `insights-nutrition.spec.ts`'s `writeLogsToDisk` uses.
 */
async function writeLogsToDisk(page: Page, logs: readonly SeedLog[]): Promise<void> {
  await page.evaluate(
    (seedLogs) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells = Object.fromEntries(
            seedLogs.map((log, index) => {
              const id = `meals-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T12:00:00Z`);
              return [
                id,
                {
                  entity: JSON.stringify({
                    id,
                    name: `Seed ${id}`,
                    quantityGrams: 100,
                    macros: { carbs: log.carbs, fiber: 0, sugars: null, polyols: 0, protein: 0, fat: 0, kcal: log.carbs },
                    mealType: log.mealType,
                    source: 'manual',
                    aiEstimated: false,
                    curatedSource: null,
                    foodId: null,
                    dayKey: log.dayKey,
                    loggedAt,
                    createdAt: loggedAt,
                    logBatchId: null,
                  }),
                },
              ];
            }),
          );
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
    logs,
  );
}

/** The `data-value` of one slot's average figure, parsed as a number. */
async function readAverage(page: Page, slot: string, metric: string): Promise<number> {
  const value = page.locator(`[data-slot="slot-average-row"][data-slot-name="${slot}"] [data-slot="slot-average-value"][data-metric="${metric}"]`);
  await expect(value).toBeAttached();
  return Number(await value.getAttribute('data-value'));
}

test('breakfast’s average is its own days, and the day-by-day split adds up', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const dayB = shiftDay(today, -1); // dinner only
  const dayA = shiftDay(today, -2); // breakfast + dinner
  const dayC = today; // breakfast only

  await writeLogsToDisk(page, [
    { dayKey: dayA, mealType: 'breakfast', carbs: 20 },
    { dayKey: dayA, mealType: 'dinner', carbs: 200 },
    { dayKey: dayB, mealType: 'dinner', carbs: 300 },
    { dayKey: dayC, mealType: 'breakfast', carbs: 30 },
  ]);

  ////////////////////////////////////////////////////////////////////////////
  // No slot chosen: every slot's averages side by side, and the share bars
  ////////////////////////////////////////////////////////////////////////////

  await page.goto(`/trends?tab=meals&range=${DAILY_RANGE}`);
  await expect(page.locator('[data-slot="slot-averages-card"]')).toBeVisible();

  const breakfastRow = page.locator('[data-slot="slot-average-row"][data-slot-name="breakfast"]');
  await expect(breakfastRow).toContainText(fill(EN.trends.meals.averages.loggedDays, { days: '2', total: String(DAILY_RANGE) }));
  const dinnerRow = page.locator('[data-slot="slot-average-row"][data-slot-name="dinner"]');
  await expect(dinnerRow).toContainText(fill(EN.trends.meals.averages.loggedDays, { days: '2', total: String(DAILY_RANGE) }));

  const breakfastAverage = await readAverage(page, 'breakfast', 'averageNetCarbs');
  const dinnerAverage = await readAverage(page, 'dinner', 'averageNetCarbs');
  // THE CLAIM: day B's 300 g dinner never enters breakfast's mean.
  expect(breakfastAverage).toBe(25);
  // THE CONTROL: dinner reads the same logged-day count as breakfast, but a different average.
  expect(dinnerAverage).toBe(250);
  expect(dinnerAverage).not.toBe(breakfastAverage);

  // Lunch and snack were never logged: zero days, no figures to show.
  const lunchRow = page.locator('[data-slot="slot-average-row"][data-slot-name="lunch"]');
  await expect(lunchRow).toContainText(fill(EN.trends.meals.averages.loggedDays, { days: '0', total: String(DAILY_RANGE) }));

  // One stacked bar per day of the range.
  await expect(page.locator('[data-slot="slot-share-bar"]')).toHaveCount(DAILY_RANGE);
  const splitBars = page.locator('[data-slot="slot-share-bar"][data-state="split"]');
  await expect(splitBars).toHaveCount(3); // days A, B and C
  const barCount = await splitBars.count();
  for (let index = 0; index < barCount; index++) {
    const bar = splitBars.nth(index);
    const measured = await bar.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      segments: [...element.querySelectorAll('[data-slot="slot-share-segment"]')].map((segment) => segment.getBoundingClientRect().width),
    }));
    expect(measured.segments.length).toBeGreaterThan(0);
    const segmentSum = measured.segments.reduce((sum, width) => sum + width, 0);
    expect(Math.abs(segmentSum - measured.width)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  }

  // A day with nothing logged at all draws an empty track, not a zeroed split.
  await expect(page.locator('[data-slot="slot-share-bar"][data-state="none"]')).toHaveCount(DAILY_RANGE - 3);

  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // One slot in detail: the same average, and its own card
  ////////////////////////////////////////////////////////////////////////////

  await page.goto(`/trends?tab=meals&slot=breakfast&range=${DAILY_RANGE}`);
  await expect(page.locator('[data-slot="slot-average-row"][data-slot-name="breakfast"]')).toContainText(
    fill(EN.trends.meals.averages.loggedDays, { days: '2', total: String(DAILY_RANGE) }),
  );
  expect(await readAverage(page, 'breakfast', 'averageNetCarbs')).toBe(25);
  // No other slot's row is drawn on the single-slot view.
  await expect(page.locator('[data-slot="slot-average-row"][data-slot-name="dinner"]')).toHaveCount(0);
  // The share card belongs to the no-slot overview only.
  await expect(page.locator('[data-slot="slot-share-card"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="usual-slot-foods-card"][data-slot-name="breakfast"]')).toBeVisible();
});
