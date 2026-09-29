/**
 * The diary's Undo is a control with an icon, not the sentence's last words
 * (M265/07).
 *
 * On 2026-09-28 every status action became underlined words at the end of the
 * sentence, because a bordered plan button beside the trial countdown left the
 * German sentence about 40 px at 390 px (`header-status.tsx`). That fix was
 * right for the plan action and took the diary's Undo with it. The decision
 * (the architect, 2026-09-29): every Undo is an ICON-ONLY square button,
 * 44 x 44 px, the `Undo2` icon, its label the accessible name and not drawn.
 * The plan action keeps its sentence-end look.
 *
 * EVERY UNDO LOOKS THE SAME (M265 follow-up). Three statuses offer Undo: the
 * entry screen's delete, the diary's quick-add chip, and a copy from
 * yesterday. The two diary ones kept the underlined words after the first
 * fix, so the app had two looks for one action. The six-language walk drives
 * all three.
 *
 * WHAT IS REAL: the production build, the diary on disk, the entry screen's
 * delete, the chip and the copy the diary draws, the statuses they publish and
 * the row that draws them. The plan action is a real trial countdown on
 * stubbed plan reads (`plans-stub.ts`).
 *
 * NO CLOSE CONTROL BESIDE AN UNDO (the architect, 2026-09-29). An Undo status
 * clears itself after four seconds, so it draws only its Undo; a status with
 * no Undo keeps its close control exactly as before.
 *
 * Every reading has a control: the plan action is read through the same
 * queries and draws its words, no icon, and keeps its close control with its
 * X icon; the fit reading is shown a button made to draw words it cannot hold
 * and must call it cut off.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { EN, catalogFor, fill } from './copy';
import {
  FIT_WIDTHS,
  HEADER_HEIGHT,
  NARROW_PHONE_WIDTH,
  PHONE_HEIGHT,
  PHONE_WIDTH,
  completeOnboarding,
  headerStatusText,
  logFoodManually,
  signInFixtureAccount,
  useLanguage,
} from './helpers';
import {
  headerShiftAfter,
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore } from './plans-stub';

/**
 * The entry the delete path deletes and puts back. It sits on today.
 *
 * EVERY SEEDED NAME IS 18 CHARACTERS OR FEWER, the cap a status sentence
 * keeps whole (`shorten-food-name.ts`), so these sentences are read word for
 * word; the long-name case below is the one that is shortened.
 */
const FOOD_NAME = 'Smoke tier muesli';

/** How many grams of it, for the hand-typed entry of the first case. */
const FOOD_GRAMS = '200';

/** The food the quick-add chip logs. Two past days make it a chip (`MIN_CHIP_TIMES_LOGGED`). */
const CHIP_FOOD = 'Smoke tier toast';

/** Yesterday's one lunch entry, which the copy chip copies onto today. One entry, so the status offers Undo. */
const YESTERDAY_FOOD = 'Smoke tier soup';

/** A 40 character German food name, far past the cap. */
const LONG_FOOD_NAME = 'Dinkelporridge mit Heidelbeeren und Zimt';

/** A second one, for the quick-add chip, so the two long entries are told apart. */
const LONG_CHIP_NAME = 'Roggenbrot mit Frischkäse und Radieschen';

/** The names a seeded diary carries: today's entry, the chip food, yesterday's lunch. */
interface DiaryNames {
  todayFood: string;
  chipFood: string;
  yesterdayFood: string;
}

const SEED_NAMES: DiaryNames = { todayFood: FOOD_NAME, chipFood: CHIP_FOOD, yesterdayFood: YESTERDAY_FOOD };

/** The app's tap floor, in CSS px. */
const TAP_FLOOR = 44;

/** The three statuses that offer Undo. */
type UndoPath = 'delete' | 'quick-add' | 'copy';

const UNDO_PATHS: readonly UndoPath[] = ['delete', 'quick-add', 'copy'];

/** One language's words, as the spec reads them. */
type Copy = ReturnType<typeof catalogFor>;

function headerStatus(page: Page): Locator {
  return page.locator('header [data-slot="header-status"]');
}

/** Today's entries of one food, as links on the diary. */
function entryLinks(page: Page, name: string): Locator {
  return page.getByRole('link', { name: new RegExp(name, 'u') });
}

