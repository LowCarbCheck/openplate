/**
 * The header's avatar button says the account's name (owner report, 2026-09-30).
 *
 * Signed in on app.openplate.de, the owner read "Dieses Gerät" on the button
 * and asked: "shouldn't this just say my name? the one I used when signing
 * up?" The button and the menu's top label now show the display name, cut
 * before the `@` when the name is an address (`resolveAvatarName`), and keep
 * "This device" with no session or no name.
 *
 * WHAT IS REAL: the production build as a managed instance, the sign-in, the
 * session and its resume after a reload, and, for the signed-out check, the
 * tier's own open instance. WHAT IS STUBBED: the account facts
 * (`managed-core-stub.ts`), which is where the display name is written.
 *
 * WHAT THIS PROVES:
 *
 * - Signed in with a name, the button's words, its accessible name and the
 *   menu's top label all carry the name. An address as the name shows the
 *   part before the `@`.
 * - Signed in with no name, and signed out, the button says "This device"
 *   exactly as it did, with the same accessible name.
 * - A 60-character name ends in an ellipsis inside the name's fixed box, the
 *   header does not overflow at 640 px (the narrowest width that shows the
 *   words) or at 320 px (where only the circle shows), and the menu label
 *   cuts it too.
 * - The name arrives after the header is drawn, when the reload's session
 *   resume reads the account. Until then the box is empty, never "This
 *   device" to a person who is signed in. When it arrives nothing moves: the
 *   circle, the name's box and a witness planted where the fast chip sits
 *   keep their rects, and the `layout-shift` total is 0.
 *
 * THE CONTROLS. Each reading is shown able to fail: a name box sized by its
 * words (the fixed width taken away) moves the box and the witness and
 * records a shift when the name arrives, and the same box set free at 320 px
 * pushes the header past its edge. RED ON THE OLD BUTTON: against the button
 * that always said "This device", every signed-in name check, the ellipsis
 * check and the arrival check fail.
 *
 * DESKTOP, WITH MOBILE EMULATION OFF, for every check that reads the words:
 * below `sm` the button is the circle alone, and the phone project's
 * `isMobile` zooms an overflowing page out, which would hide the overflow the
 * 320 px reading exists to catch. Widths are read from `clientWidth`.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
  type ShiftEntry,
} from './layout-shift';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW, createGate } from './plans-stub';

test.use({
  serviceWorkers: 'block',
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
});

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** One sign-in, one onboarding and a reload fit in this. */
const TEST_BUDGET_MS = 90_000;

/** The name the owner gave when they signed up, in the fixture's words. */
const NAME = 'Altan Sarisin';

/** Sixty characters, far past the name box's 160 px of 14 px Victor Mono. */
const LONG_NAME = 'Maximiliane Konstantina Alexandropoulos-Weatherby Schoenberg';

/** The name box's fixed width, `w-40`. */
const NAME_BOX_PX = 160;

/** The narrowest width that shows the words (`sm`), and the narrowest phone a person owns. */
const SM_WIDTH = 640;
const NARROW_PHONE = { width: 320, height: 800 } as const;

/** Frees the name box from its fixed width, the way a box sized by its words would be. */
const FREE_WIDTH_STYLE = '[data-slot="avatar-menu-name"] { width: auto !important; }';

/** Shows the name box at every width, freed of its fixed width and its cut. */
const FREE_AT_ANY_WIDTH_STYLE =
  '[data-slot="avatar-menu-name"] { display: block !important; width: auto !important; overflow: visible !important; }';

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A signed-in account on an instance that sells nothing, so no paywall stands in the way. */
function accountStub(displayName: string | null): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: false,
    displayName,
  };
}

/** The header's avatar button, whatever it is called. */
function avatarTrigger(page: Page): Locator {
  return page.locator('header').locator('button[aria-haspopup="menu"]');
}

/** A box's rect, rounded to a tenth of a pixel so a reading is stable. */
interface BoxReading {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Rounds a pixel value to a tenth. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Reads one element's rect. */
async function readBox(locator: Locator): Promise<BoxReading> {
  const rect = await locator.evaluate((element) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
  });
  return { left: tenth(rect.left), top: tenth(rect.top), width: tenth(rect.width), height: tenth(rect.height) };
}

/** How far an element's content runs past its own box, as the browser reports it. */
interface OverflowReading {
  scrollWidth: number;
  clientWidth: number;
}

/** Reads an element's scroll width against its client width. */
async function readOverflow(locator: Locator): Promise<OverflowReading> {
  return locator.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
}

/** Adds a style sheet to the open document and returns a way to take it out again. */
async function addStyle(page: Page, css: string): Promise<() => Promise<void>> {
  const handle = await page.addStyleTag({ content: css });
  return async () => {
    await handle.evaluate((element) => element.parentNode?.removeChild(element));
  };
}

