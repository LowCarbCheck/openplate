/**
 * The sign-out dialog moves nothing when the erase box is ticked, and is
 * anchored so that growth can only go downward (DESIGN.md section 7).
 *
 * ── What the dialog does now ─────────────────────────────────────────────
 *
 * The erase warnings used to stand above the box from the first paint. They
 * now mount when the box is ticked (ADR-0016, amended 2026-10-02), which is a
 * dialog that GROWS after a tap. A tap may not move what is already on screen,
 * so three things hold, and this file reads each:
 *
 *  - the dialog is anchored at the top, so growth pushes only what is below it
 *    (a centred dialog would move its own title);
 *  - the box is drawn from the first paint and only becomes enabled, so the
 *    read finishing moves nothing;
 *  - the tick pushes the confirm button down and nothing above it.
 *
 * ── Why the tops are read here and not by `readTops` ─────────────────────
 *
 * `readTops` (layout-shift.ts) reads inside `main`, and the dialog is portalled
 * out of it. This file reads the same thing, `getBoundingClientRect().top`, for
 * the five boxes that matter, from the top of the viewport (the dialog is
 * `fixed`, so a page scroll cannot move it).
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * (b) The confirm button's top must INCREASE at the tick. That increase is the
 * control: it proves the reader sees the movement the tick really causes, so
 * "the other four did not move" is a reading and not a reader that sees
 * nothing.
 *
 * (c) The observer's own control: a line planted above the checkbox moves it,
 * and the `layout-shift` total must become greater than 0. The tick itself is
 * judged by the tops alone, because the confirm button moving down at the tick
 * is a shift the observer records (and the browser marks it `hadRecentInput`
 * within 500 ms of the tap), so a total of 0 would be the wrong claim there.
 *
 * (anchor) The computed styles are asserted, so a `tailwind-merge` that kept
 * the base component's `top-[50%]` or its centring translate fails here: a
 * dialog still centred reads a top of half the viewport, not 16 px.
 *
 * @area sign-out
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

/** The boxes read, each by the slot or role the dialog gives it. */
interface DialogTops {
  title: number;
  description: number;
  checkbox: number;
  content: number;
  confirm: number;
}

/** A reading, rounded to a tenth of a pixel so it is stable. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The top edge of the five boxes, from the top of the viewport. */
async function readDialogTops(page: Page): Promise<DialogTops> {
  // Serialised into the page, so its helper cannot live outside it.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate(() => {
    const topOf = (selector: string): number => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`the dialog has no ${selector}`);
      return element.getBoundingClientRect().top;
    };
    const dialog = '[role="alertdialog"]';
    return {
      title: topOf(`${dialog} [data-slot="alert-dialog-title"]`),
      description: topOf(`${dialog} [data-slot="alert-dialog-description"]`),
      checkbox: topOf(`${dialog} input[type="checkbox"]`),
      content: topOf(dialog),
      confirm: topOf(`${dialog} [data-slot="alert-dialog-footer"] button:last-child`),
    };
  });
  // oxlint-enable unicorn/consistent-function-scoping
}

/** Rounds a reading, so two of them compare equal when nothing moved. */
function rounded(tops: DialogTops): DialogTops {
  return {
    title: tenth(tops.title),
    description: tenth(tops.description),
    checkbox: tenth(tops.checkbox),
    content: tenth(tops.content),
    confirm: tenth(tops.confirm),
  };
}

