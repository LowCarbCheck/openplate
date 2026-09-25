/**
 * The three-slot bar and its two sheets fit every language, and they move nothing (M258).
 *
 * THE HISTORY. On 2026-09-24 a person could not find the navigation drawer behind the header's
 * brand mark, so 0.46.0 gave the bar a fifth slot, a labelled Menu tab, and this spec guarded it.
 * The same day the operator tried that bar on a phone and wrote: "too many items in the bottom and
 * the way it opens from 2 spots is weird + settings being closest to the thumb is also weird". The
 * bar they chose in a playground has three slots: Diary, a raised plus that opens the add sheet on
 * a tap, and More, which opens a bottom sheet of tiles. The drawer and its two doors are gone.
 * `three-tab-bar.spec.ts` walks what the new bar does; this file holds the two things a wrong
 * word or a wrong box would break quietly.
 *
 * M259 (operator, 2026-09-25) gave the More sheet a second door, the brand mark at the top left, and
 * a Settings row above its tiles. `mark-opens-more.spec.ts` walks the door; this file adds the row
 * to the fit check and the door to the no-shift check.
 *
 * WHAT THIS PROVES:
 *
 * - At 360 and 390 px, in all six languages, each of the three bar labels sits on one line inside
 *   its own slot with nothing cut, and the three slots fit the viewport. The words read are that
 *   language's catalog, in bar order, so a page left in English cannot pass for a fit.
 * - At the same widths and in the same languages, each of the six More tiles, and the Settings row
 *   above them, holds its label on one line with nothing cut, sits inside the viewport, and is at
 *   least 44 by 44 px.
 * - The readers are shown able to say no: an overlong label is injected into a bar slot, into a
 *   tile and into the Settings row, and each must be reported, and only that one.
 * - Opening and closing the add sheet, the More sheet from the More tab, and the More sheet from
 *   the brand mark moves nothing on the page: a `layout-shift` total of 0, no top inside `main`
 *   changes, and the header's title and wordmark keep their rects.
 * - The raised plus's centre is the viewport's centre, a tap on that centre reaches the plus, and no
 *   other control in the bar overlaps the circle. Every control in the bar is at least 44 by 44 px.
 *
 * WHAT IT DOES NOT PROVE:
 *
 * - That a person finds anything. That is the operator's call from the playground.
 * - Anything at `md` and wider, where the bar is not drawn and the sidebar is unchanged.
 * - Label fit below 360 px, or in a language the app does not ship.
 *
 * RED ON THE OLD BAR. Against the 0.46.0 build the fit test counts five slots where three are
 * expected and reads "Insights" where the plus's label should be, the tile test finds no button
 * named `nav.more` to open, and the geometry test finds the circle inside a slot of five. Against
 * the 0.47.0 build the tile test found no Settings row in the sheet, the control found no row to
 * lengthen, and the shift test found no button in the header to open the sheet from.
 *
 * WIDTHS ARE READ FROM `document.documentElement.clientWidth`, never from `innerWidth`: the phone
 * project runs with `isMobile`, and a mobile Chromium zooms out on an overflowing page, which would
 * widen `innerWidth` to fit exactly the overflow this spec exists to catch.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { BOTTOM_BAR } from './clip-baseline';
import { EN, catalogFor, type Copy } from './copy';
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

/** How many slots the bar carries: Diary, the plus, More. */
const SLOT_COUNT = 3;

/** How many tiles the More sheet carries: every page the bar does not. */
const TILE_COUNT = 6;

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/**
 * How far a rect may pass an edge before it counts. Half a CSS pixel, because at
 * `deviceScaleFactor: 2` a flex row or a grid splits a phone width into boxes that end on
 * fractional pixels, and a rounding step is not a clipped letter.
 */
const EDGE_TOLERANCE_PX = 0.5;

/** A More tile, by the slot the sheet gives it. */
const MORE_TILE = '[data-slot="more-tile"]';

/** A full-width row above the tiles: the configuration rows, which is Settings (M259). */
const MORE_ROW = '[data-slot="more-row"]';

/** The brand mark, a button in the app header since M259, found by the picture it wraps. */
const HEADER_MARK = 'header.sticky button:has(img[src^="/icons/icon-192"])';

/** A rect, reduced to the numbers this spec compares. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** One box that holds a label (a bar slot or a More tile) and the words in it. */
interface LabelledBoxReading {
  /** The label's words, as drawn. */
  label: string;
  box: Box;
  labelBox: Box;
  /** The label box's `scrollWidth` and `clientWidth`: more of the first than the second is a word that does not fit. */
  labelScrollWidth: number;
  labelClientWidth: number;
  /** How many line boxes the label's text lays out on. */
  labelLines: number;
}

