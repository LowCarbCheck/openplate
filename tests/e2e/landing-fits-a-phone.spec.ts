/**
 * The logged-out landing fits a phone, on a managed instance (M250/09).
 *
 * THE REPORT, owner, 2026-09-23: on a phone about 390 px wide, logged out,
 * app.openplate.de's header wordmark runs over "Zugang anfragen", and the page
 * is wider than the screen.
 *
 * WHAT WAS FOUND. The managed header carries the mark and the word, plus TWO
 * controls, the access dialog and sign in. Laid out at their natural widths
 * that row needs 396 px in English and 468 px in Spanish, before any page
 * margin. The controls do not shrink, so the word's box does, and the word
 * paints past its own box and under the access button. At 360 px that
 * happens in all six languages. The open instance has one control and fits.
 *
 * WHAT IS REAL: the production build, booted as a managed instance
 * (`managed-app-server.ts`), and the header it draws. Nothing on the page is
 * rewritten.
 *
 * THE CLAIMS, at 360, 390 and 412 px, in all six languages:
 *
 *  1. No two things in the header overlap: the mark, the word (when it is
 *     drawn), the access control and the sign-in link, read as boxes.
 *  2. Every one of them lies inside the viewport.
 *  3. Nothing in the header row paints past its own box (`scrollWidth`), which
 *     is the mechanism of the overlap, read directly.
 *  4. The document is no wider than the viewport.
 *
 * THE CONTROL. The same reader, with the word made visible again inline at the
 * narrowest width in the longest language, must report an overlap. A reader
 * that could not see one would pass every claim above and prove nothing.
 */
import { expect, test, type Page } from '@playwright/test';

