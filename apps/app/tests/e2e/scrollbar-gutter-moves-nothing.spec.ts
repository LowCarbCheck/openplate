/**
 * A page that gains or loses its scrollbar moves nothing sideways, and neither does a dialog
 * opening (DESIGN.md section 7, operator report 2026-10-11).
 *
 * ── WHAT THE OPERATOR SAW ────────────────────────────────────────────────
 *
 * In `/admin`, switching from People (long, so the page scrolls) to Invitations (short, so it does
 * not) moved the centred console sideways by the width of a scrollbar. On a desktop with classic
 * scrollbars the free width is `innerWidth` minus the bar, so a page that loses its bar gains that
 * width, and everything centred in it moves by half of it. The same happens on ANY route change
 * between a scrolling and a non-scrolling page, so the fix is global: `html { scrollbar-gutter:
 * stable }` in `app.css`, which keeps the bar's width reserved whether or not the page scrolls.
 *
 * That fix has a side effect this spec also guards. Radix locks the page scroll while a dialog,
 * sheet or menu is open (`react-remove-scroll-bar`). It measures `innerWidth - clientWidth`,
 * hides the bar with `overflow: hidden` and adds a `margin-right` of that width to the body, so
 * the page does not widen when the bar goes. With the gutter reserved the bar's room is already
 * kept, so the measured width is still the full bar, and that margin would be taken a second time:
 * the page would jump LEFT by a scrollbar when a menu or dialog opens. `app.css` cancels the margin.
 *
 * ── WHY THIS TIER MUST BE TOLD TO DRAW A SCROLLBAR ───────────────────────
 *
 * Headless Chromium passes `--hide-scrollbars` by default and the phone project is a mobile
 * emulation that draws overlay bars, so a spec that reads a page here sees a bar of width 0 and
 * can never fail. This file switches to a desktop viewport, turns the mobile emulation off and
 * removes the `--hide-scrollbars` default for its own browser. The first test then reads the bar's
 * width off a probe box and refuses to go on when it is 0: every other check in the file is
 * meaningless without it.
 *
 * ── WHAT IS READ ─────────────────────────────────────────────────────────
 *
 * `getBoundingClientRect().left` of the console's centred column and of the header's avatar
 * button (which is anchored to the right edge, so it moves by the whole bar and not by half of
 * it), and the browser's own `layout-shift` entries. The two pages are made to differ in the
 * only way that matters, whether the document scrolls: the viewport height is set between the
 * height of Invitations and the height of People, measured, not assumed.
 *
 * ── THE CONTROLS ─────────────────────────────────────────────────────────
 *
 * Each reader is shown to see what it exists to catch, in the same live page: with the gutter
 * switched off again (`scrollbar-gutter: auto`) the same tab switch moves the column and the
 * browser records a shift, and with the scroll lock's margin put back the same dialog moves the
 * page. On the code before the fix the first of those is the real failure of the main test.
 *
 * @area admin
 */
import { expect, test, type Page } from '@playwright/test';

import { LONG_INVITE_EMAIL, LONG_PERSON_EMAIL, adminConsoleStub, routeAdminConsole } from './admin-console-stub';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
  type ShiftEntry,
} from './layout-shift';

test.use({
  serviceWorkers: 'block',
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
  // Playwright adds `--hide-scrollbars` to every headless Chromium. Without removing it a page
  // never draws a bar, and the whole file would be reading zeros.
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
});

/** The widest viewport width of the desktop this spec stands in for. */
const DESKTOP_WIDTH = 1280;

/** A viewport short enough that both console pages overflow it, so their full heights can be read. */
const MEASURING_HEIGHT = 300;

/** How much taller than Invitations the viewport is made, so Invitations clearly does not scroll. */
const ROOM_OVER_SHORT_PAGE_PX = 40;

/** The least People must overflow the final viewport by, so it clearly does scroll. */
const LEAST_OVERFLOW_PX = 20;

