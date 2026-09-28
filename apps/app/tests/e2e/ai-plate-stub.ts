/**
 * One plate logged through the real scan, against the stub provider
 * `connectStubAiProvider` connects.
 *
 * The trial recap counts meals logged WITH AI (`trial-recap.ts`), so a spec
 * that needs the recap line needs one real intake: the photo goes through the
 * real capture card and the real review, and only the provider's answer is
 * stubbed. Two items on one plate, so the count has to fold one intake's rows
 * into one meal.
 */
import { expect, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_APP_URL } from './env';

/** The endpoint `connectStubAiProvider` connects. */
const STUB_PROVIDER_URL = `${E2E_APP_URL}/e2e-stub-provider/v1`;

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Two items on one plate, so the count has to fold one intake's rows into one meal. */
const IDENTIFICATION = JSON.stringify({
  foods: ['Recap tier rye bread', 'Recap tier butter'].map((name) => ({
    name,
    estimatedGrams: 30,
    confidence: 'high',
    portionHint: null,
    macrosPer100g: { carbs: 40, fiber: 6, sugars: null, polyols: null, protein: 8, fat: 10, kcal: 300 },
    macroSource: 'estimated',
    carbBasis: null,
    brand: null,
    servingSize: null,
  })),
  unreadable: false,
  unreadableReason: null,
  notes: null,
});

/**
 * Answers every chat completion the stub provider receives with the two-item
 * plate above. Call before the scan.
 *
 * @param page - the page whose context routes the provider.
 */
export async function routeStubPlateAnswer(page: Page): Promise<void> {
  await page.route(`${STUB_PROVIDER_URL}/chat/completions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: IDENTIFICATION } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    }),
  );
}

/**
 * Photographs one plate and logs both of its items.
 *
 * @param page - a signed-in page with the stub provider connected and answered.
 */
export async function logOnePlateWithAi(page: Page): Promise<void> {
  await page.goto('/add/photo');
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();
  await page.getByRole('button', { name: EN.scan.review.confirmAndLog }).click();
  await page.waitForURL('**/diary**');
}
