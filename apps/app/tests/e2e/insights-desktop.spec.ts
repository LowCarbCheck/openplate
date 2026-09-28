/**
 * Insights on a real desktop, and the controls that must not move (2026-09-21).
 *
 * THE REPORT. The operator looked at the Insights screens and said, in one
 * message, four things: the layout shifts while clicking around, the screen is
 * way too narrow on a desktop, the control buttons take up way too much space,
 * and the charts need hovers, tooltips and labels. Each one was true, and each
 * was measured on a device with data BEFORE anything was changed.
 *
 * WHAT WAS MEASURED (production-like dev server, 40 days of logs, 1440 x 900
 * and 390 x 844):
 *
 * - THE CONTROLS MOVED. They sat under the chart title. Choosing a meal added a
 *   "Showing Breakfast only" line above them, so the meal chips moved down 20
 *   px, and at 30 or 90 days the title wrapped to two lines and moved them 22 px
 *   more. The next tap landed on whatever slid under the finger.
 * - THE PAGE WAS 672 PX. A 1440 px window drew one column of that width, between
 *   two empty gutters of about 420 px each.
 * - THE CONTROLS WERE FIVE ROWS. Twelve chips in five rows of 44 px, about 330 px
 *   of a 844 px phone before the chart began.
 * - THE BARS SAID NOTHING. No scale, no tooltip. Only the weight chart had a
 *   hover, and it read out into a caption a screen's width away from the point.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * A 20 px element inserted above the controls must move the measured top by 20,
 * or the stability reader could not see a shift at all. The phone reads back a
 * taller control block than the desktop, so the height reader tells rows apart.
 * Two different bars must give two different tooltips, or the tooltip is a
 * constant. A pointer that leaves must close the tooltips it opened.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding } from './helpers';

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

/** How many days of diary the fixture writes, ending today. */
const HISTORY_DAYS = 40;

/** A desktop gives the page a column at least this wide, against the 672 px it had. */
const DESKTOP_PAGE_MIN_PX = 1000;

/** The control block on a desktop is one row: a select is 32 px and the range strip about 36. */
const DESKTOP_CONTROLS_MAX_PX = 56;

/** On a phone it is two rows (two selects, then the range strip), against about 330 px before. */
const PHONE_CONTROLS_MAX_PX = 120;

/** The touch floor every control on a phone has to reach. */
const TOUCH_FLOOR_PX = 44;

/** A pixel of rounding either side of "did not move" still counts as not moved. */
const STILL_TOLERANCE_PX = 0.5;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Today's local day, shifted back by whole days, as `YYYY-MM-DD`. */
function localDay(daysAgo: number): string {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The rows `seedInsightsDevice` writes into the `foodLogs` table, one per day and meal slot. */
interface SeedFoodLog {
  readonly id: string;
  readonly name: string;
  readonly quantityGrams: number;
  readonly macros: {
    readonly carbs: number;
    readonly fiber: number;
    readonly sugars: number | null;
    readonly polyols: number;
    readonly protein: number;
    readonly fat: number;
    readonly kcal: number;
  };
  readonly mealType: 'breakfast' | 'lunch' | 'dinner';
  readonly source: 'manual';
  readonly aiEstimated: boolean;
  readonly curatedSource: null;
  readonly foodId: null;
  readonly dayKey: string;
  readonly loggedAt: number;
  readonly createdAt: number;
  readonly logBatchId: null;
}

/**
 * Writes rows into one table of the primary store and resolves when the
 * transaction has committed. The same layout every `insights-*` spec writes.
 */
async function writeTable(
  page: Page,
  key: 'foodLogs' | 'weightEntries',
  rows: readonly { id: string }[],
): Promise<void> {
  await page.evaluate(
    ({ table, entities }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells = Object.fromEntries(entities.map((entity) => [entity.id, { entity: JSON.stringify(entity) }]));
          const transaction = db.transaction('t', 'readwrite');
          transaction.objectStore('t').put({ k: table, v: cells });
          transaction.addEventListener('complete', () => {
            db.close();
            resolve();
          });
          transaction.addEventListener('error', () => {
            db.close();
            reject(new Error(`${table} could not be written`));
          });
        });
      }),
    { table: key, entities: rows },
  );
}

/**
 * A device with a target weight, forty days of three meals a day with gaps in them (so bars differ in height and
 * some days are empty), and eight weigh-ins, so every chart on the screen has something to draw.
 */
