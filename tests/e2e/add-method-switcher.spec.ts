/**
 * Search, Describe and Photo: one switcher over the three add screens, and a
 * draft on each that survives leaving it (M255/01).
 *
 * THE DEFECT THIS GUARDS. Every draft on the three add screens was plain
 * component state, so any navigation threw it away: the sentence half written
 * in the composer, the portion step of a food already found, and on the photo
 * screen the chosen picture and a finished AI analysis. The last one cost a
 * second paid scan to get back. The switcher is the new way between the three
 * screens, and `app/lib/add-drafts.ts` is what makes using it safe.
 *
 * WHAT EACH TEST PROVES, and the control that makes it able to fail:
 *
 * - A draft survives a switch away and back, on each screen, and a leave by
 *   the bottom bar. Every one of these was proved red by disabling the
 *   store's read (`readAddDraft` and `readPhotoDraftOnArrival` answering
 *   `null`), rebuilding, and running this file: each restore line failed.
 * - A logged entry clears its draft. Its control is the same walk WITHOUT the
 *   log, in the tests above it, where the same read finds the draft.
 * - The switcher sits in one box on all three screens, and typing moves
 *   nothing. The geometry reader is shown to see an 8 px nudge, and the
 *   shift observer is shown to see a block inserted above the composer, so
 *   neither zero is the zero of a reader that sees nothing.
 * - The switcher is absent for the pantry's composer, from the first paint;
 *   the same screen without `?to=` draws it.
 * - `aria-current` is on exactly one link, and on each screen a different
 *   one.
 *
 * NO SENTENCE IS PINNED. Every label is read from the shipped English catalog
 * (`copy.ts`), and the links are found by those labels, which is also the
 * check that they are the switcher's accessible names.
 *
 * THE AI IS FAKED where a test needs one, exactly as `scan-review.spec.ts`
 * does and for its reasons: a self-hosted endpoint on this app's own origin,
 * connected through the real settings form and answered by `page.route`.
 */
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { EN } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, logFoodManually } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

/** The three methods, as the switcher tags its links and as the addresses name them. */
const METHODS = ['search', 'describe', 'photo'] as const;
type Method = (typeof METHODS)[number];

/** Where each method lives (ADR-0019). */
const METHOD_PATHS = { search: '/add/search', describe: '/add/describe', photo: '/add/photo' } as const;

/** A sentence nobody else's walk types, so a match can only be this draft. */
const MEAL_SENTENCE = 'Switcher tier porridge with blueberries';

/** A name no food database returns, so the search row found can only be this walk's own log. */
const LOGGED_FOOD = 'Switcher tier rye bread';

/** The portion the search walk types, different from the 100 g the food was logged with. */
const EDITED_PORTION_GRAMS = '150';

/** What the fake model identifies, and a grams edit the review walk makes to it. */
const IDENTIFIED_FOOD = 'Switcher tier seed cracker';
const IDENTIFIED_GRAMS = 100;
const EDITED_REVIEW_GRAMS = '140';

/** The fake provider's base URL: this app's own origin, on a path nothing serves. */
const VISION_BASE_URL = `${E2E_APP_URL}/e2e-switcher-vision/v1`;

/** A valid 1 x 1 PNG, the smallest thing the photo check and the canvas downscale both accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A touch target on a phone, DESIGN.md section 6. */
const TOUCH_TARGET_PX = 44;

/** How far the control nudges the switcher to show the geometry reader sees a move. */
const CONTROL_NUDGE_PX = 8;

/** How tall a block the control inserts above the composer, to show the shift observer sees a shift. */
const CONTROL_BLOCK_PX = 40;

/**
 * The one identified item, in the wire shape every provider is asked for.
 * Every field of the strict schema is present, as `scan-review.spec.ts`
 * explains: a missing key is a parse failure, not a review.
 */
