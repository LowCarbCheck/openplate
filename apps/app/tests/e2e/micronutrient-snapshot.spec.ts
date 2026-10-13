/**
 * The vitamins and minerals block on the diary and on Insights, on the real page.
 *
 * WHAT IS CLAIMED.
 *
 * - A covered day shows the block in its ready state, and a gap row names a
 *   nutrient (magnesium, the one the seed leaves light).
 * - The block's link opens `/nutrients?day=<day>`, and that screen shows that
 *   one day: its window line names the day, and its count is the block's count.
 *   CONTROL: the screen's own 7-day button leaves the day, and the count
 *   changes, because the week holds an AI-only day that pulls coverage under
 *   the bar.
 * - An AI-only day shows "Not enough data" and no percent anywhere in the
 *   block. CONTROL: the covered day's block does carry a percent.
 * - Insights links the window it shows: 7 days to `?range=7`, and 90 days to
 *   `?range=30`, the longest window `/nutrients` offers.
 * - NO LAYOUT SHIFT while the reference amounts load. The `/api/nutrients`
 *   answer is held at the network, the block is read in its loading state, the
 *   answer is let go, and nothing in `main` moves: the `layout-shift` total is
 *   0 and the macro block's top is unchanged. CONTROL: one line inserted into
 *   the block afterwards moves the link under it and scores a shift, so the
 *   two readings can see one.
 *
 * THE FIXTURE. Two days written straight into the primary store, in the shape
 * it persists (the same layout `insights-nutrition.spec.ts` writes):
 *
 *   today       200 g of a food with figures: magnesium light, sodium modest,
 *               every other nutrient plentiful
 *   yesterday   400 g of an AI estimate, which carries no figures at all
 *
 * The figures are fixtures written for this spec, not values from a table. The
 * reference amounts come from the fake food database, which serves the real
 * reference document. The year of birth and the sex go in through the real
 * profile form, the way a person saves them.
 *
 * @area diary-and-add
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { completeOnboarding, expectPhoneLayout, headerStatusText } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
} from './layout-shift';

/** The year of birth saved through the profile form: an adult in every reference band. */
const BIRTH_YEAR = '1990';

/** The covered food's weight, and the AI estimate's, in grams. Covered share over the week: 200 / 600, under the 60 percent bar. */
const COVERED_GRAMS = 200;
const ESTIMATED_GRAMS = 400;

/** Plentiful per 100 g, far above any reference amount. */
const PLENTY_PER_100G = 10_000;
/** Magnesium per 100 g: 20 mg on the day, a small share of any adult reference. */
const MAGNESIUM_PER_100G = 10;
/** Sodium per 100 g: 500 mg on the day, under the limit. */
const SODIUM_PER_100G = 250;

const VITAMIN_KEYS = [
  'betaCarotene',
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminB1',
  'vitaminB2',
  'vitaminB6',
  'vitaminB9',
  'vitaminB12',
] as const;
const MINERAL_KEYS = [
  'nacl',
  'potassium',
  'sodium',
  'calcium',
  'magnesium',
  'zinc',
  'phosphorus',
  'iron',
] as const;

/** Any percent figure, in the forms the app formats ("6%", "6 %"). */
const PERCENT = /\d\s?%/;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** A food's per-100 g figures, in the shape the store persists. */
interface SeedBlock {
  vitamins: Record<string, number>;
  minerals: Record<string, number>;
}

/** One seeded log: its day, its weight, and its per-100 g figures, or null for an AI estimate. */
interface SeedLog {
  id: string;
  dayKey: string;
  grams: number;
  micronutrients: SeedBlock | null;
}

/** A food log as the primary store persists it, the fields this spec writes. */
interface SeedEntity {
  id: string;
  name: string;
  quantityGrams: number;
  macros: { carbs: number; fiber: number; sugars: null; polyols: number; protein: number; fat: number; kcal: number };
  mealType: 'lunch';
  source: 'plate_ai' | 'manual';
  aiEstimated: boolean;
  curatedSource: string | null;
  foodId: null;
  dayKey: string;
  loggedAt: number;
  createdAt: number;
  logBatchId: null;
  micronutrientsPer100g?: SeedBlock;
}

/** The covered food's per-100 g block. */
function coveredBlock(): SeedBlock {
  const minerals: Record<string, number> = Object.fromEntries(MINERAL_KEYS.map((key) => [key, PLENTY_PER_100G]));
  minerals.magnesium = MAGNESIUM_PER_100G;
  minerals.sodium = SODIUM_PER_100G;
  minerals.nacl = SODIUM_PER_100G * 2.5;
  return { vitamins: Object.fromEntries(VITAMIN_KEYS.map((key) => [key, PLENTY_PER_100G])), minerals };
}

