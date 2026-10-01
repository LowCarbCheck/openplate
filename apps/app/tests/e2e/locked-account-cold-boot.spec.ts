/**
 * A locked account's cold start paints the plan page, never the diary (M265 spec 10).
 *
 * THE REPORT (sign-off of the paid launch, 2026-09-28). On app.openplate.de a
 * person whose free scans were used up opened the app from cold, a fresh load
 * of `/` or of a diary address, and saw the diary for about a second before
 * the plan page replaced it.
 *
 * A SCREENSHOT MISSES A FLASH, so this file samples the DOM instead. An init
 * script, installed before any page script runs, labels what is on screen on
 * every animation frame and on every DOM change: the diary (one of
 * {@link DIARY_CONTENT}), the boot splash, a gate's page (the plan page or the
 * consent screen), or something else. It keeps every change of label with the
 * instant it was first seen, measured from the start of the navigation.
 *
 * WHAT IS REAL: the production build, the fake core server's session, the
 * saved session a reload reopens, the `_personal` layout, the plan page and
 * the consent screen. WHAT IS STUBBED (`managed-core-stub.ts`): the handshake,
 * `GET /plans/me` and the account facts on every auth answer.
 *
 * EVERY CLAIM HAS A CONTROL that makes it able to fail:
 *
 * - "no diary frame" would pass against a sampler that never sees the diary,
 *   so an account with free scans left is loaded the same way, and the same
 *   sampler must see the diary there. That test also prints the time to its
 *   first diary frame, the number a fix must not make worse.
 * - "nothing but the splash before the plan page" would pass against a
 *   sampler that labels everything as the splash, so a public page, which
 *   draws neither, must read as something else.
 * - the exempt export page is loaded by the SAME locked account, whose control
 *   load of a feature page has just ended on the plan page, so the export is
 *   open because it is exempt and not because the gate is asleep.
 * - all of it failed before the fix: every cold path painted the diary for
 *   60 to 75 ms here, where the stubbed network answers at once, and the swap
 *   from the diary to the plan page moved the plan page 45 px (a layout-shift
 *   score of 0.049 on each of the three paths). With the splash held until
 *   the plan page, nothing moves.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding } from './helpers';
import { installShiftObserver, readShiftEntries, settleFrames } from './layout-shift';
import { routeManagedCore, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** A sign-in and three cold loads outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/**
 * How long a page that should stay put is watched once the plan facts it
 * could be locked by have arrived. The redirect it must not make would come
 * within one loader run.
 */
const OPEN_WATCH_MS = 1_200;

/** How many cold loads the unlocked control times, so one slow load does not decide the number. */
const TIMED_LOADS = 5;

/**
 * What counts as diary content: the diary's date row, meal groups and empty
 * states, and the home screen's week tile, which it always draws. Neither the
 * plan page nor the consent screen draws any of these.
 */
const DIARY_CONTENT = [
  '[data-slot="date-nav"]',
  '[data-slot="meal-group"]',
  '[data-slot="diary-empty-first-ever"]',
  '[data-slot="diary-empty-welcome-back"]',
  '[data-slot="week-glance-card"]',
].join(', ');

/** The pages a gate sends a person to: the paywall's and the consent gate's. */
const GATE_PAGES = ['/settings/plan', '/consent'] as const;

/** The one string this file reads, from the shipped English bundle, so no wording is pinned here. */
const COPY = z
  .object({ settings: z.object({ data: z.object({ downloadJson: z.string() }) }) })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The window property the sampler writes to. */
const SAMPLER_KEY = '__coldBootFrames';

/** The cold paths a real browser takes into the app: the root, which the home hint sends on, and two app addresses. */
const COLD_PATHS = ['/', '/diary', '/dashboard'] as const;

/** One change of what is on screen. */
const frameEntrySchema = z.object({
  label: z.enum(['diary', 'splash', 'gate', 'other']),
  /** Milliseconds since the navigation started, `performance.now()` in the page. */
  at: z.number(),
});

/** What the sampler recorded in one document. */
const samplerReadingSchema = z.object({
  /** Read on every animation frame, so this is what was painted. */
  frames: z.array(frameEntrySchema),
  /** Read on every DOM change, so this also holds content that was gone again before a frame. */
  mutations: z.array(frameEntrySchema),
});

type FrameEntry = z.infer<typeof frameEntrySchema>;
type SamplerReading = z.infer<typeof samplerReadingSchema>;

/** A member whose ten free scans are spent, with no plan: the standing the sign-off saw. */
const LOCKED_CORE: ManagedCoreStub = {
  trialScans: { granted: 10, left: 0 },
  allowanceExpiresAt: null,
  dailyAiLimit: 20,
  invitesLeft: null,
  memberInvites: false,
  planView: NO_SUBSCRIPTION_VIEW,
};

/** The same member with four free scans left, which never locks. */
const UNLOCKED_CORE: ManagedCoreStub = { ...LOCKED_CORE, trialScans: { granted: 10, left: 4 } };

