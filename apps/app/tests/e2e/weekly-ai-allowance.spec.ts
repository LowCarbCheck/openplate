/**
 * The AI allowance counts per week, and the app says so (2026-10-07).
 *
 * The core reports the window per account (`aiLimitPeriod`, `aiQuota`), and a
 * spent allowance answers `429` with `code: "ai-quota-spent"`, a `period` and
 * the instant it starts again. Legacy accounts and the Beta supporters stay
 * per day, so every check has its day twin as the control.
 *
 * WHAT IS REAL: the production build as a managed instance, the sign-in, the
 * session, the account page, the avatar menu, the scan screen and the refusal
 * classifier. WHAT IS STUBBED: the handshake, the plan reads, the account
 * facts (`managed-core-stub.ts`) and the proxy's one `429`.
 *
 * THE BROWSER'S ZONE IS PINNED to Europe/Berlin, because the reset is told in
 * the reader's own zone: Monday 00:00 UTC is Monday 02:00 (summer) or 01:00
 * (winter) there, and Sunday evening in New York. The expected weekday and
 * time are computed HERE with this file's own `Intl` call, never imported
 * from `ai-quota.ts`.
 *
 * NO LAYOUT SHIFT (DESIGN.md section 7): the account allowance card waits for
 * the account read and arrives with its quota in it, so the count and the
 * reset line are in the first paint of the card. The name field's top is read
 * before and after the page settles, and the `layout-shift` total outside the
 * header must be 0.
 *
 * @area plans-and-paywall
 */
import { expect, test, type Page, type Request } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_CORE_URL } from './env';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames } from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { routeManagedCore, signInManaged, trialAccountStub, type ManagedCoreStub } from './managed-core-stub';

test.use({ serviceWorkers: 'block', timezoneId: 'Europe/Berlin', locale: 'en-US' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ZONE = 'Europe/Berlin';

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** The next Monday 00:00 UTC after now, which is where a week ends. */
function nextMondayUtc(): Date {
  const now = new Date();
  const daysAhead = (8 - now.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead));
}

/** The next 00:00 UTC after now, which is where a day ends. */
function nextMidnightUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** The weekday and the clock time this file expects a reader in Berlin to be told. */
interface ExpectedMoment {
  weekday: string;
  time: string;
}

function expectedMoment(instant: Date): ExpectedMoment {
  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: ZONE }).format(instant),
    time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ZONE }).format(instant),
  };
}

/** An account on a weekly paid plan: 13 of 40, resetting at the next Monday. The kind says "free" on purpose. */
function weeklyStub(resetsAt: Date): ManagedCoreStub {
  return {
    ...trialAccountStub(0),
    trialScans: null,
    dailyAiLimit: 40,
    aiLimitPeriod: 'week',
    aiUsedToday: 2,
    // THE PAID FLOOR: a payer counted on the free grant reads `kind: "free"`. The app names no plan from it.
    aiQuota: { kind: 'free', limit: 40, period: 'week', used: 13, resetsAt: resetsAt.toISOString() },
  };
}

/** A legacy account on a daily limit: 3 of 10 today. */
function dailyStub(resetsAt: Date): ManagedCoreStub {
  return {
    ...trialAccountStub(0),
    trialScans: null,
    dailyAiLimit: 10,
    aiLimitPeriod: 'day',
    aiUsedToday: 3,
    aiQuota: { kind: 'free', limit: 10, period: 'day', used: 3, resetsAt: resetsAt.toISOString() },
  };
}

