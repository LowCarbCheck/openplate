/**
 * "Connect with OpenRouter" says what is true on a plain-http page, and the
 * paste-a-key path keeps working there.
 *
 * THE REPORT, install rehearsal follow-up, 2026-09-27: the OpenRouter connect
 * is an OAuth PKCE flow, and PKCE hashes its verifier with
 * `crypto.subtle.digest`. A plain-http page off this computer has no
 * `crypto.subtle`, so "Continue to OpenRouter" threw `Cannot read properties of
 * undefined (reading 'digest')`, stayed on the page, and said "Couldn't start
 * the connection. Check your connection and try again", which blames the
 * network for a thing the network did not do. Measured on the build before
 * the fix with a throwaway probe, on the origin this spec uses.
 *
 * PASTING A KEY NEEDS NO `crypto.subtle`: the key is checked with one `fetch`
 * to the provider and written to the device's own store. So the connect
 * button gives way to a notice, in place, and the paste path stays offered
 * and is walked here to the end.
 *
 * The insecure origin is made the way `accounts-need-https.spec.ts` makes it,
 * and each test reads `isSecureContext` back first. Every absence has a
 * control on the loopback origin through the same query.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { E2E_APP_PORT } from './env';
import { completeOnboarding } from './helpers';

/** A name only this browser can resolve, onto the tier's own server. */
const INSECURE_HOST = 'openplate-lan.test';

/** The tier's server as a LAN visitor reaches a home server: plain http, not loopback. */
const INSECURE_ORIGIN = `http://${INSECURE_HOST}:${E2E_APP_PORT}`;

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] },
  serviceWorkers: 'block',
});

const COPY = z
  .object({
    oauth: z.object({ connect: z.object({ button: z.string() }) }),
    scan: z.object({ setup: z.object({ connectOpenRouter: z.string() }) }),
    settingsAi: z.object({
      manualEntry: z.object({ orPasteKey: z.string() }),
      save: z.object({ settings: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** OpenRouter's key check, the one request a pasted key makes before it is saved. */
const OPENROUTER_KEY_CHECK = 'https://openrouter.ai/api/v1/auth/key';

/** The notice that replaces the connect button, found by its slot. */
function connectNotice(page: Page) {
  return page.locator('main [data-slot="oauth-needs-https"]');
}

/** The notice's link to the HTTPS section of the self-hosting guide. */
function guideLink(page: Page) {
  return connectNotice(page).locator('a[href*="self-hosting"][href$="#https"]');
}

test.describe('on a plain-http origin', () => {
  // The whole block on the insecure origin, so `completeOnboarding` and every
  // relative `goto` land there.
  test.use({ baseURL: INSECURE_ORIGIN });

  test('settings: the notice replaces the connect button, and a pasted key still saves', async ({ page }) => {
    await completeOnboarding(page);
    expect(await page.evaluate(() => window.isSecureContext), 'the mapped origin is not insecure').toBe(false);
    await page.route(OPENROUTER_KEY_CHECK, (route) =>
      route.fulfill({ status: 200, json: { data: { label: 'e2e', usage: 0, limit: null } } }),
    );

    await page.goto('/settings/ai');
    await expect(guideLink(page)).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.oauth.connect.button, exact: true })).toHaveCount(0);

    // THE PASTE PATH, to the end: its panel starts open on a first connect,
    // and a verified first connect returns to the diary.
    await expect(page.getByRole('button', { name: COPY.settingsAi.manualEntry.orPasteKey })).toBeVisible();
    await expect(page.locator('input[name="apiKey"]')).toBeVisible();
    await page.locator('input[name="apiKey"]').fill('sk-or-v1-e2e-not-a-real-key');
    await page.getByRole('button', { name: COPY.settingsAi.save.settings }).click();
    await page.waitForURL('**/diary');
  });

  test('the scan screen: the notice replaces the connect button, and the other doors stay', async ({ page }) => {
    await completeOnboarding(page);
    expect(await page.evaluate(() => window.isSecureContext), 'the mapped origin is not insecure').toBe(false);

    await page.goto('/add/photo');
    await expect(guideLink(page)).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.scan.setup.connectOpenRouter, exact: true })).toHaveCount(0);
    await expect(page.locator('main a[href^="/settings/ai"]')).toBeVisible();
  });
});

test.describe('control: on the loopback origin', () => {
  test('settings and the scan screen offer the connect button and no notice', async ({ page }) => {
    await completeOnboarding(page);
    expect(await page.evaluate(() => window.isSecureContext), 'loopback stopped being a secure context').toBe(true);

    await page.goto('/settings/ai');
    await expect(page.getByRole('button', { name: COPY.oauth.connect.button, exact: true })).toBeVisible();
    await expect(connectNotice(page)).toHaveCount(0);

    await page.goto('/add/photo');
    await expect(page.getByRole('button', { name: COPY.scan.setup.connectOpenRouter, exact: true })).toBeVisible();
    await expect(connectNotice(page)).toHaveCount(0);
  });
});
