/**
 * A managed device that holds one account's diary, and a SECOND account that
 * arrives on it (ADR-0023).
 *
 * ── The defect this file encodes (thread C, 2026-10-02) ──────────────────
 *
 * On a managed instance a plain sign-out hides the diary behind a device lock
 * and deletes nothing. The lock named no account, and every session that
 * opened lifted it. So a different person who signed in, joined or reset a
 * password on the same device opened the first person's plaintext diary, and
 * the first sync counted every row as unsent against the new account's empty
 * baseline and PUSHED the first person's diary into the second account.
 *
 * The lock now names its owner, a session for another account refuses to open
 * on a held device, and the way on is one step that erases the held diary
 * first (`data-slot="account-switch"`).
 *
 * ── What is real and what is stubbed ─────────────────────────────────────
 *
 * REAL: the production build as a managed instance, the tier's fake core
 * server, every account here (minted through its `__e2e__` invite seam, so the
 * shared fixture account is touched only where a test signs it in), the
 * sign-out dialog, the lock, the erase. STUBBED: the account facts
 * (`managed-core-stub.ts`) and, in the reset test only, the answer to
 * `/v1/auth/reset/open`, because the fake service mints reset tokens only in
 * its own process. That answer is all the reset's refusal reads: on a held
 * device the step comes before any request that names the account.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Every absence below has a twin presence. The account that signed out signs
 * back in with no step and finds its own entry, so "no step" and "the entry is
 * visible" are both readings that can come out the other way. The request
 * recorder that sees no login for the wrong address sees the owner's login a
 * moment later. The layout reading is taken twice, and the second time with
 * the page centred again, which moves the title and has to be caught.
 *
 * @area accounts-and-sign-in
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_CORE_URL } from './env';
import { installShiftObserver, readShiftEntries, settleAnimations, shiftScoreAfter } from './layout-shift';
import { routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** Two account ceremonies, two onboardings, a sign-out and an erase fit in this. */
const TEST_BUDGET_MS = 240_000;

/** How long an account ceremony may take: Argon2id in the browser plus round trips. */
const CEREMONY_BUDGET_MS = 60_000;

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** The entry only the first account ever logs. */
const SOUP = 'A only soup';

/** The entry the second account logs, so its pulled copy is known to be the latest. */
const B_ENTRY = 'B own toast';

/** The lock's key, spelled here so the old-format test can write the old value. */
const DEVICE_LOCK_KEY = 'openplate.device-locked';

/** A signed-in account on an instance that sells nothing, so no paywall stands in the way. */
const ACCOUNT_STUB: ManagedCoreStub = {
  trialScans: null,
  allowanceExpiresAt: null,
  dailyAiLimit: 20,
  invitesLeft: null,
  memberInvites: false,
  planView: NO_SUBSCRIPTION_VIEW,
  plans: false,
  displayName: null,
};

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A fresh address per call, so no two tests and no two runs meet. */
function newAddress(label: string): string {
  return `${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.invalid`;
}