/** A row of labelled boxes as one reading, with the width it was read against. */
interface Reading {
  viewportWidth: number;
  boxes: LabelledBoxReading[];
}

/**
 * Reads every box a selector names inside the page, and the label in each.
 *
 * A LABEL is the last `span` in the box that holds text of its own, which in the plus's slot is the
 * word under the circle rather than the circle.
 *
 * @param page - the page to read.
 * @param boxesSelector - selects the boxes, in document order.
 * @returns the reading.
 */
async function readLabelledBoxes(page: Page, boxesSelector: string): Promise<Reading> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE. It cannot see this module's scope, so its
  // helpers cannot move out of it, which is exactly what `consistent-function-scoping` asks for.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate((selector) => {
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

    const boxes = [...document.querySelectorAll(selector)].map((box) => {
      const label = [...box.querySelectorAll('span')].findLast(holdsOwnText);
      if (label === undefined) throw new Error(`a box has no label: ${box.outerHTML.slice(0, 120)}`);
      const range = document.createRange();
      range.selectNodeContents(label);
      const lineTops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      return {
        label: (label.textContent ?? '').trim(),
        box: toBox(box.getBoundingClientRect()),
        labelBox: toBox(label.getBoundingClientRect()),
        labelScrollWidth: label.scrollWidth,
        labelClientWidth: label.clientWidth,
        labelLines: lineTops.size,
      };
    });
    return { viewportWidth: document.documentElement.clientWidth, boxes };
  }, boxesSelector);
  // oxlint-enable unicorn/consistent-function-scoping
}

/** The bar's three slots: the direct children of its row. */
const BAR_SLOTS = `${BOTTOM_BAR} > div > *`;

/**
 * Every way a reading breaks the fit rule, one sentence each, so a red line says which label.
 *
 * @param reading - what {@link readLabelledBoxes} found.
 * @param what - "slot" or "tile", for the sentence.
 * @returns the offences, empty when every label fits.
 */
function fitOffences(reading: Reading, what: string): string[] {
  const offences: string[] = [];
  const { viewportWidth, boxes } = reading;
  for (const [index, entry] of boxes.entries()) {
    const name = `${what} ${index + 1} "${entry.label}"`;
    if (entry.box.left < -EDGE_TOLERANCE_PX || entry.box.right > viewportWidth + EDGE_TOLERANCE_PX) {
      offences.push(`${name} runs past the ${viewportWidth} px viewport (${entry.box.left} to ${entry.box.right})`);
    }
    if (entry.labelScrollWidth > entry.labelClientWidth) {
      offences.push(`${name} overflows: ${entry.labelScrollWidth} px of text in a ${entry.labelClientWidth} px box`);
    }
    if (
      entry.labelBox.left < entry.box.left - EDGE_TOLERANCE_PX ||
      entry.labelBox.right > entry.box.right + EDGE_TOLERANCE_PX
    ) {
      offences.push(
        `${name} leaves its box: label ${entry.labelBox.left} to ${entry.labelBox.right}, box ${entry.box.left} to ${entry.box.right}`,
      );
    }
    if (entry.labelLines !== 1) offences.push(`${name} wraps onto ${entry.labelLines} lines`);
  }
  return offences;
}

/**
 * The header's title and wordmark rects, which a door in the header could push: the header is
 * sticky, so `readTops` leaves it out.
 */
async function readHeaderText(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    ['header.sticky h1', 'header.sticky [data-slot="header-brand-kicker"]'].map((selector) => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`the header has no ${selector}`);
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }),
  );
}

/** The bar's More tab, in one language. */
function moreTab(page: Page, copy: Copy): Locator {
  return page.locator(BOTTOM_BAR).getByRole('button', { name: copy.nav.more, exact: true });
}

/**
 * Opens the diary on a phone of the given width, with the bar drawn and the fonts loaded, so a
 * width read is of the face the person sees. The language is the one the device cookie already
 * names; `locale` only says which catalog to look for the More tab in.
 */
