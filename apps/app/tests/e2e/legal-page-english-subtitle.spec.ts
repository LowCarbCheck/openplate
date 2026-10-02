/**
 * An English subtitle under the German statutory heading of `/widerrufen` and
 * `/kuendigung` (M265 spec 06).
 *
 * § 356a BGB and § 312k BGB fix the labels "Vertrag widerrufen" and "Verträge
 * hier kündigen", so the `<h1>` of both pages and their confirm buttons are
 * German in every language, on purpose. Before this spec an English reader met
 * that German heading with nothing beside it to say what the page is for. Now
 * one line in the page's own language sits directly under the heading. The
 * heading and the button stay exactly as they are.
 *
 * What is asserted:
 *  - in English, the subtitle is the element right after the `<h1>`, drawn
 *    below it and above the date line, and reads the English catalog string;
 *  - the German heading and the German button text are still there;
 *  - it is in the server's markup, so it is in the first paint: a browser with
 *    JavaScript off draws it, and loading the page records a layout-shift
 *    total of 0;
 *  - the swap to the web fonts moves nothing at or above the subtitle.
 *  - the subtitle speaks the article's language: a French reader served the
 *    English fallback file gets the English line.
 *
 * THE CONTROL: a German page draws no subtitle at all, because its heading
 * already says what the page does. Before the fix the English checks failed
 * on the missing subtitle and the German control passed.
 *
 * No assertion pins a translated sentence: the subtitle is read from the
 * English catalog, and the headings are the fixture's own titles, copied from
 * `tests/fixtures/content/en`, which are the statutory labels.
 *
 * @area content-and-legal
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_APP_URL } from './env';
import { useLanguage } from './helpers';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames, shiftScoreAfter } from './layout-shift';
import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';

test.use({ serviceWorkers: 'block' });

/** Each statutory page, its German heading, and what the English catalog says under it and on its button. */
const PAGES = [
  {
    path: '/widerrufen',
    heading: 'Vertrag widerrufen',
    subtitle: EN.declarations.withdraw.subtitle,
    submit: EN.declarations.withdraw.submit,
  },
  {
    path: '/kuendigung',
    heading: 'Verträge hier kündigen',
    subtitle: EN.declarations.cancel.subtitle,
    submit: EN.declarations.cancel.submit,
  },
] as const;

function subtitle(page: Page): Locator {
  return page.locator('article [data-slot="content-subtitle"]');
}

function heading(page: Page, name: string): Locator {
  return page.locator('article').getByRole('heading', { level: 1, name, exact: true });
}

/** The page boxes the claim is about, read in one evaluation. */
async function readBoxes(page: Page): Promise<{ h1Bottom: number; subtitleTop: number; subtitleBottom: number; nextTop: number }> {
  return page.evaluate(() => {
    const h1 = document.querySelector('article h1');
    const line = document.querySelector('article [data-slot="content-subtitle"]');
    const next = line?.nextElementSibling;
    if (h1 === null || line === null || next === null || next === undefined) throw new Error('the article lost a box');
    return {
      h1Bottom: h1.getBoundingClientRect().bottom,
      subtitleTop: line.getBoundingClientRect().top,
      subtitleBottom: line.getBoundingClientRect().bottom,
      nextTop: next.getBoundingClientRect().top,
    };
  });
}

/**
 * Records the top of every box the browser reports as shifted, where it stood
 * before it moved, from before the first paint. `installShiftObserver` names
 * what moved but not where; this reading is what "nothing above the subtitle"
 * is judged by. A box inside a form control has no node the page can see, and
 * its rectangle is still reported, so it is counted too.
 */
async function recordShiftedTops(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tops: number[] = [];
    Object.defineProperty(window, '__shiftedTops', { value: tops });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // `toJSON` is typed `any` and is the one read of a `LayoutShift` that needs no cast.
        const json = entry.toJSON();
        const sources: { previousRect?: DOMRectReadOnly }[] = Array.isArray(json.sources) ? json.sources : [];
        for (const source of sources) {
          if (source.previousRect instanceof DOMRectReadOnly) tops.push(source.previousRect.top + window.scrollY);
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

/** Every top `recordShiftedTops` has recorded so far. */
async function readShiftedTops(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__shiftedTops')?.value;
    return Array.isArray(recorded) ? recorded.map(Number) : [];
  });
}

/** A fresh context in one language, with JavaScript switched off, so only the server's markup is drawn. */
async function openWithoutScript(input: { browser: Browser; path: string; locale: 'en' | 'de' }): Promise<Page> {
  const context = await input.browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  await context.addCookies([{ name: LANGUAGE_COOKIE, value: input.locale, url: E2E_APP_URL }]);
  const page = await context.newPage();
  await page.goto(input.path);
  return page;
}

