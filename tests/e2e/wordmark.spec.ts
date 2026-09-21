/**
 * The word "openplate" sits on the middle of the mark beside it (the recipe of 2026-09-21).
 *
 * THE CLAIM, in the operator's words: "definitely center text on mark". A flex row centres the
 * line BOX, and the eye reads the middle of the lowercase letters, so a word set with no
 * correction hangs about 1.4 px low against the mark at 18 px. `Wordmark` takes `besideMark` and
 * lifts itself by 0.08em. This spec measures the result on the real page and holds it to under a
 * pixel.
 *
 * ── HOW IT IS MEASURED, AND NOT GUESSED ──
 * The baseline is read from a zero-size inline probe put inside the word for one read, and the
 * height of a lowercase letter comes from a canvas measuring an "x" in the face the page computed.
 * The middle of the x-height is the baseline minus half of it, and the mark's middle is its own
 * bounding box. The difference is what is asserted. Neither number is a constant of this file.
 *
 * ── THE CONTROL ──
 * The same reader, run with the lift switched off inline, must report the word hanging low by a
 * pixel or more. A reader that returned zero for every input would pass the claim above and prove
 * nothing, so the spec fails if the uncorrected word does not read as off-centre.
 */
import { expect, test, type Page } from '@playwright/test';

/** The public header carries the logo (mark and word) on the phone viewport. `/terms` is public. */
const ROUTE = '/terms';

/** How far the middle of the x-height may be from the middle of the mark, in CSS pixels. */
const TOLERANCE_PX = 0.75;

/** The least the uncorrected word must be off by, for the control to count as a control. */
const CONTROL_MIN_PX = 1;

/**
 * Where the middle of the word's x-height is against the middle of the mark, positive when the
 * word is LOW.
 *
 * @param page - a page on the production build, on a route with the logo.
 * @param options.lifted - false to switch the lift off inline for the control read.
 * @returns the offset in CSS pixels.
 */
async function xHeightOffset(page: Page, { lifted }: { lifted: boolean }): Promise<number> {
  return page.evaluate(async (keepLift) => {
    const logo = document.querySelector('header a:has(img[src*="icon-192"])');
    if (logo === null) throw new Error('no logo link in the header');
    const mark = logo.querySelector('img');
    const word = [...logo.querySelectorAll('span')].find((span) => span.textContent === 'openplate');
    if (mark === null || word === undefined) throw new Error('the logo has no mark or no wordmark');

    const style = getComputedStyle(word);
    await document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`);
    await document.fonts.ready;

    const previousTop = word.style.top;
    if (!keepLift) word.style.top = '0';
    const probe = document.createElement('i');
    probe.style.cssText = 'display:inline-block;width:0;height:0';
    word.append(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    word.style.top = previousTop;

    const canvas = document.createElement('canvas').getContext('2d');
    if (canvas === null) throw new Error('no canvas');
    canvas.font = `${style.fontWeight} 200px ${style.fontFamily}`;
    const xHeightRatio = canvas.measureText('x').actualBoundingBoxAscent / 200;

    const bandMiddle = baseline - (xHeightRatio * Number.parseFloat(style.fontSize)) / 2;
    const markRect = mark.getBoundingClientRect();
    return bandMiddle - (markRect.top + markRect.height / 2);
  }, lifted);
}

test('the wordmark is centred on the mark by its x-height, and the reader can say it is not', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.locator('header a:has(img[src*="icon-192"])').first(), 'the logo is up').toBeVisible();

  const offset = await xHeightOffset(page, { lifted: true });
  expect(
    Math.abs(offset),
    `the middle of the word's x-height is ${offset.toFixed(2)} px from the middle of the mark`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);

  const uncorrected = await xHeightOffset(page, { lifted: false });
  expect(
    uncorrected,
    `CONTROL: without the lift the word must hang low, and reads ${uncorrected.toFixed(2)} px`,
  ).toBeGreaterThanOrEqual(CONTROL_MIN_PX);
});
