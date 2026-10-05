/**
 * A running fast draws its header chip late, and nothing already on screen moves (DESIGN.md
 * section 7, workspace rule "No layout shift").
 *
 * THE FINDING. The chip sat inside the right-hand group of the header, beside the avatar. A running
 * fast is read from the device after the first paint, so the chip arrives a frame after the
 * avatar. It widened that group, and the group's left edge moved by the chip's 56 px plus the 12 px
 * gap, 68 px in all. The older specs that read this header on the shared fixture account
 * (`font-swap-moves-nothing`, `scans-used-line`, `whats-new`, the layout check in
 * `health-consent-gate`) saw the same 68 px whenever an earlier spec had left a fast running.
 *
 * WHAT THE FIX PROMISES. The chip is a sibling BEFORE the avatar group, pushed right with
 * `ml-auto`, so the avatar group keeps its start edge and only the page title gets shorter. No width
 * is reserved: most people have no fast, and an empty 68 px hole in every header would be the
 * wrong price. The title may lose width when the chip arrives. Nothing else may move.
 *
 * THE DEVICE. Its own phone, signed in as the fixture account, with one fast started on
 * `/fasting` and pushed to the account. The page is then reloaded, which is the cold boot: the
 * header is drawn from the server's markup and the fast is read from the store afterwards.
 *
 * TWO READINGS, as section 7 asks.
 *  1. The browser's `layout-shift` entries, summed over the whole load. Must be 0.
 *  2. The rect of the header, the title, the avatar circle, the avatar's button, the group that
 *     holds it and the content below it, sampled on EVERY animation frame from the first script of the document. Each box
 *     must take one value for its left edge, top, width and height across all the frames it
 *     exists in. The title's WIDTH is the one allowed exception, because making room is its job.
 *
 * ALSO CHECKED. The chip was drawn after the avatar box was (otherwise a cold boot that paints
 * both together proves nothing), and it sits 12 px left of the avatar's button.
 *
 * THE CONTROLS.
 *  - A 68 px box added by hand to the end of the avatar group moves the button. Both readings must
 *    see it, or the zeros above come from a sampler that cannot see.
 *  - A phone with no fast draws no chip, and the same two readings are still flat, so the checks
 *    do not fail for some reason other than the chip.
 *
 * THE ACCOUNT IS SHARED BY EVERY SPEC IN A RUN. A fast left running would come down to the next
 * spec that signs in. The test that starts one ends it again in a `finally` and waits for the push
 * that carries the end.
 *
 * @area shell
 */
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  turnOffScrollAnchoring,
} from './layout-shift';

test.use({ serviceWorkers: 'block' });

/** One signed-in onboarding, a fast, a push, a reload and a sampling window fit in this. */
const TEST_BUDGET_MS = 90_000;

/** How wide the chip and its gap are together: the chip's 56 px and the 12 px gap, the move the fix removes. */
const CHIP_AND_GAP_PX = 68;

/** The space between the chip and the avatar's button. */
const CHIP_TO_AVATAR_PX = 12;

/** How many cold boots are tried for one where the chip comes after the avatar. */
const MAX_COLD_BOOTS = 8;

/** How long the page is sampled after the chip is on screen, so a late second move would show. */
const SETTLE_SAMPLE_MS = 600;

/** One box's rect in one frame. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Every box the sampler reads in one frame; null where the element does not exist yet. */
interface Frame {
  header: Box | null;
  title: Box | null;
  avatar: Box | null;
  /** The avatar's button. */
  avatarBox: Box | null;
  /** The box that holds the avatar's button, the right-hand group: the one the old chip widened. */
  avatarGroup: Box | null;
  below: Box | null;
  chip: Box | null;
}

type BoxName = keyof Frame;

/** The boxes that must hold still, and the properties that may change for each (none, unless named). */
const WATCHED: ReadonlyArray<{ name: BoxName; ignores: ReadonlyArray<keyof Box> }> = [
  { name: 'header', ignores: [] },
  // The title gives up width to the chip. Its start edge and its height are the claim.
  { name: 'title', ignores: ['width'] },
  { name: 'avatar', ignores: [] },
  { name: 'avatarBox', ignores: [] },
  { name: 'avatarGroup', ignores: [] },
  { name: 'below', ignores: [] },
];

const BOX_PROPERTIES = ['left', 'top', 'width', 'height'] as const;

/**
 * Starts reading the header's boxes on every animation frame, from the first script of every
 * document this page opens. Call once, before the first `goto`.
 */
