/**
 * The first paint of a Turkish page, before the second font file has arrived (M243 spec 08).
 *
 * WHY TURKISH IS THE ONE THAT SWAPS. `@fontsource-variable/victor-mono` ships six subsets, and the
 * browser downloads one only when the page holds a character in its `unicode-range`. English,
 * German, French, Italian and Spanish text is all Latin-1, so the `latin` file covers it. Turkish
 * `ı İ ş Ş ğ Ğ` are in the `latin-ext` range, so a Turkish page needs a SECOND file, which starts
 * downloading only after the first layout has found a character that needs it. `font-display:
 * swap` paints those characters in the next face of the stack (Inter, then the device's own
 * monospace) and swaps Victor Mono in when the file lands.
 * A swap between faces of different widths is a reflow. The glyph audit
 * (`tests/unit/font-glyph-audit.test.ts`) proves the characters are covered; this proves the swap
 * does not visibly move the page.
 *
 * WHAT IS ASSERTED
 *
 * 1. THE SUBSET LOADS. On a Turkish page the Victor Mono face whose ranges cover `İ` (U+0130) reaches
 *    `loaded`, and the network fetched its file. The reader is also pointed at an English page,
 *    which must NOT fetch it, so the reader is shown able to say no.
 * 2. THE PAGE PAINTS BEFORE THE FILE ARRIVES. The `latin-ext` file is held back for 700 ms, so the
 *    first paint is certain to be the fallback face and the swap is certain to happen after it.
 *    Without the hold, a fast local server delivers the file before the first paint and there is
 *    no swap to measure. The first contentful paint must come BEFORE the file's last byte.
 * 3. THE SWAP MOVES NOTHING MUCH. The layout shift score of everything from the swap onwards is at
 *    most `SWAP_SHIFT_BOUND`, which is 0.02: a fifth of the Core Web Vitals threshold for "good"
 *    (0.1), so a swap that moves a block of the page fails it and measurement noise does not.
 * 4. THE OBSERVER CAN SEE A SHIFT. A 300 px spacer pushed in above the page must raise the score
 *    past the same bound, or a reader that returned zero for everything would pass.
 *
 * MEASURED (2026-09-21, production build, headless Chromium, `/welcome` in Turkish at 390 px, the
 * `latin-ext` file held 700 ms): first contentful paint at 48 ms, the file done at 746 ms, a swap
 * layout shift score of 0.0000 and a whole-load score of 0.0000, against 0.3555 for the 300 px
 * spacer of control 4. The swap moved nothing on this screen. The numbers are also attached to
 * each run as `measured` and `control` annotations.
 *
 * THE SERVICE WORKER IS BLOCKED. A first visit would otherwise register it, and a worker that
 * takes over can reload the document being measured. The swap is a property of the network fetch
 * of a font, and that is the same with or without a worker.
 */
import { expect, test, type Page } from '@playwright/test';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { VICTOR_MONO } from '../design-contract';
import { useLanguage } from './helpers';

test.use({ serviceWorkers: 'block' });

const PHONE = { width: 390, height: 844 } as const;

/** How long the `latin-ext` file is held back, so the first paint is the fallback face. */
const LATIN_EXT_HOLD_MS = 700;

/** The stated bound on the layout shift of the swap. Core Web Vitals call 0.1 and under "good". */
const SWAP_SHIFT_BOUND = 0.02;

/** `İ`, which only the `latin-ext` subset covers and Turkish needs, and `A`, which only `latin` covers. */
const CAPITAL_DOTTED_I = 0x130;
const CAPITAL_A = 0x41;

/** The screen a first visit meets, and the one whose first paint is the question. */
const FIRST_SCREEN = '/welcome';

/** What the page recorded about the subset and the paint. */
interface FontReading {
  /** Whether the Victor Mono face that carries `İ` reports `loaded`. */
  isLatinExtLoaded: boolean;
  /** Whether the Victor Mono `latin` face reports `loaded`. */
  isLatinLoaded: boolean;
  /** Whether the network fetched the `latin-ext` file. */
  wasLatinExtFetched: boolean;
  /** When the first contentful paint happened, and when the `latin-ext` file finished arriving, in ms. */
  firstContentfulPaint: number | null;
  latinExtResponseEnd: number | null;
}

