/**
 * The Goals tab (M239/05), on the real page: how often the net-carbs goal was
 * met, and the run lines that go when gamification is switched off.
 *
 * WHAT IS CLAIMED.
 *
 * - With no goal set, the tab is one invitation and draws no goal card.
 * - One complete day under a 50 g net-carbs ceiling and one over it read
 *   "1 of 2" on the net-carbs card, with the sentence read off the shipped
 *   English catalog (`copy.ts`), never transcribed.
 * - CONTROL: protein has no goal on this device, so it has no card at all. A
 *   tab that drew a tile for every goal, set or not, fails here.
 * - With gamification on, the net-carbs card carries a run line (count > 0).
 *   After the switch on Preferences is turned off, the run lines are gone from
 *   the DOM (count 0), while the card itself is still there, so the zero is
 *   the switch working and not an empty page.
 *
 * THE GOAL goes in through the real form, the way a person sets it, and THE
 * SWITCH through the real Preferences row. Each write is waited for on disk
 * before the next page load, because TinyBase saves after the render and a
 * full load can beat the save. THE DIARY is written straight into IndexedDB in
 * the shape the primary store persists, the layout `insights-meals.spec.ts`
 * and `insights-nutrition.spec.ts` already use.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { completeOnboarding, expectPhoneLayout } from './helpers';

/** The net-carbs ceiling set through the form, in grams. */
const NET_CARBS_CEILING_G = 50;

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
              const id = `goals-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T12:00:00Z`);
              return [
                id,
                {
                  entity: JSON.stringify({
                    id,
                    name: `Seed ${id}`,
                    quantityGrams: 100,
                    macros: { carbs: log.carbs, fiber: 0, sugars: null, polyols: 0, protein: 10, fat: 10, kcal: 400 },
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
 * Whether the stored profile row carries `fragment` yet. A WAIT, never an
 * assertion: what the app does with the value is asserted on the page.
 */
async function profileOnDiskIncludes(page: Page, fragment: string): Promise<boolean> {
  return page.evaluate(
    (needle) =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const read = db.transaction('t', 'readonly').objectStore('t').get('profileGoals');
          read.addEventListener('success', () => {
            db.close();
            resolve(JSON.stringify(read.result ?? null).includes(needle));
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the profile goals could not be read'));
          });
        });
      }),
    fragment,
  );
}

test('the net-carbs goal reads 1 of 2, and hiding gamification removes the runs', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await writeLogsToDisk(page, [
    { dayKey: shiftDay(today, -3), carbs: 30 }, // under the ceiling
    { dayKey: shiftDay(today, -2), carbs: 80 }, // over it
  ]);

  ////////////////////////////////////////////////////////////////////////////
  // No goal yet: one invitation, and no goal card at all
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/trends?tab=goals');
  await expect(page.locator('[data-slot="goals-invite"]')).toContainText(EN.trends.goals.invite);
  await expect(page.locator('[data-slot="goal-stat-card"]')).toHaveCount(0);

  ////////////////////////////////////////////////////////////////////////////
  // The net-carbs goal, through the real form
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/settings/nutrition');
  await page.locator('input[name="goalNetCarbsCeilingG"]').fill(`${NET_CARBS_CEILING_G}`);
  await page.getByRole('button', { name: EN.goals.save, exact: true }).click();
  await expect.poll(() => profileOnDiskIncludes(page, `\\"goalNetCarbsCeilingG\\":${NET_CARBS_CEILING_G}`)).toBe(true);

  ////////////////////////////////////////////////////////////////////////////
  // Gamification on: the rate, no protein card, and the run line
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/trends?tab=goals');
  // The invitation gives way once a goal is set.
  await expect(page.locator('[data-slot="goals-invite"]')).toHaveCount(0);
  const netCarbsCard = page.locator('[data-slot="goal-stat-card"][data-goal="netCarbs"]');
  await expect(netCarbsCard).toBeVisible();
  await expect(netCarbsCard.locator('[data-slot="goal-hit-rate"]')).toHaveText(
    fill(EN.trends.goals.hitRate, { met: '1', rated: '2' }),
  );
  // CONTROL: no protein goal is set, so there is no protein card at all.
  await expect(page.locator('[data-slot="goal-stat-card"][data-goal="protein"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="goals-honesty"]')).toHaveText(EN.trends.goals.honesty);

  // CONTROL for the hidden case below: with the switch on, the run line is drawn.
  await expect(page.locator('[data-slot="goal-run"]')).not.toHaveCount(0);

  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // Gamification off, through the real Preferences switch
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/settings/preferences');
  const hideSwitch = page.getByRole('switch', { name: EN.awards.hide });
  await expect(hideSwitch).toHaveAttribute('aria-checked', 'false');
  await hideSwitch.click();
  await expect(hideSwitch).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => profileOnDiskIncludes(page, '\\"gamificationHidden\\":true')).toBe(true);

  await page.goto('/trends?tab=goals');
  // The card is still there, so the zero below is the switch, not an empty page.
  await expect(netCarbsCard.locator('[data-slot="goal-hit-rate"]')).toHaveText(
    fill(EN.trends.goals.hitRate, { met: '1', rated: '2' }),
  );
  await expect(page.locator('[data-slot="goal-run"]')).toHaveCount(0);
});
