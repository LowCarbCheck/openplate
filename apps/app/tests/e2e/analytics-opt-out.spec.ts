/**
 * Matomo honours the browser's "do not track" signals and a person's own opt-out (2026-09-28).
 *
 * THE REPORT, the pre-launch privacy audit: the hosted privacy notice says this instance's Matomo
 * honours Do Not Track. A live browser with `navigator.doNotTrack = "1"` and a `DNT: 1` header
 * still loaded `matomo.js` and sent the pageview, twice. And the notice rests visit counting on
 * legitimate interest, which gives a person the right to object, with no way anywhere to do it.
 *
 * WHAT IS REAL: the production build with analytics configured (`playwright.config.ts` passes
 * `MATOMO_URL`), the tracker hook, the Preferences page. STUBBED: `matomo.js`, by
 * `matomo-stub.ts`, so what is counted is a request that left the page.
 *
 * Every "nothing is sent" check has a control in the same file that sends: the first test.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_MATOMO_URL } from './env';
import { installShiftObserver, readShiftEntries, settleFrames, shiftScoreAfter } from './layout-shift';
import { recordMatomo } from './matomo-stub';
import { EN } from './copy';

/** Every request the page made to the Matomo origin, script and beacon alike. */
function watchMatomoRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(E2E_MATOMO_URL)) seen.push(request.url());
  });
  return seen;
}

/** Lets the tracker's async script and first beacon happen, if they are going to. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

test('control: with no signal and no opt-out, the tracker loads and counts the visit', async ({ page }) => {
  const events = await recordMatomo(page);
  const requests = watchMatomoRequests(page);
  await page.goto('/sign-in');
  await expect.poll(() => events.filter((event) => event.category === 'pageview').length).toBeGreaterThan(0);
  expect(requests.some((url) => url.endsWith('matomo.js')), 'the script was requested').toBe(true);
});

test('a browser that sends Do Not Track loads no tracker and sends nothing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1', configurable: true });
  });
  await recordMatomo(page);
  const requests = watchMatomoRequests(page);
  await page.goto('/sign-in');
  await settle(page);
  await page.goto('/privacy');
  await settle(page);
  expect(requests, 'a request reached Matomo under Do Not Track').toEqual([]);
});

test('a browser that sends Global Privacy Control loads no tracker and sends nothing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
  });
  await recordMatomo(page);
  const requests = watchMatomoRequests(page);
  await page.goto('/sign-in');
  await settle(page);
  expect(requests, 'a request reached Matomo under Global Privacy Control').toEqual([]);
});

test('switching visit counting off in Preferences stops it at once and on the next visit', async ({ page }) => {
  const events = await recordMatomo(page);
  const requests = watchMatomoRequests(page);
  await page.goto('/settings/preferences');

  const toggle = page.getByRole('switch', { name: EN.preferences.analytics.label });
  await expect(toggle).toBeChecked();
  await expect.poll(() => events.length).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  const countedBefore = events.length;

  // AT ONCE: a navigation inside the app sends no new pageview.
  await page.getByRole('link', { name: EN.chrome.back }).first().click();
  await settle(page);
  expect(events.length, 'a pageview went out after the switch was turned off').toBe(countedBefore);

  // ON THE NEXT VISIT: a fresh load requests no tracker at all.
  const requestsBefore = requests.length;
  await page.goto('/sign-in');
  await settle(page);
  expect(requests.slice(requestsBefore), 'a fresh load reached Matomo after the opt-out').toEqual([]);

  // And the switch says so when the person comes back.
  await page.goto('/settings/preferences');
  await expect(page.getByRole('switch', { name: EN.preferences.analytics.label })).not.toBeChecked();
});

test('under Do Not Track the switch is off, cannot be turned on, and saying why moves nothing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1', configurable: true });
  });
  await installShiftObserver(page);
  await recordMatomo(page);
  await page.goto('/settings/preferences');

  const toggle = page.getByRole('switch', { name: EN.preferences.analytics.label });
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();
  await expect(page.getByText(EN.preferences.analytics.browserSignal)).toBeVisible();
  await settleFrames(page);
  expect(shiftScoreAfter(await readShiftEntries(page), 0), 'showing the reason moved the page').toBe(0);
});
