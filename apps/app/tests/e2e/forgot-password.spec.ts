/**
 * "Forgot your password?" answers every press of its button.
 *
 * THE REPORT, install rehearsal, 2026-09-27: `/forgot`, the account's address
 * typed, "Send the link", and nothing changed on screen, and no request
 * reached the core server. The cause was the form's schema: it was the sign-in
 * schema, which also requires a password, and this form has no password
 * field. Every submission failed validation on a field nobody could see, so
 * the error had nowhere to show and the request was never sent. That held on
 * every instance, with mail or without.
 *
 * WHAT IS REAL: the production build, the tier's fake core server, which
 * says `mail: false` in its `/health` like an instance with no mail
 * configured, and the page's own request. WHAT IS STUBBED: `/health`, in the
 * tests that need an instance that can send mail.
 *
 * NO SENTENCE IS PINNED BUT ONE THAT ALREADY SHIPPED. The answers are found by
 * their `data-slot`, and only the "sent" sentence is compared with the
 * catalog, because it is the one the page has always said.
 *
 * @area accounts-and-sign-in
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { E2E_ACCOUNT_EMAIL, E2E_CORE_URL } from './env';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

test.use({ serviceWorkers: 'block' });

const COPY = z
  .object({ forgot: z.object({ submit: z.string(), sent: z.string() }) })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The reset request the page sends to the core server. */
const RESET_REQUEST_URL = `${E2E_CORE_URL}/v1/auth/reset/request`;

/** Is this the page's reset request? */
function isResetRequest(request: Request): boolean {
  return request.method() === 'POST' && request.url() === RESET_REQUEST_URL;
}

/** Answers `/health` as an instance that CAN send mail. */
async function routeHealthWithMail(page: Page): Promise<void> {
  await page.route(`${E2E_CORE_URL}/health`, (route) =>
    route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: { name: 'openplate-e2e', language: 'en', mail: true, ai: { model: 'e2e-model' } },
      },
    }),
  );
}

/** Types the fixture address and presses the one button. */
async function submitAddress(page: Page): Promise<void> {
  await page.locator('main input[type="email"]').fill(E2E_ACCOUNT_EMAIL);
  await page.getByRole('button', { name: COPY.forgot.submit, exact: true }).click();
}

test('an instance with mail sends the request and says the link is on its way', async ({ page }) => {
  await routeHealthWithMail(page);
  await page.goto('/forgot');

  const sent = page.waitForRequest(isResetRequest);
  await submitAddress(page);
  const request = await sent;
  expect(request.postDataJSON()).toEqual({ email: E2E_ACCOUNT_EMAIL });

  await expect(page.locator('[data-slot="forgot-sent"]')).toBeVisible();
  await expect(page.locator('[data-slot="forgot-sent"]')).toContainText(COPY.forgot.sent);
  // Control for the no-mail test below: the same query finds nothing here.
  await expect(page.locator('[data-slot="forgot-no-mail"]')).toBeHidden();
});

test('an instance with no mail sends nothing and tells the person who can help', async ({ page }) => {
  const resetRequests: string[] = [];
  page.on('request', (request) => {
    if (isResetRequest(request)) resetRequests.push(request.url());
  });
  await page.goto('/forgot');

  await submitAddress(page);

  const noMail = page.locator('[data-slot="forgot-no-mail"]');
  await expect(noMail).toBeVisible();
  expect((await noMail.innerText()).trim().length).toBeGreaterThan(0);
  // Control for the test above: the "sent" sentence would be a false promise here.
  await expect(page.locator('[data-slot="forgot-sent"]')).toBeHidden();
  expect(resetRequests, 'a reset request went to an instance that cannot mail it').toEqual([]);
});

test('an unreachable core server is said, not swallowed', async ({ page }) => {
  await routeHealthWithMail(page);
  await page.route(RESET_REQUEST_URL, (route) => route.abort('connectionrefused'));
  await page.goto('/forgot');

  await submitAddress(page);

  await expect(page.locator('[data-slot="forgot-problem"]')).not.toBeEmpty();
  await expect(page.locator('[data-slot="forgot-sent"]')).toBeHidden();
});

test('the answer moves nothing that was on screen', async ({ page }) => {
  await installShiftObserver(page);
  await routeHealthWithMail(page);
  await page.goto('/forgot');
  await settleFrames(page);

  const title = page.locator('main [data-slot="card-title"]');
  const titleTop = (await title.boundingBox())?.y;
  const before = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  await submitAddress(page);
  await expect(page.locator('[data-slot="forgot-sent"]')).toBeVisible();
  await settleFrames(page);

  expect((await title.boundingBox())?.y, 'the card title moved').toBe(titleTop);
  expect(movedBetween(before, await readTops(page)), 'what stayed on screen moved').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while the answer arrived').toBe(0);
});
