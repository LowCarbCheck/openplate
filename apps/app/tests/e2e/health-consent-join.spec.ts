/**
 * `/join` asks for explicit consent to health data on an instance that asks
 * for it (`PROTOCOL.md` §5.6, §5.8, owner decision 2026-09-28).
 *
 * THE REASON. The privacy notice of the hosted instances names Art. 9(2)(a)
 * GDPR, explicit consent, as the legal basis for the diary, because the
 * operator holds a recovery key that can open it. openplate-core refuses an
 * account without the consent (`400 health-consent-required`) and records the
 * version the person agreed to. Before this change the join form had no box,
 * so every account creation on such an instance failed.
 *
 * WHAT IS REAL: the production build, the join page, the invite lookup and the
 * account ceremony against the fake sync service, and the account it creates.
 * WHAT IS STUBBED (`managed-core-stub.ts`): the handshake, which is where the
 * instance names the consent version, and in one test the signup answer.
 *
 * Every presence has a control that finds it absent through the same query,
 * and the "moves nothing" reading has a control that moves something and sees
 * it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { E2E_SYNC_SERVER_URL } from './env';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { HEALTH_CONSENT_REQUIRED, routeManagedCore, trialAccountStub, type ManagedCoreStub } from './managed-core-stub';

test.use({ serviceWorkers: 'block' });

/** An account ceremony runs Argon2id at production cost, twice in one test below. */
const CEREMONY_BUDGET_MS = 120_000;

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** The wording the stubbed instance asks consent to. */
const VERSION = '2026-09-28';

/** A later wording, for the instance that changes it while the page is open. */
const NEXT_VERSION = '2026-10-01';

/**
 * How long a press that must send nothing is watched. A valid press swaps the
 * form for the working line at once and posts within the key derivation, so a
 * request that was going to leave has left by then.
 */
const SILENCE_WATCH_MS = 1_500;

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({ healthConsent: z.object({ requiredToCreate: z.string() }) })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

/** The part of a signup body this file reads. The rest is key material nobody here looks at. */
const signupBodySchema = z.looseObject({ healthConsent: z.object({ version: z.string() }).optional() });

type SignupBody = z.infer<typeof signupBodySchema>;

/** Mints an invite on the fake service for a new address. */
async function mintInvite(): Promise<string> {
  const email = `consent-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.invalid`;
  const response = await fetch(`${E2E_SYNC_SERVER_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

/** A trial account with scans left, on an instance that asks the given consent, or none. */
function consentCore(healthConsent: ManagedCoreStub['healthConsent']): ManagedCoreStub {
  const stub = trialAccountStub(10);
  if (healthConsent !== undefined) stub.healthConsent = healthConsent;
  return stub;
}

/** Is this the signup POST, rather than its preflight or another auth call? */
function isSignup(request: Request): boolean {
  return request.method() === 'POST' && request.url() === `${E2E_SYNC_SERVER_URL}/v1/auth/signup`;
}

/** Every signup body the page sends, in order. Registered before the first navigation. */
function recordSignups(page: Page): SignupBody[] {
  const bodies: SignupBody[] = [];
  page.on('request', (request) => {
    if (isSignup(request)) bodies.push(signupBodySchema.parse(request.postDataJSON()));
  });
  return bodies;
}

/** Opens a fresh join link and types the password twice. The box, when there is one, is left alone. */
async function openJoinForm(page: Page): Promise<void> {
  await page.goto(`/join#server=${encodeURIComponent(E2E_SYNC_SERVER_URL)}&invite=${await mintInvite()}`);
  const passwords = page.locator('main input[type="password"]');
  await expect(passwords.first()).toBeVisible({ timeout: 15_000 });
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
}

function consentBox(page: Page) {
  return page.locator('main [data-slot="health-consent-box"]');
}

function consentMessage(page: Page) {
  return page.locator('main [data-slot="health-consent-message"]');
}

function createButton(page: Page) {
  return page.locator('main form button[type="submit"]').last();
}

test('on a consent instance, an unticked box stops the create and sends nothing; ticked, the version is sent', async ({
  page,
}) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await installShiftObserver(page);
  await routeManagedCore(page, consentCore({ version: VERSION }));
  const bodies = recordSignups(page);
  await openJoinForm(page);

  await expect(consentBox(page)).toBeVisible();
  await expect(consentBox(page)).not.toBeChecked();
  // RESERVED FROM THE FIRST PAINT: the line is in the page and holds its box,
  // but shows nothing until it has something to say.
  await expect(consentMessage(page)).toHaveCount(1);
  await expect(consentMessage(page)).toBeHidden();

  // IN VIEW BEFORE THE BASELINE. At a phone's height the box and the button
  // sit below the fold, and the browser only reports a layout shift inside
  // the viewport. The press scrolls there anyway; doing it first keeps the
  // scroll out of the reading and the reading about what a person sees.
  await createButton(page).scrollIntoViewIfNeeded();
  await settleAnimations(page);
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;

  // ── Unticked: the message, and no request ─────────────────────────────
  await createButton(page).click();
  await expect(consentMessage(page)).toBeVisible();
  await expect(consentMessage(page)).toHaveText(COPY.healthConsent.requiredToCreate);
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved when the message appeared').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), since), 'layout-shift as the message appeared').toBe(0);
  await page.waitForTimeout(SILENCE_WATCH_MS);
  expect(bodies, 'an unticked box sent a signup').toEqual([]);
  // Still the form, never the working line a valid press shows at once.
  await expect(createButton(page)).toBeVisible();

  // ── Ticked: the message goes, and the request carries the version ─────
  await consentBox(page).check();
  await expect(consentMessage(page)).toBeHidden();
  const signup = page.waitForRequest(isSignup);
  await createButton(page).click();
  expect(signupBodySchema.parse((await signup).postDataJSON()).healthConsent).toEqual({ version: VERSION });
  await page.waitForURL('**/onboarding', { timeout: 60_000 });
  expect(bodies).toHaveLength(1);
});

