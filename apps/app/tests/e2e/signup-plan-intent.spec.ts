/**
 * The sign-up funnel on a managed, paid instance (2026-09-28).
 *
 * THE OWNER'S MODEL: ten free AI scans with no card, then a plan. openplate.de
 * links to `/sign-up?plan=monthly|yearly&lang=<code>` and to `/?lang=<code>`.
 * Before this change the app ignored both parameters, the sign-up screen never
 * stated a price, and the logged-out landing's main button said "Sign in".
 *
 * WHAT IS REAL: the production build booted as a managed instance
 * (`managed-app-server.ts`), the landing, `/welcome`, `/sign-up`, `/join`, the
 * account ceremony against the fake sync service, the plan page, the language
 * switch and the storage the plan is kept in. WHAT IS STUBBED: `/health` (the
 * fake service has no open sign-up and sells no plans), the anonymous
 * `GET /v1/plans/prices`, the sign-up request, and the plan reads. The prices
 * are figures nobody charges, so no real price reaches this public repository.
 *
 * Every presence has a control that finds the same thing absent through the
 * same query, and every "moves nothing" reading has a control that moves
 * something and sees it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { EN } from './copy';
import { E2E_CORE_URL } from './env';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { routeManagedCore, signInManaged, trialAccountStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { createGate, type Gate } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot, beside the tier's 30 s per spec. */
const BOOT_BUDGET_MS = 90_000;

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** The free scans the stubbed handshake promises. */
const TRIAL_SCANS = 10;

/** Figures nobody charges, in cents. */
const MONTHLY_CENTS = 321;
const YEARLY_CENTS = 2345;

/** The plan page, whose onboarding exemption the paywall change adds. */
const PLAN_PAGE = '/settings/plan';

const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'tr'] as const;
type Language = (typeof LANGUAGES)[number];

/** The keys this spec reads, from each shipped catalog, so a renamed key fails here on load. */
const funnelCopySchema = z.looseObject({
  signupOffer: z.object({
    scans_other: z.string(),
    prices: z.string(),
    noPrices: z.string(),
    chosenMonthly: z.string(),
    chosenYearly: z.string(),
  }),
  signUp: z.object({ title: z.string(), submit: z.string(), sent: z.string() }),
  chrome: z.object({ signUp: z.string(), signIn: z.string() }),
  landing: z.object({ cta: z.object({ tryIt: z.string() }) }),
  welcome: z.object({ haveAccount: z.string(), managed: z.object({ signUp: z.string(), haveInvite: z.string() }) }),
  join: z.object({ title: z.string() }),
});

type FunnelCopy = z.infer<typeof funnelCopySchema>;

