/**
 * The line at the AI limit, in the header's status slot (owner, 2026-11-02).
 *
 * WHAT IS REAL: the production build as a MANAGED instance, because only there
 * does the instance supply the AI, and so `aiQuota` counts this person's scans
 * (`managed-app-server.ts`). The status channel, the header, `localStorage` and
 * the session are the real ones. WHAT IS STUBBED: the core's account facts and the
 * plan reads (`managed-core-stub.ts`), and the proxy's answer in the one spec that
 * reaches the limit by scanning.
 *
 * THE OTHER SIDE OF EVERY "DOES NOT SHOW" IS A SPEC THAT SHOWS, on the same server
 * with one fact changed, and a line that never appeared is read only after the
 * plan read it would have needed has landed.
 *
 * @area plans-and-paywall
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { EN, fill } from './copy';
import { E2E_CORE_URL } from './env';
import { FIT_WIDTHS, HEADER_HEIGHT, PHONE_HEIGHT, PHONE_WIDTH, doesStatusRowFit, signInFixtureAccount, completeOnboarding } from './helpers';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames, shiftScoreAfter } from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import {
  FIXTURE_TIERS_OFFER_BODY,
  NO_SUBSCRIPTION_VIEW,
  routeAccountAllowance,
  routePlansCore,
  subscriberOnTier,
} from './plans-stub';

test.use({ serviceWorkers: 'block', locale: 'en-US' });

const BOOT_BUDGET_MS = 90_000;
const WALK_BUDGET_MS = 90_000;

/** The closed-window key, transcribed here on purpose: a change to it forgets every closed line. */
const CLOSED_KEY = 'openplate:limit-ribbon-closed:v1';

const ribbonCopySchema = z.object({
  plan: z.object({
    limitRibbon: z.object({ usedWeek_other: z.string(), usedDay_other: z.string() }),
    countdown: z.object({ action: z.string() }),
  }),
});

