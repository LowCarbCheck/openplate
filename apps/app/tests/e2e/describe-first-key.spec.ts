/**
 * The empty describe composer holds its height on the first key (M255/02).
 *
 * THE DEFECT THIS GUARDS. The composer's example meal is a long placeholder,
 * and at a 390 px phone width it wraps: the empty box was 84 px tall. The
 * first key hides the placeholder, the box then sized itself to one typed
 * letter and dropped to 36 px, and the whole composer block moved under the
 * thumb that was typing. DESIGN.md section 7 forbids exactly that.
 *
 * THE FIX IS A FLOOR, not a shorter sentence. The field keeps the height it
 * has while it shows its placeholder, and only grows once the typed words
 * outgrow it. So every language is walked here, because the German, French
 * and Spanish examples wrap to a different number of lines than the English
 * one, and the pantry's composer is walked too, because it asks its own
 * question with its own example.
 *
 * WHAT EACH READING IS, and the control that makes it able to fail:
 *
 * - The `layout-shift` total across the first key, and across the Backspace
 *   that empties the box again, must be 0. The control pushes a block in
 *   above the composer on the same page and requires the same observer to
 *   see it.
 * - The composer's box, the field's box and the top of the hint line below
 *   them must be unchanged to the pixel. The control types a meal of several
 *   lines, which the person asked for, and requires the same reader to see the
 *   box grow; the same walk proves the ceiling still holds.
 * - The empty field shows its whole placeholder: its content is no taller
 *   than its box, so the floor is not bought by clipping the example.
 *
 * Before the fix, the English meal walk read the composer 84 px tall before
 * the key and 36 px after it, with a shift total above 0.
 */
