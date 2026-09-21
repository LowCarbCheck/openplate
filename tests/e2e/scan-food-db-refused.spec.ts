/**
 * A REFUSED FOOD DATABASE IS VISIBLE, AND THE SCAN STILL COMPLETES (M238 spec 02).
 *
 * ── THE RISK THIS CAME FROM ──────────────────────────────────────────────
 *
 * LowCarbCheck is about to require an API key. Before this milestone, an
 * instance with no key would have met a 401 on every lookup, logged it at
 * `logger.debug`, returned an empty match list, and said nothing. The scan
 * would still have worked and the numbers would still have appeared, which is
 * the correct POLICY, but they would have quietly become the model's own
 * estimate rather than a curated figure and nobody would have known. For a
 * carb tracker that is the dangerous direction, so this walk exists.
 *
 * ── WHY IT DRIVES THE REAL SERVER PATH ───────────────────────────────────
 *
 * `scan-review.spec.ts` stubs `**\/api/food-matches` in the browser, because
 * its subject is the review card's arithmetic. This spec must NOT: the status
 * is set on the SERVER, by the server's own call to the food database, and
 * published on that route's response. A browser stub would be this spec
 * writing the answer it then asserts. So the lookup runs for real, against the
 * fake LowCarbCheck the tier already starts (`tests/e2e/fake-food-db.ts`),
 * switched to refusing over that fake's own `__e2e__` seam.
 *
 * ── THE CONTROL IS THE SECOND SCAN ───────────────────────────────────────
 *
 * The refusal is lifted and a scan of a DIFFERENT food is run. The line must
 * be gone. That is two proofs in one: the assertion can go red (a card that
 * drew the line always would fail here), and the status does not LATCH, which
 * is the failure this whole feature could most easily become. A permanent
 * "unavailable" line under numbers that are fine would be worse than the
 * silence it replaced.
 *
 * A DIFFERENT FOOD NAME on the second scan, and that is load bearing: the
 * server caches a resolved lookup per name, so re-scanning the first food
 * would be answered from cache, never reach the upstream, and never clear the
 * status. The test would then fail for a reason that has nothing to do with
 * the code it is about.
 *
 * ── AND IT LEAVES THE TIER AS IT FOUND IT ────────────────────────────────
 *
 * The status lives in the app server's process, which is shared by every spec
 * in the run. Lifting the refusal is therefore not only the control, it is the
 * cleanup, and the fake is reset again at the end regardless.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_APP_URL, E2E_FOOD_DB_URL } from './env';
import { FOOD_DB_REFUSAL_PATH } from './fake-food-db';
import { completeOnboarding, expectPhoneLayout } from './helpers';

/** The fake provider's base URL: this app's own origin, on a path nothing serves. See `scan-review.spec.ts`. */
const VISION_BASE_URL = `${E2E_APP_URL}/e2e-vision/v1`;

/** A model id for a self-hosted endpoint. Free text, never looked up in a catalog. */
const VISION_MODEL = 'e2e-vision-model';

/** The key the settings form demands. It authenticates nothing: the endpoint is a route handler. */
const VISION_API_KEY = 'e2e-not-a-real-key';

/** The food the FIRST scan identifies, while the database is refusing. */
const REFUSED_FOOD = 'Refused tier oat cracker';

/** The food the SECOND scan identifies. A different name, so the server's per-name cache cannot answer it. */
const ACCEPTED_FOOD = 'Accepted tier oat cracker';

/** A valid 1 x 1 RGBA PNG, the smallest thing `validatePhoto` and the canvas downscale both accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * One identified item, in the wire shape every provider is asked for.
 *
 * EVERY FIELD OF `PlateIdentificationSchema` IS PRESENT, including the ones
 * that are null: the schema is all-required-with-nullable (OpenAI strict
 * structured output), so a missing key is a parse failure that would surface
 * as "try a different photo" rather than as a review card.
 *
 * @param name - what the model claims to have seen.
 */
