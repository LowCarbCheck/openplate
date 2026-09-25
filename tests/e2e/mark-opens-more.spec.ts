/**
 * The brand mark at the top left opens the More sheet, the same one the bar's More tab opens (M259).
 *
 * THE REPORT (operator, 2026-09-25, after a day with 0.47.0 on a phone): "pressing on the top left
 * icon should open the same menu that the bottom right button opens." In 0.47.0 the mark was a
 * picture and opened nothing (M258). It is a button now: two doors, ONE sheet, and the sheet always
 * rises from the bottom, whichever door opened it.
 *
 * WHAT THIS PROVES, at the 390 x 844 phone of this tier:
 *
 * - The mark is a button that announces a dialog. A tap on it opens the dialog named `nav.more`,
 *   and while it is open the mark says so with `aria-expanded`.
 * - It is the SAME sheet: the tiles and rows opened from the mark have exactly the hrefs, in the
 *   same order, that the More tab's sheet has, and there is one dialog in the DOM, never two.
 * - Escape closes it, and focus goes back to the door that opened it: the mark after the mark, the
 *   More tab after the More tab. A tile opened from the mark still navigates and closes the sheet.
 * - Opening and closing it from the mark moves nothing: a `layout-shift` total of 0, and no top
 *   inside `main` changes.
 * - The header did not move to make room for a button. The title and the wordmark have the rects
 *   they had on 0.47.0, read at 360 and 390 px, and the mark's picture is the same 36 px square in
 *   the same place, while the button around it is a 44 px target. A control pads the button
 *   without the negative margin that pays for it, and the reader must report the title moving.
 *
 * WHAT IT DOES NOT PROVE:
 *
 * - The sheet's contents in six languages, or the More tab's own behaviour. `menu-is-found.spec.ts`
 *   and `three-tab-bar.spec.ts` own those.
 * - Anything at `md` and wider, where the mark and the sheet are both hidden and the sidebar's own
 *   logo takes this place.
 *
 * RED ON 0.47.0. Run against the 0.47.0 build (openplate 2dc8719) before the change, every test in
 * this file failed at its first read of the mark: there was no button in the header to find.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { BOTTOM_BAR } from './clip-baseline';
import { EN } from './copy';
import { completeOnboarding } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  shiftScoreAfter,
} from './layout-shift';

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/** The two phone widths the header is read at. */
const PHONE_WIDTHS = [360, 390] as const;

/** A generous height, so width is the only thing that changes between the two reads. */
const PHONE_HEIGHT = 844;

/** A rect, reduced to the four numbers a layout claim is about. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * THE HEADER ON 0.47.0, measured on that build (openplate 2dc8719) on `/diary` in English, at
 * both widths, before the mark became a button. The two widths read the same numbers: the
 * header's left column does not depend on the viewport. The title and the wordmark share one
 * column, so their `x` and `width` agree. Frozen here so a button that took room from the column
 * fails this file instead of nudging the brand and the page name sideways.
 */
const HEADER_ON_0_47 = {
  title: { x: 62, y: 28.25, width: 59.765625, height: 22.5 },
  wordmark: { x: 62, y: 12.25, width: 59.765625, height: 12 },
  markPicture: { x: 16, y: 13.5, width: 36, height: 36 },
} as const satisfies Record<string, Rect>;

/** The mark: a button in the sticky app header, found by the picture it wraps. */
function headerMark(page: Page): Locator {
  return page.locator('header.sticky button:has(img[src^="/icons/icon-192"])');
}

/** The bar's More tab. */
function moreTab(page: Page): Locator {
  return page.locator(BOTTOM_BAR).getByRole('button', { name: EN.nav.more, exact: true });
}

/** The More sheet, found by the title it announces. */
function moreSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: EN.nav.more, exact: true });
}

/** Every link in the open More sheet, as the hrefs it points at, in document order. */
async function sheetHrefs(page: Page): Promise<string[]> {
  return moreSheet(page)
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

/** The header's three measured boxes, unrounded: the numbers are compared exactly. */
async function readHeader(page: Page): Promise<{ title: Rect; wordmark: Rect; markPicture: Rect }> {
  // Serialised into the page: its helper cannot live outside the callback.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate(() => {
    const rectOf = (selector: string): Rect => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`the header has no ${selector}`);
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      title: rectOf('header.sticky h1'),
      wordmark: rectOf('header.sticky [data-slot="header-brand-kicker"]'),
      markPicture: rectOf('header.sticky img[src^="/icons/icon-192"]'),
    };
  });
  // oxlint-enable unicorn/consistent-function-scoping
}

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page);
});

