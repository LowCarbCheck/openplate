/**
 * A SECOND PHOTOGRAPH OF THE SHELF MUST NOT EMPTY THE FIRST ONE.
 *
 * ── The defect this walk exists for ──────────────────────────────────────
 *
 * `/pantry` reconciled every save against the rows ON SCREEN, so that a line
 * the person deleted in the list editor was deleted from the store. On the
 * REVIEW arrival the rows on screen are the new reading and nothing else, so
 * the same reconcile read "this photograph did not name butter" as "the person
 * removed butter", and the second photograph replaced the shelf instead of
 * adding to it. A save from a reading is ADDITIVE now; a save from the list is
 * still the whole list.
 *
 * Neither existing check could see it. `pantry-merge.test.ts` drives the pure
 * merge, which never removes anything, and `pantry-to-recipe.spec.ts` starts
 * from an EMPTY pantry and photographs once. The store has to be NON-EMPTY
 * before the capture for the defect to exist at all, which is what this walk
 * arranges.
 *
 * ── And the photograph must land in the pantry, not in the diary ─────────
 *
 * Both surfaces take a photograph through the same composer, so the last
 * assertion here is that nothing named after a shelf item reached the diary.
 * Its control is a food logged by hand: the same probe on the same page finds
 * that one, so the four absences are a fact about the pantry path rather than
 * a blind locator.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_APP_URL } from './env';
import {
  completeOnboarding,
  connectStubAiProvider,
  logFoodManually,
  pantryRowNames,
  pantryRows,
  pantryRowsOnDisk,
} from './helpers';

/** The stub provider's chat endpoint, the one `connectStubAiProvider` connects the device to. */
const CHAT_COMPLETIONS_URL = `${E2E_APP_URL}/e2e-stub-provider/v1/chat/completions`;

/** The first photograph's two items. */
const EGGS = 'Second photo eggs';
const SPINACH = 'Second photo spinach';

/** The second photograph's two, which name neither of the above. */
const BUTTER = 'Second photo butter';
const MILK = 'Second photo milk';

/** What the diary shows at the end, and the control for the four absences beside it. */
const CONTROL_FOOD = 'Second photo control food';

/** A valid 1 x 1 RGBA PNG, the smallest thing `validatePhoto` and the canvas downscale both accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** One pantry reading, with every field `PantryIdentificationSchema` requires. */
function pantryAnswer(names: readonly string[]) {
  return {
    items: names.map((name) => ({ name, amount: 1, unit: 'piece', category: 'other', confidence: 'high' })),
    notes: null,
  };
}

/** The request body this fake reads. Only the one field that names the task. */
interface TaskNamingRequest {
  response_format?: { json_schema?: { name?: string } };
}

/**
 * Answers the pantry task with a DIFFERENT shelf each time it is asked.
 *
 * The two readings have no name in common, so the union is four rows and a
 * reading that replaced the shelf is two. Counting the calls rather than
 * reading the image is the only way to tell one photograph from another here:
 * both are the same pixel.
 *
 * @param page - the page to install the handler on, before it is navigated.
 */
async function fakeTwoShelves(page: Page): Promise<void> {
  const shelves = [
    [EGGS, SPINACH],
    [BUTTER, MILK],
  ];
  let asked = 0;

  await page.route(CHAT_COMPLETIONS_URL, (route) => {
    // SAFETY: the body is this app's own request, built by
    // `openai-compatible.ts`, and only its schema name is read below. A body
    // without one falls through to the refusal.
    const body = route.request().postDataJSON() as TaskNamingRequest;
    const schemaName = body.response_format?.json_schema?.name ?? '';
    const shelf = shelves[asked];
    // REFUSED, NOT GUESSED: a task this fake does not know is a task whose
    // name moved, and a third reading is a walk that asked for something this
    // spec never meant to answer.
    if (schemaName !== 'pantry_identification' || shelf === undefined) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: `no answer for '${schemaName}', reading ${asked + 1}` } }),
      });
    }
    asked += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(pantryAnswer(shelf)) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    });
  });
}

