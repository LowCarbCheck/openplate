/**
 * The first run of a fresh open-signup account reaches a working scan door.
 *
 * THE REPORT. On app.openplate.de (a managed instance, open sign-up, a weekly
 * free grant of 10 scans) 11 of about 17 people who finished onboarding never
 * made an AI scan. Matomo shows 7 of 17 going straight from onboarding to
 * `/add/photo`, and that page almost always went back to `/diary` with no scan.
 *
 * THE ACCOUNT, AS PRODUCTION SENDS IT. The account row holds `daily_ai_limit =
 * 0` and `free_daily_ai_limit = 0`, and the core's account view reports the
 * instance default: `dailyAiLimit: 0`, `freeDailyAiLimit: 10`,
 * `freeAiLimitPeriod: 'week'`. `productionAccountStub` writes exactly that.
 *
 * WHAT IS REAL: the production build booted as a managed instance, the join
 * page and its account ceremony, the onboarding wizard, `/diary`, `/add/photo`
 * and the capture hook, against the tier's fake core server. WHAT IS STUBBED
 * (`managed-core-stub.ts`): the handshake and the account fields above, and in
 * the last case the AI proxy's answer. The sign-up e-mail is not walked: the
 * fake service mints the invite the letter would carry, as
 * `fresh-account-console.spec.ts` does, and `/join` redeems it.
 *
 * THE CONTROLS are the same walk with `freeDailyAiLimit: 0`, an account that
 * really has no allowance. The page then DOES show the connect card, and a tap
 * on `/diary` DOES navigate with no file chooser, so every absence and every
 * "the chooser opened" below is read through a query that can see the opposite.
 *
 * @area scan
 */
import { expect, test, type FileChooser, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_CORE_URL } from './env';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { PIXEL_PNG, routeManagedCore, routeManagedProxy, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** An account ceremony runs Argon2id at production cost. */
const CEREMONY_BUDGET_MS = 120_000;

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** How long a tap that opens a chooser has. A tap that navigates instead waits this long, then fails. */
const CHOOSER_WAIT_MS = 3_000;

/** How long control 3 lets a reloaded page settle before it taps. */
const SETTLE_MS = 2_000;

/** How often the chooser count is read. */
const CHOOSER_POLL_MS = 50;

/** The `data-slot` of the diary composer's photo door (`intake-composer.tsx`). */
const DIARY_PHOTO_DOOR = '[data-slot="intake-composer-photo"]';

/** The onboarding card that goes to `/add/photo` (`WAYS_TO_LOG`, id `photo`). */
const PHOTO_CARD = 'button[name="destination"][value="/add/photo"]';

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/**
 * The account facts of a fresh open-signup account on app.openplate.de.
 *
 * @param freeGrant - `freeDailyAiLimit`: 10 as production reports it, 0 for the control.
 */
function productionAccountStub(freeGrant: number): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: 0,
    freeDailyAiLimit: freeGrant,
    freeAiLimitPeriod: 'week',
    invitesLeft: 0,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    // A grant of 0 is the control: with plans on, the paywall would send that locked account to
    // /settings/plan before it reached the page under test, so the control instance sells none.
    plans: freeGrant > 0,
  };
}

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

type FirstFoodChoice = 'photo-card' | 'later';

/**
 * Creates an account in this browser and finishes onboarding on the last step.
 *
 * @param options.finish - `photo-card` taps "Photograph it", `later` taps "I'll do it later".
 */
async function signUpAndFinishOnboarding(page: Page, options: { finish: FirstFoodChoice }): Promise<void> {
  const token = await mintInvite(`first-run-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`);
  await page.goto(`${server.url}/join#server=${encodeURIComponent(E2E_CORE_URL)}&invite=${token}`);
  const passwords = page.locator('main input[type="password"]');
  await expect(passwords.first()).toBeVisible({ timeout: 10_000 });
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('main form button[type="submit"]').last().click();
  await page.waitForURL(/\/onboarding/, { timeout: 60_000 });

  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();

  if (options.finish === 'photo-card') {
    await page.locator(PHOTO_CARD).click();
    await page.waitForURL(/\/add\/photo/);
    return;
  }
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();
  await page.waitForURL('**/diary');
}

/**
 * Counts the file choosers a page opens, from the moment this is called.
 *
 * WHY A STANDING LISTENER. `page.waitForEvent('filechooser')` switches the browser's chooser
 * interception on with a message that is not awaited, so a mouse press sent right behind it can
 * reach the page first. The page then asks for a real chooser, nothing intercepts it, and the
 * check reads "no chooser" for a button that worked. The first version of this spec failed that
 * way four runs in four, while the page log showed `input.click()` called. A listener installed
 * before the first navigation has no such window.
 */
interface ChooserWatch {
  readonly count: () => number;
  /** The newest chooser opened, or `null` before the first. A spec answers it with `setFiles`. */
  readonly latest: () => FileChooser | null;
}

function watchFileChoosers(page: Page): ChooserWatch {
  let opened = 0;
  let latest: FileChooser | null = null;
  page.on('filechooser', (chooser) => {
    opened += 1;
    latest = chooser;
  });
  return { count: () => opened, latest: () => latest };
}

