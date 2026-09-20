/**
 * The phone budget on the five screens the add-and-review loop runs through:
 * `/add`, `/dashboard`, `/meals`, `/foods`, `/describe` and `/catch-up`.
 *
 * WHY GEOMETRY AND NOT A SCREENSHOT. Headless Chromium hides scrollbars and
 * never applies `hover:`, so a row that spills past its card and a key that is
 * half the size of a thumb both look right in a picture. `scrollWidth` against
 * `clientWidth`, and a `getBoundingClientRect` against the fixed bottom bar's
 * own top edge, are the reads that see them. `insights-layout.spec.ts` makes
 * the same call for the review tabs; this spec is its counterpart on the
 * logging half of the app.
 *
 * WHY 360 PX. It is the narrowest budget this app is written against, so it is
 * the tighter, more honest fit than the project's own 390. The one check at
 * 390 x 430 is there because that is the screen a phone keyboard leaves behind
 * and it is where the `/add` submit went under the bar.
 *
 * WHY THREE LANGUAGES. Every claim below is about how much room a sentence
 * needs, and German and Turkish need more of it than English does. The
 * empty-name message is read in all three for a second reason: it is the one
 * assertion here that is about WORDS, and three different expected sentences
 * are what stop an English literal from passing.
 *
 * THE FIXTURE is seven days of logs written straight into the primary store,
 * the same IndexedDB layout `insights-layout.spec.ts` and its siblings write,
 * so the Overview draws a real ridge and offers its one-time Insights door
 * rather than an empty page a broken build could also produce.
 */
import { expect, test, type Page } from '@playwright/test';

import { catalogFor, EN } from './copy';
import { completeOnboarding, logFoodManually, useLanguage } from './helpers';

/** The narrowest phone this app is written against. */
const NARROW_PHONE_WIDTH = 360;

/** A generous height, so width is the only thing under test. */
const TALL_PHONE_HEIGHT = 844;

/** The short screen a raised keyboard leaves, and the one the audit measured `/add` on. */
const SHORT_SCREEN = { width: 390, height: 430 } as const;

/** The width at which the Overview's two glance tiles sit side by side again. */
const SIDE_BY_SIDE_WIDTH = 640;

/** The smallest thumb-sized control, in CSS pixels. */
const TOUCH_TARGET_PX = 44;

/** The smallest gap between two keys when one of them deletes something. */
const KEY_GAP_PX = 8;

/** The smallest readable type in this app, in CSS pixels. */
const MIN_TEXT_PX = 12;

/** How much width the Overview's Insights sentence needs before it stops reading as a column. */
const MIN_SENTENCE_WIDTH_PX = 200;

/** A CSS pixel of rounding either side of an exact fit still counts as a fit. */
const OVERFLOW_TOLERANCE_PX = 1;

/** How many days of diary the fixture writes, ending today. */
const HISTORY_DAYS = 7;

/** The three languages every width claim below is made in. */
const LANGUAGES = ['en', 'de', 'tr'] as const;

/** The wording Zod produces for a field it never reached, which no person may read. */
const RAW_ZOD_WORDING = /Invalid input|expected string|received undefined/;

/**
 * A saved meal named the way a person names one: long enough to need a second
 * line in the column a 360 px row leaves it, short enough that two lines hold
 * all of it. Both halves matter. A shorter name would fit on one line and
 * prove nothing about wrapping, and a longer one is genuinely cut off, because
 * two lines is where this row stops by design.
 */
const LONG_MEAL_NAME = 'Porridge with blueberries';

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** One seeded log: its day, its slot, and a known macro set. */
interface SeedLog {
  dayKey: string;
  mealType: 'breakfast' | 'dinner';
  carbs: number;
}

