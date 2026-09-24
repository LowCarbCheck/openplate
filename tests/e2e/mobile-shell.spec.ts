/**
 * The chrome every screen wears, on the phone it is drawn on: the header, the
 * bar that pins under it, the fixed bottom bar, the public footer, the confirm
 * panel, and the two list surfaces that were drawn a different way from the
 * rest of the app.
 *
 * WHY GEOMETRY. A bounding box says how big a control DRAWS, which is the
 * right question for a link, a row or a tab. The header's brand mark used to
 * be the one exception, a 36px drawing that opened the navigation drawer
 * through an `after:` square, and a finger reader built on `elementFromPoint`
 * measured it. The mark is a logo since M258 and opens nothing, so it is no
 * longer a target and that reader went with it.
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

    // Controls whose DRAWN box is the target, so the box is the honest
    // reading. The first two were 52x36 and 57x20. The launcher chevron, 32x32
    // before this spec, left the bar with the move to five slots, and the
    // Menu tab that replaced it here left with the move to three (M258): the
    // bar's two buttons now are the raised plus and More.
    const bar = page.locator('[data-slot="bottom-nav-shell"] nav');
    const drawn = {
      'the device menu': page.locator('header button[aria-haspopup="menu"]'),
      'the Back link': page.locator('[data-slot="back-link"]'),
      'the plus': bar.getByRole('button', { name: copy.nav.add, exact: true }),
      'the More tab': bar.getByRole('button', { name: copy.nav.more, exact: true }),
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