import { LANGUAGE_COOKIE, SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';

test.use({ serviceWorkers: 'block' });

/** A small Android phone, the iPhone-class design width, and a large Android phone. */
const PHONE_WIDTHS = [360, 390, 412] as const;
const PHONE_HEIGHT = 844;

/** How long the managed server may take to boot, beside the tier's 30 s per spec. */
const BOOT_BUDGET_MS = 90_000;

/** The language whose two header labels are the longest, measured on 2026-09-23. */
const LONGEST_LANGUAGE: LanguageCode = 'es';

/** Less than this overlap in both axes is sub-pixel rounding, not two boxes on top of each other. */
const OVERLAP_EPSILON_PX = 0.5;

/** One thing in the header, as the box it paints. */
interface HeaderBox {
  label: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What one header read returns. */
interface HeaderRead {
  boxes: HeaderBox[];
  viewportWidth: number;
  documentWidth: number;
  /** Every header child whose content is wider than its own box, by label. */
  overflowing: string[];
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/**
 * Opens the managed landing in a language and waits for the header and its fonts.
 *
 * @param page - a fresh page.
 * @param language - the language cookie to send.
 */
async function openLanding(page: Page, language: LanguageCode): Promise<void> {
  await page.context().addCookies([{ name: LANGUAGE_COOKIE, value: language, url: server.url }]);
  await page.setViewportSize({ width: PHONE_WIDTHS[0], height: PHONE_HEIGHT });
  await page.goto(`${server.url}/`);
  await expect(page.locator('header a[href="/sign-in"]'), 'the managed header draws sign in').toBeVisible();
  await expect(page.locator('header button'), 'and the access control beside it').toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * Reads every painted thing in the header, the viewport and the document width.
 *
 * A box of a pixel or less is not painted: that is how a visually hidden word
 * still names the link for a screen reader, and it must not count as an overlap.
 *
 * @param page - the landing, loaded.
 */
async function readHeader(page: Page): Promise<HeaderRead> {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    if (header === null) throw new Error('no header');
    const logo = header.querySelector('a:has(img[src*="icon-192"])');
    const mark = logo?.querySelector('img');
    const word = logo === null || logo === undefined ? undefined : [...logo.querySelectorAll('span')].find((span) => span.textContent === 'openplate');
    const access = header.querySelector('button');
    const signIn = header.querySelector('a[href="/sign-in"]');
    if (logo === null || mark === null || mark === undefined || word === undefined || access === null || signIn === null) {
      throw new Error('the managed header is missing the mark, the word, the access control or sign in');
    }
    const candidates = [
      { label: 'mark', element: mark },
      { label: 'word', element: word },
      { label: 'access', element: access },
      { label: 'sign-in', element: signIn },
    ];
    const boxes = candidates
      .map(({ label, element }) => ({ label, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 1 && rect.height > 1)
      .map(({ label, rect }) => ({ label, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));

    const row = header.firstElementChild;
    if (row === null) throw new Error('the header has no row');
    const halves = [...row.children].map((child, index) => ({ label: `row child ${index}`, element: child }));
    const overflowing = [{ label: 'row', element: row }, ...halves]
      .filter(({ element }) => element.scrollWidth > element.clientWidth)
      .map(({ label, element }) => `${label} (${element.scrollWidth} > ${element.clientWidth})`);

    return {
      boxes,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflowing,
    };
  });
}

/**
 * Every pair of boxes that overlaps in both axes, named.
 *
 * @param boxes - the header's painted things.
 */
function overlapsIn(boxes: readonly HeaderBox[]): string[] {
  const found: string[] = [];
  for (const [index, first] of boxes.entries()) {
    for (const second of boxes.slice(index + 1)) {
      const across = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const down = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      if (across > OVERLAP_EPSILON_PX && down > OVERLAP_EPSILON_PX) {
        found.push(`${first.label} and ${second.label} share ${across.toFixed(1)} px`);
      }
    }
  }
  return found;
}

/**
 * Every box that reaches past either edge of the viewport, named.
 *
 * @param read - one header read.
 */
function outsideViewport(read: HeaderRead): string[] {
  return read.boxes
    .filter((box) => box.left < -OVERLAP_EPSILON_PX || box.right > read.viewportWidth + OVERLAP_EPSILON_PX)
    .map((box) => `${box.label} spans ${box.left.toFixed(1)} to ${box.right.toFixed(1)}`);
}

for (const language of SUPPORTED_LANGUAGES) {
  test(`the managed landing header fits a phone in ${language}`, async ({ page }) => {
    await openLanding(page, language);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      const read = await readHeader(page);
      const where = `${language} at ${width} px`;
      expect(read.boxes.map((box) => box.label), `${where}: the mark and both controls are painted`).toEqual(
        expect.arrayContaining(['mark', 'access', 'sign-in']),
      );
      expect(overlapsIn(read.boxes), `${where}: header items overlap`).toEqual([]);
      expect(outsideViewport(read), `${where}: header items leave the screen`).toEqual([]);
      expect(read.overflowing, `${where}: header content paints past its box`).toEqual([]);
      expect(read.documentWidth, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(read.viewportWidth);
    }
  });
}

test('the control: a word drawn at full size in that row is read as an overlap', async ({ page }) => {
  await openLanding(page, LONGEST_LANGUAGE);
  // Puts back what the header drew before the fix: the word visible beside
  // the mark, whatever the class list says now.
  await page.evaluate(() => {
    const logo = document.querySelector('header a:has(img[src*="icon-192"])');
    const word = logo === null ? undefined : [...logo.querySelectorAll('span')].find((span) => span.textContent === 'openplate');
    if (word === undefined) throw new Error('no word in the logo');
    word.style.cssText =
      'position: static; width: auto; height: auto; margin: 0; padding: 0; overflow: visible; clip: auto; clip-path: none; white-space: nowrap';
  });
  const read = await readHeader(page);
  expect(read.boxes.map((box) => box.label), 'the word is painted for the control').toContain('word');
  expect(overlapsIn(read.boxes).length, 'the reader sees the word run under the access control').toBeGreaterThan(0);
  expect(read.overflowing.length, 'and sees the word paint past its box').toBeGreaterThan(0);
});
