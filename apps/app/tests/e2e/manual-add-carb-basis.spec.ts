/**
 * A food typed by hand from an EU pack keeps its carbs (operator report,
 * 2026-10-29): "The app still computes net carbs as carbs minus fiber. That
 * is only right for US labels. EU labels already print carbs without fiber."
 *
 * THE BUG. The manual form asks which label the numbers came from, and its
 * default answer stores no basis at all. Net carbs read "no basis" as a US
 * label, so a German pack typed in as "carbs 10, fibre 6" came out as 4 g net
 * carbs instead of 10, often with a green dot. Understating carbs is the
 * dangerous direction for a low-carb tracker.
 *
 * THE FIX THIS GUARDS. A missing basis is resolved from the numbers
 * (`resolveCarbBasis` in `app/lib/net-carbs.ts`), and with no evidence for a
 * US label the answer is the EU one, which can only overstate net carbs by the
 * fibre. With carbs 10 and fibre 6 and nothing else typed there is no such
 * evidence, so the entry keeps all 10 g.
 *
 * WHAT IS CLAIMED.
 *
 *  1. Left on its default, the entry reads 10 g net carbs on the diary row and
 *     on its own page, and the page states the EU formula beside it.
 *  2. THE CONTROL. The same numbers with "US style" pressed read 4 g and the US
 *     formula, so the walk tells the two bases apart and the explicit choice
 *     still wins over the resolver.
 *
 * Copy is read from the shipped English catalog (`./copy`), never transcribed.
 *
 * @area diary-and-add
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { completeOnboarding, logFoodManually } from './helpers';

/** Carbs per 100 g as an EU pack prints them, without the fibre. */
const CARBS = 10;

/** Fibre per 100 g, its own row on the same pack. */
const FIBER = 6;

/** What net carbs are when the carbs figure already leaves the fibre out. */
const EU_NET_CARBS = String(CARBS);

/** What net carbs are when the fibre is taken out a second time. */
const US_NET_CARBS = String(CARBS - FIBER);

/** The diary row of the entry with this name. */
function entryRow(page: Page, name: string) {
  return page.locator('main a[href^="/diary/entry/"]').filter({ hasText: name });
}

/**
 * Opens the entry's own page from its diary row and returns the card that
 * holds its macro rows and the formula line under them.
 */
async function openEntry(page: Page, name: string) {
  await entryRow(page, name).first().click();
  await page.waitForURL('**/diary/entry/**');
  return page.locator('main [data-slot="card"]');
}

test('a manual food left on the default basis keeps carbs that already exclude fibre', async ({ page }) => {
  // THE CONTROLS. If the two figures or the two formulas were the same, this
  // walk could not tell the fixed build from the unfixed one.
  expect(EU_NET_CARBS, 'CONTROL: the EU and US readings differ').not.toBe(US_NET_CARBS);
  expect(EN.entry.netCarbsFormulaAvailable, 'CONTROL: the two formula lines differ').not.toBe(
    EN.entry.netCarbsFormulaTotal,
  );

  const name = 'EU pack crispbread';
  await completeOnboarding(page);
  await logFoodManually(page, { name, grams: '100', carbs: String(CARBS), fiber: String(FIBER) });

  const row = entryRow(page, name);
  await expect
    .soft(row, 'the diary row keeps all 10 g')
    .toContainText(fill(EN.diary.netCarbsValue, { value: EU_NET_CARBS }));
  await expect
    .soft(row, 'the diary row does not take the fibre out twice')
    .not.toContainText(fill(EN.diary.netCarbsValue, { value: US_NET_CARBS }));

  const cards = await openEntry(page, name);
  await expect
    .soft(page.locator('main'), 'the entry page keeps all 10 g per 100 g')
    .toContainText(fill(EN.entry.hero.per100gBadge, { value: EU_NET_CARBS }));
  await expect
    .soft(cards.getByText(EN.entry.netCarbsFormulaAvailable, { exact: true }), 'the page states the EU formula')
    .toBeVisible();
  await expect
    .soft(cards.getByText(EN.entry.netCarbsFormulaTotal, { exact: true }), 'and not the US one')
    .toHaveCount(0);
});

test('CONTROL: the same food with US style pressed takes the fibre out', async ({ page }) => {
  const name = 'US pack crispbread';
  await completeOnboarding(page);
  await logFoodManually(page, { name, grams: '100', carbs: String(CARBS), fiber: String(FIBER), carbBasis: 'total' });

  await expect(entryRow(page, name)).toContainText(fill(EN.diary.netCarbsValue, { value: US_NET_CARBS }));

  const cards = await openEntry(page, name);
  await expect(page.locator('main')).toContainText(fill(EN.entry.hero.per100gBadge, { value: US_NET_CARBS }));
  await expect(cards.getByText(EN.entry.netCarbsFormulaTotal, { exact: true })).toBeVisible();
  await expect(cards.getByText(EN.entry.netCarbsFormulaAvailable, { exact: true })).toHaveCount(0);
});
