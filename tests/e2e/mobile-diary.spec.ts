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

/**
 * The narrowest screen the audit walked. The calendar is measured HERE and not
 * at 360: at 360 the panel is 266 px under a trigger near the middle of the
 * row and never comes near an edge, so a check there says nothing about the
 * collision rule that puts it where it is.
 */
const NARROWEST_PHONE_WIDTH = 320;

/** The gutter the calendar popover must keep at each screen edge, the page's own. */
const POPOVER_GUTTER_PX = 16;

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

/**
 * Waits for the diary itself, never for the shell around it.
 *
 * `goto` resolves on `load`, which on this app is the hydrate fallback: the
 * day is drawn by a client loader reading IndexedDB. A measurement taken
 * before this returns reads a blank page and passes against nothing.
 *
 * @param page - the page that has just been sent to `/diary`.
 */
async function waitForTheDay(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="meal-group"]').first()).toBeVisible();
}

/** The app's tap floor: nothing a finger aims at may be smaller than this on a phone. */
const TAP_FLOOR_PX = 44;

/** Every box a selector draws, rounded, so a failure names the sizes rather than just "false". */
async function boxesOf(page: Page, selector: string): Promise<{ width: number; height: number }[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }),
  );
}

/** Whichever of those boxes is under the floor, so the message says which control is too small. */
function underFloor(boxes: { width: number; height: number }[]): { width: number; height: number }[] {
  return boxes.filter((box) => box.width < TAP_FLOOR_PX || box.height < TAP_FLOOR_PX);
}

/**
 * One selector's reading. `hasAny` is in the same object as `tooSmall` on
 * purpose: both have to be right at the SAME instant, or a check that
 * happened to look at an unrendered page would report "nothing too small".
 */
interface TapReading {
  hasAny: boolean;
  tooSmall: { width: number; height: number }[];
}

/**
 * A POLLED reading, because a first visit registers the service worker and
 * reloads once: a single `evaluateAll` can land on the instant the old
 * document is gone and read zero of everything.
 *
 * @param page - the page to measure.
 * @param selector - the controls to read.
 * @returns the count and the offenders.
 */
async function tapReading(page: Page, selector: string): Promise<TapReading> {
  const boxes = await boxesOf(page, selector);
  return { hasAny: boxes.length > 0, tooSmall: underFloor(boxes) };
}

