/**
 * The diary on the narrowest phone this app is written against (2026-09-20).
 *
 * A mobile audit measured `/diary` at 320, 360 and 390 px in English, German
 * and Turkish and found five things that only geometry can see. This spec is
 * the regression guard for each of them, and every check here was run against
 * the code BEFORE its fix and went red:
 *
 * 1. The page scrolled sideways. A quick-add chip for a long food name drew
 *    601 px of button in a 358 px column, because the chip's `<form>` is the
 *    flex item and had no `min-w-0`, so the button's own `max-w-full` measured
 *    against an unbounded parent.
 * 2. The "next day" arrow sat off the right edge of the screen on any past
 *    day: the date bar wanted 383 px of a 328 px row, and in German it wanted
 *    more.
 * 3. The day card's five meters were five different lengths, because each one
 *    lived in a column that sized itself to the number beside it.
 * 4. The header's status line left a single word alone on a second line.
 * 5. A meal's subtotal pill said "0 g net carbs" over rows that each said
 *    "net carbs unknown".
 *
 * WHY GEOMETRY AND NOT A SCREENSHOT, and why 360 px: the same two reasons
 * `insights-layout.spec.ts` gives at length. Headless Chromium hides
 * scrollbars, so a page that scrolls sideways still photographs clean; and 360
 * is the narrow end of this app's budget, so it is the honest fit.
 *
 * THE FIXTURE is written straight into the primary store, the same IndexedDB
 * layout `insights-layout.spec.ts` writes, because this spec needs a food name
 * no one would type and an entry with genuinely unrecorded carbs, and the real
 * add form cannot produce the second one in one pass. The GOALS still go
 * through the real settings form, because the meters under test only exist
 * when a goal does.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { EN } from './copy';
import { completeOnboarding, HEADER_HEIGHT, useLanguage } from './helpers';

/** The narrow end of the phone budget, the width every reading below is taken at. */
const NARROW_PHONE_WIDTH = 360;

/** A generous height, so width is the only thing under test. */
const NARROW_PHONE_HEIGHT = 844;

/** A CSS pixel of rounding either side of an exact fit still counts as "fits". */
const OVERFLOW_TOLERANCE_PX = 1;

/** The three languages the audit walked: English, the longest common bundle, and the one with the longest macro words. */
const LOCALES: readonly LanguageCode[] = ['en', 'de', 'tr'];

/** The net-carbs ceiling saved through the real settings form, in grams. */
const NET_CARBS_CEILING_G = 100;

/** The protein floor saved through the real settings form, in grams. */
const PROTEIN_FLOOR_G = 60;

/**
 * A food name long enough to overflow the column on its own. 62 characters,
 * which is about what a curated database row for a branded product reads like
 * once its brand, variety and pack size are all in the name.
 */
const LONG_FOOD_NAME = 'Organic sprouted pumpkin seed and sunflower protein crispbread';

/** A short name, so the header status it publishes fits on one line with room to spare. */
const SHORT_FOOD_NAME = 'Egg';

/** How many times a food must be logged before the diary offers it as a quick-add chip (`MIN_CHIP_TIMES_LOGGED`). */
const LOGS_PER_CHIP_FOOD = 2;

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** One seeded entry: which day and slot it lands in, what it is called, and what is known about it. */
interface SeedLog {
  dayKey: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  name: string;
  /** Grams of carbohydrate, or null for an entry whose carbs were never recorded. */
  carbs: number | null;
}

/**
 * Writes the entries into the primary store's `foodLogs` table on disk and
 * resolves once the transaction has committed. Same layout every `insights-*`
 * spec writes; see `insights-layout.spec.ts` for the original.
 *
 * @param page - the page whose origin owns the database.
 * @param logs - the entries to write, in any order.
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
              const id = `mobile-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T1${index % 3}:00:00Z`);
              return [
                id,
                {
                  entity: JSON.stringify({
                    id,
                    name: log.name,
                    quantityGrams: 100,
                    macros: {
                      carbs: log.carbs,
                      fiber: log.carbs === null ? null : 4,
                      sugars: null,
                      polyols: 0,
                      protein: log.carbs === null ? null : 18,
                      fat: log.carbs === null ? null : 9,
                      kcal: log.carbs === null ? null : 240,
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
 * this spec measures meters, it does not audit the goals form.
 *
 * @param page - the page whose origin owns the database.
 * @returns true once both figures are stored.
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
 * Every element matched by `selector` that needs more width than it was given.
 *
 * @param page - the page to measure.
 * @param selector - the elements to read.
 * @returns one reading per offender, empty when everything fits.
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

/** The elements the diary draws that a long word or a long number can burst. */
const LAYOUT_SELECTOR =
  '[data-slot="date-nav"], [data-slot="quick-add-chip"], [data-slot="meal-group"], [data-slot="entry-facts"], [data-slot="header-status"]';

