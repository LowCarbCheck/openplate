/**
 * The health screens on a 360px phone, in English, German and Turkish.
 *
 * WHY GEOMETRY AND NOT A SCREENSHOT. Headless Chromium hides scrollbars, so a
 * page that scrolls sideways still photographs clean, and text cut off inside
 * its own box does not move the document at all. Only `scrollWidth` against
 * `clientWidth` says "this needs more room than it was given".
 *
 * WHY THESE THREE LANGUAGES. English is the source, German is the longest of
 * the six, and Turkish is where the fasting history broke: its result sentence
 * ("16:8 hedeften 16 sa 3 dk tamamlandı") is long enough to take the whole
 * row, which pushed the delete button 83px past the card and left the start
 * date a 0px column.
 *
 * WHAT WAS MEASURED BEFORE THE FIX (audit, /tmp/op-mobile-shots/health):
 * `/fasting` in Turkish had `document.scrollWidth` 427 at every width from 320
 * to 390; 11 of 12 history dates were truncated in English at 390 and every
 * one of them in German at 360; the Insights tab strip cut three of the four
 * German labels in a strip 32px tall; the weight chart's axis labels rendered
 * 4.3px tall because a 10-unit SVG label scales with the viewBox.
 */
import { expect, test, type Page } from '@playwright/test';

import { catalogFor, EN } from './copy';
import { completeOnboarding, useLanguage } from './helpers';

/** The narrow end of the phone budget this app is written against. */
const NARROW_PHONE_WIDTH = 360;

/** A generous height, so width is the only thing under test. */
const PHONE_HEIGHT = 844;

/** A CSS pixel of rounding either side of an exact fit still counts as "fits". */
const OVERFLOW_TOLERANCE_PX = 1;

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/**
 * The smallest a chart label may render on screen.
 *
 * ON SCREEN, not in `font-size`. The weight chart's labels were `text-[10px]`
 * inside a viewBox scaled to 43% of its declared width, so the computed style
 * said 10px and the glyphs were 4.3px tall. A bounding box is the only read
 * that knows the difference.
 */
const MIN_RENDERED_LABEL_PX = 10;

/** The languages this walk renders in. */
const LOCALES = ['en', 'de', 'tr'] as const;

/** How many days of diary the chart fixture writes, ending today. */
const HISTORY_DAYS = 14;

/** One seeded fast: how long ago it started, how long it ran, and how it felt. */
interface SeedFast {
  daysAgo: number;
  hours: number;
  mood: 'good' | 'ok' | 'rough';
}

/** Three finished fasts, one per mood word, because the mood is what filled the row. */
const SEED_FASTS: readonly SeedFast[] = [
  { daysAgo: 2, hours: 16, mood: 'good' },
  { daysAgo: 4, hours: 16, mood: 'ok' },
  { daysAgo: 6, hours: 16, mood: 'rough' },
];

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Writes rows into one of the primary store's tables on disk and resolves once
 * the transaction has committed. The same IndexedDB layout every `insights-*`
 * spec writes (see `insights-layout.spec.ts`): one cell per row, holding the
 * entity as JSON text.
 *
 * @param page - the page whose origin owns the database.
 * @param table - the store table to write, for example `fasts`.
 * @param entities - the rows, each carrying its own `id`.
 */
async function writeTableToDisk(
  page: Page,
  table: string,
  entities: readonly { readonly id: string }[],
): Promise<void> {
  await page.evaluate(
    ({ tableName, rows }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells = Object.fromEntries(rows.map((row) => [row.id, { entity: JSON.stringify(row) }]));
          const transaction = db.transaction('t', 'readwrite');
          transaction.objectStore('t').put({ k: tableName, v: cells });
          transaction.addEventListener('complete', () => {
            db.close();
            resolve();
          });
          transaction.addEventListener('error', () => {
            db.close();
            reject(new Error(`the ${tableName} rows could not be written`));
          });
        });
      }),
    { tableName: table, rows: entities },
  );
}

/** One element's own measurement, with enough of its text to name it in a failure message. */
interface Reading {
  what: string;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Every element matched by `selector` whose content needs more width than it
 * was given, at a pixel of slack for sub-pixel rounding.
 *
 * @param page - the page to measure.
 * @param selector - what to measure.
 * @returns the offenders, empty when everything fits.
 */
async function clippedElements(page: Page, selector: string): Promise<Reading[]> {
  return page.locator(selector).evaluateAll(
    (elements, tolerance) =>
      elements
        .map((element) => ({
          what: (element.textContent ?? '').trim().slice(0, 40),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }))
        .filter((reading) => reading.scrollWidth > reading.clientWidth + tolerance),
    OVERFLOW_TOLERANCE_PX,
  );
}

/** One control that is smaller than a fingertip, named by whatever a reader would call it. */
interface TargetReading {
  what: string;
  width: number;
  height: number;
}

/**
 * Every element matched by `selector` whose box is under the touch floor in
 * either direction.
 *
 * @param page - the page to measure.
 * @param selector - the controls to read.
 * @returns the offenders, empty when every one of them is big enough.
 */
async function smallTargets(page: Page, selector: string): Promise<TargetReading[]> {
  return page.locator(selector).evaluateAll(
    (elements, floor) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            what: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        })
        .filter((reading) => reading.height + 0.5 < floor || reading.width + 0.5 < floor),
    TOUCH_TARGET_PX,
  );
}