test('every control the diary offers a finger is at least 44 px', async ({ page }) => {
  await seedNarrowDiary(page);
  await page.goto('/diary');
  await waitForTheDay(page);

  for (const [name, selector] of [
    ['a day in the week strip', '[data-slot="habit-day"]'],
    ['a quick-add chip', '[data-slot="quick-add-chip"]'],
    ['the day arrows', '[data-slot="date-nav"] button, [data-slot="date-nav"] a'],
    ['the "more ways to add" chevron', 'nav [aria-haspopup="dialog"]'],
  ] as const) {
    await expect
      .poll(() => tapReading(page, selector), {
        message: `${name}: at least one must be on screen, and every one at least ${TAP_FLOOR_PX} px`,
      })
      .toEqual({ hasAny: true, tooSmall: [] });
  }

  ////////////////////////////////////////////////////////////////////////////
  // "Save as meal" keeps 28 px of ink and buys its 44 px from an `after:`
  // box, so the only honest reading is what the browser hit-tests, not what
  // the button measures. Both far corners of the intended box must reach it.
  ////////////////////////////////////////////////////////////////////////////
  const trigger = page.locator('[data-slot="save-meal-trigger"]').first();
  await expect(trigger).toBeVisible();
  // `elementFromPoint` reads VIEWPORT coordinates and answers null outside
  // them, so the button has to be on screen before its box means anything.
  await trigger.scrollIntoViewIfNeeded();
  const ink = await trigger.boundingBox();
  expect(ink, 'the save-as-meal button must have a box').not.toBeNull();
  const probes = [
    { x: (ink?.x ?? 0) + (ink?.width ?? 0) - TAP_FLOOR_PX + 1, y: (ink?.y ?? 0) - 7 },
    { x: (ink?.x ?? 0) + (ink?.width ?? 0) - 1, y: (ink?.y ?? 0) + (ink?.height ?? 0) + 7 },
  ];
  for (const probe of probes) {
    const reached = await page.evaluate((point) => {
      // Spelled out rather than `?.closest(...) !== null`: an optional chain
      // over a null `elementFromPoint` yields `undefined`, which is also not
      // null, so that one-liner passed even with no hit area at all.
      const hit = document.elementFromPoint(point.x, point.y);
      return hit !== null && hit.closest('[data-slot="save-meal-trigger"]') !== null;
    }, probe);
    expect(reached, `a tap at ${Math.round(probe.x)},${Math.round(probe.y)} must reach the save-as-meal button`).toBe(
      true,
    );
  }

  ////////////////////////////////////////////////////////////////////////////
  // Its naming form takes a row of its own, under the subtotal pill it used
  // to squeeze to 48 px and three lines.
  ////////////////////////////////////////////////////////////////////////////
  await trigger.click();
  const form = page.locator('[data-slot="save-meal-form"]');
  await expect(form).toBeVisible();
  const pill = await page.locator('[data-slot="meal-subtotal"]').first().boundingBox();
  const formBox = await form.boundingBox();
  expect(formBox?.y ?? 0, 'the naming form must sit below the subtotal pill, not beside it').toBeGreaterThanOrEqual(
    (pill?.y ?? 0) + (pill?.height ?? 0),
  );
  expect(pill?.height ?? 0, 'the subtotal pill must stay on one line while the form is open').toBeLessThan(
    TAP_FLOOR_PX,
  );
});

test('the calendar and the copy picker stay inside the page gutter', async ({ page }) => {
  const today = await seedNarrowDiary(page);

  ////////////////////////////////////////////////////////////////////////////
  // The date picker used to open flush against the left edge of the screen.
  //
  // ON A PAST DAY AND AT 320 PX, where the date bar also carries the "jump to
  // today" shortcut and the panel is wider than the room its trigger leaves.
  // Opened from today's centred trigger, or at 360, it never reaches an edge
  // at all and the check would pass however the popover was configured.
  ////////////////////////////////////////////////////////////////////////////
  await page.setViewportSize({ width: NARROWEST_PHONE_WIDTH, height: NARROW_PHONE_HEIGHT });
  await page.goto(`/diary?date=${shiftDay(today, -1)}`);
  await waitForTheDay(page);
  await page.locator('[data-slot="popover-trigger"]').first().click();
  const popover = page.locator('[data-slot="popover-content"]');
  await expect(popover).toBeVisible();
  const panel = await popover.boundingBox();
  expect(panel?.x ?? -1, 'the calendar must keep a gutter on the left').toBeGreaterThanOrEqual(
    POPOVER_GUTTER_PX - OVERFLOW_TOLERANCE_PX,
  );
  expect(
    (panel?.x ?? 0) + (panel?.width ?? 0),
    'the calendar must keep a gutter on the right',
  ).toBeLessThanOrEqual(NARROWEST_PHONE_WIDTH - POPOVER_GUTTER_PX + OVERFLOW_TOLERANCE_PX);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: NARROW_PHONE_HEIGHT });

  ////////////////////////////////////////////////////////////////////////////
  // The copy picker's rows were 28 px tall, each one a checkbox a finger has
  // to hit. Back on today, which is the day whose "yesterday" the fixture
  // gave something worth copying.
  ////////////////////////////////////////////////////////////////////////////
  await page.goto('/diary');
  await waitForTheDay(page);
  await page.locator('[data-slot="copy-choose-entries"]').click();
  await expect
    .poll(() => tapReading(page, '[data-slot="copy-entry-row"]'), {
      message: `the picker must list yesterday's entries, each at least ${TAP_FLOOR_PX} px tall`,
    })
    .toEqual({ hasAny: true, tooSmall: [] });
});