/**
 * Writes the logs into the primary store's `foodLogs` table on disk and
 * resolves once the transaction has committed.
 *
 * @param page - a page on the app's origin.
 * @param logs - the days to write.
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
              const id = `phone-budget-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T1${index % 3}:00:00Z`);
              return [
                id,
                {
                  entity: JSON.stringify({
                    id,
                    name: `Seed ${id}`,
                    quantityGrams: 100,
                    macros: { carbs: log.carbs, fiber: 5, sugars: null, polyols: 0, protein: 15, fat: 10, kcal: 300 },
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
            reject(new Error('the seeded logs could not be written'));
          });
        });
      }),
    logs,
  );
}

/**
 * How many saved meals are ON DISK, read straight out of IndexedDB.
 *
 * A WAIT, NEVER AN ASSERTION, for the reason `helpers.ts`'s `pantryRowsOnDisk`
 * records at length: the store saves asynchronously after the transaction that
 * changed it, so a full document load fired the instant the naming form closes
 * can beat the save and lose the meal for real. What `/meals` then draws is
 * asserted on the loaded PAGE, through the app's own read, so this probe never
 * stands in for the thing under test.
 *
 * @param page - a page on the app's origin.
 * @returns the number of rows the persisted `savedMeals` table holds.
 */
async function savedMealsOnDisk(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        // The database, the object store and the table id `persist.ts` and
        // `schema.ts` name: `openplate-primary`, TinyBase's own tables store
        // `t` with one record per table, and `SAVED_MEALS_TABLE` is
        // `savedMeals`.
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('t')) {
            db.close();
            resolve(0);
            return;
          }
          const read = db.transaction('t', 'readonly').objectStore('t').get('savedMeals');
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: TinyBase's IndexedDB persister stores one record per
            // table as `{ k, v }`, with `v` an object keyed by row id. An
            // absent record is a table nothing has saved yet.
            const record = read.result as { v?: object } | undefined;
            resolve(Object.keys(record?.v ?? {}).length);
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the saved meals could not be read'));
          });
        });
      }),
  );
}

/** Seven days of breakfasts and dinners, ending today. */
async function seedAWeekOfLogs(page: Page): Promise<void> {
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const logs: SeedLog[] = [];
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo += 1) {
    const dayKey = shiftDay(today, -daysAgo);
    logs.push({ dayKey, mealType: 'breakfast', carbs: 20 + daysAgo }, { dayKey, mealType: 'dinner', carbs: 30 });
  }
  await writeLogsToDisk(page, logs);
}

/** Opens `/add`'s manual form and returns the form itself. */
async function openManualForm(page: Page, locale: (typeof LANGUAGES)[number]) {
  const catalog = catalogFor(locale);
  await page.goto('/add');
  await page.getByRole('button', { name: catalog.add.search.addManually }).click();
  return page.locator('form').filter({ has: page.locator('input[name="_intent"][value="manual"]') });
}

/**
 * The highest edge of everything the fixed bottom bar draws, including the
 * raised camera circle that overhangs it. Content below this line is covered.
 *
 * THE BAR IS FOUND BY ITS POSITION, not by a class name or a test id: "the one
 * `nav` that does not scroll with the page" is what the clearance is about,
 * and `bottom-nav.tsx`'s own doc calls that `fixed` placement a contract.
 *
 * @param page - a page wearing the app shell.
 * @returns the bar's top edge in viewport pixels.
 */
async function fixedBarTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bars = [...document.querySelectorAll('nav')].filter(
      (element) => getComputedStyle(element).position === 'fixed',
    );
    let top = Number.POSITIVE_INFINITY;
    for (const bar of bars) {
      top = Math.min(top, bar.getBoundingClientRect().top);
      for (const child of bar.querySelectorAll('*')) {
        const rect = child.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) top = Math.min(top, rect.top);
      }
    }
    return Math.round(top);
  });
}

////////////////////////////////////////////////////////////////////////////////
// /add: the words a refused field says, and the size of the keys beside it
////////////////////////////////////////////////////////////////////////////////