/** Mints an invitation on the fake service, the way an admin would. */
async function mintInvite(email: string): Promise<string> {
  const response = await fetch(`${E2E_CORE_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

/** The join link an admin hands out, for this tier's own core server. */
function joinUrl(inviteToken: string): string {
  return `${server.url}/join#server=${encodeURIComponent(E2E_CORE_URL)}&invite=${inviteToken}`;
}

/** The create form's password fields: their presence is the proof the form, not the step, is on screen. */
function passwordFields(page: Page): Locator {
  return page.locator('main input[type="password"]');
}

/** The step that asks to erase the held diary. */
function accountSwitch(page: Page): Locator {
  return page.locator('main [data-slot="account-switch"]');
}

/** Finishes the managed first-run questions when the account lands on them, the way `signInManaged` does. */
async function finishOnboardingIfAsked(page: Page): Promise<void> {
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
  await page.waitForURL(/\/diary$/);
}

/** Fills and submits the create form that is on screen, and lands on the diary. */
async function createAccountOnScreen(page: Page): Promise<void> {
  await expect(passwordFields(page).first()).toBeVisible({ timeout: 15_000 });
  await passwordFields(page).nth(0).fill(PASSWORD);
  await passwordFields(page).nth(1).fill(PASSWORD);
  await page.locator('main form button[type="submit"]').last().click();
  await page.waitForURL(/\/(diary|onboarding)/, { timeout: CEREMONY_BUDGET_MS });
  await finishOnboardingIfAsked(page);
}

/**
 * Resolves when a push that STARTS from now on reached the core and was
 * accepted. A push already in flight does not count: it carries what the
 * device held before, and the onboarding's own push is often still running
 * when the next entry is saved.
 */
async function nextPush(page: Page): Promise<void> {
  const request = await page.waitForRequest(
    (candidate) => candidate.url() === `${E2E_CORE_URL}/v1/sync/blob` && candidate.method() === 'POST',
    { timeout: 30_000 },
  );
  const response = await request.response();
  expect(response?.ok(), 'the push was refused').toBe(true);
}

/** Logs one entry through the manual form, and waits for it to reach the account. */
async function logAndPush(page: Page, name: string): Promise<void> {
  await page.goto(`${server.url}/add/search`);
  await page.getByRole('button', { name: EN.add.search.addManually }).click();
  const manual = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="manual"]') });
  await manual.locator('input[name="name"]').fill(name);
  await manual.locator('input[name="quantityGrams"]').fill('300');
  await manual.getByRole('button', { name: EN.add.manual.submit }).click();
  await page.waitForURL('**/diary**');
  await expect(page.locator('main').getByText(name).first()).toBeVisible();
  // The entry is saved; the debounced push that carries it starts after this (`PUSH_DEBOUNCE_MS`).
  await nextPush(page);
}

/** Signs out from the header menu WITHOUT erasing, which on a managed instance locks the device. */
async function signOutWithoutErase(page: Page): Promise<void> {
  await page.goto(`${server.url}/diary`);
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await page
    .getByRole('menuitem')
    .filter({ has: page.locator('svg.lucide-log-out') })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('checkbox')).toBeEnabled();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('button', { name: EN.signOut.confirm, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/welcome');
}

/** Account A: joined, onboarded, one entry logged and pushed, signed out without an erase. */
async function deviceHeldByA(page: Page): Promise<{ email: string }> {
  const email = newAddress('first');
  await page.goto(joinUrl(await mintInvite(email)));
  await createAccountOnScreen(page);
  await logAndPush(page, SOUP);
  await signOutWithoutErase(page);
  return { email };
}

/** Fills `/sign-in` and submits it. */
async function submitSignIn(page: Page, { email, passphrase }: { email: string; passphrase: string }): Promise<void> {
  await page.locator('input[autocomplete="username"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(passphrase);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
}

/** How many requests one recorder has seen so far. */
interface RequestCount {
  count: number;
}

/** Counts every POST to one core path, from now on. A preflight is not a request the app made. */
function countRequests(page: Page, path: string): RequestCount {
  const seen: RequestCount = { count: 0 };
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url() === `${E2E_CORE_URL}${path}`) seen.count += 1;
  });
  return seen;
}

/** Signs an account in on a FRESH device and counts, in its pulled diary, each of the given entries. */
async function countOnFreshDevice(
  browser: Browser,
  { account, names }: { account: { email: string; passphrase: string }; names: readonly string[] },
): Promise<number[]> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await routeManagedCore(page, ACCOUNT_STUB);
    await page.goto(`${server.url}/sign-in`);
    await submitSignIn(page, account);
    await page.waitForURL(/\/diary$/, { timeout: CEREMONY_BUDGET_MS });
    await expect(page.locator('main [data-slot="date-nav"]')).toBeVisible();
    // The first name is the account's own entry, so this waits for the pull before counting the rest.
    await expect(
      page
        .locator('main')
        .getByText(names[0] ?? '')
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    return await Promise.all(names.map((name) => page.locator('main').getByText(name).count()));
  } finally {
    await context.close();
  }
}