/** One label that renders too small to read, with the height it actually drew at. */
interface LabelReading {
  what: string;
  height: number;
}

/**
 * Every element matched by `selector` whose ON SCREEN box is shorter than a
 * readable label. A box of zero is skipped: the day axis hides every second
 * label on a narrow phone on purpose, and a hidden box measures nothing.
 *
 * @param page - the page to measure.
 * @param selector - the labels to read.
 * @returns the unreadable ones, empty when every visible label has height.
 */
async function tinyLabels(page: Page, selector: string): Promise<LabelReading[]> {
  return page.locator(selector).evaluateAll(
    (elements, floor) =>
      elements
        .map((element) => ({
          what: (element.textContent ?? '').trim(),
          height: Number(element.getBoundingClientRect().height.toFixed(1)),
        }))
        .filter((reading) => reading.height > 0 && reading.height < floor),
    MIN_RENDERED_LABEL_PX,
  );
}

/** The right edge of every element matched by `selector`, rounded to whole pixels. */
async function rightEdges(page: Page, selector: string): Promise<number[]> {
  return page
    .locator(selector)
    .evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().right)));
}

/** A device past onboarding, at the narrow phone width. */
async function openNarrowPhone(page: Page): Promise<void> {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });
}

/** `HISTORY_DAYS` of one logged lunch a day, ending today, so both charts have bars. */
async function seedDiary(page: Page): Promise<void> {
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await writeTableToDisk(
    page,
    'foodLogs',
    Array.from({ length: HISTORY_DAYS }, (_unused, index) => {
      const dayKey = shiftDay(today, -index);
      const loggedAt = Date.parse(`${dayKey}T12:00:00Z`);
      return {
        id: `health-seed-${index}`,
        name: `Seed ${index}`,
        quantityGrams: 100,
        macros: {
          carbs: 20 + index,
          fiber: 5,
          sugars: null,
          polyols: 0,
          protein: 20,
          fat: 10,
          kcal: (20 + index) * 4 + 20 * 4 + 10 * 9,
        },
        mealType: 'lunch',
        source: 'manual',
        aiEstimated: false,
        curatedSource: null,
        foodId: null,
        dayKey,
        loggedAt,
        createdAt: loggedAt,
        logBatchId: null,
      };
    }),
  );
}

test('the fasting history fits a 360px phone in English, German and Turkish', async ({ page }) => {
  await openNarrowPhone(page);

  const now = Date.now();
  await writeTableToDisk(
    page,
    'fasts',
    SEED_FASTS.map((fast, index) => {
      const startedAt = now - fast.daysAgo * 24 * 60 * 60 * 1000;
      return {
        id: `seed-fast-${index}`,
        protocolId: '16:8',
        targetDurationMs: 16 * 60 * 60 * 1000,
        plannedStartAt: null,
        startedAt,
        endedAt: startedAt + fast.hours * 60 * 60 * 1000,
        createdAt: startedAt,
        mood: fast.mood,
        note: null,
      };
    }),
  );

  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    await page.goto('/fasting');

    //////////////////////////////////////////////////////////////////////////
    // THE CONTROL AGAINST A VACUOUS PASS: the rows this walk measures are on
    // screen. Without it, a page that rendered no history at all would clip
    // nothing and overflow nothing, and pass every assertion below.
    //////////////////////////////////////////////////////////////////////////
    const rows = page.locator('[data-slot="fast-history-row"]');
    await expect(rows, `${locale}: the seeded fasts must be listed`).toHaveCount(SEED_FASTS.length);

    //////////////////////////////////////////////////////////////////////////
    // THE CLAIM: nothing on this page asks for more width than the phone has,
    // and the start date of every fast is readable in full.
    //////////////////////////////////////////////////////////////////////////
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
        message: `${locale}: /fasting must not scroll sideways`,
      })
      .toBe(NARROW_PHONE_WIDTH);

    const dates = page.locator('[data-slot="fast-history-date"]');
    await expect(dates, `${locale}: every row must name its own start`).toHaveCount(SEED_FASTS.length);
    expect(await clippedElements(page, '[data-slot="fast-history-date"]'), `${locale}: a date is cut off`).toEqual([]);

    //////////////////////////////////////////////////////////////////////////
    // THE DELETE BUTTONS: inside the screen that holds them, and big enough to
    // hit. In Turkish they used to sit at x 341 to 427 on a 360px phone.
    //////////////////////////////////////////////////////////////////////////
    expect(
      await smallTargets(page, '[data-slot="fast-history-row"] button'),
      `${locale}: a history control is under ${TOUCH_TARGET_PX}px`,
    ).toEqual([]);
    expect(
      (await rightEdges(page, '[data-slot="fast-history-row"] button')).filter((right) => right > NARROW_PHONE_WIDTH),
      `${locale}: a delete button left the screen`,
    ).toEqual([]);
  }
});