/** What the page showed at one moment, in CSS px. */
interface PageReading {
  /** The left edge of the console's centred column. */
  columnLeft: number;
  /** The left edge of the header's avatar button, anchored to the right edge of the page. */
  avatarLeft: number;
  /** Whether the document is taller than the window, that is whether it scrolls. */
  isScrolling: boolean;
  /** `innerWidth - documentElement.clientWidth`: the room a scrollbar takes, or the gutter that keeps it. */
  barRoom: number;
}

/**
 * A source the overlay itself owns: the dialog or the menu popping in. Radix slides and zooms them
 * into place, and Chromium counts that as a shift of the dialog's own box (a `dx` of -250 px on
 * the sign-out dialog), which says nothing about the PAGE behind it.
 */
const OVERLAY_SOURCE = /\[(?:alert-dialog|dropdown-menu)-[a-z-]+\]/u;

/**
 * The layout-shift total after `since`, leaving out the entries that only moved the overlay.
 *
 * @param entries - every shift recorded so far.
 * @param since - how many entries had been recorded at the earlier reading.
 * @returns the summed value of the entries that moved something other than the dialog or the menu.
 */
function pageShiftScore(entries: readonly ShiftEntry[], since: number): number {
  return (
    entries
      .slice(since)
      // An entry that names no source is counted: nothing says it was the overlay.
      .filter((entry) => entry.sources.length === 0 || entry.sources.some((source) => !OVERLAY_SOURCE.test(source)))
      .reduce((total, entry) => total + entry.value, 0)
  );
}

/** Rounds to a tenth of a pixel, so two readings of one position are equal. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The positions and the scroll state of the page right now.
 *
 * @param page - a page showing the admin console.
 * @returns the reading.
 */
async function readPage(page: Page): Promise<PageReading> {
  const reading = await page.evaluate(() => {
    // The shell's own page title is the first `h1` in `main`; the console's column is the one
    // that holds an `h1` AND is capped at `max-w-3xl`.
    const column = [...document.querySelectorAll('main h1')]
      .map((heading) => heading.closest('[class*="max-w-3xl"]'))
      .find((candidate) => candidate !== null);
    const avatar = document.querySelector('header [data-slot="avatar-menu-trigger"]');
    if (column === null || column === undefined) throw new Error('the page has no console column');
    if (avatar === null) throw new Error('the header has no avatar button');
    return {
      columnLeft: column.getBoundingClientRect().left,
      avatarLeft: avatar.getBoundingClientRect().left,
      isScrolling: document.documentElement.scrollHeight > window.innerHeight,
      barRoom: window.innerWidth - document.documentElement.clientWidth,
    };
  });
  return { ...reading, columnLeft: tenth(reading.columnLeft), avatarLeft: tenth(reading.avatarLeft) };
}

/**
 * The width of a scrollbar in this browser, read off a probe that is made to scroll.
 *
 * @param page - any loaded page.
 * @returns `offsetWidth - clientWidth` of a 100 px box with `overflow: scroll`; 0 when bars are hidden or overlay.
 */
async function probeScrollbarWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden';
    document.body.append(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  });
}

/** The People page, once its rows are drawn. */
async function showPeople(page: Page): Promise<void> {
  await page.goto('/admin');
  await expect(page.getByText(LONG_PERSON_EMAIL).first()).toBeVisible({ timeout: 15_000 });
  await settleAnimations(page);
}

/** Switches to the Invitations tab the way a person does, with a click, and waits for its rows. */
async function switchToInvitations(page: Page): Promise<void> {
  await page.locator('main a[href="/admin/invitations"]').click();
  await expect(page.getByText(LONG_INVITE_EMAIL).first()).toBeVisible({ timeout: 15_000 });
  await settleAnimations(page);
}

/** Switches back to the People tab with a click, and waits for its rows. */
async function switchToPeople(page: Page): Promise<void> {
  await page.locator('main nav a[href="/admin"]').click();
  await expect(page.getByText(LONG_PERSON_EMAIL).first()).toBeVisible({ timeout: 15_000 });
  await settleAnimations(page);
}

