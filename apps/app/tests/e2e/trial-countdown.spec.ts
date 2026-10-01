/**
 * The trial countdown in the header's status slot (M250/03).
 *
 * WHAT IS REAL: the production build, the account, the session, the shell,
 * the status channel and its header row, `planStanding`. WHAT IS STUBBED: the
 * handshake's `plans: true`, `GET /plans/me`, and the account's allowance
 * (`plans-stub.ts`), because the fake service models the sync protocol and a
 * trial is a fact about a consumer instance.
 *
 * Every absence below has a control that shows the line through the same
 * query, and every "never shown" waits for the read that would have drawn it
 * before it looks, so a check cannot pass by looking too early.
 *
 * THE COUNT IS READ WHOLE ON A PHONE (the buyer walk, 2026-09-28). At 390 px
 * in German the line read "Noch 10 kost…": the action button and the close
 * control left the sentence about 40 px. The last cases walk the three
 * longest action labels (German, French, Turkish) at 390 x 844 and measure the
 * sentence box, the document and the header, and that the line arrives
 * without moving the page.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { EN, catalogFor, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_CORE_URL } from './env';
import {
  FIT_WIDTHS,
  HEADER_HEIGHT,
  PHONE_HEIGHT,
  PHONE_WIDTH,
  completeOnboarding,
  doesStatusRowFit,
  isHeaderStatusFullyVisible,
  signInFixtureAccount,
  useLanguage,
} from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { funnel, recordMatomo } from './matomo-stub';
import { createGate, NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** Where `trial-countdown.ts` keeps the day the line was closed. Transcribed, so a rename fails here. */
const CLOSED_DAY_STORAGE_KEY = 'openplate:trial-countdown-closed:v1';

/** A daily allowance the trial grants. Any number above zero. */
const TRIAL_DAILY_LIMIT = 20;

/** The header's status row. The page title is drawn in the same box when it is empty. */
function headerStatus(page: Page): Locator {
  return page.locator('header [data-slot="header-status"]');
}

/** The countdown's one button, found by its role and the bundle's own label. */
function countdownAction(page: Page): Locator {
  return headerStatus(page).getByRole('button', { name: EN.plan.countdown.action, exact: true });
}

/**
 * An allowance that ends at local noon `days` calendar days from today, so the
 * countdown says `days + 1` (today included) whatever time the run starts.
 */
function noonInDays(days: number): string {
  const end = new Date();
  end.setDate(end.getDate() + days);
  end.setHours(12, 0, 0, 0);
  return end.toISOString();
}

/** A moment later today: ten minutes from now, and never past the last millisecond of today. */
function laterToday(): string {
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return new Date(Math.min(now + 10 * 60 * 1000, endOfToday.getTime())).toISOString();
}

/** A device past onboarding and signed in, standing on the diary. */
async function signIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
}

/**
 * Waits until the plan read has been answered and the page has drawn what it
 * answered. The anchor a "not shown" check needs: before this, nothing could
 * have been shown yet.
 */
