/**
 * No invisible-button flash: a hidden state is hidden in the same frame,
 * buttons included (M265/09).
 *
 * THE BUG, found on the plan-return screen during the buyer walk
 * (2026-09-28, `settings.plan.tsx`, `ReturnState`). Two states share one grid
 * cell and swap with `invisible`. `invisible` reaches a state's button by
 * inheritance, and the shared `Button`'s own `transition-all` then animates
 * `visibility` like any other property: a discrete transition whose value
 * stays `visible` for its whole run. So the old state's button went on
 * painting for 150 ms after its state was hidden, over the new state.
 *
 * THE SAME CELL RECIPE is on three more pages: the forgot-password form and
 * its two answers (`forgot.tsx`), the sign-up form and its sentence
 * (`sign-up.tsx`), and the landing's two rows of hero doors (`index.tsx`).
 * Each test below drives that page's swap and reads the DOM on every
 * animation frame across it, because a reading taken after the page settles,
 * or a screenshot, sees none of those frames.
 *
 * WHAT THE WATCH FOUND on the build before the fix (2026-09-29): on `/forgot`
 * and on `/sign-up` the form's submit button stayed painted for 9 frames
 * (150 ms) after its form was hidden, under the sentence that replaced it.
 * The landing never flashed: its "Sign in" row is hidden from the first paint
 * wherever "Sign up" leads, so its button has no change of `visibility` to
 * animate, and on an invite-only instance the row only ever turns visible.
 * The landing's two tests stay as guards, and the landing kept its markup.
 *
 * WHAT IS REAL: the production build booted as a managed instance, the pages,
 * their forms and their requests. WHAT IS STUBBED: `/health`, the reset
 * request and the sign-up request, each answered at once.
 *
 * NO SENTENCE IS PINNED. Everything is found by its `data-slot`, its
 * attribute or its place in the cell.
 */
import { writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { E2E_SYNC_SERVER_URL } from './env';
import { installShiftObserver, readShiftEntries, settleAnimations, shiftScoreAfter } from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { createGate } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot, beside the tier's 30 s per spec. */
const BOOT_BUDGET_MS = 90_000;

/** The grid cell each page swaps its states in. Every direct child of the cell is one state. */
const FORGOT_CELL = 'main div:has(> [data-slot="forgot-sent"])';
const SIGN_UP_CELL = 'main div:has(> [data-slot="sign-up-sent"])';
const LANDING_CELL = 'main [data-slot="landing-hero-doors"]';

/**
 * How many more frames the watch reads once a swap has shown its new state,
 * before the reading is judged: 20 frames at 60 Hz is over twice the
 * `Button`'s 150 ms transition, so a transition the swap started is inside
 * the reading from its first frame to its last.
 */
const FRAMES_PAST_THE_SWAP = 20;

/** An element's box in viewport pixels, rounded to a tenth. */
const boxSchema = z.object({ top: z.number(), left: z.number(), bottom: z.number(), right: z.number() });

/**
 * One frame in which a control inside a HIDDEN state was painted: its own
 * computed visibility, its opacity, its box, and the state shown beside it,
 * if any, with whether the two boxes overlap.
 */
const flashFrameSchema = z.object({
  at: z.number(),
  hiddenState: z.number(),
  control: z.string(),
  visibility: z.string(),
  opacity: z.number(),
  controlBox: boxSchema,
  shownState: z.number().nullable(),
  shownBox: boxSchema.nullable(),
  overlaps: z.boolean(),
});

/** What the frame watch has recorded: how many frames it read, a timeline of state changes, and every flash. */
const frameWatchSchema = z.object({
  frames: z.number(),
  timeline: z.array(z.string()),
  flashes: z.array(flashFrameSchema),
});
type FrameWatch = z.infer<typeof frameWatchSchema>;
type FlashFrame = z.infer<typeof flashFrameSchema>;
type Box = z.infer<typeof boxSchema>;

/**
 * Reads one cell on every animation frame from the document's first frame
 * on, and records each frame in which a control (`a`, `button`, `input`)
 * inside a hidden state is painted. A state is hidden when its own computed
 * `visibility` is not `visible`; a control is painted when
 * `checkVisibility` with the visibility and opacity checks says so and its
 * box is not empty.
 *
 * @param page - a page that has not navigated yet.
 * @param cellSelector - the grid cell whose direct children are the states.
 */
async function installFrameWatch(page: Page, cellSelector: string): Promise<void> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE, so its helpers cannot
  // move out of it (the same exception `layout-shift.ts` makes).
  // oxlint-disable unicorn/consistent-function-scoping
  await page.addInitScript((selector: string) => {
    const watch: FrameWatch = { frames: 0, timeline: [], flashes: [] };
    Object.defineProperty(window, '__frameWatch', { value: watch, configurable: true });
    const tenth = (value: number): number => Math.round(value * 10) / 10;
    const boxOf = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return { top: tenth(rect.top), left: tenth(rect.left), bottom: tenth(rect.bottom), right: tenth(rect.right) };
    };
    const isEmpty = (box: Box): boolean => box.right <= box.left || box.bottom <= box.top;
    const doOverlap = (one: Box, other: Box): boolean =>
      one.left < other.right && other.left < one.right && one.top < other.bottom && other.top < one.bottom;
    const nameOf = (control: Element): string =>
      (control.textContent ?? '').trim().slice(0, 40) || control.tagName.toLowerCase();
    let lastSummary = '';
    const sample = (): void => {
      const cell = document.querySelector(selector);
      if (cell !== null) {
        watch.frames += 1;
        const at = Math.round(performance.now());
        const states = [...cell.children].map((state, index) => ({
          index,
          isShown: getComputedStyle(state).visibility === 'visible',
          box: boxOf(state),
          controls: [...state.querySelectorAll('a, button, input')].map((control) => {
            const style = getComputedStyle(control);
            const box = boxOf(control);
            return {
              name: nameOf(control),
              visibility: style.visibility,
              opacity: Number(style.opacity),
              box,
              isPainted: control.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && !isEmpty(box),
            };
          }),
        }));
        const summary = states
          .map(
            (state) =>
              `state ${state.index} ${state.isShown ? 'shown' : 'hidden'}, ` +
              `${state.controls.filter((control) => control.isPainted).length} of ${state.controls.length} controls painted`,
          )
          .join('; ');
        if (summary !== lastSummary) {
          watch.timeline.push(`${at} ms: ${summary}`);
          lastSummary = summary;
        }
        const shown = states.find((state) => state.isShown) ?? null;
        for (const hidden of states.filter((state) => !state.isShown)) {
          for (const control of hidden.controls.filter((candidate) => candidate.isPainted)) {
            if (watch.flashes.length >= 100) break;
            watch.flashes.push({
              at,
              hiddenState: hidden.index,
              control: control.name,
              visibility: control.visibility,
              opacity: control.opacity,
              controlBox: control.box,
              shownState: shown?.index ?? null,
              shownBox: shown?.box ?? null,
              overlaps: shown !== null && doOverlap(control.box, shown.box),
            });
          }
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, cellSelector);
  // oxlint-enable unicorn/consistent-function-scoping
}

/** What {@link installFrameWatch} has recorded so far. */
async function readFrameWatch(page: Page): Promise<FrameWatch> {
  const recorded = await page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__frameWatch')?.value ?? null);
  return frameWatchSchema.parse(recorded);
}

/** One flash, as a failure line: which control, how it was drawn, and over what. */
function describeFlash(flash: FlashFrame): string {
  const over =
    flash.shownState === null ? 'with no state shown'
    : flash.overlaps ? `over state ${flash.shownState}`
    : `beside state ${flash.shownState}, boxes apart`;
  return (
    `${flash.at} ms: "${flash.control}" of hidden state ${flash.hiddenState} painted ` +
    `(visibility ${flash.visibility}, opacity ${flash.opacity}) ${over}`
  );
}

/** Keeps the watch's reading beside the test's results, as the evidence a report quotes. */
function keepEvidence(watch: FrameWatch): void {
  writeFileSync(test.info().outputPath('frame-watch.json'), `${JSON.stringify(watch, null, 2)}\n`);
}

/**
 * THE CONTROL for the watch: a hidden state's control made visible on purpose
 * must be recorded as a flash, so the empty readings above can see the defect.
 */
async function expectWatchSeesAForcedPaint(page: Page, hiddenControl: Locator): Promise<void> {
  const flashesBefore = (await readFrameWatch(page)).flashes.length;
  await hiddenControl.evaluate((control) => {
    if (!(control instanceof HTMLElement)) throw new Error('the hidden control is not an HTML element');
    control.style.visibility = 'visible';
  });
  await expect
    .poll(async () => (await readFrameWatch(page)).flashes.length, {
      message: 'the frame watch cannot see a painted hidden-state control',
    })
    .toBeGreaterThan(flashesBefore);
}

/**
 * Lets the watch read {@link FRAMES_PAST_THE_SWAP} more frames, then requires
 * that it saw the swap and that no frame painted a hidden state's control.
 * Call once the new state is on screen.
 */
async function expectNoFlash(page: Page): Promise<void> {
  const framesAtSwap = (await readFrameWatch(page)).frames;
  await expect
    .poll(async () => (await readFrameWatch(page)).frames, { message: 'the frame watch stopped reading frames' })
    .toBeGreaterThanOrEqual(framesAtSwap + FRAMES_PAST_THE_SWAP);
  const watch = await readFrameWatch(page);
  keepEvidence(watch);
  const timeline = `Timeline:\n${watch.timeline.join('\n')}`;
  expect(watch.timeline.length, `the frame watch saw no state change. ${timeline}`).toBeGreaterThan(1);
  expect(watch.flashes.map(describeFlash), `a hidden state painted a control. ${timeline}`).toEqual([]);
}

/** Answers `/health` for the managed server's sync origin, with mail, and with or without open sign-up. */
async function routeHealth(page: Page, stub: { openSignup: boolean }, gate?: Promise<void>): Promise<void> {
  await page.route(`${E2E_SYNC_SERVER_URL}/health`, async (route) => {
    await gate;
    await route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        // NO TRIAL: the landing then draws no offer and asks for no prices,
        // so the doors are the only thing the handshake changes there.
        instance: {
          name: 'openplate-e2e',
          language: 'en',
          mail: true,
          memberInvites: false,
          plans: true,
          openSignup: stub.openSignup,
          ai: { model: 'e2e-model' },
        },
      },
    });
  });
}