/** Whether a chooser opened after `before` choosers had been counted, waiting up to `CHOOSER_WAIT_MS`. */
async function didChooserOpen(page: Page, options: { watch: ChooserWatch; before: number }): Promise<boolean> {
  for (let waited = 0; waited <= CHOOSER_WAIT_MS; waited += CHOOSER_POLL_MS) {
    if (options.watch.count() > options.before) return true;
    await page.waitForTimeout(CHOOSER_POLL_MS);
  }
  return false;
}

/** What a tap on the diary's photo door did. */
interface TapOutcome {
  /** Whether a file chooser opened inside the tap. */
  readonly didOpenChooser: boolean;
  readonly pathname: string;
  /** The first 300 characters of the main text, for a failure message. */
  readonly pageText: string;
}

/**
 * Taps the diary's photo door the moment it is visible, with no actionability wait in between: a
 * trusted mouse press at the centre of its first visible box, the way a thumb lands on a button
 * that has just appeared.
 */
async function tapDiaryPhotoDoorAsSoonAsVisible(
  page: Page,
  watch: ChooserWatch,
  options: { settleMs?: number } = {},
): Promise<TapOutcome> {
  const door = page.locator(DIARY_PHOTO_DOOR);
  await door.waitFor({ state: 'visible' });
  if (options.settleMs !== undefined) await page.waitForTimeout(options.settleMs);
  const box = await door.boundingBox();
  if (box === null) throw new Error('the photo door was visible but has no box');
  const before = watch.count();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const didOpenChooser = await didChooserOpen(page, { watch, before });
  return { didOpenChooser, pathname: new URL(page.url()).pathname, pageText: await mainText(page) };
}

/** The message every tap assertion carries, so a failure says what the page showed instead. */
function describeTap(tap: TapOutcome): string {
  return `chooser opened: ${tap.didOpenChooser}; path: ${tap.pathname}; main text: "${tap.pageText}"`;
}

test('case 1: the photo card of onboarding lands on a scan screen with a working shutter', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await routeManagedCore(page, productionAccountStub(10));
  const watch = watchFileChoosers(page);
  await signUpAndFinishOnboarding(page, { finish: 'photo-card' });

  const shutter = page.getByRole('button', { name: EN.scan.capture.takePhoto, exact: true });
  await expect(shutter, `url: ${page.url()}; main text: ${await mainText(page)}`).toBeVisible();
  await expect(shutter).toBeEnabled();
  await expect(page.getByText(EN.scan.setup.title), 'the connect card is drawn').toHaveCount(0);

  // A page that has settled a moment later must say the same.
  await page.waitForTimeout(1_000);
  await expect(page.getByText(EN.scan.setup.title)).toHaveCount(0);

  const before = watch.count();
  await shutter.click();
  expect(await didChooserOpen(page, { watch, before }), `url: ${page.url()}`).toBe(true);
});

test('control 1: an account with no free grant lands on the connect card, no shutter', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await routeManagedCore(page, productionAccountStub(0));
  await signUpAndFinishOnboarding(page, { finish: 'photo-card' });

  await expect(page.getByText(EN.scan.setup.title)).toBeVisible();
  await expect(page.getByRole('button', { name: EN.scan.capture.takePhoto, exact: true })).toHaveCount(0);
});

test('case 2: "Plate photo" on the diary right after onboarding opens the chooser inside the tap', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await routeManagedCore(page, productionAccountStub(10));
  const watch = watchFileChoosers(page);
  await signUpAndFinishOnboarding(page, { finish: 'later' });

  const tap = await tapDiaryPhotoDoorAsSoonAsVisible(page, watch);
  expect(tap.didOpenChooser, describeTap(tap)).toBe(true);
  expect(tap.pathname, describeTap(tap)).toBe('/diary');
});

test('case 3: the same tap after a full reload (session resume) opens the chooser too', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await routeManagedCore(page, productionAccountStub(10));
  const watch = watchFileChoosers(page);
  await signUpAndFinishOnboarding(page, { finish: 'later' });
  await page.reload();

  const tap = await tapDiaryPhotoDoorAsSoonAsVisible(page, watch);
  expect(tap.didOpenChooser, describeTap(tap)).toBe(true);
  expect(tap.pathname, describeTap(tap)).toBe('/diary');
});

test('control 3: the same tap after a reload, once the page has settled, opens the chooser', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await routeManagedCore(page, productionAccountStub(10));
  const watch = watchFileChoosers(page);
  await signUpAndFinishOnboarding(page, { finish: 'later' });
  await page.reload();

  const tap = await tapDiaryPhotoDoorAsSoonAsVisible(page, watch, { settleMs: SETTLE_MS });
  expect(tap.didOpenChooser, describeTap(tap)).toBe(true);
  expect(tap.pathname, describeTap(tap)).toBe('/diary');
});