async function installFrameSampler(page: Page): Promise<void> {
  // SERIALISED INTO THE PAGE: its helpers cannot live outside it.
  // oxlint-disable unicorn/consistent-function-scoping
  await page.addInitScript(() => {
    const frames: Frame[] = [];
    Object.defineProperty(window, '__headerFrames', { value: frames });
    const box = (element: Element | null | undefined): Box | null => {
      if (!(element instanceof Element)) return null;
      const rect = element.getBoundingClientRect();
      const tenth = (value: number): number => Math.round(value * 10) / 10;
      return { left: tenth(rect.left), top: tenth(rect.top), width: tenth(rect.width), height: tenth(rect.height) };
    };
    const read = (selector: string): Box | null => box(document.querySelector(selector));
    const sample = (): void => {
      frames.push({
        header: read('header'),
        title: read('header h1'),
        avatar: read('header [data-slot="avatar-menu-circle"]'),
        avatarBox: read('header [data-slot="avatar-menu-trigger"]'),
        avatarGroup: box(document.querySelector('header [data-slot="avatar-menu-trigger"]')?.parentElement),
        below: read('main'),
        chip: read('header a[href="/fasting"]'),
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // oxlint-enable unicorn/consistent-function-scoping
}

/** Every frame sampled so far in the open document, in order. */
async function readFrames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__headerFrames')?.value;
    return Array.isArray(recorded) ? [...recorded] : [];
  });
}

/** The values one property of one box took over the frames, in the order first seen. */
function valuesOf(frames: readonly Frame[], name: BoxName, property: keyof Box): number[] {
  const seen: number[] = [];
  for (const frame of frames) {
    const box = frame[name];
    if (box === null) continue;
    if (!seen.includes(box[property])) seen.push(box[property]);
  }
  return seen;
}

/** One line per box property that took more than one value, named the way a fix is named. */
function describeMoves(frames: readonly Frame[]): string[] {
  const moves: string[] = [];
  for (const { name, ignores } of WATCHED) {
    for (const property of BOX_PROPERTIES) {
      if (ignores.includes(property)) continue;
      const values = valuesOf(frames, name, property);
      if (values.length > 1) moves.push(`${name}.${property} took ${values.join(', ')}`);
    }
  }
  return moves;
}

/** The index of the first frame in which a box exists, or -1. */
function firstFrameWith(frames: readonly Frame[], name: BoxName): number {
  return frames.findIndex((frame) => frame[name] !== null);
}

/** The summed layout-shift score of the whole load, with the entries that made it. */
async function readShiftTotal(page: Page): Promise<{ total: number; detail: string }> {
  const entries = await readShiftEntries(page);
  return {
    total: entries.reduce((sum, entry) => sum + entry.value, 0),
    detail: entries.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`).join('\n'),
  };
}

/** The button that starts a fast. */
function startButton(page: Page): Locator {
  return page.getByRole('button', { name: EN.fasting.plan.submitNow, exact: true });
}

/** The chip, as the header draws it: the one link to the fasting screen inside the bar. */
function chipOf(page: Page): Locator {
  return page.locator('header a[href="/fasting"]');
}

/**
 * Starts waiting for the sync push that follows the next change on the device. Call BEFORE the
 * press, then await the result.
 */
function nextBlobPush(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/v1/sync/blob' && response.ok(),
  );
}

/** Starts one fast on the open fasting screen and waits until the account holds it. */
async function startFastAndSync(page: Page): Promise<void> {
  await page.goto('/fasting');
  // Earlier pushes (the sign-in's own) are over before the one under test is waited for.
  await page.waitForLoadState('networkidle');
  const pushed = nextBlobPush(page);
  await startButton(page).click();
  await pushed;
}

/** Ends the running fast and waits until the account holds the end. */
async function endFastAndSync(page: Page): Promise<void> {
  await page.goto('/fasting');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: EN.fasting.active.end, exact: true }).click();
  const pushed = nextBlobPush(page);
  await page.getByRole('button', { name: EN.fasting.end.confirm, exact: true }).click();
  await pushed;
}

/** A fresh phone: observers in, onboarding done, signed in as the fixture account. */
async function openSignedInPhone(page: Page): Promise<void> {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await installFrameSampler(page);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
}

/** Reloads the diary and waits until the page has settled, fonts and animations included. */
async function coldBootDiary(page: Page): Promise<void> {
  await page.goto('/diary');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
}

/**
 * One cold boot of the diary with a fast running, with every reading taken and required flat.
 *
 * @returns whether the chip arrived AFTER the avatar's button was on screen, which is the only kind
 *   of boot that could have moved it.
 */
async function coldBootWithAFastAndRead(page: Page): Promise<boolean> {
  await coldBootDiary(page);
  await expect(chipOf(page)).toBeVisible({ timeout: 10_000 });
  await settleFrames(page);
  await page.waitForTimeout(SETTLE_SAMPLE_MS);

  const frames = await readFrames(page);
  const chipFrom = firstFrameWith(frames, 'chip');
  const avatarFrom = firstFrameWith(frames, 'avatarBox');
  expect(chipFrom, 'the chip was never sampled').toBeGreaterThan(-1);
  expect(avatarFrom, 'the avatar button was never sampled').toBeGreaterThan(-1);

  // READING TWO: every box, every frame.
  expect(describeMoves(frames), `${frames.length} frames sampled`).toEqual([]);

  // THE CHIP SITS 12 PX LEFT OF THE AVATAR'S BUTTON, in every frame it exists in.
  const gaps = new Set<number>();
  for (const frame of frames) {
    if (frame.chip === null || frame.avatarBox === null) continue;
    gaps.add(Math.round((frame.avatarBox.left - (frame.chip.left + frame.chip.width)) * 10) / 10);
  }
  expect([...gaps]).toEqual([CHIP_TO_AVATAR_PX]);

  // READING ONE: the browser's own total.
  const shift = await readShiftTotal(page);
  expect(shift.total, shift.detail).toBe(0);

  return avatarFrom < chipFrom;
}

test('a running fast arrives in the header late and moves nothing already drawn', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await openSignedInPhone(page);

  let hasFast = false;
  try {
    await startFastAndSync(page);
    hasFast = true;

    // WHETHER THE CHIP COMES AFTER THE AVATAR IS DECIDED BY HOW FAST THE STORE ANSWERS, which the
    // test does not control: on some boots both are drawn in one frame, and such a boot would pass
    // on the old build too. So the boot is repeated, every boot is held to the same readings, and
    // at least one of them must have been a late one.
    let lateBoots = 0;
    for (let boot = 1; boot <= MAX_COLD_BOOTS && lateBoots === 0; boot += 1) {
      if (await coldBootWithAFastAndRead(page)) lateBoots += 1;
    }
    expect(lateBoots, `no boot in ${MAX_COLD_BOOTS} drew the chip after the avatar, so none proves anything`).toBe(1);
  } finally {
    if (hasFast) await endFastAndSync(page);
  }
});

test('control: a 68 px box added by hand to the avatar group is seen as a move by both readings', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await openSignedInPhone(page);
  await coldBootDiary(page);

  const button = page.locator('header [data-slot="avatar-menu-trigger"]');
  await expect(button).toBeVisible();
  const before = await readFrames(page);
  const shiftBefore = await readShiftTotal(page);
  expect(describeMoves(before), 'the phone moved before the control did anything').toEqual([]);
  expect(shiftBefore.total, shiftBefore.detail).toBe(0);

  // After the avatar, where nothing anchors it: the button has to give way.
  await button.evaluate((trigger, width) => {
    const box = document.createElement('span');
    box.style.cssText = `display:block;flex:none;width:${width}px;height:12px`;
    trigger.parentElement?.append(box);
  }, CHIP_AND_GAP_PX);
  await settleFrames(page);
  await settleFrames(page);

  const after = await readFrames(page);
  expect(describeMoves(after).some((line) => line.startsWith('avatarBox.left'))).toBe(true);
  expect(describeMoves(after).some((line) => line.startsWith('avatarGroup.left'))).toBe(true);
  const shiftAfter = await readShiftTotal(page);
  expect(shiftAfter.total).toBeGreaterThan(0);
});

test('control: a phone with no fast draws no chip, and the same readings are flat', async ({ page }) => {
  test.setTimeout(TEST_BUDGET_MS);
  await openSignedInPhone(page);
  await coldBootDiary(page);
  await expect(page.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible();
  await settleFrames(page);
  await page.waitForTimeout(SETTLE_SAMPLE_MS);

  await expect(chipOf(page)).toHaveCount(0);
  const frames = await readFrames(page);
  expect(
    frames.every((frame) => frame.chip === null),
    'a chip was sampled on a phone with no fast',
  ).toBe(true);
  expect(describeMoves(frames), `${frames.length} frames sampled`).toEqual([]);
  const shift = await readShiftTotal(page);
  expect(shift.total, shift.detail).toBe(0);
});
