/**
 * The legal pages come from a mounted markdown folder (M246 spec 01).
 *
 * The webServer in `playwright.config.ts` mounts `tests/fixtures/content`, a
 * folder of NEUTRAL fixture pages that follows the same file contract as the
 * real, private files. Every assertion here is about what the app does with a
 * file: it draws the file's title and date, its blocks as elements, its links
 * through the router, and it keeps the statutory form working around the
 * file's prose. None of it pins a legal sentence, because none is here.
 *
 * Every test starts on a fresh context: no account, no onboarding, a visitor
 * who has never signed in, which is who these pages are for.
 *
 * ── EVERY CHECK HAS A CONTROL ──
 * The router-link check has a full-reload control (a plain `goto` loses the
 * window marker, so the marker can tell the two apart). The no-shift check has
 * a control that reveals a field on purpose and requires the reading to see
 * it. The square-corner reader is handed an injected rounded box first and
 * must report it.
 */
import { expect, test, type Page, type Route } from '@playwright/test';

import { E2E_SYNC_SERVER_URL } from './env';
import { useLanguage } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

/** The fixture's own words, copied from `tests/fixtures/content/en`. */
const FIXTURE = {
  termsTitle: 'Fixture terms',
  termsLead: 'This is placeholder text for the browser tests.',
  cancelTitle: 'Verträge hier kündigen',
  cancelLead: 'Fixture lead above the cancellation form.',
  cancelReceiptTitle: 'Fixture cancellation receipt',
  cancelMailNotice: 'Fixture mail notice for the cancellation receipt.',
  imprintTitle: 'Fixture imprint',
  websitePrivacyTitle: 'Fixture website privacy page',
} as const;

const DECLARATIONS_PATH = '/v1/legal/declarations';
const RECEIPT_ID = 'e2e-content-0000-4000-8000-000000000000';
const RECEIVED_AT = '2026-09-21T14:30:00+02:00';

/** Answers the preflight and the POST of a cancellation on the fake core's origin. */
async function stubCancellation(page: Page): Promise<void> {
  await page.route(`${E2E_SYNC_SERVER_URL}${DECLARATIONS_PATH}`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ receiptId: RECEIPT_ID, receivedAt: RECEIVED_AT, kind: 'kuendigung' }),
    });
  });
}

/** One element that draws a corner, named so a failure says which. */
interface Corner {
  what: string;
  radii: number[];
}

/**
 * Every visible element under `selector` that draws a rounded corner and is
 * not a circle by design (square box, radius at least half its width).
 */
