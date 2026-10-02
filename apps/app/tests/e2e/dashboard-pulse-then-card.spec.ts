/**
 * The What's new card is the last thing on `/dashboard`, and it never moves
 * after it appears, whenever the community pulse tile arrives (DESIGN.md
 * section 7).
 *
 * THE FINDING. The card is the last child of the page, after the pulse tile.
 * The tile is read after first paint, once the session has resumed and a
 * request to the core server has answered, and nothing in the tier served that
 * request, so the order "card first, tile later" was never exercised. When the
 * tile arrives after the card, the card, just placed, is pushed down by the
 * tile's height.
 *
 * THE DEVICE. A signed-in member of the fixture account, sharing a pulse (the
 * toggle on `/settings/sharing`, written the way it writes it), with the card
 * switched on and an older acknowledgement, so both the tile and the card have
 * a reason to draw. The core's `GET /v1/pulse/today` is routed here, because
 * the fake core implements no pulse, and its timing is the variable.
 *
 * FIVE ARRIVALS, at a phone width and at a 1280 px desktop width, each in a window taller than the page:
 *
 *  1. The tile is answered at once.
 *  2. The tile is held until after the moment the card would have mounted, then
 *     answered. A card that mounts first is pushed by it; a card that waits is
 *     not. The wait is a fixed 600 ms, far longer than the card's own two
 *     reads, so on code that mounts the card at once it is already on screen.
 *  3. The pulse answers with a failure: no tile, ever.
 *  4. This device shares nothing, the default: no request at all, no tile.
 *  5. The pulse never answers. The card must still come, after a bounded wait,
 *     and not be held back for as long as the request hangs.
 *
 * TWO READINGS, as section 7 asks. The browser's `layout-shift` entries that
 * name the card, which must sum to 0, and the card's distance below the glance
 * row sampled on EVERY frame it exists, which must be one value. The second
 * reading is the claim in the rule's own words: the card does not move after it
 * appears. Both are scoped to the card, because this page has other late
 * arrivals above it (an award note) that are not the tile and not this spec's.
 *
 * THE CONTROL. A box pushed in above the card must be read as a move by both.
 * Without it the zeros above would pass against a sampler that could not see
 * one.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { WHATS_NEW_STORAGE_KEY } from '#app/lib/whats-new';
import { WHATS_NEW_VISIBLE_KEY } from '#app/lib/whats-new-visibility';

import { E2E_CORE_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import { createGate } from './plans-stub';
import {
  installShiftObserver,
  readShiftEntries,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
} from './layout-shift';

test.use({ serviceWorkers: 'block' });

/**
 * Where the toggle on `/settings/sharing` writes its yes. Transcribed, because
 * `#app/lib/pulse` imports the logger and the sync session and this tier does
 * not load those. The "tile first" case is the control for the literal: a wrong
 * key shows no tile, and that case fails.
 */
const PULSE_ENABLED_STORAGE_KEY = 'openplate:pulse-enabled';