/**
 * Photographs the shelf through the composer on `/pantry` and confirms what
 * comes back, unedited.
 *
 * THE COMPOSER'S OWN CAMERA INPUT. There are two capture inputs on this
 * screen: this one, which reads a shelf into the pantry, and the tab bar's
 * raised launcher, which photographs a plate for `/add/photo`. Scoping to the
 * page's own column picks the pantry's, since the tab bar is not in it.
 *
 * @param page - a page showing `/pantry`.
 * @param expectedRows - how many rows the reading must show before it is confirmed.
 */
async function photographTheShelf(page: Page, expectedRows: number): Promise<void> {
  await page
    .locator('main div.max-w-xl input[type="file"][capture]')
    .setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect(page.getByText(EN.pantry.review.title)).toBeVisible();
  await expect(pantryRows(page)).toHaveCount(expectedRows);
  await page.getByRole('button', { name: EN.pantry.review.confirm }).click();
}

test('a second photograph adds to the shelf instead of replacing it', async ({ page }) => {
  await fakeTwoShelves(page);
  await completeOnboarding(page);
  await connectStubAiProvider(page);

  await page.goto('/pantry');
  await photographTheShelf(page, 2);

  // WAIT FOR THE SAVE. The persister writes after the transaction, so the
  // second photograph fired on the re-render can beat it.
  await expect.poll(() => pantryRowsOnDisk(page)).toBe(2);
  await expect(pantryRows(page)).toHaveCount(2);
  expect((await pantryRowNames(page)).toSorted()).toEqual([EGGS, SPINACH].toSorted());

  // THE SECOND PHOTOGRAPH, of a shelf with nothing in common with the first.
  // Its review shows the READING, two rows, which is exactly the state that
  // used to be read as "the person removed the other two".
  await photographTheShelf(page, 2);
  await expect.poll(() => pantryRowsOnDisk(page)).toBe(4);

  // THE RELOAD IS THE POINT: a full document load throws away every piece of
  // in-memory state, so what comes back came out of IndexedDB.
  await page.goto('/pantry');
  await expect(pantryRows(page)).toHaveCount(4);
  // THE UNION, compared as a SET: the order rows are stored in is the merge's
  // business and not a promise to anybody.
  expect((await pantryRowNames(page)).toSorted()).toEqual([EGGS, SPINACH, BUTTER, MILK].toSorted());

  // A REMOVAL STILL REMOVES, which is the control for everything above: if the
  // save had simply stopped reconciling against the rows, this would leave
  // four rows on disk.
  await page.getByRole('button', { name: fill(EN.pantry.review.removeAria, { name: MILK }) }).click();
  await expect(pantryRows(page)).toHaveCount(3);
  await page.getByRole('button', { name: EN.pantry.review.saveList }).click();
  await expect.poll(() => pantryRowsOnDisk(page)).toBe(3);

  await page.goto('/pantry');
  // The count first, which WAITS: `pantryRowNames` reads the DOM once, so a
  // bare read here would race the client loader and see an empty page.
  await expect(pantryRows(page)).toHaveCount(3);
  expect((await pantryRowNames(page)).toSorted()).toEqual([EGGS, SPINACH, BUTTER].toSorted());

  // NOTHING PHOTOGRAPHED INTO THE PANTRY REACHED THE DIARY. The control is the
  // hand-logged food: the same probe on the same page finds it, so the three
  // absences below are a fact about the pantry path.
  await logFoodManually(page, { name: CONTROL_FOOD, grams: '100' });
  await page.goto('/diary');
  await expect(page.locator('main').getByText(CONTROL_FOOD).first()).toBeVisible();
  for (const name of [EGGS, SPINACH, BUTTER]) {
    await expect(page.locator('main').getByText(name)).toHaveCount(0);
  }
});
