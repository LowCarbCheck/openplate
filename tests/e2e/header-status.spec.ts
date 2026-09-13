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
 */
import { expect, test } from '@playwright/test';

import {
  HEADER_HEIGHT,
  PHONE_WIDTH,
  completeOnboarding,
  headerStatusText,
  isHeaderStatusFullyVisible,
  logFoodManually,
} from './helpers';
import { EN, fill } from './copy';

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