test('control 2: with no free grant the same tap navigates to /add/photo and opens no chooser', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await routeManagedCore(page, productionAccountStub(0));
  const watch = watchFileChoosers(page);
  await signUpAndFinishOnboarding(page, { finish: 'later' });

  const tap = await tapDiaryPhotoDoorAsSoonAsVisible(page, watch);
  expect(tap.didOpenChooser, describeTap(tap)).toBe(false);
  await page.waitForURL(/\/add\/photo/);
});

test('case 4: a photo picked on /add/photo reaches the AI proxy', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  await routeManagedCore(page, productionAccountStub(10));
  await routeManagedProxy(page, { left: 10 });
  const scans: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${E2E_CORE_URL}/v1/chat/completions`)
      scans.push(request.url());
  });
  await signUpAndFinishOnboarding(page, { finish: 'photo-card' });
  await expect(page.getByRole('button', { name: EN.scan.capture.takePhoto, exact: true })).toBeVisible();
  expect(scans, 'a scan left before any photo was picked').toHaveLength(0);

  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  await expect.poll(() => scans.length, { timeout: 15_000, message: `no scan request; url ${page.url()}` }).toBe(1);
});

/**
 * Holds every `POST /v1/auth/refresh` until `release()` is called, which keeps the resumed session
 * in its `unknown` window for as long as a spec needs. Registered AFTER `routeManagedCore`, so it
 * answers first and then passes the request on to the stub with `fallback()`.
 */
async function holdSessionRefresh(page: Page): Promise<RefreshHold> {
  const releases: Array<() => void> = [];
  const gate = new Promise<void>((resolve) => releases.push(resolve));
  await page.route(`${E2E_CORE_URL}/v1/auth/refresh`, async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.fallback();
  });
  return { release: () => releases.forEach((release) => release()) };
}

/** The handle `holdSessionRefresh` returns. */
interface RefreshHold {
  readonly release: () => void;
}

/** How many scans reached the AI proxy, read at any moment. */
interface ScanCount {
  readonly count: () => number;
}

/** Counts the scans that reach the AI proxy. */
function countScans(page: Page): ScanCount {
  let scans = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${E2E_CORE_URL}/v1/chat/completions`) scans += 1;
  });
  return { count: () => scans };
}

/** How long a spec lets a wrong send show itself before it says there was none. */
const NO_SEND_WINDOW_MS = 2_000;

/**
 * An early tap after a reload, a photo picked while the session is still resuming, then the
 * session's answer. Returns once the answer has been given and the page has had a moment to act.
 */
async function pickPhotoDuringResume(
  page: Page,
  options: { stub: ManagedCoreStub; answer: { freeGrant: number } },
): Promise<{ scans: ScanCount; tap: TapOutcome }> {
  await routeManagedProxy(page, { left: 10 });
  const scans = countScans(page);
  const watch = watchFileChoosers(page);
  await signUpAndFinishOnboarding(page, { finish: 'later' });

  // The reload's session answer is held, and it will carry the grant this case wants.
  const refresh = await holdSessionRefresh(page);
  options.stub.freeDailyAiLimit = options.answer.freeGrant;
  options.stub.plans = options.answer.freeGrant > 0;
  await page.reload();

  const tap = await tapDiaryPhotoDoorAsSoonAsVisible(page, watch);
  expect(tap.didOpenChooser, describeTap(tap)).toBe(true);
  const chooser = watch.latest();
  if (chooser === null) throw new Error('a chooser opened but none was kept');
  await chooser.setFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });

  // Still resuming: the photo is held, nothing is sent and the page has not moved.
  await page.waitForTimeout(NO_SEND_WINDOW_MS);
  expect(scans.count(), 'a scan left while the connection was unknown').toBe(0);
  expect(new URL(page.url()).pathname, 'the page moved while the connection was unknown').toBe('/diary');

  refresh.release();
  return { scans, tap };
}

test('case 5: a photo picked while the session resumes, answered with a zero allowance, sends nothing and shows the connect card', async ({
  page,
}) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  const stub = productionAccountStub(10);
  await routeManagedCore(page, stub);
  const { scans } = await pickPhotoDuringResume(page, { stub, answer: { freeGrant: 0 } });

  await page.waitForURL(/\/add\/photo/, { timeout: 15_000 });
  await expect(page.getByText(EN.scan.setup.title), `url: ${page.url()}`).toBeVisible();
  await expect(page.getByRole('button', { name: EN.scan.capture.takePhoto, exact: true })).toHaveCount(0);
  await page.waitForTimeout(NO_SEND_WINDOW_MS);
  expect(scans.count(), 'a scan left for an account with no allowance').toBe(0);
});

test('control 5: the same walk, answered with the grant intact, sends the picked photo', async ({ page }) => {
  test.setTimeout(CEREMONY_BUDGET_MS);
  const stub = productionAccountStub(10);
  await routeManagedCore(page, stub);
  const { scans } = await pickPhotoDuringResume(page, { stub, answer: { freeGrant: 10 } });

  await expect.poll(() => scans.count(), { timeout: 15_000, message: `no scan request; url ${page.url()}` }).toBe(1);
  await expect(page.getByText(EN.scan.setup.title)).toHaveCount(0);
});

/** The first 300 characters of the main text. */
async function mainText(page: Page): Promise<string> {
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300);
}