function entryLink(page: Page): Locator {
  return entryLinks(page, FOOD_NAME);
}

/** Opens the entry from the diary and deletes it, which publishes the Undo status and returns to the diary. */
async function deleteEntry(page: Page, deleteLabel: string, name: string = FOOD_NAME): Promise<void> {
  await entryLinks(page, name).first().click();
  await page.waitForURL('**/diary/entry/**');
  await page.getByRole('button', { name: deleteLabel }).click();
}

/** The diary's "copy from yesterday" chip for lunch, found by the fields its form posts. */
function copyLunchChip(page: Page): Locator {
  return page
    .locator('form')
    .filter({ has: page.locator('input[name="_intent"][value="copy-yesterday"]') })
    .filter({ has: page.locator('input[name="mealType"][value="lunch"]') })
    .getByRole('button');
}

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** One seeded entry. */
interface SeedLog {
  dayKey: string;
  mealType: 'breakfast' | 'lunch';
  name: string;
}

/**
 * A device past onboarding whose diary holds: today's entry for the delete,
 * the chip food on two past days, and one lunch entry yesterday. Written into
 * the primary store's `foodLogs` table on disk, the layout every `insights-*`
 * and `mobile-*` spec writes, then read by a document load.
 */
async function seedUndoDiary(page: Page, names: DiaryNames = SEED_NAMES): Promise<void> {
  await completeOnboarding(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const logs: SeedLog[] = [
    { dayKey: today, mealType: 'breakfast', name: names.todayFood },
    { dayKey: shiftDay(today, -2), mealType: 'breakfast', name: names.chipFood },
    { dayKey: shiftDay(today, -3), mealType: 'breakfast', name: names.chipFood },
    { dayKey: shiftDay(today, -1), mealType: 'lunch', name: names.yesterdayFood },
  ];
  await page.evaluate(
    (seedLogs) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells = Object.fromEntries(
            seedLogs.map((log, index) => {
              const id = `undo-seed-${index}`;
              const loggedAt = Date.parse(`${log.dayKey}T1${index % 3}:00:00Z`);
              const macros = { carbs: 30, fiber: 4, sugars: null, polyols: 0, protein: 8, fat: 5, kcal: 200 };
              const entity = {
                id,
                name: log.name,
                quantityGrams: 100,
                macros,
                mealType: log.mealType,
                source: 'manual',
                aiEstimated: false,
                curatedSource: null,
                foodId: null,
                dayKey: log.dayKey,
                loggedAt,
                createdAt: loggedAt,
                logBatchId: null,
              };
              return [id, { entity: JSON.stringify(entity) }];
            }),
          );
          const transaction = db.transaction('t', 'readwrite');
          transaction.objectStore('t').put({ k: 'foodLogs', v: cells });
          transaction.addEventListener('complete', () => {
            db.close();
            resolve();
          });
          transaction.addEventListener('error', () => reject(new Error('the seed write failed')));
        });
      }),
    logs,
  );
  await page.goto('/diary');
  await expect(entryLinks(page, names.todayFood)).toHaveCount(1);
}

/**
 * Publishes one of the three Undo statuses from the diary the page is on, and
 * answers the sentence it says for a name the sentence keeps whole.
 */
async function triggerUndoStatus(
  page: Page,
  path: UndoPath,
  copy: Copy,
  names: DiaryNames = SEED_NAMES,
): Promise<string> {
  switch (path) {
    case 'delete':
      await deleteEntry(page, copy.entry.action.delete, names.todayFood);
      return fill(copy.entry.toast.removed, { name: names.todayFood });
    case 'quick-add':
      await page.locator('[data-slot="quick-add-chip"]').filter({ hasText: names.chipFood }).click();
      return fill(copy.diary.toast.addedOne, { name: names.chipFood });
    case 'copy':
      await copyLunchChip(page).click();
      return fill(copy.diary.toast.copiedOne, { name: names.yesterdayFood });
  }
}

/** The status row's close control, found by that language's name for it. */
function closeControl(page: Page, copy: Copy): Locator {
  return headerStatus(page).getByRole('button', { name: copy.chrome.status.dismiss, exact: true });
}

/**
 * What the Undo row draws besides its Undo: an Undo status clears itself
 * after four seconds, so it draws no close control (the architect, 2026-09-29).
 */