test('the manual food form asks for a name in the reader own language', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: TALL_PHONE_HEIGHT });

  for (const locale of LANGUAGES) {
    const catalog = catalogFor(locale);
    await useLanguage(page, locale);
    const manual = await openManualForm(page, locale);

    // Grams filled, name left alone: Conform drops an empty input before the
    // schema sees it, which is the state the raw wording came out of.
    await manual.locator('input[name="quantityGrams"]').fill('100');
    await manual.getByRole('button', { name: catalog.add.manual.submit }).click();

    const describedBy = await manual.locator('input[name="name"]').getAttribute('aria-describedby');
    expect(describedBy, `${locale}: the refused name field must point at its own message`).not.toBeNull();
    const message = (await page.locator(`#${describedBy}`).innerText()).trim();

    ////////////////////////////////////////////////////////////////////////
    // THE CLAIM, and its own control: three languages, three different
    // expected sentences, so an English literal cannot pass all three.
    ////////////////////////////////////////////////////////////////////////
    expect(message, `${locale}: the empty name must be refused in the reader own words`).toBe(
      catalog.add.errors.nameRequired,
    );
    await expect(
      page.getByText(RAW_ZOD_WORDING),
      `${locale}: no part of the page may read the schema wording out loud`,
    ).toHaveCount(0);

    ////////////////////////////////////////////////////////////////////////
    // The two controls beside it. The grams field was already 44 px and the
    // picker beside it was 36, which is what made the pair look broken.
    ////////////////////////////////////////////////////////////////////////
    const select = await manual.locator('[data-slot="select-trigger"]').boundingBox();
    const submit = await manual.getByRole('button', { name: catalog.add.manual.submit }).boundingBox();
    expect(Math.round(select?.height ?? 0), `${locale}: the meal picker must take a thumb`).toBeGreaterThanOrEqual(
      TOUCH_TARGET_PX,
    );
    expect(Math.round(submit?.height ?? 0), `${locale}: the submit must take a thumb`).toBeGreaterThanOrEqual(
      TOUCH_TARGET_PX,
    );
  }
});

test('the Add entry button is reachable and clear of the bottom bar on a short screen', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize(SHORT_SCREEN);

  const manual = await openManualForm(page, 'en');
  await manual.locator('input[name="name"]').focus();
  const submit = manual.getByRole('button', { name: EN.add.manual.submit });

  ////////////////////////////////////////////////////////////////////////////
  // MEASURED AT THE END OF THE PAGE, not at whatever scroll position the tap
  // that opened the form happened to leave behind: where a browser scrolls to
  // on a tap is the browser's decision, and what this app decides is how much
  // room it keeps under its last control. So the claim is that scrolling down
  // reaches the submit whole, with the bar off it. A page that reserved
  // nothing under the fixed bar goes red here.
  ////////////////////////////////////////////////////////////////////////////
  //
  // THE FIELD IS LEFT FIRST. On a screen this short the bottom bar steps aside
  // while a text field has focus (`app-wrapper.tsx`, SET-04), so a reading
  // taken mid-typing would measure the clearance against a bar that is not
  // drawn. Reaching for Add is the moment after typing, which is this state.
  await manual.locator('input[name="name"]').blur();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const barTop = await fixedBarTop(page);
  const scrolled = await submit.boundingBox();
  expect(scrolled, 'the submit must have a box to measure').not.toBeNull();
  expect(barTop, 'the fixed bottom bar must be drawn to measure against').toBeGreaterThan(0);
  expect(barTop, 'the fixed bottom bar must be on the screen to measure against').toBeLessThan(SHORT_SCREEN.height);
  expect(
    Math.round(scrolled?.y ?? -1),
    `the submit must be inside the ${SHORT_SCREEN.height} px screen`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    Math.round((scrolled?.y ?? 0) + (scrolled?.height ?? 0)),
    'and must end above everything the bottom bar draws',
  ).toBeLessThanOrEqual(barTop);
});

