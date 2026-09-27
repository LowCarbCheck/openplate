/**
 * A page that overtakes a page still loading boots, in a spec that routes requests.
 *
 * THE REPORT (2026-09-27). The v6 worker's author saw pages stay on the boot screen with their
 * module requests cancelled, in a probe of `strip-photo-button.spec.ts`, and moved the worker's
 * shell save to once per tab after the app has started. This file is what a second look found.
 *
 * NOT EXPLAINED HERE: `trial-recap.spec.ts` once stayed on the boot screen in a gate run with the
 * host loaded. That file has blocked service workers since it was written, so no worker ran, and
 * the failure did not come back: 0 of 15 runs of its walk with the whole tier held to 40 % of one
 * CPU, 0 of 10 at 6 times CPU throttling, and 0 of 1080 overtaking navigations with the worker
 * blocked and a route active.
 *
 * WHAT WAS MEASURED (`/tmp` probes, the production build, headless Chromium of this tier):
 *
 * - The page's own module requests are cancelled by Chromium: DevTools reports `net::ERR_ABORTED`
 *   with `canceled` set, on the NEW document's loader, for requests its `modulepreload` links
 *   made. The service worker had answered each of them `200` from Cache Storage 6 ms after they
 *   reached it. No response header ever arrived at the page, and 15 to 20 ms later the request
 *   was cancelled. Each cancelled preload fires `error`, the inline module script fails with it,
 *   and the page never starts.
 * - It needs all three of these at once: a service worker that answers scripts from Cache
 *   Storage, a navigation that overtakes a page still loading the same scripts, and the browser
 *   caches switched off. Playwright switches them off in every page that has a `page.route`.
 *   Take any one away and it is gone: the worker blocked, 0 of 1080 overtaking navigations
 *   failed; the caches on, as a real browser has them, 0 of 630 (and 0 of 342 hard reloads); V8
 *   code caching off (`--v8-cache-options=none`), 0 of 540; the worker answering with a copy of
 *   the cached body, 0 of 540. With all three, about 5 in 100 failed. The worker's shell save
 *   (`SAVE_SHELL`, v6) made it more likely, because it puts every shell script in Cache Storage
 *   before a page asks for it; with the save off it was 1 in 540. It was never a race inside
 *   the worker: the save had finished 1.5 s before the failures, and turning off either of the
 *   two `cache.put` calls did not stop them.
 * - So this is a harness condition and not a defect a person meets: Chromium's code cache for
 *   Cache Storage responses, with DevTools' cache switch on. Playwright's own advice for a page
 *   that routes requests is to block service workers, and this tier now does that by default
 *   (`playwright.config.ts`). A spec that needs the worker says `serviceWorkers: 'allow'`.
 *
 * WHAT THIS PROVES, and the control that makes each claim able to fail:
 *
 * - Under the tier's defaults no service worker controls a page. THE CONTROL: the same reading in
 *   a context that allows workers finds one, so "none" is not a reader that never sees a worker.
 * - Eighteen navigations that each overtake a page still loading all boot, with a route active.
 *   RED before the fix: with the worker allowed by default this walk failed in 14 of 30 runs.
 *   After it, 0 of 30.
 * - One failed `modulepreload` stops the boot for good, so the boot screen is right to say the
 *   app could not load when a preload fails. The module import does not ask again: the failed
 *   file is requested once and the app never starts. THE CONTROL: the same page with nothing
 *   refused starts and keeps the line hidden.
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding } from './helpers';

/** What the boot screen's head script and `root.tsx` record on `<html>`. */
type BootState = 'started' | 'failed' | 'pending';

/** How long a page may take to start, or to say that it could not, on a loaded host. */
const BOOT_TIMEOUT_MS = 10_000;

/** How often the boot state is read while it settles. */
const BOOT_POLL_MS = 50;

/** How long a worker may take to register and activate, where one is allowed. */
const WORKER_TIMEOUT_MS = 15_000;

/** How long after the page has loaded a refused boot is watched for a late start. */
const LATE_START_WATCH_MS = 2_000;

/** The routes the walk moves between: each pair shares most of its start-up scripts. */
const OVERTAKING_PAIRS = [
  ['/diary', '/add/search'],
  ['/add/search', '/diary'],
  ['/dashboard', '/settings/ai'],
] as const;

/** How long each first page loads before the second navigation overtakes it, in ms. */
const OVERTAKING_GAPS_MS = [0, 10, 20, 40, 80, 160] as const;

/** A path nothing serves: routing it switches request interception on, as every routed spec does. */
const UNSERVED_PATH = '**/e2e-never-requested';

/** The attribute `markAppStarted` sets and the one the head script sets on a failed script. */
async function readBootState(page: Page): Promise<BootState> {
  return page.evaluate(() => {
    const root = document.documentElement;
    if (root.hasAttribute('data-app-started')) return 'started';
    if (root.hasAttribute('data-boot-failed')) return 'failed';
    return 'pending';
  });
}

/** Waits until the page has started or has said it could not, and returns which. */
async function settledBootState(page: Page): Promise<BootState> {
  let state: BootState = 'pending';
  await expect
    .poll(
      async () => {
        state = await readBootState(page);
        return state;
      },
      { timeout: BOOT_TIMEOUT_MS, intervals: [BOOT_POLL_MS], message: 'the page starts or says it could not' },
    )
    .not.toBe('pending');
  return state;
}

