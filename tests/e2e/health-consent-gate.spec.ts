/**
 * An existing account that never agreed is asked once, before anything else
 * in the app (`PROTOCOL.md` §5.15, §5.15.1, owner decision 2026-09-28).
 *
 * THE REASON. The privacy notice of the hosted instances names Art. 9(2)(a)
 * GDPR, explicit consent, as the legal basis for the diary. Accounts created
 * before openplate-core asked carry `healthConsent: null`, so the app asks
 * them once, on a screen of its own, and records the answer with the core.
 *
 * WHAT IS REAL: the production build, the fake sync service's account and
 * session, the `_personal` layout's loader and its revalidation, the consent
 * screen, and every page visited. WHAT IS STUBBED (`managed-core-stub.ts`):
 * the handshake (the consent version, the plans), the consent route, the plan
 * reads, and the account facts on every auth answer.
 *
 * EVERY PROMPT HAS AN OPEN TWIN that differs in one stubbed fact only, so a
 * gate that asked everybody fails the twins, and a gate that asked nobody
 * fails the prompts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** Onboarding, a sign-in and a walk through several screens outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/** How long a screen that should stay open is watched after the facts that could move it have arrived. */
const OPEN_WATCH_MS = 1_200;

/** How long a press that must send nothing is watched. */
const SILENCE_WATCH_MS = 1_200;

/** The wording the stubbed instance asks consent to. */
const VERSION = '2026-09-28';

