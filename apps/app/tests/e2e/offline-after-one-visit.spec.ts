/**
 * A device that visited once, then lost the server, never sits on an endless boot screen.
 *
 * THE REPORT (pre-release install rehearsal, 2026-09-27). A device that had opened the app once
 * and then could not reach it showed the wordmark and a broken logo picture forever, with no
 * message. The service worker had saved the HTML of its shell pages at install time, but never
 * the scripts, the stylesheet or the logo those pages load: the first visit fetched them before
 * the worker controlled the page, and the install fetched only the HTML. So offline the worker
 * answered with a saved page whose every script was a 503.
 *
 * WHAT THIS PROVES, and the control that makes each claim able to fail:
 *
 * - After one visit, the app opens offline: the boot screen hands over to the app, which on a
 *   device that never finished onboarding is the welcome screen and its Start link. No picture on
 *   the page is broken. RED before the fix: the Start link never appeared and the logo read
 *   `naturalWidth` 0.
 * - A saved page whose files are gone is never served. The worker sends the navigation to its
 *   offline page instead, which reads without its scripts. Made certain here by deleting the
 *   worker's script and picture caches before going offline. RED before the fix: the saved
 *   `/diary` page came back as a boot screen with a broken logo and no words on it.
 * - With no worker at all and the scripts refused, the boot screen itself says the app could not
 *   load, in the catalog's words, and nothing on it moves when the line appears. THE CONTROLS:
 *   with scripts off the same line is hidden, so "visible" is not a reader that sees the line on
 *   every page; and a page where the hidden line takes no room reads as moved, so "nothing moved"
 *   is not a reader that never sees a move.
 *
 * @area offline-and-updates
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { EN } from './copy';
import { installShiftObserver, readShiftEntries } from './layout-shift';

/** A tracker route: its server HTML is the boot screen, and the worker precaches it. */
const TRACKER_ROUTE = '/diary';

/** Where a first visit lands; the `_personal` gate sends a device with no profile on to `/welcome`. */
const FIRST_VISIT_ROUTE = '/dashboard';

/** The boot screen's line for scripts that never arrived. */
const BOOT_FAILED_LINE = '[data-boot-failed-line]';

/** How long the worker may take to install, precache and activate on a loaded host. */
const WORKER_READY_TIMEOUT_MS = 20_000;

/** Waits until this origin's service worker is active, which is after its install precache finished. */
async function waitForTheWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state ?? 'none';
        }),
      { timeout: WORKER_READY_TIMEOUT_MS, message: 'the service worker activates after the first visit' },
    )
    .toBe('activated');
}

/** How often the shell reading below is taken while it waits. */
const SHELL_POLL_INTERVAL_MS = 250;

/**
 * Waits until the worker has saved these shell pages whole: each one in its page cache, and every
 * `/assets/` or `/icons/` address its HTML quotes in its static cache. The worker does this after
 * the app has started (`SAVE_SHELL`), so going offline before it is done would test a race.
 *
 * A WAIT, NEVER AN ASSERTION. It gives up quietly at {@link WORKER_READY_TIMEOUT_MS} and returns
 * what it last read, so on a worker that never saves the files (every build before this fix)
 * the walk still goes offline and the assertions on the page say what a person would see. The
 * same reading `public/sw-page-assets.js` makes, done here in the page, so the wait asks the
 * cache itself and not the worker's word for it.
 *
 * @returns `whole`, or the first thing that was still missing.
 */
async function waitForAWholeShell(page: Page, paths: readonly string[]): Promise<string> {
  const deadline = Date.now() + WORKER_READY_TIMEOUT_MS;
  const maxReadings = Math.ceil(WORKER_READY_TIMEOUT_MS / SHELL_POLL_INTERVAL_MS);
  let reading = 'not read';
  for (let attempt = 1; attempt <= maxReadings && Date.now() < deadline; attempt += 1) {
    reading = await readShell(page, paths);
    if (reading === 'whole') return reading;
    await page.waitForTimeout(SHELL_POLL_INTERVAL_MS);
  }
  return reading;
}

/** One reading of the shell caches: `whole`, or the first thing still missing. */
async function readShell(page: Page, paths: readonly string[]): Promise<string> {
  return page.evaluate(async (shellPaths) => {
    const names = await caches.keys();
    const pagesName = names.find((name) => name.startsWith('pages-'));
    const staticName = names.find((name) => name.startsWith('static-'));
    if (pagesName === undefined || staticName === undefined) return 'no caches yet';
    const stored = new Set((await (await caches.open(staticName)).keys()).map((request) => request.url));
    for (const path of shellPaths) {
      const saved = await (await caches.open(pagesName)).match(path);
      if (saved === undefined) return `${path} not saved`;
      const html = await saved.text();
      for (const match of html.matchAll(/["'](\/(?:assets|icons)\/[^"'\s#<>\\]+)["']/g)) {
        if (!stored.has(new URL(match[1], location.origin).toString())) return `${path} misses ${match[1]}`;
      }
    }
    return 'whole';
  }, paths);
}

/**
 * The first visit: the page boots online, and the worker installs behind it.
 *
 * THEN THE BROWSER'S HTTP CACHE IS EMPTIED, and that is what makes this a phone and not a test
 * runner. The hashed scripts are served `immutable`, so a desktop browser that just fetched them
 * still holds them in its HTTP cache, and a worker `fetch` offline is answered from there. That
 * cache is the browser's to drop, a phone drops it early, and the device in the report had.
 * Only the worker's own Cache Storage is an offline promise, so the walk leaves nothing else.
 */