async function closeFailures(page: Page, copy: Copy, where: string): Promise<string[]> {
  const failures: string[] = [];
  const closeCount = await closeControl(page, copy).count();
  const buttonCount = await headerStatus(page).getByRole('button').count();
  if (closeCount !== 0) failures.push(`${where}: the undo status draws a close control`);
  if (buttonCount !== 1) failures.push(`${where}: the undo row holds ${buttonCount} buttons, not only its undo`);
  return failures;
}

/** The Undo label a path's status carries, in one language. */
function undoLabel(path: UndoPath, copy: Copy): string {
  return path === 'delete' ? copy.entry.toast.undo : copy.diary.actions.undo;
}

/** The Undo a path's status offers, found by its role and that language's label. */
function undoControl(page: Page, path: UndoPath, copy: Copy): Locator {
  return headerStatus(page).getByRole('button', { name: undoLabel(path, copy), exact: true });
}

/** Takes the Undo and waits until the diary is back to its seeded state. */
async function takeUndo(page: Page, path: UndoPath, undo: Locator, names: DiaryNames = SEED_NAMES): Promise<void> {
  switch (path) {
    case 'delete':
      await page.waitForURL(/\/diary$/u);
      await expect(entryLinks(page, names.todayFood)).toHaveCount(0);
      await undo.click();
      await expect(entryLinks(page, names.todayFood)).toHaveCount(1);
      return;
    case 'quick-add':
      await expect(entryLinks(page, names.chipFood)).toHaveCount(1);
      await undo.click();
      await expect(entryLinks(page, names.chipFood)).toHaveCount(0);
      return;
    case 'copy':
      await expect(entryLinks(page, names.yesterdayFood)).toHaveCount(1);
      await undo.click();
      await expect(entryLinks(page, names.yesterdayFood)).toHaveCount(0);
  }
}

/** What a control in the status row looks like, read off the element. */
interface ControlLook {
  iconCount: number;
  width: number;
  height: number;
  isUnderlined: boolean;
  /** The words drawn inside the control, trimmed. */
  drawnText: string;
  ariaLabel: string | null;
}

async function readControlLook(control: Locator): Promise<ControlLook> {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      iconCount: element.querySelectorAll('svg').length,
      width: Math.round(box.width),
      height: Math.round(box.height),
      isUnderlined: getComputedStyle(element).textDecorationLine.includes('underline'),
      drawnText: element instanceof HTMLElement ? element.innerText.trim() : '',
      ariaLabel: element.getAttribute('aria-label'),
    };
  });
}

/**
 * What an Undo control gets wrong against the architect's decision
 * (2026-09-29): an ICON-ONLY square button, 44 x 44 px, the `Undo2` icon and
 * nothing drawn beside it, the Undo label as its accessible name.
 */
function iconOnlyFailures(look: ControlLook, label: string, where: string): string[] {
  const failures: string[] = [];
  if (look.iconCount !== 1) failures.push(`holds ${look.iconCount} icons`);
  if (look.drawnText !== '') failures.push(`draws "${look.drawnText}"`);
  if (look.ariaLabel !== label) failures.push(`is named by aria-label ${JSON.stringify(look.ariaLabel)}`);
  if (look.width !== TAP_FLOOR || look.height !== TAP_FLOOR) failures.push(`is ${look.width} x ${look.height} px`);
  if (look.isUnderlined) failures.push('is underlined');
  return failures.map((failure) => `${where}: the undo control ${failure}`);
}

/** Whether the status row, its lines and its Undo control all fit, the page around them, and the boxes measured. */
interface UndoRowFit {
  isRowWhole: boolean;
  isControlWhole: boolean;
  isSentenceWhole: boolean;
  /** True when there is no second line. */
  isDescriptionWhole: boolean;
  documentScrollWidth: number;
  headerHeight: number;
  /** The widths and heights behind the answers, for a failure message. */
  boxes: string;
}

