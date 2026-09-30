/**
 * Moved mode (`MOVED_TO_URL`) in a real browser: a closed instance tells its people where they
 * went, and a phone that installed the app learns it too.
 *
 * THE REPORT (2026-09-30). beta.openplate.de closes today and its people move to
 * app.openplate.de. Many added beta to a phone's home screen, and that installed app runs the
 * service worker `public/sw.js`, which keeps the app's pages in Cache Storage. A redirect of the
 * host would never reach it: a browser does not follow a redirect when it checks `/sw.js` for an
 * update (openplate.de met exactly that after M194). So the closed server keeps running in moved
 * mode, and these checks drive it the way a phone would meet it.
 *
 * WHAT THIS PROVES, and the control that makes each claim able to fail:
 *
 * (a) Any page path, the old app routes and the manifest's `start_url` among them, answers the
 *     moved page in the reader's language (cookie, then the browser's language, then the default),
 *     with its one button on the sign-in page at the new address and no app script on it. THE
 *     CONTROL is (c): the same path on the tier's own server, which has no `MOVED_TO_URL`, is the
 *     app. The browser-language check has its own control, a language the app does not ship,
 *     which falls back to English.
 * (b) A browser that installed the NORMAL app worker, and then meets the moved server on the SAME
 *     origin, ends on the moved page with no caches and no worker left, both when it opens the app
 *     again and when an app still open checks its worker as it does every minute. THE CONTROL
 *     restarts the normal server instead and runs the same update check: the worker and its caches
 *     stay, so neither a restart nor an update check is what clears them.
 * (c) Without `MOVED_TO_URL` the app is unchanged: its own worker at `/sw.js`, its API, its pages.
 *     This is (a)'s control, and (a)'s worker check is this one's.
 * (d) The page fits a 360 px phone in all six languages, light and dark, and nothing on it moves.
 *     THE CONTROL puts a 600 px element and a late 40 px block on the same page, and the readers
 *     see both.
 * (e) An app already open, with no worker at all, leaves for the moved page on its next screen
 *     change, because route data answers React Router's "load this page whole" signal. THE CONTROL
 *     answers that route data with a 410 instead, and the old app stays on screen.
 *
 * ── Two servers on one origin ────────────────────────────────────────────
 *
 * A service worker belongs to an origin, scheme, host and port. So (b) and (e) start the normal
 * build on a kernel-picked port, stop it, and start the moved build on the SAME port: the same
 * container redeployed with one more variable, which is what production will do. Node listens
 * with address reuse on Linux, so the second bind does not wait out the first one's sockets.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { z } from 'zod';

import { LANGUAGE_COOKIE, SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { EN, catalogFor, fill } from './copy';
import { E2E_APP_URL } from './env';
import { NARROW_PHONE_WIDTH } from './helpers';
import { installShiftObserver, readShiftEntries, settleFrames } from './layout-shift';
import { pickFreePort, startAppServer, type ManagedAppServer } from './managed-app-server';

/** Where the closed instance's people went. A reserved name (RFC 2606): nothing ever answers it. */
const MOVED_TO_URL = 'https://app.openplate.example';

/** The host the page prints. */
const MOVED_HOST = 'app.openplate.example';

/** Where the page's one button goes. */
const SIGN_IN_URL = 'https://app.openplate.example/sign-in';

/** The one variable that closes an instance. */
const MOVED_ENV = { MOVED_TO_URL };

/** A server boot inside a hook, the budget `managed-app-server.ts` gives one boot. */
const BOOT_BUDGET_MS = 60_000;

/** Two production boots, a worker install and a worker swap, in one test. */
const SWAP_TEST_TIMEOUT_MS = 150_000;

/** How long a worker may take to install and save its shell, or to be replaced, on a loaded host. */
const WORKER_TIMEOUT_MS = 30_000;