/** Writes the logs into the primary store's `foodLogs` table on disk and resolves once the transaction has committed. */
async function writeLogsToDisk(page: Page, logs: readonly SeedLog[]): Promise<void> {
  await page.evaluate(
    (seedLogs) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells = Object.fromEntries(
            seedLogs.map((log) => {
              const loggedAt = Date.parse(`${log.dayKey}T12:00:00Z`);
              const isEstimate = log.micronutrients === null;
              const entity: SeedEntity = {
                id: log.id,
                name: isEstimate ? 'Seed AI plate' : 'Seed covered food',
                quantityGrams: log.grams,
                macros: { carbs: 10, fiber: 3, sugars: null, polyols: 0, protein: 20, fat: 10, kcal: 210 },
                mealType: 'lunch',
                source: isEstimate ? 'plate_ai' : 'manual',
                aiEstimated: isEstimate,
                curatedSource: isEstimate ? null : 'e2e-fixture',
                foodId: null,
                dayKey: log.dayKey,
                loggedAt,
                createdAt: loggedAt,
                logBatchId: null,
              };
              // An AI estimate has no figures at all: the key is absent, not empty.
              if (log.micronutrients !== null) entity.micronutrientsPer100g = log.micronutrients;
              return [log.id, { entity: JSON.stringify(entity) }];
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

/** Saves a year of birth and a sex through the profile form, and waits until a fresh document reads them back. */
async function saveBodyMetrics(page: Page): Promise<void> {
  await page.goto('/settings/profile');
  const form = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="save-body-metrics"]') });
  await form.locator('input[name="birthYear"]').fill(BIRTH_YEAR);
  // The label, not the sr-only radio; exact, because "Female" contains "Male".
  await form.getByText(EN.bodyMetrics.sex.male, { exact: true }).click();
  await form.getByRole('button', { name: EN.bodyMetrics.save }).click();
  await expect.poll(() => headerStatusText(page), { message: 'the save must be confirmed' }).not.toBe('');
  await page.reload();
  const saved = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="save-body-metrics"]') });
  await expect(saved.locator('input[name="birthYear"]')).toHaveValue(BIRTH_YEAR);
}

/** The days the fixture uses. */
interface SeededDays {
  today: string;
  yesterday: string;
}

/** Onboards a fresh device, saves the body facts, and writes the two days. */
async function prepareDevice(page: Page): Promise<SeededDays> {
  await completeOnboarding(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const yesterday = shiftDay(today, -1);
  await saveBodyMetrics(page);
  await writeLogsToDisk(page, [
    { id: 'snapshot-covered', dayKey: today, grams: COVERED_GRAMS, micronutrients: coveredBlock() },
    { id: 'snapshot-estimate', dayKey: yesterday, grams: ESTIMATED_GRAMS, micronutrients: null },
  ]);
  return { today, yesterday };
}

/** The "X of Y nutrients have enough data" sentence as a pattern, the numbers captured. */
function coveredPattern(): RegExp {
  const escaped = EN.nutrients.hero.covered.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace('\\{\\{covered\\}\\}', '(\\d+)').replace('\\{\\{total\\}\\}', '(\\d+)'));
}

/** A promise and the call that settles it. */
interface Gate {
  opened: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let settle: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { opened, open: () => settle?.() };
}

/** The page-relative top of the "What you ate" macro breakdown. */
async function macroTop(page: Page): Promise<number> {
  return page
    .locator('[data-slot="macro-breakdown"]')
    .first()
    .evaluate((element) => Math.round((element.getBoundingClientRect().top + window.scrollY) * 10) / 10);
}

test('the diary block names a gap, opens its own day, and says nothing in numbers for an AI-only day', async ({
  page,
}) => {
  const { today, yesterday } = await prepareDevice(page);

  ////////////////////////////////////////////////////////////////////////////
  // The covered day: ready, a gap row naming magnesium, a percent present.
  ////////////////////////////////////////////////////////////////////////////
  await page.goto(`/diary?date=${today}`);
  const block = page.locator('[data-slot="micronutrient-snapshot"]');
  await expect(block).toHaveAttribute('data-state', 'ready');
  await expect(block).not.toHaveAttribute('data-loading', 'true');
  await expect(block.getByRole('heading', { name: EN.nutrients.snapshot.title })).toBeVisible();
  const gaps = block.locator('[data-layer-shown="true"] [data-slot="micronutrient-gap"]');
  await expect(gaps.first()).toContainText(EN.nutrients.name.magnesium);
  // The control for the AI-only day below: this block does show a percent.
  expect(await block.innerText()).toMatch(PERCENT);
  await expectPhoneLayout(page);

  const count = coveredPattern().exec(await block.innerText());
  expect(count, 'the block states how many nutrients have enough data').not.toBeNull();
  const [countSentence, covered, total] = count ?? [];
  expect(covered).toBe(total);

  ////////////////////////////////////////////////////////////////////////////
  // The link opens that one day on /nutrients.
  ////////////////////////////////////////////////////////////////////////////
  const link = block.getByRole('link', { name: EN.nutrients.snapshot.linkDay, exact: true });
  await expect(link).toHaveAttribute('href', `/nutrients?day=${today}`);
  await link.click();
  await page.waitForURL(`**/nutrients?day=${today}`);
  await expect(page.locator('[data-slot="nutrients-window"]')).toHaveAttribute('data-day', today);
  await expect(page.locator('main')).toContainText(countSentence ?? '');

  // CONTROL: the 7-day window holds yesterday's 400 g AI plate too, so the
  // same screen counts differently once the day is dropped.
  await page.getByRole('link', { name: EN.nutrients.range.week, exact: true }).click();
  await page.waitForURL('**/nutrients?range=7');
  await expect(page.locator('[data-slot="nutrients-window"]')).not.toHaveAttribute('data-day', /.+/);
  await expect(page.locator('main')).not.toContainText(countSentence ?? '');

  ////////////////////////////////////////////////////////////////////////////
  // The AI-only day: not enough data, and no percent anywhere in the block.
  ////////////////////////////////////////////////////////////////////////////
  await page.goto(`/diary?date=${yesterday}`);
  const aiBlock = page.locator('[data-slot="micronutrient-snapshot"]');
  await expect(aiBlock).toHaveAttribute('data-state', 'not-enough-data');
  await expect(aiBlock).toContainText(EN.nutrients.coverage.notEnoughData);
  expect(await aiBlock.innerText()).not.toMatch(PERCENT);
  await expect(aiBlock.getByRole('link', { name: EN.nutrients.snapshot.linkDay, exact: true })).toHaveAttribute(
    'href',
    `/nutrients?day=${yesterday}`,
  );
});

test('Insights links the window it shows, and 90 days opens the longest one', async ({ page }) => {
  await prepareDevice(page);

  for (const [range, opens] of [
    ['7', '7'],
    ['90', '30'],
  ] as const) {
    await page.goto(`/trends?tab=nutrition&range=${range}`);
    const block = page.locator('[data-slot="insights-micronutrient-card"] [data-slot="micronutrient-snapshot"]');
    await expect(block, `range ${range}`).toBeVisible();
    const link = block.getByRole('link', { name: fill(EN.nutrients.snapshot.linkRange, { days: opens }), exact: true });
    await expect(link, `range ${range}`).toHaveAttribute('href', `/nutrients?range=${opens}`);
  }
});

test('nothing moves while the reference amounts load', async ({ page }) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  const { today } = await prepareDevice(page);

  // Hold the reference list at the network until the loading state is read.
  const gate = createGate();
  await page.route(
    (url) => url.pathname === '/api/nutrients',
    async (route) => {
      await gate.opened;
      await route.continue();
    },
  );

  await page.goto(`/diary?date=${today}`);
  const block = page.locator('[data-slot="micronutrient-snapshot"]');
  await expect(block).toHaveAttribute('data-loading', 'true');
  // In view, because the browser reports no shift for a box below the fold.
  await block.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await settleAnimations(page);

  const since = (await readShiftEntries(page)).length;
  const before = await readTops(page);
  const macroBefore = await macroTop(page);

  gate.open();
  await expect(block).not.toHaveAttribute('data-loading', 'true');
  await expect(block.locator('[data-slot="micronutrient-snapshot-detail"]')).toHaveAttribute('data-layer', 'gaps');
  await settleFrames(page);

  expect(movedBetween(before, await readTops(page))).toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), since)).toBe(0);
  expect(await macroTop(page)).toBe(macroBefore);

  // CONTROL: one line inserted above the block's link moves the link and
  // everything under it, and both readings see it.
  const sinceControl = (await readShiftEntries(page)).length;
  const beforeControl = await readTops(page);
  await block.evaluate((element) => {
    const line = document.createElement('p');
    line.textContent = 'An inserted line';
    line.style.height = '24px';
    element.querySelector('[data-slot="micronutrient-snapshot-link"]')?.before(line);
  });
  await settleFrames(page);
  expect(movedBetween(beforeControl, await readTops(page)).length).toBeGreaterThan(0);
  expect(shiftScoreAfter(await readShiftEntries(page), sinceControl)).toBeGreaterThan(0);
});
