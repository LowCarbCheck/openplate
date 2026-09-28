/**
 * The diary's Undo is a control with an icon, not the sentence's last words
 * (M265/07).
 *
 * On 2026-09-28 every status action became underlined words at the end of the
 * sentence, because a bordered plan button beside the trial countdown left the
 * German sentence about 40 px at 390 px (`header-status.tsx`). That fix was
 * right for the plan action and took the diary's Undo with it. The operator's
 * decision: Undo alone gets a compact control with an icon again, opted into
 * by its one caller, and the plan action keeps its sentence-end look.
 *
 * WHAT IS REAL: the production build, a hand-typed entry, the entry screen's
 * delete, the status it publishes and the row that draws it. The plan action
 * is a real trial countdown on stubbed plan reads (`plans-stub.ts`).
 *
 * Every reading has a control: the icon reading finds the close control's
 * icon through the same query, the plan action is read through the same query
 * and holds none, and the fit reading is shown a squeezed control that it
 * must call cut off.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { EN, catalogFor, fill } from './copy';
import {
  HEADER_HEIGHT,
  PHONE_WIDTH,
  completeOnboarding,
  headerStatusText,
  isHeaderStatusFullyVisible,
  logFoodManually,
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
import { NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore } from './plans-stub';

/** The entry this spec deletes and puts back. */
const FOOD_NAME = 'Smoke tier porridge';

/** How many grams of it. */
const FOOD_GRAMS = '200';

/** The app's tap floor, in CSS px. */
const TAP_FLOOR = 44;

function headerStatus(page: Page): Locator {
  return page.locator('header [data-slot="header-status"]');
}

function entryLink(page: Page): Locator {
  return page.getByRole('link', { name: new RegExp(FOOD_NAME, 'u') });
}

/** Opens the entry from the diary and deletes it, which publishes the Undo status and returns to the diary. */
async function deleteEntry(page: Page, deleteLabel: string): Promise<void> {
  await entryLink(page).first().click();
  await page.waitForURL('**/diary/entry/**');
  await page.getByRole('button', { name: deleteLabel }).click();
}

/** What a control in the status row looks like, read off the element. */
interface ControlLook {
  iconCount: number;
  width: number;
  height: number;
  isUnderlined: boolean;
}

async function readControlLook(control: Locator): Promise<ControlLook> {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      iconCount: element.querySelectorAll('svg').length,
      width: box.width,
      height: box.height,
      isUnderlined: getComputedStyle(element).textDecorationLine.includes('underline'),
    };
  });
}

/** Whether the status row, its sentence and its Undo control all fit, and the page around them. */
interface UndoRowFit {
  isRowWhole: boolean;
  isControlWhole: boolean;
  isSentenceWhole: boolean;
  documentScrollWidth: number;
  headerHeight: number;
}

async function readUndoRowFit(page: Page, control: Locator): Promise<UndoRowFit> {
  const isSentenceWhole = await isHeaderStatusFullyVisible(page);
  const isControlWhole = await control.evaluate((element) => element.scrollWidth <= element.clientWidth);
  const layout = await headerStatus(page).evaluate((row) => ({
    isRowWhole: row.scrollWidth <= row.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    headerHeight: Math.round(document.querySelector('header')?.getBoundingClientRect().height ?? 0),
  }));
  return { isSentenceWhole, isControlWhole, ...layout };
}

/**
 * Where the header's own controls sit, the brand mark and the avatar menu,
 * keyed by name. They are siblings of the status row, so a row that grew
 * would push them.
 */
