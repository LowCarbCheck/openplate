/**
 * An event queued before the Matomo script has loaded still reports the SCRUBBED page address (2026-10-05).
 *
 * THE REPORT, from production Matomo data (site 18): on 2026-09-02 an `install-prompt-shown` event on
 * `/verify-email?token=<token>` stored a one-time sign-in token. Three other first-load events stored
 * `?checkout=success` and `?range=14&tab=nutrition&slot=dinner`. `_paq` is a queue the tracker replays in order,
 * and a request reports the custom URL an EARLIER entry set, else the real `location.href`. The hook pushed
 * `setCustomUrl` only after the script had loaded, so every event queued before that was replayed with the real
 * address, query and all.
 *
 * WHAT IS REAL: the production build with analytics configured (`playwright.config.ts` passes `MATOMO_URL`), the
 * tracker hook, the install-prompt capture that fires `PWA / install-prompt-shown`. STUBBED: `matomo.js`, by
 * `matomo-stub.ts`, which replays the queue in order and reports the `url` and `urlref` the way the real tracker
 * does. The script is HELD until the event is queued, so the event provably comes first, as it does for a slow
 * script on a phone.
 *
 * THE CONTROL is this file against the sources before the fix: the held event then reports
 * `/verify-email?token=secret123` and every assertion below names it.
 *
 * @area shell
 */
import { expect, test, type Page } from '@playwright/test';

import { recordMatomo, type TrackedEvent } from './matomo-stub';

/** Waits until the tracker hook has queued its setup, which is also when the root effect has armed the install capture. */
async function waitForHookSetup(page: Page): Promise<void> {
  await page.waitForFunction(() => window._paq?.some((entry) => entry[0] === 'setSiteId') === true);
}

/** Fires the browser's install offer, the way Chromium does, which queues `PWA / install-prompt-shown`. */
async function fireInstallPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    });
    window.dispatchEvent(event);
  });
  await page.waitForFunction(() => window._paq?.some((entry) => entry[0] === 'trackEvent') === true);
}

/** A promise and the call that settles it. */
interface Gate {
  opened: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let settle: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { opened, open: () => settle?.() };
}

/**
 * Opens `path` with the tracker script held, queues one event, then lets the script load and replay the queue.
 *
 * @returns every request Matomo received, and the page's own address without query or fragment.
 */
async function loadWithEventQueuedFirst(
  page: Page,
  path: string,
): Promise<{ events: TrackedEvent[]; scrubbed: string }> {
  const gate = createGate();
  const events = await recordMatomo(page, { holdScript: gate.opened });
  // A held script delays `load`, so wait for the document only.
  await page.goto(path, { waitUntil: 'commit' });
  await waitForHookSetup(page);
  await fireInstallPrompt(page);

  const current = new URL(page.url());
  gate.open();
  // The replayed event, then the pageview the hook sends once the script is up.
  await expect.poll(() => events.some((event) => event.category === 'pageview')).toBe(true);
  return { events, scrubbed: `${current.origin}${current.pathname}` };
}

test('a sign-in token on the address never reaches Matomo, not even on the event that came first', async ({ page }) => {
  const { events, scrubbed } = await loadWithEventQueuedFirst(page, '/verify-email?token=secret123');

  const installPrompt = events.find((event) => event.category === 'PWA' && event.action === 'install-prompt-shown');
  expect(installPrompt, 'the queued event was replayed and sent').toBeDefined();
  expect(events.length, 'the event and the pageview both left').toBeGreaterThanOrEqual(2);

  for (const event of events) {
    expect(event.request, `a ${event.category}/${event.action} request carried the token`).not.toContain('secret123');
    expect(event.url, `a ${event.category}/${event.action} request reported the wrong address`).toBe(scrubbed);
  }
  expect(scrubbed.endsWith('/verify-email')).toBe(true);
});

for (const path of ['/sign-in?checkout=success', '/privacy?range=14&tab=nutrition&slot=dinner#chart']) {
  test(`the first event on ${path} reports the address without its query or fragment`, async ({ page }) => {
    const { events, scrubbed } = await loadWithEventQueuedFirst(page, path);

    const installPrompt = events.find((event) => event.category === 'PWA' && event.action === 'install-prompt-shown');
    expect(installPrompt, 'the queued event was replayed and sent').toBeDefined();
    expect(installPrompt?.url).toBe(scrubbed);
    for (const event of events) {
      expect(event.url, 'a request reported a query or fragment').not.toMatch(/[?#]/);
    }
  });
}