function ribbonCopyFor(locale: string): z.infer<typeof ribbonCopySchema>['plan'] {
  return ribbonCopySchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${locale}/common.json`), 'utf8')),
  ).plan;
}

const COPY = ribbonCopyFor('en');

const tiersFixtureSchema = z.object({ tiers: z.array(z.looseObject({ id: z.string(), isSold: z.boolean() })) });
const [, LOW, , TOP] = tiersFixtureSchema.parse(JSON.parse(FIXTURE_TIERS_OFFER_BODY)).tiers;
if (LOW === undefined || TOP === undefined) throw new Error('the tiers fixture lost a tier this spec reads');

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

test.beforeEach(() => {
  test.setTimeout(WALK_BUDGET_MS);
});

/** A window that ends in a week, or in two for "the next one". */
function windowEnd(weeks = 1): string {
  return new Date(Date.now() + weeks * 7 * 86_400_000).toISOString();
}

/** A free person, with the count the spec names. */
function freeStub({ used = 10, limit = 10, resetsAt = windowEnd() }: { used?: number; limit?: number; resetsAt?: string } = {}): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: limit,
    freeDailyAiLimit: limit,
    aiLimitPeriod: 'week',
    aiQuota: { kind: 'free', limit, period: 'week', used, resetsAt },
    invitesLeft: 0,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
  };
}

/** A subscriber at the limit, on the tier the spec names, with an offer that lists tiers. */
function subscriberStub(tierId: string, overrides: Partial<ManagedCoreStub> = {}): ManagedCoreStub {
  return {
    ...freeStub(),
    freeDailyAiLimit: undefined,
    planView: subscriberOnTier(tierId),
    offerBody: FIXTURE_TIERS_OFFER_BODY,
    offerReads: { count: 0 },
    ...overrides,
  };
}

function headerStatus(page: Page): Locator {
  return page.locator('header [data-slot="header-status"]');
}

function ribbonSentence(page: Page, limit = 10): Locator {
  return headerStatus(page).getByText(fill(COPY.limitRibbon.usedWeek_other, { count: String(limit) }));
}

/** Waits until the shell has read the plan, which any line would have needed, and the page is quiet. */
async function settleAfterPlanRead(page: Page, read: Promise<Request>): Promise<void> {
  await read;
  await settleAnimations(page);
  await settleFrames(page);
  await page.waitForTimeout(300);
}

/** Signs in, opens the diary and waits for the shell's plan read. */
async function openDiary(page: Page, stub: ManagedCoreStub): Promise<void> {
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);
  const read = page.waitForRequest(`${E2E_CORE_URL}/v1/plans/me`);
  await page.goto(`${server.url}/diary`);
  await settleAfterPlanRead(page, read);
}

test('at the limit the header says so, moves nothing, and the button opens the plans, where the line goes away', async ({ page }) => {
  await installShiftObserver(page);
  await openDiary(page, freeStub());
  await expect(ribbonSentence(page)).toBeVisible();
  const button = headerStatus(page).getByRole('button', { name: COPY.countdown.action });
  await expect(button).toBeVisible();
  await expect(headerStatus(page).getByRole('button', { name: EN.chrome.status.dismiss })).toBeVisible();
  expect((await page.locator('header').first().boundingBox())?.height, 'the header keeps its box').toBe(HEADER_HEIGHT);
  expect(shiftScoreAfter(await readShiftEntries(page), 0), 'layout-shift').toBe(0);

  await button.click();
  await page.waitForURL('**/settings/plan');
  await expect(ribbonSentence(page)).toHaveCount(0);
});

test('control: one scan below the limit says nothing', async ({ page }) => {
  await openDiary(page, freeStub({ used: 9 }));
  await expect(ribbonSentence(page)).toHaveCount(0);
  await expect(headerStatus(page)).toHaveCount(0);
});

test('a subscriber below the top tier sees it, and the offer is read for that', async ({ page }) => {
  const stub = subscriberStub(LOW.id);
  await openDiary(page, stub);
  await expect(ribbonSentence(page)).toBeVisible();
  expect(stub.offerReads?.count, 'the line needed the offer').toBeGreaterThan(0);
});

test('the top tier does not see it', async ({ page }) => {
  const stub = subscriberStub(TOP.id);
  await openDiary(page, stub);
  await expect.poll(() => stub.offerReads?.count, 'the offer answered first').toBeGreaterThan(0);
  await settleFrames(page);
  await page.waitForTimeout(300);
  await expect(ribbonSentence(page)).toHaveCount(0);
});

test('control: a subscriber with scans left costs no offer read', async ({ page }) => {
  const stub = subscriberStub(LOW.id, { aiQuota: { kind: 'paid', limit: 10, period: 'week', used: 3, resetsAt: windowEnd() } });
  await openDiary(page, stub);
  await expect(ribbonSentence(page)).toHaveCount(0);
  expect(stub.offerReads?.count).toBe(0);
});

test('an instance with no plans says nothing', async ({ page }) => {
  await routeManagedCore(page, { ...freeStub(), plans: false });
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);
  await expect(page.locator('main')).toBeVisible();
  await settleAnimations(page);
  await settleFrames(page);
  await page.waitForTimeout(500);
  await expect(ribbonSentence(page)).toHaveCount(0);
});

test('an instance where the person brings their own key says nothing', async ({ page }) => {
  // THE TIER'S OWN SERVER IS AN OPEN INSTANCE: the AI is the person's, so the
  // count is not theirs to run out of. Every other fact here is the first spec's.
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_TIERS_OFFER_BODY });
  await routeAccountAllowance(page, {
    dailyAiLimit: 10,
    allowanceExpiresAt: null,
    freeDailyAiLimit: 10,
    freeAiLimitPeriod: 'week',
    aiQuota: { kind: 'free', limit: 10, period: 'week', used: 10, resetsAt: windowEnd() },
  });
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  const read = page.waitForRequest(`${E2E_CORE_URL}/v1/plans/me`);
  await page.goto('/diary');
  await settleAfterPlanRead(page, read);
  await expect(ribbonSentence(page)).toHaveCount(0);
});

test('the plan page itself never carries it', async ({ page }) => {
  await routeManagedCore(page, freeStub());
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/settings/plan`);
  await expect(page.locator('[data-slot="plan-order"], [data-slot="plan-return"], main h2').first()).toBeVisible();
  await settleFrames(page);
  await page.waitForTimeout(300);
  await expect(ribbonSentence(page)).toHaveCount(0);
});

