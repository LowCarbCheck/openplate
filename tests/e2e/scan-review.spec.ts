/**
 * The review card must report the same net carbs the diary entry does.
 *
 * THE REPORT (operator, 2026-09-14, translated): "I took a photo and it worked
 * well at the end. But at the review step, where you can still choose whether
 * it was double the amount etc, it showed me net carbs 0 g although it was
 * 5-6 g. In the final calculation of the entry everything was right."
 *
 * THE MECHANISM. Since the M138 label merge (ADR-0005's amendment) one photo
 * task answers per ITEM, so a plate item may now carry `macroSource: 'label'`
 * and `carbBasis: 'available'`, an EU panel, whose printed carbohydrate
 * figure already excludes fibre. `scan.tsx` builds the review card's preview
 * without passing that basis, so `computeNetCarbsFromParts` falls back to the
 * US `carbs - fiber - polyols` formula, subtracts the fibre a second time, goes
 * negative, and `Math.max(0, ...)` in `portion-preview.ts` floors the badge to
 * "0 g". The confirm path threads the basis through a hidden field, which is
 * why the saved entry was right and only the screen lied.
 *
 * THE SECOND DEFECT, same item, same cause (M226). `checkMacroSanity` takes
 * the basis too, and suppresses its fibre-vs-carbs comparisons on an
 * `available` panel, because fibre above the printed carbohydrate figure is
 * ordinary there. The call site passed three of its four arguments, so the
 * card also printed a warning this item never earned. Asserted below on the
 * same card, in the same visit.
 *
 * WHY THE ITEM HAS MORE FIBRE THAN CARBS. That is what makes the double
 * subtraction visible instead of merely wrong: 5.5 g carbs less 8 g fibre is
 * negative, so the floor turns a real figure into a confident zero. A low-carb
 * tracker understating carbs is the dangerous direction.
 *
 * WHY THE MODEL IS FAKED AND NOT CALLED. The scan's identify step is a
 * `clientAction`: the browser talks to the person's own provider directly.
 * This spec therefore connects a self-hosted `openai-compatible` endpoint
 * through the real AI settings form, and answers its two requests with
 * `page.route`. Nothing is spent, nothing leaves the machine, and the response
 * is a real chat-completions envelope that goes through the shipped Zod parse.
 *
 * WHY THE ENDPOINT IS THIS APP'S OWN ORIGIN. Two reasons, both load-bearing.
 * The production CSP's `connect-src` only allows a provider origin it knows
 * about plus `'self'` and loopback, and a CSP refusal happens before
 * `page.route` ever sees the request. And a same-origin address needs no CORS
 * preflight, which `page.route` does not answer. Nothing listens on the path;
 * the interception is the whole implementation.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, expectPhoneLayout } from './helpers';

/** The fake provider's base URL: this app's own origin, on a path nothing serves. */
const VISION_BASE_URL = `${E2E_APP_URL}/e2e-vision/v1`;

/** A model id for a self-hosted endpoint. Free text, never looked up in a catalog. */
const VISION_MODEL = 'e2e-vision-model';

/** The key the settings form demands. It authenticates nothing: the endpoint is a route handler. */
const VISION_API_KEY = 'e2e-not-a-real-key';

/** A name no food database returns, so a passing assertion can only be this item. */
const FOOD_NAME = 'Smoke tier seed cracker';

/** The item's macros per 100 g. FIBRE EXCEEDS CARBS on purpose, see the header. */
const MACROS_PER_100G = { carbs: 5.5, fiber: 8, protein: 10, fat: 20, kcal: 300 } as const;

/** The portion, chosen as 100 g so the per-portion figure equals the per-100 g one. */
const ESTIMATED_GRAMS = 100;

/** What the badge must read once the basis is honoured. */
const EXPECTED_NET_CARBS = '5.5';

/** What it reads today, and the control that makes the assertion able to fail. */
const FLOORED_NET_CARBS = '0';

/** A valid 1 x 1 RGBA PNG, the smallest thing `validatePhoto` and the canvas downscale both accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * The one identified item, in the wire shape every provider is asked for.
 *
 * EVERY FIELD OF `PlateIdentificationSchema` IS PRESENT, including the ones
 * that are null here: the schema is all-required-with-nullable (OpenAI strict
 * structured output), so a missing key is a parse failure that would surface
 * as "try a different photo" rather than as a review card.
 */
const IDENTIFICATION = {
  foods: [
    {
      name: FOOD_NAME,
      estimatedGrams: ESTIMATED_GRAMS,
      confidence: 'high',
      portionHint: null,
      macrosPer100g: {
        carbs: MACROS_PER_100G.carbs,
        fiber: MACROS_PER_100G.fiber,
        sugars: null,
        polyols: null,
        protein: MACROS_PER_100G.protein,
        fat: MACROS_PER_100G.fat,
        kcal: MACROS_PER_100G.kcal,
      },
      // THE TWO FIELDS THIS SPEC EXISTS FOR. A transcribed EU panel: the carbs
      // figure already excludes the fibre below it.
      macroSource: 'label',
      carbBasis: 'available',
      brand: null,
      servingSize: null,
    },
  ],
  unreadable: false,
  unreadableReason: null,
  notes: null,
};