function funnelCopy(language: Language): FunnelCopy {
  return funnelCopySchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${language}/common.json`), 'utf8')),
  );
}

const COPY = {
  en: funnelCopy('en'),
  de: funnelCopy('de'),
  fr: funnelCopy('fr'),
  it: funnelCopy('it'),
  es: funnelCopy('es'),
  tr: funnelCopy('tr'),
} satisfies Record<Language, FunnelCopy>;
const EN_FUNNEL = COPY.en;
const FR = COPY.fr;

/** What the stubbed `/health` says. */
interface HandshakeStub {
  openSignup: boolean;
  plans: boolean;
  trialScans: number | null;
  gate?: Promise<void>;
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** Answers `/health` for the managed server's sync origin. */
async function routeHandshake(page: Page, stub: HandshakeStub): Promise<void> {
  const instance = new Map<string, unknown>([
    ['name', 'openplate-e2e'],
    ['language', 'en'],
    ['mail', true],
    ['memberInvites', false],
    ['plans', stub.plans],
    ['openSignup', stub.openSignup],
    ['ai', { model: 'e2e-model' }],
  ]);
  if (stub.trialScans !== null) instance.set('trial', { scans: stub.trialScans });
  await page.route(`${E2E_CORE_URL}/health`, async (route) => {
    await stub.gate;
    await route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: Object.fromEntries(instance),
      },
    });
  });
}

/** Every read of the prices route, and what it answers. */
async function routePrices(page: Page, answer: 'prices' | 'failure', gate?: Gate): Promise<{ reads: number }> {
  const seen = { reads: 0 };
  await page.route(`${E2E_CORE_URL}/v1/plans/prices`, async (route) => {
    seen.reads += 1;
    await gate?.promise;
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };
    if (answer === 'failure') {
      await route.fulfill({ status: 500, headers, json: { error: 'down' } });
      return;
    }
    await route.fulfill({
      headers,
      json: {
        currency: 'EUR',
        plans: [
          { key: 'monthly', interval: 'month', grossCents: MONTHLY_CENTS },
          { key: 'yearly', interval: 'year', grossCents: YEARLY_CENTS },
        ],
      },
    });
  });
  return seen;
}

/** Every body the page posted to the sign-up route, each answered `202 {}`. */
async function routeSignupRequest(page: Page): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(`${E2E_CORE_URL}/v1/auth/signup-request`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: {} });
  });
  return bodies;
}

/** A regular expression source for a literal string. */
function literal(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The French price sentence with both figures in the French format: a decimal
 * comma and the euro sign after a space. The English form, "€3.21", matches
 * neither.
 */
function frenchPriceLine(): RegExp {
  const parts = FR.signupOffer.prices.split(/\{\{(monthly|yearly)\}\}/u);
  const source = parts
    .map((part) => {
      if (part === 'monthly') return '3,21\\s€';
      if (part === 'yearly') return '23,45\\s€';
      return literal(part);
    })
    .join('');
  return new RegExp(`^${source}$`, 'u');
}

function submitButton(page: Page, language: Language = 'en'): Locator {
  return page.getByRole('button', { name: COPY[language].signUp.submit });
}

/** Types an address and presses the button, then waits for the inbox line. */
async function submitAddress(page: Page, language: Language = 'en'): Promise<void> {
  await page.locator('input[name="email"]').fill('anna@example.org');
  await submitButton(page, language).click();
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeVisible();
}

/** The radio of one plan card on the order page. */
function planRadio(page: Page, key: 'monthly' | 'yearly'): Locator {
  return page.locator(`[data-slot="plan-card"][data-plan-key="${key}"] input[type="radio"]`);
}

/** Waits for fonts and animations, so a shift baseline is not taken inside a font swap. */
async function settleForBaseline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
}

// ─── /sign-up ────────────────────────────────────────────────────────────────

test('a pricing-page link in French renders the form in French, states the prices and the plan, and sends both', async ({
  page,
}) => {
  await routeHandshake(page, { openSignup: true, plans: true, trialScans: TRIAL_SCANS });
  await routePrices(page, 'prices');
  const bodies = await routeSignupRequest(page);

  await page.goto(`${server.url}/sign-up?plan=yearly&lang=fr`);

  // THE LANGUAGE SWITCH RAN: the document was reloaded in French, and the
  // parameter left the address while the plan stayed in it.
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr', { timeout: 10_000 });
  await expect(page).toHaveURL(`${server.url}/sign-up?plan=yearly`);
  await expect(page.getByText(FR.signUp.title)).toBeVisible();

  await expect(page.locator('[data-slot="signup-offer-scans"]')).toHaveText(
    FR.signupOffer.scans_other.replace('{{count}}', String(TRIAL_SCANS)),
  );
  await expect(page.locator('[data-slot="signup-offer-prices"]')).toHaveText(frenchPriceLine());
  await expect(page.locator('[data-slot="signup-offer-chosen"]')).toHaveText(FR.signupOffer.chosenYearly);

  await submitAddress(page, 'fr');
  expect(bodies, 'one request, with the plan and the language beside the address').toEqual([
    { email: 'anna@example.org', plan: 'yearly', locale: 'fr' },
  ]);
});

test('the control: a bare link renders in English, names no plan, and sends none', async ({ page }) => {
  await routeHandshake(page, { openSignup: true, plans: true, trialScans: TRIAL_SCANS });
  await routePrices(page, 'prices');
  const bodies = await routeSignupRequest(page);

  await page.goto(`${server.url}/sign-up`);
  await expect(page.locator('[data-slot="signup-offer-prices"]')).toContainText('€3.21', { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // The anchor above says the offer is drawn, so this absence is a reading.
  await expect(page.locator('[data-slot="signup-offer-chosen"]')).toHaveCount(0);

  await submitAddress(page);
  expect(bodies).toEqual([{ email: 'anna@example.org', locale: 'en' }]);
});

test('an unknown plan and an unknown language are ignored, never stored and never sent', async ({ page }) => {
  await routeHandshake(page, { openSignup: true, plans: true, trialScans: TRIAL_SCANS });
  await routePrices(page, 'prices');
  const bodies = await routeSignupRequest(page);

  await page.goto(`${server.url}/sign-up?plan=weekly&lang=xx`);
  await expect(page.locator('[data-slot="signup-offer-prices"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // No reload happened, so nothing took the parameters off the address.
  await expect(page).toHaveURL(`${server.url}/sign-up?plan=weekly&lang=xx`);
  await expect(page.locator('[data-slot="signup-offer-chosen"]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('openplate:intended-plan:v1'))).toBeNull();
  const cookies = await page.context().cookies(server.url);
  expect(cookies.some((cookie) => cookie.name === LANGUAGE_COOKIE)).toBe(false);

  await submitAddress(page);
  expect(bodies).toEqual([{ email: 'anna@example.org', locale: 'en' }]);
});

for (const answer of ['failure', 'prices'] as const) {
  test(`the price line keeps its box while the read is in flight, and moves nothing when it answers (${answer})`, async ({
    page,
  }) => {
    await installShiftObserver(page);
    await routeHandshake(page, { openSignup: true, plans: true, trialScans: TRIAL_SCANS });
    const gate = createGate();
    const prices = await routePrices(page, answer, gate);
    await routeSignupRequest(page);

    await page.goto(`${server.url}/sign-up?plan=monthly`);
    const button = submitButton(page);
    await expect(button).toBeEnabled({ timeout: 10_000 });
    await expect.poll(() => prices.reads, { message: 'the page never asked for the prices' }).toBeGreaterThan(0);
    // IN FLIGHT: neither sentence is shown, and both lines under it are.
    await expect(page.locator('[data-slot="signup-offer-no-prices"]')).toBeHidden();
    await expect(page.locator('[data-slot="signup-offer-prices"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="signup-offer-chosen"]')).toHaveText(EN_FUNNEL.signupOffer.chosenMonthly);
    await settleForBaseline(page);
    const buttonTop = (await button.boundingBox())?.y;
    const linkTop = (await page.locator('[data-slot="sign-up-sign-in"]').boundingBox())?.y;
    const since = (await readShiftEntries(page)).length;

    gate.open();
    if (answer === 'failure') {
      await expect(page.locator('[data-slot="signup-offer-no-prices"]')).toHaveText(EN_FUNNEL.signupOffer.noPrices);
      await expect(page.locator('[data-slot="signup-offer-no-prices"]')).toBeVisible();
    } else {
      await expect(page.locator('[data-slot="signup-offer-prices"]')).toContainText('€23.45');
      await expect(page.locator('[data-slot="signup-offer-no-prices"]')).toBeHidden();
    }
    await settleFrames(page);
    expect((await button.boundingBox())?.y, 'the button moved when the prices answered').toBe(buttonTop);
    expect((await page.locator('[data-slot="sign-up-sign-in"]').boundingBox())?.y).toBe(linkTop);
    expect(shiftScoreAfter(await readShiftEntries(page), since), 'layout-shift as the prices answered').toBe(0);

    // THE CONTROL: a line that does grow above the button is seen by both
    // readings, so the zeros above are a page that held still.
    const beforeControl = (await readShiftEntries(page)).length;
    await page.locator('[data-slot="signup-offer-scans"]').evaluate((node) => {
      const grown = document.createElement('p');
      grown.textContent = 'control line';
      grown.style.height = '40px';
      node.after(grown);
    });
    await settleFrames(page);
    expect((await button.boundingBox())?.y).not.toBe(buttonTop);
    await expect.poll(async () => shiftScoreAfter(await readShiftEntries(page), beforeControl)).toBeGreaterThan(0);
  });
}

// ─── /join ───────────────────────────────────────────────────────────────────

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

/** Mints an invite on the fake service for a new address. */
async function mintInvite(): Promise<string> {
  const email = `funnel-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.invalid`;
  const response = await fetch(`${E2E_CORE_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

/** The join link the core mails, with extra fields appended to its fragment. */
function joinLink(inviteToken: string, extra: string): string {
  return `${server.url}/join#server=${encodeURIComponent(E2E_CORE_URL)}&invite=${inviteToken}${extra}`;
}

/** Chooses a password and creates the account. */
async function createAccount(page: Page): Promise<void> {
  const passwords = page.locator('main input[type="password"]');
  await expect(passwords.first()).toBeVisible({ timeout: 10_000 });
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('main form button[type="submit"]').last().click();
}

/** Walks the questionnaire of a new account to the diary. */
async function finishOnboarding(page: Page): Promise<void> {
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

/** Opens the order page by the settings hub's row, the way `openPlanPageSignedIn` does. */
async function openPlanPageFromHub(page: Page): Promise<void> {
  await page.goto(`${server.url}/settings`);
  await page.locator(`main a[href="${PLAN_PAGE}"]`).click();
  await page.waitForURL(`**${PLAN_PAGE}**`);
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2, { timeout: 15_000 });
}

/**
 * THE PLAN PAGE IS EXEMPT from the onboarding gate since the paywall landed
 * (7cb9fd1), so a new account lands on it straight from `/join`.
 *
 * THIS FILE USED TO ASK, through `isOnboardingGateExempt`, so that it held
 * either build while the two branches were apart. Once they met, that import
 * reached `common.json` (`onboarding-gate` -> `plans-door` ->
 * `use-server-instance` -> `sync-actions`), which Playwright's loader refuses
 * without an import attribute, and the whole browser tier died at load before
 * a single test ran. A spec imports only leaf modules from `app/`.
 */
test('a join link that names the yearly plan lands a new account on the order page with yearly picked', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // A FRESH BROWSER, as every test's context is: no stored plan, so the plan
  // can only come from the link.
  await routeManagedCore(page, trialAccountStub(TRIAL_SCANS));

  await page.goto(joinLink(await mintInvite(), '&plan=yearly'));
  await createAccount(page);

  await page.waitForURL(/\/settings\/plan\?plan=yearly$/u, { timeout: 60_000 });
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2, { timeout: 15_000 });
  await expect(planRadio(page, 'yearly')).toBeChecked();
  await expect(planRadio(page, 'monthly')).not.toBeChecked();
});