/** The shipped web app manifest, which moved mode must serve unchanged. */
const MANIFEST_TEXT = readFileSync(fileURLToPath(new URL('../../public/site.webmanifest', import.meta.url)), 'utf8');

/** The address an installed app opens: the manifest's own `start_url`, never a copy of it. */
const START_URL = z.object({ start_url: z.string() }).parse(JSON.parse(MANIFEST_TEXT)).start_url;

/** Old addresses the moved page must answer, one per language below: the app's routes and a stranger. */
const OLD_PATHS = [START_URL, '/', '/settings/account', '/add/photo?shared=1', '/welcome', '/no/such/page'] as const;

/** The moved page's heading in `language`. */
function movedHeading(page: Page, language: LanguageCode) {
  return page.getByRole('heading', { level: 1, name: catalogFor(language).moved.title, exact: true });
}

/** Puts `language` in the cookie the app reads, for the next document load from `url`. */
async function useLanguageAt(options: { context: BrowserContext; url: string; language: LanguageCode }): Promise<void> {
  await options.context.addCookies([{ name: LANGUAGE_COOKIE, value: options.language, url: options.url }]);
}

/** How many service worker registrations this origin holds. */
async function registrationCount(page: Page): Promise<number> {
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
}

/** Every Cache Storage name this origin holds. */
async function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => caches.keys());
}

/** Whether the worker's caches hold the page an installed app opens. */
async function holdsTheStartPage(page: Page): Promise<boolean> {
  return page.evaluate(async (startUrl) => (await caches.match(startUrl)) !== undefined, START_URL);
}

/** Whether a worker controls the page. */
async function isControlled(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.serviceWorker.controller !== null);
}

/**
 * The first visit of a device, on the normal server: the app boots, its worker installs, takes the
 * page, and saves the page an installed app opens. Afterwards the device is an installed app.
 */
async function installTheAppWorker(page: Page, url: string): Promise<void> {
  await page.goto(`${url}/dashboard`);
  await expect(page.getByRole('link', { name: EN.welcome.start, exact: true }), 'the app booted').toBeVisible();
  await expect.poll(() => isControlled(page), { timeout: WORKER_TIMEOUT_MS, message: 'the app worker took the page' }).toBe(true);
  await expect
    .poll(() => holdsTheStartPage(page), { timeout: WORKER_TIMEOUT_MS, message: `the worker saved ${START_URL}` })
    .toBe(true);
  expect(await registrationCount(page), 'one worker is installed').toBe(1);
}

/** Starts an app check for a new worker from inside the page, the call the app makes every minute, and returns at once. */
async function askForANewWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    })();
  });
}

/** The page's width against the phone's: the document's scroll width, its client width, and the right edge of its widest box. */
async function widthReading(page: Page): Promise<{ scrollWidth: number; clientWidth: number; widestRight: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    widestRight: Math.ceil(Math.max(0, ...[...document.body.querySelectorAll('*')].map((node) => node.getBoundingClientRect().right))),
  }));
}

/** The summed score of every layout shift the page recorded. */
async function shiftTotal(page: Page): Promise<number> {
  return (await readShiftEntries(page)).reduce((sum, entry) => sum + entry.value, 0);
}

/** A page that has painted in its own font, with two frames after it. */
async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleFrames(page);
}

