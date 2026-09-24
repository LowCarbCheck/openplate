/**
 * The navigation drawer gets a door with a name (reported 2026-09-24).
 *
 * THE REPORT. A person did not know that tapping the brand mark at the top left of the phone
 * header opens the navigation drawer. The mark is a picture, and nothing on it says "menu".
 * Onboarding is not the answer, because people skip it, and the operator does not want a hamburger
 * icon. The operator compared seven mockups and chose a labelled Menu tab as the fifth slot of the
 * bottom bar: Diary, Insights, Scan, Add, Menu. The mark stays a trigger for the people who already
 * learned it, so the drawer now has two doors, and they must open ONE drawer, not two copies.
 *
 * WHAT THIS PROVES:
 *
 * - The bottom bar carries a control whose accessible name AND visible text are the catalog's
 *   `nav.menu`. A tap on it opens the navigation drawer: exactly one dialog, listing the catalog's
 *   Settings and Insights, resting against the RIGHT edge of the screen.
 * - The header mark still opens that same drawer, resting against the LEFT edge.
 * - Focus goes back to whichever door opened it.
 * - Opening and closing it from both doors moves nothing: a `layout-shift` total of 0, and no top
 *   inside `main` changes.
 * - At 360 and 390 px, in all six languages, each of the five labels sits on one line inside its
 *   own slot with nothing cut, and the five slots fit the viewport. The reader is shown able to say
 *   no: an overlong label is injected and must be reported.
 * - The raised Scan circle's centre is the viewport's centre, a tap on that centre reaches the
 *   launcher, and no other control in the bar overlaps the circle's box. Every control in the bar
 *   is at least 44 by 44 px.
 *
 * WHAT IT DOES NOT PROVE:
 *
 * - That a person now finds the drawer. That is the operator's call from the mockups, not a fact a
 *   browser can report.
 * - Which way the panel travels. The spec reads where the panel RESTS once its animation is over,
 *   not the direction it slid in from.
 * - Anything at `md` and wider. The bar and the Menu tab are `md:hidden`; the desktop sidebar is
 *   unchanged and is not read here.
 * - Label fit below 360 px, or in a language the app does not ship.
 *
 * RED BEFORE THE FIX. Against a tree that has the `nav.menu` key and not the tab, the first test
 * stops at "the Menu tab must be in the bottom bar", the fit test counts three slots instead of
 * five, and the geometry test flags the old "more ways to add food" chevron, whose 44 px box sat
 * over the outer edge of the circle.
 *
 * WIDTHS ARE READ FROM `document.documentElement.clientWidth`, never from `innerWidth`: the phone
 * project runs with `isMobile`, and a mobile Chromium zooms out on an overflowing page, which
 * would widen `innerWidth` to fit exactly the overflow this spec exists to catch.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { BOTTOM_BAR } from './clip-baseline';
import { EN, catalogFor } from './copy';
import { completeOnboarding, useLanguage } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  shiftScoreAfter,
} from './layout-shift';

/** The two phone widths every label must fit: the narrow end of the budget and the design width. */
const PHONE_WIDTHS = [360, 390] as const;

/** A generous height, so width is the only thing under test. */
const PHONE_HEIGHT = 844;

/** How many slots the bar carries: Diary, Insights, Scan, Add, Menu. */
const SLOT_COUNT = 5;

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/**
 * How far a rect may pass an edge before it counts. Half a CSS pixel, because at
 * `deviceScaleFactor: 2` a flex row of five splits 360 px into boxes that end on
 * fractional pixels, and a rounding step is not a clipped letter.
 */
const EDGE_TOLERANCE_PX = 0.5;

/** The Menu tab's own handle, for the reads the accessibility tree hides while the drawer is modal. */
const MENU_TAB = '[data-slot="bottom-nav-menu"]';

/** A rect, reduced to the numbers this spec compares. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** One slot of the bar and the words in it. */
interface SlotReading {
  /** The label's words, as drawn. */
  label: string;
  slot: Box;
  labelBox: Box;
  /** The label box's `scrollWidth` and `clientWidth`: more of the first than the second is a word that does not fit. */
  labelScrollWidth: number;
  labelClientWidth: number;
  /** How many line boxes the label's text lays out on. */
  labelLines: number;
}

