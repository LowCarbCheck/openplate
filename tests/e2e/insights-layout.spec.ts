/**
 * No Insights tab overflows a 360 px phone (M239/07): the document itself,
 * the tab strip, and every card and chart the four tabs draw.
 *
 * WHY GEOMETRY AND NOT A SCREENSHOT. Headless Chromium hides scrollbars, so a
 * page that scrolls sideways can still look right in a screenshot; only
 * `scrollWidth` against `clientWidth` says "this needs more room than it was
 * given". `insights-tabs.spec.ts` already makes this call for the tab strip
 * alone, at the same 360 px budget the strip's own doc comment names; this
 * spec repeats it on the whole document and on every card and chart, across
 * all four tabs.
 *
 * WHY 360 PX AND NOT THE PROJECT'S 390. 360 is the narrowest budget this app
 * is written against (`insights-tabs.spec.ts`'s own `NARROW_PHONE_WIDTH`, and
 * this milestone's own spec text), so it is the tighter, more honest fit.
 *
 * THE FIXTURE gives every tab something real to measure, so a check that
 * never found a card would trivially pass without proving anything: seven
 * days of full macros across three meal slots (Nutrition's chart and macro
 * split, Meals' per-slot averages and share bars), plus both daily goals set
 * through the real settings form (Goals' stat cards), the same IndexedDB
 * layout `insights-range.spec.ts` and its siblings already write.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding } from './helpers';

/** How many days of diary this fixture writes, ending today. */
const HISTORY_DAYS = 7;

/** The chart window every tab is opened on, so the fixture's days are all inside it. */
const RANGE_DAYS = HISTORY_DAYS;

/** The net-carbs ceiling saved through the real settings form, in grams. */
const NET_CARBS_CEILING_G = 200;

/** The protein floor saved through the real settings form, in grams. */
const PROTEIN_FLOOR_G = 40;

/** The narrow end of the phone budget `insights-tabs.spec.ts` already checks the tab strip against. */
const NARROW_PHONE_WIDTH = 360;

/** A generous height so the width budget is the only thing under test. */
const NARROW_PHONE_HEIGHT = 844;

/** A CSS pixel of rounding either side of an exact fit still counts as "fits". */
const OVERFLOW_TOLERANCE_PX = 1;

/** The four review sections this walk checks, in the tab strip's own order. */
const TABS = ['overview', 'nutrition', 'meals', 'goals'] as const;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** One seeded log: its day, its slot, and a full, known macro set. */
interface SeedLog {
  dayKey: string;
  mealType: 'breakfast' | 'lunch' | 'dinner';
  carbs: number;
  protein: number;
  fat: number;
}

/**
 * Writes the logs into the primary store's `foodLogs` table on disk and
 * resolves once the transaction has committed. Same IndexedDB layout every
 * other `insights-*` spec writes (see `insights-range.spec.ts`).
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
              const id = `layout-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T1${index % 3}:00:00Z`);
              return [
                id,
                {
                  entity: JSON.stringify({
                    id,
                    name: `Seed ${id}`,
                    quantityGrams: 100,
                    macros: {
                      carbs: log.carbs,
                      fiber: 5,
                      sugars: null,
                      polyols: 0,
                      protein: log.protein,
                      fat: log.fat,
                      kcal: log.carbs * 4 + log.protein * 4 + log.fat * 9,
                    },
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

/**
 * Whether both saved goals have reached disk yet. A WAIT, never an assertion:
 * what the app does with the goals is asserted on the Goals tab itself.
 */
async function goalsOnDisk(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ ceiling, floor }) =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const read = db.transaction('t', 'readonly').objectStore('t').get('profileGoals');
          read.addEventListener('success', () => {
            db.close();
            const stored = JSON.stringify(read.result ?? null);
            resolve(
              stored.includes(`\\"goalNetCarbsCeilingG\\":${ceiling}`) &&
                stored.includes(`\\"goalProteinFloorG\\":${floor}`),
            );
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the profile goals could not be read'));
          });
        });
      }),
    { ceiling: NET_CARBS_CEILING_G, floor: PROTEIN_FLOOR_G },
  );
}