/** Opens the sign-out dialog through the header menu, the way a person on a phone does. */
async function openSignOutDialogFromTheMenu(page: Page): Promise<void> {
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await page
    .getByRole('menuitem')
    .filter({ has: page.locator('svg.lucide-log-out') })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

/** A signed-in device with the dialog open, at rest. */
async function openTheDialog(page: Page): Promise<void> {
  // The observer goes in before the first navigation, so no page starts without it.
  await installShiftObserver(page);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await openSignOutDialogFromTheMenu(page);
  await settleAnimations(page);
}

test('the read finishing and the tick move nothing above the confirm button', async ({ page }) => {
  await openTheDialog(page);
  const dialog = page.getByRole('alertdialog');
  const checkbox = dialog.getByRole('checkbox');

  // (a) AT OPEN, AND AGAIN ONCE THE BOX CAN BE TICKED. The box is there from
  // the first paint, so becoming enabled moves nothing.
  const atOpen = rounded(await readDialogTops(page));
  const shiftsBeforeEnabled = (await readShiftEntries(page)).length;
  await expect(checkbox).toBeEnabled();
  await settleAnimations(page);
  const whenEnabled = rounded(await readDialogTops(page));
  expect(whenEnabled).toEqual(atOpen);
  const afterEnabled = await readShiftEntries(page);
  expect(
    shiftScoreAfter(afterEnabled, shiftsBeforeEnabled),
    JSON.stringify(afterEnabled.slice(shiftsBeforeEnabled)),
  ).toBe(0);
  // The notice is not on the page yet: there is nothing to have moved it.
  await expect(dialog.locator('[data-slot="erase-region"]')).toHaveCount(0);

  // (b) THE TICK. Everything above the notice stays, the confirm button goes down.
  await checkbox.check();
  await expect(dialog.locator('[data-slot="erase-region"]')).toHaveCount(1);
  await settleAnimations(page);
  const afterTick = rounded(await readDialogTops(page));
  expect(afterTick.title, 'the title moved at the tick').toBe(whenEnabled.title);
  expect(afterTick.description, 'the description moved at the tick').toBe(whenEnabled.description);
  expect(afterTick.checkbox, 'the checkbox moved at the tick').toBe(whenEnabled.checkbox);
  expect(afterTick.content, 'the dialog moved at the tick').toBe(whenEnabled.content);
  // CONTROL: the reader sees the one movement the tick really causes.
  expect(afterTick.confirm, 'the confirm button must be pushed down by the notice').toBeGreaterThan(
    whenEnabled.confirm,
  );

  // (c) OBSERVER CONTROL: a line planted above the checkbox moves the box, and
  // the `layout-shift` total sees it. Without it, a total of 0 above would be
  // an observer that cannot see inside a fixed dialog.
  await settleAnimations(page);
  const beforePlanting = (await readShiftEntries(page)).length;
  await page.evaluate(() => {
    const row = document.querySelector('[role="alertdialog"] input[type="checkbox"]')?.parentElement;
    if (!row) throw new Error('the dialog has no checkbox row');
    const planted = document.createElement('p');
    planted.textContent = 'planted';
    planted.style.height = '24px';
    row.before(planted);
  });
  await settleFrames(page);
  const planted = rounded(await readDialogTops(page));
  expect(planted.checkbox, 'the planted line must push the checkbox').toBeGreaterThan(afterTick.checkbox);
  const afterPlanting = await readShiftEntries(page);
  expect(shiftScoreAfter(afterPlanting, beforePlanting), 'the observer must record the planted shift').toBeGreaterThan(
    0,
  );
});

test('the dialog is anchored at the top on a phone, so growth only goes down', async ({ page }) => {
  await openTheDialog(page);
  const style = await page.evaluate(() => {
    const content = document.querySelector('[role="alertdialog"]');
    if (content === null) throw new Error('no dialog');
    const computed = getComputedStyle(content);
    return {
      top: computed.top,
      translate: computed.translate,
      overflowY: computed.overflowY,
      maxHeight: computed.maxHeight,
      viewportHeight: window.innerHeight,
    };
  });
  // `tailwind-merge` dropped the base `top-[50%]`: 16 px, never half the viewport.
  expect(style.top, JSON.stringify(style)).toBe('16px');
  // ...and the base centring translate. A computed `translate` is "x" or "x y",
  // and the y part is absent or zero once `translate-y-0` has won.
  const translateY = style.translate.split(' ')[1];
  expect(translateY === undefined || Number.parseFloat(translateY) === 0, JSON.stringify(style)).toBe(true);
  expect(style.overflowY).toBe('auto');
  expect(style.maxHeight).toBe(`${style.viewportHeight - 32}px`);
});

test.describe('on a desktop viewport', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('the dialog sits a tenth of the viewport from the top, still anchored', async ({ page }) => {
    await openTheDialog(page);
    const style = await page.evaluate(() => {
      const content = document.querySelector('[role="alertdialog"]');
      if (content === null) throw new Error('no dialog');
      const computed = getComputedStyle(content);
      return { top: computed.top, translate: computed.translate, innerHeight: window.innerHeight };
    });
    expect(style.top, JSON.stringify(style)).toBe(`${style.innerHeight * 0.1}px`);
    const translateY = style.translate.split(' ')[1];
    expect(translateY === undefined || Number.parseFloat(translateY) === 0, JSON.stringify(style)).toBe(true);
  });
});