/**
 * Answers the three requests this flow makes that would otherwise leave the
 * machine, and nothing else.
 *
 * The food-match lookup is stubbed to an honest empty list rather than left to
 * run: it is this app's own proxy to the LowCarbCheck catalog, so a smoke tier
 * that let it through would go red when somebody else's service was slow. An
 * empty list is also what a real lookup for this name would return, and it
 * keeps the review card on the compute-from-parts path the report is about.
 *
 * @param page - the page to install the handlers on, before it is navigated.
 */
async function fakeTheVisionProvider(page: Page): Promise<void> {
  // The key check `settings.ai` runs before it saves (`verify-key.ts`). Any
  // non-401/403 answer means "reachable, key not refused".
  await page.route(`${VISION_BASE_URL}/models`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );

  await page.route(`${VISION_BASE_URL}/chat/completions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(IDENTIFICATION) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    }),
  );

  await page.route('**/api/food-matches', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ matches: [[]], throttled: false }),
    }),
  );
}

/**
 * Connects the fake endpoint through the real AI settings form.
 *
 * NO SHORTCUT WRITE, the same rule `helpers.ts` states: a settings row planted
 * in IndexedDB would be a second implementation of the thing the scan reads.
 * The fields are found by their form names rather than their labels because the
 * labels are wordsmith-owned copy; the two collapsibles are opened by clicking,
 * because a `forceMount`ed field is in the DOM but not visible.
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

  // A verified first connect returns to the diary, which is the one signal that
  // the row was actually written rather than rejected by the key check.
  await page.waitForURL('**/diary');
}

test('the review card reports the same net carbs the logged entry does', async ({ page }) => {
  await fakeTheVisionProvider(page);
  await completeOnboarding(page);
  await connectFakeProvider(page);

  await page.goto('/add/photo');
  // THE CAPTURE CARD'S OWN INPUT, and the card is named rather than taken by
  // position: there are three file inputs on this screen. The card holds the
  // camera one and the library one, and `BottomNav`'s raised Scan button holds
  // a third camera one of its own, outside any card. `[capture]` picks the
  // camera out of the card's pair, because a library pick waits out a
  // cancellable grace window while a capture dispatches at once.
  const captureCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();

  const itemCard = page.locator('form [data-slot="card"]').filter({ hasText: FOOD_NAME });
  // The item really is on the label path, otherwise the basis would be absent
  // for an honest reason and this spec would be asserting nothing.
  await expect(itemCard.getByText(EN.scan.review.fromLabel)).toBeVisible();

  // The badge, found by its own slot, never by a class: `rounded-full` used to
  // find it and stopped being true the day corners were squared (2026-09-22),
  // which is exactly the failure mode a radius-as-identity selector has.
  const netCarbsBadge = itemCard.locator('[data-slot="net-carbs-badge"]');

  await expect(netCarbsBadge).toHaveText(fill(EN.scan.review.netCarbsForPortion, { value: EXPECTED_NET_CARBS }));
  // THE CONTROL, on the same badge: the reported defect, stated as the thing
  // that must not be on the screen.
  await expect(netCarbsBadge).not.toHaveText(fill(EN.scan.review.netCarbsForPortion, { value: FLOORED_NET_CARBS }));

  // THE SECOND DEFECT ON THE SAME CARD, same cause (M226). The plausibility
  // check ran basis-blind while the figure beside it did not, so this ordinary
  // EU panel was told its fibre could not exceed its carbohydrate figure. The
  // amber issues box prints one paragraph per issue; the sentence is built from
  // the shipped catalog rather than transcribed, so a reword is not a failure.
  const fibreOverCarbs = fill(EN.scan.review.sanity.componentOverTotal, {
    component: EN.scan.review.sanity.macro.fiber,
    componentValue: String(MACROS_PER_100G.fiber),
    total: EN.scan.review.sanity.macro.carbs,
    totalValue: String(MACROS_PER_100G.carbs),
  });
  await expect(itemCard.getByText(fibreOverCarbs)).toHaveCount(0);

  await expectPhoneLayout(page);

  await page.getByRole('button', { name: EN.scan.review.confirmAndLog }).click();
  await page.waitForURL('**/diary**');

  // THE OTHER HALF OF THE REPORT, which passes today: the save path threads the
  // basis through, so the entry was always right. It stays here so a fix that
  // corrected the card by breaking the entry cannot go green.
  const entryRow = page.locator('a[href^="/diary/entry/"]').filter({ hasText: FOOD_NAME });
  await expect(entryRow).toContainText(fill(EN.diary.netCarbsValue, { value: EXPECTED_NET_CARBS }));
  await expect(entryRow).not.toContainText(fill(EN.diary.netCarbsValue, { value: FLOORED_NET_CARBS }));
});
