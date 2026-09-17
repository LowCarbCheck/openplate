/**
 * The nutrient screen follows the instance's reference basis (M234 spec 07).
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * The whole browser-side chain, in a real page: the instance publishes a basis
 * on `/health`, the app reads that handshake, passes it to
 * `/api/nutrients?basis=`, and the footnote under every nutrient row names the
 * document that basis comes from. It is driven BOTH WAYS, EFSA and then DGE,
 * because a screen that always printed the same source would pass a one-way
 * check.
 *
 * ── WHAT IT DOES NOT PROVE ───────────────────────────────────────────────
 *
 * That an administrator's SAVE reaches a service. This tier has no
 * `openplate-core`: it runs against `tests/integration/fake-sync-service.ts`,
 * which implements no admin API at all, so the basis is changed here through
 * that fake's own test seam (`POST /__e2e__/instance-settings`) rather than
 * through the form at `/admin/settings`. The form, the schema and the
 * `PATCH /v1/admin/settings` request it makes are covered in
 * `tests/unit/admin-settings.test.ts`, and the service end of the same write is
 * covered in `openplate-core`.
 *
 * ── WHY THE WALK IS THIS LONG ────────────────────────────────────────────
 *
 * A footnote is only drawn for a row that HAS a reference amount, and that
 * needs two things the app will not invent: body metrics, because a reference
 * amount is published per sex and age band, and a logged food carrying real
 * micronutrient figures, because a row below the coverage bar prints "not
 * enough data" and no source at all. So the walk saves body metrics through the
 * real form and logs the fake food database's one row through the real search.
 *
 * ── TEXT CONTENT, NEVER A PICTURE ────────────────────────────────────────
 *
 * Every assertion below reads the text of the footnote elements. Headless
 * Chrome hides scrollbars, never applies `hover:` styles, and a fontless one
 * reports every text as hidden, so a screenshot of this screen would be
 * evidence of nothing.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_SYNC_SERVER_URL } from './env';
import { E2E_FOOD_NAME } from './fake-food-db';
import { completeOnboarding, headerStatusText } from './helpers';

/** The year of birth saved on the device. Any adult year lands inside a published band. */
const BIRTH_YEAR = '1990';

/** 100 g of the fake row, which is generous enough to cover a day of every nutrient it carries. */
const PORTION_GRAMS = '100';

/**
 * The first words of each basis's `source` string in the committed fixture.
 *
 * `tests/fixtures/nutrients-response.json` is LowCarbCheck's own document, and
 * its sources read "DGE Referenzwerte …", "DGE Orientierungswert …", "EFSA
 * Dietary Reference Values …" and "US Dietary Reference Intakes …". The body's
 * name is the stable part, so that is what is matched.
 */
const SOURCE_MARK = { dge: 'DGE', efsa: 'EFSA' } as const;

/** Sets what the instance publishes on `/health`. See this file's header for why it is not the form. */
async function setInstanceBasis(page: Page, basis: 'dge' | 'efsa' | 'us'): Promise<void> {
  const response = await page.request.post(`${E2E_SYNC_SERVER_URL}/__e2e__/instance-settings`, {
    data: { nutrientReferenceBasis: basis },
  });
  expect(response.status(), 'the fake instance must accept the new basis').toBe(200);
}

/** Saves the two body metrics a published reference amount is looked up by. */
async function saveBodyMetrics(page: Page): Promise<void> {
  await page.goto('/settings/profile');
  const form = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="save-body-metrics"]') });
  await form.locator('input[name="birthYear"]').fill(BIRTH_YEAR);
  // THE LABEL, not the input. The radio itself is `sr-only`, so its own label
  // covers it and a click on the input is intercepted; a person taps the chip.
  //
  // EXACT, because "Female" contains "Male": a substring match here selects the
  // wrong chip, and the screen that results still looks plausible.
  await form.getByText(EN.bodyMetrics.sex.male, { exact: true }).click();
  await form.getByRole('button', { name: EN.bodyMetrics.save }).click();

  // WAIT FOR THE APP'S OWN CONFIRMATION, then read the values back on a fresh
  // document. The card saves through a fetcher, so the click returns long
  // before the write lands, and a walk that moved on here would reach the
  // nutrient screen with no metrics stored and every row in its "add your
  // details" state. The status line is what the successful action redirects
  // with, so its appearance is the write having happened.
  await expect.poll(() => headerStatusText(page), { message: 'the save must be confirmed' }).not.toBe('');
  await page.reload();
  const saved = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="save-body-metrics"]') });
  await expect(saved.locator('input[name="birthYear"]')).toHaveValue(BIRTH_YEAR);
  await expect(saved.locator('input[name="biologicalSex"][value="male"]')).toBeChecked();
}

/** Logs the fake food database's one row through the real search, so the entry carries its micronutrients. */
async function logTheReferenceFood(page: Page): Promise<void> {
  await page.goto('/add');
  await page.locator('#food-search').fill(E2E_FOOD_NAME);
  await page.getByRole('button', { name: E2E_FOOD_NAME }).first().click();

  const portion = page.locator('form').filter({ has: page.locator('input[name="quantityGrams"]') });
  await portion.locator('input[name="quantityGrams"]').fill(PORTION_GRAMS);
  await portion.getByRole('button', { name: EN.add.portion.submit }).click();
  await page.waitForURL('**/diary**');
}

/** Every reference footnote on the nutrient screen, as text. Empty when no row has a reference amount. */
async function footnotes(page: Page): Promise<string[]> {
  await page.goto('/nutrients');
  const lines = page.locator('[data-slot="reference-footnote"]');
  // POLLED, because the screen renders from the on-device store first and the
  // published references arrive from this app's own server a moment later.
  await expect.poll(() => lines.count(), { message: 'at least one row must carry a reference amount' }).toBeGreaterThan(
    0,
  );
  return lines.allInnerTexts();
}

test('the nutrient footnotes name the body the instance publishes, in both directions', async ({ page }) => {
  await completeOnboarding(page);
  await saveBodyMetrics(page);
  await logTheReferenceFood(page);

  await setInstanceBasis(page, 'efsa');
  const european = await footnotes(page);
  expect(european.every((line) => line.includes(SOURCE_MARK.efsa))).toBe(true);
  // THE CONTROL, and it is the whole point of driving both directions: an app
  // that ignored the basis would print the same source here and below, and one
  // of the two assertions would fail.
  expect(european.some((line) => line.includes(SOURCE_MARK.dge))).toBe(false);

  await setInstanceBasis(page, 'dge');
  const german = await footnotes(page);
  expect(german.every((line) => line.includes(SOURCE_MARK.dge))).toBe(true);
  expect(german.some((line) => line.includes(SOURCE_MARK.efsa))).toBe(false);
});
