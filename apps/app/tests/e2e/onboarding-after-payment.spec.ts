/**
 * Onboarding after payment, for the buyer who chose a plan first (M265/03).
 *
 * THE DEFECT. openplate.de's pricing page links to `/sign-up?plan=yearly`.
 * That buyer went: sign-up, the join link with the consent box, the order
 * page, Stripe, the return screen, and then the diary. The questionnaire that
 * a free starter answers before the diary, and that the diary's targets come
 * from, never came. The order page is exempt from the onboarding gate, so the
 * gate said nothing there, and `_personal.tsx`'s `shouldRevalidate` skipped
 * the gate on the plain navigation out of it.
 *
 * THE SECOND DEFECT, found by this walk once the gate did answer. The app
 * syncs on the order page, and every account's first sync writes the
 * owner-private compartment into the sync baseline. The gate counted that as
 * evidence of a synced diary, so a device with a session, a baseline and no
 * profile read as a lost diary, and the buyer met the recovery screen instead
 * of the questionnaire. Accounts from before this change met it at their next
 * visit, which the third test below reproduces.
 *
 * THE DECISION (milestone README, decision (c)). The questionnaire comes AFTER
 * payment: nothing new stands between the chosen price and Stripe. A buyer who
 * leaves Stripe without paying is a free starter from then on and meets the
 * questionnaire like one. Somebody who has already answered it never sees it
 * again because they bought a plan.
 *
 * WHAT IS REAL: the production build booted as a managed instance, the
 * sign-up form, the join page and its account ceremony against the fake sync
 * service, the order page, the return screen and the questionnaire. WHAT IS
 * STUBBED (`managed-core-stub.ts`, `plans-stub.ts`): the handshake with a
 * consent version, the sign-up request, the plan reads, and the order, whose
 * answer names the address "Stripe" sends the browser back to.
 *
 * Every presence has a control that finds the other answer through the same
 * query: the onboarded account below goes to the diary from the very same
 * link, so "the questionnaire" is a reading and not a constant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_CORE_URL } from './env';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { routeManagedCore, trialAccountStub, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW, routeOrder, YEARLY_SUBSCRIBER_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** One account ceremony at production cost, a payment return that polls, and the questionnaire. */
const WALK_BUDGET_MS = 150_000;

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** The wording the stubbed instance asks consent to. */
const CONSENT_VERSION = '2026-09-28';

/** How long after the order the biller's webhook "lands", so the checking state is on screen for a while. */
const WEBHOOK_DELAY_MS = 4_500;

/** The strings this file reads, from the shipped English catalog. */
const catalogSchema = z.looseObject({
  paywall: z.looseObject({
    freeScansFirst: z.string(),
    returned: z.looseObject({ active: z.string(), openDiary: z.string() }),
  }),
  plan: z.looseObject({ returned: z.looseObject({ success: z.string(), cancelled: z.string() }) }),
  meta: z.looseObject({ dashboard: z.string() }),
});

/** The shipped English catalog, parsed by `schema` at the boundary. */
function readCatalog<T>(schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));
}

const COPY = readCatalog(catalogSchema);

/**
 * The label of the return screen's link when it leads to the questionnaire.
 * Read when it is needed rather than at load, so the walk's first failing line
 * on a build without the key is the address, which is the defect.
 */
function setUpLabel(): string {
  return readCatalog(z.object({ paywall: z.object({ returned: z.object({ setUp: z.string() }) }) })).paywall.returned
    .setUp;
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

/** Mints an invite on the fake service for a new address. */
async function mintInvite(): Promise<string> {
  const email = `after-payment-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.invalid`;
  const response = await fetch(`${E2E_CORE_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

/** The join link the core mails, with extra fields appended to its fragment the way the core appends `&plan=`. */
function joinLink(inviteToken: string, extra: string): string {
  return `${server.url}/join#server=${encodeURIComponent(E2E_CORE_URL)}&invite=${inviteToken}${extra}`;
}

/**
 * A trial account with scans left, on an instance that asks consent to health
 * data, and with that consent on record, as the core records it with the
 * account the ticked box created. The fake service keeps no consent, so
 * without the record the consent gate would stand in front of the order page.
 */
function consentCore(): ManagedCoreStub {
  const stub = trialAccountStub(10);
  stub.healthConsent = { version: CONSENT_VERSION };
  stub.accountHealthConsent = { version: CONSENT_VERSION, at: new Date().toISOString() };
  return stub;
}

/** When the biller starts to answer "yearly subscriber". Set by {@link pressOrder}. */
interface Payment {
  paidAt: number;
}

/**
 * Answers the plan reads by the clock: no plan until the payment has "landed",
 * the yearly plan after. Registered after `routeManagedCore`, so it answers first.
 */
async function routePayment(page: Page): Promise<Payment> {
  const payment: Payment = { paidAt: Number.POSITIVE_INFINITY };
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, (route) =>
    route.fulfill({ json: Date.now() >= payment.paidAt ? YEARLY_SUBSCRIBER_VIEW : NO_SUBSCRIPTION_VIEW }),
  );
  return payment;
}

/** Answers the sign-up request `202 {}`, the one answer the core gives whatever the address. */
async function routeSignupRequest(page: Page): Promise<void> {
  await page.route(`${E2E_CORE_URL}/v1/auth/signup-request`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ status: 202, json: {} });
  });
}

