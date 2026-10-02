/**
 * The paywall on an instance that sells plans (owner decision, 2026-09-28).
 *
 * A new account gets free AI scans and no card. When they are used up, a day
 * trial has ended, there never was an allowance, or a paid plan lapsed, every
 * feature screen sends the person to the plan page until they pay. The data
 * export, the account page and the privacy switches stay open. An instance
 * that sells nothing is never locked, and a fact the app cannot read never
 * locks anybody.
 *
 * WHAT IS REAL: the production build, the fake core server's account and
 * session, the `_personal` layout's loader, its `shouldRevalidate`, the plan
 * page, and every screen visited. WHAT IS STUBBED (`managed-core-stub.ts`):
 * the handshake (`plans`, the free scan count), `GET /plans/me`, the offer,
 * and the account facts on every auth answer.
 *
 * THREE WAYS IN, because the gate decides on three different paths:
 *  - the sign-in's own navigation, where the loader WAITS for the first read;
 *  - a document load, where the session is still reopening when the loader
 *    runs, and the layout asks again once the account and the facts arrive;
 *  - a tap on a link, decided in `shouldRevalidate` from the facts held.
 *
 * EVERY PAYWALL CHECK HAS AN OPEN TWIN on the same pages, differing only in
 * the stubbed standing, so a gate that locked everybody fails the twins and a
 * gate that locked nobody fails this file's first half.
 *
 * @area plans-and-paywall
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { BOTTOM_BAR } from './clip-baseline';
import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_CORE_URL } from './env';
import { completeOnboarding } from './helpers';
import { settleFrames } from './layout-shift';
import { routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { MONTHLY_SUBSCRIBER_VIEW, NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** A walk through five screens outlasts the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/**
 * How long a screen that should stay open is watched after the plan facts
 * arrived. The redirect it must not make would come within one loader run.
 */
const OPEN_WATCH_MS = 1_200;

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({
    paywall: z.object({
      heading: z.object({ scansUsed_other: z.string(), choose: z.string(), lapsed: z.string() }),
    }),
    // THE DOCUMENT TITLE says which screen is up. The header's own title is
    // no witness: the free scan countdown takes its place while it shows.
    meta: z.object({ dashboard: z.string(), diary: z.string(), add: z.string(), ai: z.string() }),
    settings: z.object({ data: z.object({ downloadJson: z.string() }) }),
    account: z.object({ signOut: z.object({ cta: z.string() }), delete: z.object({ cta: z.string() }) }),
    preferences: z.object({ analytics: z.object({ label: z.string() }) }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

/** An instant a day ago, for a date that has passed. */
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** The biller's view of a subscription that is over. */
const LAPSED_VIEW = {
  plan: 'canceled',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: YESTERDAY,
  cancelAtPeriodEnd: true,
  portalAvailable: true,
};

/** The core's answers. The default is a member whose ten free scans are spent, with no plan. */
function core(overrides: Partial<ManagedCoreStub> = {}): ManagedCoreStub {
  return {
    trialScans: { granted: 10, left: 0 },
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    ...overrides,
  };
}

/** The screens a locked person must not reach, each with the title it draws when it is reached. */
const FEATURE_SCREENS = [
  { path: '/dashboard', title: COPY.meta.dashboard },
  { path: '/add', title: COPY.meta.add },
  { path: '/diary', title: COPY.meta.diary },
  { path: '/settings/ai', title: COPY.meta.ai },
] as const;

/** The four standings that lock, each with the heading the plan page draws for it. */
const LOCKED = [
  {
    name: 'the free scans are used up',
    core: core(),
    heading: fill(COPY.paywall.heading.scansUsed_other, { count: '10' }),
  },
  {
    name: 'a day trial ended',
    core: core({ trialScans: null, allowanceExpiresAt: YESTERDAY }),
    heading: COPY.paywall.heading.choose,
  },
  {
    name: 'there is no allowance and no date',
    core: core({ trialScans: null, dailyAiLimit: 0 }),
    heading: COPY.paywall.heading.choose,
  },
  {
    name: 'a paid plan lapsed',
    core: core({ trialScans: null, allowanceExpiresAt: YESTERDAY, planView: LAPSED_VIEW }),
    heading: COPY.paywall.heading.lapsed,
  },
] as const;

/** The standings that never lock, every one of them with its free scans spent, so only the named fact opens. */
const OPEN = [
  { name: 'free scans are left', core: core({ trialScans: { granted: 10, left: 4 } }) },
  { name: 'a subscriber', core: core({ planView: MONTHLY_SUBSCRIBER_VIEW }) },
  {
    name: 'a subscription that will not renew',
    core: core({ planView: { ...MONTHLY_SUBSCRIBER_VIEW, cancelAtPeriodEnd: true } }),
  },
  {
    name: 'a subscription whose payment is retried',
    core: core({ planView: { ...MONTHLY_SUBSCRIBER_VIEW, plan: 'past_due' } }),
  },
  { name: 'a standing grant', core: core({ trialScans: null }) },
  {
    name: 'an administrator with no allowance of their own',
    core: core({ trialScans: null, dailyAiLimit: 0, role: 'admin' }),
  },
  { name: 'an instance that sells no plans (the beta shape)', core: core({ plans: false }) },
] as const;

/**
 * Resolves when the plan read of THIS page has been answered, whatever it
 * answered. The wait is registered on the call, before the navigation it
 * anchors, because an async function runs up to its first `await` at once.
 */
async function planRead(page: Page): Promise<void> {
  await page.waitForResponse((response) => response.url() === `${E2E_CORE_URL}/v1/plans/me`);
}

/** Resolves when the handshake of THIS page has been answered. For an instance that is never asked for a plan. */
async function handshake(page: Page): Promise<void> {
  await page.waitForResponse((response) => response.url() === `${E2E_CORE_URL}/health`);
}

/** Resolves when THIS page has asked for the plan, answered or not. For a read that never answers. */
async function planAsked(page: Page): Promise<void> {
  await page.waitForRequest(`${E2E_CORE_URL}/v1/plans/me`);
}

/**
 * A device past onboarding, signed in, and wherever the sign-in's own
 * navigation ended: the diary, or the plan page when the account is locked.
 *
 * @returns the pathname it landed on.
 */
async function signIn(page: Page): Promise<string> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|settings\/plan)$/);
  return new URL(page.url()).pathname;
}