const IDENTIFICATION = {
  foods: [
    {
      name: IDENTIFIED_FOOD,
      estimatedGrams: IDENTIFIED_GRAMS,
      confidence: 'high',
      portionHint: null,
      macrosPer100g: { carbs: 20, fiber: 5, sugars: null, polyols: null, protein: 10, fat: 15, kcal: 250 },
      macroSource: 'estimated',
      carbBasis: null,
      brand: null,
      servingSize: null,
    },
  ],
  unreadable: false,
  unreadableReason: null,
  notes: null,
};

/** How the fake model answers the identify call. */
type ModelAnswer = 'identify' | 'fail';

/** The fake model's call count, and a gate that holds its answer until the walk opens it. */
interface FakeModel {
  /** How many identify calls reached the model. */
  calls: () => number;
  /** Lets every held call answer. Until it is called, a held call stays in flight. */
  release: () => void;
}

/**
 * Answers the requests an AI walk makes that would otherwise leave the
 * machine: the key check, the identify call, and the food-match lookup.
 *
 * @param page - the page to install the handlers on, before it navigates.
 * @param options.answer - identify the plate, or fail the call.
 * @param options.isHeld - hold each identify call until `release`, so a walk can act while one is in flight.
 * @returns the call counter and the gate.
 */
async function fakeTheModel(
  page: Page,
  { answer, isHeld }: { answer: ModelAnswer; isHeld: boolean },
): Promise<FakeModel> {
  let calls = 0;
  let isOpen = !isHeld;
  const waiting: Array<() => void> = [];

  await page.route(`${VISION_BASE_URL}/models`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );
  await page.route(`${VISION_BASE_URL}/chat/completions`, async (route: Route) => {
    calls += 1;
    if (!isOpen) await new Promise<void>((resolve) => waiting.push(resolve));
    if (answer === 'fail') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'e2e' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(IDENTIFICATION) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    });
  });
  await page.route('**/api/food-matches', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ matches: [[]], throttled: false }),
    }),
  );

  return {
    calls: () => calls,
    release: () => {
      isOpen = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

/**
 * Connects the fake endpoint through the real AI settings form, as
 * `scan-review.spec.ts` does, and waits for the diary that a verified first
 * connect returns to.
 *
 * @param page - a page past onboarding, with `fakeTheModel` installed.
 */
async function connectTheFakeModel(page: Page): Promise<void> {
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill('e2e-switcher-model');
  await page.locator('input[name="baseUrl"]').fill(VISION_BASE_URL);
  await page.locator('input[name="apiKey"]').fill('e2e-not-a-real-key');
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();
  await page.waitForURL('**/diary');
}

/** The switcher, found by its accessible name, which is the catalog's label. */
function switcher(page: Page): Locator {
  return page.getByRole('navigation', { name: EN.add.methods.label, exact: true });
}

/** One of the switcher's links, found by its accessible name. */
function methodLink(page: Page, method: Method): Locator {
  return switcher(page).getByRole('link', { name: EN.add.methods[method], exact: true });
}

/**
 * Taps one of the switcher's links and waits for its screen to be the page.
 *
 * `aria-current` is the arrival signal: the switcher is drawn by the layout
 * and stays mounted, so its link turning current is the router having
 * committed the new screen, not merely the address having changed.
 *
 * @param page - a page on one of the add screens.
 * @param method - the method to switch to.
 */
async function switchTo(page: Page, method: Method): Promise<void> {
  await methodLink(page, method).click();
  await page.waitForURL((url) => url.pathname === METHOD_PATHS[method]);
  await expect(methodLink(page, method)).toHaveAttribute('aria-current', 'page');
}

/** A link in the phone's bottom bar, by its catalog label. */
function bottomBarLink(page: Page, label: string): Locator {
  return page.locator('[data-slot="bottom-nav-shell"] nav').getByRole('link', { name: label, exact: true });
}

/** The capture card on `/add/photo`: the card that holds the camera input. */
function captureCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
}

/** The switcher's box, rounded to the pixel. */
async function switcherBox(page: Page): Promise<{ top: number; left: number; width: number; height: number }> {
  return switcher(page).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top + window.scrollY),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
}

