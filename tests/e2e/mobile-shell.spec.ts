/**
 * The chrome every screen wears, on the phone it is drawn on: the header, the
 * bar that pins under it, the fixed bottom bar, the public footer, the confirm
 * panel, and the two list surfaces that were drawn a different way from the
 * rest of the app.
 *
 * WHY GEOMETRY, AND WHY `elementFromPoint`. A bounding box says how big a
 * control DRAWS, which is the right question for a link or a row. It is the
 * wrong question for a control whose drawing must stay small: the header's
 * brand mark is sized to the lockup beside it and carries its extra 8px as an
 * `after:` square, which no `getBoundingClientRect` can see. So a target is
 * measured by asking the browser what a finger would land on at the edges of a
 * 44px box, which answers the same question for a real box and for a
 * pseudo-element one. The 60px probe below is the control: the same reader
 * says no when the box is not that big.
 *
 * WHAT WAS MEASURED BEFORE THE FIX (audit, /tmp/op-mobile-shots):
 * - FRONT-15: at scroll 0 on /diary the date bar's top was 80 and the header's
 *   bottom 64, a 16px band of page background between two bars.
 * - FRONT-08, SET-06: the header's drawer trigger 36x36, the Back link 57x20.
 * - SET-04: at 390x430 the header plus the bottom bar were 121 of 430px and
 *   the bar covered the bottom of the focused Height field on /settings/profile.
 * - SET-13: the six public footer links 169x20 on a 28px pitch.
 * - SET-14: the confirm panel's radius 8px against 16px cards.
 * - SET-09, SET-17: the About link values 17px tall; in Turkish at 320 the row
 *   label overflowed its own box and touched its value.
 * - FRONT-22: /add's and /foods' rows drew an 8px radius and 12px padding
 *   where /diary and /meals draw 16 and 16.
 *
 * THE RADIUS IS ZERO NOW. `tests/design-contract.ts` held a three-tier ladder
 * (M243 spec 03) that gave the confirm panel one step and a list row another,
 * so this file compared them instead of pinning a number. The operator
 * squared every corner in the app on 2026-09-22, which retired the ladder;
 * both halves of SET-14 are still asserted, the panel draws a used radius
 * that is not an accident and the two rows still agree with each other, but
 * the number both now read is `SQUARE_CORNER_PX`, zero.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { catalogFor } from './copy';
import { SQUARE_CORNER_PX, LIST_ROW_PADDING_PX } from '../design-contract';
import { completeOnboarding, logFoodManually, useLanguage } from './helpers';

/** The narrow end of the phone budget this app is written against. */
const NARROW_PHONE_WIDTH = 360;

/** The narrowest phone the audit measured, where the Turkish About row broke. */
const NARROWEST_PHONE_WIDTH = 320;

/** A generous height, so width is the only thing under test. */
const PHONE_HEIGHT = 844;

/** A 390px phone with an on-screen keyboard up, which is what the audit measured. */
const KEYBOARD_VIEWPORT = { width: 390, height: 430 };

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/** A probe wider than any control here, so the reader that measures them can say no. */
const OVERSIZED_PROBE_PX = 60;

/**
 * How far short of a box's edge a hit probe has to stop.
 *
 * Measured on this tier's own 2x display: `elementFromPoint` at x 239.4, inside
 * a box ending at 240, came back as the element that starts at 240. So a point
 * within about a pixel of the right or bottom edge belongs to the neighbour,
 * and a probe that aimed at the exact edge would fail on a control that is the
 * right size.
 */
const EDGE_ROUNDING_PX = 1;

/** The languages this walk renders in: the source, the longest, and the one the audit broke in. */
const LOCALES = ['en', 'de', 'tr'] as const;

/** One food, so the diary is long enough to scroll and `/foods` has a row. */
const SEEDED_FOOD = { name: 'Shell walk cheddar', grams: '40', carbs: '1.2' };

////////////////////////////////////////////////////////////////////////////////
// Seeds
////////////////////////////////////////////////////////////////////////////////