/**
 * Signs in, then reloads the diary with every account read held, so the
 * header is drawn by a session still resuming and the name arrives only when
 * the returned gate opens.
 */
async function reloadWithTheAccountHeld(page: Page): Promise<() => void> {
  const accountRead = createGate();
  await page.route(
    (url) => url.href === `${E2E_SYNC_SERVER_URL}/v1/auth/account`,
    async (route) => {
      if (route.request().method() === 'GET') await accountRead.promise;
      await route.fallback();
    },
  );
  await page.goto(`${server.url}/diary`);
  return () => accountRead.open();
}

test('signed in with a name, the button and the menu say the name', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, accountStub(NAME));
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);

  const trigger = page
    .locator('header')
    .getByRole('button', { name: fill(EN.chrome.accountMenuLabel, { name: NAME }), exact: true });
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await expect(trigger.locator('[data-slot="avatar-menu-name"]')).toHaveText(NAME);
  // CONTROL: the device's words are gone, so the name is not printed beside them.
  await expect(trigger).not.toContainText(EN.chrome.thisDevice);

  await trigger.click();
  await expect(page.getByRole('menu').locator('[data-slot="avatar-menu-label"]')).toHaveText(NAME);
});

test('a name that is an address shows the part before the @', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, accountStub('altan@example.com'));
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);

  const trigger = page
    .locator('header')
    .getByRole('button', { name: fill(EN.chrome.accountMenuLabel, { name: 'altan' }), exact: true });
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await expect(trigger.locator('[data-slot="avatar-menu-name"]')).toHaveText('altan');
  await trigger.click();
  await expect(page.getByRole('menu').locator('[data-slot="avatar-menu-label"]')).toHaveText('altan');
});

test('control: signed in with no name, the button still says This device', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, accountStub(null));
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);

  // READ BY ITS WORDS, not by the new slots, so this control holds on the
  // old button too: it is the behaviour this change must keep.
  const trigger = page.locator('header').getByRole('button', { name: EN.chrome.deviceMenuLabel, exact: true });
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await expect(trigger.getByText(EN.chrome.thisDevice, { exact: true })).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('menu').getByText(EN.chrome.thisDevice, { exact: true })).toBeVisible();
});

test('control: signed out, the button still says This device', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  // THE TIER'S OWN OPEN INSTANCE: a managed one shows a stranger the public
  // header, which has no avatar button at all.
  await completeOnboarding(page);

  const trigger = page.locator('header').getByRole('button', { name: EN.chrome.deviceMenuLabel, exact: true });
  await expect(trigger).toBeVisible();
  const words = trigger.getByText(EN.chrome.thisDevice, { exact: true });
  await expect(words).toBeVisible();
  // "This device" fits its box whole: the fixed width cuts only a name.
  const fit = await readOverflow(words);
  expect(fit.scrollWidth, JSON.stringify(fit)).toBeLessThanOrEqual(fit.clientWidth);
});

test('a 60-character name ends in an ellipsis, and the header never overflows', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  expect(LONG_NAME).toHaveLength(60);
  await routeManagedCore(page, accountStub(LONG_NAME));
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);

  const header = page.locator('header');
  const trigger = avatarTrigger(page);
  const words = trigger.locator('[data-slot="avatar-menu-name"]');
  await expect(trigger).toContainText(LONG_NAME, { timeout: 10_000 });
  await expect(words).toHaveText(LONG_NAME);

  // CUT, AND INSIDE ITS BOX: the name runs past the box, the box keeps its
  // width, and the browser draws the cut as an ellipsis on one line.
  const cut = await readOverflow(words);
  expect(cut.scrollWidth, JSON.stringify(cut)).toBeGreaterThan(cut.clientWidth);
  expect((await readBox(words)).width).toBe(NAME_BOX_PX);
  expect(await words.evaluate((element) => getComputedStyle(element).textOverflow)).toBe('ellipsis');
  expect(await words.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
  const wide = await readOverflow(header);
  expect(wide.scrollWidth, JSON.stringify(wide)).toBeLessThanOrEqual(wide.clientWidth);

  // THE MENU'S LABEL cuts it inside the 16rem menu too.
  await trigger.click();
  const label = page.getByRole('menu').locator('[data-slot="avatar-menu-label"]');
  await expect(label).toHaveText(LONG_NAME);
  const menuCut = await readOverflow(label);
  expect(menuCut.scrollWidth, JSON.stringify(menuCut)).toBeGreaterThan(menuCut.clientWidth);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // `sm`, THE NARROWEST WIDTH THAT SHOWS THE WORDS.
  await page.setViewportSize({ width: SM_WIDTH, height: 800 });
  await expect(words).toBeVisible();
  const atSm = await readOverflow(header);
  expect(atSm.scrollWidth, JSON.stringify(atSm)).toBeLessThanOrEqual(atSm.clientWidth);

  // 320 PX: the circle alone, inside the header and inside the page.
  await page.setViewportSize(NARROW_PHONE);
  await expect(words).toBeHidden();
  const narrow = await readOverflow(header);
  expect(narrow.scrollWidth, JSON.stringify(narrow)).toBeLessThanOrEqual(narrow.clientWidth);
  const pageWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(pageWidth.scrollWidth, JSON.stringify(pageWidth)).toBeLessThanOrEqual(pageWidth.clientWidth);
  const circle = await readBox(trigger.locator('[data-slot="avatar-menu-circle"]'));
  expect(circle.left + circle.width).toBeLessThanOrEqual(pageWidth.clientWidth);

  // CONTROL: the same name, shown and set free at 320 px, pushes the header
  // past its edge, so the reading above can say no.
  const removeStyle = await addStyle(page, FREE_AT_ANY_WIDTH_STYLE);
  const freed = await readOverflow(header);
  expect(freed.scrollWidth, JSON.stringify(freed)).toBeGreaterThan(freed.clientWidth);
  await removeStyle();
});