/** An instant for a consent on record. */
const AGREED_AT = '2026-09-04T10:11:12.000Z';

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({
    healthConsent: z.object({
      heading: z.string(),
      agree: z.string(),
      requiredToContinue: z.string(),
      exportDiary: z.string(),
      deleteAccount: z.string(),
    }),
    meta: z.object({ dashboard: z.string(), diary: z.string() }),
    settings: z.object({ data: z.object({ downloadJson: z.string() }) }),
    account: z.object({ signOut: z.object({ cta: z.string() }), delete: z.object({ cta: z.string() }) }),
    preferences: z.object({ analytics: z.object({ label: z.string() }) }),
    paywall: z.object({ heading: z.object({ scansUsed_other: z.string() }) }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

const consentBodySchema = z.object({ version: z.string() });

/**
 * The core's answers. The default is a member with free scans left, on an
 * instance that asks the current wording, with no consent on record.
 */
function core(overrides: Partial<ManagedCoreStub> = {}): ManagedCoreStub {
  return {
    trialScans: { granted: 10, left: 4 },
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    healthConsent: { version: VERSION },
    accountHealthConsent: null,
    ...overrides,
  };
}

/** Is this the consent POST, rather than its preflight? */
function isConsentPost(request: Request): boolean {
  return request.method() === 'POST' && request.url() === `${E2E_SYNC_SERVER_URL}/v1/auth/account/health-consent`;
}

/** Every consent body the page sends, in order. Registered before the first navigation. */
function recordConsentPosts(page: Page): { version: string }[] {
  const bodies: { version: string }[] = [];
  page.on('request', (request) => {
    if (isConsentPost(request)) bodies.push(consentBodySchema.parse(request.postDataJSON()));
  });
  return bodies;
}

/**
 * A device past onboarding, signed in, and wherever the sign-in's own
 * navigation ended.
 *
 * @returns the path and query it landed on.
 */
async function signIn(page: Page): Promise<string> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|settings\/plan|consent\?next=[^#]*)$/);
  const landed = new URL(page.url());
  return `${landed.pathname}${landed.search}`;
}

/** Resolves when the handshake of THIS page has been answered. The wait is registered on the call. */
async function handshake(page: Page): Promise<void> {
  await page.waitForResponse((response) => response.url() === `${E2E_SYNC_SERVER_URL}/health`);
}

/** Asserts the consent screen is up, asking for the given page next. */
async function expectConsentScreen(page: Page, { next, from }: { next: string; from: string }): Promise<void> {
  await expect(page, `${from} did not end on the consent screen`).toHaveURL(
    new RegExp(`/consent\\?next=${next.replaceAll('/', '\\/')}$`),
    { timeout: 10_000 },
  );
  await expect(page.getByRole('heading', { name: COPY.healthConsent.heading }), `${from}: the heading`).toBeVisible();
}

/** Asserts a screen stayed open once the handshake that could have moved it has been answered. */
async function expectOpen(
  page: Page,
  { path, title, anchor }: { path: string; title: string; anchor: Promise<void> },
): Promise<void> {
  await anchor;
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page, `${path} was sent away`).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
  await expect(page, `${path}: its own title`).toHaveTitle(title);
}

function consentBox(page: Page) {
  return page.locator('main [data-slot="health-consent-box"]');
}

function consentMessage(page: Page) {
  return page.locator('main [data-slot="health-consent-message"]');
}

function agreeButton(page: Page) {
  return page.getByRole('button', { name: COPY.healthConsent.agree, exact: true });
}

test('an account that never agreed is asked once, agrees, and is not asked again', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core();
  await routeManagedCore(page, stub);
  const posts = recordConsentPosts(page);

  // ── The sign-in's own navigation, which waits for the first read ────
  expect(await signIn(page)).toBe('/consent?next=/diary');

  // ── A document load of the home screen ──────────────────────────────
  await page.goto('/dashboard');
  await expectConsentScreen(page, { next: '/dashboard', from: 'a load of /dashboard' });
  await expect(page.getByRole('link', { name: COPY.healthConsent.exportDiary })).toHaveAttribute(
    'href',
    '/settings/data',
  );
  await expect(page.getByRole('link', { name: COPY.healthConsent.deleteAccount })).toHaveAttribute(
    'href',
    '/settings/account',
  );
  expect(posts, 'the screen agreed before anybody pressed anything').toEqual([]);

  // ── Agree and continue ─────────────────────────────────────────────
  await consentBox(page).check();
  await agreeButton(page).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page).toHaveTitle(COPY.meta.dashboard);
  expect(posts).toEqual([{ version: VERSION }]);
  expect(stub.accountHealthConsent?.version, 'the core recorded no consent').toBe(VERSION);

  // ── A reload reads the consent back and asks nothing ────────────────
  const anchor = handshake(page);
  await page.reload();
  await expectOpen(page, { path: '/dashboard', title: COPY.meta.dashboard, anchor });
  expect(posts).toHaveLength(1);
});

test('the twin: an account that agreed to the current wording is not asked', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ accountHealthConsent: { version: VERSION, at: AGREED_AT } }));
  expect(await signIn(page)).toBe('/diary');
  const anchor = handshake(page);
  await page.goto('/dashboard');
  await expectOpen(page, { path: '/dashboard', title: COPY.meta.dashboard, anchor });
});

test('an account that agreed to an older wording is asked again', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ accountHealthConsent: { version: '2026-01-01', at: AGREED_AT } }));
  expect(await signIn(page)).toBe('/consent?next=/diary');
});

test('the twin: an instance that asks for no consent asks nobody', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ healthConsent: null }));
  expect(await signIn(page)).toBe('/diary');
  const anchor = handshake(page);
  await page.goto('/dashboard');
  await expectOpen(page, { path: '/dashboard', title: COPY.meta.dashboard, anchor });
});

test('an administrator is asked too', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ role: 'admin' }));
  expect(await signIn(page)).toBe('/consent?next=/diary');
  await page.goto('/admin');
  await expectConsentScreen(page, { next: '/admin', from: 'a load of /admin' });
});