test.describe('a moved instance', () => {
  let server: ManagedAppServer;

  test.beforeAll(async () => {
    test.setTimeout(BOOT_BUDGET_MS);
    server = await startAppServer({ env: MOVED_ENV });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  for (const [index, language] of SUPPORTED_LANGUAGES.entries()) {
    const path = OLD_PATHS[index] ?? '/';
    test(`(a) ${path} answers the moved page in ${language}, linking the new address`, async ({ page, context }) => {
      await useLanguageAt({ context, url: server.url, language });
      const response = await page.goto(`${server.url}${path}`);
      expect(response?.status()).toBe(200);

      const copy = catalogFor(language).moved;
      await expect(movedHeading(page, language)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.getByText(fill(copy.body, { host: MOVED_HOST }), { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: fill(copy.signIn, { host: MOVED_HOST }), exact: true })).toHaveAttribute(
        'href',
        SIGN_IN_URL,
      );
      await expect(page.getByText(fill(copy.homeScreen, { host: MOVED_HOST }), { exact: true })).toBeVisible();
      await expect(page.getByText(copy.iphone, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.android, { exact: true })).toBeVisible();
      await expect(page.locator('script[src], script[type="module"], link[rel="modulepreload"]'), 'no app script').toHaveCount(0);
    });
  }

  test('(a) with no cookie the browser language decides, and a language the app lacks falls back to English', async ({
    browser,
  }) => {
    const german = await browser.newContext({ locale: 'de-DE' });
    const japanese = await browser.newContext({ locale: 'ja-JP' });
    try {
      const germanPage = await german.newPage();
      await germanPage.goto(`${server.url}/diary`);
      await expect(movedHeading(germanPage, 'de')).toBeVisible();

      const japanesePage = await japanese.newPage();
      await japanesePage.goto(`${server.url}/diary`);
      await expect(movedHeading(japanesePage, 'en'), 'control: the header was read, not ignored').toBeVisible();
    } finally {
      await german.close();
      await japanese.close();
    }
  });

  test('(a) the worker script, the API, route data, the health probe, files and the manifest', async ({ request }) => {
    const worker = await request.get(`${server.url}/sw.js`);
    expect(worker.status()).toBe(200);
    expect(worker.headers()['content-type']).toContain('javascript');
    expect(worker.headers()['cache-control']).toBe('no-cache');
    const workerSource = await worker.text();
    expect(workerSource).toContain('registration.unregister()');
    expect(workerSource, 'not the app worker').not.toContain('CACHE_VERSION');

    for (const call of [request.get(`${server.url}/api/update-status`), request.post(`${server.url}/api/food-matches`)]) {
      const gone = await call;
      expect(gone.status()).toBe(410);
      expect(await gone.json()).toEqual({ error: 'moved', movedTo: `${MOVED_TO_URL}/` });
    }

    const routeData = await request.get(`${server.url}${START_URL}.data`, { maxRedirects: 0 });
    expect(routeData.status()).toBe(204);
    expect(routeData.headers()['x-remix-redirect']).toBe(START_URL);
    expect(routeData.headers()['x-remix-reload-document']).toBe('true');

    const health = await request.get(`${server.url}/healthcheck`);
    expect(health.status()).toBe(200);
    expect(await health.text()).toBe('OK');

    const manifest = await request.get(`${server.url}/site.webmanifest`);
    expect(manifest.status()).toBe(200);
    expect(await manifest.text(), 'the manifest is served byte for byte').toBe(MANIFEST_TEXT);

    expect((await request.get(`${server.url}/icons/icon-192.png`)).status()).toBe(200);
    expect((await request.get(`${server.url}/assets/not-in-this-build.js`)).status()).toBe(404);

    const post = await request.post(`${server.url}/share-target`, { maxRedirects: 0 });
    expect(post.status()).toBe(303);
    expect(post.headers().location).toBe('/share-target');
  });
});

test.describe('(c) an instance without MOVED_TO_URL', () => {
  test('keeps its own worker, its API and its app pages', async ({ page, request }) => {
    const worker = await request.get(`${E2E_APP_URL}/sw.js`);
    expect(worker.status()).toBe(200);
    const workerSource = await worker.text();
    expect(workerSource, 'the app worker').toContain('CACHE_VERSION');
    expect(workerSource).not.toContain('registration.unregister()');

    const status = await request.get(`${E2E_APP_URL}/api/update-status`);
    expect(status.status()).toBe(200);

    await page.goto(`${E2E_APP_URL}${START_URL}`);
    await expect(page.locator('script[type="module"]').first(), 'the app loads its scripts').toBeAttached();
    await expect(movedHeading(page, 'en')).toHaveCount(0);
  });
});

test.describe('(d) the moved page on a 360 px phone', () => {
  let server: ManagedAppServer;

  test.beforeAll(async () => {
    test.setTimeout(BOOT_BUDGET_MS);
    server = await startAppServer({ env: MOVED_ENV });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  for (const language of SUPPORTED_LANGUAGES) {
    test(`fits and moves nothing in ${language}, light and dark`, async ({ page, context }) => {
      await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: 780 });
      await installShiftObserver(page);
      await useLanguageAt({ context, url: server.url, language });

      const backgrounds: string[] = [];
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await page.goto(`${server.url}${START_URL}`);
        await expect(movedHeading(page, language)).toBeVisible();
        await settleFonts(page);

        const width = await widthReading(page);
        expect(width.clientWidth, `${colorScheme}: the phone is ${NARROW_PHONE_WIDTH} px`).toBe(NARROW_PHONE_WIDTH);
        expect(width.scrollWidth, `${colorScheme}: nothing scrolls sideways`).toBe(width.clientWidth);
        expect(width.widestRight, `${colorScheme}: no box reaches past the edge`).toBeLessThanOrEqual(NARROW_PHONE_WIDTH);

        const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        expect(isDark, `${colorScheme}: the theme script chose the ${colorScheme} palette`).toBe(colorScheme === 'dark');
        expect(await shiftTotal(page), `${colorScheme}: the layout shift total`).toBe(0);
        backgrounds.push(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
      }
      expect(backgrounds[0], 'dark draws another background than light').not.toBe(backgrounds[1]);
    });
  }

  test('control: the readers see a box past the edge and a block that arrives late', async ({ page }) => {
    await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: 780 });
    await installShiftObserver(page);
    await page.goto(`${server.url}${START_URL}`);
    await expect(movedHeading(page, 'en')).toBeVisible();
    await settleFonts(page);
    expect(await shiftTotal(page)).toBe(0);

    await page.evaluate(() => {
      const late = document.createElement('div');
      late.style.height = '40px';
      document.querySelector('main')?.prepend(late);
      const wide = document.createElement('div');
      wide.style.width = '600px';
      wide.style.height = '1px';
      document.querySelector('main')?.append(wide);
    });
    await settleFrames(page);

    const width = await widthReading(page);
    expect(width.scrollWidth > width.clientWidth || width.widestRight > NARROW_PHONE_WIDTH, JSON.stringify(width)).toBe(true);
    await expect.poll(() => shiftTotal(page), { message: 'the late block is a recorded shift' }).toBeGreaterThan(0);
  });
});

