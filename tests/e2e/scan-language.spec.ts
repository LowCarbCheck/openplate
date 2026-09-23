/**
 * A scan on a German screen asks for German names and for translations
 * (M251 spec 02).
 *
 * ── WHAT THE OPERATOR SAW ────────────────────────────────────────────────
 *
 * The launch walk (2026-09-23) found English food names on German screens. The
 * photo prompt named no language at all, so the model mostly answered in
 * English, and the diary kept whatever arrived.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * The request the browser really sends to the person's provider: its system
 * prompt names the app language as the language to write `name` in, and the
 * enforced JSON Schema demands a `translations` entry for every app language.
 * The prompt is read for the language CODE it names, which this app owns, and
 * never for wording a translator owns.
 *
 * It also proves the tolerant half: the faked model answers WITHOUT
 * `translations`, the way a weak BYOK model does, and the review screen still
 * opens on the item.
 *
 * ── THE CONTROL ──────────────────────────────────────────────────────────
 *
 * The same scan on an English screen names English and not German, so the
 * German assertion cannot be met by a prompt that names German always.
 *
 * ── WHY THE MODEL IS FAKED ON THIS ORIGIN ────────────────────────────────
 *
 * For the reasons `scan-review.spec.ts` gives: the production CSP only allows
 * a provider origin it knows plus `'self'`, and a same-origin address needs no
 * CORS preflight, which `page.route` does not answer.
 */
import { expect, test, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { EN } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, useLanguage } from './helpers';

/** The fake provider's base URL: this app's own origin, on a path nothing serves. */
const VISION_BASE_URL = `${E2E_APP_URL}/e2e-scan-language/v1`;

/** A valid 1 x 1 RGBA PNG, the smallest thing the capture path accepts. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A name no food database returns, so the review card found below can only be this item. */
const FOOD_NAME = 'Scan language probe';

/** One item in the wire shape, WITHOUT `translations`: what a weak BYOK model sends. */
const IDENTIFICATION_WITHOUT_TRANSLATIONS = {
  foods: [
    {
      name: FOOD_NAME,
      estimatedGrams: 100,
      confidence: 'high',
      portionHint: null,
      macrosPer100g: { carbs: 10, fiber: 2, sugars: null, polyols: null, protein: 5, fat: 3, kcal: 90 },
      macroSource: 'estimated',
      carbBasis: null,
      brand: null,
      servingSize: null,
      flags: { pregnancy: [], allergens: [], mayContain: [] },
    },
  ],
  unreadable: false,
  unreadableReason: null,
  notes: null,
};

/** What the scan sent: the system prompt and the `translations` keys the enforced schema demands. */
interface SentScan {
  systemPrompt: string;
  translationKeys: string[];
}

/** The request body fields this spec reads, and nothing else. */
interface ChatRequestBody {
  messages?: { role?: string; content?: string }[];
  response_format?: {
    json_schema?: {
      schema?: { properties?: { foods?: { items?: { properties?: { translations?: { required?: string[] } } } } } };
    };
  };
}

/**
 * Answers the provider's two requests and the food lookup, and records what
 * the chat request carried.
 *
 * @param page - the page to install the handlers on, before it is navigated.
 * @returns the list the chat requests are recorded into, in the order they were sent.
 */
async function fakeTheVisionProvider(page: Page): Promise<SentScan[]> {
  const sent: SentScan[] = [];
  await page.route(`${VISION_BASE_URL}/models`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );
  await page.route(`${VISION_BASE_URL}/chat/completions`, (route) => {
    // SAFETY: this handler only ever receives the openai-compatible adapter's
    // own JSON body; `ChatRequestBody` names the fields read below, all optional.
    const body = route.request().postDataJSON() as ChatRequestBody;
    const system = body.messages?.find((message) => message.role === 'system');
    const translations =
      body.response_format?.json_schema?.schema?.properties?.foods?.items?.properties?.translations;
    sent.push({ systemPrompt: system?.content ?? '', translationKeys: [...(translations?.required ?? [])] });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          { index: 0, message: { role: 'assistant', content: JSON.stringify(IDENTIFICATION_WITHOUT_TRANSLATIONS) } },
        ],
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
  return sent;
}

/** Connects the fake endpoint through the real AI settings form, in English. See `scan-review.spec.ts`. */
async function connectFakeProvider(page: Page): Promise<void> {
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill('e2e-scan-language-model');
  await page.locator('input[name="baseUrl"]').fill(VISION_BASE_URL);
  await page.locator('input[name="apiKey"]').fill('e2e-not-a-real-key');
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();
  await page.waitForURL('**/diary');
}

/** Scans one photo on a screen in `language` and returns what the first chat request carried. */
async function scanIn(page: Page, language: LanguageCode): Promise<SentScan> {
  const sent = await fakeTheVisionProvider(page);
  await completeOnboarding(page);
  await connectFakeProvider(page);
  await useLanguage(page, language);

  await page.goto('/add/photo');
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  // THE TOLERANT HALF: the answer carried no translations, and the review
  // still opens on the item rather than on a "try again" error.
  await expect(page.locator('form [data-slot="card"]').filter({ hasText: FOOD_NAME })).toBeVisible();
  const first = sent[0];
  if (first === undefined) throw new Error('the scan reached the review without a chat request');
  return first;
}

test('a German scan asks for German names and a translation per app language', async ({ page }) => {
  const sent = await scanIn(page, 'de');
  expect(sent.systemPrompt).toContain('(language code "de")');
  expect(sent.translationKeys.toSorted()).toEqual([...SUPPORTED_LANGUAGES].toSorted());
});

test('control: an English scan names English, and not German', async ({ page }) => {
  const sent = await scanIn(page, 'en');
  expect(sent.systemPrompt).toContain('(language code "en")');
  expect(sent.systemPrompt).not.toContain('(language code "de")');
});
