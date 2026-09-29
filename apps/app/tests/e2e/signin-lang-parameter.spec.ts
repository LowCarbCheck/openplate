/**
 * `/sign-in` honours the lang parameter (M265/02).
 *
 * THE REPORT, 2026-09-28: openplate.de links to `/sign-in?lang=en`, and the
 * app ignored the parameter there. `/sign-up`, `/welcome` and the landing
 * already made a linked language the device's (`useLanguageFromLink`); the
 * sign-in page never called the hook, so a visitor who read the site in
 * English on a device that last spoke German got a German sign-in form.
 *
 * WHAT IS REAL: the tier's production server, its fake sync service, the
 * language cookie the server renders from, and the reload the switch makes.
 * Nothing is stubbed.
 *
 * NO SENTENCE IS PINNED. The title is compared with whatever each bundle says
 * today, read off disk, and the language is read from `<html lang>`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';
import { E2E_APP_URL } from './env';
import { useLanguage } from './helpers';
import { settleFrames } from './layout-shift';

test.use({ serviceWorkers: 'block' });

/** The one key this spec reads, in the two languages it reads it in. */
const titleSchema = z.object({ signIn: z.object({ title: z.string() }) });

/** The sign-in title in one shipped bundle. */
function signInTitle(locale: 'en' | 'de'): string {
  const catalog = JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${locale}/common.json`), 'utf8'));
  return titleSchema.parse(catalog).signIn.title;
}

const EN_TITLE = signInTitle('en');
const DE_TITLE = signInTitle('de');

/** The language the device's cookie names, or `null` when it has none. */
async function cookieLanguage(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies(E2E_APP_URL);
  return cookies.find((cookie) => cookie.name === LANGUAGE_COOKIE)?.value ?? null;
}

/** Waits until the form has hydrated, which is when the page's effects have run. */
async function waitForHydratedForm(page: Page): Promise<void> {
  await expect(page.locator('main [data-credential-submit]')).toBeEnabled({ timeout: 10_000 });
  await settleFrames(page);
}

test('the precondition: the two bundles name the title differently, so the title tells the languages apart', () => {
  expect(EN_TITLE).not.toBe(DE_TITLE);
});

test('/sign-in honours the lang parameter: a German device opening /sign-in?lang=en reads the English title', async ({
  page,
}) => {
  await useLanguage(page, 'de');
  await page.goto('/sign-in?lang=en');

  // THE SWITCH RAN: the document was reloaded in English, and the parameter
  // left the address so a refused cookie cannot loop the reload.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 10_000 });
  await expect(page).toHaveURL(`${E2E_APP_URL}/sign-in`);
  await expect(page.locator('main [data-slot="card-title"]')).toHaveText(EN_TITLE);
  // And the device keeps it: the next document is English too.
  expect(await cookieLanguage(page)).toBe('en');
});

test('the control: a German device opening /sign-in with no parameter stays German', async ({ page }) => {
  await useLanguage(page, 'de');
  let documentLoads = 0;
  page.on('load', () => {
    documentLoads += 1;
  });
  await page.goto('/sign-in');
  await waitForHydratedForm(page);

  // The same three readings as above, each finding the other answer.
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page).toHaveURL(`${E2E_APP_URL}/sign-in`);
  await expect(page.locator('main [data-slot="card-title"]')).toHaveText(DE_TITLE);
  expect(await cookieLanguage(page)).toBe('de');
  expect(documentLoads, 'the page reloaded with no language to switch to').toBe(1);
});
