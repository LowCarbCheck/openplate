/**
 * One photograph of a shelf, all the way to one logged serving (M233/05).
 *
 * THE WALK. Dashboard door, `/pantry`, a photo through the composer's own
 * camera input, three editable rows, one removed, kept, RELOADED, "Suggest a
 * meal", two cards with a "left" figure each, "Log this" on the first, and one
 * new diary entry in the slot the recipe screen was working for.
 *
 * WHY THE RELOAD IS IN THE MIDDLE OF IT. The pantry lives in IndexedDB and
 * every write on that screen is a client action, so a list that only ever
 * reached React state renders perfectly and is gone on the next navigation,
 * which is a defect class this repository has shipped before
 * (`log-a-food.spec.ts` states it at length). Reading two rows back after a
 * full document load is what tells the two apart.
 *
 * WHY THE MODEL IS FAKED AND NOT CALLED. Both screens call the person's OWN
 * provider from the browser (BYOK), so this spec connects a self-hosted
 * `openai-compatible` endpoint through the real AI settings form and answers
 * its requests with `page.route`. Nothing is spent, nothing leaves the
 * machine, and both answers are real chat-completions envelopes that go
 * through the shipped Zod parses. The endpoint is this app's OWN origin on a
 * path nothing serves, for the two reasons `scan-review.spec.ts` records: the
 * production CSP's `connect-src` only allows an origin it knows about plus
 * `'self'`, and a same-origin address needs no CORS preflight, which
 * `page.route` does not answer.
 *
 * HOW ONE FAKE ANSWERS TWO TASKS. The two screens send two different tasks to
 * the same endpoint, and the task is named on the wire: the adapter puts the
 * descriptor's `schemaName` in `response_format.json_schema.name`
 * (`app/services/vision/openai-compatible.ts`). So the handler reads that name
 * and answers the pantry task with items and the recipe task with recipes. An
 * unknown name is refused with a 400 rather than answered with something
 * plausible, so a renamed schema fails here instead of quietly getting the
 * wrong shape.
 *
 * WHICH SLOT THE ENTRY MUST BE IN, without a clock race. The recipe screen
 * picks its slot from the hour and offers it in a select whose hidden input
 * carries the value. This spec READS that input before logging and asserts the
 * diary entry sits in that meal group, so the assertion is about the slot the
 * screen actually used rather than about a slot recomputed here at a different
 * instant.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, pantryRows, pantryRowNames, pantryRowsOnDisk } from './helpers';

/** The fake provider's base URL: this app's own origin, on a path nothing serves. */
const VISION_BASE_URL = `${E2E_APP_URL}/e2e-pantry/v1`;

/** A model id for a self-hosted endpoint. Free text, never looked up in a catalog. */
const VISION_MODEL = 'e2e-pantry-model';

/** The key the settings form demands. It authenticates nothing: the endpoint is a route handler. */
const VISION_API_KEY = 'e2e-not-a-real-key';

/** The three shelf items, named so a passing assertion can only be this reading. */
const EGGS = 'Smoke tier eggs';
const SPINACH = 'Smoke tier spinach';
/** The one that is removed before the list is kept, and the one with no amount. */
const FETA = 'Smoke tier feta';

/** The recipe that gets logged. Its serving weight is inside the servable range. */
const FIRST_RECIPE = 'Smoke tier spinach omelette';
/**
 * The recipe that must NOT be shown at all.
 *
 * Its `servingGrams` is 9000, far past `RECIPE_SERVING_MAX_GRAMS`, so
 * `keepServableRecipes` drops it before a card is ever drawn (M233/06). It is
 * also the control for the first card: two recipes are answered, one appears.
 */
const SECOND_RECIPE = 'Smoke tier feta bake';

/** What one serving of the first recipe weighs, cooked. The walk logs 1.5 of them. */
const FIRST_SERVING_GRAMS = 350;

/** How many servings the walk says were eaten: one press of the card's "+" from the default of 1. */
const SERVINGS_EATEN = 1.5;