/** Asserts the plan page is on screen, with the paywall heading and the plans to pick from. */
async function expectPaywall(page: Page, { heading, from }: { heading: string; from: string }): Promise<void> {
  await expect(page, `${from} did not end on the plan page`).toHaveURL(/\/settings\/plan$/, { timeout: 10_000 });
  await expect(page.locator('[data-slot="paywall-notice"] h2'), `${from}: the paywall heading`).toHaveText(heading);
  await expect(page.locator('[data-slot="plan-card"]'), `${from}: the plan choice`).toHaveCount(2);
}

/**
 * Asserts a screen stayed open: still at its address once the plan facts it
 * could have been locked by have arrived, and drawing its own title.
 */
async function expectOpen(
  page: Page,
  { path, title, anchor }: { path: string; title: string; anchor: Promise<void> },
): Promise<void> {
  await anchor;
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page, `${path} was sent away`).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}(\\/search)?$`));
  await expect(page, `${path}: its own title`).toHaveTitle(title);
}

/** Opens the settings hub and waits until the plan facts are held, so the next tap is decided from them. */
async function openHubWithFactsHeld(page: Page, anchorFor: (page: Page) => Promise<void> = planRead): Promise<void> {
  const anchor = anchorFor(page);
  await page.goto('/settings');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
  await anchor;
  await settleFrames(page);
}

for (const locked of LOCKED) {
  test(`${locked.name}: every feature screen sends the person to the plan page`, async ({ page }) => {
    test.setTimeout(WALK_BUDGET_MS);
    await routeManagedCore(page, locked.core);

    // ── The sign-in's own navigation, which waits for the first read ────
    expect(await signIn(page), 'the sign-in landed past the paywall').toBe('/settings/plan');
    await expectPaywall(page, { heading: locked.heading, from: 'the sign-in' });

    // ── A document load of each feature screen ──────────────────────────
    for (const screen of FEATURE_SCREENS) {
      await page.goto(screen.path);
      await expectPaywall(page, { heading: locked.heading, from: `a load of ${screen.path}` });
    }

    // ── A tap, decided from the facts already held ──────────────────────
    await openHubWithFactsHeld(page);
    await page.locator('main a[href="/settings/ai"]').first().click();
    await expectPaywall(page, { heading: locked.heading, from: 'a tap on the AI settings row' });
    await page.locator(`${BOTTOM_BAR} a[href="/diary"]`).click();
    await expectPaywall(page, { heading: locked.heading, from: 'a tap on the Diary tab' });
  });
}

for (const open of OPEN) {
  test(`${open.name}: the app stays open`, async ({ page }) => {
    test.setTimeout(WALK_BUDGET_MS);
    await routeManagedCore(page, open.core);
    const anchorFor = open.core.plans === false ? handshake : planRead;

    expect(await signIn(page), 'the sign-in was sent to the plan page').toBe('/diary');

    await page.goto('/dashboard');
    await expectOpen(page, { path: '/dashboard', title: COPY.meta.dashboard, anchor: anchorFor(page) });

    await openHubWithFactsHeld(page, anchorFor);
    await page.locator('main a[href="/settings/ai"]').first().click();
    await expect(page).toHaveURL(/\/settings\/ai$/);
    await expect(page).toHaveTitle(COPY.meta.ai);
  });
}

test('THE TWIN of the paywall walk: with free scans left, the same feature screens all open', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ trialScans: { granted: 10, left: 4 } }));
  expect(await signIn(page)).toBe('/diary');
  for (const screen of FEATURE_SCREENS) {
    const anchor = planRead(page);
    await page.goto(screen.path);
    await expectOpen(page, { ...screen, anchor });
  }
  await openHubWithFactsHeld(page);
  await page.locator(`${BOTTOM_BAR} a[href="/diary"]`).click();
  await expect(page).toHaveURL(/\/diary$/);
  await expect(page).toHaveTitle(COPY.meta.diary);
});

test('a plan read that fails opens the app, because unknown never locks', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core());
  // Registered after the stub, so it answers first.
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, (route) =>
    route.fulfill({ status: 500, json: { error: 'boom' } }),
  );

  expect(await signIn(page)).toBe('/diary');
  await page.goto('/dashboard');
  await expectOpen(page, { path: '/dashboard', title: COPY.meta.dashboard, anchor: planRead(page) });
});

test('a plan read that never answers opens the app after a short wait', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core());
  // Never fulfilled: the request hangs for the rest of the test.
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, () => undefined);

  expect(await signIn(page)).toBe('/diary');
  const asked = planAsked(page);
  await page.goto('/dashboard');
  await expectOpen(page, { path: '/dashboard', title: COPY.meta.dashboard, anchor: asked });
});

test('while locked, the export, the account page and the visit switch stay open and work', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core());
  expect(await signIn(page)).toBe('/settings/plan');

  // THE CONTROL: this session is locked, so the pages below are open because
  // they are exempt, not because the gate is asleep.
  await page.goto('/dashboard');
  await expectPaywall(page, {
    heading: fill(COPY.paywall.heading.scansUsed_other, { count: '10' }),
    from: 'the control load',
  });

  // ── The export, which produces a file ───────────────────────────────
  let anchor = planRead(page);
  await page.goto('/settings/data');
  await anchor;
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page).toHaveURL(/\/settings\/data$/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: COPY.settings.data.downloadJson, exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);

  // ── The account page: delete, and sign out ──────────────────────────
  anchor = planRead(page);
  await page.goto('/settings/account');
  await anchor;
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('button', { name: COPY.account.delete.cta, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.account.signOut.cta, exact: true })).toBeVisible();

  // ── Preferences: the "Count my visits" objection switch ─────────────
  anchor = planRead(page);
  await page.goto('/settings/preferences');
  await anchor;
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(page.getByRole('switch', { name: COPY.preferences.analytics.label })).toBeVisible();

  // ── The hub, and a tap from it onto an exempt page ──────────────────
  await openHubWithFactsHeld(page);
  await expect(page).toHaveURL(/\/settings$/);
  await page.locator('main a[href="/settings/data"]').first().click();
  await expect(page).toHaveURL(/\/settings\/data$/);
});

/** Mints an invite on the fake service for a new address. */
async function mintInvite(email: string): Promise<string> {
  const response = await fetch(`${E2E_CORE_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

test('a new account that has not onboarded can open the plan page, and nothing else', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ trialScans: { granted: 10, left: 10 } }));
  const token = await mintInvite(`paywall-${Date.now()}@example.invalid`);
  await page.goto(`/join#server=${encodeURIComponent(E2E_CORE_URL)}&invite=${token}`);
  const passwords = page.locator('main input[type="password"]');
  await expect(passwords.first()).toBeVisible({ timeout: 10_000 });
  await passwords.nth(0).fill('seventeen orange lanterns drifting home');
  await passwords.nth(1).fill('seventeen orange lanterns drifting home');
  await page.locator('main form button[type="submit"]').last().click();
  await page.waitForURL(/\/(onboarding|diary|settings\/plan)/, { timeout: 60_000 });

  await page.goto('/settings/plan');
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2, { timeout: 10_000 });
  await expect(page).toHaveURL(/\/settings\/plan$/);

  // THE CONTROL: onboarding still holds everywhere else.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });
});