test('the entry receipt gives its star the tap floor', async ({ page }) => {
  await seedNarrowDiary(page);
  await page.goto('/diary');
  await page.locator('a[href^="/diary/entry/"]').first().click();
  await page.waitForURL('**/diary/entry/**');

  const star = page.locator('[data-slot="favorite-toggle"]');
  await expect(star).toBeVisible();
  const box = await star.boundingBox();
  expect(box, 'the favourite star must have a box').not.toBeNull();
  expect(underFloor([{ width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) }])).toEqual([]);
});

////////////////////////////////////////////////////////////////////////////////
// The day card states each figure once (2026-09-21)
////////////////////////////////////////////////////////////////////////////////

/**
 * The four cells the composition block draws under its ratio bar, one per
 * macro. A count, so a "no gram figures here" claim cannot be satisfied by
 * deleting the block.
 */
const MACRO_CELL_COUNT = 4;

/**
 * One run of card text as a reader sees it, with every run of whitespace
 * flattened to a single plain space.
 *
 * THE FLATTENING IS THE POINT, not tidiness. `formatMeasureIn` joins a figure
 * to its unit with U+00A0 while the budget rows' own catalog templates use a
 * plain space, so the two blocks printed "18 g" and "18 g" with DIFFERENT
 * bytes between the number and the unit. They render identically, which is why
 * the audit saw one figure twice, and a byte-for-byte reader would have called
 * them two different strings and passed.
 *
 * @param text - raw `textContent` from the card.
 * @returns the same text with single plain spaces.
 */
function flattenCardText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Every "<number> g" the given card text prints, normalised.
 *
 * `\b` after the unit is what keeps this from matching the first letter of a
 * word: "2 grams" is not a gram token, "2 g" is.
 *
 * @param text - raw `textContent` from the card.
 * @returns one entry per gram figure, in print order.
 */
function gramFigures(text: string): string[] {
  return Array.from(flattenCardText(text).matchAll(/\d[\d.,]*\s?g\b/gu), (match) => flattenCardText(match[0]));
}

/**
 * Every percentage the given card text prints, as numbers, in print order.
 * German writes "35 %" and the other five "35%", so the space is optional.
 *
 * @param text - raw `textContent` from the card.
 * @returns one entry per percentage.
 */
function percentFigures(text: string): number[] {
  return Array.from(flattenCardText(text).matchAll(/(\d+)\s?%/gu), (match) => Number(match[1]));
}

/**
 * The day card used to say the same thing twice.
 *
 * `buildDayBudgetRows` pushes a protein, a fat and a fiber row for EVERY
 * account, unconditionally, and "What you ate" printed those same three gram
 * figures again a few hundred pixels below as bare numbers. Fat was verbatim
 * (both sides ran the day's fat through `formatMacroNumberIn`); protein and
 * fiber were the same quantity at two precisions, whole grams in the row's
 * caption against one decimal in the cell, which reads as a disagreement
 * rather than a repeat. A design audit read the card cold and asked why two
 * similar dark blocks said almost the same thing.
 *
 * The claim below is stated on the COMPOSITION block's side, and it is
 * deliberately not "no number appears in both blocks": on this fixture the
 * day's fiber is 8 g and fiber's share of the day is 8 %, so a reader that
 * compared bare numbers would call a correct card broken. A unit carries the
 * distinction, and the block's whole job is that it states shares, never grams.
 */