/**
 * A device past onboarding, on a narrow phone.
 *
 * THE REAL QUESTIONNAIRE, never a written flag, for the reason at the top of
 * `helpers.ts`: a gate that stopped reading its own marker would still pass a
 * walk that stamped the marker itself.
 *
 * @param page - a page on a device that has never been used.
 * @param width - the viewport width to measure at.
 */
async function aPhonePastOnboarding(page: Page, width = NARROW_PHONE_WIDTH): Promise<void> {
  await completeOnboarding(page);
  await page.setViewportSize({ width, height: PHONE_HEIGHT });
}

/**
 * That device with one hand-typed food on it.
 *
 * The manual form creates a PERSONAL FOOD as well as a diary entry
 * (`putLocalFood`, see `/foods`' module doc), so this one walk seeds both the
 * long diary page and the row `/foods` draws.
 *
 * @param page - a page on a device past onboarding.
 */
async function aPhoneWithOneFood(page: Page): Promise<void> {
  await logFoodManually(page, SEEDED_FOOD);
}

////////////////////////////////////////////////////////////////////////////////
// Readers
////////////////////////////////////////////////////////////////////////////////

/** One probe point that did not land on the control it was aimed at. */
interface MissedPoint {
  where: string;
  hit: string;
}

/**
 * Which edges of a `size` box centred on this control a finger would MISS.
 *
 * THE EDGE MIDPOINTS AND THE CENTRE, not the corners, read with
 * `document.elementFromPoint`. Chromium clips hit testing to the border
 * radius, so the corners of a `rounded-full` control are not tappable at any
 * size and a corner probe would demand a square of every circle. The
 * midpoints ask the question that is actually being asked: is this control at
 * least `size` across, through its middle, in both directions.
 *
 * `elementFromPoint` rather than a bounding box, because a control whose
 * DRAWING must stay small carries its target as an `after:` pseudo-element,
 * which no box read can see and which the browser attributes to the same
 * element. A point off screen returns null and is spelled out as a miss rather
 * than left to an optional chain, which would quietly read as a hit.
 *
 * The probe stops `EDGE_ROUNDING_PX` short of each edge, so it under-reports
 * rather than flakes.
 *
 * @param control - the control to probe.
 * @param size - the box, in CSS pixels, a finger should be able to land in.
 * @returns the points that hit something else, empty when every point lands.
 */
async function missedEdges(control: Locator, size: number): Promise<MissedPoint[]> {
  await control.scrollIntoViewIfNeeded();
  return control.evaluate(
    (element, { probe, inset }) => {
      const box = element.getBoundingClientRect();
      const centreX = box.left + box.width / 2;
      const centreY = box.top + box.height / 2;
      const half = probe / 2 - inset;
      const points = [
        { where: 'left edge', x: centreX - half, y: centreY },
        { where: 'right edge', x: centreX + half, y: centreY },
        { where: 'top edge', x: centreX, y: centreY - half },
        { where: 'bottom edge', x: centreX, y: centreY + half },
        { where: 'centre', x: centreX, y: centreY },
      ];
      return points
        .map((point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          if (hit === null) return { where: point.where, hit: 'nothing, the point is off screen' };
          if (hit === element || element.contains(hit)) return null;
          return { where: point.where, hit: `${hit.tagName.toLowerCase()}.${hit.className.toString().slice(0, 30)}` };
        })
        .filter((miss) => miss !== null);
    },
    { probe: size, inset: EDGE_ROUNDING_PX },
  );
}

/** The distance in CSS pixels between the app header's bottom and this element's top. */
async function gapUnderTheHeader(page: Page, element: Locator): Promise<number> {
  const header = await page.locator('header').first().boundingBox();
  const box = await element.boundingBox();
  if (header === null || box === null) throw new Error('the header and the bar must both be on screen to measure');
  return Math.round(box.y - (header.y + header.height));
}

/** Every element this locator matches, as its drawn height in CSS pixels. */
async function heightsOf(locator: Locator): Promise<number[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().height)),
  );
}

/** The surface one row draws: its radius and its padding, in CSS pixels. */
async function rowSurface(row: Locator): Promise<{ radius: number; padding: number }> {
  return row.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: Number.parseFloat(style.borderTopLeftRadius), padding: Number.parseFloat(style.paddingTop) };
  });
}

