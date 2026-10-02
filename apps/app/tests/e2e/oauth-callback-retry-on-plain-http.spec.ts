/**
 * The OpenRouter callback's "Try again" says what is true on a plain-http page.
 *
 * THE REPORT, install rehearsal follow-up, 2026-09-27: `/oauth/openrouter/callback`
 * lands on an error card when a connect attempt went wrong, and its "Try
 * again" starts a new attempt with `beginConnect`. That is OAuth PKCE, which
 * hashes its verifier with `crypto.subtle.digest`, and a plain-http page off
 * this computer has no `crypto.subtle`. The press failed, and the card around
 * it still asked the person to try again. The connect buttons in settings and
 * on the scan card already give way to the HTTPS notice
 * (`openrouter-connect-on-plain-http.spec.ts`); the callback's retry did not.
 *
 * A callback with a `code` and no attempt started on this device is the
 * "lost track of that connection" card. Every error card draws the same retry,
 * so this one stands for all five.
 *
 * The insecure origin is made the way `accounts-need-https.spec.ts` makes it,
 * and each test reads `isSecureContext` back first. The control is the same
 * page on the loopback origin, through the same queries.
 *
 * @area settings
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { E2E_APP_PORT } from './env';

/** A name only this browser can resolve, onto the tier's own server. */
const INSECURE_HOST = 'openplate-lan.test';

/** The tier's server as a LAN visitor reaches a home server: plain http, not loopback. */
const INSECURE_ORIGIN = `http://${INSECURE_HOST}:${E2E_APP_PORT}`;

/** A callback for an attempt this device never started. */
const LOST_CALLBACK = '/oauth/openrouter/callback?code=e2e-code&state=e2e-state';

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] },
  serviceWorkers: 'block',
});

const COPY = z
  .object({
    oauth: z.object({
      callback: z.object({
        tryAgain: z.string(),
        manualInstead: z.string(),
        error: z.object({ missingVerifier: z.object({ title: z.string() }) }),
      }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The notice that stands in for the retry, found by its slot. */
function retryNotice(page: Page) {
  return page.locator('[data-slot="oauth-needs-https"]');
}

/** The retry button itself. */
function retryButton(page: Page) {
  return page.getByRole('button', { name: COPY.oauth.callback.tryAgain, exact: true });
}

/** Opens the lost callback and waits for its error card. */
async function openLostCallback(page: Page): Promise<void> {
  await page.goto(LOST_CALLBACK);
  await expect(page.getByText(COPY.oauth.callback.error.missingVerifier.title, { exact: true })).toBeVisible();
}

test.describe('on a plain-http origin', () => {
  test.use({ baseURL: INSECURE_ORIGIN });

  test('the notice stands where "Try again" was, and pasting a key is still offered', async ({ page }) => {
    await openLostCallback(page);
    expect(await page.evaluate(() => window.isSecureContext), 'the mapped origin is not insecure').toBe(false);

    await expect(retryNotice(page).locator('a[href*="self-hosting"][href$="#https"]')).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: COPY.oauth.callback.manualInstead, exact: true })).toBeVisible();
  });
});

test.describe('control: on the loopback origin', () => {
  test('the error card offers "Try again" and no notice', async ({ page }) => {
    await openLostCallback(page);
    expect(await page.evaluate(() => window.isSecureContext), 'loopback stopped being a secure context').toBe(true);

    await expect(retryButton(page)).toBeVisible();
    await expect(retryNotice(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: COPY.oauth.callback.manualInstead, exact: true })).toBeVisible();
  });
});
