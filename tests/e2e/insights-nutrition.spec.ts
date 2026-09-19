/**
 * The Nutrition tab's protein chart and energy split, on the real page (M239/03).
 *
 * WHAT IS CLAIMED.
 *
 * - `?tab=nutrition&metric=protein` draws one bar per day of the range, and
 *   the day with an unknown macro is drawn as a floor (`data-fill` is
 *   `incomplete`), while the two whole days beside it are `solid`.
 * - Bar heights are the protein figures, measured with
 *   `getBoundingClientRect`, never a screenshot: 80 g must stand at two thirds
 *   of 120 g on the same axis.
 * - The protein floor draws a goal line, and a whole day under it is marked
 *   `under` while a day over it is not. The control for the line is
 *   `metric=fat`, which has no goal: the same device, the same days, no line.
 * - One day's energy split: its three segments fill the bar's full width.
 *
 * THE FIXTURE. Three logged days, the least `MIN_TREND_DAYS` lets the chart
 * draw, with a 100 g protein floor saved through the real settings form:
 *
 *   two days ago   120 g protein, every macro known   solid, over the floor
 *   yesterday       60 g protein, carbs unknown       incomplete, NOT flagged
 *   today           80 g protein, every macro known   solid, under the floor
 *
 * Yesterday is not flagged because a floor bar is a minimum: the real day may
 * have reached the goal. Today is the day that must carry the mark.
 *
 * WHY THE DIARY IS WRITTEN STRAIGHT INTO INDEXEDDB. The manual log form has
 * no way to leave carbs unknown on purpose, and an unknown macro is the claim.
 * The rows are written in the shape the primary store persists, the same
 * layout `insights-range.spec.ts` writes, and the page is then loaded fresh.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, expectPhoneLayout } from './helpers';

/** The protein floor saved in settings, in grams. */
const PROTEIN_FLOOR_G = 100;

/** The daily range the chart is opened on, so every bar is one day. */
const DAILY_RANGE = 7;

/** How close two heights or widths must be to count as equal, in CSS pixels. */
const PIXEL_TOLERANCE = 1.5;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The macros of one seeded log, per serving. `null` is a macro the food never reported. */
interface SeedMacros {
  carbs: number | null;
  fiber: number | null;
  protein: number;
  fat: number;
  kcal: number;
}

/** One seeded log: its day and its macros. */
interface SeedLog {
  dayKey: string;
  macros: SeedMacros;
}

/**
 * Writes the logs into the primary store's `foodLogs` table on disk and
 * resolves once the transaction has committed.
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
              const id = `nutrition-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T12:00:00Z`);
              return [
                id,
                {
                  entity: JSON.stringify({
                    id,
                    name: `Seed ${id}`,
                    quantityGrams: 100,
                    macros: { ...log.macros, sugars: null, polyols: 0 },
                    mealType: 'lunch',
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

/**
 * Whether the protein floor has reached the disk yet. A WAIT, never an
 * assertion: the goal is asserted on the chart through the app's own read.
 */
async function proteinFloorOnDisk(page: Page): Promise<boolean> {
  return page.evaluate(
    (floor) =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const read = db.transaction('t', 'readonly').objectStore('t').get('profileGoals');
          read.addEventListener('success', () => {
            db.close();
            resolve(JSON.stringify(read.result ?? null).includes(`\\"goalProteinFloorG\\":${floor}`));
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the profile goals could not be read'));
          });
        });
      }),
    PROTEIN_FLOOR_G,
  );
}

/** One bar's measured height and the states it was drawn in. */
interface BarReading {
  height: number;
  fill: string;
  goal: string;
}

/** The bar drawn for `date`: its height in CSS pixels, its fill, and its goal mark. */
async function readBar(page: Page, date: string): Promise<BarReading> {
  const bar = page.locator(`[data-slot="trend-bar"][data-date="${date}"]`);
  await expect(bar).toBeAttached();
  return bar.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    fill: element.getAttribute('data-fill') ?? '',
    goal: element.getAttribute('data-goal') ?? '',
  }));
}