async function openDiaryAt(page: Page, { width, locale }: { width: number; locale: string }): Promise<void> {
  await page.setViewportSize({ width, height: PHONE_HEIGHT });
  await page.goto('/diary');
  await expect(
    moreTab(page, catalogFor(locale)),
    `${locale} at ${width}: the More tab must be drawn before the bar is read`,
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * Opens the More sheet and waits until its slide is over, so every box is read where it rests.
 *
 * @returns the open sheet.
 */
async function openMoreSheet(page: Page, copy: Copy): Promise<Locator> {
  await moreTab(page, copy).click();
  const sheet = page.getByRole('dialog', { name: copy.nav.more, exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(MORE_TILE)).toHaveCount(TILE_COUNT);
  await settleAnimations(page);
  return sheet;
}

test('every bottom bar label fits its slot on one line at 360 and 390 px, in all six languages', async ({ page }) => {
  await completeOnboarding(page);

  for (const width of PHONE_WIDTHS) {
    for (const locale of SUPPORTED_LANGUAGES) {
      await useLanguage(page, locale);
      await openDiaryAt(page, { width, locale });
      const copy = catalogFor(locale);

      const reading = await readLabelledBoxes(page, BAR_SLOTS);
      expect(reading.boxes.length, `${locale} at ${width}: the bar must carry ${SLOT_COUNT} slots`).toBe(SLOT_COUNT);
      // NON-VACUITY: the words read are this language's catalog, in bar order, so a page that
      // stayed in English, or a reader pointed at the wrong spans, cannot pass for a fit.
      expect(
        reading.boxes.map((entry) => entry.label),
        `${locale} at ${width}: the labels, in bar order`,
      ).toEqual([copy.nav.diary, copy.nav.add, copy.nav.more]);
      expect(fitOffences(reading, 'slot'), `${locale} at ${width}: a bar label does not fit`).toEqual([]);
    }
  }
});

test('every More tile holds its label on one line at 360 and 390 px, in all six languages', async ({ page }) => {
  await completeOnboarding(page);

  for (const width of PHONE_WIDTHS) {
    for (const locale of SUPPORTED_LANGUAGES) {
      await useLanguage(page, locale);
      await openDiaryAt(page, { width, locale });
      const copy = catalogFor(locale);
      await openMoreSheet(page, copy);

      const reading = await readLabelledBoxes(page, MORE_TILE);
      // NON-VACUITY, as for the bar: this language's words, in tile order.
      expect(
        reading.boxes.map((entry) => entry.label),
        `${locale} at ${width}: the tiles, top left to bottom right`,
      ).toEqual([
        copy.nav.goals,
        copy.nav.nutrients,
        copy.nav.trends,
        copy.nav.fasting,
        copy.nav.pantry,
        copy.nav.dashboard,
      ]);
      expect(fitOffences(reading, 'tile'), `${locale} at ${width}: a tile label does not fit`).toEqual([]);

      // THE SETTINGS ROW ABOVE THEM, read by the same reader: one row, in this language.
      const rows = await readLabelledBoxes(page, MORE_ROW);
      expect(
        rows.boxes.map((entry) => entry.label),
        `${locale} at ${width}: the row above the tiles`,
      ).toEqual([copy.nav.settings]);
      expect(fitOffences(rows, 'row'), `${locale} at ${width}: the Settings label does not fit`).toEqual([]);

      for (const entry of [...reading.boxes, ...rows.boxes]) {
        expect(
          Math.round(entry.box.width),
          `${locale} at ${width}: "${entry.label}" is ${entry.box.width} px wide`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
        expect(
          Math.round(entry.box.height),
          `${locale} at ${width}: "${entry.label}" is ${entry.box.height} px tall`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
      }

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
});

test('CONTROL: both fit readers report an overlong label, and only that one', async ({ page }) => {
  await completeOnboarding(page);
  await useLanguage(page, 'de');
  await openDiaryAt(page, { width: PHONE_WIDTHS[0], locale: 'de' });
  const copy = catalogFor('de');

  expect(fitOffences(await readLabelledBoxes(page, BAR_SLOTS), 'slot'), 'the shipped German bar must fit').toEqual([]);

  // The plus's label, "Hinzufügen", written out three times. Nothing else changes, so the reader
  // must report that slot and only that one.
  await page.evaluate((selector) => {
    const label = [...(document.querySelectorAll(selector).item(1)?.querySelectorAll('span') ?? [])].at(-1);
    if (label === undefined) throw new Error('the plus slot has no label to lengthen');
    label.textContent = (label.textContent ?? '').repeat(3);
  }, BAR_SLOTS);
  const barOffences = fitOffences(await readLabelledBoxes(page, BAR_SLOTS), 'slot');
  expect(barOffences.length, 'the bar reader must report the overlong label').toBeGreaterThan(0);
  expect(
    barOffences.every((offence) => offence.startsWith('slot 2 ')),
    `only the lengthened slot may be reported:\n${barOffences.join('\n')}`,
  ).toBe(true);

  // The same for a tile: the first one, "Ziele", written out six times.
  await page.goto('/diary');
  await openMoreSheet(page, copy);
  expect(fitOffences(await readLabelledBoxes(page, MORE_TILE), 'tile'), 'the shipped German tiles must fit').toEqual(
    [],
  );
  await page.evaluate((selector) => {
    const label = document.querySelector(`${selector} span`);
    if (label === null) throw new Error('the first tile has no label to lengthen');
    label.textContent = (label.textContent ?? '').repeat(6);
  }, MORE_TILE);
  const tileOffences = fitOffences(await readLabelledBoxes(page, MORE_TILE), 'tile');
  expect(tileOffences.length, 'the tile reader must report the overlong label').toBeGreaterThan(0);
  expect(
    tileOffences.every((offence) => offence.startsWith('tile 1 ')),
    `only the lengthened tile may be reported:\n${tileOffences.join('\n')}`,
  ).toBe(true);

  // And for the Settings row, "Einstellungen" written out six times: the row reader must report it.
  expect(fitOffences(await readLabelledBoxes(page, MORE_ROW), 'row'), 'the shipped German row must fit').toEqual([]);
  await page.evaluate((selector) => {
    const label = [...(document.querySelector(selector)?.querySelectorAll('span') ?? [])].at(-1);
    if (label === undefined) throw new Error('the Settings row has no label to lengthen');
    label.textContent = (label.textContent ?? '').repeat(6);
  }, MORE_ROW);
  const rowOffences = fitOffences(await readLabelledBoxes(page, MORE_ROW), 'row');
  expect(rowOffences.length, 'the row reader must report the overlong label').toBeGreaterThan(0);
  expect(
    rowOffences.every((offence) => offence.startsWith('row 1 ')),
    `only the lengthened row may be reported:\n${rowOffences.join('\n')}`,
  ).toBe(true);
});

test('opening and closing the add sheet, and the More sheet from either door, moves nothing', async ({ page }) => {
  await installShiftObserver(page);
  await completeOnboarding(page);
  await page.goto('/diary');
  await expect(moreTab(page, EN)).toBeVisible();

  await settleAnimations(page);
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  const barBefore = await page.locator(BOTTOM_BAR).boundingBox();
  const headerTextBefore = await readHeaderText(page);

  // The add sheet, by the plus.
  await page.locator(BOTTOM_BAR).getByRole('button', { name: EN.nav.add, exact: true }).click();
  const addSheet = page.getByRole('dialog', { name: EN.launcher.sheetTitle, exact: true });
  await expect(addSheet).toBeVisible();
  await settleAnimations(page);
  await page.keyboard.press('Escape');
  await expect(addSheet).toHaveCount(0);
  await settleAnimations(page);

  // The More sheet, by More.
  await openMoreSheet(page, EN);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settleAnimations(page);

  // The same sheet, by the brand mark (M259).
  await page.locator(HEADER_MARK).click();
  await expect(page.getByRole('dialog', { name: EN.nav.more, exact: true })).toBeVisible();
  await settleAnimations(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settleAnimations(page);

  expect(movedBetween(topsBefore, await readTops(page)), 'opening and closing a sheet moved the page').toEqual([]);
  expect(
    shiftScoreAfter(await readShiftEntries(page), shiftsBefore),
    `layout-shift while the sheets opened and closed: ${JSON.stringify((await readShiftEntries(page)).slice(shiftsBefore))}`,
  ).toBe(0);
  expect(await page.locator(BOTTOM_BAR).boundingBox(), 'the bar itself must not move or resize').toEqual(barBefore);
  expect(await readHeaderText(page), 'the header title and wordmark must not move').toEqual(headerTextBefore);
});

test('the raised plus stays the exact centre, and no other control covers it', async ({ page }) => {
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
      const plus = nav.querySelector('[data-slot="bottom-nav-add"]');
      const circle = plus?.querySelector('span.rounded-full') ?? null;
      if (plus === null || circle === null) throw new Error('the bar has no raised circle inside the plus');

      const circleBox = toBox(circle.getBoundingClientRect());
      const hit = document.elementFromPoint(circleBox.left + circleBox.width / 2, circleBox.top + circleBox.height / 2);
      const controls = [...nav.querySelectorAll('a, button')].map((control) => ({
        name: (control.getAttribute('aria-label') ?? control.textContent ?? '').trim(),
        isPlus: control === plus,
        box: toBox(control.getBoundingClientRect()),
      }));
      return {
        viewportWidth: document.documentElement.clientWidth,
        circle: circleBox,
        centreReachesPlus: hit !== null && plus.contains(hit),
        controls,
      };
    }, BOTTOM_BAR);
    // oxlint-enable unicorn/consistent-function-scoping

    const circleCentre = geometry.circle.left + geometry.circle.width / 2;
    expect(circleCentre, `at ${width}: the circle's centre must be the viewport's centre`).toBeCloseTo(
      geometry.viewportWidth / 2,
      0,
    );
    expect(geometry.centreReachesPlus, `at ${width}: a tap on the circle's centre must reach the plus`).toBe(true);

    const others = geometry.controls.filter((control) => !control.isPlus);
    expect(others.length, `at ${width}: the bar must carry two controls beside the plus`).toBe(SLOT_COUNT - 1);
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
