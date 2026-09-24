/**
 * The account menu drops the language picker (M257).
 *
 * The operator's own words, from a phone screenshot of the German menu:
 * language "can safely be put into another setting section, no need to put
 * that into the overlay right away". The picker sat under the theme row from
 * M230 until this milestone; the language choice now lives only on
 * `/settings/preferences`, which already offered it through the same
 * `selectLanguage` mechanism.
 *
 * TWO CHECKS, NOT ONE. The first opens the menu and reads language names off
 * the catalog (`LANGUAGE_LABELS`) rather than a pinned string, so a rename of
 * "Deutsch" does not make this spec pass for the wrong reason. The theme row
 * is checked at the same time, as the CONTROL: it must still be there,
 * because it is exactly what the language row used to sit next to, and a
 * broken menu render would satisfy "no language" by showing nothing at all.
 * The second check opens `/settings/preferences` and proves the door the
 * picker moved through still works, by picking a language and reading
 * `document.documentElement.lang` after the reload `selectLanguage` does.
 *
 * ON THE OLD MENU this spec's first test failed: the theme row's three
 * `menuitemradio` cells shared the count with the language strip's six, so
 * `toHaveCount(3)` read nine.
 */
import { expect, test } from '@playwright/test';

import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { completeOnboarding } from './helpers';

test('the account menu keeps the theme and drops the language picker', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');

  await page.locator('header button[aria-haspopup="menu"]').first().click();
  const menu = page.locator('[role="menu"]');
  await expect(menu).toBeVisible();

  // THE CONTROL: the theme row is three segmented cells, one per
  // `THEME_OPTIONS` entry. Reading zero here would mean the menu did not
  // open at all, and the absence check below would be passing for nothing.
  await expect(menu.locator('[role="menuitemradio"]'), 'the theme row must still be three cells').toHaveCount(3);

  // NO LANGUAGE NAME ANYWHERE IN THE MENU, read off the catalog rather than
  // pinned so a rename of a language's own name still catches a regression.
  const menuText = await menu.innerText();
  for (const code of SUPPORTED_LANGUAGES) {
    expect(menuText, `${LANGUAGE_LABELS[code]} must not appear in the menu`).not.toContain(LANGUAGE_LABELS[code]);
  }

  await page.keyboard.press('Escape');
});

test('/settings/preferences still switches the language', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings/preferences');

  const startingLanguage = await page.locator('html').getAttribute('lang');
  const nextLanguage = SUPPORTED_LANGUAGES.find((code) => code !== startingLanguage) ?? SUPPORTED_LANGUAGES[0];

  await page.getByRole('button', { name: LANGUAGE_LABELS[nextLanguage], exact: true }).click();

  await expect(page.locator('html'), 'the document must reload into the picked language').toHaveAttribute(
    'lang',
    nextLanguage,
  );
});