/** The bar as one reading, with the width it was read against. */
interface BarReading {
  viewportWidth: number;
  slots: SlotReading[];
}

/**
 * Reads every slot of the bottom bar and its label.
 *
 * A SLOT is a direct child of the bar's row, which is a link for a flat tab, a button for Menu and
 * a wrapper for the raised launcher. Its LABEL is the last `span` in it that holds text of its own,
 * which in the launcher is the word under the circle rather than the circle.
 *
 * @param page - a page with the bottom bar on screen.
 * @returns the reading.
 */
async function readBar(page: Page): Promise<BarReading> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE. It cannot see this module's scope, so its
  // helpers cannot move out of it, which is exactly what `consistent-function-scoping` asks for.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate((barSelector) => {
    const toBox = (rect: DOMRect): Box => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const holdsOwnText = (element: Element): boolean =>
      [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );

    const nav = document.querySelector(barSelector);
    if (nav === null) throw new Error('the page has no bottom bar');
    const row = nav.firstElementChild;
    if (row === null) throw new Error('the bottom bar has no row of slots');

    const slots = [...row.children].map((slot) => {
      const label = [...slot.querySelectorAll('span')].findLast(holdsOwnText);
      if (label === undefined) throw new Error(`a bottom bar slot has no label: ${slot.outerHTML.slice(0, 120)}`);
      const range = document.createRange();
      range.selectNodeContents(label);
      const lineTops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      return {
        label: (label.textContent ?? '').trim(),
        slot: toBox(slot.getBoundingClientRect()),
        labelBox: toBox(label.getBoundingClientRect()),
        labelScrollWidth: label.scrollWidth,
        labelClientWidth: label.clientWidth,
        labelLines: lineTops.size,
      };
    });
    return { viewportWidth: document.documentElement.clientWidth, slots };
  }, BOTTOM_BAR);
  // oxlint-enable unicorn/consistent-function-scoping
}

/**
 * Every way a reading breaks the fit rule, one sentence each, so a red line says which label.
 *
 * @param reading - what {@link readBar} found.
 * @returns the offences, empty when every label fits.
 */
function fitOffences(reading: BarReading): string[] {
  const offences: string[] = [];
  const { viewportWidth, slots } = reading;
  for (const [index, entry] of slots.entries()) {
    const name = `slot ${index + 1} "${entry.label}"`;
    if (entry.slot.left < -EDGE_TOLERANCE_PX || entry.slot.right > viewportWidth + EDGE_TOLERANCE_PX) {
      offences.push(`${name} runs past the ${viewportWidth} px viewport (${entry.slot.left} to ${entry.slot.right})`);
    }
    if (entry.labelScrollWidth > entry.labelClientWidth) {
      offences.push(`${name} overflows: ${entry.labelScrollWidth} px of text in a ${entry.labelClientWidth} px box`);
    }
    if (
      entry.labelBox.left < entry.slot.left - EDGE_TOLERANCE_PX ||
      entry.labelBox.right > entry.slot.right + EDGE_TOLERANCE_PX
    ) {
      offences.push(
        `${name} leaves its slot: label ${entry.labelBox.left} to ${entry.labelBox.right}, slot ${entry.slot.left} to ${entry.slot.right}`,
      );
    }
    if (entry.labelLines !== 1) offences.push(`${name} wraps onto ${entry.labelLines} lines`);
  }
  return offences;
}

/** Where the open drawer rests, against the width it was read in. */
async function drawerEdges(drawer: Locator): Promise<{ left: number; right: number; viewportWidth: number }> {
  return drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: document.documentElement.clientWidth };
  });
}

/**
 * Opens the diary on a phone of the given width, with the bar drawn and the fonts loaded, so a
 * width read is of the face the person sees. The language is the one the device cookie already
 * names; `locale` only says which catalog to look for the Menu tab in.
 */