/**
 * Installs the sampler in every document this page opens from now on, before
 * any of the page's own scripts run.
 *
 * @param page - the page, before the navigation to be sampled.
 */
async function installSampler(page: Page): Promise<void> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE. It cannot see this
  // module's scope, so its helpers cannot move out of it.
  // oxlint-disable unicorn/consistent-function-scoping
  await page.addInitScript(
    ({
      diaryContent,
      gatePages,
      samplerKey,
    }: {
      diaryContent: string;
      gatePages: readonly string[];
      samplerKey: string;
    }) => {
      type Label = 'diary' | 'splash' | 'gate' | 'other';
      const frames: { label: Label; at: number }[] = [];
      const mutations: { label: Label; at: number }[] = [];
      Object.defineProperty(window, samplerKey, { value: { frames, mutations } });
      const isShown = (element: Element): boolean => {
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      const classify = (): Label => {
        for (const element of document.querySelectorAll(diaryContent)) {
          if (isShown(element)) return 'diary';
        }
        // The boot splash is `AppLoading`, the one screen that carries the
        // hidden "could not load" line.
        const splash = document.querySelector('[data-boot-failed-line]')?.closest('output');
        if (splash && isShown(splash)) return 'splash';
        if (gatePages.includes(location.pathname)) return 'gate';
        return 'other';
      };
      const note = (log: { label: Label; at: number }[]): void => {
        const label = classify();
        if (log.at(-1)?.label === label) return;
        log.push({ label, at: Math.round(performance.now()) });
      };
      const onFrame = (): void => {
        note(frames);
        requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
      new MutationObserver(() => note(mutations)).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    },
    { diaryContent: DIARY_CONTENT, gatePages: [...GATE_PAGES], samplerKey: SAMPLER_KEY },
  );
  // oxlint-enable unicorn/consistent-function-scoping
}

/** Reads what the sampler recorded in the document on screen. */
async function readSampler(page: Page): Promise<SamplerReading> {
  const recorded = await page.evaluate((key) => Object.getOwnPropertyDescriptor(window, key)?.value, SAMPLER_KEY);
  return samplerReadingSchema.parse(recorded);
}

/** The first entry with this label, or `undefined`. */
function firstOf(log: readonly FrameEntry[], label: FrameEntry['label']): FrameEntry | undefined {
  return log.find((entry) => entry.label === label);
}

/** A reading as one line, for a failure message: `splash@12 diary@480 gate@1320`. */
function describeLog(log: readonly FrameEntry[]): string {
  return log.map((entry) => `${entry.label}@${entry.at}`).join(' ');
}

/**
 * Asserts a cold load that ended on a gate's page showed nothing of the diary
 * on the way, and nothing but the boot splash before that page.
 *
 * Soft, so one run reports every cold path that failed and not only the first.
 */
function expectNoDiaryOnTheWay(reading: SamplerReading, from: string): void {
  const diaryFrame = firstOf(reading.frames, 'diary');
  const diaryInDom = firstOf(reading.mutations, 'diary');
  expect
    .soft(
      diaryFrame,
      `${from} painted the diary at ${diaryFrame?.at} ms, before the gate: ${describeLog(reading.frames)}`,
    )
    .toBeUndefined();
  expect
    .soft(diaryInDom, `${from} put the diary in the page at ${diaryInDom?.at} ms: ${describeLog(reading.mutations)}`)
    .toBeUndefined();

  // NOTHING BUT THE SPLASH UNTIL THE GATE'S PAGE: a blank frame, or any other
  // screen, between the two is a flash of a different kind.
  const gateAt = reading.frames.findIndex((entry) => entry.label === 'gate');
  const beforeGate = reading.frames.slice(0, gateAt === -1 ? undefined : gateAt);
  expect
    .soft(
      beforeGate.map((entry) => entry.label),
      `${from} drew something other than the splash before the gate's page: ${describeLog(reading.frames)}`,
    )
    .toEqual(['splash']);
}

/**
 * A device past onboarding, signed in, and wherever the sign-in's own
 * navigation ended: the diary, the plan page when the account is locked, or
 * the consent screen when it has not agreed.
 *
 * @returns the pathname it landed on.
 */
async function signIn(page: Page): Promise<string> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|settings\/plan|consent\?next=[^#]*)$/);
  return new URL(page.url()).pathname;
}

/** Asserts the plan page is on screen with its paywall notice and the two plans to pick from. */
async function expectPlanPage(page: Page, from: string): Promise<void> {
  await expect(page, `${from} did not end on the plan page`).toHaveURL(/\/settings\/plan$/, { timeout: 10_000 });
  await expect(page.locator('[data-slot="paywall-notice"]'), `${from}: the paywall notice`).toBeVisible();
  await expect(page.locator('[data-slot="plan-card"]'), `${from}: the plan choice`).toHaveCount(2);
}

/** Resolves when the plan read of THIS page has been answered. Registered before the navigation it anchors. */
async function planRead(page: Page): Promise<void> {
  await page.waitForResponse((response) => response.url() === `${E2E_SYNC_SERVER_URL}/v1/plans/me`);
}

/** The middle value of a list of timings. */
function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

test('a locked account: a cold load of each app address paints no diary before the plan page', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, LOCKED_CORE);
  expect(await signIn(page), 'the sign-in of a locked account landed past the paywall').toBe('/settings/plan');
  await expectPlanPage(page, 'the sign-in');
  await installSampler(page);
  await installShiftObserver(page);

  for (const path of COLD_PATHS) {
    await page.goto(path);
    await expectPlanPage(page, `a cold load of ${path}`);
    expectNoDiaryOnTheWay(await readSampler(page), `a cold load of ${path}`);
    // NO LAYOUT SHIFT from the first paint to the plan page. Every entry
    // counts, see `layout-shift.ts`: the goto is not a tap on the page.
    await settleFrames(page);
    const shifts = await readShiftEntries(page);
    expect
      .soft(
        shifts.reduce((total, entry) => total + entry.value, 0),
        `a cold load of ${path} moved: ${shifts.flatMap((entry) => entry.sources).join('; ')}`,
      )
      .toBe(0);
  }
});