/** One layout shift, as the page's observer recorded it. */
interface Shift {
  value: number;
  hadRecentInput: boolean;
  startTime: number;
}

/**
 * Installs the layout shift observer BEFORE any page script runs, so the first paint is seen.
 *
 * @param page - a page that has not navigated yet.
 */
async function observeShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: Shift[] = [];
    Object.defineProperty(window, '__lccShifts', { value: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // `toJSON` is typed `any` and is the one read of a `LayoutShift` that needs no cast.
        const json = entry.toJSON();
        shifts.push({
          value: Number(json.value),
          hadRecentInput: Boolean(json.hadRecentInput),
          startTime: entry.startTime,
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

/**
 * The shifts the observer has recorded so far.
 *
 * @param page - a page with the observer installed.
 * @returns every shift, in order.
 */
async function readShifts(page: Page): Promise<Shift[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__lccShifts')?.value;
    return Array.isArray(recorded) ? [...recorded] : [];
  });
}

/**
 * The layout shift score of every shift that started at or after `since`, ignoring shifts that
 * followed a tap or a key (those are the person's own doing).
 *
 * @param shifts - the recorded shifts.
 * @param since - a timestamp in ms; 0 for the whole load.
 * @returns the summed score.
 */
function scoreSince(shifts: readonly Shift[], since: number): number {
  return shifts.filter((shift) => !shift.hadRecentInput && shift.startTime >= since).reduce((sum, shift) => sum + shift.value, 0);
}

/**
 * Reads which Victor Mono subsets loaded and when the paint and the file landed.
 *
 * @param page - a loaded page.
 * @returns the reading.
 */
async function readFonts(page: Page): Promise<FontReading> {
  // THE CALLBACK IS SERIALISED INTO THE PAGE, so `covers` cannot be hoisted out of it.
  // oxlint-disable unicorn/consistent-function-scoping
  const reading = await page.evaluate(
    ({ family, capitalDottedI, capitalA }) => {
      // `FontFace.unicodeRange` is the browser's own NORMALISED text (`U+100-2BA`, no padding), so
      // a face is identified by whether its ranges COVER a code point, never by matching the
      // source text of the stylesheet.
      const covers = (face: FontFace, codePoint: number): boolean =>
        face.unicodeRange.split(',').some((part) => {
          const [from, to] = part.trim().replace(/^U\+/iu, '').split('-');
          const low = Number.parseInt(from, 16);
          const high = to === undefined ? low : Number.parseInt(to, 16);
          return codePoint >= low && codePoint <= high;
        });
      const faces = [...document.fonts].filter((face) => face.family.includes(family));
      const latinExt = faces.find((face) => covers(face, capitalDottedI) && !covers(face, capitalA));
      const latin = faces.find((face) => covers(face, capitalA));
      const fetched = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('victor-mono-latin-ext'));
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        isLatinExtLoaded: latinExt?.status === 'loaded',
        isLatinLoaded: latin?.status === 'loaded',
        wasLatinExtFetched: fetched !== undefined,
        firstContentfulPaint: paint === undefined ? null : paint.startTime,
        // A resource entry's `duration` is `responseEnd - startTime`, which needs no cast to `PerformanceResourceTiming`.
        latinExtResponseEnd: fetched === undefined ? null : fetched.startTime + fetched.duration,
      };
    },
    { family: VICTOR_MONO, capitalDottedI: CAPITAL_DOTTED_I, capitalA: CAPITAL_A },
  );
  // oxlint-enable unicorn/consistent-function-scoping
  return reading;
}

/**
 * Holds the `latin-ext` file back, so the fallback is what the first paint is drawn in.
 *
 * @param page - a page that has not navigated yet.
 */