////////////////////////////////////////////////////////////////////////////////
// (a) The composer's words survive a switch to Photo and back
////////////////////////////////////////////////////////////////////////////////

test('the describe text survives a switch to Photo and back', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/add/describe');

  const field = page.locator('textarea#describe-meal');
  await field.fill(MEAL_SENTENCE);

  await switchTo(page, 'photo');
  // The composer really is gone: this is a different screen, not a hidden one.
  await expect(field).toHaveCount(0);

  await switchTo(page, 'describe');
  await expect(field).toHaveValue(MEAL_SENTENCE);
});

////////////////////////////////////////////////////////////////////////////////
// (b) A food opened from the search, and its portion, survive a switch
////////////////////////////////////////////////////////////////////////////////

test('a chosen search portion survives a switch to Describe and back', async ({ page }) => {
  await completeOnboarding(page);
  // A food this device already logged, so the search finds it on the device
  // (`/add/search?q=` matches recent foods in its loader) and the walk never
  // waits on a food database.
  await logFoodManually(page, { name: LOGGED_FOOD, grams: '100', carbs: '40' });

  await page.goto(`/add/search?q=${encodeURIComponent(LOGGED_FOOD)}`);
  await page.locator('[data-slot="search-result-row"]').filter({ hasText: LOGGED_FOOD }).first().click();
  const grams = page.locator('input[name="quantityGrams"]');
  await expect(grams).toBeVisible();
  await grams.fill(EDITED_PORTION_GRAMS);

  await switchTo(page, 'describe');
  await expect(grams).toHaveCount(0);

  await switchTo(page, 'search');
  // The portion step, for the same food, with the grams the person typed.
  await expect(grams).toHaveValue(EDITED_PORTION_GRAMS);
  await expect(page.locator('main').getByText(LOGGED_FOOD).first()).toBeVisible();
});

////////////////////////////////////////////////////////////////////////////////
// (c) A chosen photo survives a switch, and coming back sends nothing
////////////////////////////////////////////////////////////////////////////////

test('a chosen photo survives a switch to Search and back, and nothing is sent again', async ({ page }) => {
  // THE MODEL REFUSES, so the walk ends at rest with a chosen picture and no
  // analysis: the state a person is in after a failed or cancelled attempt,
  // and the one whose picture used to vanish on a switch.
  const model = await fakeTheModel(page, { answer: 'fail', isHeld: false });
  await completeOnboarding(page);
  await connectTheFakeModel(page);

  await page.goto('/add/photo');
  await captureCard(page)
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  // The library pick waits out its grace window, then asks the model once.
  const analyze = page.getByRole('button', { name: EN.scan.capture.analyze, exact: true });
  await expect(analyze).toBeVisible({ timeout: 10_000 });
  expect(model.calls(), 'the pick must have asked the model exactly once').toBe(1);

  await switchTo(page, 'search');
  await expect(page.getByRole('img', { name: EN.scan.capture.previewAlt })).toHaveCount(0);

  await switchTo(page, 'photo');
  await expect(page.getByRole('img', { name: EN.scan.capture.previewAlt })).toBeVisible();
  // AT REST, with the quiet key to try again, and NOTHING SENT on the way
  // back: a returning screen never spends a second call on its own.
  await expect(analyze).toBeVisible();
  expect(model.calls(), 'coming back must not ask the model again').toBe(1);
});

////////////////////////////////////////////////////////////////////////////////
// (c, continued) A finished analysis and its review edits survive a switch;
// the switcher is inert while the analysis runs; a confirm clears the draft
////////////////////////////////////////////////////////////////////////////////