test.describe('(b) an installed app meets the moved server on its own origin', () => {
  // The worker IS the subject here, so this block opts in: the tier blocks workers by default
  // (`playwright.config.ts`). No request in it is routed, so the browser caches stay on.
  test.use({ serviceWorkers: 'allow' });

  test('opening the app again ends on the moved page with no caches and no worker', async ({ page }) => {
    test.setTimeout(SWAP_TEST_TIMEOUT_MS);
    const port = await pickFreePort();
    let server = await startAppServer({ port });
    try {
      await installTheAppWorker(page, server.url);
      expect((await cacheNames(page)).length, 'the app worker holds caches').toBeGreaterThan(0);

      await server.stop();
      server = await startAppServer({ port, env: MOVED_ENV });

      // The installed icon opens the manifest's start_url, through the old worker.
      await page.goto(`${server.url}${START_URL}`);
      await expect(movedHeading(page, 'en')).toBeVisible();

      await expect.poll(() => registrationCount(page), { timeout: WORKER_TIMEOUT_MS, message: 'no worker is left' }).toBe(0);
      await expect.poll(() => cacheNames(page), { timeout: WORKER_TIMEOUT_MS, message: 'no cache is left' }).toEqual([]);
      await expect.poll(() => isControlled(page), { message: 'the page comes from the server, not a worker' }).toBe(false);
      await expect(movedHeading(page, 'en')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(START_URL);
    } finally {
      await server.stop();
    }
  });

  test('an app still open is taken to the moved page by its next worker check', async ({ page }) => {
    test.setTimeout(SWAP_TEST_TIMEOUT_MS);
    const port = await pickFreePort();
    let server = await startAppServer({ port });
    try {
      await installTheAppWorker(page, server.url);

      await server.stop();
      server = await startAppServer({ port, env: MOVED_ENV });
      await askForANewWorker(page);

      await expect(movedHeading(page, 'en'), 'the kill switch reloaded the open app').toBeVisible({ timeout: WORKER_TIMEOUT_MS });
      await expect.poll(() => registrationCount(page), { timeout: WORKER_TIMEOUT_MS, message: 'no worker is left' }).toBe(0);
      await expect.poll(() => cacheNames(page), { timeout: WORKER_TIMEOUT_MS, message: 'no cache is left' }).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test('control: the same worker check against the normal server keeps the worker and its caches', async ({ page }) => {
    test.setTimeout(SWAP_TEST_TIMEOUT_MS);
    const port = await pickFreePort();
    let server = await startAppServer({ port });
    try {
      await installTheAppWorker(page, server.url);

      await server.stop();
      server = await startAppServer({ port });
      await page.goto(`${server.url}${START_URL}`);
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });

      expect(await registrationCount(page), 'the app worker stays').toBe(1);
      expect(await holdsTheStartPage(page), 'its saved start page stays').toBe(true);
      await expect(movedHeading(page, 'en')).toHaveCount(0);
    } finally {
      await server.stop();
    }
  });
});

test.describe('(e) an open app with no worker changes screen after the move', () => {
  /** A mark on the old document, gone once a new document has loaded. */
  const MARK = '__openedBeforeTheMove';

  /** Whether the page still shows the document the mark was put on. */
  async function isTheOldDocument(page: Page): Promise<boolean> {
    return page.evaluate((mark) => Object.getOwnPropertyDescriptor(window, mark) !== undefined, MARK);
  }

  /** Boots the normal app on `port`, marks its document, and swaps in the moved server on the same port. */
  async function openTheAppThenMove(page: Page, port: number): Promise<ManagedAppServer> {
    const normal = await startAppServer({ port });
    try {
      await page.goto(`${normal.url}/dashboard`);
      await expect(page.getByRole('link', { name: EN.welcome.start, exact: true }), 'the app booted').toBeVisible();
      await page.evaluate((mark) => Object.defineProperty(window, mark, { value: true }), MARK);
    } finally {
      await normal.stop();
    }
    return startAppServer({ port, env: MOVED_ENV });
  }

  test('its next screen loads the moved page as a whole document', async ({ page }) => {
    test.setTimeout(SWAP_TEST_TIMEOUT_MS);
    const server = await openTheAppThenMove(page, await pickFreePort());
    try {
      // Start is a client-side link; the onboarding screen asks this server for its route data.
      await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();
      await expect(movedHeading(page, 'en')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/onboarding');
      expect(await isTheOldDocument(page), 'a new document loaded').toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('control: a 410 for the same route data leaves the old app on screen', async ({ page }) => {
    test.setTimeout(SWAP_TEST_TIMEOUT_MS);
    const server = await openTheAppThenMove(page, await pickFreePort());
    try {
      await page.route(
        (url) => url.pathname === '/onboarding.data',
        (route) => route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ error: 'moved' }) }),
      );
      await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();
      await page.waitForURL((url) => url.pathname === '/onboarding');
      await settleFrames(page);
      expect(await isTheOldDocument(page), 'the old app is still the document').toBe(true);
      await expect(movedHeading(page, 'en')).toHaveCount(0);
    } finally {
      await server.stop();
    }
  });
});
