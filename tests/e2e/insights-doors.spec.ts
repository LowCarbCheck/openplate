/**
 * The Overview tab's doors in (M239/06), on the real pages: the dashboard's
 * week card and its one-time hint both lead to `/trends?tab=overview` with
 * the range summary visible, the hint stays dismissed across a reload, and
 * the diary's day summary leads to `?tab=nutrition`.
 *
 * WHAT IS CLAIMED.
 *
 * - Three logged days inside the dashboard's own 7-day window are enough for
 *   the one-time hint to show (`MIN_TREND_DAYS`), and it is offered as a real,
 *   visible card before anything is dismissed (THE CONTROL for the dismissal
 *   below).
 * - Tapping the week card lands on `/trends?tab=overview` with the summary
 *   strip visible, reporting "3 of 7" logged days, the default range a
 *   brand-new account opens on (`pickDefaultRange`).
 * - CONTROL for the change line: nothing was logged in the 7 days before this
 *   stretch, so `computeRangeSummary` reports a null change and the strip
 *   draws no change line for net carbs at all.
 * - The hint's dismissal survives a reload, not just a re-render: a component
 *   that only hid it in local state would satisfy every check short of
 *   loading the page again.
 * - The diary's day summary carries its own door, to `?tab=nutrition`.
 *
 * THE DIARY IS WRITTEN STRAIGHT INTO INDEXEDDB, in the shape the primary
 * store persists, the same layout `insights-meals.spec.ts` and
 * `insights-goals.spec.ts` already use.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { completeOnboarding, expectPhoneLayout } from './helpers';

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** One seeded log: its day and its grams of carbohydrate (fiber and polyols zeroed, so net carbs equal carbs). */
interface SeedLog {
  dayKey: string;
  carbs: number;
}

/** Writes the logs into the primary store's `foodLogs` table and resolves once the transaction committed. */
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
              const id = `doors-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T12:00:00Z`);
              return [
                id,
                {
                  entity: JSON.stringify({
                    id,
                    name: `Seed ${id}`,
                    quantityGrams: 100,
                    macros: { carbs: log.carbs, fiber: 0, sugars: null, polyols: 0, protein: 10, fat: 5, kcal: log.carbs * 4 },
                    mealType: null,
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

test('the dashboard and diary open Insights, and the one-time hint stays dismissed', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const dayA = shiftDay(today, -2);
  const dayB = shiftDay(today, -1);
  const dayC = today;

  // MIN_TREND_DAYS (3) logged days, all inside the dashboard's own 7-day
  // window and inside the default 7-day chart range a brand-new account opens
  // on. Nothing is logged in the 7 days before that: THE CONTROL for the
  // change line below.
  await writeLogsToDisk(page, [
    { dayKey: dayA, carbs: 20 },
    { dayKey: dayB, carbs: 25 },
    { dayKey: dayC, carbs: 30 },
  ]);

  ////////////////////////////////////////////////////////////////////////////
  // The one-time hint, visible before it is dismissed (the control below)
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/dashboard');

  const hint = page.locator('[data-slot="insights-hint"]');
  await expect(hint).toBeVisible();
  await expect(hint.getByText(EN.dashboard.insightsHint.title, { exact: true })).toBeVisible();

  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // The week card door, landing on the Overview tab with the summary visible
  ////////////////////////////////////////////////////////////////////////////

  await page.locator('[data-slot="week-glance-card"]').click();
  await expect(page).toHaveURL(/\/trends\?tab=overview/);

  const summaryCard = page.locator('[data-slot="range-summary-card"]');
  await expect(summaryCard).toBeVisible();
  await expect(page.locator('[data-slot="range-summary-logged-days"]')).toContainText(
    fill(EN.trends.meals.averages.loggedDays, { days: '3', total: '7' }),
  );
  // THE CONTROL: nothing was logged in the 7 days before this stretch, so the
  // net-carbs metric reports an average but no change line at all.
  const netCarbsMetric = page.locator('[data-slot="range-summary-metric"][data-metric="netCarbs"]');
  await expect(netCarbsMetric).toBeVisible();
  await expect(netCarbsMetric.locator('[data-slot="range-summary-value"]')).toBeVisible();

  ////////////////////////////////////////////////////////////////////////////
  // Back to the dashboard: dismiss the hint, prove it survives a reload
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="insights-hint"]'), 'the control: still there before dismissal').toBeVisible();

  await page
    .locator('[data-slot="insights-hint"]')
    .getByRole('button', { name: EN.diary.saveMeal.hint.dismiss, exact: true })
    .click();
  await expect(page.locator('[data-slot="insights-hint"]')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-slot="insights-hint"]'), 'a dismissed hint must not come back on reload').toHaveCount(0);
  // The door it pointed at is still there, so the dismissal hid the nudge,
  // not the feature.
  await expect(page.locator('[data-slot="week-glance-card"]')).toBeVisible();

  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // The diary's day summary door, to the Nutrition tab
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/diary');
  const diaryDoor = page.locator('[data-slot="day-summary-insights-link"]');
  await expect(diaryDoor).toBeVisible();
  await diaryDoor.click();
  await expect(page).toHaveURL(/\/trends\?tab=nutrition/);
});
