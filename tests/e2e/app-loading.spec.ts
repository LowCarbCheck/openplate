/**
 * The boot screen: the still icon, and the name under it with a teal wave running through
 * "plate" (the operator's "option E", 2026-09-23).
 *
 * ── HOW THE SCREEN IS HELD ON SCREEN ──
 * The screen is `_personal`'s `HydrateFallback`, and the server writes it into the HTML of every
 * tracker route. A page with its scripts switched off never hydrates, so the fallback stays up
 * for as long as the spec wants to read it. CSS animations still run with scripts off, and
 * Playwright's own reads still work, so what is measured is the production stylesheet on the
 * production markup.
 *
 * ── THE CLAIMS ──
 * The word reads "openplate" and there is no dot row any more. Every letter of "plate" has a
 * RUNNING animation, with delays 0.4 s to 0.8 s, and the letters of "open" have none. The letters
 * keep their boxes while the colour runs through them. Under `prefers-reduced-motion: reduce` no
 * letter animates at all.
 *
 * ── THE CONTROLS ──
 * Each reader is run once more on a page where the claim is made false by a style tag: the wave
 * switched off must read as "not running", a letter given wider spacing must read as moved, and
 * the wave forced on under reduced motion must read as "animating". A reader that answered the same for every page would fail its control. The spec
 * was also run once against the old component, three pulsing dots and no word, and failed there.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/** A tracker route; its server HTML is the boot screen. */
const ROUTE = '/diary';

/** The delays the five letters of "plate" must carry, in order. */
const PLATE_DELAYS = ['0.4s', '0.5s', '0.6s', '0.7s', '0.8s'];

/** What one letter of the word reports about its animation. */
interface LetterReading {
  text: string;
  animationName: string;
  animationDelay: string;
  running: number;
  width: number;
  left: number;
  color: string;
}

/**
 * Opens the boot screen with page scripts off, so it never hands over to the app.
 *
 * @param browser - the test's browser.
 * @param options.reducedMotion - the motion preference the page reports.
 * @returns the page, with the screen up.
 */
async function openBootScreen(
  browser: Browser,
  { reducedMotion }: { reducedMotion: 'reduce' | 'no-preference' },
): Promise<Page> {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(ROUTE);
  await expect(page.locator('output[aria-label]'), 'the boot screen is up').toBeVisible();
  return page;
}

/**
 * Adds a stylesheet to the page. Playwright's `addStyleTag` waits on a page script, which never
 * runs here, so the element is appended directly.
 */
async function addStyle(page: Page, css: string): Promise<void> {
  await page.evaluate((content) => {
    const style = document.createElement('style');
    style.textContent = content;
    document.head.append(style);
  }, css);
}

/** Every letter of the boot screen's word, read in the page. */
async function readLetters(page: Page): Promise<LetterReading[]> {
  return page.evaluate(() => {
    const word = document.querySelector('output[aria-label] > span');
    if (word === null) return [];
    return [...word.querySelectorAll(':scope > span')].map((letter) => {
      const style = getComputedStyle(letter);
      const rect = letter.getBoundingClientRect();
      return {
        text: letter.textContent ?? '',
        animationName: style.animationName,
        animationDelay: style.animationDelay,
        running: letter.getAnimations().filter((animation) => animation.playState === 'running').length,
        width: rect.width,
        left: rect.left,
        color: style.color,
      };
    });
  });
}

test.describe('the boot screen', () => {
  test('shows the still icon and the name, with a teal wave through "plate" only', async ({ browser }) => {
    const page = await openBootScreen(browser, { reducedMotion: 'no-preference' });
    const screen = page.locator('output[aria-label]');

    await expect(screen.locator('> span'), 'the name is the word').toHaveText('openplate');
    await expect(screen.locator('.loading-dots, .rounded-full'), 'no dot row').toHaveCount(0);
    await expect(screen.locator('> span'), 'the letters are hidden from screen readers').toHaveAttribute(
      'aria-hidden',
      'true',
    );
    const icon = screen.locator('img');
    await expect(icon).toHaveCount(1);
    expect(await icon.evaluate((image) => image.getAnimations().length), 'the icon stands still').toBe(0);

    const letters = await readLetters(page);
    expect(letters.map((letter) => letter.text).join('')).toBe('openplate');

    const open = letters.slice(0, 4);
    for (const letter of open) {
      expect(letter.animationName, `"${letter.text}" of open has no animation`).toBe('none');
      expect(letter.running, `"${letter.text}" of open runs nothing`).toBe(0);
    }
    const plate = letters.slice(4);
    expect(plate.map((letter) => letter.animationName)).toEqual(Array.from({ length: 5 }, () => 'wordmark-wave'));
    expect(plate.map((letter) => letter.animationDelay)).toEqual(PLATE_DELAYS);
    for (const letter of plate) {
      expect(letter.running, `"${letter.text}" of plate is running`).toBe(1);
    }

    // THE COLOUR MOVES AND THE BOXES DO NOT. Three reads across half a cycle
    // see more than one colour on "p" (two reads could meet at the one pair of
    // moments the curve gives the same colour), and no letter moves or changes
    // width between them.
    const colours = new Set([letters[4].color]);
    for (const wait of [450, 450]) {
      await page.waitForTimeout(wait);
      const later = await readLetters(page);
      colours.add(later[4].color);
      expect(later.map((letter) => [letter.left, letter.width])).toEqual(
        letters.map((letter) => [letter.left, letter.width]),
      );
    }
    expect(colours.size, 'the colour of "p" moves').toBeGreaterThan(1);

    // CONTROL: the geometry read does see a letter that changes its box.
    await addStyle(page, '.wordmark-wave { letter-spacing: 0.2em; }');
    const spaced = await readLetters(page);
    expect(spaced.map((letter) => [letter.left, letter.width])).not.toEqual(
      letters.map((letter) => [letter.left, letter.width]),
    );

    // CONTROL: with the wave switched off, the same reader says nothing runs.
    await addStyle(page, '.wordmark-wave { animation: none !important; }');
    const stopped = await readLetters(page);
    expect(stopped.slice(4).map((letter) => letter.running)).toEqual([0, 0, 0, 0, 0]);

    await page.context().close();
  });

  test('stands still under reduced motion, "open" teal and "plate" in the ink', async ({ browser }) => {
    const page = await openBootScreen(browser, { reducedMotion: 'reduce' });

    const letters = await readLetters(page);
    expect(letters.map((letter) => letter.text).join('')).toBe('openplate');
    for (const letter of letters) {
      expect(letter.animationName, `"${letter.text}" does not animate`).toBe('none');
      expect(letter.running, `"${letter.text}" runs nothing`).toBe(0);
    }
    expect(letters[0].color, '"open" is teal, not the ink of "plate"').not.toBe(letters[4].color);
    expect(new Set(letters.slice(4).map((letter) => letter.color)).size, '"plate" is one colour').toBe(1);

    // CONTROL: forced on regardless of the preference, the same reader sees it.
    await addStyle(page, '.wordmark-wave { animation: wordmark-wave 1.8s ease-in-out infinite; }');
    const forced = await readLetters(page);
    expect(forced.slice(4).map((letter) => letter.running)).toEqual([1, 1, 1, 1, 1]);

    await page.context().close();
  });
});
