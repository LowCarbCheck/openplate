/**
 * A diary row follows the reader's language (M251 spec 03).
 *
 * ── WHAT THE OPERATOR SAW ────────────────────────────────────────────────
 *
 * The launch walk (2026-09-23) found English food names on German screens.
 * Spec 02 made every AI answer carry the name in all six app languages; this
 * proves the diary keeps them and shows the one its reader reads.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * A food scanned on a German screen is logged with its translations. After a
 * switch to French the same diary row reads the French name, and the German
 * one is gone from it. Then the person renames it by hand, and the row shows
 * their words in French AND in German: their words win in every language.
 *
 * ── THE CONTROLS ─────────────────────────────────────────────────────────
 *
 * The French assertion is paired with "the German name is not on the row", so
 * a build that showed the stored name in every language cannot pass it. The
 * hand-edit half is the control for the translation half: after the edit the
 * row must NOT read the French translation any more.
 *
 * ── WHY THE MODEL IS FAKED ON THIS ORIGIN ────────────────────────────────
 *
 * For the reasons `scan-review.spec.ts` gives: the production CSP allows a
 * provider origin it knows plus `'self'`, and a same-origin address needs no
 * CORS preflight, which `page.route` does not answer.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, catalogFor } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, useLanguage } from './helpers';

const VISION_BASE_URL = `${E2E_APP_URL}/e2e-food-name-language/v1`;

/** A valid 1 x 1 RGBA PNG, the smallest thing the capture path accepts. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Names no food database returns and no catalog contains, so a row found by
 * one of them can only be this food.
 */
const NAMES = {
  en: 'Probe apple',
  de: 'Probeapfel',
  fr: 'Pomme sonde',
  it: 'Mela sonda',
  es: 'Manzana sonda',
  tr: 'Deneme elması',
};
const HAND_NAME = 'Hand typed orchard fruit';

/** The model's answer, on a German screen: `name` in German and every translation. */
const IDENTIFICATION = {
  foods: [
    {
      name: NAMES.de,
      estimatedGrams: 150,
      confidence: 'high',
      portionHint: null,
      macrosPer100g: { carbs: 12, fiber: 2, sugars: 10, polyols: null, protein: 0.3, fat: 0.2, kcal: 52 },
      macroSource: 'estimated',
      carbBasis: null,
      brand: null,
      servingSize: null,
      flags: { pregnancy: [], allergens: [], mayContain: [] },
      translations: NAMES,
    },
  ],
  unreadable: false,
  unreadableReason: null,
  notes: null,
};

/** Answers the provider's two requests and the food lookup with nothing matched. */
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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ matches: [[]], throttled: false }) }),
  );
}

/** Connects the fake endpoint through the real AI settings form, in English. See `scan-review.spec.ts`. */
async function connectFakeProvider(page: Page): Promise<void> {
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill('e2e-food-name-model');
  await page.locator('input[name="baseUrl"]').fill(VISION_BASE_URL);
  await page.locator('input[name="apiKey"]').fill('e2e-not-a-real-key');
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();
  await page.waitForURL('**/diary');
}

/**
 * The persisted `foodLogs` table as text, for a WAIT before a reload, never an
 * assertion: the persister saves after the transaction, so a reload fired the
 * moment the screen updates can beat the save (`pantryRowsOnDisk` in
 * `helpers.ts` has the full story). What the diary shows is asserted on the
 * reloaded page, through the app's own read.
 */
async function foodLogsOnDisk(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('t')) {
            db.close();
            resolve('');
            return;
          }
          const read = db.transaction('t', 'readonly').objectStore('t').get('foodLogs');
          read.addEventListener('success', () => {
            db.close();
            resolve(JSON.stringify(read.result ?? null));
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the food log table could not be read'));
          });
        });
      }),
  );
}

/** The diary's link to the one logged entry. */
function entryRow(page: Page) {
  return page.locator('main a[href^="/diary/entry/"]');
}

test('the row reads in the reader’s language after a switch, and a hand edit wins in every language', async ({ page }) => {
  await fakeTheVisionProvider(page);
  await completeOnboarding(page);
  await connectFakeProvider(page);

  // SCAN AND CONFIRM ON A GERMAN SCREEN.
  await useLanguage(page, 'de');
  await page.goto('/add/photo');
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.locator('form [data-slot="card"]').filter({ hasText: NAMES.de })).toBeVisible();
  await page.getByRole('button', { name: catalogFor('de').scan.review.confirmAndLog }).click();
  await page.waitForURL('**/diary**');
  await expect(entryRow(page)).toHaveCount(1);
  await expect(entryRow(page)).toContainText(NAMES.de);
  await expect.poll(() => foodLogsOnDisk(page)).toContain(NAMES.fr);

  // SWITCH TO FRENCH: the same row, the French name, and the German one gone.
  await useLanguage(page, 'fr');
  await page.goto('/diary');
  await expect(entryRow(page)).toContainText(NAMES.fr);
  await expect(entryRow(page)).not.toContainText(NAMES.de);

  // THE HAND EDIT, on the French screen. The field shows the French name.
  await entryRow(page).click();
  await page.waitForURL('**/diary/entry/**');
  const entryUrl = page.url();
  await page.goto(`${entryUrl}?edit=1`);
  const nameField = page.locator('form input[name="name"]');
  await expect(nameField).toHaveValue(NAMES.fr);
  await nameField.fill(HAND_NAME);
  await page.getByRole('button', { name: catalogFor('fr').entry.edit.save }).click();
  await page.waitForURL((url) => !url.search.includes('edit=1'));
  await expect.poll(() => foodLogsOnDisk(page)).toContain(HAND_NAME);

  // THE CONTROL: their words, in French and in German, never a translation.
  await page.goto('/diary');
  await expect(entryRow(page)).toContainText(HAND_NAME);
  await expect(entryRow(page)).not.toContainText(NAMES.fr);
  await useLanguage(page, 'de');
  await page.goto('/diary');
  await expect(entryRow(page)).toContainText(HAND_NAME);
  await expect(entryRow(page)).not.toContainText(NAMES.de);
});