async function openDiaryAt(page: Page, { width, locale }: { width: number; locale: string }): Promise<void> {
  await page.setViewportSize({ width, height: PHONE_HEIGHT });
  await page.goto('/diary');
  const copy = catalogFor(locale);
  await expect(
    page.locator(BOTTOM_BAR).getByRole('button', { name: copy.nav.menu, exact: true }),
    `${locale} at ${width}: the Menu tab must be drawn before the bar is read`,
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test('a labelled Menu tab in the bottom bar opens the navigation drawer from the right', async ({ page }) => {
  await installShiftObserver(page);
  await completeOnboarding(page);
  await page.goto('/diary');

  const menu = page.locator(BOTTOM_BAR).getByRole('button', { name: EN.nav.menu, exact: true });
  await expect(menu, 'the Menu tab must be in the bottom bar').toBeVisible();
  // IN WORDS, not only to a screen reader: an icon with an `aria-label` would pass the line above
  // and leave the sighted person from the report exactly where they were.
  await expect(menu, 'the Menu tab must say what it is on screen').toHaveText(EN.nav.menu);

  await settleAnimations(page);
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  ////////////////////////////////////////////////////////////////////////////
  // The Menu tab: the drawer, from the right
  ////////////////////////////////////////////////////////////////////////////

  await menu.tap();
  const drawer = page.getByRole('dialog');
  await expect(drawer, 'one drawer, not a second copy of it').toHaveCount(1);
  await expect(drawer.getByRole('link', { name: EN.nav.settings, exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: EN.nav.trends, exact: true })).toBeVisible();
  await settleAnimations(page);

  const fromMenu = await drawerEdges(drawer);
  expect(fromMenu.right, 'opened by the Menu tab, the drawer must rest against the right edge').toBeCloseTo(
    fromMenu.viewportWidth,
    0,
  );
  expect(fromMenu.left, 'and it must not cover the whole width').toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(MENU_TAB), 'focus must come back to the Menu tab that opened it').toBeFocused();
  await settleAnimations(page);

  ////////////////////////////////////////////////////////////////////////////
  // The header mark: the same drawer, from the left
  ////////////////////////////////////////////////////////////////////////////

  const mark = page.getByRole('button', { name: EN.chrome.logoMenuLabel });
  await mark.tap();
  await expect(drawer, 'the mark opens the same one drawer').toHaveCount(1);
  await expect(drawer.getByRole('link', { name: EN.nav.settings, exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: EN.nav.trends, exact: true })).toBeVisible();
  await settleAnimations(page);

  const fromMark = await drawerEdges(drawer);
  expect(fromMark.left, 'opened by the header mark, the drawer must rest against the left edge').toBeCloseTo(0, 0);
  expect(fromMark.right, 'and it must not cover the whole width').toBeLessThan(fromMark.viewportWidth);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(mark, 'focus must come back to the mark that opened it').toBeFocused();
  await settleAnimations(page);

  ////////////////////////////////////////////////////////////////////////////
  // Nothing moved, from either door
  ////////////////////////////////////////////////////////////////////////////

  expect(movedBetween(topsBefore, await readTops(page)), 'opening and closing the drawer moved the page').toEqual([]);
  expect(
    shiftScoreAfter(await readShiftEntries(page), shiftsBefore),
    'layout-shift while the drawer opened and closed',
  ).toBe(0);
});

test('every bottom bar label fits its slot on one line at 360 and 390 px, in all six languages', async ({ page }) => {
  await completeOnboarding(page);

  for (const width of PHONE_WIDTHS) {
    for (const locale of SUPPORTED_LANGUAGES) {
      await useLanguage(page, locale);
      await openDiaryAt(page, { width, locale });
      const copy = catalogFor(locale);

      const reading = await readBar(page);
      expect(reading.slots.length, `${locale} at ${width}: the bar must carry ${SLOT_COUNT} slots`).toBe(SLOT_COUNT);
      // NON-VACUITY: the words read are this language's catalog, in bar order, so a page that
      // stayed in English, or a reader pointed at the wrong spans, cannot pass for a fit.
      expect(
        reading.slots.map((entry) => entry.label),
        `${locale} at ${width}: the labels, in bar order`,
      ).toEqual([copy.nav.diary, copy.nav.trends, copy.nav.scan, copy.nav.add, copy.nav.menu]);
      expect(fitOffences(reading), `${locale} at ${width}: a label does not fit`).toEqual([]);
    }
  }
});

test('CONTROL: the fit reader reports an overlong label', async ({ page }) => {
  await completeOnboarding(page);
  await useLanguage(page, 'de');
  await openDiaryAt(page, { width: PHONE_WIDTHS[0], locale: 'de' });

  expect(fitOffences(await readBar(page)), 'the shipped German bar must fit before the injection').toEqual([]);

  // The Add label, the longest word in the bar, written out three times. Nothing else changes, so
  // the reader must report that slot and only that one.
  await page.evaluate((barSelector) => {
    const nav = document.querySelector(barSelector);
    const addSlot = nav?.firstElementChild?.children.item(3) ?? null;
    const label = addSlot === null ? undefined : [...addSlot.querySelectorAll('span')].at(-1);
    if (label === undefined) throw new Error('the Add slot has no label to lengthen');
    label.textContent = (label.textContent ?? '').repeat(3);
  }, BOTTOM_BAR);

  const offences = fitOffences(await readBar(page));
  expect(offences.length, 'the reader must report the overlong label').toBeGreaterThan(0);
  expect(
    offences.every((offence) => offence.startsWith('slot 4 ')),
    `only the lengthened slot may be reported:\n${offences.join('\n')}`,
  ).toBe(true);
});

test('the raised Scan circle stays the exact centre, and no other control covers it', async ({ page }) => {
  await completeOnboarding(page);

  for (const width of PHONE_WIDTHS) {
    await openDiaryAt(page, { width, locale: 'en' });

    // Serialised into the page, as above: its helper cannot live outside it.
    // oxlint-disable unicorn/consistent-function-scoping
    const geometry = await page.evaluate((barSelector) => {
      const toBox = (rect: DOMRect): Box => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
      const nav = document.querySelector(barSelector);
      if (nav === null) throw new Error('the page has no bottom bar');
      const circle = nav.querySelector('span.rounded-full');
      const launcher = circle?.closest('button') ?? null;
      if (circle === null || launcher === null) throw new Error('the bar has no raised circle inside a button');

      const circleBox = toBox(circle.getBoundingClientRect());
      const hit = document.elementFromPoint(circleBox.left + circleBox.width / 2, circleBox.top + circleBox.height / 2);
      const controls = [...nav.querySelectorAll('a, button')].map((control) => ({
        name: (control.getAttribute('aria-label') ?? control.textContent ?? '').trim(),
        isLauncher: control === launcher,
        box: toBox(control.getBoundingClientRect()),
      }));
      return {
        viewportWidth: document.documentElement.clientWidth,
        circle: circleBox,
        centreReachesLauncher: hit !== null && launcher.contains(hit),
        controls,
      };
    }, BOTTOM_BAR);
    // oxlint-enable unicorn/consistent-function-scoping

    const circleCentre = geometry.circle.left + geometry.circle.width / 2;
    expect(circleCentre, `at ${width}: the circle's centre must be the viewport's centre`).toBeCloseTo(
      geometry.viewportWidth / 2,
      0,
    );
    expect(geometry.centreReachesLauncher, `at ${width}: a tap on the circle's centre must reach Scan`).toBe(true);

    const others = geometry.controls.filter((control) => !control.isLauncher);
    expect(others.length, `at ${width}: the bar must carry four controls beside Scan`).toBe(SLOT_COUNT - 1);
    for (const control of others) {
      const overlaps =
        control.box.left < geometry.circle.right - EDGE_TOLERANCE_PX &&
        geometry.circle.left < control.box.right - EDGE_TOLERANCE_PX &&
        control.box.top < geometry.circle.bottom - EDGE_TOLERANCE_PX &&
        geometry.circle.top < control.box.bottom - EDGE_TOLERANCE_PX;
      expect(overlaps, `at ${width}: "${control.name}" covers part of the circle`).toBe(false);
    }

    for (const control of geometry.controls) {
      expect(
        Math.round(control.box.width),
        `at ${width}: "${control.name}" is ${control.box.width} px wide`,
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
      expect(
        Math.round(control.box.height),
        `at ${width}: "${control.name}" is ${control.box.height} px tall`,
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    }
  }
});