/** Whether a worker registration exists for this origin, read in the page. */
async function hasWorkerRegistration(page: Page): Promise<boolean> {
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistration()) !== undefined);
}

test('under the tier defaults no service worker controls a page, and the reader finds one where allowed', async ({
  page,
  browser,
}) => {
  await page.goto('/welcome');
  expect(await settledBootState(page)).toBe('started');
  // The app registers once `load` has fired; a registration that exists now would exist already.
  await page.waitForLoadState('load');
  await page.waitForTimeout(LATE_START_WATCH_MS);
  expect(await hasWorkerRegistration(page), 'no worker is registered under the tier defaults').toBe(false);
  expect(await page.evaluate(() => navigator.serviceWorker.controller), 'no worker controls the page').toBeNull();

  // THE CONTROL: the same reading in a context that allows workers.
  const allowing = await browser.newContext({ serviceWorkers: 'allow' });
  const allowed = await allowing.newPage();
  await allowed.goto('/welcome');
  await expect
    .poll(() => hasWorkerRegistration(allowed), {
      timeout: WORKER_TIMEOUT_MS,
      message: 'a context that allows workers registers one',
    })
    .toBe(true);
  await allowing.close();
});

test('eighteen navigations that overtake a page still loading all boot, with a route active', async ({ page }) => {
  test.setTimeout(90_000);
  const cancelled: string[] = [];
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.startsWith('/assets/')) {
      cancelled.push(`${new URL(request.url()).pathname} ${request.failure()?.errorText ?? ''}`);
    }
  });
  await page.route(UNSERVED_PATH, (route) => route.abort());
  await completeOnboarding(page);

  const outcomes: string[] = [];
  for (const gap of OVERTAKING_GAPS_MS) {
    for (const [first, second] of OVERTAKING_PAIRS) {
      await page.goto(first, { waitUntil: 'commit' });
      if (gap > 0) await page.waitForTimeout(gap);
      await page.goto(second, { waitUntil: 'commit' });
      outcomes.push(`${first} overtaken after ${gap} ms by ${second}: ${await settledBootState(page)}`);
    }
  }

  const failures = outcomes.filter((outcome) => !outcome.endsWith(': started'));
  expect(failures, `every overtaking page boots; failed asset requests: ${JSON.stringify(cancelled)}`).toEqual([]);
  expect(outcomes, 'the walk took every step').toHaveLength(OVERTAKING_GAPS_MS.length * OVERTAKING_PAIRS.length);
});

/** The last `modulepreload` a server-rendered page names: a module the page imports to start. */
async function lastModulePreload(page: Page, path: string): Promise<string> {
  const html = await (await page.request.get(path)).text();
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="(\/assets\/[^"]+)"/gu)].map((match) => match[1]);
  const last = preloads.at(-1);
  if (last === undefined) throw new Error(`${path} names no modulepreload`);
  return last;
}

/** A tracker route: its server HTML is the boot screen, and it names about 150 preloads. */
const BOOT_SCREEN_ROUTE = '/diary';

/**
 * Opens {@link BOOT_SCREEN_ROUTE} with the first request for one preloaded module refused (or,
 * for the control, nothing refused) and every later request let through.
 *
 * @returns a reader for how many times the page has asked for that module so far.
 */
async function openWithOnePreloadRefused(page: Page, { refuse }: { refuse: boolean }): Promise<() => number> {
  const module = await lastModulePreload(page, BOOT_SCREEN_ROUTE);
  let requests = 0;
  await page.route(`**${module}`, async (route) => {
    requests += 1;
    if (refuse && requests === 1) {
      await route.abort('aborted');
      return;
    }
    await route.continue();
  });
  await page.goto(BOOT_SCREEN_ROUTE);
  return () => requests;
}

test('one failed modulepreload stops the boot for good, so the boot screen line is right', async ({ page }) => {
  await openWithOnePreloadRefused(page, { refuse: true });
  await expect(page.locator('[data-boot-failed-line]'), 'the boot screen says the app could not load').toBeVisible();
  await page.waitForLoadState('load');
  await page.waitForTimeout(LATE_START_WATCH_MS);
  expect(await readBootState(page), 'the app never started').toBe('failed');
});

test('one failed modulepreload is never asked for again by the import', async ({ page }) => {
  const requestCount = await openWithOnePreloadRefused(page, { refuse: true });
  await page.waitForLoadState('load');
  await page.waitForTimeout(LATE_START_WATCH_MS);
  expect(requestCount(), 'the refused module was requested once, by its preload').toBe(1);
});

test('CONTROL: with nothing refused the same page starts and the line stays hidden', async ({ page }) => {
  const requestCount = await openWithOnePreloadRefused(page, { refuse: false });
  expect(await settledBootState(page)).toBe('started');
  // Started means the boot screen has handed over, so its line is gone with it.
  await expect(page.locator('[data-boot-failed-line]')).toHaveCount(0);
  expect(requestCount(), 'the module was fetched once, and the fetch was used').toBe(1);
});