/** Every budget meter's width, rounded, in the order they are drawn. */
async function meterWidths(page: Page): Promise<number[]> {
  return page
    .locator('[data-slot="budget-track"]')
    .evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().width)));
}

/** How many lines of text one element is drawing, from its own box and its own line height. */
async function lineCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const lineHeight = Number.parseFloat(globalThis.getComputedStyle(element).lineHeight);
    return Math.round(element.getBoundingClientRect().height / lineHeight);
  });
}

/**
 * A device past onboarding, at 360 px, carrying the fixture diary and both
 * daily goals.
 *
 * @param page - a page on a device that has never been used.
 * @returns today's day key, as the device reckons it.
 */
async function seedNarrowDiary(page: Page): Promise<string> {
  await completeOnboarding(page);

  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const logs: SeedLog[] = [];
  for (let repeat = 0; repeat < LOGS_PER_CHIP_FOOD; repeat += 1) {
    logs.push(
      { dayKey: shiftDay(today, -repeat), mealType: 'breakfast', name: LONG_FOOD_NAME, carbs: 32 },
      { dayKey: shiftDay(today, -repeat), mealType: 'lunch', name: SHORT_FOOD_NAME, carbs: 1 },
    );
  }
  // The entry this spec's subtotal claim is about: logged, and with nothing
  // recorded about its carbs. It is alone in its slot, so the pill above it
  // has nothing else to add up.
  logs.push({ dayKey: today, mealType: 'snack', name: 'Unmeasured leftovers', carbs: null });
  await writeLogsToDisk(page, logs);

  await page.goto('/settings/nutrition');
  await page.locator('input[name="goalNetCarbsCeilingG"]').fill(`${NET_CARBS_CEILING_G}`);
  await page.locator('input[name="goalProteinFloorG"]').fill(`${PROTEIN_FLOOR_G}`);
  await page.getByRole('button', { name: EN.goals.save, exact: true }).click();
  await expect.poll(() => goalsOnDisk(page)).toBe(true);

  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: NARROW_PHONE_HEIGHT });
  return today;
}

test('the diary fits a 360 px phone in every language, on today and on a past day', async ({ page }) => {
  const today = await seedNarrowDiary(page);
  const yesterday = shiftDay(today, -1);

  for (const locale of LOCALES) {
    await useLanguage(page, locale);

    ////////////////////////////////////////////////////////////////////////
    // TODAY. The long-named chip is the load: without it on screen this
    // check would pass against a diary that simply has nothing wide in it.
    ////////////////////////////////////////////////////////////////////////
    await page.goto('/diary');
    const longChip = page.getByRole('button', { name: new RegExp(LONG_FOOD_NAME, 'u') });
    await expect(longChip, `${locale}: the fixture's long quick-add chip must be on screen`).toBeVisible();

    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        { message: `${locale}: /diary must not scroll sideways at ${NARROW_PHONE_WIDTH} px` },
      )
      .toBe(true);
    await expect.poll(() => overflowingElements(page, LAYOUT_SELECTOR)).toEqual([]);

    ////////////////////////////////////////////////////////////////////////
    // THE METERS. One column sized to its own number gave every row a
    // different meter; spanning both columns gives them all one length.
    ////////////////////////////////////////////////////////////////////////
    const widths = await meterWidths(page);
    expect(widths.length, `${locale}: the fixture day must draw more than one meter to compare`).toBeGreaterThan(1);
    expect(new Set(widths).size, `${locale}: every meter must be the same length, measured ${widths.join(', ')}`).toBe(
      1,
    );

    ////////////////////////////////////////////////////////////////////////
    // A PAST DAY. The date bar grows a "jump to today" control here, which
    // is what used to push the forward arrow off the right of the screen.
    ////////////////////////////////////////////////////////////////////////
    await page.goto(`/diary?date=${yesterday}`);
    const nextDay = page.locator('[data-slot="next-day"]');
    await expect(nextDay).toBeVisible();
    const arrow = await nextDay.boundingBox();
    expect(arrow, `${locale}: the next-day arrow must have a box`).not.toBeNull();
    expect(arrow?.x ?? -1, `${locale}: the next-day arrow starts off the left of the screen`).toBeGreaterThanOrEqual(0);
    expect(
      (arrow?.x ?? 0) + (arrow?.width ?? 0),
      `${locale}: the next-day arrow ends past the right of a ${NARROW_PHONE_WIDTH} px screen`,
    ).toBeLessThanOrEqual(NARROW_PHONE_WIDTH);

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    await expect.poll(() => overflowingElements(page, LAYOUT_SELECTOR)).toEqual([]);
  }
});

