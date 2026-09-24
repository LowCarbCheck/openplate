/**
 * A cold, slow load of the body font moves nothing (M256 spec 03).
 *
 * THE FAILURE THIS GUARDS. On the GitHub runner, `no-shift-on-load.spec.ts` and
 * `scans-used-line.spec.ts` failed every run while the local gate passed them on the same commit.
 * The runner painted the page before the Victor Mono `latin` file arrived, in a narrower face.
 * The invite card's one-line description ("Set a password and your diary is ready.") fitted one
 * line in that face and wrapped in Victor Mono, so the swap pushed the loading block down 20 px, a
 * score of 0.0068 every run. The header's zero-scans line grew 12 px wide on the same swap. The
 * local host never saw it: its fallback face was nearly as wide as Victor Mono, so nothing
 * reflowed. A person on a first visit with an empty cache meets the same swap.
 *
 * HOW THE CONDITION IS FORCED. The `latin` file of Victor Mono is held back for 700 ms, as
 * `lcc-lineage-turkish-first-paint.spec.ts` holds the `latin-ext` file, so the first paint is
 * certain to happen in the fallback face and the swap is certain to happen after it. Without the
 * hold a fast local server delivers the file before the first paint and there is no swap to
 * measure. Each check first proves the hold worked: the first contentful paint came before the
 * file's last byte. Then it requires a layout-shift total of 0 across the whole load, every entry
 * counted, the wordmark's included.
 *
 * WHAT MAKES IT PASS. `app/app.css` declares `Victor Mono Fallback`, a `local()` face of a common
 * fixed-width font, scaled and given Victor Mono's own line metrics, and names it right after
 * Victor Mono in the body and brand stacks. Its glyphs are as wide as Victor Mono's, so a line
 * breaks at the same character in both faces and the swap redraws glyphs without moving a box.
 * `tests/e2e/fonts.conf` makes sure the face is there on the test machine.
 *
 * MEASURED (2026-09-24, production build, headless Chromium at 390 px). THE CONTROLS, all failing:
 *  - before the fix, with `monospace` pointed at a proportional face (Liberation Sans) as a
 *    stand-in for the runner's unknown face: the invite card 0.0041, "Setting up your account"
 *    pushed down 20 px, the same element and distance the runner logged at 0.0068; the zero-scans
 *    header 0.047 and the diary 0.044. The two original checks failed the way they fail on the
 *    runner, with no file held at all.
 *  - before the fix, on the laptop's old fallback (Cascadia Code, 0.586 em): the invite card passed,
 *    which is why the laptop never saw it; the zero-scans header 0.0003, the diary 0.00005.
 *  - with the fix but `Victor Mono Fallback` taken out of the stacks, on `fonts.conf`'s Liberation
 *    Mono: 0.0002, 0.026 and 0.017. The same width is not enough; the line metrics matter too.
 *  - a preload without `crossOrigin`: the file was fetched twice.
 * With the fix, all three read 0, on Liberation Mono and on the proportional stand-in alike.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_SYNC_SERVER_URL } from './env';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames } from './layout-shift';
import { routeManagedCore, signInManaged, trialAccountStub, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { createGate, MONTHLY_SUBSCRIBER_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** How long the Victor Mono `latin` file is held back, so the first paint is the fallback face. */
const LATIN_HOLD_MS = 700;

/** The Victor Mono file every English page needs, as the build names it before its hash. */
const VICTOR_MONO_LATIN = 'victor-mono-latin-wght-normal';

/** A paying member with invitations left, as `no-shift-on-load.spec.ts` uses. */
const PAID_MEMBER: ManagedCoreStub = {
  trialScans: null,
  allowanceExpiresAt: '2030-01-01T00:00:00.000Z',
  dailyAiLimit: 20,
  invitesLeft: 2,
  invitesNeedAPlan: false,
  memberInvites: true,
  planView: MONTHLY_SUBSCRIBER_VIEW,
};

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/**
 * Holds every request for the Victor Mono `latin` file, the preload and the stylesheet's own.
 *
 * @param page - a page that has not made the navigation under test yet.
 */
async function holdVictorMonoLatin(page: Page): Promise<void> {
  await page.route(new RegExp(`${VICTOR_MONO_LATIN}.*\\.woff2`, 'u'), async (route) => {
    await new Promise<void>((resolve) => setTimeout(resolve, LATIN_HOLD_MS));
    await route.continue();
  });
}