import { expect, test, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { completeOnboarding, useLanguage } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

/** The diary's composer: a meal. */
const MEAL_COMPOSER_PATH = '/add/describe';

/** The pantry's composer: a shelf, with its own question and its own example. */
const PANTRY_COMPOSER_PATH = '/add/describe?to=/pantry';

/** The field, by the id its hidden label points at. */
const FIELD_SELECTOR = 'textarea#describe-meal';

/** The one box that carries the border, the field and Send. */
const COMPOSER_SELECTOR = '[data-slot="describe-composer"]';

/** The first key a person types. */
const FIRST_KEY = 'p';

/** A meal written a line at a time, taller than any placeholder but under the ceiling. */
const FOUR_LINE_MEAL = 'porridge\nblueberries\nhoney\ntea';

/** A pasted meal past the ceiling, so the field has to scroll. */
const TEN_LINE_MEAL = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

/** The field's ceiling (`max-h-42`), past which it scrolls instead of growing. */
const FIELD_CEILING_PX = 168;

/** How tall a block the control inserts above the composer, to show the shift observer sees a shift. */
const CONTROL_BLOCK_PX = 40;

/** The composer's geometry, rounded to the pixel, measured from the top of the page. */
interface ComposerGeometry {
  composerTop: number;
  composerHeight: number;
  composerWidth: number;
  fieldTop: number;
  fieldHeight: number;
  /** The line under the box that says Enter sends: what sits below the composer. */
  hintTop: number;
}

/** The field's content height against its box, which says whether anything is clipped. */
interface FieldFill {
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Reads the composer's geometry.
 *
 * @param page - a page on one of the two composer screens.
 * @returns the boxes, page-relative so a scroll is never read as a move.
 */
async function readComposer(page: Page): Promise<ComposerGeometry> {
  return page.locator(COMPOSER_SELECTOR).evaluate((composer, fieldSelector) => {
    const field = composer.querySelector(fieldSelector);
    const hint = composer.nextElementSibling;
    if (field === null || hint === null) throw new Error('the composer lost its field or the hint below it');
    const composerRect = composer.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    return {
      composerTop: Math.round(composerRect.top + window.scrollY),
      composerHeight: Math.round(composerRect.height),
      composerWidth: Math.round(composerRect.width),
      fieldTop: Math.round(fieldRect.top + window.scrollY),
      fieldHeight: Math.round(fieldRect.height),
      hintTop: Math.round(hint.getBoundingClientRect().top + window.scrollY),
    };
  }, FIELD_SELECTOR);
}

/**
 * Reads how tall the field's content is against its box. An empty field's
 * content is its placeholder, so this is also how the example meal is read.
 *
 * @param page - a page on one of the two composer screens.
 * @returns the two heights.
 */
async function readFieldFill(page: Page): Promise<FieldFill> {
  return page.locator(FIELD_SELECTOR).evaluate((field) => ({
    scrollHeight: field.scrollHeight,
    clientHeight: field.clientHeight,
  }));
}

/**
 * Opens a composer screen in `language` on a device past onboarding, with the
 * shift observer installed before the first document, and waits until it is
 * at rest.
 *
 * @param page - a fresh page.
 * @param options.path - which composer.
 * @param options.language - the language to render it in.
 */
async function openComposer(page: Page, { path, language }: { path: string; language: LanguageCode }): Promise<void> {
  await installShiftObserver(page);
  await completeOnboarding(page);
  await useLanguage(page, language);
  await page.goto(path);
  // THE CONTROL FOR THE LANGUAGE: a walk that stayed in English would pass in
  // every language for the wrong reason.
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  const field = page.locator(FIELD_SELECTOR);
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('');
  await settleAnimations(page);
}

/**
 * The walk itself: the first key, then the Backspace that empties the box
 * again, and nothing on the screen may move across either.
 *
 * @param page - a page on a composer screen at rest, from `openComposer`.
 * @param what - names the composer and the language in every failure.
 */
async function expectTheFirstKeyMovesNothing(page: Page, what: string): Promise<void> {
  const field = page.locator(FIELD_SELECTOR);
  const atRest = await readComposer(page);
  const topsAtRest = await readTops(page);
  const entriesAtRest = (await readShiftEntries(page)).length;

  // THE PLACEHOLDER IS SHOWN WHOLE, so the height it holds is not bought by
  // clipping the example.
  const emptyFill = await readFieldFill(page);
  expect(emptyFill.scrollHeight, `${what}: the empty field clips its placeholder`).toBeLessThanOrEqual(
    emptyFill.clientHeight,
  );
  test.info().annotations.push({ type: 'empty composer', description: `${what}: ${atRest.composerHeight} px` });

  await field.pressSequentially(FIRST_KEY, { delay: 20 });
  await settleFrames(page);

  // SOFT, all three, so a failure reports every reading and not only the
  // first: the shift says THAT something moved, the boxes say by how much.
  const afterKey = await readShiftEntries(page);
  expect
    .soft(shiftScoreAfter(afterKey, entriesAtRest), `${what}: ${JSON.stringify(afterKey.slice(entriesAtRest))}`)
    .toBe(0);
  expect.soft(await readComposer(page), `${what}: the first key moved or resized the composer`).toEqual(atRest);
  expect.soft(movedBetween(topsAtRest, await readTops(page)), `${what}: the first key moved something`).toEqual([]);

  // EMPTIED AGAIN, the placeholder comes back into the same box.
  const entriesBeforeErase = afterKey.length;
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await settleFrames(page);

  const afterErase = await readShiftEntries(page);
  expect(
    shiftScoreAfter(afterErase, entriesBeforeErase),
    `${what}: ${JSON.stringify(afterErase.slice(entriesBeforeErase))}`,
  ).toBe(0);
  expect(await readComposer(page), `${what}: emptying the box moved or resized the composer`).toEqual(atRest);
}

////////////////////////////////////////////////////////////////////////////////
// The meal composer, in every language the app ships
////////////////////////////////////////////////////////////////////////////////

for (const language of SUPPORTED_LANGUAGES) {
  test(`the first key moves nothing in the meal composer, in ${language}`, async ({ page }) => {
    await openComposer(page, { path: MEAL_COMPOSER_PATH, language });
    await expectTheFirstKeyMovesNothing(page, `the meal composer in ${language}`);
  });
}

////////////////////////////////////////////////////////////////////////////////
// The pantry composer, which asks its own question with its own example
////////////////////////////////////////////////////////////////////////////////

for (const language of ['en', 'de'] as const) {
  test(`the first key moves nothing in the pantry composer, in ${language}`, async ({ page }) => {
    await openComposer(page, { path: PANTRY_COMPOSER_PATH, language });
    await expectTheFirstKeyMovesNothing(page, `the pantry composer in ${language}`);
  });
}

////////////////////////////////////////////////////////////////////////////////
// The controls: the same readers see a real change, and the box still grows
////////////////////////////////////////////////////////////////////////////////

test('the readers see a real change: a long meal grows the box, and a block pushed in is a shift', async ({ page }) => {
  await openComposer(page, { path: MEAL_COMPOSER_PATH, language: 'en' });
  const field = page.locator(FIELD_SELECTOR);
  const atRest = await readComposer(page);

  ////////////////////////////////////////////////////////////////////////////
  // THE BOX READER SEES A CHANGE, and the floor is a floor, not a fixed
  // height: a meal written four lines at a time is taller than any example,
  // and the box grows to show it whole.
  ////////////////////////////////////////////////////////////////////////////
  await field.fill(FOUR_LINE_MEAL);
  await settleFrames(page);
  const grown = await readComposer(page);
  expect(grown.fieldHeight, 'a four-line meal did not grow the field').toBeGreaterThan(atRest.fieldHeight);
  expect(grown.composerHeight - atRest.composerHeight, 'the box reader does not see the box grow').toBe(
    grown.fieldHeight - atRest.fieldHeight,
  );
  const grownFill = await readFieldFill(page);
  expect(grownFill.scrollHeight, 'the four-line meal is clipped').toBeLessThanOrEqual(grownFill.clientHeight);

  // THE CEILING still holds: a long paste scrolls rather than pushing Send off
  // the screen.
  await field.fill(TEN_LINE_MEAL);
  await settleFrames(page);
  expect((await readComposer(page)).fieldHeight, 'the field grew past its ceiling').toBe(FIELD_CEILING_PX);
  const pastedFill = await readFieldFill(page);
  expect(pastedFill.scrollHeight, 'a ten-line paste does not scroll').toBeGreaterThan(pastedFill.clientHeight);

  ////////////////////////////////////////////////////////////////////////////
  // THE SHIFT OBSERVER SEES A SHIFT on the same page.
  ////////////////////////////////////////////////////////////////////////////
  await field.fill('');
  await settleFrames(page);
  const entriesAtControl = (await readShiftEntries(page)).length;
  await page.locator('[data-slot="describe-page"]').evaluate((column, px) => {
    const block = document.createElement('div');
    block.style.height = `${px}px`;
    column.prepend(block);
  }, CONTROL_BLOCK_PX);
  await settleFrames(page);
  await expect
    .poll(async () => shiftScoreAfter(await readShiftEntries(page), entriesAtControl), {
      message: 'the observer does not see a block pushed in above the composer',
    })
    .toBeGreaterThan(0);
});
