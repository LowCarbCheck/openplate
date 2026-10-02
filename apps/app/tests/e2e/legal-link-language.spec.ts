/**
 * openplate.de's legal links honour `?lang=` on the first paint (M267/01).
 *
 * THE REPORT: openplate.de links to the app's legal pages, the imprint, the
 * website privacy notice, the terms and `/kuendigung`, with no language.
 * A reader of `openplate.de/en/` who clicked "Imprint" landed on the
 * instance's default-language file, German on this deployment, because the
 * app only ever read its own cookie. Two fixes, each with its own reason:
 *
 *  - `content-route.server.ts` now reads a `?lang=` query parameter BEFORE
 *    the cookie, so the FILE is right on the very first byte of HTML: this
 *    has to work with JavaScript off, because a reload (the mechanism every
 *    other logged-out screen uses) cannot run before that first paint.
 *  - The four routes the site links to (`/imprint`, `/privacy/website`,
 *    `/terms`, `/kuendigung`) call `useLanguageFromLink`, the same hook
 *    `/sign-in` uses since M265, so the choice persists as the device's
 *    cookie once JavaScript does run.
 *
 * The chrome around the article (the header, the footer) is NOT part of this
 * fix: it keeps following the cookie until the hook's reload, exactly as it
 * already does for the English fallback file (`ContentArticle`'s own doc
 * comment). Only the article itself, its `lang` attribute, its title, its
 * body, is asserted here.
 *
 * `/widerrufen` and `/kuendigung` carry the statutory German heading
 * "Vertrag widerrufen" / "Verträge hier kündigen" in every language on
 * purpose (M214/09, M265 spec 06); `?lang=` must never touch it. The fixture
 * files for both slugs use that same title in English and in German, so a
 * change that accidentally let a "translated" title through would be caught
 * by comparing the heading to the (identical) German string while the body
 * and the subtitle underneath it still prove the language really changed.
 *
 * WHAT IS REAL: the tier's production server and its mounted fixture
 * content folder (`tests/fixtures/content`), which carries en+de files for
 * `imprint`, `terms` and `widerrufen`. No sentence is pinned: every title is
 * the fixture's own front matter, and the English subtitle is read from the
 * shipped catalog (`./copy`), as `legal-page-english-subtitle.spec.ts` does.
 *
 * @area content-and-legal
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';
import { EN } from './copy';
import { E2E_APP_URL } from './env';
import { useLanguage } from './helpers';

test.use({ serviceWorkers: 'block' });

/** The two legal pages this spec drives, and their fixture titles in each language. */
const PAGES = [
  { path: '/imprint', en: 'Fixture imprint', de: 'Fixture-Impressum' },
  { path: '/terms', en: 'Fixture terms', de: 'Fixture-Bedingungen' },
] as const;

/** The language the device's cookie names, or `null` when it has none. */
async function cookieLanguage(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies(E2E_APP_URL);
  return cookies.find((cookie) => cookie.name === LANGUAGE_COOKIE)?.value ?? null;
}

/** The article's own `<h1>`, the box `ContentArticle` marks with the file's language. */
function heading(page: Page, name: string): import('@playwright/test').Locator {
  return page.locator('article').getByRole('heading', { level: 1, name, exact: true });
}

/** A fresh context in one cookie language, with JavaScript switched off, so only the server's markup is drawn. */
async function openWithoutScript(input: { browser: Browser; path: string; cookieLocale: 'en' | 'de' }): Promise<Page> {
  const context = await input.browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  await context.addCookies([{ name: LANGUAGE_COOKIE, value: input.cookieLocale, url: E2E_APP_URL }]);
  const page = await context.newPage();
  await page.goto(input.path);
  return page;
}

for (const fixture of PAGES) {
  test(`${fixture.path}?lang=en draws the English file on first paint with JavaScript off, from a German device`, async ({
    browser,
  }) => {
    const page = await openWithoutScript({ browser, path: `${fixture.path}?lang=en`, cookieLocale: 'de' });
    await expect(heading(page, fixture.en)).toBeVisible();
    await expect(page.locator('article')).toHaveAttribute('lang', 'en');
    // THE CHROME IS UNCHANGED ON PURPOSE: with no JavaScript nothing can write
    // the cookie, so the surrounding document still renders in the cookie's
    // language. This is the same split `ContentArticle` already draws for the
    // English fallback file; it is not a defect of this fix.
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.context().close();
  });

  test(`${fixture.path}?lang=en persists as the device's cookie once JavaScript runs`, async ({ page }) => {
    await useLanguage(page, 'de');
    await page.goto(`${fixture.path}?lang=en`);

    // THE SWITCH RAN: the document reloaded in English, and the parameter
    // left the address so a refused cookie cannot loop the reload, the same
    // proof `signin-lang-parameter.spec.ts` reads for `/sign-in`.
    await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 10_000 });
    await expect(page).toHaveURL(`${E2E_APP_URL}${fixture.path}`);
    await expect(heading(page, fixture.en)).toBeVisible();
    await expect(page.locator('article')).toHaveAttribute('lang', 'en');
    expect(await cookieLanguage(page)).toBe('en');
  });

  test(`CONTROL: ${fixture.path} with no parameter stays German on a German device`, async ({ page }) => {
    await useLanguage(page, 'de');
    let documentLoads = 0;
    page.on('load', () => {
      documentLoads += 1;
    });
    await page.goto(fixture.path);
    await expect(heading(page, fixture.de)).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('article')).toHaveAttribute('lang', 'de');
    await expect(page).toHaveURL(`${E2E_APP_URL}${fixture.path}`);
    expect(await cookieLanguage(page)).toBe('de');
    expect(documentLoads, 'the page reloaded with no language to switch to').toBe(1);
  });
}

test('CONTROL: /widerrufen?lang=en changes the body but keeps the German statutory heading', async ({ page }) => {
  await useLanguage(page, 'de');
  await page.goto('/widerrufen?lang=en');

  // The heading is the statutory German phrase in EVERY language, including
  // English: `?lang=` must not touch it.
  await expect(heading(page, 'Vertrag widerrufen')).toBeVisible();
  await expect(page.locator('article')).toHaveAttribute('lang', 'en');
  // Proof the query really was honoured: the subtitle under the heading only
  // ever appears on a page whose FILE is not German (`ContentArticle`'s own
  // rule), and it reads the English catalog string.
  await expect(page.locator('article [data-slot="content-subtitle"]')).toHaveText(EN.declarations.withdraw.subtitle);

  // CONTROL: with no parameter, the same device reads the German file: same
  // heading, no subtitle, `lang="de"`.
  await page.goto('/widerrufen');
  await expect(heading(page, 'Vertrag widerrufen')).toBeVisible();
  await expect(page.locator('article')).toHaveAttribute('lang', 'de');
  await expect(page.locator('article [data-slot="content-subtitle"]')).toHaveCount(0);
});