/**
 * Reloads with the account held, and returns the readings of the moment
 * before the name arrives: the header is drawn, the session is still
 * reopening, and the name's box is empty.
 */
async function drawTheHeaderBeforeTheName(page: Page, stub: ManagedCoreStub): Promise<ArrivalBaseline> {
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);
  await installShiftObserver(page);
  const release = await reloadWithTheAccountHeld(page);

  const trigger = avatarTrigger(page);
  const words = trigger.locator('[data-slot="avatar-menu-name"]');
  // DRAWN BEFORE THE SESSION, and SILENT: the resume waits on the held
  // account read, and a person who is signed in is not told "This device".
  await expect(trigger).toHaveAccessibleName(EN.chrome.deviceMenuLabel, { timeout: 10_000 });
  await expect(trigger).not.toContainText(EN.chrome.thisDevice);
  await expect(words).toBeVisible();
  await expect(words).toHaveText('');
  await plantWitness(trigger);
  return { trigger, words, release };
}

/** What {@link drawTheHeaderBeforeTheName} leaves the test holding. */
interface ArrivalBaseline {
  trigger: Locator;
  words: Locator;
  /** Lets the held account read through, which brings the name. */
  release: () => void;
}

/**
 * Plants a small box at the start of the button, where the fast chip sits
 * when a fast is running: the thing a box sized by its words would push.
 * Nothing in this header is left of the name otherwise, so without a witness
 * a moving box would have nothing to move.
 */
async function plantWitness(trigger: Locator): Promise<void> {
  await trigger.evaluate((button) => {
    const witness = document.createElement('span');
    witness.dataset.e2eWitness = '';
    witness.style.cssText = 'display:inline-block;flex:none;width:12px;height:12px;background:currentColor';
    button.prepend(witness);
  });
}

/** Waits for the fonts and the animations, so the baseline is the page at rest. */
async function settleForBaseline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
}

/** Every shift after `since`, as one readable failure message. */
function describeShifts(entries: readonly ShiftEntry[], since: number): string {
  return entries
    .slice(since)
    .map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`)
    .join('\n');
}

test('the name arrives after the header is drawn, and nothing moves', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  const { trigger, words, release } = await drawTheHeaderBeforeTheName(page, accountStub(NAME));
  const circle = trigger.locator('[data-slot="avatar-menu-circle"]');
  const witness = trigger.locator('[data-e2e-witness]');
  await settleForBaseline(page);
  const since = (await readShiftEntries(page)).length;
  const circleBefore = await readBox(circle);
  const wordsBefore = await readBox(words);
  const witnessBefore = await readBox(witness);

  release();
  await expect(words).toHaveText(NAME, { timeout: 10_000 });
  await expect(trigger).toHaveAccessibleName(fill(EN.chrome.accountMenuLabel, { name: NAME }));
  await settleFrames(page);

  expect(await readBox(circle)).toEqual(circleBefore);
  expect(await readBox(words)).toEqual(wordsBefore);
  expect(await readBox(witness)).toEqual(witnessBefore);
  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, since), describeShifts(entries, since)).toBe(0);
});

test('control: a name box sized by its words moves what is beside it when the name arrives', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  const { trigger, words, release } = await drawTheHeaderBeforeTheName(page, accountStub(NAME));
  const witness = trigger.locator('[data-e2e-witness]');
  await addStyle(page, FREE_WIDTH_STYLE);
  await settleForBaseline(page);
  const since = (await readShiftEntries(page)).length;
  const wordsBefore = await readBox(words);
  const witnessBefore = await readBox(witness);

  release();
  await expect(words).toHaveText(NAME, { timeout: 10_000 });
  await settleFrames(page);

  expect((await readBox(words)).left).not.toBe(wordsBefore.left);
  expect((await readBox(witness)).left).not.toBe(witnessBefore.left);
  expect(shiftScoreAfter(await readShiftEntries(page), since)).toBeGreaterThan(0);
});
