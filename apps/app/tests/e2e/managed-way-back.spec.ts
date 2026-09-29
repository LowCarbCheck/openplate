/**
 * THE WAY BACK TO openplate.de (M266 design, step 2, approved by the owner on 2026-09-29).
 *
 * THE PROBLEM. openplate.de links to the legal pages on the app host, and a reader who came
 * for the imprint had no way home: the app's public chrome named the source repository and the
 * licence, and nothing on the project site. On a managed instance the pitch lives on
 * openplate.de, so the footer of every public page there now carries "openplate.de", in the
 * reader's language: German at the site's root, every other language under its prefix.
 *
 * WHAT IS REAL: the production build booted as a managed instance (`managed-app-server.ts`),
 * the fixture legal pages it mounts, and the footer it draws.
 *
 * THE CONTROLS. The tier's own server is an OPEN instance, and its footer names no project
 * site: a self-hoster's instance is nobody's storefront. The header keeps its two doors on this
 * page, which proves the door page's rule (they step aside on `/` only) did not reach the rest
 * of the chrome. The overflow reader is proven to see a break before its silence is trusted.
 */
import { expect, test, type Page } from '@playwright/test';

import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';
import { useLanguage } from './helpers';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot, beside the tier's 30 s per spec. */
const BOOT_BUDGET_MS = 90_000;

/** A public page every instance with legal pages draws in the public chrome. */
const LEGAL_PAGE = '/imprint';

/** The narrowest phone, the design width, a large Android phone. */
const PHONE_WIDTHS = [320, 390, 412] as const;
const PHONE_HEIGHT = 844;

/** The widths where the footer turns into one row (`sm` and up), read without mobile emulation. */
const DESKTOP_WIDTHS = [640, 768, 1024] as const;

/** The project site in the two languages this spec reads, written out rather than computed. */
const SITE_BY_LANGUAGE = {
  de: 'https://openplate.de/',
  en: 'https://openplate.de/en/',
} as const;

const FOOTER_SITE_LINK = 'footer a[data-slot="footer-project-site"]';

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** What overflows: the document, the footer, and any footer link outside the screen or its own box. */
async function readFooterOverflow(
  page: Page,
): Promise<{ documentWidth: number; viewportWidth: number; outside: string[] }> {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const footer = document.querySelector('footer');
    if (footer === null) throw new Error('the page has no footer');
    const outside = [footer, ...footer.querySelectorAll('nav, a, span')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return rect.left < 0 || rect.right > viewportWidth || element.scrollWidth > element.clientWidth + 1;
      })
      .map((element) => `${element.tagName} "${(element.textContent ?? '').trim().slice(0, 40)}"`);
    return { documentWidth: document.documentElement.scrollWidth, viewportWidth, outside };
  });
}

for (const language of ['de', 'en'] as const) {
  test(`a managed legal page links openplate.de in ${language}, and the footer fits at 320, 390 and 412 px`, async ({
    page,
  }) => {
    await page.context().addCookies([{ name: LANGUAGE_COOKIE, value: language, url: server.url }]);
    for (const width of PHONE_WIDTHS) {
      const where = `${language} at ${width} px`;
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      await page.goto(`${server.url}${LEGAL_PAGE}`);
      await expect(page.locator('html')).toHaveAttribute('lang', language);

      const link = page.locator(FOOTER_SITE_LINK);
      await expect(link, `${where}: the footer names no project site`).toBeAttached({ timeout: 10_000 });
      await link.scrollIntoViewIfNeeded();
      await expect(link, where).toBeVisible();
      await expect(link, where).toHaveAttribute('href', SITE_BY_LANGUAGE[language]);
      await expect(link, where).toHaveText('openplate.de');

      // THE HEADER KEEPS ITS DOORS HERE: only the door page on `/` draws them in the page instead.
      await expect(page.locator('header a[href="/sign-in"]'), where).toBeVisible();

      const fit = await readFooterOverflow(page);
      expect(fit.outside, `${where}: a footer link outside the screen or its box`).toEqual([]);
      expect(fit.documentWidth, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(fit.viewportWidth);
    }

    // THE CONTROL: the same reader names a footer link pushed past the screen.
    await page.locator(FOOTER_SITE_LINK).evaluate((node) => {
      if (!(node instanceof HTMLElement)) throw new Error('the footer link is not an HTML element');
      node.style.whiteSpace = 'nowrap';
      node.style.width = '900px';
    });
    expect((await readFooterOverflow(page)).outside.length, 'the overflow reader missed a 900 px link').toBeGreaterThan(
      0,
    );
  });
}

test('the control: an open instance footer names no project site', async ({ page }) => {
  // The tier's own server is an OPEN instance, with the same fixture legal pages.
  await useLanguage(page, 'en');
  await page.goto(LEGAL_PAGE);
  // The footer is drawn, with its legal links: the imprint link is the anchor for the absence.
  await expect(page.locator('footer a[href="/imprint"]')).toBeVisible();
  await expect(page.locator(FOOTER_SITE_LINK)).toHaveCount(0);
  await expect(page.locator('footer a[href^="https://openplate.de"]')).toHaveCount(0);
});

/**
 * FROM `sm` UP THE FOOTER LINKS ARE A ROW beside the tagline, and with the legal links they no
 * longer fit one line: before this change the German row needed about 700 px beside a tagline
 * in a 736 px container and could not wrap, so the outer `overflow-x-clip` cut off the imprint
 * and both statutory buttons below about 1000 px, on every instance. The managed row carries
 * one link more. Read without mobile emulation, which would zoom a wide page out to fit it.
 */
test.describe('from sm up, where the footer links are a row', () => {
  test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('the open footer row fits at 640, 768 and 1024 px in de', async ({ page }) => {
    await useLanguage(page, 'de');
    for (const width of DESKTOP_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(LEGAL_PAGE);
      await expect(page.locator('footer a[href="/widerrufen"]')).toBeAttached();
      const fit = await readFooterOverflow(page);
      expect(fit.outside, `open, de at ${width} px: a footer link outside the screen or its box`).toEqual([]);
      expect(fit.documentWidth, `open, de at ${width} px`).toBeLessThanOrEqual(fit.viewportWidth);
    }
  });

  for (const language of ['de', 'en'] as const) {
    test(`the managed footer row fits at 640, 768 and 1024 px in ${language}`, async ({ page }) => {
      await page.context().addCookies([{ name: LANGUAGE_COOKIE, value: language, url: server.url }]);
      for (const width of DESKTOP_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${server.url}${LEGAL_PAGE}`);
        await expect(page.locator(FOOTER_SITE_LINK)).toHaveAttribute('href', SITE_BY_LANGUAGE[language]);
        const fit = await readFooterOverflow(page);
        expect(fit.outside, `${language} at ${width} px: a footer link outside the screen or its box`).toEqual([]);
        expect(fit.documentWidth, `${language} at ${width} px`).toBeLessThanOrEqual(fit.viewportWidth);
      }
    });
  }
});