/**
 * Signs in as an administrator on a desktop and sets the viewport height so that People scrolls
 * and Invitations does not.
 *
 * THE HEIGHT IS MEASURED. In a window too short for either page, `scrollHeight` is the page's own
 * height, so the two are read there and the window is then made a little taller than the short
 * one. A fixed height would be a guess about how many rows the stub draws and what a row costs.
 *
 * @param page - a fresh page.
 * @returns nothing; the page is on People, signed in, at the chosen height.
 */
async function openConsoleBetweenTheTwoHeights(page: Page): Promise<void> {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await routeAdminConsole(page, adminConsoleStub());
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  await page.setViewportSize({ width: DESKTOP_WIDTH, height: MEASURING_HEIGHT });
  await showPeople(page);
  const peopleHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await switchToInvitations(page);
  const invitationsHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  const height = invitationsHeight + ROOM_OVER_SHORT_PAGE_PX;
  expect(
    peopleHeight - height,
    `People (${peopleHeight} px) must be taller than Invitations (${invitationsHeight} px) plus ${ROOM_OVER_SHORT_PAGE_PX} px, or no height makes one scroll and not the other`,
  ).toBeGreaterThanOrEqual(LEAST_OVERFLOW_PX);

  await page.setViewportSize({ width: DESKTOP_WIDTH, height });
  await showPeople(page);
}

test('CONTROL: this tier draws a real scrollbar, and the two pages differ in whether they scroll', async ({ page }) => {
  await openConsoleBetweenTheTwoHeights(page);

  const barWidth = await probeScrollbarWidth(page);
  expect(
    barWidth,
    'the probe box must have a scrollbar of its own, or every reading in this file is a zero (--hide-scrollbars, or an overlay bar)',
  ).toBeGreaterThan(0);

  const people = await readPage(page);
  expect(people.isScrolling, 'People must overflow the window').toBe(true);
  expect(people.barRoom, 'and its scrollbar takes the probe width').toBe(barWidth);

  await switchToInvitations(page);
  expect((await readPage(page)).isScrolling, 'Invitations must fit the window').toBe(false);
});

test('switching between a scrolling page and a short one moves nothing sideways', async ({ page }) => {
  await openConsoleBetweenTheTwoHeights(page);
  await settleFrames(page);

  const onPeople = await readPage(page);
  expect(onPeople.isScrolling, 'the walk starts on a page that scrolls').toBe(true);
  const since = (await readShiftEntries(page)).length;

  await switchToInvitations(page);
  await settleFrames(page);
  const onInvitations = await readPage(page);
  expect(onInvitations.isScrolling, 'and goes to a page that does not').toBe(false);
  expect(onInvitations.columnLeft, 'the console column moved when the scrollbar went away').toBe(onPeople.columnLeft);
  expect(onInvitations.avatarLeft, 'the avatar button moved when the scrollbar went away').toBe(onPeople.avatarLeft);

  await switchToPeople(page);
  await settleFrames(page);
  const backOnPeople = await readPage(page);
  expect(backOnPeople.isScrolling, 'and back to the page that scrolls').toBe(true);
  expect(backOnPeople.columnLeft, 'the console column moved when the scrollbar came back').toBe(onPeople.columnLeft);
  expect(backOnPeople.avatarLeft, 'the avatar button moved when the scrollbar came back').toBe(onPeople.avatarLeft);

  const shifts = await readShiftEntries(page);
  expect(
    shiftScoreAfter(shifts, since),
    `the browser recorded a layout shift: ${shifts
      .slice(since)
      .flatMap((entry) => entry.sources)
      .join('; ')}`,
  ).toBe(0);
});