async function waitForPlanRead(page: Page): Promise<void> {
  await page.waitForResponse((response) => response.url() === `${E2E_CORE_URL}/v1/plans/me`);
  await settleFrames(page);
  await settleFrames(page);
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('the countdown shows during a trial, moves nothing, links to the plan page and stays closed for the day', async ({
  page,
}) => {
  const events = await recordMatomo(page);
  const gate = createGate();
  const requests = await routePlansCore(page, {
    planView: NO_SUBSCRIPTION_VIEW,
    offerBody: null,
    planViewGate: gate.promise,
  });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: noonInDays(4) });
  await signIn(page);

  // ── It arrives without moving anything ──────────────────────────────
  // The plan read is HELD, so this reading is the diary before the
  // countdown exists, taken once the page has stopped moving on its own.
  await expect.poll(() => requests.planViews, { message: 'the shell never asked for the plan' }).toBeGreaterThan(0);
  await settleAnimations(page);
  await settleFrames(page);
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  gate.open();
  const expected = fill(EN.plan.countdown.daysLeft_other, { count: '5' });
  await expect(headerStatus(page)).toContainText(expected, { timeout: 10_000 });
  await expect(countdownAction(page)).toBeVisible();
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'the countdown moved the diary').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while it arrived').toBe(0);
  // THE FUNNEL counts it once, at its own placement, and nothing else.
  await expect.poll(() => funnel(events)).toEqual(['offer-seen:countdown']);

  // ── Its button goes to the plan page, and the line goes with it ─────
  await countdownAction(page).click();
  await page.waitForURL('**/settings/plan');
  await expect(countdownAction(page)).toHaveCount(0);

  // ── Closed, it stays closed today ───────────────────────────────────
  await page.goto('/diary');
  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  await settleFrames(page);
  const topsOpen = await readTops(page);
  const shiftsOpen = (await readShiftEntries(page)).length;
  await headerStatus(page).getByRole('button', { name: EN.chrome.status.dismiss, exact: true }).click();
  await expect(countdownAction(page)).toHaveCount(0);
  await settleFrames(page);
  expect(movedBetween(topsOpen, await readTops(page)), 'closing the countdown moved the diary').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsOpen), 'layout-shift while it closed').toBe(0);

  const closedOn = await page.evaluate((key) => localStorage.getItem(key), CLOSED_DAY_STORAGE_KEY);
  expect(closedOn, 'closing did not record the day').toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await page.reload();
  await waitForPlanRead(page);
  await expect(page.locator('header h1')).toBeVisible();
  await expect(countdownAction(page)).toHaveCount(0);

  // THE CONTROL: the same reload with the recorded day taken away shows the
  // line again, so the absence above is the closed day and not a page that
  // never draws it after a reload.
  await page.evaluate((key) => localStorage.removeItem(key), CLOSED_DAY_STORAGE_KEY);
  await page.reload();
  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
});

test('the last day says today', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: laterToday() });
  await signIn(page);

  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  await expect(headerStatus(page)).toContainText(EN.plan.countdown.lastDay);
});

/**
 * A page an ended trial can still open. The paywall (2026-09-28) sends it to
 * the plan page from everywhere else, and the plan page never draws the line,
 * so an absence read there would say nothing about the countdown.
 */
const OPEN_WHILE_LOCKED = '/settings/preferences';

test('no countdown after the trial ended', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: noonInDays(-1) });
  await signIn(page);
  const planRead = waitForPlanRead(page);
  await page.goto(OPEN_WHILE_LOCKED);
  await planRead;

  await expect(page.locator('header h1')).toBeVisible();
  await expect(countdownAction(page)).toHaveCount(0);
});

test('no countdown on an instance without plans, which is never asked for one', async ({ page }) => {
  // No `routePlansCore`: the fake's own handshake, which sells nothing.
  let planReads = 0;
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, (route) => {
    planReads += 1;
    return route.fulfill({ json: NO_SUBSCRIPTION_VIEW });
  });
  await routeAccountAllowance(page, { dailyAiLimit: TRIAL_DAILY_LIMIT, allowanceExpiresAt: noonInDays(4) });
  await signIn(page);

  // THE ANCHOR: the settings hub names the account only once the session and
  // its account read have landed, which is everything the countdown waits for.
  await page.goto('/settings');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
  await settleFrames(page);
  await expect(page.locator('header h1')).toBeVisible();
  await expect(countdownAction(page)).toHaveCount(0);
  expect(planReads, 'an instance without plans was asked for a plan').toBe(0);
});

test('on a scan trial the countdown counts free scans, not days (M253/05)', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  // NO DATE and a count: the core's scan trial. A future date would lift the
  // count, which the day cases above are.
  await routeAccountAllowance(page, {
    dailyAiLimit: TRIAL_DAILY_LIMIT,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: 7 },
  });
  await signIn(page);

  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  await expect(headerStatus(page)).toContainText(fill(EN.plan.countdown.scansLeft_other, { count: '7' }));
  // THE CONTROL: the same slot says no days, so the text above is the scans
  // sentence and not a day sentence that happens to share a word.
  await expect(headerStatus(page)).not.toContainText(fill(EN.plan.countdown.daysLeft_other, { count: '7' }));
});