/** When the page first drew text, when the Victor Mono `latin` file finished arriving, and how it was asked for. */
interface PaintAndFont {
  firstContentfulPaint: number | null;
  latinResponseEnd: number | null;
  /** How many times the network fetched the `latin` file: once, when the preload and the stylesheet agree. */
  latinFetches: number;
  /** Whether the document head preloads the `latin` file as a font. */
  isLatinPreloaded: boolean;
}

/**
 * Waits for every font face to settle, then reads the paint and the font file timings.
 *
 * @param page - a loaded page.
 * @returns the two timestamps.
 */
async function readPaintAndFont(page: Page): Promise<PaintAndFont> {
  return page.evaluate(async (file) => {
    await document.fonts.ready;
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const fetches = performance.getEntriesByType('resource').filter((entry) => entry.name.includes(file));
    const fetched = fetches[0];
    const preloads = [...document.head.querySelectorAll('link[rel="preload"][as="font"]')];
    return {
      firstContentfulPaint: paint === undefined ? null : paint.startTime,
      // `duration` is `responseEnd - startTime`, which needs no cast to `PerformanceResourceTiming`.
      latinResponseEnd: fetched === undefined ? null : fetched.startTime + fetched.duration,
      latinFetches: fetches.length,
      isLatinPreloaded: preloads.some((link) => (link.getAttribute('href') ?? '').includes(file)),
    };
  }, VICTOR_MONO_LATIN);
}

/**
 * Requires that the page painted before the held file arrived, so a swap happened after the first
 * paint, and that the whole load recorded no layout shift.
 *
 * @param page - a loaded page with the observer installed and the file held.
 */
async function expectSwapMovedNothing(page: Page): Promise<void> {
  const timing = await readPaintAndFont(page);
  await settleFrames(page);
  test.info().annotations.push({ type: 'measured', description: JSON.stringify(timing) });
  expect(timing.firstContentfulPaint, 'the page never painted').not.toBeNull();
  expect(timing.latinResponseEnd, 'the Victor Mono latin file was never fetched').not.toBeNull();
  // THE HOLD WORKED: without this, a file served before the first paint would make the check below
  // pass without a swap ever happening.
  expect(timing.firstContentfulPaint ?? 0).toBeLessThan(timing.latinResponseEnd ?? 0);
  // THE PRELOAD IS THE SAME REQUEST as the stylesheet's: a preload in the wrong CORS mode, or of a
  // different URL, would be a second download of the same file.
  expect(timing.isLatinPreloaded, 'the head does not preload the Victor Mono latin file').toBe(true);
  expect(timing.latinFetches, 'the Victor Mono latin file was fetched more than once').toBe(1);

  const entries = await readShiftEntries(page);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const detail = entries.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`).join('\n');
  expect(total, detail).toBe(0);
}

test('the invite card on /join does not move when Victor Mono arrives late', async ({ page }) => {
  await installShiftObserver(page);
  await routeManagedCore(page, PAID_MEMBER);
  await holdVictorMonoLatin(page);
  const lookup = createGate();
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/auth/invite-lookup`, async (route) => {
    await lookup.promise;
    await route.fulfill({
      json: { email: 'invited@example.invalid', displayName: null, expiresAt: '2030-01-01T00:00:00.000Z' },
    });
  });

  await page.goto(`${server.url}/join#server=${encodeURIComponent(E2E_SYNC_SERVER_URL)}&invite=si_fontswapnoshift001`);
  await expect(page.getByText(EN.join.working)).toBeVisible();
  // The swap lands HERE, while the card still shows its loading block, which is where the runner
  // saw the block pushed down.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
  lookup.open();
  await expect(page.getByText(fill(EN.join.invitedAs, { email: 'invited@example.invalid' }))).toBeVisible();

  await expectSwapMovedNothing(page);
});

test('the zero-scans header line does not move when Victor Mono arrives late', async ({ page }) => {
  await routeManagedCore(page, trialAccountStub(0));
  await signInManaged(page, server.url);
  await installShiftObserver(page);
  await holdVictorMonoLatin(page);
  await page.goto(`${server.url}/diary`);

  await expect(page.locator('header [data-slot="header-status"]')).toContainText(EN.plan.countdown.scansUsed, {
    timeout: 10_000,
  });
  await page.waitForLoadState('networkidle');

  await expectSwapMovedNothing(page);
});

test('the diary does not move when Victor Mono arrives late', async ({ page }) => {
  await routeManagedCore(page, PAID_MEMBER);
  await signInManaged(page, server.url);
  await installShiftObserver(page);
  await holdVictorMonoLatin(page);
  await page.goto(`${server.url}/diary`);

  await expect(page.locator('main')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await expectSwapMovedNothing(page);
});