async function visitOnce(page: Page): Promise<void> {
  await page.goto(FIRST_VISIT_ROUTE);
  await expect(page.getByRole('link', { name: EN.welcome.start, exact: true })).toBeVisible();
  await waitForTheWorker(page);
  const shell = await waitForAWholeShell(page, [FIRST_VISIT_ROUTE, '/welcome', TRACKER_ROUTE]);
  test.info().annotations.push({ type: 'offline shell before going offline', description: shell });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.detach();
}

/** Every `img` on the page that finished loading with no picture in it. */
async function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src),
  );
}

/** Every `img` on the page that has not finished loading yet. */
async function pendingImages(page: Page): Promise<number> {
  return page.evaluate(() => [...document.images].filter((image) => !image.complete).length);
}

/** Asserts that every picture on the page loaded, after giving the pending ones their chance. */
async function expectNoBrokenImage(page: Page): Promise<void> {
  await expect.poll(() => pendingImages(page), 'every picture has settled').toBe(0);
  expect(await brokenImages(page), 'no picture on the page is broken').toEqual([]);
}

test.describe('offline after one visit', () => {
  // The worker IS the subject here, so this block opts in: the tier blocks workers by default
  // (`playwright.config.ts`). No request in it is routed, so the browser caches stay on.
  test.use({ serviceWorkers: 'allow' });

  test('the app opens offline, not an endless boot screen, and no picture is broken', async ({ page, context }) => {
    await visitOnce(page);

    await context.setOffline(true);
    await page.goto(FIRST_VISIT_ROUTE);

    // The boot screen's logo first: it is drawn before any script runs, so it is the one picture
    // a page that never starts still shows.
    await expectNoBrokenImage(page);
    await expect(page.getByRole('link', { name: EN.welcome.start, exact: true }), 'the app booted offline').toBeVisible();
    await expectNoBrokenImage(page);
  });

  test('a saved page whose scripts are gone is not served; the offline page is', async ({ page, context }) => {
    await visitOnce(page);
    // A SAVED PAGE THAT OUTLIVED ITS FILES, made on purpose: the worker's script and picture
    // caches go, its page cache stays.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('static-') || name.startsWith('images-')) await caches.delete(name);
      }
    });

    await context.setOffline(true);
    await page.goto(TRACKER_ROUTE);

    // Pictures first: a boot screen served without its files draws its logo broken.
    await expectNoBrokenImage(page);
    await expect(page.getByRole('heading', { name: EN.offline.heading }), 'the offline page answered').toBeVisible();
    await expect(page.locator('output[aria-label]'), 'no boot screen was served').toHaveCount(0);
  });
});

/** A phone context of the tier's shape, with the worker blocked so the network answers every request. */
async function newPhoneContext(browser: Browser, { javaScriptEnabled }: { javaScriptEnabled: boolean }): Promise<BrowserContext> {
  return browser.newContext({
    javaScriptEnabled,
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
}

/** The tops of the boot screen's icon and word, rounded to the pixel. */
async function bootScreenTops(page: Page): Promise<{ icon: number; word: number }> {
  return page.locator('output[aria-label]').evaluate((screen) => {
    const icon = screen.querySelector('img');
    const word = screen.querySelector(':scope > span');
    return {
      icon: Math.round(icon?.getBoundingClientRect().top ?? -1),
      word: Math.round(word?.getBoundingClientRect().top ?? -1),
    };
  });
}

test.describe('the boot screen when its scripts cannot load', () => {
  test('says the app could not load, and moves nothing to say it', async ({ browser }) => {
    // THE CONTROL PAGE: scripts off, so nothing ever fails and nothing ever boots.
    const quietContext = await newPhoneContext(browser, { javaScriptEnabled: false });
    const quiet = await quietContext.newPage();
    await quiet.goto(TRACKER_ROUTE);
    await expect(quiet.locator('output[aria-label]')).toBeVisible();
    await expect(quiet.locator(BOOT_FAILED_LINE), 'the line is hidden while nothing has failed').toBeHidden();
    await expect(quiet.locator(BOOT_FAILED_LINE)).toHaveText(EN.chrome.bootFailed);
    const quietTops = await bootScreenTops(quiet);

    // THE PAGE UNDER TEST: scripts on, every script refused.
    const failingContext = await newPhoneContext(browser, { javaScriptEnabled: true });
    const failing = await failingContext.newPage();
    await installShiftObserver(failing);
    await failing.route('**/assets/**/*.js', (route) => route.abort('internetdisconnected'));
    await failing.goto(TRACKER_ROUTE);

    await expect(failing.locator(BOOT_FAILED_LINE), 'the boot screen says the app could not load').toBeVisible();
    await expect(failing.locator(BOOT_FAILED_LINE)).toHaveText(EN.chrome.bootFailed);
    await expectNoBrokenImage(failing);

    // NOTHING MOVED: the line had its box from the first paint.
    expect(await bootScreenTops(failing), 'the icon and the word sit where they sit with no line').toEqual(quietTops);
    const shifts = await readShiftEntries(failing);
    expect(shifts.reduce((total, entry) => total + entry.value, 0), JSON.stringify(shifts)).toBe(0);

    // THE GEOMETRY CONTROL: the same quiet page with the hidden line taking no room must read as moved.
    await quiet.evaluate((selector) => {
      const style = document.createElement('style');
      style.textContent = `${selector} { display: none !important; }`;
      document.head.append(style);
    }, BOOT_FAILED_LINE);
    expect(await bootScreenTops(quiet), 'a line with no box moves the screen').not.toEqual(quietTops);

    await quietContext.close();
    await failingContext.close();
  });
});
