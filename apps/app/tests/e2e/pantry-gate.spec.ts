/**
 * A plan without the pantry scan closes the scan, and keeps the list (M2/05).
 *
 * THE WALK. A member of a managed instance signs in to an account whose plan
 * does NOT include the pantry, and opens `/pantry` from inside the app. The
 * photo and word composer is replaced by the closed-feature note (lock mark,
 * the feature's name, the way to the plan page), and the stored list stays what
 * it was: rows can still be added by hand and kept. Nothing on the page moves
 * while it settles, and no request reaches the AI proxy.
 *
 * THE SECOND HALF IS THE PROXY'S REFUSAL. A device that has not heard of the
 * closed feature (the account view had not landed, or the plan changed on
 * another device) sends the scan, and the core answers `403
 * capability-required`. The request names the feature in `X-Openplate-Feature`,
 * and the answer takes the error slot's place with the same note.
 *
 * WHAT IS REAL: the production build booted as a managed instance, the sign-in
 * against the tier's fake core server, the pantry screen and its store. WHAT IS
 * STUBBED: the handshake (`plans: true`), the plan reads, the account's feature
 * list on every auth answer, and the proxy's chat completions.
 *
 * THE CONTROLS, one input each, against the same walk: no feature list; a list
 * that names the pantry; the plans door off with the list that closes it; a
 * refusal that is not `capability-required`; and a person on their OWN key,
 * who is never gated.
 *
 * @area scan
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_CORE_URL } from './env';
import {
  completeOnboarding,
  connectStubAiProvider,
  openFromMoreSheet,
  pantryRowNames,
  pantryRowsOnDisk,
  signInFixtureAccount,
} from './helpers';
import { installShiftObserver, readShiftEntries, settleFrames, shiftScoreAfter } from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { PIXEL_PNG, routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore, FIXTURE_OFFER_BODY } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

/** The closed-feature note for the pantry. */
function closedNote(page: Page) {
  return page.locator('[data-slot="closed-feature"][data-feature="pantry"]');
}

/** The pantry's own composer strip. Its slot is the one place a scan or a typed list starts. */
function composer(page: Page) {
  return page.locator('main [data-slot="intake-composer"]');
}

/** The pantry composer's own camera input, not the tab bar's launcher. */
function shelfCamera(page: Page) {
  return page.locator('main div.max-w-xl input[type="file"][capture]');
}

/** What a spec says about the account and the instance. */
interface Setup {
  capabilities: readonly string[] | null;
  hasPlansDoor: boolean;
}

/** The managed core a spec names, as a stub the helpers read per request. */
function stubFor({ capabilities, hasPlansDoor }: Setup): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: 0,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: hasPlansDoor,
    capabilities,
  };
}

/** What the proxy saw, and how it answers. */
interface ProxyLog {
  calls: number;
  featureHeaders: (string | undefined)[];
}

