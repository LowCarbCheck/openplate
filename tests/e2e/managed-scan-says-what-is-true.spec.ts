/**
 * A managed instance never sends a member to AI settings it does not have.
 *
 * THE REPORT, install rehearsal, 2026-09-27: a managed instance
 * (`INSTANCE_MODE=managed`, `UPSTREAM_BASE_URL` and `UPSTREAM_API_KEY` set on
 * the sync service, no `AI_ADVERTISED_MODEL`), a signed-in member with an
 * allowance, a photo, "Analyze": "No luck with that photo. Connect your AI
 * provider in settings". A managed instance has no AI settings page, and
 * nothing reached either server.
 *
 * WHY. openplate-core publishes `ai: { model: null }` when the operator names
 * no model, and this app needs a model id to send, so it sent nothing. The
 * action then fell through to the open instance's sentence about a provider
 * of your own. Whether a managed instance with no named model should scan at
 * all is a separate question (the recipes screen already refuses, with its own
 * sentence, and `scan-trial-managed.spec.ts` pins that); what this spec pins
 * is that the screen says what is true on a managed instance, in both of the
 * ways a scan there can fail:
 *
 *  1. The instance names no model: nothing is sent, and the sentence is not
 *     about a provider of the member's own.
 *  2. The request reaches the proxy and the provider behind it refuses the
 *     operator's key (the proxy relays the upstream 401): the sentence is not
 *     "check your key in AI settings" either.
 *
 * WHAT IS REAL: the production build booted as a managed instance, the sign-in
 * against the tier's fake sync service, the scan screen and its action. WHAT
 * IS STUBBED: `/health`, the account's allowance on every auth answer, and the
 * proxy's chat completions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_SYNC_SERVER_URL } from './env';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** The two sentences a managed screen must never say, read from the shipped English bundle. */
const BYOK_COPY = z
  .object({
    scan: z.object({
      errors: z.object({
        connectProvider: z.string(),
        provider: z.object({ auth: z.string() }),
        titles: z.object({ auth: z.string() }),
      }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8'))).scan.errors;

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** Routes the handshake with `model`, and gives the account an allowance on every auth answer. */
async function routeManagedCore(page: Page, model: string | null): Promise<void> {
  await page.route(`${E2E_SYNC_SERVER_URL}/health`, (route) =>
    route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: {
          name: 'openplate-e2e',
          language: 'en',
          mail: false,
          memberInvites: false,
          plans: false,
          openSignup: false,
          // AN UPSTREAM IS CONFIGURED in both tests; only the model differs.
          ai: { model },
        },
      },
    }),
  );
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/auth/`),
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const parsed = z
        .looseObject({ account: z.record(z.string(), z.unknown()) })
        .safeParse(text === '' ? null : JSON.parse(text));
      if (!parsed.success) return route.fulfill({ response, body: text });
      return route.fulfill({
        response,
        json: { ...parsed.data, account: { ...parsed.data.account, dailyAiLimit: 20, allowanceExpiresAt: null } },
      });
    },
  );
}

/** Answers every proxied chat completion the way openplate-core relays an upstream 401, and counts them. */
async function routeProxyRefusingTheKey(page: Page): Promise<{ calls: number }> {
  const seen = { calls: 0 };
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/chat/completions`, (route) => {
    const request = route.request();
    const cors = { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' };
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': request.headers()['access-control-request-headers'] ?? '*',
        },
      });
    }
    seen.calls += 1;
    return route.fulfill({
      status: 401,
      headers: cors,
      json: { error: 'the upstream provider answered 401: {"error":{"message":"No auth credentials found"}}' },
    });
  });
  return seen;
}

/** Signs the fixture account in on the managed build and lands on the diary. */
async function signInManaged(page: Page): Promise<void> {
  await page.goto(`${server.url}/sign-in`);
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|onboarding)/);
  if (!page.url().includes('/onboarding')) return;
  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();
  await page.waitForURL('**/diary');
}

/** Hands the scan screen one photo, which it analyses on its own, and returns the failure alert. */
async function scanOnePhoto(page: Page) {
  await page.goto(`${server.url}/add/photo`);
  await page
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  const alert = page.locator('main [role="alert"]');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  return alert;
}

test('an instance that names no model sends nothing and does not ask for a provider of your own', async ({ page }) => {
  await routeManagedCore(page, null);
  const proxy = await routeProxyRefusingTheKey(page);
  await signInManaged(page);

  const alert = await scanOnePhoto(page);

  await expect(alert).not.toContainText(BYOK_COPY.connectProvider);
  expect((await alert.innerText()).trim().length).toBeGreaterThan(0);
  expect(proxy.calls, 'a request went out with no model to name').toBe(0);
});

test('a provider that refuses the operator key is reached, and the screen does not blame your key', async ({
  page,
}) => {
  await routeManagedCore(page, 'e2e-model');
  const proxy = await routeProxyRefusingTheKey(page);
  await signInManaged(page);

  const alert = await scanOnePhoto(page);

  expect(proxy.calls, 'the scan never reached the proxy').toBeGreaterThan(0);
  await expect(alert).not.toContainText(BYOK_COPY.provider.auth);
  await expect(alert).not.toContainText(BYOK_COPY.titles.auth);
  await expect(alert).not.toContainText(BYOK_COPY.connectProvider);
});