test('a locked account that never agreed meets the consent screen first on a cold load, and no diary', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  const version = '2026-09-28';
  await routeManagedCore(page, { ...LOCKED_CORE, healthConsent: { version }, accountHealthConsent: null });
  // The plan read the consent screen's own layout makes, which is where this
  // device learns that the account is locked.
  const anchor = planRead(page);
  expect(await signIn(page), 'the plan page came before the consent').toBe('/consent');
  await anchor;
  await settleFrames(page);
  await installSampler(page);

  await page.goto('/diary');
  await expect(page, 'the cold load did not end on the consent screen').toHaveURL(/\/consent\?next=/, {
    timeout: 10_000,
  });
  expectNoDiaryOnTheWay(await readSampler(page), 'a cold load of /diary');
});

test('THE CONTROL: an account with free scans left sees the diary on the same cold loads, and how soon', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, UNLOCKED_CORE);
  expect(await signIn(page), 'the sign-in of an open account was sent to the plan page').toBe('/diary');
  await installSampler(page);

  const firstDiaryFrames: number[] = [];
  for (let load = 1; load <= TIMED_LOADS; load += 1) {
    const anchor = planRead(page);
    await page.goto('/diary');
    await anchor;
    await expect(page.locator('[data-slot="date-nav"]'), `load ${load}: the diary`).toBeVisible();
    const reading = await readSampler(page);
    const diaryFrame = firstOf(reading.frames, 'diary');
    expect(diaryFrame, `load ${load}: the sampler saw no diary frame: ${describeLog(reading.frames)}`).toBeDefined();
    firstDiaryFrames.push(diaryFrame?.at ?? Number.NaN);
  }
  // The number a fix is measured against, printed for the report.
  console.log(
    `first diary frame on a cold load of /diary, ms: ${firstDiaryFrames.join(', ')}; median ${median(firstDiaryFrames)}`,
  );

  // The other two cold paths are seen too, so the locked test's silence on
  // them is not a sampler that only knows the diary page.
  for (const path of ['/', '/dashboard'] as const) {
    const anchor = planRead(page);
    await page.goto(path);
    await anchor;
    await page.waitForTimeout(OPEN_WATCH_MS);
    await expect(page, `a cold load of ${path} was sent away`).toHaveURL(/\/dashboard$/);
    const reading = await readSampler(page);
    expect(firstOf(reading.frames, 'diary'), `${path}: no diary frame: ${describeLog(reading.frames)}`).toBeDefined();
  }
});

test('THE CONTROL: a page that is neither the splash nor a gate reads as something else', async ({ page }) => {
  await installSampler(page);
  await page.goto('/imprint');
  await expect(page.locator('main')).toBeVisible();
  const reading = await readSampler(page);
  expect(reading.frames.map((entry) => entry.label)).toContain('other');
  expect(reading.frames.map((entry) => entry.label)).not.toContain('splash');
});

test('a locked account can still open the export on a cold load', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  await routeManagedCore(page, LOCKED_CORE);
  expect(await signIn(page)).toBe('/settings/plan');

  // THE CONTROL: this account is locked, so the export below is open because
  // it is exempt, not because the gate is asleep.
  await page.goto('/diary');
  await expectPlanPage(page, 'the control load');

  const anchor = planRead(page);
  await page.goto('/settings/data');
  await anchor;
  await page.waitForTimeout(OPEN_WATCH_MS);
  await expect(page, 'the export was sent to the plan page').toHaveURL(/\/settings\/data$/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: COPY.settings.data.downloadJson, exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});