/** The tile's title, off the shipped English catalog. */
const PULSE_TITLE = z
  .object({ pulse: z.object({ tile: z.object({ title: z.string() }) }) })
  .parse(JSON.parse(readFileSync(resolvePath(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8'))).pulse
  .tile.title;

/** The oldest release the bundle ships: an acknowledgement from before, so the card has something to say. */
const OLDEST_VERSION =
  Object.keys(
    z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(resolvePath(process.cwd(), 'app/i18n/locales/en/releases.json'), 'utf8'))),
  )
    .map((key) => key.slice(1).replaceAll('_', '.'))
    .toSorted((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0] ?? '';

/** A day with enough contributors to show the tile. Every figure is a plain number. */
const PULSE_BODY = {
  day: '2026-10-02',
  meals: 12,
  photos: 3,
  kcal: 2400,
  protein: 150,
  contributors: 5,
  fastingNow: 0,
};

/** How long the held pulse waits for the card before it answers, case 2. */
const CARD_HEAD_START_MS = 600;

/** How long case 5 allows for the card to arrive while the pulse hangs. The app's own wait is shorter. */
const HUNG_PULSE_CARD_BUDGET_MS = 10_000;

/** A box large enough to be a move, in the control. */
const CONTROL_BOX_PX = 100;

/**
 * The tallest window either page is read in. The card is the last thing on a long page and sits
 * more than a screen down at both widths, and the browser records no layout shift for a box that
 * moves entirely below the fold (`layout-shift.ts` does not scroll for it). A window taller than
 * the page puts the card in view, so the `layout-shift` reading can see it as well as the sampler.
 */
const TALL_WINDOW_PX = 2800;

/** The two screens the dashboard is read at, each tall enough to show the whole page. */
const SCREENS = [
  {
    name: 'phone 390 wide',
    viewport: { width: 390, height: TALL_WINDOW_PX },
    isMobile: true,
    hasTouch: true,
    scale: 1,
  },
  {
    name: 'desktop 1280 wide',
    viewport: { width: 1280, height: TALL_WINDOW_PX },
    isMobile: false,
    hasTouch: false,
    scale: 1,
  },
] as const;

/** What the routed pulse read saw, and how to let it answer. */
interface PulseRoute {
  /** Settles when the page has asked for the figures. */
  asked: Promise<void>;
  /** How many requests arrived. */
  requests: () => number;
  /** Lets every held answer through. */
  release: () => void;
}

/** What the routed pulse answers once it answers. */
type PulseAnswer = 'figures' | 'failure';

/**
 * Routes `GET /v1/pulse/today` on the core.
 *
 * @param page - the page, before its first navigation.
 * @param options - whether to hold the answer, and what it says.
 * @returns the handles a case needs.
 */
async function routePulse(page: Page, options: { isHeld: boolean; answer: PulseAnswer }): Promise<PulseRoute> {
  let count = 0;
  const gate = createGate();
  const asked = createGate();
  if (!options.isHeld) gate.open();
  await page.route(`${E2E_CORE_URL}/v1/pulse/today`, async (route) => {
    count += 1;
    asked.open();
    await gate.promise;
    if (options.answer === 'failure') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    return route.fulfill({ json: PULSE_BODY });
  });
  return { asked: asked.promise, requests: () => count, release: () => gate.open() };
}

/**
 * The block above the pulse slot that the card's place is measured from. It is drawn before the
 * tile can arrive, and a late arrival ABOVE it (an award note, a banner) moves it exactly as far as
 * the card, so the distance between the two is the tile's to change and nobody else's.
 */
const REFERENCE_SELECTOR = '[data-slot="week-glance-card"]';

/**
 * Samples, on every animation frame the card exists, how far the card's top is below the reference
 * block's top, from the first frame of every document. A card laid out at one place and then
 * another, even for one frame, leaves two values.
 *
 * WHY A DISTANCE AND NOT THE CARD'S OWN TOP. Anything that arrives above the reference, such as
 * the award note, moves the whole page and the card with it, and a full run of this tier under load
 * saw exactly that: a 70 px award note landing late. That is not what this spec is about, and it is
 * not the tile. The tile arrives BETWEEN the reference and the card, so it is the only late thing
 * that changes the distance.
 *
 * @param page - a page that has not navigated yet.
 */
async function sampleCardTop(page: Page): Promise<void> {
  await page.addInitScript((referenceSelector) => {
    const gaps: number[] = [];
    Object.defineProperty(window, '__cardTops', { value: gaps });
    const sample = (): void => {
      const element = document.querySelector('[data-slot="whats-new"]');
      const reference = document.querySelector(referenceSelector);
      if (element !== null && reference !== null) {
        const gap = element.getBoundingClientRect().top - reference.getBoundingClientRect().top;
        gaps.push(Math.round(gap * 10) / 10);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, REFERENCE_SELECTOR);
}

/**
 * Every distinct distance the card was seen at below the reference block, in order of first sight.
 *
 * @param page - the page.
 * @returns the distinct values.
 */
async function distinctCardTops(page: Page): Promise<number[]> {
  const tops = await page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__cardTops')?.value;
    return Array.isArray(recorded) ? [...recorded] : [];
  });
  return [...new Set(tops)];
}

/** The card. */
function card(page: Page): Locator {
  return page.locator('[data-slot="whats-new"]');
}

/** The pulse tile, found by its title. */
function tile(page: Page): Locator {
  return page.locator('main').getByText(PULSE_TITLE, { exact: true });
}

/**
 * A signed-in member on a device that has both reasons to draw something late.
 *
 * @param page - a fresh page.
 * @param options - whether this device shares a pulse.
 */
async function arrangeDevice(page: Page, options: { sharesPulse: boolean }): Promise<void> {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await sampleCardTop(page);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await page.evaluate(
    ({ pulseKey, shares, cardKey, ackKey, ack }) => {
      if (shares) window.localStorage.setItem(pulseKey, 'on');
      window.localStorage.setItem(cardKey, 'on');
      window.localStorage.setItem(ackKey, ack);
    },
    {
      pulseKey: PULSE_ENABLED_STORAGE_KEY,
      shares: options.sharesPulse,
      cardKey: WHATS_NEW_VISIBLE_KEY,
      ackKey: WHATS_NEW_STORAGE_KEY,
      ack: OLDEST_VERSION,
    },
  );
}

/**
 * Whether the card is on screen within `ms`.
 *
 * @param page - the page.
 * @param ms - how long to look.
 * @returns true when it appeared in time.
 */
async function isCardShownWithin(page: Page, ms: number): Promise<boolean> {
  return card(page)
    .waitFor({ state: 'visible', timeout: ms })
    .then(
      () => true,
      () => false,
    );
}

/**
 * Asserts the load recorded no shift and the card stood at one place on every
 * frame it existed.
 *
 * @param page - the page, after both late things have had their chance.
 * @param where - what to call this reading in a failure message.
 */
async function expectCardNeverMoved(page: Page, where: string): Promise<void> {
  await settleFrames(page);
  // THE CARD'S OWN SHIFTS: the entries that name it. Others on this page are not this spec's, and
  // are listed in the message so that they are not hidden either.
  const entries = await readShiftEntries(page);
  const cardEntries = entries.filter((entry) => entry.sources.some((source) => source.includes('[whats-new]')));
  const others = entries.filter((entry) => !cardEntries.includes(entry)).flatMap((entry) => entry.sources);
  expect(
    shiftScoreAfter(cardEntries, 0),
    `${where}: the card moved ${cardEntries.flatMap((entry) => entry.sources).join('; ')} (other shifts on the page: ${others.join('; ') || 'none'})`,
  ).toBe(0);
  expect(await distinctCardTops(page), `${where}: the card was drawn at more than one distance`).toHaveLength(1);
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test.use({
      viewport: screen.viewport,
      isMobile: screen.isMobile,
      hasTouch: screen.hasTouch,
      deviceScaleFactor: screen.scale,
    });

    test('the tile answers at once: both are drawn and the card does not move', async ({ page }) => {
      await arrangeDevice(page, { sharesPulse: true });
      await routePulse(page, { isHeld: false, answer: 'figures' });
      await page.goto('/dashboard');
      await expect(tile(page), 'CONTROL: the tile is drawn, so the toggle key and the route are right').toBeVisible();
      await expect(card(page)).toBeVisible();
      await expectCardNeverMoved(page, 'tile first');
    });

    test('the tile answers after the card would have mounted: the card does not move', async ({ page }) => {
      await arrangeDevice(page, { sharesPulse: true });
      const pulse = await routePulse(page, { isHeld: true, answer: 'figures' });
      await page.goto('/dashboard');
      await pulse.asked;
      const isCardUp = await isCardShownWithin(page, CARD_HEAD_START_MS);

      pulse.release();
      await expect(tile(page), 'the tile arrives late').toBeVisible();
      await expect(card(page), `the card is drawn (it was up before the tile: ${isCardUp})`).toBeVisible();
      await expectCardNeverMoved(page, `tile after the card (card up first: ${isCardUp})`);
    });

    test('the pulse fails: no tile, and the card is drawn without moving', async ({ page }) => {
      await arrangeDevice(page, { sharesPulse: true });
      const pulse = await routePulse(page, { isHeld: false, answer: 'failure' });
      await page.goto('/dashboard');
      await expect(card(page)).toBeVisible();
      await pulse.asked;
      await settleFrames(page);
      await expect(tile(page), 'a failed read draws no tile').toHaveCount(0);
      await expectCardNeverMoved(page, 'pulse failed');
    });

    test('a device that shares nothing asks nothing and is not kept waiting', async ({ page }) => {
      await arrangeDevice(page, { sharesPulse: false });
      const pulse = await routePulse(page, { isHeld: false, answer: 'figures' });
      await page.goto('/dashboard');
      await expect(card(page)).toBeVisible();
      await settleFrames(page);
      expect(pulse.requests(), 'a device that shares nothing makes no request').toBe(0);
      await expect(tile(page)).toHaveCount(0);
      await expectCardNeverMoved(page, 'no sharing');
    });

    test('a pulse that never answers does not hold the card back for good', async ({ page }) => {
      await arrangeDevice(page, { sharesPulse: true });
      const pulse = await routePulse(page, { isHeld: true, answer: 'figures' });
      await page.goto('/dashboard');
      await pulse.asked;
      await expect(card(page), 'the card comes while the pulse hangs').toBeVisible({
        timeout: HUNG_PULSE_CARD_BUDGET_MS,
      });
      await expect(tile(page)).toHaveCount(0);
      await expectCardNeverMoved(page, 'pulse hanging');
      pulse.release();
    });
  });
}

test.describe('the instrument', () => {
  test.use({ viewport: { width: 390, height: TALL_WINDOW_PX }, deviceScaleFactor: 1 });

  test('CONTROL: a box pushed in above the card is read as a move by both readings', async ({ page }) => {
    await arrangeDevice(page, { sharesPulse: true });
    await routePulse(page, { isHeld: false, answer: 'figures' });
    await page.goto('/dashboard');
    await expect(card(page)).toBeVisible();
    await expect(tile(page)).toBeVisible();
    await settleFrames(page);
    const since = (await readShiftEntries(page)).length;

    // The samples taken so far are dropped, so the control reads only what the box did.
    await page.evaluate(() => {
      Object.getOwnPropertyDescriptor(window, '__cardTops')?.value.splice(0);
    });
    // Two frames, so the card is sampled at its old place before the box goes in.
    await settleFrames(page);
    await page.evaluate((height) => {
      const box = document.createElement('div');
      box.style.height = `${height}px`;
      document.querySelector('[data-slot="whats-new"]')?.before(box);
    }, CONTROL_BOX_PX);
    await settleFrames(page);

    expect(await distinctCardTops(page), 'CONTROL: the sampler sees the card move').not.toHaveLength(1);
    // Polled: the browser delivers a `layout-shift` entry to the observer a task after the frame that moved.
    await expect
      .poll(async () => shiftScoreAfter(await readShiftEntries(page), since), {
        message: 'CONTROL: the browser records a shift',
      })
      .toBeGreaterThan(0);
  });
});