/** Every element this locator matches whose own text is wider than its box. */
async function clippedTexts(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) =>
    elements
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map(
        (element) =>
          `${(element.textContent ?? '').trim().slice(0, 30)}: ${element.scrollWidth}/${element.clientWidth}`,
      ),
  );
}

////////////////////////////////////////////////////////////////////////////////
// The bar that pins under the header
////////////////////////////////////////////////////////////////////////////////

test('the diary date bar meets the header at rest and stays there while the page scrolls', async ({ page }) => {
  await aPhonePastOnboarding(page);
  await aPhoneWithOneFood(page);
  await page.goto('/diary');

  const bar = page.locator('[data-slot="sticky-subheader"]');
  // THE ANCHOR AGAINST A VACUOUS PASS: a measurement taken straight after a
  // navigation can land on the hydrate fallback, where there is no bar at all
  // and every distance below would be read off a null box.
  await expect(bar, 'the diary must draw its date bar').toBeVisible();

  expect(await gapUnderTheHeader(page, bar), 'no band of page may show between the header and the date bar').toBe(0);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { message: 'the diary must be long enough to scroll' })
    .toBeGreaterThan(TOUCH_TARGET_PX);

  expect(await gapUnderTheHeader(page, bar), 'the date bar must still pin under the header once scrolled').toBe(0);
});

////////////////////////////////////////////////////////////////////////////////
// The shell's own controls
////////////////////////////////////////////////////////////////////////////////

test('every control in the app shell is a 44px target at 360px, in en, de and tr', async ({ page }) => {
  await aPhonePastOnboarding(page);

  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    const copy = catalogFor(locale);
    await page.goto('/settings/nutrition');

    // Three controls whose DRAWN box is the target, so the box is the honest
    // reading. They were 52x36, 57x20 and 32x32.
    const drawn = {
      'the device menu': page.locator('header button[aria-haspopup="menu"]'),
      'the Back link': page.locator('[data-slot="back-link"]'),
      'the launcher chevron': page.getByRole('button', { name: copy.launcher.moreOptions }),
    };

    for (const [what, control] of Object.entries(drawn)) {
      await expect(control, `${locale}: ${what} must be on screen to be measured`).toBeVisible();
      const box = await control.boundingBox();
      if (box === null) throw new Error(`${locale}: ${what} has no box to measure`);
      expect(Math.round(box.width), `${locale}: ${what} is only ${box.width}px wide`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PX,
      );
      expect(Math.round(box.height), `${locale}: ${what} is only ${box.height}px tall`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PX,
      );
    }

    ////////////////////////////////////////////////////////////////////////////
    // The drawer trigger is the one control here whose drawing must stay 36px:
    // it is sized to the wordmark lockup beside it, and its target is an
    // `after:` square. So the two readers are pointed at the same element and
    // are each other's control. The box reader says 36, which is what makes it
    // a reader that can report a number under the floor at all; the finger
    // reader then says the target is there anyway.
    //
    // The finger reader stops one pixel short of each edge: on this 2x display
    // a point within about a pixel of a box's right or bottom edge is
    // attributed to the neighbour, which was measured on the launcher chevron
    // (a hit at x 239.4 inside a box ending at 240 came back as the tab that
    // starts there). So this proves 42 of the 44, against a drawing of 36.
    ////////////////////////////////////////////////////////////////////////////
    const trigger = page.getByRole('button', { name: copy.chrome.logoMenuLabel });
    await expect(trigger, `${locale}: the drawer trigger must be on screen`).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    if (triggerBox === null) throw new Error(`${locale}: the drawer trigger has no box to measure`);
    expect(triggerBox.height, 'the drawer trigger draws smaller than the floor on purpose').toBeLessThan(
      TOUCH_TARGET_PX,
    );

    expect(
      await missedEdges(trigger, TOUCH_TARGET_PX),
      `${locale}: the drawer trigger misses part of a ${TOUCH_TARGET_PX}px target`,
    ).toEqual([]);
    expect(
      await missedEdges(trigger, OVERSIZED_PROBE_PX),
      `${locale}: the finger reader must be able to report a miss`,
    ).not.toEqual([]);
  }
});