////////////////////////////////////////////////////////////////////////////////
// /dashboard: the week card's sentence, and the two glance tiles
////////////////////////////////////////////////////////////////////////////////

test('the Overview week card and its ridge fit a 360 px phone in three languages', async ({ page }) => {
  await completeOnboarding(page);
  await seedAWeekOfLogs(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: TALL_PHONE_HEIGHT });

  for (const locale of LANGUAGES) {
    await useLanguage(page, locale);
    await page.goto('/dashboard');

    ////////////////////////////////////////////////////////////////////////
    // THE CONTROL AGAINST A VACUOUS PASS: both things measured below are on
    // the screen, so a page that drew neither could not pass by drawing
    // nothing.
    ////////////////////////////////////////////////////////////////////////
    const weekCard = page.locator('[data-slot="week-glance-card"]');
    const hint = page.locator('[data-slot="insights-hint"]');
    await expect(weekCard).toBeVisible();
    await expect(hint).toBeVisible();

    const sentence = await hint.locator('p').first().boundingBox();
    expect(
      Math.round(sentence?.width ?? 0),
      `${locale}: the Insights sentence must have the card width, not a column beside its keys`,
    ).toBeGreaterThanOrEqual(MIN_SENTENCE_WIDTH_PX);

    const keyHeights = await hint
      .locator('a, button')
      .evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
    expect(keyHeights.length, `${locale}: the Insights card must offer its two keys`).toBe(2);
    for (const height of keyHeights) {
      expect(height, `${locale}: every key on the Insights card must take a thumb`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PX,
      );
    }

    ////////////////////////////////////////////////////////////////////////
    // THE RIDGE'S WEEKDAY ROW: seven short weekday names, which ran past the
    // card edge in English and in Turkish at half a phone's width.
    ////////////////////////////////////////////////////////////////////////
    const weekdays = page.locator('[data-slot="day-ridge-weekdays"]');
    await expect(weekdays).toBeVisible();
    const row = await weekdays.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      right: Math.round(element.getBoundingClientRect().right),
      widestLabelRight: Math.max(
        ...[...element.children].map((child) => Math.round(child.getBoundingClientRect().right)),
      ),
    }));
    expect(
      row.scrollWidth,
      `${locale}: the weekday row needs ${row.scrollWidth} px and was given ${row.clientWidth}`,
    ).toBeLessThanOrEqual(row.clientWidth + OVERFLOW_TOLERANCE_PX);
    expect(row.widestLabelRight, `${locale}: no weekday may end past the row it sits in`).toBeLessThanOrEqual(
      row.right + OVERFLOW_TOLERANCE_PX,
    );
    expect(row.fontSize, `${locale}: the weekday names must be readable type`).toBeGreaterThanOrEqual(MIN_TEXT_PX);

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  }
});

test('the two Overview tiles draw the same height once they sit side by side', async ({ page }) => {
  await completeOnboarding(page);
  await seedAWeekOfLogs(page);
  await page.setViewportSize({ width: SIDE_BY_SIDE_WIDTH, height: TALL_PHONE_HEIGHT });
  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="week-glance-card"]')).toBeVisible();

  ////////////////////////////////////////////////////////////////////////////
  // THE CARDS, not the links around them: the grid stretches the link and
  // stops there, so a check on the outer element would pass against the very
  // mismatch this is about.
  ////////////////////////////////////////////////////////////////////////////
  const heights = await page.evaluate(() => {
    const week = document.querySelector('[data-slot="week-glance-card"]');
    const row = week?.parentElement ?? null;
    if (row === null) return null;
    return [...row.children].map((cell) => ({
      link: Math.round(cell.getBoundingClientRect().height),
      card: Math.round((cell.firstElementChild ?? cell).getBoundingClientRect().height),
    }));
  });
  expect(heights, 'the glance row must hold two tiles').toHaveLength(2);
  expect(heights?.[0]?.link, 'the two tiles must share one row').toBe(heights?.[1]?.link);
  expect(heights?.[0]?.card, `the two cards measured ${JSON.stringify(heights)}`).toBe(heights?.[1]?.card);
});