test('an invitation on a device that holds another account diary erases it first, and the new account never sees it', async ({
  page,
  browser,
}) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  await deviceHeldByA(page);

  // FROM HERE, every signup and every push. Before the step is answered there must be none.
  const signups = countRequests(page, '/v1/auth/signup');
  const pushes = countRequests(page, '/v1/sync/blob');

  const second = newAddress('second');
  await page.goto(joinUrl(await mintInvite(second)));
  await expect(accountSwitch(page)).toBeVisible({ timeout: 15_000 });
  await expect(passwordFields(page)).toHaveCount(0);
  expect(signups.count, 'no account was created over the held diary').toBe(0);
  expect(pushes.count, 'nothing was pushed for the new account over the held diary').toBe(0);

  // ERASE IT AND CONTINUE: the same page comes back by a document load, with the same invitation.
  await accountSwitch(page).locator('[data-slot="account-switch-erase"]').click();
  await createAccountOnScreen(page);
  // THE DIARY HAS DRAWN before its absence is read; A's entry was found by the same locator above.
  await expect(page.locator('main [data-slot="date-nav"]')).toBeVisible();
  await expect(page.locator('main').getByText(SOUP)).toHaveCount(0);
  expect(signups.count, 'the new account was created once, after the erase').toBe(1);

  // AND THE ACCOUNT ITSELF. B logs its own entry and it reaches the core; a
  // fresh device then pulls B's copy. B's entry is there (the pull read the
  // latest copy) and A's is not.
  await logAndPush(page, B_ENTRY);
  expect(pushes.count, 'the push recorder saw B\u2019s own push, so its zero above was a reading').toBeGreaterThan(0);
  const [ownEntry, heldEntry] = await countOnFreshDevice(browser, {
    account: { email: second, passphrase: PASSWORD },
    names: [B_ENTRY, SOUP],
  });
  expect(ownEntry, 'the fresh device did not pull B\u2019s own copy').toBeGreaterThan(0);
  expect(heldEntry, 'A\u2019s entry reached B\u2019s account').toBe(0);
});

test('a sign-in with another address asks first and sends no login, and the owner signs straight back in', async ({
  page,
}) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  const owner = await deviceHeldByA(page);
  const logins = countRequests(page, '/v1/auth/login');
  const kdfLookups = countRequests(page, '/v1/auth/kdf');

  await page.goto(`${server.url}/sign-in`);
  await submitSignIn(page, { email: E2E_ACCOUNT_EMAIL, passphrase: E2E_ACCOUNT_PASSPHRASE });
  await expect(accountSwitch(page)).toBeVisible({ timeout: 15_000 });
  expect(logins.count, 'the other address reached the login').toBe(0);
  expect(kdfLookups.count, 'the other address started the key ceremony').toBe(0);

  // CANCEL changes nothing: the form comes back, and the owner can still sign in.
  await accountSwitch(page).locator('[data-slot="account-switch-cancel"]').click();
  await expect(accountSwitch(page)).toHaveCount(0);

  // THE CONTROL: the owner's own address goes through, with no step, onto the diary that was hidden.
  await submitSignIn(page, { email: owner.email, passphrase: PASSWORD });
  await page.waitForURL(/\/diary$/, { timeout: CEREMONY_BUDGET_MS });
  await expect(page.locator('main').getByText(SOUP).first()).toBeVisible();
  await expect(accountSwitch(page)).toHaveCount(0);
  expect(logins.count, 'the recorder saw the owner log in').toBeGreaterThan(0);
  expect(kdfLookups.count, 'the recorder saw the owner key ceremony start').toBeGreaterThan(0);
});

test('a lock written by an older build belongs to the one account with a baseline here', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  const owner = await deviceHeldByA(page);
  // THE OLD VALUE, which names nobody. The one baseline on this device is A's.
  await page.evaluate((key) => localStorage.setItem(key, 'locked'), DEVICE_LOCK_KEY);
  const logins = countRequests(page, '/v1/auth/login');

  // ANOTHER ACCOUNT: the address cannot be compared, so the core is asked who it is, and then the step.
  await page.goto(`${server.url}/sign-in`);
  await submitSignIn(page, { email: E2E_ACCOUNT_EMAIL, passphrase: E2E_ACCOUNT_PASSPHRASE });
  await expect(accountSwitch(page)).toBeVisible({ timeout: CEREMONY_BUDGET_MS });
  expect(logins.count, 'the owner is unknown by address, so the core decided').toBeGreaterThan(0);
  await accountSwitch(page).locator('[data-slot="account-switch-cancel"]').click();

  // THE OWNER: no step, and the diary.
  await submitSignIn(page, { email: owner.email, passphrase: PASSWORD });
  await page.waitForURL(/\/diary$/, { timeout: CEREMONY_BUDGET_MS });
  await expect(page.locator('main').getByText(SOUP).first()).toBeVisible();
});