test('the control: an instance that asks for no consent draws no box, and the request carries no consent', async ({
  page,
}) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  // THE KEY LEFT OUT, as a core older than the field sends it.
  await routeManagedCore(page, consentCore(undefined));
  recordSignups(page);
  await openJoinForm(page);

  await expect(createButton(page)).toBeVisible();
  await expect(consentBox(page)).toHaveCount(0);
  await expect(consentMessage(page)).toHaveCount(0);

  const signup = page.waitForRequest(isSignup);
  await createButton(page).click();
  expect(Object.hasOwn(signupBodySchema.parse((await signup).postDataJSON()), 'healthConsent')).toBe(false);
  await page.waitForURL('**/onboarding', { timeout: 60_000 });
});

test('a refused consent (the wording changed while the page was open) asks again with the new version', async ({
  page,
}) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  const core = consentCore({ version: VERSION });
  await routeManagedCore(page, core);
  const bodies = recordSignups(page);
  let isRefused = false;
  // REGISTERED AFTER the stub, so it answers first. The first signup is
  // refused the way the core refuses it after the operator changed
  // `HEALTH_CONSENT_VERSION`; the handshake says so from then on.
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/auth/signup`, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || isRefused) return route.fallback();
    isRefused = true;
    core.healthConsent = { version: NEXT_VERSION };
    return route.fulfill({
      status: 400,
      headers: { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' },
      json: { error: HEALTH_CONSENT_REQUIRED },
    });
  });
  await openJoinForm(page);

  await consentBox(page).check();
  const reread = page.waitForRequest(
    (request) => isRefused && request.url() === `${E2E_SYNC_SERVER_URL}/health` && request.method() === 'GET',
  );
  await createButton(page).click();
  await reread;

  // THE BOX AGAIN, unticked, with the message under it.
  await expect(consentBox(page)).toBeVisible({ timeout: 30_000 });
  await expect(consentBox(page)).not.toBeChecked();
  await expect(consentMessage(page)).toBeVisible();
  await expect(consentMessage(page)).toHaveText(COPY.healthConsent.requiredToCreate);
  expect(bodies.map((body) => body.healthConsent)).toEqual([{ version: VERSION }]);

  // The passwords were kept, so ticking the box is all that is left to do.
  await consentBox(page).check();
  const signup = page.waitForRequest(isSignup);
  await createButton(page).click();
  expect(signupBodySchema.parse((await signup).postDataJSON()).healthConsent).toEqual({ version: NEXT_VERSION });
  await page.waitForURL('**/onboarding', { timeout: 60_000 });
});

test('the control for the layout reading: a line that does grow above the button is seen by both readings', async ({
  page,
}) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await installShiftObserver(page);
  await routeManagedCore(page, consentCore({ version: VERSION }));
  await openJoinForm(page);
  await expect(consentBox(page)).toBeVisible();
  // The same viewport the reading above measures in: the button in view.
  await createButton(page).scrollIntoViewIfNeeded();
  await settleAnimations(page);
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;

  await consentMessage(page).evaluate((node) => {
    const grown = document.createElement('p');
    grown.textContent = 'control line';
    grown.style.height = '40px';
    node.before(grown);
  });
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)).length).toBeGreaterThan(0);
  await expect.poll(async () => shiftScoreAfter(await readShiftEntries(page), since)).toBeGreaterThan(0);
});
