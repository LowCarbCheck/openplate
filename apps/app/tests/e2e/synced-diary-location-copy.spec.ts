/**
 * A synced diary is never said to "stay on this device" (M265 follow-up).
 *
 * THE DEFECT. Several sentences told a person that their profile, or the
 * diary itself, "stays on this device" (or "stays local, always").
 * That is true for a person with no account on an open instance. It is false
 * for anyone signed in to a sync server: the account keeps an encrypted copy
 * there, and the operator holds a backup key that can open it (the privacy
 * notice of app.openplate.de, section 3). On a managed instance every person
 * has an account, so the onboarding profile step said the false thing to
 * everybody who used it.
 *
 * WHAT IS CHECKED, and on which instance:
 *
 *  1. The managed landing, logged out, with visit counting on: the counting
 *     card is chosen by the INSTANCE and never says the diary stays here.
 *  2. The managed onboarding (its first screen, the profile step and the
 *     first-food step) and the managed profile settings, signed in.
 *  3. The same screens on an open instance, signed in to its sync server: the
 *     only place the AI connection note is drawn at all.
 *  4. THE CONTROL: the same screens on the open instance with no account, where
 *     the device sentence is true and must still be shown. It is what proves
 *     each absence above is an absence of a sentence the query can see.
 *
 * WHAT IS REAL: both production servers, the sign-in against the tier's fake
 * sync service, every screen and its loader. WHAT IS STUBBED: the managed
 * `/health` and account facts (`managed-core-stub.ts`), and the account's
 * encrypted diary blob. The blob is kept in this page instead of on the fake
 * service, so a sign-in lands on the questionnaire whatever other specs pushed
 * for the shared fixture account, and nothing this spec pushes reaches them.
 *
 * Every sentence is read from the shipped English catalog by key, never
 * transcribed here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_MATOMO_URL, E2E_SYNC_SERVER_URL } from './env';
import { installShiftObserver, readShiftEntries, settleFrames, shiftScoreAfter } from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/**
 * How long a signed-in walk may take. Above the tier's 30 s because every
 * assertion in it is soft: on a build that still says the false sentences,
 * each one waits out its own timeout, and the walk must reach the last screen
 * to name them all.
 */
const SOFT_WALK_BUDGET_MS = 90_000;