/** One element's box, and enough of its identity to name it in a failure message. */
interface OverflowReading {
  slot: string;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Every element matched by `selector` whose content needs more width than it
 * was given, at `OVERFLOW_TOLERANCE_PX` of slack for sub-pixel rounding.
 * Empty when nothing overflows, which is what every call below asserts with
 * `toEqual([])`, so a failure names the offending slot instead of just "false".
 */
async function overflowingElements(page: Page, selector: string): Promise<OverflowReading[]> {
  return page.locator(selector).evaluateAll(
    (elements, tolerance) =>
      elements
        .map((element) => ({
          slot: element.getAttribute('data-slot') ?? element.tagName.toLowerCase(),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }))
        .filter((reading) => reading.scrollWidth > reading.clientWidth + tolerance),
    OVERFLOW_TOLERANCE_PX,
  );
}

/**
 * The tab strip, every card the four tabs draw (`insights-door-card`,
 * `macro-split-card`, `slot-averages-card`, `goal-stat-card`, and so on, every
 * one of them named `*-card`), the one chart this app draws (an inline
 * `<svg>`, `trend-chart.tsx`), and the HTML bar elements built from divs
 * (`macro-split-bar`, `slot-share-bar`); the SVG shapes inside the chart
 * itself (`trend-bar`) are excluded by the `div` qualifier, since an SVG
 * shape's `clientWidth` is always 0 and could never fail this check anyway.
 */
const LAYOUT_SELECTOR = '[data-slot="insights-tab-strip"], [data-slot$="-card"], svg, div[data-slot$="-bar"]';

test('no Insights tab overflows a 360 px phone', async ({ page }) => {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const logs: SeedLog[] = [];
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo += 1) {
    const dayKey = shiftDay(today, -daysAgo);
    logs.push(
      { dayKey, mealType: 'breakfast', carbs: 20 + daysAgo, protein: 15, fat: 5 },
      { dayKey, mealType: 'lunch', carbs: 30 + daysAgo, protein: 20, fat: 10 },
      { dayKey, mealType: 'dinner', carbs: 25 + daysAgo, protein: 25, fat: 12 },
    );
  }
  await writeLogsToDisk(page, logs);

  // Both daily goals, through the real form, so the Goals tab has a stat
  // card for each rather than the no-goal invitation.
  await page.goto('/settings/nutrition');
  await page.locator('input[name="goalNetCarbsCeilingG"]').fill(`${NET_CARBS_CEILING_G}`);
  await page.locator('input[name="goalProteinFloorG"]').fill(`${PROTEIN_FLOOR_G}`);
  await page.getByRole('button', { name: EN.goals.save, exact: true }).click();
  await expect.poll(() => goalsOnDisk(page)).toBe(true);

  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: NARROW_PHONE_HEIGHT });

  for (const tab of TABS) {
    await page.goto(`/trends?tab=${tab}&range=${RANGE_DAYS}`);
    await expect(page.locator('[data-slot="insights-tab-strip"]').getByRole('tab', { selected: true })).toBeVisible();

    ////////////////////////////////////////////////////////////////////////
    // THE CONTROL AGAINST A VACUOUS PASS: each tab has something real drawn,
    // so the overflow check below is measuring actual content, not an empty
    // page a broken build could also produce with zero overflowing elements.
    ////////////////////////////////////////////////////////////////////////
    if (tab === 'overview') await expect(page.locator('[data-slot="insights-door-card"]')).not.toHaveCount(0);
    if (tab === 'nutrition') await expect(page.locator('[data-slot="macro-split-card"]')).toBeVisible();
    if (tab === 'meals') await expect(page.locator('[data-slot="slot-averages-card"]')).toBeVisible();
    if (tab === 'goals') await expect(page.locator('[data-slot="goal-stat-card"]')).not.toHaveCount(0);

    ////////////////////////////////////////////////////////////////////////
    // THE CLAIM: nothing on this tab needs more width than a 360 px phone
    // gives it, on the document itself and on every card, chart and bar.
    ////////////////////////////////////////////////////////////////////////
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);

    await expect.poll(() => overflowingElements(page, LAYOUT_SELECTOR)).toEqual([]);
  }
});