test('a meal subtotal never states a figure its own rows call unknown', async ({ page }) => {
  await seedNarrowDiary(page);
  await page.goto('/diary');

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL: the breakfast pill, over an entry whose carbs ARE recorded,
  // still states a number. Without this the claim below would also pass
  // against a pill that had stopped saying anything at all.
  ////////////////////////////////////////////////////////////////////////////
  const known = page.locator('[data-slot="meal-group"][data-meal="breakfast"] [data-slot="meal-subtotal"]');
  await expect(known).toBeVisible();
  expect(await known.innerText(), 'a meal of recorded entries must still state its subtotal').toMatch(/\d/u);

  ////////////////////////////////////////////////////////////////////////////
  // THE CLAIM: the snack pill, over the one entry with no carbs recorded,
  // states no figure at all. A digit there is the "0 g net carbs" defect, in
  // any language, without pinning a translated sentence.
  ////////////////////////////////////////////////////////////////////////////
  const unknown = page.locator('[data-slot="meal-group"][data-meal="snack"] [data-slot="meal-subtotal"]');
  await expect(unknown).toBeVisible();
  const unknownText = await unknown.innerText();
  expect(unknownText, 'a meal whose every entry is unknown must not invent a subtotal figure').not.toMatch(/\d/u);
  expect(unknownText.trim().length, 'the pill must still say something').toBeGreaterThan(0);
});

test('the header status draws one line for a message that fits', async ({ page }) => {
  await seedNarrowDiary(page);
  const statusText = page.locator('[data-slot="header-status"] output span span').first();

  ////////////////////////////////////////////////////////////////////////////
  // THE CLAIM: a short confirmation is one line in a header that never grows.
  ////////////////////////////////////////////////////////////////////////////
  await page.goto('/diary');
  await page.getByRole('button', { name: new RegExp(SHORT_FOOD_NAME, 'u') }).first().click();
  await expect(statusText).toBeVisible();
  await expect.poll(() => lineCount(statusText)).toBe(1);
  expect(
    await statusText.evaluate((element) => globalThis.getComputedStyle(element).getPropertyValue('text-wrap-style')),
    'the status text must balance its lines rather than orphan the last word',
  ).toBe('balance');

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL: the same measurement on a message too long for one line
  // reads more than one, so the check above is a reading and not a constant.
  // A reload first, because two adds inside four seconds collapse into one
  // batched "Added 2 foods", which would be short again.
  ////////////////////////////////////////////////////////////////////////////
  await page.goto('/diary');
  await page.getByRole('button', { name: new RegExp(LONG_FOOD_NAME, 'u') }).first().click();
  await expect(statusText).toBeVisible();
  await expect.poll(() => lineCount(statusText)).toBeGreaterThan(1);

  ////////////////////////////////////////////////////////////////////////////
  // Either way the header itself is the fixed height the status channel is
  // allowed to write into.
  ////////////////////////////////////////////////////////////////////////////
  await expect
    .poll(async () => {
      const box = await page.locator('header').first().boundingBox();
      return box === null ? null : Math.round(box.height);
    })
    .toBe(HEADER_HEIGHT);
});