/** The sentences this spec reads, parsed from the shipped English bundle so a missing key fails on load. */
const COPY = z
  .object({
    landing: z.object({
      hero: z.object({ taglineManaged: z.string() }),
      features: z.object({
        noTracking: z.object({ bodyAnalytics: z.string(), bodyAnalyticsManaged: z.string() }),
      }),
    }),
    bodyMetrics: z.object({
      card: z.object({ title: z.string(), description: z.string(), descriptionSynced: z.string() }),
    }),
    onboarding: z.object({
      localFirst: z.string(),
      step: z.object({ body: z.object({ description: z.string(), descriptionSynced: z.string() }) }),
      firstFood: z.object({ keyNote: z.string(), keyNoteSynced: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The first screen's trust note as the page renders it: `<Trans>` draws the emphasis as an element, not as text. */
const LOCAL_FIRST_TEXT = COPY.onboarding.localFirst.replaceAll(/<\/?strong>/g, '');

/**
 * The claim itself, as every false sentence phrased it. The AI connection note
 * is checked by its key instead: the connection really does stay on the
 * device, and only the "just like your diary" half of that note was false.
 */
const DEVICE_CLAIM = /\bstays? on this device\b/i;

/** The four sentences that are true only without an account, as the page draws them. */
const DEVICE_ONLY_SENTENCES = {
  firstScreen: LOCAL_FIRST_TEXT,
  profileStep: COPY.onboarding.step.body.description,
  aiConnection: COPY.onboarding.firstFood.keyNote,
  profileSettings: COPY.bodyMetrics.card.description,
} as const;

/**
 * Records which of the device-only sentences this document draws, even for a
 * single frame.
 *
 * A retrying `not.toContainText` passes as soon as a sentence is gone, so a
 * false sentence drawn first and swapped a moment later (when a session
 * resumes, say) would pass it. An observer installed before the first script
 * sees the swap.
 */
async function recordDeviceOnlySentences(page: Page): Promise<void> {
  // Serialised into the page, so its helper cannot live outside it.
  // oxlint-disable unicorn/consistent-function-scoping
  await page.addInitScript((sentences: readonly string[]) => {
    const drawn = new Set<string>();
    Object.defineProperty(window, '__drawnDeviceOnlySentences', { value: drawn });
    const read = (): void => {
      const text = document.body?.textContent ?? '';
      for (const sentence of sentences) if (text.includes(sentence)) drawn.add(sentence);
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, characterData: true });
  }, Object.values(DEVICE_ONLY_SENTENCES));
  // oxlint-enable unicorn/consistent-function-scoping
}

/** The device-only sentences this document has drawn so far, in no particular order. */
async function drawnDeviceOnlySentences(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__drawnDeviceOnlySentences')?.value;
    return recorded instanceof Set ? [...recorded].map(String) : [];
  });
}

/** A managed core that asks for no consent and sells nothing, so sign-in goes straight to the questionnaire. */
const PLAIN_MANAGED_CORE: ManagedCoreStub = {
  trialScans: null,
  allowanceExpiresAt: null,
  dailyAiLimit: 20,
  invitesLeft: 0,
  memberInvites: false,
  planView: NO_SUBSCRIPTION_VIEW,
  plans: false,
};

/** The blob `GET` answer, `PROTOCOL.md` §5.2. */
interface HeldBlob {
  blobVersion: number;
  envelopeVersion: number;
  ciphertext: string;
  createdAt: string;
}

/** The blob `POST` body, `PROTOCOL.md` §5.1. */
const pushBodySchema = z.looseObject({
  baseVersion: z.number().int(),
  envelopeVersion: z.number().int(),
  ciphertext: z.string(),
});

/**
 * Keeps the account's encrypted diary in this page: a first pull finds none,
 * and every later pull finds what this device last pushed.
 *
 * The preflight still goes to the fake service, which answers it for every
 * path; only the two blob calls are answered here.
 */
async function holdTheBlobInThePage(page: Page): Promise<void> {
  let held: HeldBlob | null = null;
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/sync/blob`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const cors = { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' };
    if (request.method() === 'GET') {
      if (held === null) return route.fulfill({ status: 404, headers: cors, json: { error: 'not found' } });
      return route.fulfill({ status: 200, headers: cors, json: held });
    }
    const push = pushBodySchema.parse(request.postDataJSON());
    const currentVersion = held?.blobVersion ?? 0;
    if (push.baseVersion !== currentVersion) {
      return route.fulfill({ status: 409, headers: cors, json: { currentVersion } });
    }
    held = {
      blobVersion: currentVersion + 1,
      envelopeVersion: push.envelopeVersion,
      ciphertext: push.ciphertext,
      createdAt: new Date().toISOString(),
    };
    return route.fulfill({ status: 200, headers: cors, json: { newVersion: held.blobVersion } });
  });
}

/** Signs the fixture account in at `baseUrl`, which lands on the questionnaire because the held blob is empty. */
async function signInToAnEmptyDiary(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/sign-in`);
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/onboarding/);
}

/** Opens the questionnaire on a device with no account, the way a first visit does. */
async function startWithoutAnAccount(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();
  await page.waitForURL(/\/onboarding/);
}

/** The onboarding card whose title is `title`. */
function stepCard(page: Page, title: string): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });
}

/** Answers the style step, skips the weight step, and returns the profile step's card. */
async function walkToTheProfileStep(page: Page): Promise<Locator> {
  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  const card = stepCard(page, EN.onboarding.step.body.title);
  await expect(card).toBeVisible();
  return card;
}