test('the Insights controls fit a 360px phone and name the 90 day window in the reader\'s language', async ({
  page,
}) => {
  await openNarrowPhone(page);
  await seedDiary(page);

  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    await page.goto('/trends?tab=nutrition&range=7');

    const strip = page.locator('[data-slot="insights-tab-strip"]');
    await expect(strip.getByRole('tab'), `${locale}: the tab strip must offer four sections`).toHaveCount(4);

    //////////////////////////////////////////////////////////////////////////
    // THE CLAIM: no navigation label is cut, and every tab is a 44px target.
    // Three of the four German labels used to end in an ellipsis.
    //////////////////////////////////////////////////////////////////////////
    expect(
      await clippedElements(page, '[data-slot="insights-tab-strip"] [role="tab"]'),
      `${locale}: a tab label is cut off`,
    ).toEqual([]);
    expect(
      await smallTargets(page, '[data-slot="insights-tab-strip"] [role="tab"]'),
      `${locale}: a tab is under ${TOUCH_TARGET_PX}px`,
    ).toEqual([]);

    //////////////////////////////////////////////////////////////////////////
    // THE CHIPS: 44px targets, and the 90 day one reads in this language. It
    // shipped as the literal "3 months" in all five translated catalogs.
    //////////////////////////////////////////////////////////////////////////
    const metricChips = page.locator('[data-slot="trend-metric-controls"] a');
    await expect(metricChips.first(), `${locale}: the metric chips must be drawn`).toBeVisible();
    expect(await smallTargets(page, '[data-slot="trend-metric-controls"] a'), `${locale}: a metric chip is small`).toEqual(
      [],
    );
    expect(await smallTargets(page, '[data-slot="trend-slot-controls"] a'), `${locale}: a meal chip is small`).toEqual(
      [],
    );

    const threeMonths = catalogFor(locale).trends.range.threeMonths;
    if (locale !== 'en') {
      expect(threeMonths, `${locale}: the 90 day chip must not still be the English words`).not.toBe(
        EN.trends.range.threeMonths,
      );
    }
    await expect(
      page.getByRole('link', { name: threeMonths, exact: true }),
      `${locale}: the 90 day chip must be on screen in this language`,
    ).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
        message: `${locale}: the Insights chart tab must not scroll sideways`,
      })
      .toBe(NARROW_PHONE_WIDTH);
  }
});

test('every chart label is at least 10px tall on a 360px phone', async ({ page }) => {
  await openNarrowPhone(page);
  await seedDiary(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await writeTableToDisk(
    page,
    'weightEntries',
    Array.from({ length: 4 }, (_unused, index) => {
      const dayKey = shiftDay(today, -index * 3);
      return {
        id: `weigh-in-${index}`,
        dayKey,
        weightKg: 84 + index,
        loggedAt: Date.parse(`${dayKey}T07:00:00Z`),
        createdAt: Date.parse(`${dayKey}T07:00:00Z`),
      };
    }),
  );

  await page.goto('/trends?tab=overview');
  //////////////////////////////////////////////////////////////////////////////
  // NON-VACUITY: a chart that drew no axis at all would pass a "nothing is too
  // small" check while proving nothing.
  //////////////////////////////////////////////////////////////////////////////
  const axisLabels = page.locator('[data-slot="weight-axis-label"]');
  await expect(axisLabels.first(), 'the weight chart must draw an axis').toBeVisible();
  expect(await tinyLabels(page, '[data-slot="weight-axis-label"]'), 'a weight axis label is unreadable').toEqual([]);

  await page.goto('/trends?tab=nutrition&range=14');
  // `:visible`, because at fourteen bars the axis prints every second day on a
  // phone and counts back from the newest, so the oldest label is hidden.
  const dayLabels = page.locator('[data-slot="chart-day-label"]:visible');
  await expect
    .poll(() => dayLabels.count(), { message: 'the bar chart must draw a day axis' })
    .toBeGreaterThan(3);
  expect(await tinyLabels(page, '[data-slot="chart-day-label"]'), 'a day label is unreadable').toEqual([]);
});
