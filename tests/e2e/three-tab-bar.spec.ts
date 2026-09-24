/**
 * The phone bar has three slots and one door (M258, operator decision 2026-09-24).
 *
 * THE REPORT. After a day with the 0.46.0 bar the operator wrote: "too many items in the bottom and
 * the way it opens from 2 spots is weird + settings being closest to the thumb is also weird". Five
 * slots (Diary, Insights, Scan, Add, Menu) and two doors into one drawer (the Menu tab and the brand
 * mark) became, in an interactive playground, this: Diary, a raised plus that opens the add sheet on
 * a TAP, and More, which opens a bottom sheet of tiles for every page the bar does not carry. The
 * most used page sits nearest the thumb. Settings, Plan and Administration live in the avatar menu
 * only. The brand mark is a logo and opens nothing.
 *
 * WHAT THIS PROVES:
 *
 * - The bar draws exactly three slots, labelled with the catalog's `nav.diary`, `nav.add` and
 *   `nav.more`, in that order.
 * - A tap on the plus opens the add sheet (a long press is no longer needed), and focus comes back
 *   to the plus when it closes.
 * - The add sheet's first door, above the type, speak and photo strip, is the food search. It
 *   lands on `/add/search` with the sheet closed, and it carries the `?date=` of a diary day that
 *   is not today. With the Add tab gone this is the two-tap way to a search the playground listed
 *   first; without it a search took three taps.
 * - A tap on More opens ONE dialog named `nav.more` that rests at the bottom of the screen: its top
 *   edge below the middle of the viewport, its bottom edge on the viewport's bottom edge.
 * - That sheet lists the six pages the bar does not carry, drawer order reversed, so Overview is the
 *   last tile and sits bottom right, and it lists no Settings, Plan or Administration. Every tile is
 *   at least 44 by 44 px. The page on screen is the one tile marked current.
 * - A tile navigates and the sheet closes behind it. Escape closes it and focus returns to More.
 * - The avatar menu carries Settings on an open instance, and it leads to `/settings`.
 * - The brand mark in the header is not a door: nothing around it is a button or a link, nothing in
 *   the header announces a dialog, and a tap on it opens nothing.
 *
 * WHAT IT DOES NOT PROVE:
 *
 * - Label fit in six languages, or that the sheets move nothing. `menu-is-found.spec.ts` owns both.
 * - Plan and Administration in the avatar menu. `plan-nav-entry.spec.ts` walks the plan entry, and
 *   `tests/unit/avatar-menu-door.test.ts` renders the administrator row.
 * - Anything at `md` and wider, where the sidebar is unchanged and the bar is not drawn.
 *
 * RED ON THE OLD BAR. Run against the 0.46.0 build (origin/main 4a8d5ba) before the change, this
 * file failed on every test that reads the bar: five slots where three are expected, a tap on the
 * Scan circle that opened a camera instead of the sheet, no button named "More", and a header mark
 * that was a button announcing a dialog. Only the avatar menu's Settings row passed, because that
 * row already existed; it is here as the door the drawer's Settings row became.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { BOTTOM_BAR } from './clip-baseline';
import { EN } from './copy';
import { completeOnboarding } from './helpers';
import { settleAnimations } from './layout-shift';

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/** Half a CSS pixel: a flex row splits a phone width into boxes that end on fractional pixels. */
const EDGE_TOLERANCE_PX = 0.5;

/**
 * The More sheet's tiles, top left to bottom right: the drawer's order reversed, so the first page
 * of that order, Overview, is the last tile and lands under the thumb.
 */
const MORE_TILE_LABELS = [
  EN.nav.goals,
  EN.nav.nutrients,
  EN.nav.trends,
  EN.nav.fasting,
  EN.nav.pantry,
  EN.nav.dashboard,
] as const;

/** A rect, reduced to the numbers this spec compares. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** The bar's More tab. */
function moreTab(page: Page): Locator {
  return page.locator(BOTTOM_BAR).getByRole('button', { name: EN.nav.more, exact: true });
}

/** The bar's raised plus. */
function plusButton(page: Page): Locator {
  return page.locator(BOTTOM_BAR).getByRole('button', { name: EN.nav.add, exact: true });
}

/** The add sheet, found by the title it announces. */
function addSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: EN.launcher.sheetTitle, exact: true });
}

/** The More sheet, found by the title it announces. */
function moreSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: EN.nav.more, exact: true });
}

/** An element's rect, with the viewport it was read in. */
async function boxWithViewport(locator: Locator): Promise<{ box: Box; viewportHeight: number }> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      box: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      viewportHeight: document.documentElement.clientHeight,
    };
  });
}