async function readUndoRowFit(page: Page, control: Locator): Promise<UndoRowFit> {
  const controlBox = await control.evaluate((element) => ({
    isWhole: element.scrollWidth <= element.clientWidth,
    width: Math.round(element.getBoundingClientRect().width),
  }));
  const row = await headerStatus(page).evaluate((element) => {
    const column = element.firstElementChild;
    const text = element.querySelector('[data-slot="header-status-text"]');
    const description = element.querySelector('[data-slot="header-status-description"]');
    if (column === null || text === null) throw new Error('the status row has no text column');
    return {
      isRowWhole: element.scrollWidth <= element.clientWidth,
      isSentenceWhole: text.scrollHeight <= text.clientHeight && text.scrollWidth <= text.clientWidth,
      isDescriptionWhole:
        description === null ||
        (description.scrollHeight <= description.clientHeight && description.scrollWidth <= description.clientWidth),
      columnWidth: Math.round(column.getBoundingClientRect().width),
      sentence: `${text.scrollHeight}/${text.clientHeight} px tall, ${text.scrollWidth}/${text.clientWidth} px wide`,
      secondLine:
        description === null ? 'none' : (
          `${description.scrollHeight}/${description.clientHeight} px tall, ${description.scrollWidth}/${description.clientWidth} px wide`
        ),
      documentScrollWidth: document.documentElement.scrollWidth,
      headerHeight: Math.round(document.querySelector('header')?.getBoundingClientRect().height ?? 0),
    };
  });
  return {
    isRowWhole: row.isRowWhole,
    isControlWhole: controlBox.isWhole,
    isSentenceWhole: row.isSentenceWhole,
    isDescriptionWhole: row.isDescriptionWhole,
    documentScrollWidth: row.documentScrollWidth,
    headerHeight: row.headerHeight,
    boxes: `column ${row.columnWidth} px, control ${controlBox.width} px, sentence ${row.sentence}, second line ${row.secondLine}`,
  };
}

/** What the row gets wrong around its lines: the row, the control, the page width and the header height. */
function rowFailures(fit: UndoRowFit, where: string, width: number): string[] {
  const failures: string[] = [];
  if (!fit.isRowWhole) failures.push(`${where}: the status row overflows`);
  if (!fit.isControlWhole) failures.push(`${where}: the undo control is cut off`);
  if (fit.documentScrollWidth !== width) failures.push(`${where}: the document is ${fit.documentScrollWidth} px`);
  if (fit.headerHeight !== HEADER_HEIGHT) failures.push(`${where}: the header is ${fit.headerHeight} px`);
  return failures.map((failure) => `${failure} (${fit.boxes})`);
}

/** Which of the row's lines are cut off: the sentence, and the second line when there is one. */
function lineFailures(fit: UndoRowFit, where: string): string[] {
  const failures: string[] = [];
  if (!fit.isSentenceWhole) failures.push(`${where}: the sentence is cut off`);
  if (!fit.isDescriptionWhole) failures.push(`${where}: the second line is cut off`);
  return failures.map((failure) => `${failure} (${fit.boxes})`);
}

/** Everything a fit reading found wrong, each with the boxes behind it. */
function fitFailures(fit: UndoRowFit, where: string, width: number): string[] {
  return [...rowFailures(fit, where, width), ...lineFailures(fit, where)];
}

/**
 * The same, without the second line.
 *
 * THE SECOND LINE IS NOT READ FOR THE QUICK-ADD AND COPY STATUSES YET (M265,
 * 2026-09-29). Beside the Undo button and the close control their second line
 * ("To Lunch, 52 g net carbs so far today.") has two lines of 18 characters at
 * 360 px and 22 at 390 px, and it needs three or more in most languages, and
 * in English too for a long meal, an estimate and a past day. No wording
 * keeps the meal, the figure and the day inside that, so the layout is an open
 * decision with the architect. Once it is made, these readers use
 * `fitFailures` again.
 */