////////////////////////////////////////////////////////////////////////////////
// /meals and /foods: the rows a person edits and deletes from
////////////////////////////////////////////////////////////////////////////////

test('a saved meal keeps its whole name, and its keys take a thumb', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: TALL_PHONE_HEIGHT });

  await logFoodManually(page, { name: 'Phone budget porridge', grams: '100', carbs: '20', mealType: 'breakfast' });
  await page.goto('/diary');
  await page.getByRole('button', { name: EN.diary.saveMeal.trigger }).first().click();
  await page.getByRole('textbox', { name: EN.diary.saveMeal.namePlaceholder }).fill(LONG_MEAL_NAME);
  await page.getByRole('button', { name: EN.diary.saveMeal.save, exact: true }).click();
  await expect
    .poll(() => savedMealsOnDisk(page), { message: 'the meal must reach disk before the page reloads' })
    .toBe(1);

  await page.goto('/meals');
  const name = page.locator('[data-slot="saved-meal-name"]').first();
  await expect(name).toBeVisible();

  const read = await name.evaluate((element) => ({
    text: element.textContent ?? '',
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    height: Math.round(element.getBoundingClientRect().height),
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));

  ////////////////////////////////////////////////////////////////////////////
  // THE CLAIM: this name needs two lines at 360 px and gets them, whole. The
  // line count is asserted BOTH ways: a name still held on one line has been
  // cut short, and one that overflows its box has been clipped.
  ////////////////////////////////////////////////////////////////////////////
  expect(read.text, 'the row must show the name that was typed').toBe(LONG_MEAL_NAME);
  expect(
    read.height,
    `the name drew ${read.height} px on a ${read.lineHeight} px line and must take two`,
  ).toBeGreaterThanOrEqual(Math.round(read.lineHeight * 2));
  expect(read.scrollHeight, 'no part of the name may be cut off below the box').toBeLessThanOrEqual(read.clientHeight);
  expect(read.scrollWidth, 'nor past its right edge').toBeLessThanOrEqual(read.clientWidth + OVERFLOW_TOLERANCE_PX);

  const keys = await page
    .locator('[data-slot="saved-meal-row"] button')
    .evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
  expect(keys.length, 'the row must offer both its keys').toBe(2);
  for (const height of keys) {
    expect(height, 'every key on a saved meal row must take a thumb').toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }
});

test('Your foods keeps Edit and Remove a thumb wide and a thumb apart', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: TALL_PHONE_HEIGHT });

  await logFoodManually(page, { name: 'Phone budget tahini', grams: '100', carbs: '12' });
  await page.goto('/foods');
  const row = page.locator('[data-slot="custom-food-row"]').first();
  await expect(row).toBeVisible();

  const keys = await row.locator('button').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') ?? '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      };
    }),
  );

  ////////////////////////////////////////////////////////////////////////////
  // THE CLAIM: two keys, both a thumb, with room between them. The right one
  // deletes a food, which is why the gap is asserted and not only the size.
  ////////////////////////////////////////////////////////////////////////////
  expect(keys.length, 'the row must offer Edit and Remove').toBe(2);
  for (const key of keys) {
    expect(key.width, `${key.label} measured ${key.width} px wide`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    expect(key.height, `${key.label} measured ${key.height} px tall`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }
  const gap = (keys[1]?.left ?? 0) - (keys[0]?.right ?? 0);
  expect(gap, `the two keys sat ${gap} px apart`).toBeGreaterThanOrEqual(KEY_GAP_PX);
});

////////////////////////////////////////////////////////////////////////////////
// /describe and /catch-up
////////////////////////////////////////////////////////////////////////////////

