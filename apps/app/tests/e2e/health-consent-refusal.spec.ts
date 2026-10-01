/**
 * A push the core refuses for want of the consent sends the person to the
 * consent screen (owner decision, 2026-09-29).
 *
 * THE REASON. openplate-core now refuses every data route with `403
 * health-consent-required` to an account that does not hold the instance's
 * current consent version (`PROTOCOL.md` §4). The consent gate in
 * `_personal.tsx` asks from facts it holds for five minutes, so an operator who
 * changes the wording while a diary is open leaves the gate answering from the
 * old version. The core's refusal is then the first thing that knows. Before
 * this change the app read it as a plain "forbidden", showed "Sync failed" and
 * kept the person on the diary with nothing they could do about it.
 *
 * WHAT IS REAL: the production build, the fake sync service's account, session
 * and diary, the local write, the sync cycle it schedules, the `_personal`
 * layout and its revalidation, and the consent screen. WHAT IS STUBBED
 * (`managed-core-stub.ts`): the handshake, the account facts, the consent
 * route, and the core's refusal of sync writes by its own rule.
 *
 * THE PROMPT AND ITS TWIN differ in one stubbed fact, whether the account
 * holds the new version, and the refusal follows from it by the core's rule.
 * An app that sent everybody to the consent screen after a push fails the
 * twin; one that ignored the refusal fails the prompt.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_CORE_URL } from './env';
import { completeOnboarding } from './helpers';
import { settleFrames } from './layout-shift';
import { routeConsentRequiredSync, routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** Onboarding, a sign-in, a write and the debounced push outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/** The push waits three seconds after the last write, then a cycle runs; this covers both with room. */
const PUSH_WAIT_MS = 20_000;

/** How long a screen that should stay open is watched after the push that could have moved it. */
const OPEN_WATCH_MS = 1_500;

/** The wording the account agreed to on `/join`. */
const VERSION = '2026-09-28';

/** The wording the operator changes to while the diary is open. */
const NEXT_VERSION = '2027-01-15';

/** An instant for a consent on record. */
const AGREED_AT = '2026-09-04T10:11:12.000Z';

/** The consent screen's strings, from the shipped English bundle. */
const COPY = z
  .object({ healthConsent: z.object({ heading: z.string(), agree: z.string() }) })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A name nothing else in the diary carries. */
const FOOD = { name: 'Consent refusal lentils', grams: '150' };

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

/**
 * The pathname the page is on. NEVER A REGEX OVER THE WHOLE URL: the consent
 * screen's own address, `/consent?next=/diary`, also ends in `/diary`, so a
 * pattern like `/\/diary$/` passes on the very screen this file is about.
 */
function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/** Waits until the page is on the diary itself, not on a screen that continues to it. */
async function waitForDiary(page: Page): Promise<void> {
  await page.waitForURL((url) => url.pathname === '/diary');
}

/** A device past onboarding and signed in, on the diary. */
async function signIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await waitForDiary(page);
}

/**
 * The manual form, opened by a DOCUMENT LOAD while the account still holds the
 * consent, and the boot cycle that load starts, finished.
 *
 * Everything after this is client side on purpose: a document load reads the
 * handshake again, and the consent gate would then ask on the new wording
 * without any refusal, which is not what this file is about.
 */
async function openManualForm(page: Page): Promise<ReturnType<Page['locator']>> {
  const pulled = page.waitForResponse(
    (response) => response.url() === `${E2E_CORE_URL}/v1/sync/blob` && response.request().method() === 'GET',
  );
  await page.goto('/add/search');
  await page.getByRole('button', { name: EN.add.search.addManually }).click();
  const manual = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="manual"]') });
  await expect(manual.locator('input[name="name"]')).toBeVisible();
  await pulled;
  await settleFrames(page);
  return manual;
}

/** Types the food and saves it, which lands on the diary and schedules a push. */
async function saveFood(manual: ReturnType<Page['locator']>): Promise<void> {
  await manual.locator('input[name="name"]').fill(FOOD.name);
  await manual.locator('input[name="quantityGrams"]').fill(FOOD.grams);
  await manual.getByRole('button', { name: EN.add.manual.submit }).click();
}

test('a push the core refuses for want of the consent sends the person to the consent screen', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core();
  await routeManagedCore(page, stub);
  const writes = await routeConsentRequiredSync(page, stub);
  await signIn(page);
  const manual = await openManualForm(page);

  // THE OPERATOR CHANGES THE WORDING while the form is open. The gate still
  // holds the old version, so only the core's refusal can say so.
  stub.healthConsent = { version: NEXT_VERSION };
  await saveFood(manual);

  await expect(page, 'the refused push did not send the person to the consent screen').toHaveURL(
    /\/consent\?next=\/diary$/,
    { timeout: PUSH_WAIT_MS },
  );
  expect(writes.refused, 'no push was refused, so something else moved the page').toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: COPY.healthConsent.heading })).toBeVisible();

  // ── Agree and continue: the diary, and the held write goes up ─────────
  const acceptedBefore = writes.accepted;
  await page.locator('main [data-slot="health-consent-box"]').check();
  await page.getByRole('button', { name: COPY.healthConsent.agree, exact: true }).click();
  await waitForDiary(page);
  expect(stub.accountHealthConsent?.version, 'the core recorded no consent').toBe(NEXT_VERSION);
  await expect
    .poll(() => writes.accepted, { message: 'the held write never went up after agreeing', timeout: PUSH_WAIT_MS })
    .toBeGreaterThan(acceptedBefore);
  await expect(page.locator('main').getByText(FOOD.name).first()).toBeVisible();
});

test('the twin: the same push from an account that agreed to the new wording moves nothing', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core();
  await routeManagedCore(page, stub);
  const writes = await routeConsentRequiredSync(page, stub);
  await signIn(page);
  const manual = await openManualForm(page);

  // The same new wording, agreed to on another device, so the core refuses nothing.
  stub.healthConsent = { version: NEXT_VERSION };
  stub.accountHealthConsent = { version: NEXT_VERSION, at: AGREED_AT };
  const acceptedBefore = writes.accepted;
  await saveFood(manual);
  await waitForDiary(page);

  // THE PUSH HAPPENED, so the diary staying on screen is the answer to it and
  // not the absence of one.
  await expect
    .poll(() => writes.accepted, { message: 'no push was sent after the write', timeout: PUSH_WAIT_MS })
    .toBeGreaterThan(acceptedBefore);
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  expect(pathOf(page), 'an accepted push sent the person away').toBe('/diary');
  expect(writes.refused).toBe(0);
});