test('a spent scan trial says the free scans are used instead of counting (M253/11)', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, {
    dailyAiLimit: TRIAL_DAILY_LIMIT,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: 0 },
  });
  await signIn(page);
  // Read where a locked person can still go, as the case above explains.
  const planRead = waitForPlanRead(page);
  await page.goto(OPEN_WHILE_LOCKED);
  await planRead;

  // THE OWNER'S DECISION (M253/11): at zero the line stays, says the scans
  // are used and keeps the plan button. It used to draw nothing.
  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  await expect(headerStatus(page)).toContainText(EN.plan.countdown.scansUsed);
  await expect(headerStatus(page)).not.toContainText(fill(EN.plan.countdown.scansLeft_other, { count: '0' }));
});

/** The three languages with the longest action label: "Tarife ansehen", "Voir les forfaits", "Planları gör". */
const LONG_LABEL_LOCALES = ['de', 'fr', 'tr'] as const satisfies readonly LanguageCode[];

/** The free scans the fixture account is given for the locale walk: the buyer walk's "Noch 10". */
const SCANS_LEFT = 10;

/** The pages the buyer walk read the clipped line on. */
const LOCALE_WALK_PAGES = ['/diary', '/settings/account'] as const;

/** What a phone shows of the countdown: whether the sentence fits its box, and the page around it. */
interface CountdownFit {
  isSentenceWhole: boolean;
  documentScrollWidth: number;
  documentClientWidth: number;
  headerHeight: number;
}

/** Reads the countdown's fit on the page as it stands. */
async function readCountdownFit(page: Page): Promise<CountdownFit> {
  const isSentenceWhole = await isHeaderStatusFullyVisible(page);
  const layout = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    headerHeight: Math.round(document.querySelector('header')?.getBoundingClientRect().height ?? 0),
  }));
  return { isSentenceWhole, ...layout };
}

/**
 * Whether a finger on the first word of the sentence lands on the action, and
 * how tall the box it lands in is. The label is one line of small text; its
 * tap area is the whole text column.
 */
async function readActionTapArea(page: Page): Promise<{ isFirstWordTheAction: boolean; columnHeight: number }> {
  return headerStatus(page)
    .locator('[data-slot="header-status-sentence"]')
    .evaluate((sentence) => {
      const words = sentence.getBoundingClientRect();
      const hit = document.elementFromPoint(words.left + 4, words.top + 4);
      const action = sentence.closest('[data-slot="header-status"]')?.querySelector('[data-slot="header-status-action"]');
      const column = action?.parentElement?.closest('.relative');
      return {
        isFirstWordTheAction: action !== null && action !== undefined && hit === action,
        columnHeight: column?.getBoundingClientRect().height ?? 0,
      };
    });
}