/** How that quantity is written on a portion label: `formatPortionLabel`'s own glyph for 1.5. */
const SERVINGS_EATEN_GLYPH = '1\u00bd';

/** A valid 1 x 1 RGBA PNG, the smallest thing `validatePhoto` and the canvas downscale both accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * What the pantry task answers with.
 *
 * EVERY FIELD OF `PantryIdentificationSchema` IS PRESENT, including the ones
 * that are null: the schema is all-required-with-nullable (OpenAI strict
 * structured output), so a missing key is a parse failure that would surface
 * as "we could not read that" rather than as a review form.
 */
const PANTRY_ANSWER = {
  items: [
    { name: EGGS, amount: 6, unit: 'piece', category: 'egg', confidence: 'high' },
    { name: SPINACH, amount: 200, unit: 'g', category: 'produce', confidence: 'high' },
    // NO AMOUNT, which is the ordinary case for a tub in a photograph and the
    // state the review row has to be able to hold.
    { name: FETA, amount: null, unit: null, category: 'dairy', confidence: 'medium' },
  ],
  notes: null,
};

/**
 * What the recipe task answers with: two recipes, which is the smallest count
 * `RecipeProposalsSchema` accepts.
 *
 * The per-serving figures are chosen, not measured: they only have to be
 * numbers the card can put beside what is left of the day.
 */
const RECIPE_ANSWER = {
  recipes: [
    {
      title: FIRST_RECIPE,
      // TWO SERVINGS, so the stepper has a rung above its default of 1 and the
      // walk can say it ate one and a half of them.
      servings: 2,
      servingGrams: FIRST_SERVING_GRAMS,
      ingredients: [
        { name: EGGS, amount: 3, unit: 'piece', fromPantry: true },
        { name: SPINACH, amount: 80, unit: 'g', fromPantry: true },
        { name: 'Butter', amount: null, unit: null, fromPantry: false },
      ],
      steps: ['Beat the eggs.', 'Wilt the spinach.', 'Fold the two together.'],
      perServing: { kcal: 320, proteinG: 24, carbsG: 3, fiberG: 2, fatG: 23 },
      whyItFits: 'It leans on protein and spends almost no carbohydrate.',
      prepMinutes: 12,
    },
    {
      title: SECOND_RECIPE,
      servings: 2,
      // NINE KILOGRAMS OF FOOD. A figure nobody estimated, which is exactly
      // what the range exists to catch: it is dropped, never clamped.
      servingGrams: 9000,
      ingredients: [
        { name: SPINACH, amount: 120, unit: 'g', fromPantry: true },
        { name: 'Cream', amount: 50, unit: 'ml', fromPantry: false },
      ],
      steps: ['Layer everything in a dish.', 'Bake until it sets.'],
      perServing: { kcal: 410, proteinG: 18, carbsG: 5, fiberG: 3, fatG: 34 },
      whyItFits: 'It is heavier, for a day with more energy still open.',
      prepMinutes: 35,
    },
  ],
};

/** The request body this fake reads. Only the one field that names the task. */
interface TaskNamingRequest {
  response_format?: { json_schema?: { name?: string } };
}

/**
 * The answer one task name is given, or null for a name this fake does not know.
 *
 * The names are the descriptors' own `schemaName` values
 * (`app/services/vision/task.ts`), transcribed here, so a rename in the app
 * turns into the refusal below rather than into a wrong shape.
 *
 * @param schemaName - what the request asked its structured output to be called.
 * @returns the object to answer with, or null.
 */
function answerForSchema(schemaName: string): object | null {
  if (schemaName === 'pantry_identification') return PANTRY_ANSWER;
  if (schemaName === 'recipe_proposals') return RECIPE_ANSWER;
  return null;
}

/**
 * Answers the key check and both chat completions this walk makes, and
 * nothing else.
 *
 * @param page - the page to install the handlers on, before it is navigated.
 */
