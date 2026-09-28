/**
 * The main goal leads the diary card (operator decision, 2026-09-23).
 *
 * The chain under test is the whole one: a pick on `/settings/nutrition`, the
 * card's own `clientAction`, the profile row on disk, the diary's loader, and
 * the lead block it draws. The unit tier proves each part; only a browser
 * proves a click reaches the lead.
 *
 * THE LEAD IS FOUND BY ITS SLOT AND ITS METRIC, `[data-slot="budget-lead"]`
 * and `data-metric`, never by its words: the words are wordsmith-owned copy.
 *
 * THE SETTINGS CARD MOVES NOTHING when its radio changes (DESIGN.md section 7):
 * picking "Calories" with no calorie target shows a hint, and that hint's line
 * is on the page from the first paint. The reading is the one section 7 names,
 * every element's top before and after plus a `layout-shift` total of 0.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, logFoodManually } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

/** One food, so the diary draws a day card rather than its empty state. */
const SEEDED_FOOD = { name: 'Main goal cheddar', grams: '100', carbs: '12.5' } as const;

/**
 * One field of the profile on DISK, as JSON, or `null` when the row or the
 * field is absent. Polled, never read once: the store saves after the
 * transaction, so a read fired the instant the toast paints can beat the save.
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
            // SAFETY: TinyBase's IndexedDB persister stores one record per
            // table as `{ k, v }`, with `v` keyed by row id, and the profile's
            // one row `me` carries its entity as JSON in the `entity` cell.
            const record = read.result as { v?: Record<string, { entity?: string }> } | undefined;
            const entity = record?.v?.me?.entity;
            if (entity === undefined) {
              resolve(null);
              return;
            }
            // SAFETY: written only by the primary store's `writeEntity`, as
            // `JSON.stringify` of a `LocalProfileGoals`, a plain JSON object.
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
 * The main goal on disk, or `null` for a profile without one.
 *
 * @param page - a page on the app's origin.
 * @returns the stored main goal id, or `null`.
 */
async function mainGoalOnDisk(page: Page): Promise<string | null> {
  const stored = await profileFieldOnDisk(page, 'mainGoal');
  return stored === null ? null : String(JSON.parse(stored));
}

/** The label wrapping one main goal radio on the settings card; the radio is `sr-only`. */
function mainGoalRow(page: Page, goal: string): Locator {
  return page.locator(`[data-slot="main-goal-options"] label:has(input[value="${goal}"])`);
}

/**
 * Picks a main goal on the settings card, saves it, and waits for the disk.
 *
 * @param page - a page past onboarding.
 * @param goal - the main goal id to pick.
 */
async function saveMainGoal(page: Page, goal: string): Promise<void> {
  await page.goto('/settings/nutrition');
  await mainGoalRow(page, goal).click();
  await page.getByRole('button', { name: EN.settings.mainGoal.save, exact: true }).click();
  await expect.poll(() => mainGoalOnDisk(page)).toBe(goal);
}

/**
 * Sets the carb ceiling on the targets card, so a net-carb lead has a bar.
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

/** The diary's lead block, once the day card is on screen. */
async function openLead(page: Page): Promise<Locator> {
  await page.goto('/diary');
  const lead = page.locator('[data-slot="budget-lead"]');
  await expect(lead).toBeVisible();
  return lead;
}

test('the diary leads with net carbs by default, and with protein once protein is the main goal', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);

  // THE CONTROL: with no pick, a "just track" device leads with net carbs.
  // Without it the protein claim below could pass against a card that always
  // led with protein.
  const defaultLead = await openLead(page);
  await expect(defaultLead).toHaveAttribute('data-metric', 'netCarbs');
  expect(await mainGoalOnDisk(page), 'onboarding stored the pre-selected main goal').toBe('net-carbs');

  await saveMainGoal(page, 'protein');
  const lead = await openLead(page);
  await expect(lead).toHaveAttribute('data-metric', 'protein');
  // Protein always has a target, the reference intake, so its lead draws a bar.
  await expect(lead.locator('[data-slot="budget-track"]')).toHaveCount(1);
  // The rest follow as the quiet list, net carbs among them.
  await expect(page.locator('[data-slot="budget-row"][data-metric="netCarbs"]')).toHaveCount(1);
});

test('a calorie lead with no calorie target shows the day total, no bar, and says there is no target', async ({
  page,
}) => {
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);
  await saveCarbCeiling(page, '50');

  // CONTROL: net carbs WITH a ceiling draws its bar in the lead, so the
  // absence asserted below is the missing calorie target and not a lead that
  // never draws one.
  const carbLead = await openLead(page);
  await expect(carbLead).toHaveAttribute('data-metric', 'netCarbs');
  await expect(carbLead.locator('[data-slot="budget-track"]')).toHaveCount(1);

  await saveMainGoal(page, 'calories');
  const lead = await openLead(page);
  await expect(lead, 'the lead is never swapped for a metric that has a target').toHaveAttribute(
    'data-metric',
    'calories',
  );
  await expect(lead.getByRole('link', { name: EN.diary.budget.leadNoTarget, exact: true })).toHaveAttribute(
    'href',
    '/settings/nutrition',
  );
  await expect(lead.locator('[data-slot="budget-track"]')).toHaveCount(0);
});

test('changing the main goal on the settings card moves nothing on the page', async ({ page }) => {
  await installShiftObserver(page);
  await completeOnboarding(page);
  await page.goto('/settings/nutrition');
  await expect(mainGoalRow(page, 'protein')).toBeVisible();
  const hint = page.locator('[data-slot="main-goal-no-target-hint"]');

  // The fixture has no calorie target, so the hint's line is reserved and hidden.
  await expect(hint).toHaveCSS('visibility', 'hidden');

  for (const goal of ['protein', 'calories', 'net-carbs', 'calories', 'protein']) {
    await settleAnimations(page);
    const before = await readTops(page);
    const entriesBefore = (await readShiftEntries(page)).length;
    await mainGoalRow(page, goal).click();
    await settleFrames(page);
    const entries = await readShiftEntries(page);
    const moved = movedBetween(before, await readTops(page));
    expect(moved, `picking ${goal} moved: ${JSON.stringify(moved)}`).toEqual([]);
    expect(
      shiftScoreAfter(entries, entriesBefore),
      `picking ${goal}: ${JSON.stringify(entries.slice(entriesBefore))}`,
    ).toBe(0);
    // THE CONTROL that the pick did something the reading could have seen:
    // the hint really does appear for calories and go for the other two.
    await expect(hint).toHaveCSS('visibility', goal === 'calories' ? 'visible' : 'hidden');
  }
});