/** Answers one POST to the sync service with `202`, the answer both forms turn into their sentence on. */
async function routeAccepted(page: Page, path: string): Promise<void> {
  await page.route(`${E2E_SYNC_SERVER_URL}${path}`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ status: 202, json: {} });
  });
}

/** The viewport top of an element, as `getBoundingClientRect` reads it. */
async function topOf(element: Locator): Promise<number> {
  return element.evaluate((node) => node.getBoundingClientRect().top);
}

/** Where the page is before a swap: the shift count, and the top of what sits below the cell. */
interface Baseline {
  shifts: number;
  belowTop: number;
}

async function takeBaseline(page: Page, below: Locator): Promise<Baseline> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
  return { shifts: (await readShiftEntries(page)).length, belowTop: await topOf(below) };
}

/** NOTHING MOVED across the swap: what sits below the cell keeps its top, and no layout shift was recorded. */
async function expectNothingMoved(page: Page, { below, baseline }: { below: Locator; baseline: Baseline }): Promise<void> {
  expect(await topOf(below), 'the element below the cell moved').toBe(baseline.belowTop);
  expect(shiftScoreAfter(await readShiftEntries(page), baseline.shifts), 'layout-shift across the swap').toBe(0);
}

/**
 * THE CONTROL for the two "nothing moved" readings: a 40 px block put above
 * the cell must move what sits below it and be recorded as a layout shift.
 */