async function fakeTheVisionProvider(page: Page): Promise<void> {
  // The key check `settings.ai` runs before it saves (`verify-key.ts`). Any
  // answer that is not a 401 or a 403 means "reachable, key not refused".
  await page.route(`${VISION_BASE_URL}/models`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );

  await page.route(`${VISION_BASE_URL}/chat/completions`, (route) => {
    // SAFETY: the body is this app's own request, built by
    // `openai-compatible.ts`, and only its schema name is read below. A body
    // without one falls through to the refusal.
    const body = route.request().postDataJSON() as TaskNamingRequest;
    const schemaName = body.response_format?.json_schema?.name ?? '';
    const answer = answerForSchema(schemaName);
    // REFUSED, NOT GUESSED: a task this fake does not know is a task whose
    // name moved, and answering it with the wrong shape would make this spec
    // fail somewhere far from the cause.
    if (answer === null) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: `e2e fake has no answer for schema '${schemaName}'` } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    });
  });
}

/**
 * Connects the fake endpoint through the real AI settings form.
 *
 * NO SHORTCUT WRITE, the rule `helpers.ts` states: a settings row planted in
 * IndexedDB would be a second implementation of the thing both screens read.
 *
 * @param page - a page on a device that is past onboarding.
 */
async function connectFakeProvider(page: Page): Promise<void> {
  await page.goto('/settings/ai');

  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();

  await page.locator('input[name="model"]').fill(VISION_MODEL);
  await page.locator('input[name="baseUrl"]').fill(VISION_BASE_URL);
  await page.locator('input[name="apiKey"]').fill(VISION_API_KEY);
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();

  // A verified first connect returns to the diary, which is the one signal
  // that the row was written rather than refused by the key check.
  await page.waitForURL('**/diary');
}

/**
 * The "of {{left}} left" figure as a pattern, built from the shipped catalog.
 *
 * NO SENTENCE IS PINNED: the two halves of whatever the bundle says today are
 * escaped and the placeholder becomes a number, so a reword passes and a
 * missing figure fails. The card renders the serving's own number outside this
 * sentence on purpose (M233/04), which is why only one number is matched.
 */
function ofLeftPattern(): RegExp {
  const [head = '', tail = ''] = EN.recipes.macros.ofLeft.split('{{left}}');
  return new RegExp(`${escapeForRegExp(head)}\\d+${escapeForRegExp(tail)}`, 'u');
}

