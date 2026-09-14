/**
 * The header's status channel, driven by a real action rather than by an
 * injected message.
 *
 * WHY A REAL ONE. `publishStatus` can be called from a console and will paint
 * a row that looks right; what it will not exercise is the chain that has
 * actually broken here before. Deleting a diary entry publishes the status ON
 * THE ENTRY SCREEN, immediately, and then navigates one level shallower, so
 * the row has to survive a navigation, keep its action callable from a page
 * that has unmounted, and leave the header exactly 64px tall while it does.
 *
 * The three layout numbers are asserted WHILE THE STATUS IS SHOWING, which is
 * the only moment they can be wrong: the status replaces the page title inside
 * the same box, and the wrap that lets a long sentence fit (M225) is what
 * keeps it from pushing the header open or the document wide.
 *
 * AND IN EVERY LANGUAGE (M230). The removed-sentence is the longest thing the
 * header ever says, and a French or Turkish rendering of it is longer than the
 * English the budget was written against. The second spec runs the same
 * delete in each language, with the button and the sentence read out of THAT
 * language's bundle, and measures the same three numbers plus where the slot
 * sits on the phone.
 */
import { expect, test, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import {
  HEADER_HEIGHT,
  PHONE_WIDTH,
  completeOnboarding,
  headerStatusText,
  isHeaderStatusFullyVisible,
  logFoodManually,
  useLanguage,
} from './helpers';
import { EN, catalogFor, fill } from './copy';

/** The entry this spec deletes and puts back. */
const FOOD_NAME = 'Smoke tier porridge';

/** How many grams of it. */
const FOOD_GRAMS = '200';

test('deleting an entry says so in the header, and Undo puts it back', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, { name: FOOD_NAME, grams: FOOD_GRAMS });

  const entryLink = page.getByRole('link', { name: new RegExp(FOOD_NAME, 'u') });
  await entryLink.first().click();
  await page.waitForURL('**/diary/entry/**');
  await page.getByRole('button', { name: EN.entry.action.delete }).click();

  // The status the delete published, word for word out of the shipped bundle.
  await expect
    .poll(() => headerStatusText(page))
    .toBe(fill(EN.entry.toast.removed, { name: FOOD_NAME }));

  const undo = page.getByRole('button', { name: EN.entry.toast.undo, exact: true });
  await expect(undo).toBeVisible();

  // The header's own promise, asserted while the status is on screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(PHONE_WIDTH);
  const headerBox = await page.locator('header').first().boundingBox();
  expect(Math.round(headerBox?.height ?? 0), 'a status must not open the header').toBe(HEADER_HEIGHT);
  expect(await isHeaderStatusFullyVisible(page), 'the status sentence must not be clipped').toBe(true);

  // NON-VACUITY for the restore below: the entry really is gone first. The
  // LINK, not the text: the status sentence carries the food's name too, so a
  // text search would match the header and wait for the message to expire.
  await page.waitForURL(/\/diary$/u);
  await expect(entryLink).toHaveCount(0);

  await undo.click();
  await expect(entryLink).toHaveCount(1);
});

/** The status slot's box, so a sentence that pushed it off the phone is a number and not a picture. */
async function statusSlotBox(page: Page): Promise<{ left: number; right: number }> {
  return page.locator('[data-slot="header-status"]').first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
}

test('the removed-sentence fits the header in every language', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, { name: FOOD_NAME, grams: FOOD_GRAMS });
  const entryLink = page.getByRole('link', { name: new RegExp(FOOD_NAME, 'u') });

  for (const locale of SUPPORTED_LANGUAGES) {
    const copy = catalogFor(locale);
    await useLanguage(page, locale);
    await page.goto('/diary');
    expect(await page.locator('html').getAttribute('lang'), `${locale}: the document is in that language`).toBe(locale);

    await entryLink.first().click();
    await page.waitForURL('**/diary/entry/**');
    await page.getByRole('button', { name: copy.entry.action.delete }).click();

    await expect
      .poll(() => headerStatusText(page), { message: `${locale}: the status is that language's sentence` })
      .toBe(fill(copy.entry.toast.removed, { name: FOOD_NAME }));

    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${locale}: document width`).toBe(PHONE_WIDTH);
    const headerBox = await page.locator('header').first().boundingBox();
    expect(Math.round(headerBox?.height ?? 0), `${locale}: a status must not open the header`).toBe(HEADER_HEIGHT);
    expect(await isHeaderStatusFullyVisible(page), `${locale}: the status sentence must not be clipped`).toBe(true);
    const slot = await statusSlotBox(page);
    expect(slot.left, `${locale}: the slot starts on the phone`).toBeGreaterThanOrEqual(0);
    expect(slot.right, `${locale}: the slot ends on the phone`).toBeLessThanOrEqual(PHONE_WIDTH);

    // Put it back for the next language, through that language's Undo.
    await page.waitForURL(/\/diary$/u);
    await expect(entryLink).toHaveCount(0);
    await page.getByRole('button', { name: copy.entry.toast.undo, exact: true }).click();
    await expect(entryLink).toHaveCount(1);
  }
});