async function seedInsightsDevice(page: Page): Promise<void> {
  await completeOnboarding(page, { current: '85', target: '80' });
  const meals = ['breakfast', 'lunch', 'dinner'] as const;
  const logs: SeedFoodLog[] = [];
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
    for (const [slot, mealType] of meals.entries()) {
      if ((daysAgo + slot) % 7 === 3) continue;
      const dayKey = localDay(daysAgo);
      const id = `desktop-seed-${daysAgo}-${slot}`;
      const loggedAt = Date.parse(`${dayKey}T1${slot}:00:00Z`);
      const carbs = 4 + ((daysAgo * 7 + slot * 5) % 14);
      const protein = 18 + ((daysAgo + slot * 3) % 12);
      const fat = 10 + ((daysAgo * 3 + slot) % 9);
      logs.push({
        id,
        name: `Desktop seed ${id}`,
        quantityGrams: 100,
        macros: { carbs, fiber: 5, sugars: null, polyols: 0, protein, fat, kcal: carbs * 4 + protein * 4 + fat * 9 },
        mealType,
        source: 'manual',
        aiEstimated: false,
        curatedSource: null,
        foodId: null,
        dayKey,
        loggedAt,
        createdAt: loggedAt,
        logBatchId: null,
      });
    }
  }
  await writeTable(page, 'foodLogs', logs);
  await writeTable(
    page,
    'weightEntries',
    Array.from({ length: 8 }, (_unused, index) => {
      const dayKey = localDay(index * 6);
      const at = Date.parse(`${dayKey}T07:00:00Z`);
      return { id: `weigh-in-${index}`, dayKey, weightKg: 85 + index * 0.4, loggedAt: at, createdAt: at };
    }),
  );
}

/** Where an element's top edge is on the PAGE, so a scroll cannot pass for a move. */
async function pageTop(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
}

/** The two globals `startRecording`/`stopRecording` write onto the page's own `window` to poll from `requestAnimationFrame`. */
type RecordingWindow = typeof window & { __tops: number[][]; __recording: boolean };

/** Starts recording the page-top of two elements on every frame, until `stopRecording`. */
async function startRecording(page: Page, selectors: readonly string[]): Promise<void> {
  await page.evaluate((watched) => {
    // SAFETY: this is the test page's own window, and this function is what writes __tops/__recording onto it next.
    const win = window as RecordingWindow;
    win.__tops = [];
    win.__recording = true;
    const frame = (): void => {
      if (!win.__recording) return;
      win.__tops.push(
        watched.map((selector) => {
          const element = document.querySelector(selector);
          return element === null ? Number.NaN : element.getBoundingClientRect().top + window.scrollY;
        }),
      );
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, selectors);
}

/** Stops recording and returns, per selector, how far apart its highest and lowest recorded tops were. */
async function stopRecording(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    // SAFETY: this is the test page's own window; startRecording above is what wrote __tops/__recording onto it.
    const win = window as RecordingWindow;
    win.__recording = false;
    const columns = win.__tops[0]?.length ?? 0;
    return Array.from({ length: columns }, (_unused, column) => {
      const values = win.__tops.map((row) => row[column]).filter((value) => !Number.isNaN(value));
      return values.length === 0 ? Number.NaN : Math.max(...values) - Math.min(...values);
    });
  });
}