test('a finished analysis and its review edits survive a switch, and the confirm clears them', async ({ page }) => {
  const model = await fakeTheModel(page, { answer: 'identify', isHeld: true });
  await completeOnboarding(page);
  await connectTheFakeModel(page);

  await page.goto('/add/photo');
  // The camera input dispatches at once, and the model holds its answer.
  await captureCard(page)
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect.poll(() => model.calls(), { message: 'the capture must reach the model' }).toBe(1);

  ////////////////////////////////////////////////////////////////////////////
  // IN FLIGHT: every link keeps its box and refuses the tap.
  ////////////////////////////////////////////////////////////////////////////
  for (const method of METHODS) {
    await expect(methodLink(page, method)).toHaveAttribute('aria-disabled', 'true');
  }
  // FORCED, because Playwright itself refuses to click a link that says
  // `aria-disabled="true"` and would wait out the test instead. A forced click
  // is a real pointer press on the link; the link has to refuse it.
  await methodLink(page, 'search').click({ force: true });
  model.release();
  // Had the tap navigated, the review would never arrive on this page.
  const reviewHeading = page.getByText(EN.scan.review.heading, { exact: true });
  await expect(reviewHeading).toBeVisible();
  expect(new URL(page.url()).pathname, 'a tap during the analysis left the screen').toBe(METHOD_PATHS.photo);
  // The control: settled, the links are live again (and the switch below uses one).
  await expect(methodLink(page, 'search')).not.toHaveAttribute('aria-disabled', 'true');

  ////////////////////////////////////////////////////////////////////////////
  // THE REVIEW, edited, left, and found again as it was left.
  ////////////////////////////////////////////////////////////////////////////
  const reviewGrams = page.locator('input[name="items[0].estimatedGrams"]');
  await expect(reviewGrams).toHaveValue(String(IDENTIFIED_GRAMS));
  await reviewGrams.fill(EDITED_REVIEW_GRAMS);

  await switchTo(page, 'describe');
  await expect(reviewHeading).toHaveCount(0);

  await switchTo(page, 'photo');
  await expect(reviewHeading).toBeVisible();
  await expect(page.locator('main').getByText(IDENTIFIED_FOOD).first()).toBeVisible();
  await expect(reviewGrams).toHaveValue(EDITED_REVIEW_GRAMS);
  expect(model.calls(), 'the review came back by asking the model again').toBe(1);

  ////////////////////////////////////////////////////////////////////////////
  // (e) THE CONFIRM CLEARS IT. The walk above is the control: the same way
  // back, without a confirm, found the review.
  ////////////////////////////////////////////////////////////////////////////
  await page.getByRole('button', { name: EN.scan.review.confirmAndLog }).click();
  await page.waitForURL('**/diary**');

  await bottomBarLink(page, EN.nav.add).click();
  await page.waitForURL((url) => url.pathname === METHOD_PATHS.search);
  await switchTo(page, 'photo');
  // The empty capture card, anchored on its shutter, and no review.
  await expect(page.getByRole('button', { name: EN.scan.capture.takePhoto })).toBeVisible();
  await expect(reviewHeading).toHaveCount(0);
});

////////////////////////////////////////////////////////////////////////////////
// (d) A draft survives leaving /add altogether, by the bottom bar
////////////////////////////////////////////////////////////////////////////////

test('the composer and the search box keep their drafts across a trip to the diary', async ({ page }) => {
  await completeOnboarding(page);

  await page.goto('/add/describe');
  const composer = page.locator('textarea#describe-meal');
  await composer.fill(MEAL_SENTENCE);

  // OUT OF /add ENTIRELY, so the layout and its switcher unmount too.
  await bottomBarLink(page, EN.nav.diary).click();
  await page.waitForURL('**/diary**');
  await bottomBarLink(page, EN.nav.add).click();
  await page.waitForURL((url) => url.pathname === METHOD_PATHS.search);

  // The search box, typed into on this visit, then left the same way.
  const searchBox = page.locator('#food-search');
  await searchBox.fill('porridge');

  await switchTo(page, 'describe');
  await expect(composer).toHaveValue(MEAL_SENTENCE);

  await bottomBarLink(page, EN.nav.diary).click();
  await page.waitForURL('**/diary**');
  await bottomBarLink(page, EN.nav.add).click();
  await page.waitForURL((url) => url.pathname === METHOD_PATHS.search);
  // The Add tab opens the bare `/add/search`, with no `?q=`: the words come
  // from the draft, not from the address.
  await expect(searchBox).toHaveValue('porridge');
});

