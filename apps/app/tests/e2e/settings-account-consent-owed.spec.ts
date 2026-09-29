/**
 * The account page never shows the consent refusal's machine code (review of
 * M266, 2026-09-29).
 *
 * THE REASON. `/settings/account` is exempt from the consent gate on purpose:
 * deleting the account is how a person declines, and signing out must always
 * work. So somebody who has not agreed can open it, and three of its forms
 * reach routes openplate-core refuses to them with `403
 * health-consent-required`: renaming the account, inviting somebody and
 * changing the password. Before this fix the name and password forms printed
 * that token as the sentence, and the invite form said "try again in a
 * moment" about a refusal that waiting cannot lift.
 *
 * WHAT IS REAL: the production build, the fake sync service's account and
 * session, the account page and its three forms, and the password derivation.
 * WHAT IS STUBBED (`managed-core-stub.ts`): the handshake, the account facts,
 * and the core's refusal of the three writes by its own rule.
 *
 * THE PROMPT AND ITS TWIN differ in one stubbed fact, whether the account
 * holds the consent. The control proves the reading this file relies on can
 * see the token when it is on screen, so its absence below is a finding and
 * not a blind spot.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE } from './env';
import { completeOnboarding } from './helpers';
import {
  HEALTH_CONSENT_REQUIRED,
  routeConsentRequiredAccountWrites,
  routeManagedCore,
  type ManagedCoreStub,
} from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** Onboarding, a sign-in, three forms and two password derivations outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 120_000;

/** Two production-cost password derivations run before the password change is sent. */
const DERIVATION_WAIT_MS = 30_000;

/** The wording the stubbed instance asks consent to. */
const VERSION = '2026-09-28';

/** An instant for a consent on record. */
const AGREED_AT = '2026-09-04T10:11:12.000Z';

/** Where the consent line on the account page leads. */
const CONSENT_HREF = '/consent?next=/settings/account';

/** A new password that passes the recovery schema's floor. It is never accepted by anybody. */
const NEW_PASSWORD = 'eleven orange kites over the harbour';

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({
    healthConsent: z.object({ requiredToContinue: z.string(), heading: z.string() }),
    account: z.object({
      name: z.object({ save: z.string(), saved: z.string() }),
      invites: z.object({ send: z.string() }),
      password: z.object({ open: z.string(), submit: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A member with invitations to send, on an instance that asks the current wording. */
function core(accountHealthConsent: ManagedCoreStub['accountHealthConsent']): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: '2030-01-01T00:00:00.000Z',
    dailyAiLimit: 20,
    invitesLeft: 3,
    invitesNeedAPlan: false,
    memberInvites: true,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: false,
    healthConsent: { version: VERSION },
    accountHealthConsent,
  };
}

/** A device past onboarding, signed in, and wherever the sign-in's own navigation ended. */
async function signIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/diary' || url.pathname === '/consent');
}

/** The account page with all three forms drawn. */
async function openAccountPage(page: Page): Promise<void> {
  await page.goto('/settings/account');
  await expect(page.locator('#account-display-name')).toBeVisible();
  await expect(page.locator('#account-invite-email')).toBeVisible({ timeout: 10_000 });
}

/** How many times the refusal's machine code is on screen in the page's main content. */
async function rawTokenCount(page: Page): Promise<number> {
  return page.locator('main').getByText(HEALTH_CONSENT_REQUIRED).count();
}

/** The consent lines on the page, each a link to the consent screen that returns here. */
function consentLinks(page: Page) {
  return page.locator(`main a[href="${CONSENT_HREF}"]`);
}

/** Renames the account through its form. */
async function saveName(page: Page): Promise<void> {
  await page.locator('#account-display-name').fill('Consent owed');
  await page
    .locator('form')
    .filter({ has: page.locator('#account-display-name') })
    .getByRole('button', { name: COPY.account.name.save, exact: true })
    .click();
}

/** Sends an invitation through its form. */
async function sendInvite(page: Page): Promise<void> {
  await page.locator('#account-invite-email').fill('friend@example.org');
  await page.getByRole('button', { name: COPY.account.invites.send, exact: true }).click();
}

/** Opens the password form and asks for a change. */
async function changePassword(page: Page): Promise<void> {
  await page.getByRole('button', { name: COPY.account.password.open, exact: true }).click();
  const form = page.locator('form').filter({ has: page.locator('#account-current-password') });
  await form.locator('#account-current-password').fill(E2E_ACCOUNT_PASSPHRASE);
  await form.locator('input[name="passphrase"]').fill(NEW_PASSWORD);
  await form.locator('input[name="confirmPassphrase"]').fill(NEW_PASSWORD);
  await form.getByRole('button', { name: COPY.account.password.submit, exact: true }).click();
}

test('an account without the consent is told to agree, with a link, and never shown the code', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core(null);
  await routeManagedCore(page, stub);
  const writes = await routeConsentRequiredAccountWrites(page, stub);
  await signIn(page);
  await openAccountPage(page);

  await saveName(page);
  await expect(consentLinks(page), 'the name form did not say the consent is needed').toHaveCount(1);
  await sendInvite(page);
  await expect(consentLinks(page), 'the invite form did not say the consent is needed').toHaveCount(2);
  await changePassword(page);
  await expect(consentLinks(page), 'the password form did not say the consent is needed').toHaveCount(3, {
    timeout: DERIVATION_WAIT_MS,
  });

  expect(writes.refused, 'the core refused fewer than the three writes').toBe(3);
  expect(await rawTokenCount(page), 'the machine code is on screen').toBe(0);
  await expect(consentLinks(page).first()).toHaveText(COPY.healthConsent.requiredToContinue);

  // THE LINK WORKS: it opens the consent screen, which returns here.
  await consentLinks(page).first().click();
  await page.waitForURL((url) => url.pathname === '/consent');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/settings/account');
  await expect(page.getByRole('heading', { name: COPY.healthConsent.heading })).toBeVisible();
});

test('the twin: an account that holds the consent saves its name and sees no consent line', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core({ version: VERSION, at: AGREED_AT });
  await routeManagedCore(page, stub);
  const writes = await routeConsentRequiredAccountWrites(page, stub);
  await signIn(page);
  await openAccountPage(page);

  await saveName(page);
  await expect(page.locator('main').getByText(COPY.account.name.saved, { exact: true })).toBeVisible();
  await expect(consentLinks(page)).toHaveCount(0);
  expect(writes.refused).toBe(0);
});

test('control: the reading this file relies on sees the code when it is on screen', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core(null);
  await routeManagedCore(page, stub);
  await signIn(page);
  await openAccountPage(page);

  expect(await rawTokenCount(page)).toBe(0);
  // Written into the same element a form's message line sits in.
  await page
    .locator('form')
    .filter({ has: page.locator('#account-display-name') })
    .evaluate((form, token) => {
      const line = document.createElement('p');
      line.textContent = token;
      form.append(line);
    }, HEALTH_CONSENT_REQUIRED);
  expect(await rawTokenCount(page)).toBe(1);
});
