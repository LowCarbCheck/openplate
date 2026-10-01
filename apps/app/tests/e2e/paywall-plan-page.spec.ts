/**
 * The plan page as the paywall's destination (owner decision, 2026-09-28).
 *
 * A locked person lands here, so the page says why above the plans, and says
 * that the data stays theirs with a way to take it out or delete it. A person
 * with free scans left is offered the way back to them. A person back from a
 * payment is told when the plan is active, polled every two seconds, and sent
 * on to the diary.
 *
 * NO LAYOUT SHIFT (the operator's rule): the notice arrives in the same paint
 * as the plans it heads, and the line that answers a payment return keeps one
 * box through all three of its states. Both are measured the way `DESIGN.md`
 * section 7 says, with `getBoundingClientRect` before and after and a
 * `layout-shift` total of 0, and each measurement has a control that moves
 * something on purpose and must read as moved.
 *
 * WHAT IS STUBBED: the core (`managed-core-stub.ts`), with the offer held
 * where a reading has to be taken before it lands.
 *
 * THE BUYER WALK (2026-09-28) found two defects after a real payment, and each
 * has a check below that failed on main 2ede284:
 *
 * 1. A return that went slow and was asked again drew "Check again" under
 *    "Open your diary", both painted, in the one reserved box. Only the state
 *    the poll is in may be drawn.
 * 2. "Open your diary" (a client navigation) showed the pre-payment free-scans
 *    line in the header, with its "See plans", until a reload. The header's
 *    standing must follow the confirmed plan.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { PAYMENT_POLL_DEADLINE_MS, PAYMENT_POLL_INTERVAL_MS } from '../../app/lib/plans/payment-return';
import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_CORE_URL } from './env';
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
import {
  createGate,
  FIXTURE_OFFER_BODY,
  MONTHLY_SUBSCRIBER_VIEW,
  NO_SUBSCRIPTION_VIEW,
  YEARLY_SUBSCRIBER_VIEW,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The checkout walk polls for several seconds on top of a sign-in. */
const WALK_BUDGET_MS = 90_000;

const COPY = z
  .object({
    paywall: z.object({
      heading: z.object({ scansUsed_other: z.string() }),
      body: z.string(),
      freeScansFirst: z.string(),
      returned: z.object({ active: z.string(), openDiary: z.string(), slow: z.string(), checkAgain: z.string() }),
    }),
    plan: z.object({ countdown: z.object({ action: z.string(), scansUsed: z.string() }) }),
    meta: z.object({ dashboard: z.string() }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A member whose ten free scans are spent, with no plan: locked. */
function spentCore(overrides: Partial<ManagedCoreStub> = {}): ManagedCoreStub {
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

function notice(page: Page) {
  return page.locator('[data-slot="paywall-notice"]');
}

function returnLine(page: Page) {
  return page.locator('[data-slot="plan-return"]');
}

/** The header's status row, where the trial countdown is drawn. */
function headerStatus(page: Page) {
  return page.locator('header [data-slot="header-status"]');
}

/** One control inside the return line, as the page paints it. */
interface PaintedControl {
  text: string;
  /** `checkVisibility` with visibility and opacity: drawn on screen, whatever the accessibility tree says. */
  isPainted: boolean;
  top: number;
  bottom: number;
}

/**
 * Every button and link in the return line, read by PAINT, not by role.
 *
 * A hidden state is also `aria-hidden`, so a role query never finds its
 * button whether it is painted or not, and would pass against the defect.
 * This reads what a person sees.
 */
async function paintedControls(page: Page): Promise<PaintedControl[]> {
  return returnLine(page).evaluate((root) =>
    [...root.querySelectorAll('a, button')].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        text: (element.textContent ?? '').trim(),
        isPainted: element.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
        top: box.top,
        bottom: box.bottom,
      };
    }),
  );
}

/** A device past onboarding and signed in, wherever the sign-in's navigation ended. */
async function signIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|settings\/plan)$/);
}

/**
 * Starts recording, on every frame, each control of the return line that is
 * PAINTED while its state is hidden (`aria-hidden`). A state change that
 * leaves a button drawn for a moment is invisible to a reading taken after
 * the page settles; this sees a single frame of it.
 */