////////////////////////////////////////////////////////////////////////////////
// (e) A logged entry clears its draft
////////////////////////////////////////////////////////////////////////////////

test('logging the opened food clears the search draft', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, { name: LOGGED_FOOD, grams: '100', carbs: '40' });

  await page.goto(`/add/search?q=${encodeURIComponent(LOGGED_FOOD)}`);
  await page.locator('[data-slot="search-result-row"]').filter({ hasText: LOGGED_FOOD }).first().click();
  const grams = page.locator('input[name="quantityGrams"]');
  await grams.fill(EDITED_PORTION_GRAMS);
  await page.getByRole('button', { name: EN.add.portion.submit }).click();
  await page.waitForURL('**/diary**');

  // Back the way test (d) proved keeps a draft, so an empty screen here is
  // the log's doing and not the way back's.
  await bottomBarLink(page, EN.nav.add).click();
  await page.waitForURL((url) => url.pathname === METHOD_PATHS.search);
  const searchBox = page.locator('#food-search');
  await expect(searchBox).toBeVisible();
  await expect(searchBox).toHaveValue('');
  await expect(grams).toHaveCount(0);
});

test('logging a sentence from the composer clears the composer, and not before', async ({ page }) => {
  const model = await fakeTheModel(page, { answer: 'identify', isHeld: false });
  await completeOnboarding(page);
  await connectTheFakeModel(page);

  await page.goto('/add/describe');
  const composer = page.locator('textarea#describe-meal');
  await composer.fill(MEAL_SENTENCE);
  await page.getByRole('button', { name: EN.describe.send, exact: true }).click();
  await page.waitForURL((url) => url.pathname === METHOD_PATHS.photo);
  const reviewHeading = page.getByText(EN.scan.review.heading, { exact: true });
  await expect(reviewHeading).toBeVisible();

  // SENDING IS NOT LOGGING: the words are still in the composer, so an
  // analysis that went wrong can be fixed there and sent again.
  await switchTo(page, 'describe');
  await expect(composer).toHaveValue(MEAL_SENTENCE);

  await switchTo(page, 'photo');
  await expect(reviewHeading).toBeVisible();
  expect(model.calls(), 'the review came back by asking the model again').toBe(1);
  await page.getByRole('button', { name: EN.scan.review.confirmAndLog }).click();
  await page.waitForURL('**/diary**');

  await bottomBarLink(page, EN.nav.add).click();
  await page.waitForURL((url) => url.pathname === METHOD_PATHS.search);
  await switchTo(page, 'describe');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue('');
});

////////////////////////////////////////////////////////////////////////////////
// (f) One box on all three screens, and typing moves nothing; (h) aria-current
////////////////////////////////////////////////////////////////////////////////

test('the switcher sits in one box on all three screens and marks the one it is on', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto(METHOD_PATHS.search);
  await expect(methodLink(page, 'search')).toHaveAttribute('aria-current', 'page');

  const boxes: Record<string, { top: number; left: number; width: number; height: number }> = {};
  for (const method of ['search', 'describe', 'photo', 'search'] as const) {
    if (new URL(page.url()).pathname !== METHOD_PATHS[method]) await switchTo(page, method);
    await settleFrames(page);
    boxes[method] = await switcherBox(page);

    ////////////////////////////////////////////////////////////////////////
    // (h) EXACTLY ONE current link, and it is this screen's. Across the
    // three screens that is also the control: a switcher that marked the
    // same link everywhere fails on the second screen.
    ////////////////////////////////////////////////////////////////////////
    const current = switcher(page).locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('data-method', method);

    // Every segment is a thumb's target.
    for (const other of METHODS) {
      const box = await methodLink(page, other).boundingBox();
      expect(box?.height ?? 0, `${other} on ${method} is too short to tap`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    }
  }

  ////////////////////////////////////////////////////////////////////////////
  // (f) ONE BOX. Top, left, width and height, to the pixel.
  ////////////////////////////////////////////////////////////////////////////
  expect(boxes.describe, 'the switcher moved between Search and Describe').toEqual(boxes.search);
  expect(boxes.photo, 'the switcher moved between Search and Photo').toEqual(boxes.search);

  // THE CONTROL: the same reader, on the same element, sees a nudge.
  const before = await switcherBox(page);
  await switcher(page).evaluate((element, px) => {
    element.style.marginTop = `${px}px`;
  }, CONTROL_NUDGE_PX);
  const nudged = await switcherBox(page);
  expect(nudged.top - before.top, 'the geometry reader does not see a move').toBe(CONTROL_NUDGE_PX);
});

