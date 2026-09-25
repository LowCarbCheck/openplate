/**
 * The phone bar has three slots (M258, operator decision 2026-09-24), and M259's three corrections.
 *
 * THE REPORT. After a day with the 0.46.0 bar the operator wrote: "too many items in the bottom and
 * the way it opens from 2 spots is weird + settings being closest to the thumb is also weird". Five
 * slots (Diary, Insights, Scan, Add, Menu) and two doors into one drawer (the Menu tab and the brand
 * mark) became, in an interactive playground, this: Diary, a raised plus that opens the add sheet on
 * a TAP, and More, which opens a bottom sheet of tiles for every page the bar does not carry. The
 * most used page sits nearest the thumb. Settings, Plan and Administration lived in the avatar menu
 * only, and the brand mark opened nothing.
 *
 * THE SECOND REPORT (operator, 2026-09-25, a day with 0.47.0 on a phone) corrected three of those:
 * "pressing on the top left icon should open the same menu that the bottom right button opens",
 * "also it should show the settings page that's reachable via the profile menu", and of the add
 * sheet, "the photo option needs to be much more prominent and the first thing you want to click
 * on. it's currently almost hidden". So the mark opens the More sheet (`mark-opens-more.spec.ts`
 * owns that door), the sheet carries a Settings row above its tiles, and the add sheet leads with a
 * large filled photo door in place of the outlined camera key at the end of its strip.
 *
 * WHAT THIS PROVES:
 *
 * - The bar draws exactly three slots, labelled with the catalog's `nav.diary`, `nav.add` and
 *   `nav.more`, in that order.
 * - A tap on the plus opens the add sheet (a long press is no longer needed), and focus comes back
 *   to the plus when it closes.
 * - The add sheet's first door is the photo (M259): the first control the sheet focuses, above the
 *   search row and as wide as it, at least 64 px tall and taller than every other door, filled in
 *   the same colour as the raised plus, and the only camera in the sheet. The strip under it types
 *   and speaks, and has no camera key of its own any more.
 * - The door under it, above the type and speak strip, is the food search. It lands on
 *   `/add/search` with the sheet closed, and it carries the `?date=` of a diary day that is not
 *   today. With the Add tab gone this is the two-tap way to a search the playground listed first;
 *   without it a search took three taps.
 * - A tap on More opens ONE dialog named `nav.more` that rests at the bottom of the screen: its top
 *   edge below the middle of the viewport, its bottom edge on the viewport's bottom edge.
 * - That sheet lists the six pages the bar does not carry, drawer order reversed, so Overview is the
 *   last tile and sits bottom right. Above the tiles, far from the thumb, is one full-width row to
 *   Settings (M259), and there is no Plan or Administration. Every tile is at least 44 by 44 px.
 *   The page on screen is the one tile or row marked current, and More is lit on `/settings`.
 * - A tile or the Settings row navigates and the sheet closes behind it. Escape closes it and focus
 *   returns to More.
 * - The avatar menu still carries Settings on an open instance, and it leads to `/settings`.
 *
 * WHAT IT DOES NOT PROVE:
 *
 * - Label fit in six languages, or that the sheets move nothing. `menu-is-found.spec.ts` owns both.
 * - Plan and Administration in the avatar menu. `plan-nav-entry.spec.ts` walks the plan entry, and
 *   `tests/unit/avatar-menu-door.test.ts` renders the administrator row.
 * - Anything at `md` and wider, where the sidebar is unchanged and the bar is not drawn.
 *
 * RED ON THE OLD BAR. Run against the 0.46.0 build (origin/main 4a8d5ba) before M258, this file
 * failed on every test that reads the bar: five slots where three are expected, a tap on the Scan
 * circle that opened a camera instead of the sheet, no button named "More", and a header mark that
 * was a button announcing a dialog. Only the avatar menu's Settings row passed, because that row
 * already existed. Run against the 0.47.0 build (openplate 2dc8719) before M259, the photo test
 * found no photo door in the add sheet, the plus test found no "Plate photo" button, and both
 * Settings tests found no way to `/settings` in the More sheet.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { BOTTOM_BAR } from './clip-baseline';
import { EN } from './copy';
import { completeOnboarding } from './helpers';
import { settleAnimations } from './layout-shift';

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/** The least height the add sheet's photo door may have: it outranks every other door by size. */
const PHOTO_DOOR_MIN_PX = 64;

/** A More tile, by the slot the sheet gives it. */
const MORE_TILE = '[data-slot="more-tile"]';

/**
 * A control that shows a camera, by the glyph it draws: the photo door's, and the strip's own
 * icon-only key before M259. A glyph rather than a name, because the key carried only an
 * `aria-label` and the door carries visible words, and one reader has to see both.
 */
const CAMERA_CONTROL = ':is(a, button):has(svg.lucide-camera)';

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
  await expect(
    sheet.getByRole('button', { name: EN.launcher.platePhoto, exact: true }),
    "the sheet's photo door",
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(plusButton(page), 'focus must come back to the plus').toBeFocused();
});