/** Opens one of the two select boxes by its accessible name and picks an option by its visible label. */
async function pick(page: Page, group: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: group, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const CONTROLS = '[data-slot="trend-controls"]';
const TAB_STRIP = '[data-slot="insights-tab-strip"]';

/**
 * Walks every kind of choice the chart controls offer and returns how far the controls and the tab strip moved on
 * any frame of it. Ranges 30 and 90 are in the walk because they are what wrapped the title, and a meal is in it
 * because it added the "only" line.
 */
async function walkTheControls(page: Page): Promise<{ controls: number; strip: number }> {
  await page.goto('/trends?tab=nutrition&range=14');
  await expect(page.locator(CONTROLS)).toBeVisible();
  await startRecording(page, [CONTROLS, TAB_STRIP]);
  await pick(page, EN.trends.controls.metricGroup, EN.trends.metric.calories);
  await expect(page).toHaveURL(/metric=calories/);
  await pick(page, EN.trends.controls.slotGroup, EN.add.meal.breakfast);
  await expect(page).toHaveURL(/slot=breakfast/);
  await page.locator(CONTROLS).getByRole('link', { name: EN.trends.range.month, exact: true }).click();
  await expect(page).toHaveURL(/range=30/);
  await page.locator(CONTROLS).getByRole('link', { name: EN.trends.range.threeMonths, exact: true }).click();
  await expect(page).toHaveURL(/range=90/);
  await page.locator(CONTROLS).getByRole('link', { name: EN.trends.range.week, exact: true }).click();
  await expect(page).toHaveURL(/range=7/);
  await pick(page, EN.trends.controls.metricGroup, EN.trends.metric.protein);
  await expect(page).toHaveURL(/metric=protein/);
  await pick(page, EN.trends.controls.slotGroup, EN.trends.slot.all);
  await expect(page).not.toHaveURL(/slot=/);
  await page.waitForTimeout(300);
  const [controls = Number.NaN, strip = Number.NaN] = await stopRecording(page);
  return { controls, strip };
}

/** The bounding box of the whole control block. */
async function controlsBox(page: Page): Promise<{ top: number; height: number }> {
  const box = await page.locator(CONTROLS).boundingBox();
  if (box === null) throw new Error('the control block has no box');
  return { top: box.y, height: box.height };
}

test.describe('on a desktop', () => {
  test.use({ viewport: DESKTOP, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('the page takes the room a desktop gives it, and lays cards two across', async ({ page }) => {
    await seedInsightsDevice(page);

    await page.goto('/trends?tab=nutrition&range=14');
    await expect(page.locator('[data-slot="trend-chart-card"]')).toBeVisible();
    const pageBox = await page.locator('[data-slot="insights-page"]').boundingBox();
    const chartBox = await page.locator('[data-slot="trend-chart-card"]').boundingBox();
    expect(pageBox?.width ?? 0, 'the page column').toBeGreaterThan(DESKTOP_PAGE_MIN_PX);
    expect(chartBox?.width ?? 0, 'the chart card').toBeGreaterThan(DESKTOP_PAGE_MIN_PX);

    await page.goto('/trends?tab=overview');
    await expect(page.locator('[data-slot="range-summary-card"]')).toBeVisible();
    const boxes = await page
      .locator('[data-slot="insights-page"] [data-slot="card"], [data-slot="insights-page"] [data-slot$="-card"]')
      .evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect();
          return {
            top: Math.round(box.top + window.scrollY),
            left: Math.round(box.left),
            width: Math.round(box.width),
          };
        }),
      );
    const sideBySide = boxes.some((first) =>
      boxes.some((second) => second.left - first.left > 300 && Math.abs(second.top - first.top) <= 2),
    );
    expect(sideBySide, `two cards share a row on the Overview tab: ${JSON.stringify(boxes)}`).toBe(true);
  });

  test('the controls are one short row, and nothing that changes with a choice moves them', async ({ page }) => {
    await seedInsightsDevice(page);
    await page.goto('/trends?tab=nutrition&range=14');
    await expect(page.locator(CONTROLS)).toBeVisible();
    expect((await controlsBox(page)).height, 'the control block on a desktop').toBeLessThanOrEqual(
      DESKTOP_CONTROLS_MAX_PX,
    );

    const moved = await walkTheControls(page);
    expect(moved.controls, 'the controls moved on some frame of the walk').toBeLessThanOrEqual(STILL_TOLERANCE_PX);
    expect(moved.strip, 'the tab strip moved on some frame of the walk').toBeLessThanOrEqual(STILL_TOLERANCE_PX);

    // CONTROL: the reader can see a shift. A 20 px block above the controls is the failure this walk exists to catch.
    const before = await pageTop(page, CONTROLS);
    await page.locator(CONTROLS).evaluate((element) => {
      const spacer = document.createElement('div');
      spacer.style.height = '20px';
      element.parentElement?.insertBefore(spacer, element);
    });
    expect((await pageTop(page, CONTROLS)) - before, 'a 20 px spacer above the controls').toBeGreaterThanOrEqual(20);
  });

  test('every bar names its day and its figure on hover, and the axis is labelled', async ({ page }) => {
    await seedInsightsDevice(page);
    await page.goto('/trends?tab=nutrition&range=14');
    const bars = page.locator('[data-slot="trend-bar-hit"]');
    await expect(bars).toHaveCount(14);

    // OPEN ones only, and the newest: Radix keeps the tooltip it just closed in the DOM for its exit animation.
    const tooltip = page.locator('[data-slot="tooltip-content"][data-state$="open"]').last();
    await bars.nth(5).hover();
    await expect(tooltip).toBeVisible();
    const first = (await tooltip.textContent()) ?? '';
    expect(first, 'the tooltip carries the figure').toMatch(/\d+(\.\d+)? g net carbs/);
    expect(first, 'the tooltip writes the day as a person does, not as an ISO date').not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // CONTROL: a tooltip that said the same thing for every bar would pass the reads above.
    await bars.nth(6).hover();
    await expect(tooltip).not.toHaveText(first);

    // CONTROL: a pointer that leaves closes it. Radix's grace-area heuristic reads a trajectory from a sequence
    // of pointermove events, so a single teleported jump (the default) never convinces it the pointer left.
    await page.mouse.move(5, 5, { steps: 20 });
    await expect(page.locator('[data-slot="tooltip-content"][data-state$="open"]')).toHaveCount(0);

    const labels = await page.locator('[data-slot="chart-axis-label"]').allTextContents();
    expect(labels.length, `axis labels: ${labels.join(', ')}`).toBeGreaterThanOrEqual(3);
    const numbers = labels.map((label) => Number(label.replace(',', '.')));
    expect(
      numbers.every((value) => Number.isFinite(value)),
      'every axis label is a number',
    ).toBe(true);
    expect(new Set(numbers).size, 'no two axis labels repeat').toBe(numbers.length);
    expect(await page.locator('[data-slot="chart-gridline"]').count(), 'a gridline per labelled tick').toBe(
      labels.length - 1,
    );
  });

  test('the weight chart and the calorie split read out where the pointer is', async ({ page }) => {
    await seedInsightsDevice(page);
    await page.goto('/trends?tab=overview');
    const weightTooltip = page.locator('[data-slot="weight-tooltip"]');
    await expect(weightTooltip).toHaveCount(0);

    const hit = page.locator('figure button').first();
    await hit.scrollIntoViewIfNeeded();
    const box = await hit.boundingBox();
    if (box === null) throw new Error('the weight chart has no hit layer');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(weightTooltip).toBeVisible();
    await expect(weightTooltip).toContainText('kg');
    const middle = await weightTooltip.textContent();
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.5);
    await expect(weightTooltip).not.toHaveText(middle ?? '');
    const tooltipBox = await weightTooltip.boundingBox();
    expect(tooltipBox?.x ?? -1, 'the tooltip stays inside the card at the left edge').toBeGreaterThanOrEqual(0);

    // CONTROL: leaving the chart closes it.
    await page.mouse.move(5, 5);
    await expect(weightTooltip).toHaveCount(0);

    await page.goto('/trends?tab=nutrition&range=14');
    const row = page.locator('[data-slot="macro-split-row"]').first();
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await expect(page.locator('[data-slot="tooltip-content"][data-state$="open"]').last()).toContainText('%');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('the controls are two rows, each control reaches the touch floor, and nothing moves them', async ({ page }) => {
    await seedInsightsDevice(page);
    await page.goto('/trends?tab=nutrition&range=14');
    await expect(page.locator(CONTROLS)).toBeVisible();

    expect((await controlsBox(page)).height, 'the control block on a phone').toBeLessThanOrEqual(PHONE_CONTROLS_MAX_PX);

    const targets = await page
      .locator(`${CONTROLS} [role="combobox"], ${CONTROLS} a`)
      .evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
    expect(targets.length, 'two selects and four range links').toBe(6);
    expect(
      targets.filter((height) => height < TOUCH_FLOOR_PX),
      'a control shorter than the touch floor',
    ).toEqual([]);

    const moved = await walkTheControls(page);
    expect(moved.controls, 'the controls moved on some frame of the walk').toBeLessThanOrEqual(STILL_TOLERANCE_PX);
    expect(moved.strip, 'the tab strip moved on some frame of the walk').toBeLessThanOrEqual(STILL_TOLERANCE_PX);

    // CONTROL: the height reader tells one row from two. The same block on a desktop is at most 56 px tall.
    expect((await controlsBox(page)).height, 'a phone block is taller than a desktop row').toBeGreaterThan(
      DESKTOP_CONTROLS_MAX_PX,
    );

    for (const tab of ['overview', 'nutrition', 'meals', 'goals']) {
      await page.goto(`/trends?tab=${tab}&range=14`);
      await expect(page.locator(TAB_STRIP)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${tab}: the document scrolls sideways by`).toBeLessThanOrEqual(1);
    }
  });
});
