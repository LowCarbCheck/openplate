/**
 * A scan the core refuses for want of the consent sends the person to the
 * consent screen, never to a key check (owner decision, 2026-09-29).
 *
 * THE REASON. openplate-core refuses `POST /v1/chat/completions` with `403
 * health-consent-required` to an account that does not hold the instance's
 * current consent version (`PROTOCOL.md` §5.19). Before this change the scan
 * screen read every unknown 403 as a refused API key, and told somebody on a
 * managed instance, who has no key, to check theirs.
 *
 * A MANAGED BUILD, because the AI proxy is only the scan's road there: an open
 * instance sends a photo to the person's own provider. `managed-app-server.ts`
 * boots it beside the tier's own server.
 *
 * THE PROMPT AND ITS TWIN differ in one stubbed fact, whether the account
 * holds the wording the operator changed to while the scan screen was open,
 * and the proxy's answer follows from it by the core's rule.
 *
 * @area health-consent
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { settleFrames } from './layout-shift';
import {
  PIXEL_PNG,
  routeConsentRequiredProxy,
  routeManagedCore,
  signInManaged,
  type ManagedCoreStub,
} from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** Onboarding, a sign-in and a scan outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/** How long the move to the consent screen may take after the refused scan. */
const MOVE_WAIT_MS = 20_000;

/** How long a screen that should stay open is watched after the scan answered. */
const OPEN_WATCH_MS = 1_500;

/** The wording the account agreed to. */
const VERSION = '2026-09-28';

/** The wording the operator changes to while the scan screen is open. */
const NEXT_VERSION = '2027-01-15';

/** An instant for a consent on record. */
const AGREED_AT = '2026-09-04T10:11:12.000Z';

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({
    healthConsent: z.object({ heading: z.string() }),
    scan: z.object({ errors: z.object({ titles: z.object({ auth: z.string() }) }) }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A member with free scans left, on an instance that asks the current wording, who agreed to it. */
function core(): ManagedCoreStub {
  return {
    trialScans: { granted: 10, left: 4 },
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    healthConsent: { version: VERSION },
    accountHealthConsent: { version: VERSION, at: AGREED_AT },
  };
}

/** The pathname the page is on; `/consent?next=/add/photo` must never read as the scan screen. */
function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/**
 * The scan screen, opened by a DOCUMENT LOAD while the account still holds the
 * consent, and its capture input. Everything after this is client side, so the
 * gate keeps the old wording and only the proxy's refusal can say otherwise.
 */
async function openScanScreen(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.goto(`${server.url}/add/photo`);
  // SCOPED TO THE CAPTURE CARD, as every other scan spec is: the tab bar's
  // photo button carries a capture input of its own.
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  const input = captureCard.locator('input[type="file"][capture]');
  await expect(input).toBeAttached();
  await settleFrames(page);
  return input;
}

test('a scan the core refuses for want of the consent sends the person to the consent screen', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core();
  await routeManagedCore(page, stub);
  const proxy = await routeConsentRequiredProxy(page, stub);
  await signInManaged(page, server.url);
  const input = await openScanScreen(page);

  // THE OPERATOR CHANGES THE WORDING while the scan screen is open.
  stub.healthConsent = { version: NEXT_VERSION };
  await input.setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect
    .poll(() => pathOf(page), { message: 'the refused scan did not open the consent screen', timeout: MOVE_WAIT_MS })
    .toBe('/consent');
  expect(new URL(page.url()).searchParams.get('next'), 'the consent screen must return to the scan').toBe('/add/photo');
  expect(proxy.refused, 'no scan was refused, so something else moved the page').toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: COPY.healthConsent.heading })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(COPY.scan.errors.titles.auth);
});

test('the twin: the same scan from an account that agreed to the new wording is answered and stays', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core();
  await routeManagedCore(page, stub);
  const proxy = await routeConsentRequiredProxy(page, stub);
  await signInManaged(page, server.url);
  const input = await openScanScreen(page);

  // The same new wording, agreed to on another device, so the proxy answers.
  stub.healthConsent = { version: NEXT_VERSION };
  stub.accountHealthConsent = { version: NEXT_VERSION, at: AGREED_AT };
  await input.setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect(page.getByText(EN.scan.review.heading)).toBeVisible({ timeout: MOVE_WAIT_MS });
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  expect(pathOf(page), 'an answered scan sent the person away').toBe('/add/photo');
  expect(proxy.answered).toBeGreaterThan(0);
  expect(proxy.refused).toBe(0);
});
