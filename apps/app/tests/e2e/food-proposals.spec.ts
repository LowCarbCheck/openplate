/**
 * A saved AI food becomes a proposal to LowCarbCheck (M251 spec 04).
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * This tier's server runs with `FOOD_DB_BACKFILL=true` and a key the fake
 * food database knows (`playwright.config.ts`). A photo with three foods is
 * confirmed: the person adopts the LowCarbCheck row offered for the first,
 * keeps the model's name for the second, and types their own name over the
 * third. The fake then holds exactly two proposals, a `translate` for the
 * adopted row's slug and a `new` for the second food, and nothing that names
 * the third. The fake records only a call carrying the instance key and no
 * browser `Origin`, so a recorded proposal is one the openplate SERVER relayed.
 *
 * ── THE CONTROLS ─────────────────────────────────────────────────────────
 *
 * The renamed food is the control inside the first case: it went through the
 * same confirm as the two that were sent. The second case switches the
 * person's own setting off and confirms the same photo: the page starts no
 * request to `/api/food-proposals` and the fake receives nothing. Its anchor is
 * the first case, where the request starts before the diary renders.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_APP_URL, E2E_FOOD_DB_URL } from './env';
import { FOOD_DB_PROPOSALS_PATH } from './fake-food-db';
import { completeOnboarding, useLanguage } from './helpers';

const VISION_BASE_URL = `${E2E_APP_URL}/e2e-food-proposals/v1`;

/** A valid 1 x 1 RGBA PNG, the smallest thing the capture path accepts. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Names nothing else in the tier uses, per food and per app language. */
function namesFor(stem: string) {
  return {
    en: `${stem} probe`,
    de: `${stem} Probe`,
    fr: `${stem} sonde`,
    it: `${stem} sonda`,
    es: `${stem} prueba`,
    tr: `${stem} deneme`,
  };
}
const ADOPTED = namesFor('Salmon');
const NEW_FOOD = namesFor('Kale bowl');
const RENAMED = namesFor('Crumble');
const HAND_NAME = 'Grandmother pie of my own';
const ADOPTED_SLUG = 'e2e-proposal-salmon';

/** One item in the wire shape, with every translation. */
function item(names: typeof ADOPTED) {
  return {
    name: names.en,
    estimatedGrams: 120,
    confidence: 'high',
    portionHint: null,
    macrosPer100g: { carbs: 6, fiber: 2, sugars: 1, polyols: null, protein: 8, fat: 4, kcal: 95 },
    macroSource: 'estimated',
    carbBasis: null,
    brand: null,
    servingSize: null,
    flags: { pregnancy: [], allergens: [], mayContain: [] },
    translations: names,
  };
}

const IDENTIFICATION = {
  foods: [item(ADOPTED), item(NEW_FOOD), item(RENAMED)],
  unreadable: false,
  unreadableReason: null,
  notes: null,
};

/** The LowCarbCheck row offered for the first food: curated, confident, one tap to adopt. */
const ADOPTED_MATCH = {
  slug: ADOPTED_SLUG,
  locale: 'en',
  title: 'Salmon, probe row',
  canonicalName: 'Salmon, probe row',
  url: null,
  imageUrl: null,
  macrosPer100g: { kcal: 180, protein: 20, fat: 11, carbs: 0, fiber: 0, sugars: 0, polyols: 0 },
  netCarbsPer100g: 0,
  attribution: null,
  score: 0.95,
  origin: 'curated',
  portionSize: 120,
};

async function fakeTheVisionProvider(page: Page): Promise<void> {
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
      body: JSON.stringify({ matches: [[ADOPTED_MATCH], [], []], throttled: false }),
    }),
  );
}

async function connectFakeProvider(page: Page): Promise<void> {
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill('e2e-food-proposals-model');
  await page.locator('input[name="baseUrl"]').fill(VISION_BASE_URL);
  await page.locator('input[name="apiKey"]').fill('e2e-not-a-real-key');
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();
  await page.waitForURL('**/diary');
}

/** What the fake food database has received, in arrival order. */
async function recordedProposals(page: Page): Promise<{ kind: string; slug?: string; translations: Record<string, string>; macrosPer100g?: object; via: string }[]> {
  const response = await page.request.get(`${E2E_FOOD_DB_URL}${FOOD_DB_PROPOSALS_PATH}`);
  // SAFETY: the fake's own seam answers `{ proposals }` with what it recorded.
  return ((await response.json()) as { proposals: [] }).proposals;
}

/** Scans the photo, adopts the first match, renames the third food, confirms. Returns the proposal requests the page started. */
async function scanAndConfirm(page: Page): Promise<string[]> {
  const started: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/food-proposals') started.push(request.method());
  });
  await page.goto('/add/photo');
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  const adoptedCard = page.locator('form [data-slot="card"]').filter({ hasText: ADOPTED.en });
  await expect(adoptedCard).toBeVisible();
  await adoptedCard.getByRole('button', { name: EN.scan.review.match.useThisData }).click();

  // THE HAND EDIT: the third food gets the person's own name.
  const renamedCard = page.locator('form [data-slot="card"]').filter({ hasText: RENAMED.en });
  await renamedCard.getByRole('button', { name: EN.scan.review.fineTune }).click();
  await renamedCard.locator('input[name$="].name"]').fill(HAND_NAME);

  await page.getByRole('button', { name: EN.scan.review.confirmAndLog }).click();
  await page.waitForURL('**/diary**');
  await expect(page.locator('main a[href^="/diary/entry/"]').filter({ hasText: HAND_NAME })).toHaveCount(1);
  return started;
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${E2E_FOOD_DB_URL}${FOOD_DB_PROPOSALS_PATH}`);
  await fakeTheVisionProvider(page);
  await useLanguage(page, 'en');
  await completeOnboarding(page);
  await connectFakeProvider(page);
});

test('backfill on: one translate for the adopted row, one new food, nothing for the renamed one', async ({ page }) => {
  const started = await scanAndConfirm(page);
  expect(started, 'the page must start one proposal request, before the diary renders').toEqual(['POST']);

  await expect.poll(async () => (await recordedProposals(page)).length).toBe(2);
  const [first, second] = await recordedProposals(page);
  expect(first).toEqual({ kind: 'translate', slug: ADOPTED_SLUG, translations: ADOPTED, via: 'photo' });
  expect(second).toEqual({
    kind: 'new',
    translations: NEW_FOOD,
    macrosPer100g: { carbs: 6, fat: 4, protein: 8, kcal: 95, fiber: 2 },
    via: 'photo',
  });
  // THE CONTROL: the renamed food went through the same confirm and is on
  // neither proposal, under any of its names or the person's own.
  const recorded = JSON.stringify(await recordedProposals(page));
  for (const name of [...Object.values(RENAMED), HAND_NAME]) expect(recorded).not.toContain(name);
});

test('the person switched it off: no request leaves the page and nothing arrives', async ({ page }) => {
  await page.goto('/settings/ai');
  const toggle = page.getByRole('switch', { name: EN.settingsAi.foodDb.label });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  const started = await scanAndConfirm(page);
  expect(started).toEqual([]);
  expect(await recordedProposals(page)).toEqual([]);
});
