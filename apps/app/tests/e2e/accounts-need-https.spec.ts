/**
 * Accounts need a secure context, and the account doors say so up front.
 *
 * THE REPORT, install rehearsal, 2026-09-27: a self-hosted app on a LAN
 * address with no domain (`http://192.168.122.86:3000`). A real account, the
 * right password, "Sign in", and the line under the password field read
 * `Cannot read properties of undefined (reading 'importKey')`. Off a secure
 * context the browser has no `crypto.subtle`, and every account ceremony
 * (sign in, create, reset) starts with it. The form invited an attempt that
 * could not work and then printed the browser's TypeError.
 *
 * HOW THE INSECURE ORIGIN IS MADE, AND WHY IT IS HONEST. The tier's server
 * listens on loopback, and a browser treats every loopback address as a
 * secure context. Chromium's `--host-resolver-rules` maps a made-up name onto
 * that same server, and a page opened under that name is an ordinary
 * plain-http origin to the browser: no `crypto.subtle`, no service worker, and
 * `isSecureContext` false. Nothing in the page is stubbed or deleted, so what
 * this spec meets is what a LAN visitor meets. The first assertion of each
 * test reads `isSecureContext` back, so a browser that stopped honouring the
 * mapping turns this spec red instead of quietly testing a secure page.
 *
 * EVERY ABSENCE HAS A CONTROL. The same doors on the tier's own loopback
 * origin show the form and no notice, through the same queries.
 *
 * @area accounts-and-sign-in
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_APP_PORT } from './env';
import { installShiftObserver, readShiftEntries, settleFrames } from './layout-shift';

/** A name only this browser can resolve, onto the tier's own server. */
const INSECURE_HOST = 'openplate-lan.test';

/** The tier's server, reached the way a LAN visitor reaches a home server: plain http, not loopback. */
const INSECURE_ORIGIN = `http://${INSECURE_HOST}:${E2E_APP_PORT}`;

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] },
  // No worker on either origin: the insecure one cannot register one anyway,
  // and on the loopback one a first-visit reload would race the reads below.
  serviceWorkers: 'block',
});

/** The sign-in password field as the server writes it, read without a browser. */
const PASSWORD_FIELD_MARKUP = 'autoComplete="current-password"';

/** Every page that runs, or leads straight into, an account ceremony. */
const ACCOUNT_DOORS = ['/sign-in', '/sign-up', '/forgot', '/reset', '/join'] as const;

/**
 * The notice's link to the HTTPS section of the self-hosting guide.
 *
 * Found by its ADDRESS, not by its words: the sentence is wordsmith-owned copy
 * and the address is the contract, a section anchor on the guide.
 */
function httpsGuideLink(page: Page) {
  return page.locator('main a[href*="self-hosting"][href$="#https"]');
}

/** The sign-in form's password field, found by its password-manager token. */
function passwordField(page: Page) {
  return page.locator('input[autocomplete="current-password"]');
}

test.describe('on a plain-http origin', () => {
  for (const door of ACCOUNT_DOORS) {
    test(`${door} says accounts need HTTPS and offers no form`, async ({ page }) => {
      await installShiftObserver(page);
      await page.goto(`${INSECURE_ORIGIN}${door}`);
      expect(await page.evaluate(() => window.isSecureContext), 'the mapped origin is not insecure').toBe(false);

      await expect(httpsGuideLink(page)).toBeVisible();
      await expect(passwordField(page)).toHaveCount(0);
      await expect(page.locator('main input[type="email"]')).toHaveCount(0);

      // THE SERVER DREW THE SAME ANSWER THE BROWSER DID, so the notice was on
      // the first paint and nothing was swapped in after hydration.
      await settleFrames(page);
      const shifts = await readShiftEntries(page);
      expect(shifts, `layout-shift on ${door}: ${JSON.stringify(shifts)}`).toEqual([]);
    });
  }

  test('the server draws the notice in its own HTML, and the form for a loopback address', async ({ request }) => {
    // Read without a browser, so no script can have swapped anything: this is
    // the first paint. The `Host` header is what the server decides from.
    const insecure = await request.get(`http://127.0.0.1:${E2E_APP_PORT}/sign-in`, {
      headers: { Host: `${INSECURE_HOST}:${E2E_APP_PORT}` },
    });
    const insecureHtml = await insecure.text();
    expect(insecureHtml).toContain('data-slot="accounts-need-https"');
    // React keeps the prop's own spelling in server markup, `autoComplete`.
    expect(insecureHtml).not.toContain(PASSWORD_FIELD_MARKUP);

    // THE CONTROL: the same page for the loopback address carries the form.
    const loopbackHtml = await (await request.get(`http://127.0.0.1:${E2E_APP_PORT}/sign-in`)).text();
    expect(loopbackHtml).not.toContain('data-slot="accounts-need-https"');
    expect(loopbackHtml).toContain(PASSWORD_FIELD_MARKUP);
  });

  test('the guide link opens the HTTPS section of the self-hosting guide', async ({ page }) => {
    await page.goto(`${INSECURE_ORIGIN}/sign-in`);
    const href = await httpsGuideLink(page).getAttribute('href');
    expect(href).not.toBeNull();
    const target = new URL(href ?? '');
    expect(target.protocol).toBe('https:');
    expect(target.hash).toBe('#https');
  });
});

test.describe('control: on the loopback origin', () => {
  test('/sign-in shows the form and no notice', async ({ page }) => {
    await page.goto('/sign-in');
    expect(await page.evaluate(() => window.isSecureContext), 'loopback stopped being a secure context').toBe(true);
    await expect(passwordField(page)).toBeVisible();
    await expect(httpsGuideLink(page)).toHaveCount(0);
  });

  for (const door of ACCOUNT_DOORS.filter((path) => path !== '/sign-in')) {
    test(`${door} shows no notice`, async ({ page }) => {
      await page.goto(door);
      // The card's title is on screen, so the page rendered and the absence
      // below is a real one.
      await expect(page.locator('main [data-slot="card-title"]').first()).toBeVisible();
      await expect(httpsGuideLink(page)).toHaveCount(0);
    });
  }
});