/** One literal piece of a catalog sentence, safe to put inside a pattern. */
function escapeForRegExp(part: string): string {
  return part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

test('a photographed shelf becomes a pantry, a recipe and one logged entry', async ({ page }) => {
  await fakeTheVisionProvider(page);
  await completeOnboarding(page);
  await connectFakeProvider(page);

  // THE DOOR, from the dashboard, because that is how a person reaches the
  // pantry without typing a URL.
  await page.goto('/dashboard');
  await page.getByRole('link', { name: EN.pantry.door.title }).click();
  await page.waitForURL('**/pantry');

  // THE COMPOSER'S OWN CAMERA INPUT. There are two capture inputs on this
  // screen: this one, which reads a shelf into the pantry, and the tab bar's
  // raised launcher, which photographs a plate for `/add/photo`. Scoping to
  // the page's own column picks the pantry's, since the tab bar is not in it.
  await page
    .locator('main div.max-w-xl input[type="file"][capture]')
    .setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect(page.getByText(EN.pantry.review.title)).toBeVisible();
  await expect(pantryRows(page)).toHaveCount(3);

  // ONE ROW REMOVED before the list is kept, so what is stored is the person's
  // correction rather than the reading.
  await page.getByRole('button', { name: fill(EN.pantry.review.removeAria, { name: FETA }) }).click();
  await expect(pantryRows(page)).toHaveCount(2);

  await page.getByRole('button', { name: EN.pantry.review.confirm }).click();
  await expect(pantryRows(page)).toHaveCount(2);

  // WAIT FOR THE SAVE, then reload. See `pantryRowsOnDisk`: the persister
  // writes after the transaction, so a reload fired on the re-render can beat
  // it, and what that would prove is nothing about the pantry.
  await expect.poll(() => pantryRowsOnDisk(page)).toBe(2);

  // THE RELOAD IS THE POINT: a full document load throws away every piece of
  // in-memory state, so what comes back came out of IndexedDB.
  await page.goto('/pantry');
  await expect(pantryRows(page)).toHaveCount(2);
  // NAMED, not merely counted: the two rows that came back out of the store are
  // the two the person kept. Compared as a SET, because the order rows are
  // stored in is the merge's business and not a promise to anybody.
  expect((await pantryRowNames(page)).toSorted()).toEqual([EGGS, SPINACH].toSorted());
  await expect(page.getByRole('button', { name: fill(EN.pantry.review.removeAria, { name: FETA }) })).toHaveCount(0);

  await page.getByRole('link', { name: EN.pantry.recipes.link }).click();
  await page.waitForURL('**/pantry/recipes**');

  // BY THE SLOT, NOT THE SHAPE. `Card` grew `data-slot="card"` in M243 spec
  // 03, precisely so a spec stops naming a radius it has no opinion about: this
  // one cares that there is one recipe card, not what its corners measure.
  const cards = page.locator('main [data-slot="card"]');
  const firstCard = cards.filter({ hasText: FIRST_RECIPE });
  await expect(firstCard).toHaveCount(1);

  // EXACTLY ONE CARD. The fake answered with two recipes and the second one
  // weighs nine kilograms a serving, so the servable filter dropped it before
  // anything was drawn. Asserted twice on purpose: the count, which fails if
  // a second card appears under any title, and the absent title, which is the
  // control saying the surviving card is the one that was supposed to survive.
  await expect(cards).toHaveCount(1);
  await expect(page.locator('main').getByText(SECOND_RECIPE)).toHaveCount(0);

  // A "LEFT" FIGURE ON THE CARD. Located through the catalog sentence rather
  // than by transcribing it, so the wordsmith pass owns the wording.
  await expect(firstCard.getByText(ofLeftPattern()).first()).toBeVisible();

  // THE PAGE FITS THE PHONE. `scrollWidth` against `clientWidth` on the
  // document element, which IS this app's scroll container, never a screenshot:
  // headless Chrome hides scrollbars, so an overflow is invisible in a picture.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // THE SLOT THE SCREEN IS WORKING FOR, read off its own field, so the diary
  // assertion below cannot disagree with it over an hour boundary.
  const slot = await page.locator('main input[type="hidden"][name="meal"]').inputValue();
  expect(slot).not.toBe('');

  // ONE AND A HALF SERVINGS. The stepper starts at one whole serving, so a
  // single press of "+" is the half step up, and the button's own text then
  // has to say so.
  await firstCard.getByRole('button', { name: EN.recipes.servingsEaten.increase }).click();
  const logButton = firstCard.getByRole('button', {
    name: fill(EN.recipes.servingsEaten.logOf, { count: '1.5', servings: '2' }),
  });
  await expect(logButton).toHaveCount(1);
  await logButton.click();
  await page.waitForURL('**/diary**');

  const logged = page.locator(`[data-slot="meal-group"][data-meal="${slot}"] a[href^="/diary/entry/"]`);
  const entry = logged.filter({ hasText: FIRST_RECIPE });
  await expect(entry).toHaveCount(1);

  // THE ENTRY CARRIES THE SERVINGS AND THE WEIGHT, which is the whole of
  // M233/06: a nominal 100 g used to be logged whatever the recipe was. The
  // portion label is read out of the shipped catalog (`formatPortionLabel`
  // resolves `portions.unit.serving_other` with the 1½ glyph), never
  // transcribed, so a reword of the unit noun passes and a missing portion
  // fails. The gram figure beside it is this recipe's own weight times the
  // servings, formatted with the app's no-break space.
  await expect(entry).toContainText(fill(EN.portions.unit.serving_other, { count: SERVINGS_EATEN_GLYPH }));
  await expect(entry).toContainText(`${FIRST_SERVING_GRAMS * SERVINGS_EATEN}\u00a0g`);

  // THE CONTROL for the line above: one whole serving would read as this
  // recipe's bare weight, and that is not what is on the page.
  await expect(entry).not.toContainText(`${FIRST_SERVING_GRAMS}\u00a0g`);
});