/**
 * The words of every slot in the bar, in order. A slot is a direct child of the bar's row, and its
 * label is the last `span` in it that holds text of its own.
 */
async function barLabels(page: Page): Promise<string[]> {
  // Serialised into the page: its helper cannot live outside the callback.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate((barSelector) => {
    const holdsOwnText = (element: Element): boolean =>
      [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
    const row = document.querySelector(barSelector)?.firstElementChild;
    if (row === null || row === undefined) throw new Error('the page has no bottom bar row');
    return [...row.children].map((slot) => {
      const label = [...slot.querySelectorAll('span')].findLast(holdsOwnText);
      return (label?.textContent ?? '').trim();
    });
  }, BOTTOM_BAR);
  // oxlint-enable unicorn/consistent-function-scoping
}

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page);
});

test('the bar carries three slots: Diary, the plus and More', async ({ page }) => {
  await page.goto('/diary');
  await expect(page.locator(BOTTOM_BAR)).toBeVisible();

  expect(await barLabels(page), 'the bar labels, in order').toEqual([EN.nav.diary, EN.nav.add, EN.nav.more]);
  await expect(plusButton(page), 'the plus is a button named in words').toBeVisible();
  await expect(moreTab(page), 'More is a button named in words').toBeVisible();
  await expect(moreTab(page)).toHaveText(EN.nav.more);
});

test('a tap on the plus opens the add sheet, and focus comes back to the plus', async ({ page }) => {
  await page.goto('/diary');

  await plusButton(page).tap();
  const sheet = addSheet(page);
  await expect(sheet, 'a plain tap must open the add sheet').toBeVisible();
  await expect(sheet.getByLabel(EN.launcher.photo, { exact: true }), "the sheet's photo key").toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(plusButton(page), 'focus must come back to the plus').toBeFocused();
});

test("the add sheet's first door is the food search, and it closes the sheet behind it", async ({ page }) => {
  await page.goto('/diary');

  await plusButton(page).tap();
  const sheet = addSheet(page);
  const search = sheet.getByRole('link', { name: EN.launcher.searchFoods, exact: true });
  await expect(search, 'the sheet must offer the food search').toBeVisible();

  // FIRST, above the type, speak and photo strip, as the playground listed it.
  const strip = sheet.getByRole('link', { name: EN.launcher.type, exact: true });
  const [searchBox, stripBox] = await Promise.all([search.boundingBox(), strip.boundingBox()]);
  if (searchBox === null || stripBox === null) throw new Error('the search door or the strip has no box');
  expect(searchBox.y + searchBox.height, 'the search door must sit above the strip').toBeLessThanOrEqual(stripBox.y);
  expect(Math.round(searchBox.height), 'the search door is a 44 px target').toBeGreaterThanOrEqual(TOUCH_TARGET_PX);

  await search.tap();
  await page.waitForURL((url) => url.pathname === '/add/search');
  expect(new URL(page.url()).searchParams.get('date'), 'a door opened on today carries no day').toBeNull();
  await expect(page.getByRole('dialog'), 'the sheet must close behind the door').toHaveCount(0);
  await expect(page.locator('#food-search'), 'the search screen is on').toBeVisible();
});