test('while not agreed, the export works and the account page offers delete and sign out', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core());
  expect(await signIn(page)).toBe('/consent?next=/diary');

  // THE CONTROL: this session is asked, so the pages below are open because
  // they are exempt, not because the gate is asleep.
  await page.goto('/dashboard');
  await expectConsentScreen(page, { next: '/dashboard', from: 'the control load' });

  // ── The export, which produces a file ───────────────────────────────
  let anchor = handshake(page);
  await page.goto('/settings/data');
  await anchor;
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page).toHaveURL(/\/settings\/data$/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: COPY.settings.data.downloadJson, exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);

  // ── The account page: delete, and sign out ──────────────────────────
  anchor = handshake(page);
  await page.goto('/settings/account');
  await anchor;
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('button', { name: COPY.account.delete.cta, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.account.signOut.cta, exact: true })).toBeVisible();
});

test('while not agreed, the visit-counting switch the privacy notice links to opens directly', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core());
  expect(await signIn(page)).toBe('/consent?next=/diary');

  // THE CONTROL: this session is asked, so preferences is open because it is
  // exempt, not because the gate is asleep.
  await page.goto('/dashboard');
  await expectConsentScreen(page, { next: '/dashboard', from: 'the control load' });

  // The address privacy notice section 13 links: an objection to visit
  // counting (Art. 21) never waits on a consent to health data (Art. 9).
  const anchor = handshake(page);
  await page.goto('/settings/preferences#visit-counting');
  await anchor;
  await settleFrames(page);
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page).toHaveURL(/\/settings\/preferences#visit-counting$/);
  await expect(page.getByRole('switch', { name: COPY.preferences.analytics.label })).toBeVisible();
});

test('the consent screen comes before the plan page for an account whose free scans are used up', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, core({ trialScans: { granted: 10, left: 0 } }));
  expect(await signIn(page), 'the plan page came before the consent').toBe('/consent?next=/diary');

  await consentBox(page).check();
  await agreeButton(page).click();
  await expect(page).toHaveURL(/\/settings\/plan$/, { timeout: 10_000 });
  await expect(page.locator('[data-slot="paywall-notice"] h2')).toHaveText(
    fill(COPY.paywall.heading.scansUsed_other, { count: '10' }),
  );
});

test('the twin: the same locked account with consent on record goes straight to the plan page', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(
    page,
    core({ trialScans: { granted: 10, left: 0 }, accountHealthConsent: { version: VERSION, at: AGREED_AT } }),
  );
  expect(await signIn(page)).toBe('/settings/plan');
});

test('an unticked box on the consent screen says so, sends nothing, and moves nothing', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await installShiftObserver(page);
  await routeManagedCore(page, core());
  const posts = recordConsentPosts(page);
  expect(await signIn(page)).toBe('/consent?next=/diary');

  await expect(consentBox(page)).not.toBeChecked();
  await expect(consentMessage(page)).toHaveCount(1);
  await expect(consentMessage(page)).toBeHidden();
  await settleAnimations(page);
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;

  await agreeButton(page).click();
  await expect(consentMessage(page)).toBeVisible();
  await expect(consentMessage(page)).toHaveText(COPY.healthConsent.requiredToContinue);
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved when the message appeared').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), since), 'layout-shift as the message appeared').toBe(0);
  await page.waitForTimeout(SILENCE_WATCH_MS);
  expect(posts, 'an unticked box sent a consent').toEqual([]);
  await expect(page).toHaveURL(/\/consent\?next=\/diary$/);

  // THE CONTROL: a line that does grow above the button is seen by both readings.
  const beforeControl = (await readShiftEntries(page)).length;
  const topsBeforeControl = await readTops(page);
  await consentMessage(page).evaluate((node) => {
    const grown = document.createElement('p');
    grown.textContent = 'control line';
    grown.style.height = '40px';
    node.before(grown);
  });
  await settleFrames(page);
  expect(movedBetween(topsBeforeControl, await readTops(page)).length).toBeGreaterThan(0);
  await expect.poll(async () => shiftScoreAfter(await readShiftEntries(page), beforeControl)).toBeGreaterThan(0);
});