////////////////////////////////////////////////////////////////////////////////
// The bottom bar at keyboard height
////////////////////////////////////////////////////////////////////////////////

test('the bottom bar steps aside for a field on a short viewport and comes back', async ({ page }) => {
  await aPhonePastOnboarding(page);
  await page.setViewportSize(KEYBOARD_VIEWPORT);
  await page.goto('/settings/profile');

  // THE `nav` INSIDE THE WRAPPER, because the wrapper's only child is
  // `fixed` and a box with no flow content of its own reads as hidden however
  // the bar is drawn. The nav is what a reader sees and what covers a field.
  const bar = page.locator('[data-slot="bottom-nav-shell"] nav');
  const height = page.locator('input[name="heightCm"]');
  await expect(bar, 'the bar must be there before a field is focused').toBeVisible();
  await expect(height, 'the Height field must be on the page').toBeVisible();

  const pageHeightBefore = await page.evaluate(() => document.documentElement.scrollHeight);

  await height.focus();
  await expect(bar, 'the bar must step aside while a field is being typed into').toBeHidden();

  const field = await height.boundingBox();
  if (field === null) throw new Error('the focused field must be on screen');
  expect(field.y + field.height, 'the focused field must sit above the bottom of the screen').toBeLessThanOrEqual(
    KEYBOARD_VIEWPORT.height,
  );
  expect(
    await page.evaluate(() => {
      const nav = document.querySelector('[data-slot="bottom-nav-shell"] nav');
      return nav === null ? 0 : nav.getBoundingClientRect().height;
    }),
    'nothing of the bar may be left covering the field',
  ).toBe(0);

  await height.blur();
  await expect(bar, 'the bar must come back once the field is left').toBeVisible();

  // NO SCROLL JUMP: the bar is fixed, so taking it away and putting it back
  // must not change one pixel of the page's own height. An implementation that
  // reclaimed the bar's space by dropping the page's bottom padding would move
  // the content under the reader's thumb and would fail here.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
    'the page must not resize when the bar comes back',
  ).toBe(pageHeightBefore);
});

test('the bottom bar stays on a tall phone while the same field is being typed into', async ({ page }) => {
  await aPhonePastOnboarding(page, KEYBOARD_VIEWPORT.width);
  await page.goto('/settings/profile');

  const bar = page.locator('[data-slot="bottom-nav-shell"] nav');
  const height = page.locator('input[name="heightCm"]');
  await expect(bar).toBeVisible();

  await height.focus();
  await expect(height, 'the field must actually hold the focus').toBeFocused();
  await expect(bar, 'a tall phone has room for the bar and the keyboard both').toBeVisible();
});

////////////////////////////////////////////////////////////////////////////////
// The public footer
////////////////////////////////////////////////////////////////////////////////

test('every public footer link is a 44px target at 360px, in en, de and tr', async ({ page }) => {
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });

  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    await page.goto('/terms');

    const links = page.locator('footer nav a');
    // THE CONTROL AGAINST A VACUOUS PASS: eight links, counted, so a footer that
    // failed to render offers nothing to measure and fails here instead of
    // passing an empty list of heights.
    await expect(links, `${locale}: the footer must draw its eight links`).toHaveCount(8);

    const heights = await heightsOf(links);
    for (const height of heights) {
      expect(
        height,
        `${locale}: a footer link is ${height}px tall, heights: ${heights.join(', ')}`,
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    }
  }
});

////////////////////////////////////////////////////////////////////////////////
// The About page
////////////////////////////////////////////////////////////////////////////////