test('opening the header menu and the sign-out dialog moves nothing, on a page that scrolls and one that does not', async ({
  page,
}) => {
  await openConsoleBetweenTheTwoHeights(page);

  for (const tab of ['People', 'Invitations'] as const) {
    if (tab === 'Invitations') await switchToInvitations(page);
    await settleFrames(page);
    const resting = await readPage(page);
    const since = (await readShiftEntries(page)).length;

    await page.locator('header [data-slot="avatar-menu-trigger"]').click();
    const signOut = page.getByRole('menuitem').filter({ has: page.locator('svg.lucide-log-out') });
    await expect(signOut, `${tab}: the menu opens`).toBeVisible();
    await settleAnimations(page);
    expect(
      await page.evaluate(() => document.body.hasAttribute('data-scroll-locked')),
      `${tab}: CONTROL: the menu takes the scroll lock, or this check reads a page nothing locked`,
    ).toBe(true);
    const withMenu = await readPage(page);
    expect(withMenu.columnLeft, `${tab}: the console column moved when the menu opened`).toBe(resting.columnLeft);
    expect(withMenu.avatarLeft, `${tab}: the avatar button moved when the menu opened`).toBe(resting.avatarLeft);

    await signOut.click();
    await expect(page.getByRole('alertdialog'), `${tab}: the dialog opens`).toBeVisible();
    await settleAnimations(page);
    const withDialog = await readPage(page);
    expect(withDialog.columnLeft, `${tab}: the console column moved when the dialog opened`).toBe(resting.columnLeft);
    expect(withDialog.avatarLeft, `${tab}: the avatar button moved when the dialog opened`).toBe(resting.avatarLeft);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await settleAnimations(page);
    const closed = await readPage(page);
    expect(closed.columnLeft, `${tab}: the console column moved when the dialog closed`).toBe(resting.columnLeft);
    expect(closed.avatarLeft, `${tab}: the avatar button moved when the dialog closed`).toBe(resting.avatarLeft);

    const shifts = await readShiftEntries(page);
    expect(
      pageShiftScore(shifts, since),
      `${tab}: the browser recorded a layout shift: ${shifts
        .slice(since)
        .flatMap((entry) => entry.sources)
        .join('; ')}`,
    ).toBe(0);
  }
});

test('CONTROL: with the gutter switched off in the live page, the same tab switch moves the column', async ({
  page,
}) => {
  await openConsoleBetweenTheTwoHeights(page);
  await page.addStyleTag({ content: 'html { scrollbar-gutter: auto !important; }' });
  await settleFrames(page);

  const onPeople = await readPage(page);
  const barWidth = await probeScrollbarWidth(page);
  expect(onPeople.isScrolling).toBe(true);
  const since = (await readShiftEntries(page)).length;

  await switchToInvitations(page);
  await settleFrames(page);
  const onInvitations = await readPage(page);
  expect(onInvitations.isScrolling).toBe(false);

  expect(
    Math.abs(onInvitations.avatarLeft - onPeople.avatarLeft),
    'CONTROL: the avatar button moves by the whole bar when the bar goes',
  ).toBeCloseTo(barWidth, 0);
  expect(
    Math.abs(onInvitations.columnLeft - onPeople.columnLeft),
    'CONTROL: the centred column moves by half the bar',
  ).toBeCloseTo(barWidth / 2, 0);
  expect(
    shiftScoreAfter(await readShiftEntries(page), since),
    'CONTROL: the browser records the sideways move as a layout shift',
  ).toBeGreaterThan(0);
});

test("CONTROL: with the scroll lock's right margin put back, the dialog moves the page", async ({ page }) => {
  await openConsoleBetweenTheTwoHeights(page);
  await switchToInvitations(page);
  await settleFrames(page);
  // `theme` is the first layer Tailwind declares, and for `!important` declarations an EARLIER
  // layer wins, so this beats whatever `app.css` says in `base` (and the library's unlayered rule).
  await page.addStyleTag({ content: '@layer theme { body[data-scroll-locked] { margin-right: 15px !important; } }' });

  const resting = await readPage(page);
  const since = (await readShiftEntries(page)).length;
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await settleAnimations(page);
  const withMenu = await readPage(page);

  expect(
    resting.columnLeft - withMenu.columnLeft,
    'CONTROL: a doubled margin pushes the column left by half the bar',
  ).toBeGreaterThan(0);
  expect(
    pageShiftScore(await readShiftEntries(page), since),
    'CONTROL: the browser records that push as a layout shift of the page, not of the menu',
  ).toBeGreaterThan(0);
});