/** Signs up on `/sign-up?plan=yearly`, the address the pricing page links to, up to the inbox line. */
async function signUpWithAPlan(page: Page): Promise<void> {
  await page.goto(`${server.url}/sign-up?plan=yearly`);
  await expect(page.locator('[data-slot="signup-offer-chosen"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('input[name="email"]').fill('buyer@example.org');
  await page.locator('main form button[type="submit"]').last().click();
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeVisible();
}

/** Chooses a password, ticks the consent to health data, and creates the account. */
async function createAccount(page: Page): Promise<void> {
  const passwords = page.locator('main input[type="password"]');
  await expect(passwords.first()).toBeVisible({ timeout: 15_000 });
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('main [data-slot="health-consent-box"]').check();
  await page.locator('main form button[type="submit"]').last().click();
}

/** Walks the questionnaire to the diary, answering as little as it allows. */
async function finishOnboarding(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="onboarding-step-title"]')).toHaveText(EN.onboarding.style.title);
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

/**
 * Picks the yearly plan where it is not picked already, ticks both boxes and
 * presses the order button. A payment "lands" a few seconds later, so the
 * return screen polls through its checking state first; `isPaid: false` is
 * the buyer who leaves Stripe, whose plan never turns active.
 */
async function pressOrder(page: Page, { payment, isPaid }: { payment: Payment; isPaid: boolean }): Promise<void> {
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2, { timeout: 15_000 });
  const yearly = page.locator('[data-slot="plan-card"][data-plan-key="yearly"] input[type="radio"]');
  if (!(await yearly.isChecked())) await page.locator('[data-slot="plan-card"][data-plan-key="yearly"]').click();
  await page.locator('[data-slot="plan-consent-terms"]').check();
  await page.locator('[data-slot="plan-consent-early-start"]').check();
  payment.paidAt = isPaid ? Date.now() + WEBHOOK_DELAY_MS : Number.POSITIVE_INFINITY;
  await page.locator('[data-slot="plan-order-button"]').click();
}

function returnLine(page: Page): Locator {
  return page.locator('[data-slot="plan-return"]');
}

/** The one link in the return line: the way on once the plan is active. */
function continueLink(page: Page): Locator {
  return returnLine(page).locator('a');
}

/** What the continue link says and where it points, read once the plan is active. */
async function readContinueLink(page: Page): Promise<{ label: string; href: string | null }> {
  await expect(page.getByText(COPY.paywall.returned.active, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(continueLink(page)).toBeVisible();
  return {
    label: ((await continueLink(page).textContent()) ?? '').trim(),
    href: await continueLink(page).getAttribute('href'),
  };
}

/** Waits for the page's fonts, so a font swap in the header is not read as the page moving. */
async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test('a buyer who chose a plan first meets the questionnaire after paying, not the diary', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await installShiftObserver(page);
  await routeManagedCore(page, consentCore());
  const payment = await routePayment(page);
  await routeSignupRequest(page);
  await routeOrder(page, [{ status: 200, json: { url: `${server.url}/settings/plan?checkout=success` } }]);

  // ── Sign-up, the join link, the consent box, the order page ─────────
  await signUpWithAPlan(page);
  await page.goto(joinLink(await mintInvite(), '&plan=yearly'));
  await createAccount(page);
  // NOTHING NEW BEFORE STRIPE: the order page is still the first screen.
  await page.waitForURL(/\/settings\/plan\?plan=yearly$/u, { timeout: 60_000 });
  await pressOrder(page, { payment, isPaid: true });

  // ── The return: checking, then active, in one box ───────────────────
  await expect(returnLine(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(COPY.plan.returned.success, { exact: true })).toBeVisible();
  await waitForFonts(page);
  await settleAnimations(page);
  const boxChecking = await returnLine(page).boundingBox();
  const shiftsBefore = (await readShiftEntries(page)).length;
  const next = await readContinueLink(page);
  expect(await returnLine(page).boundingBox(), 'the return line changed its box when the plan turned active').toEqual(
    boxChecking,
  );
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift when the plan turned active').toBe(
    0,
  );

  // ── The first screen after the return is the questionnaire ──────────
  await continueLink(page).click();
  await expect(page, 'the first screen after the return is not the questionnaire').toHaveURL(/\/onboarding(\?|$)/u, {
    timeout: 15_000,
  });
  await expect(page.locator('[data-slot="onboarding-step-title"]')).toHaveText(EN.onboarding.style.title);

  // THE LINK SAID WHERE IT WENT, before it went there.
  expect(next).toEqual({ label: setUpLabel(), href: '/onboarding' });

  // ── And the diary after it ──────────────────────────────────────────
  await finishOnboarding(page);
  await expect(page).toHaveURL(/\/diary$/u);

  // THE CONTROL for the two box readings: a line pushed in above the page
  // must read as moved and as a shift, so the equalities above can fail.
  await page.goto(`${server.url}/settings/plan`);
  await expect(page.locator('[data-slot="plan-status-card"]')).toBeVisible({ timeout: 15_000 });
  await settleAnimations(page);
  const cardTop = (await page.locator('[data-slot="plan-status-card"]').boundingBox())?.y;
  const shiftsBeforeControl = (await readShiftEntries(page)).length;
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '40px';
    document.querySelector('main')?.prepend(spacer);
  });
  await settleFrames(page);
  expect((await page.locator('[data-slot="plan-status-card"]').boundingBox())?.y, 'the control moved nothing').not.toBe(
    cardTop,
  );
  await expect
    .poll(async () => shiftScoreAfter(await readShiftEntries(page), shiftsBeforeControl), {
      message: 'the control was no shift',
    })
    .toBeGreaterThan(0);
});