function identification(name: string): string {
  return JSON.stringify({
    foods: [
      {
        name,
        estimatedGrams: 30,
        confidence: 'high',
        portionHint: null,
        macrosPer100g: { carbs: 60, fiber: 8, sugars: null, polyols: null, protein: 10, fat: 12, kcal: 420 },
        macroSource: 'estimated',
        carbBasis: null,
        brand: null,
        servingSize: null,
      },
    ],
    unreadable: false,
    unreadableReason: null,
    notes: null,
  });
}

/** Which food the next fake vision answer names. Read inside the route handler, so it can change between scans. */
let identifiedFood = REFUSED_FOOD;

/**
 * Answers the two provider requests this flow makes, and nothing else.
 *
 * `/api/food-matches` is deliberately NOT intercepted: it is the subject.
 *
 * @param page - the page to install the handlers on, before it is navigated.
 */
async function fakeTheVisionProvider(page: Page): Promise<void> {
  await page.route(`${VISION_BASE_URL}/models`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );

  await page.route(`${VISION_BASE_URL}/chat/completions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: identification(identifiedFood) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    }),
  );
}

/** Connects the fake endpoint through the real AI settings form. See `scan-review.spec.ts` for why no shortcut write. */
async function connectFakeProvider(page: Page): Promise<void> {
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill(VISION_MODEL);
  await page.locator('input[name="baseUrl"]').fill(VISION_BASE_URL);
  await page.locator('input[name="apiKey"]').fill(VISION_API_KEY);
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();
  await page.waitForURL('**/diary');
}

/**
 * Tells the fake food database what to answer the catalogue search with.
 *
 * @param page - any page, used only for its request context.
 * @param status - `401` to refuse, or `null` to answer normally again.
 */
async function setFoodDbRefusal(page: Page, status: number | null): Promise<void> {
  const response = await page.request.post(`${E2E_FOOD_DB_URL}${FOOD_DB_REFUSAL_PATH}`, { data: { status } });
  expect(response.status(), 'the fake food database must accept the new answer').toBe(200);
}

/** Takes one photo and waits for the review card. */
async function scanOnePhoto(page: Page): Promise<void> {
  await page.goto('/add/photo');
  // THE CAPTURE CARD'S OWN INPUT, named rather than taken by position: there
  // are three file inputs on this screen, and `[capture]` picks the camera out
  // of the card's pair, because a library pick waits out a cancellable grace
  // window while a capture dispatches at once.
  const captureCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();
}

test('a refused food database shows one line, and the scan still completes', async ({ page }) => {
  await fakeTheVisionProvider(page);
  await completeOnboarding(page);
  await connectFakeProvider(page);

  try {
    // ── The database refuses ────────────────────────────────────────────
    await setFoodDbRefusal(page, 401);
    identifiedFood = REFUSED_FOOD;
    await scanOnePhoto(page);

    await expect(page.getByText(EN.scan.review.foodDbUnavailable)).toBeVisible();
    // NOT BLOCKED, which is the half of this that is a policy statement: the
    // item is on the card and the confirm button is there to press.
    await expect(page.getByText(REFUSED_FOOD)).toBeVisible();
    await expectPhoneLayout(page);

    // THE SCAN COMPLETES. Confirming lands on the diary with the entry in it,
    // which is the whole point of fail-open: a food database outage costs a
    // curated figure, never a logged meal.
    await page.getByRole('button', { name: EN.scan.review.confirmAndLog }).click();
    await page.waitForURL('**/diary**');
    await expect(page.locator('main').getByText(REFUSED_FOOD).first()).toBeVisible();

    // ── The database answers again ──────────────────────────────────────
    // THE CONTROL, and the proof the status does not latch. A different food
    // name, so the server's per-name cache cannot answer without asking.
    await setFoodDbRefusal(page, null);
    identifiedFood = ACCEPTED_FOOD;
    await scanOnePhoto(page);

    await expect(page.getByText(ACCEPTED_FOOD)).toBeVisible();
    await expect(page.getByText(EN.scan.review.foodDbUnavailable)).toHaveCount(0);
  } finally {
    // The fake outlives this spec, and so does the app server's status. The
    // successful scan above already cleared both; this is the belt.
    await setFoodDbRefusal(page, null);
  }
});