test('the search door keeps the day the diary was showing', async ({ page }) => {
  // YESTERDAY, in the device's own calendar, the way the diary reads `?date=`.
  const yesterday = await page.evaluate(() => {
    const day = new Date();
    day.setDate(day.getDate() - 1);
    return day.toLocaleDateString('en-CA');
  });
  await page.goto(`/diary?date=${yesterday}`);

  await plusButton(page).tap();
  await addSheet(page).getByRole('link', { name: EN.launcher.searchFoods, exact: true }).tap();
  await page.waitForURL((url) => url.pathname === '/add/search');
  expect(new URL(page.url()).searchParams.get('date'), 'the search must log to the day on screen').toBe(yesterday);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('More opens a bottom sheet of six tiles, with no settings in it', async ({ page }) => {
  await page.goto('/diary');

  await moreTab(page).tap();
  const sheet = moreSheet(page);
  await expect(sheet, 'one More sheet, named More').toHaveCount(1);
  await expect(page.getByRole('dialog'), 'and no second dialog beside it').toHaveCount(1);
  await expect(sheet.getByText(EN.nav.more, { exact: true }), 'the title is on screen, not only announced').toBeVisible();
  await settleAnimations(page);

  // WHERE IT RESTS: a sheet from the bottom, not a side drawer and not a full page.
  const { box, viewportHeight } = await boxWithViewport(sheet);
  expect(box.top, 'the sheet must start below the middle of the screen').toBeGreaterThan(viewportHeight / 2);
  expect(Math.abs(box.bottom - viewportHeight), 'the sheet must sit on the bottom edge').toBeLessThanOrEqual(
    EDGE_TOLERANCE_PX,
  );

  const tiles = sheet.getByRole('link');
  await expect(tiles, 'six tiles, one per page the bar does not carry').toHaveCount(MORE_TILE_LABELS.length);
  const names = await tiles.evaluateAll((links) => links.map((link) => (link.textContent ?? '').trim()));
  expect(names, 'the tiles, top left to bottom right').toEqual([...MORE_TILE_LABELS]);

  // NO CONFIGURATION IN HERE. By name and by address, so a renamed row cannot slip through either.
  for (const label of [EN.nav.settings, EN.nav.plan, EN.nav.admin]) {
    await expect(sheet.getByRole('link', { name: label, exact: true }), `${label} must not be a tile`).toHaveCount(0);
  }
  for (const href of ['/settings', '/settings/plan', '/admin']) {
    await expect(sheet.locator(`a[href="${href}"]`), `${href} must not be a tile`).toHaveCount(0);
  }

  // Overview, the first page of the old drawer, is the tile nearest the thumb: bottom right.
  const boxes = await tiles.evaluateAll((links) =>
    links.map((link) => {
      const rect = link.getBoundingClientRect();
      return { right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }),
  );
  const overview = boxes.at(-1);
  if (overview === undefined) throw new Error('the sheet drew no tiles to measure');
  for (const other of boxes) {
    expect(overview.right + EDGE_TOLERANCE_PX, 'Overview must be in the right column').toBeGreaterThanOrEqual(
      other.right,
    );
    expect(overview.bottom + EDGE_TOLERANCE_PX, 'Overview must be in the bottom row').toBeGreaterThanOrEqual(
      other.bottom,
    );
  }
  for (const [index, tile] of boxes.entries()) {
    expect(Math.round(tile.width), `tile ${MORE_TILE_LABELS[index]} is ${tile.width} px wide`).toBeGreaterThanOrEqual(
      TOUCH_TARGET_PX,
    );
    expect(
      Math.round(tile.height),
      `tile ${MORE_TILE_LABELS[index]} is ${tile.height} px tall`,
    ).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }

  // On /diary, a page the bar carries, no tile is the current page.
  await expect(sheet.locator('[aria-current="page"]')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('[data-slot="bottom-nav-more"]'), 'focus must come back to More').toBeFocused();
});

test('a More tile navigates, closes the sheet, and is marked on its own page', async ({ page }) => {
  await page.goto('/diary');

  await moreTab(page).tap();
  const sheet = moreSheet(page);
  await sheet.getByRole('link', { name: EN.nav.trends, exact: true }).tap();
  await page.waitForURL((url) => url.pathname === '/trends');
  await expect(sheet, 'the sheet must close behind the tile').toHaveCount(0);

  // THE CONTROL for the "no tile is current" line above: on a page the sheet does carry, exactly
  // that tile is marked, so the reader can see a mark when there is one.
  await moreTab(page).tap();
  await expect(sheet).toBeVisible();
  const current = sheet.locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(EN.nav.trends);
});

test('the avatar menu carries Settings, and it leads to the settings hub', async ({ page }) => {
  await page.goto('/diary');

  await page.getByRole('button', { name: EN.chrome.deviceMenuLabel }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const settings = menu.getByRole('menuitem', { name: EN.nav.settings, exact: true });
  await expect(settings).toBeVisible();

  await settings.click();
  await page.waitForURL((url) => url.pathname === '/settings');
});

test('the brand mark in the header is a logo, not a door', async ({ page }) => {
  await page.goto('/diary');

  const mark = page.locator('header.sticky img[src^="/icons/icon-192"]').first();
  await expect(mark, 'the mark is still drawn on a phone').toBeVisible();

  const wrapper = await mark.evaluate((element) => {
    const control = element.closest('button, a, [role="button"]');
    return control === null ? null : control.outerHTML.slice(0, 160);
  });
  expect(wrapper, 'nothing around the mark may be a button or a link').toBeNull();
  await expect(
    page.locator('header.sticky [aria-haspopup="dialog"]'),
    'nothing in the header announces a dialog',
  ).toHaveCount(0);

  await mark.tap();
  await expect(page.getByRole('dialog'), 'a tap on the mark opens nothing').toHaveCount(0);
});