test('the composition block restates no gram figure the budget rows already state', async ({ page }) => {
  await seedNarrowDiary(page);

  // The lead figure and the quiet list under it (layout D), found by their
  // slots: the list has no sub-line any more, so the old
  // `li:has([data-slot="budget-subline"])` reader would find nothing.
  const rows = page.locator('[data-slot="budget-lead"], [data-slot="budget-row"]');
  const cells = page.locator('[data-slot="macro-share"]');
  let rowText = '';

  // English and German: German is the one language that spaces its percent
  // sign, and the one whose decimal separator is a comma, so a reader that
  // only ever ran in English would be pinning half the formatting.
  for (const locale of ['en', 'de'] as const) {
    await useLanguage(page, locale);
    await page.goto('/diary');
    await waitForTheDay(page);

    //////////////////////////////////////////////////////////////////////////
    // CONTROL: the AMOUNTS half is on screen and still states grams. Without
    // this the claim would also pass against a card whose budget rows had
    // stopped rendering, which is not the fix.
    //////////////////////////////////////////////////////////////////////////
    expect(await rows.count(), `${locale}: the fixture day must draw budget rows`).toBeGreaterThan(1);
    rowText = flattenCardText(
      await rows.evaluateAll((elements) => elements.map((element) => element.textContent ?? '').join(' | ')),
    );
    expect(gramFigures(rowText).length, `${locale}: the budget rows must still state the day in grams`).toBeGreaterThan(
      1,
    );

    //////////////////////////////////////////////////////////////////////////
    // CONTROL: the COMPOSITION half still states four figures. Deleting the
    // cells would satisfy the claim below and lose the ratio bar's legend,
    // so the cells are counted and each is required to carry a digit.
    //////////////////////////////////////////////////////////////////////////
    await expect(cells, `${locale}: the composition block must keep one cell per macro`).toHaveCount(MACRO_CELL_COUNT);
    const cellTexts = (await cells.allTextContents()).map(flattenCardText);
    for (const text of cellTexts) {
      expect(text, `${locale}: every macro cell must state a figure, read "${text}"`).toMatch(/\d/u);
    }

    //////////////////////////////////////////////////////////////////////////
    // THE CLAIM: not one of those cells states a gram figure. Against the
    // composition before this fix every cell did, so this goes red four times.
    //////////////////////////////////////////////////////////////////////////
    expect(
      cellTexts.filter((text) => gramFigures(text).length > 0),
      `${locale}: a macro cell repeated a gram figure the budget rows already carry`,
    ).toEqual([]);

    //////////////////////////////////////////////////////////////////////////
    // ...and what they state instead is the bar's OWN share, to the bar's own
    // rounding. A cell that printed some other percentage would be a new
    // figure rather than a legend, and a sighted reader would be given
    // different numbers from the ones the bar reads out.
    //////////////////////////////////////////////////////////////////////////
    const barText = (await page.locator('[data-slot="macro-ratio-bar"] .sr-only').textContent()) ?? '';
    expect(percentFigures(barText).length, `${locale}: the bar must read out one share per macro`).toBe(
      MACRO_CELL_COUNT,
    );
    expect(
      cellTexts.flatMap(percentFigures),
      `${locale}: the cells must state the same shares the ratio bar reads out`,
    ).toEqual(percentFigures(barText));
  }

  //////////////////////////////////////////////////////////////////////////////
  // THE RED CONTROL. The claim above is an ABSENCE, and an absence passes
  // against a reader that can see nothing. Put a real gram figure, taken from
  // a budget row on this very page, back into one cell, exactly as the block
  // printed before this composition was fixed. The same reader must now name
  // it. Without this the four expectations above could all be vacuous.
  //////////////////////////////////////////////////////////////////////////////
  const smuggled = gramFigures(rowText)[0];
  expect(smuggled, 'the control needs a real gram figure from a budget row').toBeTruthy();
  await cells.first().evaluate((element, text) => {
    element.textContent = text;
  }, smuggled);

  const afterTexts = (await cells.allTextContents()).map(flattenCardText);
  expect(
    afterTexts.filter((text) => gramFigures(text).length > 0),
    'the reader must report a gram figure smuggled back into a macro cell',
  ).toEqual([smuggled]);
});