for (const width of FIT_WIDTHS) {
  for (const locale of LONG_LABEL_LOCALES) {
    test(`the scan count reads whole at ${width} px in ${locale}, beside its action and the close control, and moves nothing`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      const copy = catalogFor(locale);
      const sentence = fill(copy.plan.countdown.scansLeft_other, { count: String(SCANS_LEFT) });
      const gate = createGate();
      const requests = await routePlansCore(page, {
        planView: NO_SUBSCRIPTION_VIEW,
        offerBody: null,
        planViewGate: gate.promise,
      });
      await routeAccountAllowance(page, {
        dailyAiLimit: TRIAL_DAILY_LIMIT,
        allowanceExpiresAt: null,
        trialScans: { granted: SCANS_LEFT, left: SCANS_LEFT },
      });
      await signIn(page);

      // ── It arrives without moving anything, in this language ────────────
      // The plan read is HELD, so this reading is the diary before the line.
      const viewsBefore = requests.planViews;
      await useLanguage(page, locale);
      await page.goto('/diary');
      expect(await page.locator('html').getAttribute('lang'), `${locale}: the document is in that language`).toBe(
        locale,
      );
      await expect
        .poll(() => requests.planViews, { message: 'the shell never asked for the plan' })
        .toBeGreaterThan(viewsBefore);
      await settleAnimations(page);
      await settleFrames(page);
      const topsBefore = await readTops(page);
      const shiftsBefore = (await readShiftEntries(page)).length;

      gate.open();
      await expect(headerStatus(page)).toContainText(sentence, { timeout: 10_000 });
      const action = headerStatus(page).getByRole('button', { name: copy.plan.countdown.action, exact: true });
      await expect(action).toBeVisible();
      await settleFrames(page);
      expect(movedBetween(topsBefore, await readTops(page)), `${locale}: the countdown moved the diary`).toEqual([]);
      expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), `${locale}: layout-shift`).toBe(0);

      // ── Whole, on every page the buyer read it on ───────────────────────
      for (const path of LOCALE_WALK_PAGES) {
        if (path !== '/diary') {
          await page.goto(path);
          await expect(headerStatus(page)).toContainText(sentence, { timeout: 10_000 });
        }
        await settleFrames(page);
        const fit = await readCountdownFit(page);
        expect(fit.isSentenceWhole, `${locale} ${path}: the sentence is clipped`).toBe(true);
        expect(fit.documentScrollWidth, `${locale} ${path}: the document overflows`).toBe(fit.documentClientWidth);
        expect(fit.documentClientWidth, `${locale} ${path}: the phone`).toBe(width);
        expect(fit.headerHeight, `${locale} ${path}: the line opened the header`).toBe(HEADER_HEIGHT);
        // A finger on the words takes the action, in a box no shorter than the floor.
        const tap = await readActionTapArea(page);
        expect(tap.isFirstWordTheAction, `${locale} ${path}: the sentence is not the action's tap area`).toBe(true);
        expect(tap.columnHeight, `${locale} ${path}: the action's tap area`).toBeGreaterThanOrEqual(44);
      }

      // THE CONTROL for the fit reading: the same sentence squeezed into the
      // 40 px the buyer walk measured must read as clipped.
      await headerStatus(page)
        .locator('[data-slot="header-status-text"]')
        .evaluate((text) => {
          if (text instanceof HTMLElement) text.style.width = '40px';
        });
      expect(
        (await readCountdownFit(page)).isSentenceWhole,
        `${locale}: the fit reading cannot see a clipped line`,
      ).toBe(false);
    });
  }
}

test('every countdown sentence of all six languages fits the row with its action at 390 and 360 px', async ({
  page,
}) => {
  // A real countdown in its one-line layout (no recap: ten scans left), whose
  // words are then swapped for each language's. The three cases above walk
  // the longest labels for real; this reads every sentence the line can say.
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, {
    dailyAiLimit: TRIAL_DAILY_LIMIT,
    allowanceExpiresAt: null,
    trialScans: { granted: SCANS_LEFT, left: SCANS_LEFT },
  });
  await signIn(page);
  await expect(countdownAction(page)).toBeVisible({ timeout: 10_000 });
  expect(await page.locator('header [data-slot="header-status-description"]').count(), 'a recap line is showing').toBe(
    0,
  );

  const clipped: string[] = [];
  // THE SAME ROW AT EACH WIDTH: 390 px is the tier's phone, 360 px the narrow
  // Android one. The row reflows in place, so no reload is needed between.
  for (const width of FIT_WIDTHS) {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    expect(await page.evaluate(() => document.documentElement.clientWidth), `${width}: the phone`).toBe(width);
    for (const locale of SUPPORTED_LANGUAGES) {
      const countdown = catalogFor(locale).plan.countdown;
      const sentences = [
        fill(countdown.scansLeft_other, { count: String(SCANS_LEFT) }),
        countdown.scansUsed,
        // Two digits, the longest a trial in days says.
        fill(countdown.daysLeft_other, { count: '14' }),
        countdown.lastDay,
      ];
      for (const sentence of sentences) {
        if (!(await doesStatusRowFit(page, { sentence, label: countdown.action }))) {
          const column = await page
            .locator('header [data-slot="header-status-text"]')
            .evaluate((text) => `column ${text.clientWidth} px, ${text.scrollHeight}/${text.clientHeight} px tall`);
          clipped.push(`${width} ${locale}: ${sentence} ${countdown.action} (${column})`);
        }
      }
    }
  }
  expect(clipped, 'these countdown lines are cut off').toEqual([]);
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });

  // THE CONTROL: a sentence far past three lines must read as cut off.
  expect(
    await doesStatusRowFit(page, { sentence: EN.plan.countdown.scansUsed.repeat(8), label: EN.plan.countdown.action }),
    'the fit reading cannot see a clipped line',
  ).toBe(false);
});