test('the control: a join link with no plan lands where it always did, and picks nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await routeManagedCore(page, trialAccountStub(TRIAL_SCANS));

  await page.goto(joinLink(await mintInvite(), ''));
  await createAccount(page);
  await page.waitForURL('**/onboarding', { timeout: 60_000 });
  await finishOnboarding(page);
  await openPlanPageFromHub(page);
  // The cards are drawn (the anchor above) and a frame has passed for the
  // pick that a stored plan would have made.
  await settleFrames(page);
  await expect(planRadio(page, 'yearly')).not.toBeChecked();
  await expect(planRadio(page, 'monthly')).not.toBeChecked();
});

test('a join link in French opens the join page in French, and keeps the invitation across the reload', async ({
  page,
}) => {
  await routeManagedCore(page, trialAccountStub(TRIAL_SCANS));
  await page.goto(joinLink(await mintInvite(), '&lang=fr&plan=monthly'));

  await expect(page.locator('html')).toHaveAttribute('lang', 'fr', { timeout: 10_000 });
  await expect(page.getByText(FR.join.title).first()).toBeVisible();
  // The invitation survived the reload, and no token came back to the bar.
  await expect(page.locator('main input[type="password"]').first()).toBeVisible({ timeout: 10_000 });
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('openplate:intended-plan:v1'))).toContain('"monthly"');
});