async function watchHiddenStatePaints(page: Page): Promise<void> {
  await page.evaluate(() => {
    const painted = new Set<string>();
    Object.defineProperty(window, '__hiddenStatePaints', { value: painted, configurable: true });
    const sample = (): void => {
      const root = document.querySelector('[data-slot="plan-return"]');
      const controls = root?.querySelectorAll('[aria-hidden="true"] a, [aria-hidden="true"] button') ?? [];
      for (const control of controls) {
        if (control.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
          painted.add((control.textContent ?? '').trim());
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** What {@link watchHiddenStatePaints} has recorded so far. */
async function readHiddenStatePaints(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__hiddenStatePaints')?.value;
    return recorded instanceof Set ? [...recorded].map(String) : [];
  });
}

/**
 * Lets the spec move the page's `Date.now` forward, before the page loads.
 *
 * The return polls for a minute, measured with `Date.now`, before it says the
 * payment may take a while. A spec about what happens AFTER that minute moves
 * the page's clock over it instead of waiting it out. Only `Date.now` moves;
 * every timer runs in real time, so the poll keeps its real two seconds.
 * (Playwright's own `page.clock` failed here with an internal TypeError on
 * `fastForward`, 1.62.1.)
 */
async function installClockShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const realNow = Date.now.bind(Date);
    let shiftMs = 0;
    Object.defineProperty(window, '__shiftClock', {
      value: (ms: number) => {
        shiftMs += ms;
      },
    });
    Date.now = () => realNow() + shiftMs;
  });
}

/** Moves the page's `Date.now` forward by `ms`. */
async function shiftClock(page: Page, ms: number): Promise<void> {
  await page.evaluate((shiftBy) => {
    const shift = Object.getOwnPropertyDescriptor(window, '__shiftClock')?.value;
    if (!(shift instanceof Function)) throw new Error('installClockShift was not called before this page loaded');
    shift(shiftBy);
  }, ms);
}

/** Holds every offer read until the returned gate is opened. Registered after the stub, so it answers first. */
async function holdTheOffer(page: Page) {
  const gate = createGate();
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/plans/offer`),
    async (route) => {
      await gate.promise;
      await route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE_OFFER_BODY });
    },
  );
  return gate;
}

/** Pushes the top of `main` down by 40 px, the way a late line would. */
async function pushMainDown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '40px';
    document.querySelector('main')?.prepend(spacer);
  });
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('a locked person reads why, above the plans, and how to take the data out, and nothing moves', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, spentCore());
  const offer = await holdTheOffer(page);
  await signIn(page);
  await expect(page).toHaveURL(/\/settings\/plan$/);

  // The offer is held, so nothing below the header is drawn yet.
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(0);
  await settleAnimations(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  offer.open();
  await expect(notice(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2);
  const topsOnArrival = await readTops(page);
  await settleAnimations(page);
  const topsSettled = await readTops(page);

  expect(movedBetween(topsOnArrival, topsSettled), 'something moved after the notice arrived').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while the page filled').toBe(0);

  // ── What it says ────────────────────────────────────────────────────
  await expect(notice(page).locator('h2')).toHaveText(fill(COPY.paywall.heading.scansUsed_other, { count: '10' }));
  await expect(notice(page)).toContainText(COPY.paywall.body);
  await expect(notice(page).locator('a[href="/settings/data"]')).toBeVisible();
  await expect(notice(page).locator('a[href="/settings/account"]')).toBeVisible();
  // Above the plans it heads.
  const noticeBox = await notice(page).boundingBox();
  const firstCard = await page.locator('[data-slot="plan-card"]').first().boundingBox();
  if (noticeBox === null || firstCard === null) throw new Error('the notice or the first plan card has no box');
  expect(noticeBox.y + noticeBox.height, 'the notice sits below the plans').toBeLessThanOrEqual(firstCard.y);
  // A locked person is not offered free scans they do not have.
  await expect(page.getByRole('link', { name: COPY.paywall.freeScansFirst })).toHaveCount(0);

  // THE CONTROL for both readings above: a line pushed in above the page
  // after the fact must read as moved, and as a shift.
  const shiftsBeforeControl = (await readShiftEntries(page)).length;
  await pushMainDown(page);
  await settleFrames(page);
  expect(movedBetween(topsSettled, await readTops(page)).length, 'the control moved nothing').toBeGreaterThan(0);
  expect(
    shiftScoreAfter(await readShiftEntries(page), shiftsBeforeControl),
    'the control was no shift',
  ).toBeGreaterThan(0);

  // The data line's link works while locked.
  await notice(page).locator('a[href="/settings/data"]').click();
  await expect(page).toHaveURL(/\/settings\/data$/);
});

test('with free scans left, the plan page offers them first, and that link opens the diary', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, spentCore({ trialScans: { granted: 10, left: 4 } }));
  await signIn(page);
  await page.goto('/settings/plan');
  await expect(page.locator('[data-slot="plan-card"]')).toHaveCount(2, { timeout: 10_000 });

  // No notice: nothing is locked.
  await expect(notice(page)).toHaveCount(0);
  const link = page.getByRole('link', { name: COPY.paywall.freeScansFirst, exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle(COPY.meta.dashboard);
});

test('back from a payment, the page polls until the plan is active, and the diary opens', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = spentCore();
  await routeManagedCore(page, stub);
  await signIn(page);
  await expect(page).toHaveURL(/\/settings\/plan$/);

  // THE WEBHOOK LANDS LATE: every read answers "no plan" until two poll
  // intervals after the return, and "active" from then on.
  let flipAt = Number.POSITIVE_INFINITY;
  const readsAt: number[] = [];
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, (route) => {
    readsAt.push(Date.now());
    return route.fulfill({ json: Date.now() >= flipAt ? MONTHLY_SUBSCRIBER_VIEW : NO_SUBSCRIPTION_VIEW });
  });

  const returnedAt = Date.now();
  flipAt = returnedAt + 4_500;
  await page.goto('/settings/plan?checkout=success');

  // ── Checking: the box is there, and holds its size ──────────────────
  await expect(returnLine(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(EN.plan.returned.success)).toBeVisible();
  // Nothing is sold while the payment is being confirmed.
  await expect(page.locator('[data-slot="plan-order-button"]')).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  await waitForFonts(page);
  await settleAnimations(page);
  const boxChecking = await returnLine(page).boundingBox();
  const shiftsBefore = (await readShiftEntries(page)).length;

  // ── Active ──────────────────────────────────────────────────────────
  await expect(page.getByText(COPY.paywall.returned.active, { exact: true })).toBeVisible({ timeout: 15_000 });
  const boxActive = await returnLine(page).boundingBox();
  expect(boxActive, 'the return line changed its box').toEqual(boxChecking);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift when the plan turned active').toBe(
    0,
  );
  expect(
    readsAt.filter((at) => at >= returnedAt).length,
    'the page read the plan once or twice rather than polling it',
  ).toBeGreaterThanOrEqual(3);
  await expect(page.locator('[data-slot="plan-status-card"]')).toBeVisible();

  // ── The diary opens, and the gate agrees ────────────────────────────
  await page.getByRole('link', { name: COPY.paywall.returned.openDiary, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle(COPY.meta.dashboard);

  // ── And the header agrees (the buyer walk's second defect) ──────────
  // The shell has been mounted since the return, and its countdown read the
  // plan before the webhook landed. On main it drew "Free AI scans used" and
  // "See plans" here, over a plan the page above had just called active.
  await expect(headerStatus(page), 'the pre-payment countdown greeted a subscriber').toHaveCount(0);
  await expect(page.getByRole('button', { name: COPY.plan.countdown.action, exact: true })).toHaveCount(0);
  await expect(page.locator('header h1')).toBeVisible();

  // THE CONTROL: the same header, once the biller says "no plan" again and
  // the page is loaded where a locked person may stand, draws the line this
  // check looks for. So the absence above is the confirmed plan, not a header
  // that never draws the countdown.
  flipAt = Number.POSITIVE_INFINITY;
  await page.goto('/settings/preferences');
  await expect(headerStatus(page)).toContainText(COPY.plan.countdown.scansUsed, { timeout: 10_000 });
  await expect(page.getByRole('button', { name: COPY.plan.countdown.action, exact: true })).toBeVisible();
});

test('a slow return asked again draws only the active state, in the one box, and nothing moves', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, spentCore());
  await signIn(page);
  await expect(page).toHaveURL(/\/settings\/plan$/);

  // The biller answers "no plan" until the spec says the webhook landed.
  let isActive = false;
  const readsAt: number[] = [];
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, (route) => {
    readsAt.push(Date.now());
    return route.fulfill({ json: isActive ? YEARLY_SUBSCRIBER_VIEW : NO_SUBSCRIPTION_VIEW });
  });

  // THE MINUTE OF ASKING passes in a jump of the page's clock rather than a
  // real minute; the poll's two seconds stay real.
  await installClockShift(page);
  const returnedAt = Date.now();
  await page.goto('/settings/plan?checkout=success');
  await expect(page.getByText(EN.plan.returned.success)).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => readsAt.filter((at) => at >= returnedAt).length, { timeout: 10_000 }).toBeGreaterThan(0);

  // ── Slow: the minute passed without the plan ────────────────────────
  await shiftClock(page, PAYMENT_POLL_DEADLINE_MS);
  await expect(page.getByText(COPY.paywall.returned.slow, { exact: true })).toBeVisible({
    timeout: PAYMENT_POLL_INTERVAL_MS * 3,
  });
  const checkAgain = page.getByRole('button', { name: COPY.paywall.returned.checkAgain, exact: true });
  await expect(checkAgain).toBeVisible();
  await waitForFonts(page);
  await settleAnimations(page);
  const boxSlow = await returnLine(page).boundingBox();
  const topsSlow = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  // ── Asked again, and the plan is there ──────────────────────────────
  await watchHiddenStatePaints(page);
  isActive = true;
  await checkAgain.click();
  const openDiary = page.getByRole('link', { name: COPY.paywall.returned.openDiary, exact: true });
  await expect(openDiary).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(COPY.paywall.returned.active, { exact: true })).toBeVisible();
  await settleAnimations(page);

  // ONE STATE IN THE BOX, IN EVERY FRAME: no control of a hidden state was
  // drawn on the way from slow through checking to active.
  expect(await readHiddenStatePaints(page), 'a hidden state painted its control').toEqual([]);
  // And once settled, the only control painted is the way to the diary.
  const painted = (await paintedControls(page)).filter((control) => control.isPainted);
  expect(
    painted.map((control) => control.text),
    'the return line painted a control of a state it is not in',
  ).toEqual([COPY.paywall.returned.openDiary]);
  // And what a finger meets at the middle of that link is the link.
  const isLinkOnTop = await openDiary.evaluate((link) => {
    const box = link.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && link.contains(hit);
  });
  expect(isLinkOnTop, 'something is drawn over "Open your diary"').toBe(true);

  // NOTHING MOVED: the box held its size through slow, checking and active.
  expect(await returnLine(page).boundingBox(), 'the return line changed its box').toEqual(boxSlow);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift when the plan turned active').toBe(
    0,
  );
  expect(movedBetween(topsSlow, await readTops(page)), 'something on the page moved').toEqual([]);

  // THE CONTROL for the paint reading: a hidden state's button made visible
  // on purpose must read as painted, so the reading above can see the defect.
  await returnLine(page).evaluate((root) => {
    for (const hidden of root.querySelectorAll<HTMLElement>('[aria-hidden="true"] button')) {
      hidden.style.visibility = 'visible';
    }
  });
  const forced = (await paintedControls(page)).filter((control) => control.isPainted).map((control) => control.text);
  expect(forced, 'the paint reading cannot see a painted hidden-state button').toContain(
    COPY.paywall.returned.checkAgain,
  );
  await expect
    .poll(() => readHiddenStatePaints(page), { message: 'the frame watch cannot see a painted hidden-state button' })
    .toContain(COPY.paywall.returned.checkAgain);
});

test('THE CONTROL for the poll: a return whose plan never turns active never says it is active', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, spentCore());
  await signIn(page);
  const readsAt: number[] = [];
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, (route) => {
    readsAt.push(Date.now());
    return route.fulfill({ json: NO_SUBSCRIPTION_VIEW });
  });
  const returnedAt = Date.now();
  await page.goto('/settings/plan?checkout=success');
  await expect(page.getByText(EN.plan.returned.success)).toBeVisible({ timeout: 10_000 });
  // Long enough for three polls, which is what the case above needed.
  await expect
    .poll(() => readsAt.filter((at) => at >= returnedAt).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);
  await expect(page.getByText(COPY.paywall.returned.active, { exact: true })).toBeHidden();
  await expect(page.getByRole('link', { name: COPY.paywall.returned.openDiary, exact: true })).toBeHidden();
});

/** Waits for the page's fonts, so a font swap in the header is not read as the page moving. */
async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