/** Every shift this document recorded outside the header, as a total and one readable failure message. */
async function shiftsOutsideHeader(page: Page): Promise<{ total: number; detail: string }> {
  const entries = (await readShiftEntries(page)).filter((entry) => entry.headerSources.length < entry.sources.length);
  return {
    total: entries.reduce((sum, entry) => sum + entry.value, 0),
    detail: entries.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`).join('\n'),
  };
}

test('a weekly account reads its count against the week and the weekday it resets, and nothing moves', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const resetsAt = nextMondayUtc();
  const moment = expectedMoment(resetsAt);
  await routeManagedCore(page, weeklyStub(resetsAt));
  await signInManaged(page, server.url);

  await installShiftObserver(page);
  await page.goto(`${server.url}/settings/account`);
  const main = page.locator('main');
  const weekLine = fill(EN.account.allowance.thisWeek, { used: '13', limit: '40' });
  const resetLine = fill(EN.account.allowance.resetsWeek, { ...moment });
  await expect(main.getByText(weekLine).first()).toBeVisible({ timeout: 10_000 });
  await expect(main.getByText(resetLine).first()).toBeVisible();
  // THE CONTROLS: it is not drawn as a day, and it does not count today's 2.
  await expect(main.getByText(fill(EN.account.allowance.today, { used: '13', limit: '40' }))).toHaveCount(0);
  await expect(main.getByText(fill(EN.account.allowance.thisWeek, { used: '2', limit: '40' }))).toHaveCount(0);

  const nameField = page.locator('#account-display-name');
  const topBefore = await nameField.evaluate((element) => element.getBoundingClientRect().top);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
  await settleFrames(page);
  const topAfter = await nameField.evaluate((element) => element.getBoundingClientRect().top);
  expect(topAfter).toBe(topBefore);
  const report = await shiftsOutsideHeader(page);
  expect(report.total, report.detail).toBe(0);

  // THE AVATAR MENU'S STRIP says it too.
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText(weekLine)).toBeVisible();
  await expect(menu.getByText(resetLine)).toBeVisible();
});

test('control: a daily account reads today and a time, never a week and never a weekday', async ({ page }) => {
  test.setTimeout(90_000);
  const resetsAt = nextMidnightUtc();
  const moment = expectedMoment(resetsAt);
  await routeManagedCore(page, dailyStub(resetsAt));
  await signInManaged(page, server.url);

  await page.goto(`${server.url}/settings/account`);
  const main = page.locator('main');
  await expect(main.getByText(fill(EN.account.allowance.today, { used: '3', limit: '10' })).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(main.getByText(fill(EN.account.allowance.resetsDay, { time: moment.time })).first()).toBeVisible();
  await expect(main.getByText(fill(EN.account.allowance.thisWeek, { used: '3', limit: '10' }))).toHaveCount(0);
  await expect(main.getByText(fill(EN.account.allowance.resetsWeek, { ...moment }))).toHaveCount(0);
});

test('control: an older core with no window and no quota draws the daily line it always drew', async ({ page }) => {
  test.setTimeout(90_000);
  // NO `aiLimitPeriod`, NO `aiQuota`: the key is left out of the wire.
  const stub: ManagedCoreStub = { ...trialAccountStub(0), trialScans: null, dailyAiLimit: 20 };
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);

  await page.goto(`${server.url}/settings/account`);
  const main = page.locator('main');
  await expect(main.getByText(fill(EN.account.allowance.today, { used: '0', limit: '20' })).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(main.getByText(/Resets /)).toHaveCount(0);
});

/**
 * Answers the AI proxy with one `429`: the core's body for a spent allowance
 * (`PROTOCOL.md` §5.19), CORS included so the browser may read it.
 */
async function routeSpentProxy(
  page: Page,
  body: Readonly<Record<string, string | number>>,
  retryAfter: number,
): Promise<{ calls: number }> {
  const log = { calls: 0 };
  await page.route(`${E2E_CORE_URL}/v1/chat/completions`, (route) => {
    const request: Request = route.request();
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
    log.calls += 1;
    return route.fulfill({ status: 429, headers: { ...cors, 'Retry-After': String(retryAfter) }, json: body });
  });
  return log;
}

/** Photographs one plate on the scan screen. */
async function photographOnePlate(page: Page): Promise<void> {
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
}

test('a spent week says on which weekday the scans come back, never tomorrow', async ({ page }) => {
  test.setTimeout(90_000);
  const resetsAt = nextMondayUtc();
  const moment = expectedMoment(resetsAt);
  const stub = weeklyStub(resetsAt);
  await routeManagedCore(page, stub);
  const proxy = await routeSpentProxy(
    page,
    {
      error: `weekly quota spent: 40 of 40 units used, and this request needs 1. It resets at ${resetsAt.toISOString()}.`,
      code: 'ai-quota-spent',
      period: 'week',
      used: 40,
      limit: 40,
      weight: 1,
      resetsAt: resetsAt.toISOString(),
    },
    Math.round((resetsAt.getTime() - Date.now()) / 1000),
  );
  await signInManaged(page, server.url);

  await page.goto(`${server.url}/add/photo`);
  await photographOnePlate(page);
  await expect(page.getByText(EN.scan.errors.titles.quotaSpent)).toBeVisible({ timeout: 10_000 });
  expect(proxy.calls, 'the scan never reached the proxy').toBeGreaterThan(0);
  // THE INSTANCE SELLS PLANS and the account holds no paid window, so the sentence ends at the plans.
  const sentence = fill(EN.scan.errors.provider.allowanceSpentWeekPlans, { ...moment });
  await expect(page.getByText(sentence).first()).toBeVisible();
  // THE CONTROLS: it is neither the daily sentence nor the weekly one without the plans.
  await expect(page.getByText(EN.scan.errors.provider.allowanceSpentPlans)).toHaveCount(0);
  await expect(
    page.getByText(fill(EN.scan.errors.provider.allowanceSpentWeek, { ...moment }), { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/tomorrow/i)).toHaveCount(0);
});

test('control: a spent day keeps the daily sentence and says tomorrow', async ({ page }) => {
  test.setTimeout(90_000);
  const resetsAt = nextMidnightUtc();
  await routeManagedCore(page, dailyStub(resetsAt));
  await routeSpentProxy(
    page,
    {
      error: `daily quota spent: 10 of 10 units used, and this request needs 1. It resets at ${resetsAt.toISOString()}.`,
      code: 'ai-quota-spent',
      period: 'day',
      used: 10,
      limit: 10,
      weight: 1,
      resetsAt: resetsAt.toISOString(),
    },
    Math.round((resetsAt.getTime() - Date.now()) / 1000),
  );
  await signInManaged(page, server.url);

  await page.goto(`${server.url}/add/photo`);
  await photographOnePlate(page);
  await expect(page.getByText(EN.scan.errors.titles.quotaSpent)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(EN.scan.errors.provider.allowanceSpentPlans).first()).toBeVisible();
  await expect(page.getByText(/tomorrow/i).first()).toBeVisible();
});