/** Skips the profile step and returns the first-food step's card. */
async function walkToTheFirstFoodStep(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  const card = stepCard(page, EN.onboarding.step.firstFood.title);
  await expect(card).toBeVisible();
  return card;
}

/** Leaves the questionnaire for the diary. */
async function leaveForTheDiary(page: Page): Promise<void> {
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();
  await page.waitForURL(/\/diary$/);
}

/** Opens the profile settings with a fresh document and returns the "About you" section. */
async function openProfileSettings(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(`${baseUrl}/settings/profile`);
  const section = page
    .locator('main section')
    .filter({ has: page.getByText(COPY.bodyMetrics.card.title, { exact: true }) });
  await expect(section).toBeVisible();
  return section;
}

test.describe('on a managed instance', () => {
  let server: ManagedAppServer;

  test.beforeAll(async () => {
    test.setTimeout(BOOT_BUDGET_MS);
    // VISIT COUNTING ON, as app.openplate.de runs it: without it the landing
    // draws the "nothing is counted" sentence, which makes no claim about
    // where the diary lives, and the card would prove nothing.
    server = await startManagedAppServer({ extraEnv: { MATOMO_URL: E2E_MATOMO_URL, MATOMO_SITE_ID: '1' } });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('the landing, logged out, never says the diary stays on this device', async ({ page }) => {
    await page.goto(`${server.url}/`);
    const main = page.locator('main');
    // A MANAGED `/` IS THE ACCOUNT DOOR since M266: it states no pitch, so the
    // trust card and its counting sentences are not on it at all. Its one
    // sentence about the instance is the anchor that the page is drawn before
    // the absences are read.
    await expect(main).toContainText(COPY.landing.hero.taglineManaged);
    await expect(main).not.toContainText(COPY.landing.features.noTracking.bodyAnalyticsManaged);
    await expect(main).not.toContainText(COPY.landing.features.noTracking.bodyAnalytics);
    await expect(main).not.toContainText(DEVICE_CLAIM);
  });

  test('a signed-in member is never told the profile or the diary stays on this device', async ({ page }) => {
    test.setTimeout(SOFT_WALK_BUDGET_MS);
    await recordDeviceOnlySentences(page);
    await routeManagedCore(page, PLAIN_MANAGED_CORE);
    await holdTheBlobInThePage(page);
    await signInToAnEmptyDiary(page, server.url);

    // SOFT, so one run names every screen that still says it, not only the first.
    await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
    await expect.soft(page.locator('body')).not.toContainText(LOCAL_FIRST_TEXT);

    const profileStep = await walkToTheProfileStep(page);
    await expect.soft(profileStep).toContainText(COPY.onboarding.step.body.descriptionSynced);
    await expect.soft(profileStep).not.toContainText(COPY.onboarding.step.body.description);
    await expect.soft(profileStep).not.toContainText(DEVICE_CLAIM);

    const firstFoodStep = await walkToTheFirstFoodStep(page);
    await expect.soft(firstFoodStep).not.toContainText(DEVICE_CLAIM);
    await leaveForTheDiary(page);
    expect.soft(await drawnDeviceOnlySentences(page), 'a device-only sentence was drawn in onboarding').toEqual([]);

    const aboutYou = await openProfileSettings(page, server.url);
    await expect.soft(aboutYou).toContainText(COPY.bodyMetrics.card.descriptionSynced);
    await expect.soft(aboutYou).not.toContainText(COPY.bodyMetrics.card.description);
    await expect.soft(aboutYou).not.toContainText(DEVICE_CLAIM);
    expect.soft(await drawnDeviceOnlySentences(page), 'a device-only sentence was drawn in settings').toEqual([]);
  });
});

test.describe('on an open instance', () => {
  test('a person signed in to sync is never told the profile or the diary stays on this device', async ({ page }) => {
    test.setTimeout(SOFT_WALK_BUDGET_MS);
    await recordDeviceOnlySentences(page);
    await installShiftObserver(page);
    await holdTheBlobInThePage(page);
    await signInToAnEmptyDiary(page, '');

    // SOFT, so one run names every screen that still says it, not only the first.
    await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
    await expect.soft(page.locator('body')).not.toContainText(LOCAL_FIRST_TEXT);

    const profileStep = await walkToTheProfileStep(page);
    await expect.soft(profileStep).toContainText(COPY.onboarding.step.body.descriptionSynced);
    await expect.soft(profileStep).not.toContainText(COPY.onboarding.step.body.description);
    await expect.soft(profileStep).not.toContainText(DEVICE_CLAIM);

    const firstFoodStep = await walkToTheFirstFoodStep(page);
    await expect.soft(firstFoodStep).toContainText(COPY.onboarding.firstFood.keyNoteSynced);
    await expect.soft(firstFoodStep).not.toContainText(COPY.onboarding.firstFood.keyNote);
    await leaveForTheDiary(page);
    expect.soft(await drawnDeviceOnlySentences(page), 'a device-only sentence was drawn in onboarding').toEqual([]);

    // THE LATE EVENT is the session resuming under `_personal` and pulling the
    // diary. A sentence read off that live session would swap after it.
    const pulled = page.waitForResponse(
      (response) => response.url().endsWith('/v1/sync/blob') && response.request().method() === 'GET',
    );
    const aboutYou = await openProfileSettings(page, '');
    const shiftsBefore = (await readShiftEntries(page)).length;
    await pulled;
    await settleFrames(page);
    await expect.soft(aboutYou).toContainText(COPY.bodyMetrics.card.descriptionSynced);
    await expect.soft(aboutYou).not.toContainText(COPY.bodyMetrics.card.description);
    await expect.soft(aboutYou).not.toContainText(DEVICE_CLAIM);
    expect.soft(await drawnDeviceOnlySentences(page), 'a device-only sentence was drawn in settings').toEqual([]);
    expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'the page moved after the pull').toBe(0);

    // CONTROL for the zero: a description that grows after the first paint is
    // a shift this observer sees.
    await aboutYou
      .locator('p')
      .first()
      .evaluate((description) => {
        description.append(` ${description.textContent ?? ''}`);
      });
    await settleFrames(page);
    expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore)).toBeGreaterThan(0);
  });

  test('CONTROL: with no account, the landing and the profile screens still say it stays on this device', async ({
    page,
  }) => {
    await page.goto('/');
    const main = page.locator('main');
    await expect(main).toContainText(COPY.landing.features.noTracking.bodyAnalytics);
    await expect(main).toContainText(DEVICE_CLAIM);

    await recordDeviceOnlySentences(page);
    await startWithoutAnAccount(page);
    await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
    await expect(page.locator('body')).toContainText(LOCAL_FIRST_TEXT);

    const profileStep = await walkToTheProfileStep(page);
    await expect(profileStep).toContainText(COPY.onboarding.step.body.description);
    await expect(profileStep).toContainText(DEVICE_CLAIM);

    const firstFoodStep = await walkToTheFirstFoodStep(page);
    await expect(firstFoodStep).toContainText(COPY.onboarding.firstFood.keyNote);
    await leaveForTheDiary(page);
    // The recorder sees each true sentence, so its empty answer above is an absence.
    expect((await drawnDeviceOnlySentences(page)).toSorted()).toEqual(
      [
        DEVICE_ONLY_SENTENCES.firstScreen,
        DEVICE_ONLY_SENTENCES.profileStep,
        DEVICE_ONLY_SENTENCES.aiConnection,
      ].toSorted(),
    );

    const aboutYou = await openProfileSettings(page, '');
    await expect(aboutYou).toContainText(COPY.bodyMetrics.card.description);
    await expect(aboutYou).toContainText(DEVICE_CLAIM);
    expect(await drawnDeviceOnlySentences(page)).toEqual([DEVICE_ONLY_SENTENCES.profileSettings]);
  });
});