test('the protein chart marks the partial day, measures the bars and draws the floor', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  const twoDaysAgo = shiftDay(today, -2);

  // The floor goes in through the real form, the way a person sets it.
  await page.goto('/settings/nutrition');
  await page.locator('input[name="goalProteinFloorG"]').fill(`${PROTEIN_FLOOR_G}`);
  await page.getByRole('button', { name: EN.goals.save, exact: true }).click();
  await expect.poll(() => proteinFloorOnDisk(page)).toBe(true);

  await writeLogsToDisk(page, [
    { dayKey: twoDaysAgo, macros: { carbs: 20, fiber: 5, protein: 120, fat: 40, kcal: 900 } },
    { dayKey: yesterday, macros: { carbs: null, fiber: null, protein: 60, fat: 30, kcal: 700 } },
    { dayKey: today, macros: { carbs: 30, fiber: 10, protein: 80, fat: 50, kcal: 900 } },
  ]);

  await page.goto(`/trends?tab=nutrition&range=${DAILY_RANGE}&metric=protein`);
  await expect(page.getByRole('link', { name: EN.trends.metric.protein, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );

  ////////////////////////////////////////////////////////////////////////////
  // One bar per day, three of them logged
  ////////////////////////////////////////////////////////////////////////////

  await expect(page.locator('[data-slot="trend-bar"]')).toHaveCount(DAILY_RANGE);
  await expect(page.locator('[data-slot="trend-bar"]:not([data-fill="empty"])')).toHaveCount(3);

  const bars = {
    twoDaysAgo: await readBar(page, twoDaysAgo),
    yesterday: await readBar(page, yesterday),
    today: await readBar(page, today),
  };

  // THE CLAIM: the day with an unknown macro is a floor. THE CONTROL: the two
  // whole days beside it are solid, so a chart that marked everything would fail.
  expect(bars.yesterday.fill).toBe('incomplete');
  expect(bars.twoDaysAgo.fill).toBe('solid');
  expect(bars.today.fill).toBe('solid');

  // Heights are the protein figures on one axis: 80 g is two thirds of 120 g,
  // and 60 g is shorter again.
  expect(Math.abs(bars.today.height - (bars.twoDaysAgo.height * 80) / 120)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  expect(bars.yesterday.height).toBeLessThan(bars.today.height);

  ////////////////////////////////////////////////////////////////////////////
  // The protein floor
  ////////////////////////////////////////////////////////////////////////////

  await expect(page.locator('[data-slot="trend-goal-line"]')).toHaveCount(1);
  // Today (80 g) is under the 100 g floor; two days ago (120 g) is not; the
  // partial day is never flagged, since its real value may have reached it.
  expect(bars.today.goal).toBe('under');
  expect(bars.twoDaysAgo.goal).toBe('none');
  expect(bars.yesterday.goal).toBe('none');

  // The 7-day average line rides over the daily bars.
  await expect(page.locator('[data-slot="trend-average-line"]')).toHaveCount(1);

  ////////////////////////////////////////////////////////////////////////////
  // The energy split of one whole day fills its bar
  ////////////////////////////////////////////////////////////////////////////

  const splitBar = page.locator(`[data-slot="macro-split-bar"][data-date="${twoDaysAgo}"]`);
  await expect(splitBar).toHaveAttribute('data-state', 'split');
  const split = await splitBar.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    segments: [...element.querySelectorAll('[data-slot="macro-split-segment"]')].map(
      (segment) => segment.getBoundingClientRect().width,
    ),
  }));
  expect(split.segments).toHaveLength(3);
  for (const width of split.segments) expect(width).toBeGreaterThan(0);
  const segmentSum = split.segments.reduce((sum, width) => sum + width, 0);
  expect(Math.abs(segmentSum - split.width)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

  // The partial day has no split to draw, so its bar holds no segment at all.
  await expect(page.locator(`[data-slot="macro-split-bar"][data-date="${yesterday}"]`)).toHaveAttribute(
    'data-state',
    'none',
  );

  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // The controls: fat has no goal line, weekly bars have no average line
  ////////////////////////////////////////////////////////////////////////////

  await page.getByRole('link', { name: EN.trends.metric.fat, exact: true }).click();
  await expect(page).toHaveURL(/metric=fat/);
  await expect(page.locator('[data-slot="trend-bar"]:not([data-fill="empty"])')).toHaveCount(3);
  await expect(page.locator('[data-slot="trend-goal-line"]')).toHaveCount(0);

  await page.getByRole('link', { name: EN.trends.range.month, exact: true }).click();
  await expect(page).toHaveURL(/range=30/);
  await expect(page).toHaveURL(/metric=fat/);
  await expect(page.locator('[data-slot="trend-bar"]:not([data-fill="empty"])')).not.toHaveCount(0);
  await expect(page.locator('[data-slot="trend-average-line"]')).toHaveCount(0);
});