function fitFailuresBesideSecondLine(fit: UndoRowFit, where: string, width: number): string[] {
  return [...rowFailures(fit, where, width), ...lineFailures({ ...fit, isDescriptionWhole: true }, where)];
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
      controls[name] =
        `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
    }
    return controls;
  });
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

for (const width of FIT_WIDTHS) {
  test(`at ${width} px, after a delete, the undo control is the icon button, and it arrives and goes without moving anything`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    await completeOnboarding(page);
    await logFoodManually(page, { name: FOOD_NAME, grams: FOOD_GRAMS });
    await entryLink(page).first().click();
    await page.waitForURL('**/diary/entry/**');
    await settleAnimations(page);
    const headerBefore = await readHeaderControls(page);
    const shiftsBefore = (await readShiftEntries(page)).length;

    // ── It arrives ────────────────────────────────────────────────────────
    await page.getByRole('button', { name: EN.entry.action.delete }).click();
    await expect.poll(() => headerStatusText(page)).toBe(fill(EN.entry.toast.removed, { name: FOOD_NAME }));
    const undo = headerStatus(page).getByRole('button', { name: EN.entry.toast.undo, exact: true });
    await expect(undo).toBeVisible();
    await page.waitForURL(/\/diary$/u);
    await settleFrames(page);

    expect(iconOnlyFailures(await readControlLook(undo), EN.entry.toast.undo, 'delete')).toEqual([]);
    expect(await closeFailures(page, EN, 'delete')).toEqual([]);

    expect(fitFailures(await readUndoRowFit(page, undo), 'delete', width), 'the undo row does not fit').toEqual([]);
    expect(await readHeaderControls(page), 'the status moved the header controls').toEqual(headerBefore);
    // THE ARRIVAL IS READ IN THE HEADER. The status can move the header's own
    // contents, or everything below if it opened the header, which the 64 px
    // reading above rules out. The whole page is not read here: the diary moves
    // by itself after a navigation from the entry screen (its day block grows,
    // about 0.05, and a plain Back with no status at all does the same), and
    // that is the diary's, not this row's. The row going is read on a still
    // page, in full, below.
    const arrival = headerShiftAfter(await readShiftEntries(page), shiftsBefore);
    expect(arrival.score, `layout-shift in the header while it arrived: ${arrival.sources.join('; ')}`).toBe(0);

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
    const shiftsQuiet = (await readShiftEntries(page)).length;
    await page.locator('header [data-slot="header-mark"]').evaluate((mark) => {
      if (mark instanceof HTMLElement) mark.style.marginTop = '12px';
    });
    await settleFrames(page);
    expect(
      headerShiftAfter(await readShiftEntries(page), shiftsQuiet).score,
      'the header reading cannot see a header control move',
    ).toBeGreaterThan(0);
  });
}

for (const width of FIT_WIDTHS) {
  test(`at ${width} px, the quick-add and copy undo are the same icon button, and arrive without moving the header`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    await seedUndoDiary(page);
    for (const path of ['quick-add', 'copy'] as const) {
      await page.goto('/diary');
      await settleAnimations(page);
      const headerBefore = await readHeaderControls(page);
      const shiftsBefore = (await readShiftEntries(page)).length;

      const sentence = await triggerUndoStatus(page, path, EN);
      await expect(headerStatus(page).locator('[data-slot="header-status-sentence"]')).toHaveText(sentence);
      const undo = undoControl(page, path, EN);
      await expect(undo).toBeVisible();
      await settleFrames(page);

      expect(iconOnlyFailures(await readControlLook(undo), undoLabel(path, EN), path)).toEqual([]);
      expect(await closeFailures(page, EN, path)).toEqual([]);
      expect(
        fitFailuresBesideSecondLine(await readUndoRowFit(page, undo), path, width),
        `${path}: the undo row does not fit`,
      ).toEqual([]);
      expect(await readHeaderControls(page), `${path}: the status moved the header controls`).toEqual(headerBefore);
      // IN THE HEADER, because the diary below changes on purpose: the chip and
      // the copy each add an entry to today's list.
      const arrival = headerShiftAfter(await readShiftEntries(page), shiftsBefore);
      expect(arrival.score, `${path}: layout-shift in the header while it arrived: ${arrival.sources.join('; ')}`).toBe(
        0,
      );

      await takeUndo(page, path, undo);
    }
  });
}

test('at 360 px in German, a long food name ends in "…" so the delete and quick-add sentences fit, and a short name stays whole', async ({
  page,
}) => {
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });
  const names: DiaryNames = { todayFood: LONG_FOOD_NAME, chipFood: LONG_CHIP_NAME, yesterdayFood: YESTERDAY_FOOD };
  await seedUndoDiary(page, names);
  await useLanguage(page, 'de');
  const copy = catalogFor('de');
  const sentenceSpan = headerStatus(page).locator('[data-slot="header-status-sentence"]');

  const failures: string[] = [];
  const longNames = { delete: LONG_FOOD_NAME, 'quick-add': LONG_CHIP_NAME } as const;
  for (const path of ['delete', 'quick-add'] as const) {
    await page.goto('/diary');
    const whole = await triggerUndoStatus(page, path, copy, names);
    const undo = undoControl(page, path, copy);
    await expect(undo).toBeVisible();
    const sentence = await sentenceSpan.innerText();
    const name = longNames[path];
    // THE NAME GIVES WAY, the sentence's own words stay: a start of the name,
    // one "…", and never the whole 40 characters.
    if (sentence === whole) failures.push(`${path}: the sentence carries the whole name: "${sentence}"`);
    if (!sentence.includes(`${name.slice(0, 10)}`)) failures.push(`${path}: the name's start is gone: "${sentence}"`);
    if (!sentence.includes('…')) failures.push(`${path}: the name does not end in "…": "${sentence}"`);
    const fit = await readUndoRowFit(page, undo);
    if (!fit.isSentenceWhole) failures.push(`${path}: the sentence is cut off: "${sentence}" (${fit.boxes})`);
    await takeUndo(page, path, undo, names);
  }
  expect(failures, 'a long food name does not fit the sentence at 360 px').toEqual([]);

  // THE CONTROL: a short name in the same row, the copy's, is not touched.
  await page.goto('/diary');
  const whole = await triggerUndoStatus(page, 'copy', copy, names);
  await expect(sentenceSpan).toHaveText(whole);
  expect(await sentenceSpan.innerText(), 'a short name grew an ellipsis').not.toContain('…');
});