test('a locked person is the lock screen\'s, and the line does not stack on it', async ({ page }) => {
  // TEN OF TEN FREE SCANS: `trial-ended`, which the paywall owns.
  await routeManagedCore(page, {
    ...freeStub(),
    freeDailyAiLimit: undefined,
    trialScans: { granted: 10, left: 0 },
    dailyAiLimit: 20,
  });
  await signInManaged(page, server.url);
  // An exempt page, so the person is not sent away and the header is drawn.
  const read = page.waitForRequest(`${E2E_CORE_URL}/v1/plans/me`);
  await page.goto(`${server.url}/settings/data`);
  await settleAfterPlanRead(page, read);
  await expect(ribbonSentence(page)).toHaveCount(0);
  // THE CONTROL: the channel is held by the line the lock already has.
  await expect(headerStatus(page).getByText(EN.plan.countdown.scansUsed)).toBeVisible();
});

test('closing keeps it closed across a reload, and it comes back in the next window', async ({ page }) => {
  const resetsAt = windowEnd();
  const stub = freeStub({ resetsAt });
  await openDiary(page, stub);
  await expect(ribbonSentence(page)).toBeVisible();
  await headerStatus(page).getByRole('button', { name: EN.chrome.status.dismiss }).click();
  await expect(ribbonSentence(page)).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), CLOSED_KEY), 'the close names the window').toBe(resetsAt);

  // THE SAME WINDOW: closed.
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  await settleAnimations(page);
  await settleFrames(page);
  await page.waitForTimeout(500);
  await expect(ribbonSentence(page)).toHaveCount(0);

  // THE NEXT WINDOW, spent again: the line is back, because the record no longer matches.
  stub.aiQuota = { kind: 'free', limit: 10, period: 'week', used: 10, resetsAt: windowEnd(2) };
  await page.reload();
  await expect(ribbonSentence(page)).toBeVisible();
});

test('it never talks over another status: it waits until the channel is free', async ({ page }) => {
  // A LONG DAY TRIAL: the countdown holds the channel first, with no recap to wait for.
  const stub: ManagedCoreStub = {
    ...freeStub(),
    freeDailyAiLimit: undefined,
    allowanceExpiresAt: windowEnd(5),
  };
  await openDiary(page, stub);
  const dismiss = headerStatus(page).getByRole('button', { name: EN.chrome.status.dismiss });
  await expect(dismiss).toBeVisible();
  await expect(ribbonSentence(page)).toHaveCount(0);
  // THE CONTROL: once that line is closed, the channel is free and this one shows.
  await dismiss.click();
  await expect(ribbonSentence(page)).toBeVisible();
});

test('the scan that spends the last unit brings the line, with no reload', async ({ page }) => {
  const stub = freeStub({ used: 9 });
  await routeManagedCore(page, stub);
  await page.route(`${E2E_CORE_URL}/v1/chat/completions`, (route) => {
    const request = route.request();
    const cors = {
      'Access-Control-Allow-Origin': request.headers().origin ?? '*',
      'Access-Control-Expose-Headers': 'Retry-After, X-Quota-Used, X-Quota-Limit',
    };
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': request.headers()['access-control-request-headers'] ?? '*',
        },
      });
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'X-Quota-Used': '10', 'X-Quota-Limit': '10' },
      json: { choices: [{ message: { content: JSON.stringify({ items: [] }) } }] },
    });
  });
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/add/photo`);
  const capture = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('input[type="file"][capture]') })
    .locator('input[type="file"][capture]');
  await expect(capture).toBeAttached();
  // THE CONTROL: before the scan, nine of ten says nothing.
  await settleFrames(page);
  await expect(ribbonSentence(page)).toHaveCount(0);
  await capture.setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(ribbonSentence(page)).toBeVisible({ timeout: 15_000 });
});

test('the sentence and its button fit the status row in all six languages, at both phone widths', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await openDiary(page, freeStub());
  await expect(ribbonSentence(page)).toBeVisible();
  const clipped: string[] = [];
  for (const width of FIT_WIDTHS) {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    for (const locale of SUPPORTED_LANGUAGES) {
      const copy = ribbonCopyFor(locale);
      // THREE DIGITS, the longest a limit says.
      for (const template of [copy.limitRibbon.usedWeek_other, copy.limitRibbon.usedDay_other]) {
        const sentence = fill(template, { count: '200' });
        if (!(await doesStatusRowFit(page, { sentence, label: copy.countdown.action }))) {
          clipped.push(`${width} ${locale}: ${sentence}`);
        }
      }
    }
  }
  expect(clipped, 'these lines are cut off').toEqual([]);
  // THE CONTROL: a sentence far past the row must read as cut off.
  expect(await doesStatusRowFit(page, { sentence: COPY.limitRibbon.usedWeek_other.repeat(8), label: COPY.countdown.action })).toBe(false);
});