test('a reset link for another account on a held device is spent, asks first, and recovers nothing', async ({
  page,
}) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  await deviceHeldByA(page);
  const other = newAddress('reset');
  // THE ONE STUB: `/reset/open` names another account. The preflight goes on to the fake service.
  await page.route(`${E2E_CORE_URL}/v1/auth/reset/open`, (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' },
      json: { email: other, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA' },
    });
  });
  const opens = countRequests(page, '/v1/auth/reset/open');
  const recovers = countRequests(page, '/v1/auth/recover');
  const rotates = countRequests(page, '/v1/auth/recover-rotate');

  await page.goto(`${server.url}/reset#server=${encodeURIComponent(E2E_CORE_URL)}&token=sr_e2e-held-device`);
  await expect(passwordFields(page).first()).toBeVisible({ timeout: 15_000 });
  await passwordFields(page).nth(0).fill(PASSWORD);
  await passwordFields(page).nth(1).fill(PASSWORD);
  await page.locator('main form button[type="submit"]').last().click();

  await expect(accountSwitch(page)).toBeVisible({ timeout: 15_000 });
  await expect(accountSwitch(page).locator('[data-line="reset-spent"]')).toBeVisible();
  expect(opens.count, 'the recorder saw the token spent, so the zeros below are readings').toBe(1);
  expect(recovers.count, 'the recovery started over the held diary').toBe(0);
  expect(rotates.count, 'the passphrase rotated over the held diary').toBe(0);

  // ERASE IT AND CONTINUE leads to a new link, with the address already filled in.
  await accountSwitch(page).locator('[data-slot="account-switch-erase"]').click();
  await page.waitForURL((url) => url.pathname === '/forgot');
  await expect(page.locator('main input[type="email"]')).toHaveValue(other);
});

test('the step replaces the sign-in form without moving what is above it', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await installShiftObserver(page);
  await routeManagedCore(page, ACCOUNT_STUB);
  await deviceHeldByA(page);
  const title = page.locator('main [data-slot="card-title"]').first();

  /** Submits another account's address and reports how far the title moved and the shift recorded. */
  async function measureTheSwap(): Promise<{ titleMoved: number; score: number }> {
    await settleAnimations(page);
    const before = await title.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    const since = (await readShiftEntries(page)).length;
    await submitSignIn(page, { email: E2E_ACCOUNT_EMAIL, passphrase: E2E_ACCOUNT_PASSPHRASE });
    await expect(accountSwitch(page)).toBeVisible({ timeout: 15_000 });
    await settleAnimations(page);
    const after = await title.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    return {
      titleMoved: Math.round((after - before) * 10) / 10,
      score: shiftScoreAfter(await readShiftEntries(page), since),
    };
  }

  await page.goto(`${server.url}/sign-in`);
  const reading = await measureTheSwap();
  expect(reading.titleMoved, 'the title moved when the step replaced the form').toBe(0);
  expect(reading.score, 'the swap recorded a layout shift').toBe(0);

  // THE CONTROL: the same page centred again, the way it used to be drawn. The
  // step is not the form's height, so the title moves and a shift is recorded.
  await accountSwitch(page).locator('[data-slot="account-switch-cancel"]').click();
  await page.addStyleTag({ content: 'main { justify-content: center !important; }' });
  const centred = await measureTheSwap();
  expect(centred.titleMoved, 'the control did not move the title, so the reading above proves nothing').not.toBe(0);
  expect(centred.score, 'the control recorded no shift, so the zero above proves nothing').toBeGreaterThan(0);
});