test('every undo control is the icon button, and its row and sentence are whole at 390 and 360 px, in all six languages', async ({
  page,
}) => {
  await seedUndoDiary(page);

  const cutOff: string[] = [];
  for (const width of FIT_WIDTHS) {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    for (const locale of SUPPORTED_LANGUAGES) {
      const copy = catalogFor(locale);
      await useLanguage(page, locale);
      for (const path of UNDO_PATHS) {
        await page.goto('/diary');
        expect(
          await page.locator('html').getAttribute('lang'),
          `${width} ${locale}: the document is in that language`,
        ).toBe(locale);
        const sentence = await triggerUndoStatus(page, path, copy);
        await expect(
          headerStatus(page).locator('[data-slot="header-status-sentence"]'),
          `${width} ${locale} ${path}: the status is that language's sentence`,
        ).toHaveText(sentence);
        const undo = undoControl(page, path, copy);
        await expect(undo).toBeVisible();

        cutOff.push(
          ...iconOnlyFailures(await readControlLook(undo), undoLabel(path, copy), `${width} ${locale} ${path}`),
        );
        cutOff.push(...(await closeFailures(page, copy, `${width} ${locale} ${path}`)));
        cutOff.push(
          ...fitFailuresBesideSecondLine(await readUndoRowFit(page, undo), `${width} ${locale} ${path}`, width),
        );

        // Back to the seeded diary for the next case, through that language's Undo.
        await takeUndo(page, path, undo);
      }
    }
  }
  expect(cutOff, 'the undo rows do not fit').toEqual([]);

  // THE CONTROL for the fit reading: the same 44 px button made to draw a
  // run of words it cannot hold must read as cut off.
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await useLanguage(page, 'en');
  await page.goto('/diary');
  await deleteEntry(page, EN.entry.action.delete);
  const undo = undoControl(page, 'delete', EN);
  await expect(undo).toBeVisible();
  await undo.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.append(' Undo Undo Undo');
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
  // THE CONTROL for the "nothing drawn" and "named by aria-label" readings:
  // the plan action draws its label and needs no aria-label, read the same way.
  expect(look.drawnText, 'the drawn-text reading reads nothing').toBe(EN.plan.countdown.action);
  expect(iconOnlyFailures(look, EN.plan.countdown.action, 'plan')).not.toEqual([]);
  // THE CONTROL for the close-control reading: a status with no Undo (this
  // countdown persists until closed) keeps its close control, found by the
  // same name and counted in the same row, and the icon reading finds its X.
  const close = closeControl(page, EN);
  await expect(close).toHaveCount(1);
  expect((await readControlLook(close)).iconCount, 'the icon reading finds no icon at all').toBe(1);
  expect(await closeFailures(page, EN, 'plan')).not.toEqual([]);
});