test('THE CONTROL: an account that has answered the questionnaire buys a plan and goes to the diary', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, consentCore());
  const payment = await routePayment(page);
  await routeOrder(page, [{ status: 200, json: { url: `${server.url}/settings/plan?checkout=success` } }]);

  // A FREE STARTER, EXACTLY AS BEFORE: no plan in the link, so the join lands
  // on the questionnaire and nowhere else.
  await page.goto(joinLink(await mintInvite(), ''));
  await createAccount(page);
  await page.waitForURL('**/onboarding', { timeout: 60_000 });
  await finishOnboarding(page);

  // Later, the same account buys a plan.
  await page.goto(`${server.url}/settings/plan?plan=yearly`);
  await pressOrder(page, { payment, isPaid: true });
  const next = await readContinueLink(page);
  expect(next).toEqual({ label: COPY.paywall.returned.openDiary, href: '/dashboard' });

  await continueLink(page).click();
  await expect(page).toHaveURL(/\/dashboard$/u, { timeout: 15_000 });
  await expect(page).toHaveTitle(COPY.meta.dashboard);
  // A redirect would have moved the address by now.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/dashboard$/u);

  // And the next visit, a document load, opens the diary too.
  await page.goto(`${server.url}/dashboard`);
  await expect(page).toHaveTitle(COPY.meta.dashboard, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/dashboard$/u);
});

/**
 * THE ACCOUNTS FROM BEFORE THIS CHANGE. A plan-first buyer who paid then
 * reached the diary with no profile. Their device holds a session, no
 * profile, no food, and a sync baseline whose only entity is the
 * owner-private compartment, which every account's first sync writes. That
 * baseline read as a lost diary, so their next visit showed the recovery
 * screen, "we can't find your diary", to somebody who had lost nothing. The
 * questionnaire is the right answer for them: it is what sets the targets
 * they never had.
 */
test('a plan-first account with no profile and no food meets the questionnaire at its next visit, not the recovery screen', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, consentCore());

  await page.goto(joinLink(await mintInvite(), '&plan=yearly'));
  await createAccount(page);
  await page.waitForURL(/\/settings\/plan\?plan=yearly$/u, { timeout: 60_000 });
  // THE STATE THOSE ACCOUNTS ARE IN: the app has synced once on the order
  // page, so the baseline names the compartment and nothing else.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith('openplate.sync.state.v1:'))
            .map((key) => localStorage.getItem(key) ?? ''),
        ),
      { message: 'the order page never synced', timeout: 20_000 },
    )
    .toEqual([expect.stringContaining('"privateStore:me"')]);

  // The next visit: a document load of the diary's door.
  await page.goto(`${server.url}/dashboard`);
  await expect(page, 'the next visit did not open the questionnaire').toHaveURL(/\/onboarding(\?|$)/u, {
    timeout: 20_000,
  });
  await expect(page.locator('[data-slot="onboarding-step-title"]')).toHaveText(EN.onboarding.style.title);
});

test('a buyer who leaves Stripe without paying is a free starter, and meets the questionnaire before the diary', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, consentCore());
  const payment = await routePayment(page);
  await routeOrder(page, [{ status: 200, json: { url: `${server.url}/settings/plan?checkout=cancelled` } }]);

  await page.goto(joinLink(await mintInvite(), '&plan=yearly'));
  await createAccount(page);
  await page.waitForURL(/\/settings\/plan\?plan=yearly$/u, { timeout: 60_000 });
  await pressOrder(page, { payment, isPaid: false });
  await expect(page.getByText(COPY.plan.returned.cancelled, { exact: true })).toBeVisible({ timeout: 20_000 });

  // The way back to the free scans leads through the questionnaire first.
  await page.getByRole('link', { name: COPY.paywall.freeScansFirst, exact: true }).click();
  await expect(page, 'a free starter reached the diary without the questionnaire').toHaveURL(/\/onboarding(\?|$)/u, {
    timeout: 15_000,
  });
  await expect(page.locator('[data-slot="onboarding-step-title"]')).toHaveText(EN.onboarding.style.title);
});