test('the describe screen names itself once, and the catch-up eyebrow has room', async ({ page }) => {
  await completeOnboarding(page);
  await seedAWeekOfLogs(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: TALL_PHONE_HEIGHT });

  await page.goto('/describe');
  await expect(page.locator('textarea#describe-meal')).toBeVisible();
  const headings = await page.locator('h1').allInnerTexts();
  expect(headings, `the page carried these level-one headings: ${JSON.stringify(headings)}`).toHaveLength(1);

  await page.goto('/catch-up');
  const rows = page.locator('[data-slot="yesterday-rows"]');
  await expect(rows).toBeVisible();

  ////////////////////////////////////////////////////////////////////////////
  // THE CLAIM: the eyebrow is a label FOR the rows under it, so it needs a
  // gap it can be read across. It sat flush on the first row.
  ////////////////////////////////////////////////////////////////////////////
  const gap = await rows.evaluate((element) => {
    const eyebrow = element.firstElementChild;
    const firstRow = element.lastElementChild?.querySelector('li') ?? null;
    if (eyebrow === null || firstRow === null) return null;
    return Math.round(firstRow.getBoundingClientRect().top - eyebrow.getBoundingClientRect().bottom);
  });
  expect(gap, `the eyebrow sat ${gap} px above the first row`).toBeGreaterThanOrEqual(KEY_GAP_PX);
});

////////////////////////////////////////////////////////////////////////////////
// The first-run screens
////////////////////////////////////////////////////////////////////////////////

/** One heading, with the width of every line it drew. */
interface HeadingLines {
  text: string;
  widths: number[];
}

/**
 * Every heading on the page, measured line by line through a `Range` over its
 * own text, which is the only read that says where a browser put the breaks.
 *
 * @param page - the page to measure.
 * @param selector - which headings to read.
 */
async function headingLines(page: Page, selector: string): Promise<HeadingLines[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        text: (element.textContent ?? '').trim(),
        widths: [...range.getClientRects()].map((rect) => Math.round(rect.width)),
      };
    }),
  );
}

/** How narrow a wrapped heading's last line may be, as a share of its widest one. */
const MIN_LAST_LINE_SHARE = 0.3;

/**
 * The three first-run screens, and what counts as a heading on each.
 *
 * `/onboarding` and `/recover` name themselves through a card title, which is
 * a `div` and not an `h2`, so each one carries a `data-slot` its own route
 * puts there. The landing page uses real headings at three levels and its
 * section titles are where the orphans were measured.
 */
const FIRST_RUN_HEADINGS = [
  { path: '/', selector: 'h1, h2, h3' },
  { path: '/onboarding', selector: '[data-slot="onboarding-step-title"]' },
  { path: '/recover', selector: '[data-slot="recover-title"], main h2' },
] as const;

test('no first-run heading ends on a single orphan word', async ({ page }) => {
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: TALL_PHONE_HEIGHT });

  let wrappedHeadings = 0;
  for (const locale of LANGUAGES) {
    await useLanguage(page, locale);
    for (const { path, selector } of FIRST_RUN_HEADINGS) {
      await page.goto(path);
      await expect(page.locator(selector).first()).toBeVisible();
      for (const heading of await headingLines(page, selector)) {
        if (heading.widths.length < 2) continue;
        wrappedHeadings += 1;
        const widest = Math.max(...heading.widths);
        const last = heading.widths.at(-1) ?? 0;
        expect(
          last / widest,
          `${locale} ${path}: "${heading.text}" broke into ${JSON.stringify(heading.widths)}`,
        ).toBeGreaterThanOrEqual(MIN_LAST_LINE_SHARE);
      }
    }
  }

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL: the loop above is vacuously true on a run where no heading
  // wrapped at all, which is exactly what a narrower font or a shortened
  // catalog would produce.
  ////////////////////////////////////////////////////////////////////////////
  expect(wrappedHeadings, 'at least one heading has to wrap for this to be measuring anything').toBeGreaterThan(0);
});
