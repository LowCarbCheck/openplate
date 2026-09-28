/**
 * One food, typed by hand, still there after a reload.
 *
 * WHY THE MANUAL PATH and not the search. `/add`'s search asks this app's
 * server, which asks the food database over the network; a smoke tier that
 * depended on it would go red when somebody else's service was slow. "Can't
 * find it? Add manually" is the same action with no third party in it.
 *
 * WHY THE RELOAD IS THE ASSERTION. The diary lives in IndexedDB, and every
 * route that writes it is a `clientAction`. A write that only ever reached
 * React state renders a perfect diary and loses it on the next navigation,
 * which is exactly the class of defect this repo has shipped before. Reading
 * the entry back after a full document load is what tells the two apart.
 */
import { expect, test } from '@playwright/test';

import { completeOnboarding, expectPhoneLayout, logFoodManually } from './helpers';

/** A name no food database would return, so a passing assertion can only be this entry. */
const FOOD_NAME = 'Smoke tier lentils';

/** How much of it, in grams. */
const FOOD_GRAMS = '150';

test('a food typed into the manual form is in the diary after a reload', async ({ page }) => {
  await completeOnboarding(page);

  await logFoodManually(page, { name: FOOD_NAME, grams: FOOD_GRAMS });

  // THE RELOAD IS THE POINT: a full document load throws away every piece of
  // in-memory state, so what comes back came out of IndexedDB.
  await page.reload();
  await expect(page.getByText(FOOD_NAME)).toBeVisible();
  await expectPhoneLayout(page);
});