/** Answers the proxy's chat completions with a refusal and records each request. */
async function routeProxy(page: Page, refusal: { status: number; json: object }): Promise<ProxyLog> {
  const log: ProxyLog = { calls: 0, featureHeaders: [] };
  await page.route(`${E2E_CORE_URL}/v1/chat/completions`, (route) => {
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
    log.calls += 1;
    log.featureHeaders.push(request.headers()['x-openplate-feature']);
    return route.fulfill({ status: refusal.status, headers: cors, json: refusal.json });
  });
  return log;
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

/** Signs in on the managed build and opens the pantry from inside the app. */
async function openPantryManaged(page: Page, setup: Setup): Promise<ProxyLog> {
  await routeManagedCore(page, stubFor(setup));
  const proxy = await routeProxy(page, { status: 500, json: { error: 'no request was expected' } });
  await signInManaged(page);
  await openFromMoreSheet(page, EN.nav.pantry);
  await page.waitForURL('**/pantry');
  return proxy;
}

test('a plan without the pantry shows the note in place of the composer, keeps the list editable and moves nothing', async ({
  page,
}) => {
  const proxy = await openPantryManaged(page, { capabilities: ['fasting'], hasPlansDoor: true });

  const note = closedNote(page);
  await expect(note).toBeVisible();
  await expect(note).toContainText(EN.featureGate.names.pantry);
  await expect(note.getByRole('link', { name: EN.featureGate.closed.plans })).toHaveAttribute('href', '/settings/plan');
  // THE SCAN IS CLOSED: no composer, no camera input of the pantry's own.
  await expect(composer(page)).toHaveCount(0);
  await expect(shelfCamera(page)).toHaveCount(0);

  // NOTHING MOVES, AND NOTHING FLIPS (see `fasting-gate.spec.ts`).
  const shiftsBefore = (await readShiftEntries(page)).length;
  await settleFrames(page);
  await expect(note).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift on the gated pantry').toBe(0);

  // WHAT STAYS: the list, by hand. A row is added, named and kept, and it is on disk.
  const rowsBefore = await pantryRowsOnDisk(page);
  await page.getByRole('button', { name: EN.pantry.review.addLine }).click();
  await page.locator('main input[id^="pantry-name-"]').last().fill('Gate test cabbage');
  await page.getByRole('button', { name: EN.pantry.review.saveList }).click();
  await expect.poll(() => pantryRowsOnDisk(page)).toBeGreaterThan(rowsBefore);
  expect(await pantryRowNames(page)).toContain('Gate test cabbage');

  expect(proxy.calls, 'a request reached the AI proxy for a closed feature').toBe(0);
});

test('the control: an account with no feature list (everything allowed) gets the composer', async ({ page }) => {
  await openPantryManaged(page, { capabilities: null, hasPlansDoor: true });
  await expect(composer(page)).toBeVisible();
  await expect(shelfCamera(page)).toHaveCount(1);
  await expect(closedNote(page)).toHaveCount(0);
});

test('the control: a list that names the pantry gets the composer', async ({ page }) => {
  await openPantryManaged(page, { capabilities: ['pantry'], hasPlansDoor: true });
  await expect(composer(page)).toBeVisible();
  await expect(closedNote(page)).toHaveCount(0);
});

test('the control: with the plans door off, the list that closes it changes nothing', async ({ page }) => {
  await openPantryManaged(page, { capabilities: ['fasting'], hasPlansDoor: false });
  await expect(composer(page)).toBeVisible();
  await expect(closedNote(page)).toHaveCount(0);
});

test('the proxy refusing a closed feature draws the same note in the error slot, after a request that named the feature', async ({
  page,
}) => {
  // The device has not heard of the closed feature: the list is `null`, so the composer is open.
  await routeManagedCore(page, stubFor({ capabilities: null, hasPlansDoor: true }));
  const proxy = await routeProxy(page, {
    status: 403,
    json: { error: 'capability-required', capability: 'pantry' },
  });
  await signInManaged(page);
  await openFromMoreSheet(page, EN.nav.pantry);
  await page.waitForURL('**/pantry');
  await expect(composer(page)).toBeVisible();

  await shelfCamera(page).setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  const note = closedNote(page);
  await expect(note).toBeVisible({ timeout: 15_000 });
  await expect(note.getByRole('link', { name: EN.featureGate.closed.plans })).toHaveAttribute('href', '/settings/plan');
  // THE NOTE REPLACED THE ERROR, it did not join it: no alert box beside it.
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  expect(proxy.featureHeaders, 'the request did not name its feature').toEqual(['pantry']);
});

test('the control: a refusal that is not capability-required stays an error, not the note', async ({ page }) => {
  await routeManagedCore(page, stubFor({ capabilities: null, hasPlansDoor: true }));
  const proxy = await routeProxy(page, { status: 403, json: { error: 'ai-not-allowed' } });
  await signInManaged(page);
  await openFromMoreSheet(page, EN.nav.pantry);
  await page.waitForURL('**/pantry');

  await shelfCamera(page).setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect(page.locator('main [role="alert"]')).toBeVisible({ timeout: 15_000 });
  await expect(closedNote(page)).toHaveCount(0);
  expect(proxy.calls).toBe(1);
});

test('a person on their own key is never gated, whatever the plan lacks', async ({ page }) => {
  // The tier's own OPEN instance, with a biller behind it and a plan that lacks the pantry.
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await routeAccountAllowance(page, { dailyAiLimit: 20, allowanceExpiresAt: null, capabilities: ['fasting'] });
  await completeOnboarding(page);
  await connectStubAiProvider(page);
  await signInFixtureAccount(page);
  await openFromMoreSheet(page, EN.nav.pantry);
  await page.waitForURL('**/pantry');

  await expect(composer(page)).toBeVisible();
  await expect(closedNote(page)).toHaveCount(0);
});