async function roundedCornersIn(page: Page, selector: string): Promise<Corner[]> {
  return page.evaluate((root) => {
    const found: { what: string; radii: number[] }[] = [];
    for (const element of document.querySelectorAll(`${root}, ${root} *`)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(element);
      const radii = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ].map((value) => Number.parseFloat(value) || 0);
      if (radii.every((radius) => radius === 0)) continue;
      const isCircle = Math.abs(rect.width - rect.height) <= 1 && Math.min(...radii) >= rect.width / 2;
      if (isCircle) continue;
      found.push({ what: `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 80), radii });
    }
    return found;
  }, selector);
}

test.describe('content pages from the mounted folder', () => {
  test('/terms draws the fixture file logged out: title, date, blocks as elements', async ({ page }) => {
    const response = await page.goto('/terms');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/terms$/u);

    const article = page.locator('article');
    await expect(article.getByRole('heading', { level: 1, name: FIXTURE.termsTitle, exact: true })).toBeVisible();
    await expect(article).toContainText('Last updated: January 15, 2026');
    // The lead is a direct paragraph of the article, drawn after the date line.
    await expect(article.locator('> p').filter({ hasText: FIXTURE.termsLead })).toHaveCount(1);
    await expect(article.locator('h2')).toHaveCount(2);
    await expect(article.locator('h3')).toHaveCount(1);
    await expect(article.locator('ul > li')).toHaveCount(2);
    await expect(article.locator('ol > li')).toHaveCount(2);
    await expect(article.locator('strong').first()).toHaveText('strong text');
    await expect(article.locator('em').first()).toHaveText('emphasis');
    // The escape: `\*` in the file is a literal asterisk on the page, not emphasis.
    await expect(article).toContainText('an escaped asterisk * that stays literal');
    const outside = article.getByRole('link', { name: 'link to an outside site' });
    await expect(outside).toHaveAttribute('href', 'https://example.org');
    await expect(outside).toHaveAttribute('rel', 'noopener noreferrer');
    // The document title is the file's title, not a catalog string.
    await expect(page).toHaveTitle(`${FIXTURE.termsTitle} · openplate`);
  });

  test('an app path in a file navigates through the router, without a reload', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.termsTitle })).toBeVisible();
    await page.evaluate(() => Object.defineProperty(window, '__contentMarker', { value: 'still here' }));

    await page.locator('article').getByRole('link', { name: 'imprint', exact: true }).click();
    await expect(page).toHaveURL(/\/imprint$/u);
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.imprintTitle })).toBeVisible();
    const marker = await page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__contentMarker')?.value);
    expect(marker, 'a router navigation keeps the window').toBe('still here');

    // CONTROL: a full load does lose the marker, so the check above can fail.
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.termsTitle })).toBeVisible();
    const afterReload = await page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__contentMarker')?.value);
    expect(afterReload, 'CONTROL: a reload must drop the marker').toBeUndefined();
  });

  test('the imprint draws its definition list and hard breaks', async ({ page }) => {
    await page.goto('/imprint');
    const article = page.locator('article');
    await expect(article.locator('dl dt')).toHaveCount(4);
    await expect(article.locator('dl dd')).toHaveCount(4);
    // Three address lines, two hard breaks, in one paragraph.
    await expect(article.locator('p br')).toHaveCount(2);
    await expect(article.getByRole('link', { name: 'someone@example.org' })).toHaveAttribute(
      'href',
      'mailto:someone@example.org',
    );
  });

  test('a language with no file is served the English file, marked as English', async ({ page }) => {
    // The fixture has `de/terms.md` but no `de/imprint.md`.
    await useLanguage(page, 'de');
    await page.goto('/imprint');
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.imprintTitle })).toBeVisible();
    await expect(page.locator('article')).toHaveAttribute('lang', 'en');

    // CONTROL: where the German file exists, it is the one drawn, marked German.
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Fixture-Bedingungen' })).toBeVisible();
    await expect(page.locator('article')).toHaveAttribute('lang', 'de');
  });

  test('/privacy/website is a route of its own', async ({ page }) => {
    const response = await page.goto('/privacy/website');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.websitePrivacyTitle })).toBeVisible();
  });

  test('the footer carries the five legal links while the folder has an imprint', async ({ page }) => {
    await page.goto('/terms');
    const footer = page.locator('footer nav');
    for (const path of ['/privacy', '/terms', '/imprint', '/kuendigung', '/widerrufen']) {
      await expect(footer.locator(`a[href="${path}"]`), `the footer links ${path}`).toHaveCount(1);
    }
  });
});

test.describe('/kuendigung around the file', () => {
  test('draws the file prose logged out, and the form still reaches a receipt', async ({ page }) => {
    await stubCancellation(page);
    await page.goto('/kuendigung');
    await expect(page).toHaveURL(/\/kuendigung$/u);
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.cancelTitle, exact: true })).toBeVisible();
    await expect(page.locator('article > p').filter({ hasText: FIXTURE.cancelLead })).toHaveCount(1);
    // The `unavailable` section is not drawn while the service is configured.
    await expect(page.locator('article')).not.toContainText('Fixture unavailable text');

    await page.locator('input[name="name"]').fill('Erika Musterfrau');
    await page.locator('input[name="email"]').fill('erika@example.invalid');
    await page.getByRole('button', { name: 'jetzt kündigen', exact: true }).click();

    await page.waitForURL(/\/kuendigung\/bestaetigt$/u);
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.cancelReceiptTitle, exact: true })).toBeVisible();
    const text = await page.locator('article').innerText();
    expect(text).toContain(RECEIPT_ID);
    expect(text).toContain(FIXTURE.cancelMailNotice);
    expect(text, 'a receipt carries no revision date').not.toContain('Last updated');
  });

  test('shows the file’s unavailable text when the service cannot be reached', async ({ page }) => {
    await page.route(`${E2E_SYNC_SERVER_URL}${DECLARATIONS_PATH}`, (route) => route.abort('connectionrefused'));
    await page.goto('/kuendigung');
    await page.locator('input[name="name"]').fill('Erika Musterfrau');
    await page.locator('input[name="email"]').fill('erika@example.invalid');
    await page.getByRole('button', { name: 'jetzt kündigen', exact: true }).click();
    await expect(page.locator('form [aria-live="polite"]')).toHaveText('Fixture unavailable text for the cancellation form.');
    await expect(page).toHaveURL(/\/kuendigung$/u);
  });

  test('typing, picking an option and an invalid submit move nothing on the page', async ({ page }) => {
    await installShiftObserver(page);
    await page.goto('/kuendigung');
    await expect(page.locator('input[name="name"]')).toBeVisible();
    // THE BASELINE WAITS FOR THE FONTS. The swap from the fallback face to
    // Inter and Victor Mono reflows the text of every legal page on load, on
    // main as on this branch. Measured 2026-09-23 on two production builds at
    // the phone viewport: with the real text, /kuendigung shifts 0.0227 on
    // main and 0.0208 here, and with the web fonts blocked every legal page
    // shifts 0 on both. That is a load-time question for the font setup, not
    // for this form; what is judged here is what the PERSON's input does.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await settleAnimations(page);

    const baseline = await readTops(page);
    const entriesBefore = (await readShiftEntries(page)).length;

    // An invalid submit first: a field error appears in the box kept for it.
    await page.getByRole('button', { name: 'jetzt kündigen', exact: true }).click();
    await expect(page.locator('form p.text-red-600').first()).toBeVisible();
    await page.locator('input[name="name"]').fill('Erika Musterfrau');
    await page.locator('input[name="email"]').fill('erika@example.invalid');
    await page.locator('input[name="contractReference"]').fill('A-1');
    await page.locator('input[name="timing"][value="onDate"]').check();
    await settleFrames(page);

    const moves = movedBetween(baseline, await readTops(page));
    const entries = (await readShiftEntries(page)).slice(entriesBefore);
    const report = entries.flatMap((entry) => entry.sources).join('\n');
    expect(moves, `elements moved\n${report}`).toEqual([]);
    expect(shiftScoreAfter(entries, 0), `layout-shift score\n${report}`).toBe(0);
  });

  test('CONTROL: an expansion the person asked for is seen by the same reading', async ({ page }) => {
    await installShiftObserver(page);
    await page.goto('/kuendigung');
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await settleAnimations(page);
    const baseline = await readTops(page);

    // Picking the extraordinary type reveals its reason field, which is allowed
    // to push the fields below it. The reading has to see that, or it sees nothing.
    await page.locator('input[name="terminationType"][value="ausserordentlich"]').check();
    await settleFrames(page);
    const moves = movedBetween(baseline, await readTops(page));
    expect(moves.length, 'CONTROL: revealing the reason field must move the fields below it').toBeGreaterThan(0);
  });

  test('draws no rounded corner in the article or the form', async ({ page }) => {
    await page.goto('/kuendigung');
    await expect(page.locator('input[name="name"]')).toBeVisible();

    // CONTROL: the reader reports a rounded box injected into the same article.
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'corner-probe';
      probe.style.cssText = 'width:40px;height:20px;border-radius:6px;background:red';
      document.querySelector('article')?.append(probe);
    });
    const withProbe = await roundedCornersIn(page, 'article');
    expect(withProbe.length, 'CONTROL: the injected rounded box must be reported').toBeGreaterThan(0);
    await page.evaluate(() => document.querySelector('#corner-probe')?.remove());

    expect(await roundedCornersIn(page, 'article')).toEqual([]);
  });
});