for (const statutory of PAGES) {
  test(`${statutory.path} in English: an English subtitle under the German heading, and nothing moves on load`, async ({
    page,
  }) => {
    // THE FONT FILES ARE REFUSED FOR THIS READING, so it measures what the
    // markup and the hydration do and nothing else. `/widerrufen` records one
    // shift of 0.00005 on main too, with or without this line and in German
    // as in English: a 20 px box inside the date field grows 11 px wide when
    // the web font arrives. The next test covers the swap for everything at
    // and above this line.
    await page.route(/\.woff2(?:\?|$)/u, (route) => route.abort());
    await installShiftObserver(page);
    await useLanguage(page, 'en');
    await page.goto(statutory.path);

    // The statutory wording stays: the German heading and the German button.
    await expect(heading(page, statutory.heading)).toBeVisible();
    await expect(page.getByRole('button', { name: statutory.submit, exact: true })).toBeVisible();

    // THE CLAIM: one line in English, right after the heading.
    await expect(subtitle(page), 'no English subtitle under the German heading').toHaveText(statutory.subtitle);
    await expect(page.locator('article h1 + [data-slot="content-subtitle"]')).toHaveCount(1);
    await expect(page.locator('article')).toHaveAttribute('lang', 'en');
    const boxes = await readBoxes(page);
    expect(boxes.subtitleTop, 'the subtitle starts above the bottom of the heading').toBeGreaterThanOrEqual(boxes.h1Bottom);
    expect(boxes.nextTop, 'the line after the subtitle starts above its bottom').toBeGreaterThanOrEqual(boxes.subtitleBottom);

    // THE FIRST PAINT: the whole load, hydration included, recorded no shift.
    await settleAnimations(page);
    await settleFrames(page);
    const entries = await readShiftEntries(page);
    const detail = entries.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`).join('\n');
    expect(shiftScoreAfter(entries, 0), `layout shift on load\n${detail}`).toBe(0);

    // CONTROL: the same reading sees a line pushed in above the subtitle.
    await subtitle(page).evaluate((node) => {
      const line = document.createElement('p');
      line.textContent = 'control line';
      line.style.height = '40px';
      node.before(line);
    });
    await expect
      .poll(async () => shiftScoreAfter(await readShiftEntries(page), entries.length), {
        message: 'CONTROL: an injected line must register a layout shift',
      })
      .toBeGreaterThan(0);
  });

  test(`${statutory.path} in English: the swap to the web fonts moves nothing at or above the subtitle`, async ({
    page,
  }) => {
    await recordShiftedTops(page);
    await useLanguage(page, 'en');
    await page.goto(statutory.path);
    await expect(subtitle(page)).toHaveText(statutory.subtitle);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await settleAnimations(page);
    await settleFrames(page);
    const { subtitleBottom } = await readBoxes(page);

    const tops = await readShiftedTops(page);
    expect(
      tops.filter((top) => top <= subtitleBottom),
      `a box at or above the subtitle moved on load, subtitle bottom ${subtitleBottom}, shifted tops ${tops.join(', ')}`,
    ).toEqual([]);

    // CONTROL: a line pushed in above the subtitle is a box at or above it that moved.
    await subtitle(page).evaluate((node) => {
      const line = document.createElement('p');
      line.textContent = 'control line';
      line.style.height = '40px';
      node.before(line);
    });
    await expect
      .poll(async () => (await readShiftedTops(page)).filter((top) => top <= subtitleBottom).length, {
        message: 'CONTROL: the moved subtitle must be read as a box at or above it',
      })
      .toBeGreaterThan(0);
  });

  test(`${statutory.path} draws the English subtitle with JavaScript off, and CONTROL: German draws none`, async ({
    browser,
  }) => {
    const english = await openWithoutScript({ browser, path: statutory.path, locale: 'en' });
    await expect(heading(english, statutory.heading)).toBeVisible();
    await expect(subtitle(english)).toHaveText(statutory.subtitle);
    await english.context().close();

    const german = await openWithoutScript({ browser, path: statutory.path, locale: 'de' });
    await expect(heading(german, statutory.heading)).toBeVisible();
    await expect(german.locator('article')).toHaveAttribute('lang', 'de');
    await expect(subtitle(german)).toHaveCount(0);
    await german.context().close();
  });

  test(`CONTROL: ${statutory.path} in German keeps its heading and button and draws no subtitle`, async ({ page }) => {
    await useLanguage(page, 'de');
    await page.goto(statutory.path);
    await expect(heading(page, statutory.heading)).toBeVisible();
    await expect(page.getByRole('button', { name: statutory.submit, exact: true })).toBeVisible();
    await expect(page.locator('article')).toHaveAttribute('lang', 'de');
    await expect(subtitle(page)).toHaveCount(0);
  });
}

test('the subtitle speaks the article language: a French reader of the English fallback file gets the English line', async ({
  page,
}) => {
  // The fixture folder has no French file, so the article is the English one.
  await useLanguage(page, 'fr');
  await page.goto('/widerrufen');
  await expect(page.locator('article')).toHaveAttribute('lang', 'en');
  await expect(subtitle(page)).toHaveText(EN.declarations.withdraw.subtitle);
});