test('the add sheet leads with the photo: first, as wide as the search, filled, tallest, and the one camera', async ({
  page,
}) => {
  await page.goto('/diary');

  // THE CONTROL for the camera count below, read first, while the sheet is shut: the same reader
  // pointed at the diary's own strip must see its icon-only camera key. The sheet's strip drew
  // exactly that key until M259, so a strip that grew it back would be counted.
  const stripKey = page.locator('main').getByRole('button', { name: EN.launcher.photo, exact: true }).first();
  await expect(stripKey, "CONTROL: the diary's own strip draws its camera key").toBeVisible();
  expect(
    await stripKey.evaluate((key, selector) => key.parentElement?.querySelectorAll(selector).length ?? 0, CAMERA_CONTROL),
    "CONTROL: the camera reader must count the strip's icon-only key",
  ).toBe(1);

  await plusButton(page).tap();
  const sheet = addSheet(page);
  const photo = sheet.getByRole('button', { name: EN.launcher.platePhoto, exact: true });
  await expect(photo, 'the sheet must offer the photo door').toBeVisible();
  // FIRST FOR A KEYBOARD AND A SCREEN READER TOO: the sheet focuses its first control on opening.
  await expect(photo, 'the photo door must be the first control in the sheet').toBeFocused();
  await settleAnimations(page);

  // Serialised into the page: its helper cannot live outside the callback.
  // oxlint-disable unicorn/consistent-function-scoping
  const read = await sheet.evaluate((content, selector) => {
    const box = (element: Element, name = '') => {
      const rect = element.getBoundingClientRect();
      return { name, top: rect.top, width: rect.width, height: rect.height };
    };
    // The primitive's close key is always the content's last child; every other control is a door.
    const doors = [...content.querySelectorAll('a[href], button')].filter(
      (control) => control !== content.lastElementChild,
    );
    const photoDoor = content.querySelector('[data-slot="add-sheet-photo"]');
    const search = content.querySelector('[data-slot="add-sheet-search"]');
    const circle = document.querySelector('[data-slot="bottom-nav-add"] span.rounded-full');
    if (photoDoor === null || search === null || circle === null) {
      throw new Error('the sheet has no photo door or search row, or the bar no raised circle');
    }
    return {
      firstDoor: doors[0] === photoDoor,
      photo: box(photoDoor),
      search: box(search),
      others: doors
        .filter((door) => door !== photoDoor)
        .map((door) => box(door, (door.getAttribute('aria-label') ?? door.textContent ?? '').trim())),
      photoFill: getComputedStyle(photoDoor).backgroundColor,
      circleFill: getComputedStyle(circle).backgroundColor,
      cameras: content.querySelectorAll(selector).length,
    };
  }, CAMERA_CONTROL);
  // oxlint-enable unicorn/consistent-function-scoping

  expect(read.firstDoor, 'the photo door must come first in the sheet').toBe(true);
  expect(read.photo.top, 'the photo door must sit above the search row').toBeLessThan(read.search.top);
  expect(Math.abs(read.photo.width - read.search.width), 'the photo door must be as wide as the search row').toBeLessThanOrEqual(1);
  expect(read.photo.height, `the photo door is ${read.photo.height} px tall`).toBeGreaterThanOrEqual(PHOTO_DOOR_MIN_PX);
  expect(read.others.length, 'the sheet must carry its other doors to compare against').toBeGreaterThanOrEqual(3);
  for (const other of read.others) {
    expect(other.height, `"${other.name}" must be shorter than the photo door`).toBeLessThan(read.photo.height);
  }
  // THE BRAND FILL, read off the raised plus rather than typed here as a colour, and not nothing.
  expect(read.circleFill, 'the raised circle must be filled').not.toBe('rgba(0, 0, 0, 0)');
  expect(read.photoFill, 'the photo door must wear the raised plus fill').toBe(read.circleFill);
  expect(read.cameras, 'one camera in the sheet: the photo door, and no key in the strip beside it').toBe(1);
});

