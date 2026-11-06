/**
 * The reminder-email box on `/join` (2026-11).
 *
 * WHAT THE PRODUCT RULE IS. An instance that sends reminder emails
 * (`instance.activityMail: true` on the handshake) offers ONE checkbox on the
 * sign-up form, UNTICKED, never pre-ticked: consent to marketing-adjacent mail
 * has to be an act. An instance that says `false`, or says nothing, shows no
 * box at all and the signup body carries no trace of the feature.
 *
 * WHAT IS REAL: the production build booted as a managed instance, `/join`,
 * the account ceremony and the signup request it makes, against the tier's
 * fake core server. WHAT IS STUBBED (`managed-core-stub.ts`): the handshake's
 * `activityMail` flag, and the recording of what `POST /v1/auth/signup`
 * carried. The sign-up e-mail is not walked: the fake service mints the invite
 * the letter would carry, as `first-run-scan-door.spec.ts` does.
 *
 * THE CONTROLS. Every "no box" is read through the same selector that finds the
 * box on the instance that offers one. Every "sent false" sits next to a
 * "sent true" that came from the same form, so a form that always sent one or
 * the other would fail a case. The layout case reads the tops before and after
 * a tick, and a tick that grew the form would move the button.
 *
 * @area accounts-and-sign-in
 */
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { EN } from './copy';
import { E2E_CORE_URL } from './env';
import { useLanguage } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { routeManagedCore, type ActivityMailWrite, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** An account ceremony runs Argon2id at production cost. */
const CEREMONY_BUDGET_MS = 120_000;

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** The reminder box, found by the slot the component carries. */
const BOX = '[data-slot="activity-mail-box"]';

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A core on an open-signup instance, with the reminder flag as the case names it. */
function coreStub(options: { activityMail: boolean | undefined }): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: 0,
    invitesLeft: 0,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: false,
    activityMail: options.activityMail,
    activityMailWrites: [],
  };
}

/** Mints an invite on the fake service for a new address. */
async function mintInvite(): Promise<string> {
  const email = `join-mail-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  const response = await fetch(`${E2E_CORE_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

/** Opens `/join` with a fresh invite and waits for the form. */
async function openJoin(page: Page): Promise<void> {
  const token = await mintInvite();
  await page.goto(`${server.url}/join#server=${encodeURIComponent(E2E_CORE_URL)}&invite=${token}`);
  await expect(page.locator('main input[type="password"]').first()).toBeVisible({ timeout: 10_000 });
}

/** Fills the two password boxes and submits. */
async function submitJoin(page: Page): Promise<void> {
  const passwords = page.locator('main input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('main form button[type="submit"]').last().click();
  await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
}

/** The one signup write, or a failure that says what was recorded instead. */
function theSignup(stub: ManagedCoreStub): ActivityMailWrite {
  const writes = stub.activityMailWrites ?? [];
  const [signup] = writes;
  if (writes.length !== 1 || signup === undefined)
    throw new Error(`expected one signup write, saw ${JSON.stringify(writes)}`);
  return signup;
}

test('an instance that offers reminders shows one box, unticked, with its hint', async ({ page }) => {
  const stub = coreStub({ activityMail: true });
  await routeManagedCore(page, stub);
  await openJoin(page);

  const box = page.locator(BOX);
  await expect(box).toHaveCount(1);
  await expect(box).toBeVisible();
  await expect(box, 'the box must never start ticked').not.toBeChecked();
  await expect(page.getByLabel(EN.activityMail.signup.label)).toHaveCount(1);
  await expect(page.getByText(EN.activityMail.signup.hint)).toBeVisible();
});

test('control: an instance that says false shows no box and no hint', async ({ page }) => {
  const stub = coreStub({ activityMail: false });
  await routeManagedCore(page, stub);
  await openJoin(page);

  await expect(page.locator('main form')).toBeVisible();
  await expect(page.locator(BOX)).toHaveCount(0);
  await expect(page.locator('[data-slot="activity-mail"]')).toHaveCount(0);
  await expect(page.getByText(EN.activityMail.signup.hint)).toHaveCount(0);
});

test('control: a core older than the field, which sends no key, shows no box either', async ({ page }) => {
  const stub = coreStub({ activityMail: undefined });
  await routeManagedCore(page, stub);
  await openJoin(page);

  await expect(page.locator('main form')).toBeVisible();
  await expect(page.locator(BOX)).toHaveCount(0);
});

test('ticking the box sends activityMail true and the UI language', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  const stub = coreStub({ activityMail: true });
  await routeManagedCore(page, stub);
  await openJoin(page);

  await page.locator(BOX).check();
  await submitJoin(page);

  const signup = theSignup(stub);
  expect(signup.activityMail).toBe(true);
  expect(signup.language).toBe('en');
});

test('leaving the box alone sends no true, and still names the language', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  const stub = coreStub({ activityMail: true });
  await routeManagedCore(page, stub);
  await openJoin(page);

  await expect(page.locator(BOX)).not.toBeChecked();
  await submitJoin(page);

  const signup = theSignup(stub);
  expect(signup.activityMail, 'an untouched box must not opt anybody in').toBe(false);
  expect(signup.language).toBe('en');
});

test('the language sent is the one the form is drawn in', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  const german = SUPPORTED_LANGUAGES.find((code) => code === 'de');
  if (german === undefined) throw new Error('the app no longer ships German');
  const stub = coreStub({ activityMail: true });
  await routeManagedCore(page, stub);
  await useLanguage(page, german);
  await openJoin(page);

  await page.locator(BOX).check();
  await submitJoin(page);

  expect(theSignup(stub).language).toBe('de');
});

test('control: an instance that offers nothing gets a signup body with no reminder keys', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  const stub = coreStub({ activityMail: false });
  await routeManagedCore(page, stub);
  await openJoin(page);
  await submitJoin(page);

  const signup = theSignup(stub);
  expect(signup.activityMail, 'a body for an instance without reminders carried activityMail').toBeUndefined();
  expect(signup.language).toBeUndefined();
});

test('ticking the box moves nothing on the form', async ({ page }) => {
  const stub = coreStub({ activityMail: true });
  await installShiftObserver(page);
  await routeManagedCore(page, stub);
  await openJoin(page);
  await settleFrames(page);

  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  expect(Object.keys(topsBefore).length, 'the reading found nothing to compare').toBeGreaterThan(3);

  await page.locator(BOX).check();
  await settleFrames(page);

  expect(movedBetween(topsBefore, await readTops(page))).toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore)).toBe(0);
});
