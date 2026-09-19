/**
 * The 90-day range on a long diary, on the real chart (M239/01).
 *
 * WHAT IS CLAIMED. With a year of history on the device, `/trends?range=90`
 * draws ONE BAR PER WEEK, dated by its Monday, and exactly as many bars as
 * there are Monday→Sunday weeks touching the last 90 days. The count is worked
 * out here from today's date by the same rule `bucketByWeek` uses (the Monday
 * of each day in the window), never hard-coded, because it is 13 or 14
 * depending on which weekday today is.
 *
 * THE CONTROL. `range=14` on the same diary draws 14 DAILY bars on
 * consecutive days. Fourteen is also a possible weekly count, so the control
 * is the dates, not the number: a weekly chart has bars seven days apart, a
 * daily one has bars one day apart.
 *
 * THE GAP WEEK. One whole week inside the window is left unlogged, and its bar
 * must be drawn as `empty`, while the week beside it must not be. A fold that
 * divided by seven or filled missing weeks with zero would draw that week as a
 * bar.
 *
 * WHY THE DIARY IS WRITTEN STRAIGHT INTO INDEXEDDB. A thousand foods typed
 * through the form would take the whole tier's time budget. The rows are
 * written in the exact shape the primary store persists (TinyBase's `t`
 * object store, one `{ k, v }` record per table, each row a JSON `entity`
 * cell; see `tests/e2e/helpers.ts` for the same layout read back), and the
 * page is then loaded fresh, so the app reads them the way it reads any
 * diary it finds on disk.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, expectPhoneLayout } from './helpers';

/** Days of history written to the device, ending today. */
const HISTORY_DAYS = 400;

/** The widest range, in days. */
const WIDE_RANGE = 90;

/** The daily control range, in days. */
const DAILY_RANGE = 14;

/** How many weeks back from this week's Monday the unlogged week sits. */
const GAP_WEEK_OFFSET = 5;

/** Days in a Monday→Sunday week. */
const DAYS_PER_WEEK = 7;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The Monday of `day`'s week, the rule `startOfWeek` in `app/lib/trend-week.ts` applies. */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDay(day, -((weekday + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK));
}

/** The whole days between two `YYYY-MM-DD` dates, `later - earlier`. */
function daysBetween({ earlier, later }: { earlier: string; later: string }): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

/** One food log row as the primary store persists it: the entity as JSON in the `entity` cell. */
interface SeedRow {
  id: string;
  dayKey: string;
  carbs: number;
  createdAt: number;
}

/**
 * The synthetic diary: two logs on even days and three on odd ones across
 * `HISTORY_DAYS`, so about 1000 rows, with one whole week left empty.
 */
function buildDiary({ today, gapMonday }: { today: string; gapMonday: string }): SeedRow[] {
  const gapSunday = shiftDay(gapMonday, DAYS_PER_WEEK - 1);
  const rows: SeedRow[] = [];
  for (let back = 0; back < HISTORY_DAYS; back += 1) {
    const dayKey = shiftDay(today, -back);
    if (dayKey >= gapMonday && dayKey <= gapSunday) continue;
    const logsToday = back % 2 === 0 ? 2 : 3;
    for (let slot = 0; slot < logsToday; slot += 1) {
      rows.push({
        id: `seed-${dayKey}-${slot}`,
        dayKey,
        carbs: 10 + ((back + slot) % 20),
        createdAt: Date.parse(`${dayKey}T0${slot + 7}:00:00Z`),
      });
    }
  }
  return rows;
}

/**
 * Writes the diary into the primary store's `foodLogs` table on disk, in the
 * page, and resolves once the transaction has committed.
 */
async function writeDiaryToDisk(page: Page, rows: readonly SeedRow[]): Promise<void> {
  await page.evaluate(
    (seedRows) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells = Object.fromEntries(
            seedRows.map((row) => [
              row.id,
              {
                entity: JSON.stringify({
                  id: row.id,
                  name: `Seed ${row.id}`,
                  quantityGrams: 100,
                  macros: { carbs: row.carbs, fiber: 0, sugars: null, polyols: 0, protein: 20, fat: 10, kcal: 250 },
                  mealType: 'lunch',
                  source: 'manual',
                  aiEstimated: false,
                  curatedSource: null,
                  foodId: null,
                  dayKey: row.dayKey,
                  loggedAt: row.createdAt,
                  createdAt: row.createdAt,
                  logBatchId: null,
                }),
              },
            ]),
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
    rows,
  );
}

/** Every chart bar's date and fill, left to right. */
async function readBars(page: Page): Promise<{ date: string; fill: string }[]> {
  return page
    .locator('[data-slot="trend-bar"]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        date: element.getAttribute('data-date') ?? '',
        fill: element.getAttribute('data-fill') ?? '',
      })),
    );
}

/** The gaps in days between neighbouring bars. */
function strides(bars: readonly { date: string }[]): number[] {
  return bars.slice(1).map((bar, index) => daysBetween({ earlier: bars[index].date, later: bar.date }));
}

test('a long diary at 90 days draws one bar per week, and 14 days stays daily', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const gapMonday = shiftDay(mondayOf(today), -GAP_WEEK_OFFSET * DAYS_PER_WEEK);
  const diary = buildDiary({ today, gapMonday });
  expect(diary.length, 'the synthetic diary is about a thousand logs').toBeGreaterThan(950);

  await writeDiaryToDisk(page, diary);

  // M239/02: the chart moved to the Nutrition tab, so the plain `/trends`
  // URL no longer draws it.
  await page.goto(`/trends?tab=nutrition&range=${DAILY_RANGE}`);

  ////////////////////////////////////////////////////////////////////////////
  // The control: 14 days are 14 daily bars
  ////////////////////////////////////////////////////////////////////////////

  await expect(page.locator('[data-slot="trend-bar"]')).toHaveCount(DAILY_RANGE);
  const daily = await readBars(page);
  expect(daily.at(-1)?.date).toBe(today);
  expect(strides(daily)).toEqual(Array.from({ length: DAILY_RANGE - 1 }, () => 1));

  ////////////////////////////////////////////////////////////////////////////
  // The claim: 90 days are one bar per week
  ////////////////////////////////////////////////////////////////////////////

  // Reached through the control, not typed as a URL, so the 3 months choice
  // is proven to exist and to land on the range it names.
  const rangeLink = page.getByRole('link', { name: EN.trends.range.threeMonths, exact: true });
  await rangeLink.click();
  await expect(rangeLink).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(new RegExp(`range=${WIDE_RANGE}`));

  const windowDays = Array.from({ length: WIDE_RANGE }, (_, index) => shiftDay(today, index - (WIDE_RANGE - 1)));
  const expectedMondays = [...new Set(windowDays.map(mondayOf))];

  await expect(page.locator('[data-slot="trend-bar"]')).toHaveCount(expectedMondays.length);
  const weekly = await readBars(page);
  expect(weekly.map((bar) => bar.date)).toEqual(expectedMondays);
  expect(strides(weekly)).toEqual(Array.from({ length: expectedMondays.length - 1 }, () => DAYS_PER_WEEK));

  // The unlogged week is a gap; the week after it, logged, is a bar.
  const gapBar = weekly.find((bar) => bar.date === gapMonday);
  const nextBar = weekly.find((bar) => bar.date === shiftDay(gapMonday, DAYS_PER_WEEK));
  expect(gapBar?.fill, 'the unlogged week must be drawn as no data').toBe('empty');
  expect(nextBar?.fill, 'the logged week beside it must be drawn as a bar').toBe('solid');

  await expectPhoneLayout(page);
});