// ─── the order page, for somebody who signs in instead ──────────────────────

test('a plan chosen before signing in is picked on the order page, and a link naming another wins', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await routeManagedCore(page, trialAccountStub(TRIAL_SCANS));
  await page.goto(`${server.url}/sign-up?plan=monthly`);
  await expect(page.locator('[data-slot="signup-offer-chosen"]')).toBeVisible({ timeout: 10_000 });

  await signInManaged(page, server.url);
  await openPlanPageFromHub(page);
  await expect(planRadio(page, 'monthly')).toBeChecked();
  await expect(planRadio(page, 'yearly')).not.toBeChecked();

  // `?plan=` comes first, as it did before this change.
  await page.goto(`${server.url}${PLAN_PAGE}?plan=yearly`);
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2, { timeout: 15_000 });
  await expect(planRadio(page, 'yearly')).toBeChecked();
  await expect(planRadio(page, 'monthly')).not.toBeChecked();
});

// ─── the front page and /welcome ────────────────────────────────────────────

/**
 * A MANAGED `/` IS THE ACCOUNT DOOR since M266 (the owner's design, approved
 * 2026-09-29): the doors the handshake allows, the offer, one line to
 * openplate.de. `account-door-page.spec.ts` reads that page in six languages
 * at three phone widths, with the handshake and the price read held and let
 * through; the funnel's own claims about it stay here.
 */
const DOORS = '[data-slot="account-door-doors"]';

/** The door page's visible links, as label and destination. */
async function doorLinks(page: Page): Promise<{ label: string; href: string | null }[]> {
  const links = page.locator(`${DOORS} a:visible`);
  return links.evaluateAll((nodes) =>
    nodes.map((node) => ({ label: (node.textContent ?? '').trim(), href: node.getAttribute('href') })),
  );
}