test('the search door comes after the photo, and it closes the sheet behind it', async ({ page }) => {
  await page.goto('/diary');

  await plusButton(page).tap();
  const sheet = addSheet(page);
  const search = sheet.getByRole('link', { name: EN.launcher.searchFoods, exact: true });
  await expect(search, 'the sheet must offer the food search').toBeVisible();

  // Above the type and speak strip, as the playground listed it: the photo door is the one above it.
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

test('an add sheet closed by Back stays closed on Forward', async ({ page }) => {
  // The More sheet came back on Forward in 9c82669, because React Router restores the old entry's
  // key (counsel review). The add sheet closes on a key change instead of comparing keys, so it
  // should not; this keeps it that way. History both ways by a client navigation.
  // One level DEEPER, because only that pushes: this app replaces a sideways tap
  // (`use-app-navigate.ts`), so a tile from /diary to /trends leaves nothing to go Forward to.
  await page.goto('/settings');
  await page.locator('main a[href="/settings/ai"]').first().click();
  await page.waitForURL((url) => url.pathname === '/settings/ai');

  await plusButton(page).tap();
  await expect(addSheet(page), 'the add sheet must be open before the walk').toBeVisible();

  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/settings');
  await expect(page.locator('[role="dialog"]'), 'Back must close the add sheet').toHaveCount(0);

  await page.goForward();
  await page.waitForURL((url) => url.pathname === '/settings/ai');
  await expect(plusButton(page), 'the Forward page is drawn').toBeVisible();
  // Settled, then read once: a retrying count of 0 passes before a reopened sheet mounts.
  await settleAnimations(page);
  expect(await page.locator('[role="dialog"]').count(), 'Forward must not open the add sheet again').toBe(0);
  expect(await plusButton(page).getAttribute('aria-expanded'), 'the plus must read shut').toBe('false');
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

test('More opens a bottom sheet of six tiles under a Settings row, with no plan or administration', async ({
  page,
}) => {
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

  const tiles = sheet.locator(MORE_TILE);
  await expect(tiles, 'six tiles, one per page the bar does not carry').toHaveCount(MORE_TILE_LABELS.length);
  const names = await tiles.evaluateAll((links) => links.map((link) => (link.textContent ?? '').trim()));
  expect(names, 'the tiles, top left to bottom right').toEqual([...MORE_TILE_LABELS]);
  // Seven ways out in all: the six tiles and the Settings row. Nothing else is a link in here.
  await expect(sheet.getByRole('link'), 'the tiles and the Settings row, and nothing else').toHaveCount(
    MORE_TILE_LABELS.length + 1,
  );

  // SETTINGS IS IN HERE SINCE M259, the rest of the configuration is not. By name and by address,
  // so a renamed row cannot slip through either.
  await expect(sheet.getByRole('link', { name: EN.nav.settings, exact: true }), 'Settings is in the sheet').toHaveCount(1);
  for (const label of [EN.nav.plan, EN.nav.admin]) {
    await expect(sheet.getByRole('link', { name: label, exact: true }), `${label} must not be in the sheet`).toHaveCount(
      0,
    );
  }
  for (const href of ['/settings/plan', '/admin']) {
    await expect(sheet.locator(`a[href="${href}"]`), `${href} must not be in the sheet`).toHaveCount(0);
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

test('the Settings row sits above the tiles, full width, and leads to the settings hub', async ({ page }) => {
  await page.goto('/diary');
  // THE CONTROL for the lit line further down: on a page the bar carries, More is not lit.
  await expect(moreTab(page), 'More is dark on the diary').not.toHaveAttribute('data-active', 'true');

  await moreTab(page).tap();
  const sheet = moreSheet(page);
  await expect(sheet).toBeVisible();
  await settleAnimations(page);

  const settings = sheet.locator('a[href="/settings"]');
  await expect(settings, 'exactly one way to /settings in the sheet').toHaveCount(1);
  await expect(settings, 'named by the catalog, as the avatar menu names it').toHaveAccessibleName(EN.nav.settings);

  // ABOVE THE GRID, FAR FROM THE THUMB: the operator found Settings "closest to the thumb" odd.
  const row = await settings.evaluate((link) => {
    const rect = link.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
  });
  const grid = await sheet.locator(MORE_TILE).evaluateAll((links) =>
    links.map((link) => {
      const rect = link.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top };
    }),
  );
  expect(grid.length, 'the grid must be drawn to compare against').toBe(MORE_TILE_LABELS.length);
  for (const tile of grid) {
    expect(row.top, 'the Settings row must start above every tile').toBeLessThan(tile.top);
    expect(row.bottom, 'the Settings row must end above every tile').toBeLessThanOrEqual(tile.top);
  }
  // As wide as the grid under it: one row, not a seventh tile.
  expect(
    Math.abs(row.left - Math.min(...grid.map((tile) => tile.left))),
    'the row starts where the grid starts',
  ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
  expect(
    Math.abs(row.right - Math.max(...grid.map((tile) => tile.right))),
    'the row ends where the grid ends',
  ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
  expect(Math.round(row.height), `the Settings row is ${row.height} px tall`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);

  await settings.tap();
  await page.waitForURL((url) => url.pathname === '/settings');
  await expect(page.getByRole('dialog'), 'the sheet must close behind the row').toHaveCount(0);

  // ON THE HUB, More is lit and the row is the current page.
  await expect(moreTab(page), 'More is lit on the settings hub').toHaveAttribute('data-active', 'true');
  await moreTab(page).tap();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[aria-current="page"]'), 'one current page in the sheet').toHaveCount(1);
  await expect(settings, 'and it is the Settings row').toHaveAttribute('aria-current', 'page');
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