async function expectAMoveIsSeen(page: Page, { below, cell }: { below: Locator; cell: Locator }): Promise<void> {
  const shiftsBefore = (await readShiftEntries(page)).length;
  const topBefore = await topOf(below);
  await cell.evaluate((node) => {
    const block = document.createElement('div');
    block.style.height = '40px';
    node.before(block);
  });
  await expect.poll(() => topOf(below), { message: 'the top reading cannot see a move' }).toBeGreaterThan(topBefore);
  await expect
    .poll(async () => shiftScoreAfter(await readShiftEntries(page), shiftsBefore), {
      message: 'the layout-shift reading cannot see a move',
    })
    .toBeGreaterThan(0);
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

test('no invisible-button flash on /forgot: the form turning into "sent" leaves its button drawn for no frame', async ({
  page,
}) => {
  await installShiftObserver(page);
  await installFrameWatch(page, FORGOT_CELL);
  await routeHealth(page, { openSignup: false });
  await routeAccepted(page, '/v1/auth/reset/request');
  await page.goto(`${server.url}/forgot`);
  const submit = page.locator(`${FORGOT_CELL} [data-credential-submit]`);
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await page.locator(`${FORGOT_CELL} input[type="email"]`).fill('anna@example.org');
  const below = page.locator(`${FORGOT_CELL} + a[href="/sign-in"]`);
  const baseline = await takeBaseline(page, below);

  await submit.click();
  await expect(page.locator('[data-slot="forgot-sent"]')).toBeVisible();
  await settleAnimations(page);

  await expectNoFlash(page);
  await expectNothingMoved(page, { below, baseline });
  await expectWatchSeesAForcedPaint(page, submit);
  await expectAMoveIsSeen(page, { below, cell: page.locator(FORGOT_CELL) });
});

test('no invisible-button flash on /sign-up: the form turning into its sentence leaves its button drawn for no frame', async ({
  page,
}) => {
  await installShiftObserver(page);
  await installFrameWatch(page, SIGN_UP_CELL);
  await routeHealth(page, { openSignup: true });
  await routeAccepted(page, '/v1/auth/signup-request');
  await page.goto(`${server.url}/sign-up`);
  const submit = page.locator(`${SIGN_UP_CELL} [data-credential-submit]`);
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await page.locator(`${SIGN_UP_CELL} input[name="email"]`).fill('anna@example.org');
  const below = page.locator('[data-slot="sign-up-sign-in"]');
  const baseline = await takeBaseline(page, below);

  await submit.click();
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeVisible();
  await settleAnimations(page);

  await expectNoFlash(page);
  await expectNothingMoved(page, { below, baseline });
  await expectWatchSeesAForcedPaint(page, submit);
  await expectAMoveIsSeen(page, { below, cell: page.locator(SIGN_UP_CELL) });
});

test('no invisible-button flash on the landing: "Sign up" arriving beside the hidden "Sign in" row draws one row per frame', async ({
  page,
}) => {
  await installShiftObserver(page);
  await installFrameWatch(page, LANDING_CELL);
  const gate = createGate();
  await routeHealth(page, { openSignup: true }, gate.promise);
  await page.goto(`${server.url}/`);
  const below = page.locator('main figure').first();
  await expect(below).toBeVisible();
  const baseline = await takeBaseline(page, below);

  gate.open();
  await expect(page.locator(`${LANDING_CELL} a[href^="/sign-up"]`)).toBeVisible({ timeout: 10_000 });
  await settleAnimations(page);

  await expectNoFlash(page);
  await expectNothingMoved(page, { below, baseline });
  await expectWatchSeesAForcedPaint(page, page.locator(`${LANDING_CELL} a[href="/welcome"]`));
  await expectAMoveIsSeen(page, { below, cell: page.locator(LANDING_CELL) });
});

test('no invisible-button flash on the landing: the "Sign in" row turning visible on an invite-only instance draws one row per frame', async ({
  page,
}) => {
  await installShiftObserver(page);
  await installFrameWatch(page, LANDING_CELL);
  const gate = createGate();
  await routeHealth(page, { openSignup: false }, gate.promise);
  await page.goto(`${server.url}/`);
  const below = page.locator('main figure').first();
  await expect(below).toBeVisible();
  const baseline = await takeBaseline(page, below);

  gate.open();
  await expect(page.locator(`${LANDING_CELL} a[href="/welcome"]`)).toBeVisible({ timeout: 10_000 });
  await settleAnimations(page);

  await expectNoFlash(page);
  await expectNothingMoved(page, { below, baseline });
  // No hidden state is left in this cell to force, so the control hides the
  // shown row and paints its button: the same reading must see that.
  await page.locator(`${LANDING_CELL} > div`).first().evaluate((row) => {
    if (!(row instanceof HTMLElement)) throw new Error('the doors row is not an HTML element');
    row.style.visibility = 'hidden';
  });
  await expectWatchSeesAForcedPaint(page, page.locator(`${LANDING_CELL} a[href="/welcome"]`));
  await expectAMoveIsSeen(page, { below, cell: page.locator(LANDING_CELL) });
});