test('the front page of an open, paid instance leads with "Sign up", keeps the query string, and states the offer', async ({
  page,
}) => {
  await routeHandshake(page, { openSignup: true, plans: true, trialScans: TRIAL_SCANS });
  await routePrices(page, 'prices');
  await page.goto(`${server.url}/?plan=yearly`);

  await expect(page.locator(`${DOORS} a:visible`).first()).toHaveText(EN_FUNNEL.chrome.signUp, { timeout: 10_000 });
  await expect
    .poll(() => doorLinks(page))
    .toEqual([
      { label: EN_FUNNEL.chrome.signUp, href: '/sign-up?plan=yearly' },
      { label: EN_FUNNEL.chrome.signIn, href: '/sign-in' },
    ]);
  // The one filled door is the sign-up form.
  await expect(page.locator(`${DOORS} a:visible[data-door="primary"]`)).toHaveText(EN_FUNNEL.chrome.signUp);
  const smallPrint = page.locator('[data-slot="account-door-small-print"]');
  await expect(smallPrint.locator('[data-slot="signup-offer-scans"]')).toHaveText(
    EN_FUNNEL.signupOffer.scans_other.replace('{{count}}', String(TRIAL_SCANS)),
  );
  await expect(smallPrint.locator('[data-slot="signup-offer-prices"]')).toContainText('€3.21');
});

test('the control: an invite-only instance leads with signing in, and an open one that sells nothing states no offer', async ({
  page,
}) => {
  for (const instanceKind of [
    {
      openSignup: false,
      plans: true,
      doors: [{ label: EN_FUNNEL.chrome.signIn, href: '/sign-in' }],
      signUpLinks: 0,
    },
    {
      openSignup: true,
      plans: false,
      doors: [
        { label: EN_FUNNEL.chrome.signUp, href: '/sign-up?plan=yearly' },
        { label: EN_FUNNEL.chrome.signIn, href: '/sign-in' },
      ],
      signUpLinks: 1,
    },
  ]) {
    const where = JSON.stringify({ openSignup: instanceKind.openSignup, plans: instanceKind.plans });
    await page.unrouteAll({ behavior: 'wait' });
    await routeHandshake(page, {
      openSignup: instanceKind.openSignup,
      plans: instanceKind.plans,
      trialScans: TRIAL_SCANS,
    });
    const prices = await routePrices(page, 'prices');
    await page.goto(`${server.url}/?plan=yearly`);
    // POLLED: a door's visibility settles a frame after its pair is drawn.
    await expect.poll(() => doorLinks(page), { message: where, timeout: 10_000 }).toEqual(instanceKind.doors);
    await expect(page.locator('main a[href^="/sign-up"]'), where).toHaveCount(instanceKind.signUpLinks);
    if (!instanceKind.openSignup) {
      // The invite-only pair's second door is the paste box, not a link.
      await expect(page.getByRole('button', { name: EN_FUNNEL.welcome.managed.haveInvite })).toBeVisible();
    }
    await expect(page.locator('[data-slot="signup-offer"]'), where).toHaveCount(0);
    expect(prices.reads, `${where}: a front page that states no price asked for one`).toBe(0);
  }
});

test('the control: the self-hosted landing keeps its one door, with no handshake to wait for', async ({ page }) => {
  // The tier's own server is an OPEN instance.
  await page.goto('/?plan=yearly');
  const hero = page.locator('main a[href="/dashboard"]').first();
  await expect(hero).toHaveText(EN_FUNNEL.landing.cta.tryIt);
  await expect(page.locator(DOORS)).toHaveCount(0);
  await expect(page.locator('main a[href^="/sign-up"]')).toHaveCount(0);
});

test('/welcome on an open instance leads with "Create an account", in the language the link names', async ({
  page,
}) => {
  const de = COPY.de;
  await routeHandshake(page, { openSignup: true, plans: true, trialScans: TRIAL_SCANS });
  await page.goto(`${server.url}/welcome?lang=de&plan=yearly`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de', { timeout: 10_000 });
  const first = page.locator('main a, main button').first();
  await expect(first).toHaveText(de.welcome.managed.signUp, { timeout: 10_000 });
  await expect(first).toHaveAttribute('href', '/sign-up?plan=yearly');
  await expect(page.locator('main a, main button').nth(1)).toHaveText(de.welcome.haveAccount);
  await expect(page.getByRole('button', { name: de.welcome.managed.haveInvite })).toBeVisible();
});

test('the control: /welcome on an invite-only instance still leads with signing in', async ({ page }) => {
  await routeHandshake(page, { openSignup: false, plans: true, trialScans: TRIAL_SCANS });
  await page.goto(`${server.url}/welcome`);
  await expect(page.getByRole('button', { name: EN_FUNNEL.welcome.managed.haveInvite })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('main a, main button').first()).toHaveAttribute('href', '/sign-in');
  await expect(page.locator('main a[href^="/sign-up"]')).toHaveCount(0);
});