test('the About link values are row-high targets, and the row keeps its height', async ({ page }) => {
  await aPhonePastOnboarding(page);
  await page.goto('/settings/about');

  const values = page.locator('main a[target="_blank"]');
  await expect(values, 'the About page must draw its provenance links').not.toHaveCount(0);

  const linkHeights = await heightsOf(values);
  for (const height of linkHeights) {
    expect(height, `an About link value is ${height}px tall`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }

  // THE OTHER HALF OF THE CLAIM: the target grew, the row did not. The rows
  // were 48 to 56px tall before; a target that simply grew the row would read
  // 68 here and the page would be longer for nothing.
  const rowHeights = await heightsOf(page.locator('main a[target="_blank"]').locator('xpath=ancestor::div[1]'));
  for (const height of rowHeights) {
    expect(height, `an About row is ${height}px tall`).toBeLessThanOrEqual(56);
  }
});

test('an About row never puts its value on top of its label, at 320px in Turkish', async ({ page }) => {
  await aPhonePastOnboarding(page, NARROWEST_PHONE_WIDTH);
  await useLanguage(page, 'tr');
  await page.goto('/settings/about');

  const labels = page.locator('main a[target="_blank"]').locator('xpath=../preceding-sibling::span[1]');
  await expect(labels, 'the About rows must be drawn to be measured').not.toHaveCount(0);
  expect(await clippedTexts(labels), 'an About row label is wider than the box it was given').toEqual([]);
});

////////////////////////////////////////////////////////////////////////////////
// The confirm panel
////////////////////////////////////////////////////////////////////////////////

test('the confirm panel wears a square corner and its buttons take a thumb', async ({ page }) => {
  await aPhonePastOnboarding(page);
  await aPhoneWithOneFood(page);
  await page.goto('/foods');

  const row = page.locator('[data-slot="custom-food-row"]').first();
  await expect(row, 'the saved food must be listed').toBeVisible();
  await row
    .getByRole('button', { name: catalogFor('en').add.custom.removeAria.replace('{{name}}', SEEDED_FOOD.name) })
    .click();

  const panel = page.locator('[data-slot="alert-dialog-content"]');
  await expect(panel, 'the confirm panel must open').toBeVisible();

  // COMPUTED STYLE, NOT A BOX. The panel animates in with `zoom-in-95`, and a
  // rect read mid-animation is 95 percent of the real one; a used radius and a
  // used height are the numbers the layout decided, before any transform.
  const surface = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: Number.parseFloat(style.borderTopLeftRadius) };
  });
  expect(surface.radius, 'the confirm panel must draw a square corner').toBe(SQUARE_CORNER_PX);

  const buttonHeights = await panel
    .locator('[data-slot="alert-dialog-footer"] button')
    .evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).height)));
  expect(buttonHeights.length, 'the panel must offer both answers').toBe(2);
  for (const height of buttonHeights) {
    expect(height, `a confirm button is ${height}px tall`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }
});

////////////////////////////////////////////////////////////////////////////////
// One row shape
////////////////////////////////////////////////////////////////////////////////

test('the add results and your foods draw the same row, and it fits 360px in en, de and tr', async ({ page }) => {
  await aPhonePastOnboarding(page);
  await aPhoneWithOneFood(page);

  for (const locale of LOCALES) {
    await useLanguage(page, locale);

    // THE QUERY IN THE URL, and a food this device saved. `/add`'s loader reads
    // `?q=`, so the row is drawn without the debounce the search box adds, and
    // a saved food is matched on this device, so the row that gets measured
    // does not depend on the food database answering.
    await page.goto(`/add?q=${encodeURIComponent(SEEDED_FOOD.name)}`);
    const searchRow = page.locator('[data-slot="search-result-row"]').first();
    await expect(searchRow, `${locale}: the search must return a row to measure`).toBeVisible();
    const searchSurface = await rowSurface(searchRow);
    expect(searchSurface, `${locale}: an /add result row`).toEqual({
      radius: SQUARE_CORNER_PX,
      padding: LIST_ROW_PADDING_PX,
    });
    expect(
      await clippedTexts(page.locator('[data-slot="search-result-row"]')),
      `${locale}: an /add row overflows`,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${locale}: /add must fit the phone`).toBe(
      NARROW_PHONE_WIDTH,
    );

    await page.goto('/foods');
    const foodRow = page.locator('[data-slot="custom-food-row"]').first();
    await expect(foodRow, `${locale}: the saved food must be listed`).toBeVisible();
    expect(await rowSurface(foodRow), `${locale}: a /foods row must draw the same surface as an /add row`).toEqual(
      searchSurface,
    );
    expect(
      await clippedTexts(page.locator('[data-slot="custom-food-row"]')),
      `${locale}: a /foods row overflows`,
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${locale}: /foods must fit the phone`,
    ).toBe(NARROW_PHONE_WIDTH);
  }
});