async function readHeaderControls(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const controls: Record<string, string> = {};
    for (const element of document.querySelectorAll('header button, header a')) {
      if (element.closest('[data-slot="header-status"]') !== null) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const name = element.getAttribute('aria-label') ?? element.getAttribute('data-slot') ?? element.tagName;
      controls[name] = `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
    }
    return controls;
  });
}

/** One `layout-shift` entry that moved something inside the header. */
interface HeaderShiftEntry {
  value: number;
  sources: string[];
}

/**
 * Installs a second `layout-shift` observer that keeps only the entries that
 * moved something INSIDE THE HEADER. Call before the first `goto`.
 *
 * Why a second one: the delete that publishes the Undo status also navigates
 * to the diary, and the diary moves by itself after a navigation from the
 * entry screen (see the arrival below), so the whole-page total of that
 * moment is not a reading of the status.
 */
async function installHeaderShiftObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const entries: HeaderShiftEntry[] = [];
    Object.defineProperty(window, '__headerShiftEntries', { value: entries });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // `toJSON` is typed `any` and is the one read of a `LayoutShift` that needs no cast.
        const json = entry.toJSON();
        const nodes: unknown[] = Array.isArray(json.sources) ? json.sources.map((source: { node?: unknown }) => source.node) : [];
        const moved = nodes.filter((node): node is Element => node instanceof Element && node.closest('header') !== null);
        if (moved.length === 0) continue;
        entries.push({
          value: Number(json.value),
          sources: moved.map((node) => `${node.tagName.toLowerCase()} "${(node.textContent ?? '').trim().slice(0, 30)}"`),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

/** The summed score of some header shift entries. */
function headerShiftScore(entries: readonly HeaderShiftEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.value, 0);
}

/** Every header shift recorded so far, in order. */
async function readHeaderShiftEntries(page: Page): Promise<HeaderShiftEntry[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__headerShiftEntries')?.value;
    return Array.isArray(recorded) ? [...recorded] : [];
  });
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
  await installHeaderShiftObserver(page);
});

test('after a delete, the undo control is a button that holds an icon, and it arrives and goes without moving anything', async ({
  page,
}) => {
  await completeOnboarding(page);
  await logFoodManually(page, { name: FOOD_NAME, grams: FOOD_GRAMS });
  await entryLink(page).first().click();
  await page.waitForURL('**/diary/entry/**');
  await settleAnimations(page);
  const headerBefore = await readHeaderControls(page);
  const headerShiftsBefore = (await readHeaderShiftEntries(page)).length;

  // ── It arrives ────────────────────────────────────────────────────────
  await page.getByRole('button', { name: EN.entry.action.delete }).click();
  await expect.poll(() => headerStatusText(page)).toBe(fill(EN.entry.toast.removed, { name: FOOD_NAME }));
  const undo = headerStatus(page).getByRole('button', { name: EN.entry.toast.undo, exact: true });
  await expect(undo).toBeVisible();
  await page.waitForURL(/\/diary$/u);
  await settleFrames(page);

  const look = await readControlLook(undo);
  expect(look.iconCount, 'the undo control holds no icon').toBe(1);
  expect(look.isUnderlined, 'the undo control still reads as underlined words').toBe(false);
  expect(look.height, 'the undo control is under the tap floor').toBeGreaterThanOrEqual(TAP_FLOOR);
  expect(look.width, 'the undo control is under the tap floor').toBeGreaterThanOrEqual(TAP_FLOOR);
  // THE CONTROL for the icon reading: the close control beside it holds its X
  // icon, found through the same query, so a zero above is the undo control.
  const close = headerStatus(page).getByRole('button', { name: EN.chrome.status.dismiss, exact: true });
  expect((await readControlLook(close)).iconCount, 'the icon reading finds no icon at all').toBe(1);

  const fit = await readUndoRowFit(page, undo);
  expect(fit.isRowWhole, 'the status row overflows').toBe(true);
  expect(fit.isControlWhole, 'the undo label is cut off').toBe(true);
  expect(fit.isSentenceWhole, 'the sentence is cut off').toBe(true);
  expect(fit.documentScrollWidth, 'the document overflows').toBe(PHONE_WIDTH);
  expect(fit.headerHeight, 'the status opened the header').toBe(HEADER_HEIGHT);
  expect(await readHeaderControls(page), 'the status moved the header controls').toEqual(headerBefore);
  // THE ARRIVAL IS READ IN THE HEADER. The status can move the header's own
  // contents, or everything below if it opened the header, which the 64 px
  // reading above rules out. The whole page is not read here: the diary moves
  // by itself after a navigation from the entry screen (its day block grows,
  // about 0.05, and a plain Back with no status at all does the same), and
  // that is the diary's, not this row's. The row going is read on a still
  // page, in full, below.
  const arrival = (await readHeaderShiftEntries(page)).slice(headerShiftsBefore);
  expect(
    headerShiftScore(arrival),
    `layout-shift in the header while it arrived: ${arrival.flatMap((entry) => entry.sources).join('; ')}`,
  ).toBe(0);

  // ── It goes ───────────────────────────────────────────────────────────
  // It clears itself (a confirmation's four seconds); the diary under it and
  // the header controls beside it must not move when it does.
  const topsShowing = await readTops(page);
  const shiftsShowing = (await readShiftEntries(page)).length;
  // NON-VACUITY: the readings above were taken with the status still up.
  await expect(undo).toHaveCount(1);
  await expect(undo).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('header h1')).toBeVisible();
  await settleFrames(page);
  expect(movedBetween(topsShowing, await readTops(page)), 'the status going moved the diary').toEqual([]);
  expect(await readHeaderControls(page), 'the status going moved the header controls').toEqual(headerBefore);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsShowing), 'layout-shift while it went').toBe(0);

  // THE CONTROL for the header reading: a header control moved on purpose
  // must register there.
  const headerShiftsQuiet = (await readHeaderShiftEntries(page)).length;
  await page.locator('header [data-slot="header-mark"]').evaluate((mark) => {
    if (mark instanceof HTMLElement) mark.style.marginTop = '12px';
  });
  await settleFrames(page);
  expect(
    headerShiftScore((await readHeaderShiftEntries(page)).slice(headerShiftsQuiet)),
    'the header reading cannot see a header control move',
  ).toBeGreaterThan(0);
});

test('the undo control and its sentence fit the row at 390 px in all six languages', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, { name: FOOD_NAME, grams: FOOD_GRAMS });

  const cutOff: string[] = [];
  for (const locale of SUPPORTED_LANGUAGES) {
    const copy = catalogFor(locale);
    await useLanguage(page, locale);
    await page.goto('/diary');
    expect(await page.locator('html').getAttribute('lang'), `${locale}: the document is in that language`).toBe(locale);
    await deleteEntry(page, copy.entry.action.delete);
    await expect
      .poll(() => headerStatusText(page), { message: `${locale}: the status is that language's sentence` })
      .toBe(fill(copy.entry.toast.removed, { name: FOOD_NAME }));
    const undo = headerStatus(page).getByRole('button', { name: copy.entry.toast.undo, exact: true });
    await expect(undo).toBeVisible();

    const look = await readControlLook(undo);
    if (look.iconCount !== 1) cutOff.push(`${locale}: the undo control holds ${look.iconCount} icons`);
    const fit = await readUndoRowFit(page, undo);
    if (!fit.isRowWhole) cutOff.push(`${locale}: the status row overflows`);
    if (!fit.isControlWhole) cutOff.push(`${locale}: the undo label is cut off`);
    if (!fit.isSentenceWhole) cutOff.push(`${locale}: the sentence is cut off`);
    if (fit.documentScrollWidth !== PHONE_WIDTH) cutOff.push(`${locale}: the document is ${fit.documentScrollWidth} px`);
    if (fit.headerHeight !== HEADER_HEIGHT) cutOff.push(`${locale}: the header is ${fit.headerHeight} px`);

    // Put it back for the next language, through that language's Undo.
    await page.waitForURL(/\/diary$/u);
    await expect(entryLink(page)).toHaveCount(0);
    await undo.click();
    await expect(entryLink(page)).toHaveCount(1);
  }
  expect(cutOff, 'the undo row does not fit at 390 px').toEqual([]);

  // THE CONTROL for the fit reading: the same control squeezed to 20 px must
  // read as cut off.
  await useLanguage(page, 'en');
  await page.goto('/diary');
  await deleteEntry(page, EN.entry.action.delete);
  const undo = headerStatus(page).getByRole('button', { name: EN.entry.toast.undo, exact: true });
  await expect(undo).toBeVisible();
  await undo.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.style.width = '20px';
      element.style.overflow = 'hidden';
    }
  });
  expect((await readUndoRowFit(page, undo)).isControlWhole, 'the fit reading cannot see a cut-off control').toBe(false);
});

test('CONTROL: the plan action keeps its sentence-end look, with no icon', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  await routeAccountAllowance(page, {
    dailyAiLimit: 20,
    allowanceExpiresAt: null,
    trialScans: { granted: 10, left: 10 },
  });
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  const action = headerStatus(page).getByRole('button', { name: EN.plan.countdown.action, exact: true });
  await expect(action).toBeVisible({ timeout: 10_000 });
  const look = await readControlLook(action);
  expect(look.iconCount, 'the plan action grew an icon').toBe(0);
  expect(look.isUnderlined, 'the plan action lost its underlined sentence-end look').toBe(true);
});