test('typing in the composer shifts nothing and leaves the switcher where it is', async ({ page }) => {
  await installShiftObserver(page);
  await completeOnboarding(page);
  await page.goto(METHOD_PATHS.describe);

  const field = page.locator('textarea#describe-meal');
  await expect(field).toBeVisible();
  await settleAnimations(page);
  const switcherAtRest = await switcherBox(page);
  const topsBefore = await readTops(page);
  const entriesBefore = (await readShiftEntries(page)).length;

  // FROM THE EMPTY BOX, the first key included. An empty composer keeps the
  // height its wrapped placeholder gives it (M255/02), so the first key no
  // longer drops the box from 84 px to one line, and a short line typed key
  // by key, the way a person types it, never grows it: any movement here is a
  // defect and not a request.
  await field.pressSequentially('porridge and tea', { delay: 20 });
  await settleFrames(page);

  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, entriesBefore), JSON.stringify(entries.slice(entriesBefore))).toBe(0);
  expect(movedBetween(topsBefore, await readTops(page)), 'typing moved something on the screen').toEqual([]);
  expect(await switcherBox(page), 'typing moved the switcher').toEqual(switcherAtRest);

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL: the same observer, on the same page, sees a real shift.
  ////////////////////////////////////////////////////////////////////////////
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

////////////////////////////////////////////////////////////////////////////////
// (g) No switcher for the pantry's composer
////////////////////////////////////////////////////////////////////////////////

/**
 * Records, from before the first script runs, whether a switcher was EVER put
 * into the document, so "absent" means never drawn and not drawn and then
 * taken away.
 *
 * The server cannot answer this: `_personal`'s gate reads the device store in
 * a client loader, so the server's HTML is its loading fallback on every
 * personal route, with or without `?to=`. The first paint of the add layout
 * is the browser's, and this watches it.
 *
 * @param page - a page that has not navigated to the add screens yet.
 */
async function watchForTheSwitcher(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { value: false };
    Object.defineProperty(window, '__switcherEverDrawn', { get: () => seen.value });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const selector = '[data-slot="add-method-switcher"]';
          if (node.matches(selector) || node.querySelector(selector) !== null) seen.value = true;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** What `watchForTheSwitcher` recorded on the current document. */
async function wasTheSwitcherEverDrawn(page: Page): Promise<boolean> {
  return page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__switcherEverDrawn')?.get?.() === true);
}

test('the pantry composer has no switcher, from the first paint', async ({ page }) => {
  await completeOnboarding(page);
  await watchForTheSwitcher(page);

  await page.goto('/add/describe?to=/pantry');
  // THE ANCHOR: the pantry's own composer is on the screen, so the absence
  // below is read from a rendered page and not from a blank one.
  await expect(page.getByText(EN.describe.pantry.title, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="add-method-switcher"]')).toHaveCount(0);
  expect(await wasTheSwitcherEverDrawn(page), 'the switcher was drawn for the pantry and then removed').toBe(false);

  // THE CONTROL: the same screen without `?to=` draws it, and the same
  // watcher, on a fresh document, records that it did.
  await page.goto(METHOD_PATHS.describe);
  await expect(page.getByText(EN.describe.title, { exact: true }).first()).toBeVisible();
  await expect(switcher(page)).toBeVisible();
  expect(await wasTheSwitcherEverDrawn(page), 'the watcher does not see a switcher being drawn').toBe(true);
});
