/**
 * The allergen chips on the onboarding body step (M219/02 D4c): a person who
 * ticks milk on day one has milk on their profile, and a person who skips the
 * step has nothing.
 *
 * WHAT THIS CATCHES that the unit tier cannot. `allergens.test.ts` renders the
 * fieldset and drives the store directly, so it proves the parts. It cannot
 * prove that a real click on a real chip reaches the real `clientAction`
 * through the wizard's `Form`, and lands on disk through the persister. That
 * is the whole chain, and it is the chain a bug report would name.
 *
 * THE CHIP IS FOUND BY ITS VALUE, never by its label: the label is
 * wordsmith-owned copy, and `input[name="allergens"][value="milk"]` is the
 * contract the action reads. The label wrapping it is what gets the click,
 * because the input itself is `sr-only`.
 *
 * THE READ IS OFF THE DISK, the same `openplate-primary` layout `helpers.ts`
 * reads awards and pantry rows through, and it POLLS, for the reason those
 * readers give: TinyBase saves asynchronously after the transaction, so a read
 * fired the instant the next step paints can beat the save.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';

/** The eating style with no follow-up questions, so the first onboarding step is one click. */
const NEUTRAL_EATING_STYLE = 'just-track';

/**
 * What the DISK says this device's profile lists, or `null` when there is no
 * profile row at all. Three answers, not two, so a poll on this can tell "the
 * row is not there yet" from "the row carries no list", and the skip control
 * below asserts the second rather than passing on the first.
 *
 * @param page - a page on the app's origin.
 * @returns the stored allergen list, `[]` for a row without one, `null` for no row.
 */
async function allergensOnDisk(page: Page): Promise<string[] | null> {
  return page.evaluate(
    () =>
      new Promise<string[] | null>((resolve, reject) => {
        // The database, the object store and the table id `persist.ts` and
        // `schema.ts` name: `openplate-primary`, TinyBase's own tables store
        // `t` with one record per table, and `PROFILE_GOALS_TABLE` is
        // `profileGoals` with its one row `me`.
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('t')) {
            db.close();
            resolve(null);
            return;
          }
          const read = db.transaction('t', 'readonly').objectStore('t').get('profileGoals');
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: TinyBase's IndexedDB persister stores one record per
            // table as `{ k, v }`, with `v` an object keyed by row id, and
            // every primary-store row carries its entity as JSON in the one
            // `entity` cell.
            const record = read.result as { v?: Record<string, { entity?: string }> } | undefined;
            const entity = record?.v?.me?.entity;
            if (entity === undefined) {
              resolve(null);
              return;
            }
            // SAFETY: that cell is written only by the primary store's
            // `writeEntity`, as `JSON.stringify` of a `LocalProfileGoals`,
            // whose `allergens` is an optional string list.
            const profile = JSON.parse(entity) as { allergens?: string[] };
            resolve(profile.allergens ?? []);
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the profile table could not be read'));
          });
        });
      }),
  );
}

/**
 * Walks a fresh device from the front door to the body step, through the real
 * questionnaire, and leaves it there.
 *
 * @param page - a page on a device that has never been used.
 */
async function walkToBodyStep(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();

  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator(`input[name="eatingStyle"][value="${NEUTRAL_EATING_STYLE}"]`).check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();

  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();

  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
}

/** The chip for one allergen on the body step: the label around the hidden checkbox. */
function allergenChip(page: Page, value: string): Locator {
  return page.locator('label').filter({ has: page.locator(`input[name="allergens"][value="${value}"]`) });
}

test('ticking milk on the body step puts milk on the stored profile', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await walkToBodyStep(page);

  // All fourteen are offered, and none is ticked before the person acts, the
  // control that the click below is what ticks it.
  await expect(page.locator('input[name="allergens"]')).toHaveCount(14);
  await expect(page.locator('input[name="allergens"]:checked')).toHaveCount(0);

  await allergenChip(page, 'milk').click();
  await expect(page.locator('input[name="allergens"][value="milk"]')).toBeChecked();
  await expect(page.locator('input[name="allergens"][value="eggs"]')).not.toBeChecked();

  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();

  await expect.poll(() => allergensOnDisk(page), { message: 'the body step save must land on disk' }).toEqual(['milk']);

  expect(pageErrors, 'the walk must raise no uncaught page error').toEqual([]);
});

test('skipping the body step leaves the stored list empty', async ({ page }) => {
  await walkToBodyStep(page);

  // The row exists before the step is answered (the style step wrote it), so
  // an empty answer here is a row without a list, never a missing row.
  await expect.poll(() => allergensOnDisk(page)).toEqual([]);

  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();

  await expect.poll(() => allergensOnDisk(page)).toEqual([]);
});