async function holdLatinExt(page: Page): Promise<void> {
  await page.route(/victor-mono-latin-ext-wght-normal.*\.woff2/u, async (route) => {
    await new Promise<void>((resolve) => setTimeout(resolve, LATIN_EXT_HOLD_MS));
    await route.continue();
  });
}

/**
 * Opens the first screen in a language and waits for the page to be drawn.
 *
 * @param page - a fresh page.
 * @param locale - the language of the device.
 */
async function openFirstScreen(page: Page, locale: LanguageCode): Promise<void> {
  await page.setViewportSize(PHONE);
  await useLanguage(page, locale);
  await page.goto(FIRST_SCREEN);
  await expect(page.locator('body')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('a Turkish first visit fetches the latin-ext subset and its swap moves the page by no more than the bound', async ({
  page,
}) => {
  await observeShifts(page);
  await holdLatinExt(page);
  await openFirstScreen(page, 'tr');

  // 1. THE SUBSET LOADS.
  await expect
    .poll(async () => (await readFonts(page)).isLatinExtLoaded, {
      message: 'the Victor Mono latin-ext subset must reach `loaded` on a Turkish page',
      timeout: 10_000,
    })
    .toBe(true);
  const fonts = await readFonts(page);
  expect(fonts.wasLatinExtFetched, 'the network must have fetched the latin-ext file').toBe(true);
  expect(fonts.isLatinLoaded, 'the latin subset loads too, since Turkish uses both').toBe(true);

  // 2. THE PAGE PAINTED BEFORE THE FILE ARRIVED, so there really was a swap to measure.
  expect(fonts.firstContentfulPaint, 'the page must have a first contentful paint').not.toBeNull();
  expect(fonts.latinExtResponseEnd, 'the latin-ext file must have a finish time').not.toBeNull();
  expect(
    fonts.firstContentfulPaint ?? Number.POSITIVE_INFINITY,
    'the first paint must come before the latin-ext file finishes, or nothing swapped',
  ).toBeLessThan(fonts.latinExtResponseEnd ?? 0);

  // 3. THE SWAP MOVES NOTHING MUCH. Two frames after the load, so the reflow is in the record.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const shifts = await readShifts(page);
  const swapScore = scoreSince(shifts, fonts.latinExtResponseEnd ?? 0);
  expect(swapScore, `the swap moved the page by ${swapScore.toFixed(4)}, over the bound ${SWAP_SHIFT_BOUND}`).toBeLessThanOrEqual(
    SWAP_SHIFT_BOUND,
  );
  test.info().annotations.push({
    type: 'measured',
    description: `swap layout shift ${swapScore.toFixed(4)} of ${SWAP_SHIFT_BOUND}, whole load ${scoreSince(shifts, 0).toFixed(4)}, ${shifts.length} shift(s), first paint ${Math.round(fonts.firstContentfulPaint ?? 0)} ms, file done ${Math.round(fonts.latinExtResponseEnd ?? 0)} ms`,
  });

  // 4. CONTROL: the observer can see a shift. A 300 px spacer pushed in above the page must score
  // past the same bound, or a reader that returned zero for everything would pass the claim above.
  const before = scoreSince(await readShifts(page), 0);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height:300px;';
    document.body.prepend(spacer);
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = scoreSince(await readShifts(page), 0);
  expect(after - before, 'a 300 px spacer must register as a layout shift past the bound').toBeGreaterThan(SWAP_SHIFT_BOUND);
  test.info().annotations.push({ type: 'control', description: `a 300 px spacer scored ${(after - before).toFixed(4)}` });
});

test('CONTROL: an English first visit does not fetch the latin-ext subset, so the reader can say no', async ({ page }) => {
  await observeShifts(page);
  await holdLatinExt(page);
  await openFirstScreen(page, 'en');

  await expect
    .poll(async () => (await readFonts(page)).isLatinLoaded, { message: 'the latin subset must load on an English page' })
    .toBe(true);
  const fonts = await readFonts(page);
  expect(fonts.isLatinExtLoaded, 'the latin-ext subset must not be loaded on an English page').toBe(false);
  expect(fonts.wasLatinExtFetched, 'and the network must not have fetched it').toBe(false);
});