test('the mark opens the More sheet, the same one the More tab opens, and takes the focus back', async ({
  page,
}) => {
  await page.goto('/diary');
  const mark = headerMark(page);
  await expect(mark, 'the mark must be a button in the header').toBeVisible();
  await expect(mark, 'the mark announces the sheet it opens').toHaveAttribute('aria-haspopup', 'dialog');
  await expect(mark, 'and says it is shut').toHaveAttribute('aria-expanded', 'false');
  await expect(mark, 'its name is the name of the sheet it opens').toHaveAccessibleName(EN.nav.more);

  // THE MARK'S DOOR.
  await mark.tap();
  await expect(moreSheet(page), 'a tap on the mark must open the More sheet').toBeVisible();
  await expect(page.getByRole('dialog'), 'one dialog, never a second beside it').toHaveCount(1);
  await expect(mark, 'the mark says the sheet is open').toHaveAttribute('aria-expanded', 'true');
  const controlled = await mark.getAttribute('aria-controls');
  expect(controlled, 'the mark names the sheet it controls').not.toBeNull();
  await expect(moreSheet(page), 'and the name is the open sheet').toHaveAttribute('id', controlled ?? '');
  await settleAnimations(page);
  const fromMark = await sheetHrefs(page);

  await page.keyboard.press('Escape');
  await expect(moreSheet(page)).toHaveCount(0);
  await expect(mark, 'focus must come back to the mark, the door that opened it').toBeFocused();
  await expect(mark).toHaveAttribute('aria-expanded', 'false');

  // THE TAB'S DOOR, and THE CONTROL for the focus line above: the same sheet opened from the other
  // door must hand the focus to THAT door, so a focus that always went to the mark would fail here.
  await moreTab(page).tap();
  await expect(moreSheet(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(mark, 'one sheet, so the mark reads open whichever door opened it').toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await settleAnimations(page);
  const fromTab = await sheetHrefs(page);

  await page.keyboard.press('Escape');
  await expect(moreSheet(page)).toHaveCount(0);
  await expect(moreTab(page), 'focus must come back to the More tab when it opened the sheet').toBeFocused();

  // NON-VACUITY: two empty lists would be equal too.
  expect(fromMark.length, 'the sheet must carry its tiles').toBeGreaterThanOrEqual(6);
  expect(fromMark, 'the mark and the More tab must open the same sheet').toEqual(fromTab);
});

test('a tile in the sheet the mark opened navigates, and the sheet closes behind it', async ({ page }) => {
  await page.goto('/diary');

  await headerMark(page).tap();
  await moreSheet(page).getByRole('link', { name: EN.nav.trends, exact: true }).tap();
  await page.waitForURL((url) => url.pathname === '/trends');
  await expect(page.getByRole('dialog'), 'the sheet must close behind the tile').toHaveCount(0);
  await expect(headerMark(page)).toHaveAttribute('aria-expanded', 'false');
});

test('opening and closing the sheet from the mark moves nothing', async ({ page }) => {
  await installShiftObserver(page);
  await page.goto('/diary');
  const mark = headerMark(page);
  await expect(mark).toBeVisible();

  await settleAnimations(page);
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  const headerBefore = await readHeader(page);

  await mark.tap();
  await expect(moreSheet(page)).toBeVisible();
  await settleAnimations(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settleAnimations(page);

  expect(movedBetween(topsBefore, await readTops(page)), 'opening and closing the sheet moved the page').toEqual([]);
  expect(
    shiftScoreAfter(await readShiftEntries(page), shiftsBefore),
    `layout-shift while the sheet opened and closed: ${JSON.stringify((await readShiftEntries(page)).slice(shiftsBefore))}`,
  ).toBe(0);
  expect(await readHeader(page), 'the header must not move while the sheet opens and closes').toEqual(headerBefore);
});

test('the header keeps its 0.47.0 geometry, and the mark is a 44 px target', async ({ page }) => {
  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    await page.goto('/diary');
    await expect(headerMark(page), `at ${width}: the mark must be a button`).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    expect(await readHeader(page), `at ${width}: the title, the wordmark and the picture moved`).toEqual(
      HEADER_ON_0_47,
    );

    const target = await headerMark(page).boundingBox();
    if (target === null) throw new Error(`at ${width}: the mark has no box to measure`);
    expect(Math.round(target.width), `at ${width}: the mark is ${target.width} px wide`).toBeGreaterThanOrEqual(
      TOUCH_TARGET_PX,
    );
    expect(Math.round(target.height), `at ${width}: the mark is ${target.height} px tall`).toBeGreaterThanOrEqual(
      TOUCH_TARGET_PX,
    );
  }

  // THE CONTROL: the same 44 px target bought with padding alone, without the negative margin that
  // gives the room back, pushes the column 4 px right and 0 px down. The reader must see it.
  await page.evaluate(() => {
    const button = document.querySelector('header.sticky button:has(img[src^="/icons/icon-192"])');
    if (!(button instanceof HTMLElement)) throw new Error('the mark is not a button to pad');
    button.style.cssText = 'margin:0;padding:4px;transition:none';
  });
  const padded = await readHeader(page);
  expect(padded.title.x, 'CONTROL: a mark that takes room must move the title').not.toBe(HEADER_ON_0_47.title.x);
});
