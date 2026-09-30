/**
 * Nothing on an onboarding step moves while a person types, picks or tabs
 * (operator report, 2026-09-23; DESIGN.md section 7).
 *
 * THE REPORT. Onboarding "shifts the layout while they type" in the weight
 * fields, the height field and others. An earlier headless attempt typed only
 * complete, valid values in one `fill` and saw nothing. A person does not type
 * like that: they type "7", then "72", they delete back to nothing, they type
 * a decimal comma, they switch the unit, they leave the field and come back.
 * So every field here is typed KEY BY KEY, with invalid values on the way, and
 * the page is read after EVERY key.
 *
 * TWO READINGS, as section 7 asks. The browser's own `layout-shift` entries,
 * all of them, including the ones it marks as following an input (that input
 * is the thing under test). And the top edge of every input, label, legend,
 * link and button in `main`, before and after, which names what moved and by
 * how many pixels. Each check fails with that list, never with a bare `false`.
 *
 * NOTHING IS ALLOWED TO MOVE CONTENT HERE, not even a pick that reveals its
 * own questions (owner report, 2026-10-01: "stuff plopping up after selecting
 * something", on a desktop). A picked style, a picked sex, a picked life phase
 * and a late install offer each swap what is shown INSIDE a box that was
 * already as tall as its tallest answer at the first paint. So every pick is
 * measured, from the very first one, at a phone width and a desktop width.
 *
 * WHAT A PICK SUBMITS is read too, off the live form with `new FormData`, so a
 * reserved but hidden control is proven to submit nothing, and the answers a
 * step sends are the ones it sent before its boxes were reserved.
 *
 * THE KEYBOARD IS NOT SIMULATED. Headless Chromium draws no on-screen keyboard
 * and never resizes the viewport for one, so a shift that only a phone's
 * keyboard causes cannot appear here. The last test resizes the viewport the
 * way a keyboard does, to say whether this layout moves under that alone.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
  type MovedElement,
} from './layout-shift';

/** One thing a person does to a field. */
type Edit = { type: string } | { press: string; times: number } | { blur: true } | { focus: true };

/** What a sequence of edits did to the page. */
interface EditReading {
  /** Every element that moved, with the edit that moved it. */
  moves: (MovedElement & { after: string })[];
  /** The summed `layout-shift` score over the whole sequence. */
  score: number;
  /** The browser's own attribution, for the failure message. */
  sources: string[];
}

/** How long a person's finger rests between two keys. */
const KEY_DELAY_MS = 60;

/**
 * Performs the edits on one field and reads the page after every single key.
 *
 * The baseline is read BEFORE the field is focused, so a focus that moves
 * something is caught as well.
 *
 * @param page - the page under test.
 * @param field - the input to type into.
 * @param edits - the sequence, in order.
 * @returns every move and the score.
 */
async function typeAndWatch(page: Page, field: Locator, edits: readonly Edit[]): Promise<EditReading> {
  await settleAnimations(page);
  const baseline = await readTops(page);
  const entriesBefore = (await readShiftEntries(page)).length;
  const moves: EditReading['moves'] = [];

  const record = async (label: string): Promise<void> => {
    await settleFrames(page);
    for (const move of movedBetween(baseline, await readTops(page))) {
      moves.push({ element: move.element, dy: move.dy, after: label });
    }
  };

  await field.click();
  await record('focus');
  for (const edit of edits) {
    if ('type' in edit) {
      for (const key of edit.type) {
        await page.keyboard.type(key, { delay: KEY_DELAY_MS });
        await record(`typed "${key}", field reads "${await field.inputValue()}"`);
      }
    } else if ('press' in edit) {
      for (let count = 1; count <= edit.times; count += 1) {
        await page.keyboard.press(edit.press, { delay: KEY_DELAY_MS });
        await record(`${edit.press}, field reads "${await field.inputValue()}"`);
      }
    } else if ('blur' in edit) {
      await field.blur();
      await record('blur');
    } else {
      await field.focus();
      await record('focus again');
    }
  }
  const entries = (await readShiftEntries(page)).slice(entriesBefore);
  return {
    moves,
    score: shiftScoreAfter(entries, 0),
    sources: entries.flatMap((entry) => entry.sources),
  };
}

/**
 * Does one thing to the page and reads what moved: the tops of every element
 * in `main` before and after, and the `layout-shift` entries in between.
 *
 * @param page - the page under test.
 * @param label - how the failure message names the act.
 * @param act - the click, the event or the edit.
 * @returns every move and the score.
 */
async function watch(page: Page, label: string, act: () => Promise<void>): Promise<EditReading> {
  await settleAnimations(page);
  const baseline = await readTops(page);
  const entriesBefore = (await readShiftEntries(page)).length;
  await act();
  await settleAnimations(page);
  const entries = (await readShiftEntries(page)).slice(entriesBefore);
  return {
    moves: movedBetween(baseline, await readTops(page)).map((move) => ({
      element: move.element,
      dy: move.dy,
      after: label,
    })),
    score: shiftScoreAfter(entries, 0),
    sources: entries.flatMap((entry) => entry.sources),
  };
}

/**
 * Clicks one control and reads what moved.
 *
 * @param page - the page under test.
 * @param target - what to click.
 * @param label - how the failure message names the click.
 * @returns every move and the score.
 */
async function clickAndWatch(page: Page, target: Locator, label: string): Promise<EditReading> {
  return watch(page, label, () => target.click());
}

/**
 * Asserts a reading moved nothing, naming every moved element if it did.
 *
 * @param reading - what `typeAndWatch` or `clickAndWatch` returned.
 * @param what - which field or pick, for the message.
 */
function expectNoShift(reading: EditReading, what: string): void {
  const report = [
    ...reading.moves.map((move) => `${move.element} moved ${move.dy} px after ${move.after}`),
    ...reading.sources.map((source) => `layout-shift source: ${source}`),
  ].join('\n');
  expect(reading.moves, `${what}: elements moved\n${report}`).toEqual([]);
  expect(reading.score, `${what}: layout-shift score\n${report}`).toBe(0);
}

/** Opens the first onboarding step on a device that has never been used. */
async function openFirstStep(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();
  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
}

/** Answers the first step with the style that asks nothing more, and lands on the weight step. */
async function reachWeightStep(page: Page): Promise<void> {
  await openFirstStep(page);
  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
}

/** The chip label wrapping a carb preset radio; the radio itself is `sr-only`. */
function carbChip(page: Page, presetId: string): Locator {
  return page.locator(`label:has(input[name="carbPreset"][value="${presetId}"])`);
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('picking a carb limit on the first step moves nothing below it', async ({ page }) => {
  await openFirstStep(page);
  // Picking the style itself is measured in the cycling test below.
  await page.locator('input[name="eatingStyle"][value="low-carb"]').check();
  await expect(carbChip(page, 'keto')).toBeVisible();

  for (const presetId of ['keto', 'low-carb', 'moderate', 'keto']) {
    expectNoShift(await clickAndWatch(page, carbChip(page, presetId), `picking ${presetId}`), `carb chip ${presetId}`);
  }
});

test('typing a calorie target on the first step moves nothing', async ({ page }) => {
  await openFirstStep(page);
  await page.locator('input[name="eatingStyle"][value="low-kcal"]').check();
  const kcal = page.locator('#kcalTarget');
  await expect(kcal).toBeVisible();
  expectNoShift(
    await typeAndWatch(page, kcal, [
      { type: '18' },
      { type: '00' },
      { press: 'Backspace', times: 4 },
      { type: '1,5' },
      { press: 'Backspace', times: 3 },
      { type: '2000' },
      { blur: true },
      { focus: true },
    ]),
    'calorie target',
  );
});

test('typing both weights, switching the unit and leaving the field moves nothing', async ({ page }) => {
  await reachWeightStep(page);
  const current = page.locator('#currentWeightKg');
  const target = page.locator('#targetWeightKg');
  expectNoShift(
    await typeAndWatch(page, current, [
      { type: '7' },
      { type: '2' },
      { press: 'Backspace', times: 2 },
      { type: '72,5' },
      { blur: true },
      { focus: true },
      { type: 'x' },
      { press: 'Backspace', times: 1 },
    ]),
    'current weight',
  );
  expectNoShift(
    await typeAndWatch(page, target, [{ type: '6' }, { type: '8' }, { type: '.4' }, { blur: true }]),
    'target weight',
  );
  // The unit names are data, not copy: `WEIGHT_UNITS` writes them verbatim.
  const unitButton = (unit: 'kg' | 'lb'): Locator => page.getByRole('button', { name: unit, exact: true });
  expectNoShift(await clickAndWatch(page, unitButton('lb'), 'switching to lb'), 'lb');
  expectNoShift(await clickAndWatch(page, unitButton('kg'), 'switching to kg'), 'kg');
  expectNoShift(
    await typeAndWatch(page, current, [{ press: 'End', times: 1 }, { press: 'Backspace', times: 5 }, { type: '9' }]),
    'current weight, deleted back and retyped',
  );
});

test('typing height and birth year, and a pregnancy week, moves nothing', async ({ page }) => {
  await reachWeightStep(page);
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();

  expectNoShift(
    await typeAndWatch(page, page.locator('#heightCm'), [
      { type: '1' },
      { type: '8' },
      { type: '2' },
      { press: 'Backspace', times: 3 },
      { type: '18' },
      { blur: true },
    ]),
    'height',
  );
  expectNoShift(
    await typeAndWatch(page, page.locator('#birthYear'), [
      { type: '19' },
      { type: '90' },
      { press: 'Backspace', times: 4 },
      { type: '19' },
      { blur: true },
    ]),
    'birth year',
  );

  // Picks among equal answers: a sex that keeps the pregnancy question on
  // screen, then back to no answer, and three allergen chips on and off. A
  // chosen chip used to be 8 px wider than an unchosen one, which reflows the
  // row of fourteen allergens.
  for (const value of ['female', '']) {
    const chip = page.locator(`label:has(input[name="biologicalSex"][value="${value}"])`);
    expectNoShift(await clickAndWatch(page, chip, `picking sex "${value}"`), `sex chip "${value}"`);
  }
  for (const allergen of ['milk', 'eggs', 'milk']) {
    const chip = page.locator(`label:has(input[name="allergens"][value="${allergen}"])`);
    expectNoShift(await clickAndWatch(page, chip, `toggling ${allergen}`), `allergen chip ${allergen}`);
  }

  // Picking "Pregnant" is measured in the life phase test below.
  await page.locator('label:has(input[name="reproductiveStatus"][value="pregnant"])').click();
  const weeks = page.locator('#pregnancyDueDate-weeks');
  await expect(weeks).toBeVisible();
  expectNoShift(
    await typeAndWatch(page, weeks, [
      { type: '1' },
      { type: '4' },
      { press: 'Backspace', times: 2 },
      { type: '30' },
      { blur: true },
    ]),
    'pregnancy week',
  );
});

test('a keyboard-sized viewport change moves nothing already on screen', async ({ page }) => {
  await reachWeightStep(page);
  const current = page.locator('#currentWeightKg');
  await current.click();
  await settleFrames(page);
  // `readTops` measures from the top of the page, so a keyboard that scrolls
  // the focused field into view is not read as a move; an element moving
  // relative to the page is.
  const before = await readTops(page);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('the phone project always sets a viewport');
  // About the height a phone keyboard takes from an 844 px screen.
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 336 });
  await settleFrames(page);
  const after = await readTops(page);
  expect(movedBetween(before, after), 'elements moved when the viewport lost a keyboard of height').toEqual([]);
});

////////////////////////////////////////////////////////////////////////////////
// Every pick, from the first one, at a phone width and a desktop width
////////////////////////////////////////////////////////////////////////////////

/** One screen size every pick below is measured at. */
interface MeasuredScreen {
  name: string;
  options: {
    viewport: { width: number; height: number };
    isMobile?: boolean;
    hasTouch?: boolean;
    deviceScaleFactor?: number;
  };
}

/**
 * The phone the tier is written for, and a desktop window, where the owner
 * saw the report. A box is as tall as its tallest answer AT A WIDTH, so a
 * reservation that holds on one can still fail on the other.
 */
const MEASURED_SCREENS: readonly MeasuredScreen[] = [
  { name: 'phone 390x844', options: { viewport: { width: 390, height: 844 } } },
  {
    name: 'desktop 1280x800',
    options: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  },
];

/** A Safari on an iPhone, so the install footnote takes its iOS answer after mount. */
const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** The style order the cycling test walks: every style, and every change between a carb, a calorie and a plain one. */
const STYLE_CYCLE = [
  'low-carb',
  'low-carb-low-kcal',
  'low-kcal',
  'high-protein',
  'just-track',
  'low-carb',
  'low-kcal',
  'low-carb-low-kcal',
  'high-protein',
] as const;

/** The card for one eating style: the label around its radio. */
function styleCard(page: Page, style: string): Locator {
  return page.locator(`label:has(input[name="eatingStyle"][value="${style}"])`);
}

/** The chip for one main goal: the label around its `sr-only` radio. */
function mainGoalChip(page: Page, goal: string): Locator {
  return page.locator(`label:has(input[name="mainGoal"][value="${goal}"])`);
}

/**
 * The fields the step's form would submit right now, as sorted `key=value`
 * lines, without the time zone every step carries. Read with `new FormData`,
 * the browser's own answer to "what does this form send", so a hidden control
 * that still submits shows up here.
 *
 * @param page - a page on an onboarding step.
 * @param keys - the field names to keep.
 * @returns the lines, sorted.
 */
async function submittedFields(page: Page, keys: readonly string[]): Promise<string[]> {
  const lines = await page.evaluate(() => {
    const form = document.querySelector('main form');
    if (!(form instanceof HTMLFormElement)) throw new Error('the step has no form');
    return Array.from(
      new FormData(form).entries(),
      ([key, value]) => `${key}=${value instanceof File ? 'file' : value}`,
    );
  });
  return lines.filter((line) => keys.includes(line.slice(0, line.indexOf('=')))).toSorted();
}

/** The field NAMES the style step submits for one style, before any carb limit is picked. */
function styleStepKeys(style: string): string[] {
  const asksCalories = style === 'low-carb-low-kcal' || style === 'low-kcal';
  return (asksCalories ? ['eatingStyle', 'kcalTarget', 'mainGoal'] : ['eatingStyle', 'mainGoal']).toSorted();
}

/** The names of the style step's own answers. */
const STYLE_STEP_FIELDS = ['eatingStyle', 'carbPreset', 'kcalTarget', 'mainGoal'] as const;

/** The names of the life phase answers on the body step. */
const LIFE_PHASE_FIELDS = ['reproductiveStatus', 'pregnancyDueDate', 'lactationStartDate'] as const;

/** Walks from the first step to the body step with the style that asks nothing more. */
async function reachBodyStep(page: Page): Promise<void> {
  await reachWeightStep(page);
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
}

/** Walks from the first step to the last one, skipping the two optional steps. */
async function reachFirstFoodStep(page: Page): Promise<void> {
  await reachBodyStep(page);
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
}

/**
 * The install footnote: the last box in the step's card. Found by its place,
 * not by a slot, so the same reader works on the markup before and after its
 * box was reserved.
 */
const INSTALL_NOTE_SELECTOR = 'main [data-slot="card"] > :last-child > :last-child';

/**
 * Records every height the install footnote is laid out at, from the first
 * frame it exists on the first-food step. A `ResizeObserver` reports the size
 * after every layout that changed it, including the first one, so a footnote
 * that paints one answer and then a taller one after an effect leaves two
 * heights here, even when no test step ran between them.
 *
 * @param page - a page that has not navigated yet.
 */
async function recordInstallNoteHeights(page: Page): Promise<void> {
  await page.addInitScript((selector) => {
    const heights: number[] = [];
    Object.defineProperty(window, '__installNoteHeights', { value: heights });
    let watched: Element | null = null;
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        heights.push(Math.round(entry.target.getBoundingClientRect().height * 10) / 10);
      }
    });
    new MutationObserver(() => {
      const found = document.querySelector(selector);
      // The footnote is the box that draws the download icon; on the other
      // steps the same place holds a form, which is not read.
      const node = found?.querySelector('svg[class*="lucide-download"]') ? found : null;
      if (node === watched) return;
      if (watched !== null) resize.unobserve(watched);
      watched = node;
      if (node !== null) resize.observe(node);
    }).observe(document, { childList: true, subtree: true });
  }, INSTALL_NOTE_SELECTOR);
}

/**
 * Every height the footnote has had so far.
 *
 * @param page - a page with the recorder installed.
 * @returns the heights, in the order they were laid out.
 */
async function readInstallNoteHeights(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__installNoteHeights')?.value;
    return Array.isArray(recorded) ? recorded.map(Number) : [];
  });
}

/**
 * Fires the event Chrome fires when it decides the app can be installed,
 * with the two members the capture reads. The tier blocks the service worker,
 * so the real one never comes; this is the moment a desktop Chrome can pick,
 * and it can pick it while the first-food step is already on screen.
 *
 * @param page - a page on the app.
 */
async function fireInstallPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    });
    window.dispatchEvent(event);
  });
}

/**
 * The bottom edge of the step's card, page-relative: the one box that grows
 * when anything inside it does, even the last line.
 *
 * @param page - a page on an onboarding step.
 * @returns the bottom in CSS px.
 */
async function readCardBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const card = document.querySelector('main [data-slot="card"]');
    if (card === null) throw new Error('the step has no card');
    return Math.round((card.getBoundingClientRect().bottom + window.scrollY) * 10) / 10;
  });
}

test('CONTROL: the reading reports a line that appears above the step actions', async ({ page }) => {
  // Without this, every "moves nothing" below could pass against a reader
  // that sees nothing. A 24 px line is put in front of the actions the way a
  // late hint would arrive, and both readings must name it.
  await openFirstStep(page);
  const reading = await watch(page, 'inserting a 24 px line', () =>
    page.evaluate((continueLabel) => {
      const button = Array.from(document.querySelectorAll('main button')).find(
        (candidate) => candidate.textContent?.trim() === continueLabel,
      );
      const actions = button?.parentElement;
      if (actions === undefined || actions === null) throw new Error('no step actions');
      const line = document.createElement('div');
      line.style.height = '24px';
      actions.before(line);
    }, EN.onboarding.actions.continue),
  );
  expect(reading.moves.length, 'CONTROL: the Continue button must be reported as moved').toBeGreaterThan(0);
  expect(reading.score, 'CONTROL: the browser must record a layout shift').toBeGreaterThan(0);
});

for (const screen of MEASURED_SCREENS) {
  test.describe(screen.name, () => {
    test.use(screen.options);

    test('picking every style and every main goal on the first step moves nothing', async ({ page }) => {
      test.setTimeout(60_000);
      await openFirstStep(page);
      // Before any pick nothing is submitted but the question itself: no
      // style, no main goal, no hidden follow-up.
      expect(await submittedFields(page, STYLE_STEP_FIELDS)).toEqual([]);

      for (const style of STYLE_CYCLE) {
        expectNoShift(await clickAndWatch(page, styleCard(page, style), `picking ${style}`), `style ${style}`);
        const keys = (await submittedFields(page, STYLE_STEP_FIELDS)).map((line) => line.slice(0, line.indexOf('=')));
        expect(keys, `what the step submits on ${style}`).toEqual(styleStepKeys(style));
      }
      // The follow-up the last pick asked for is really on screen: the
      // reservation hides the others, never the one in force.
      await expect(page.locator('#kcalTarget')).toBeVisible();
      await expect(page.locator('label:has(input[name="carbPreset"][value="keto"])')).toBeVisible();

      for (const goal of ['calories', 'protein', 'net-carbs', 'calories']) {
        expectNoShift(await clickAndWatch(page, mainGoalChip(page, goal), `picking ${goal}`), `main goal ${goal}`);
        expect(await submittedFields(page, ['mainGoal'])).toEqual([`mainGoal=${goal}`]);
      }
    });

    test('a typed calorie target follows the person from one calorie style to the other', async ({ page }) => {
      // Each follow-up layer draws its own copy of the field, so the typed
      // text must live above them: typed under "low-carb and calories", it is
      // still there after a switch to "calories", as it was when one field
      // stayed mounted across the two.
      await openFirstStep(page);
      await styleCard(page, 'low-carb-low-kcal').click();
      const kcal = page.locator('#kcalTarget');
      await kcal.fill('1750');
      await styleCard(page, 'low-kcal').click();
      await expect(kcal, 'the calorie field after switching to "calories"').toHaveValue('1750');
      expect(await submittedFields(page, ['kcalTarget'])).toEqual(['kcalTarget=1750']);
      // CONTROL that the field is a new one to type into, not a stale read:
      // an edit here is what the other style then shows.
      await kcal.fill('1600');
      await styleCard(page, 'low-carb-low-kcal').click();
      await expect(kcal, 'the calorie field after switching back').toHaveValue('1600');
    });

    test('a stored pregnancy re-entering the first step: cycling styles moves nothing', async ({ page }) => {
      test.setTimeout(60_000);
      await reachBodyStep(page);
      await page.locator('label:has(input[name="biologicalSex"][value="female"])').click();
      await page.locator('label:has(input[name="reproductiveStatus"][value="pregnant"])').click();
      await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
      await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();

      // Back to the first step with a status on file: the one case the
      // caution note is written for.
      await page.goto('/onboarding?step=focus');
      await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
      const cautionLink = page.getByRole('link', { name: EN.onboarding.style.sourceLabel });

      for (const style of STYLE_CYCLE) {
        expectNoShift(await clickAndWatch(page, styleCard(page, style), `picking ${style}`), `style ${style}`);
        const isCautioned = style === 'low-carb' || style === 'low-carb-low-kcal' || style === 'low-kcal';
        // CONTROL that the note really is part of what swaps: shown for the
        // three restricting styles, gone for the other two.
        if (isCautioned) await expect(cautionLink, `the caution note on ${style}`).toBeVisible();
        else await expect(cautionLink, `no caution note on ${style}`).toBeHidden();
      }
    });

    test('picking a sex and a life phase on the body step moves nothing', async ({ page }) => {
      test.setTimeout(60_000);
      await reachBodyStep(page);
      const sexChip = (value: string): Locator =>
        page.locator(`label:has(input[name="biologicalSex"][value="${value}"])`);
      const statusChip = (value: string): Locator =>
        page.locator(`label:has(input[name="reproductiveStatus"][value="${value}"])`);

      // What each sex answer submits about a life phase: nothing for "male",
      // whose question is not asked, and the untouched "none" for everyone else.
      const sexCycle: readonly { value: string; submits: string[] }[] = [
        { value: 'female', submits: ['reproductiveStatus=none'] },
        { value: 'male', submits: [] },
        { value: '', submits: ['reproductiveStatus=none'] },
        { value: 'male', submits: [] },
        { value: '', submits: ['reproductiveStatus=none'] },
      ];
      for (const { value, submits } of sexCycle) {
        expectNoShift(await clickAndWatch(page, sexChip(value), `picking sex "${value}"`), `sex chip "${value}"`);
        expect(await submittedFields(page, LIFE_PHASE_FIELDS), `what sex "${value}" submits`).toEqual(submits);
      }

      const statusCycle: readonly { value: string; submits: string[]; shows: string | null }[] = [
        { value: 'none', submits: ['reproductiveStatus=none'], shows: null },
        {
          value: 'pregnant',
          submits: ['pregnancyDueDate=', 'reproductiveStatus=pregnant'],
          shows: '#pregnancyDueDate',
        },
        {
          value: 'lactating',
          submits: ['lactationStartDate=', 'reproductiveStatus=lactating'],
          shows: '#lactationStartDate',
        },
        { value: 'none', submits: ['reproductiveStatus=none'], shows: null },
      ];
      for (const { value, submits, shows } of statusCycle) {
        expectNoShift(await clickAndWatch(page, statusChip(value), `picking status ${value}`), `status chip ${value}`);
        expect(await submittedFields(page, LIFE_PHASE_FIELDS), `what status ${value} submits`).toEqual(submits);
        // CONTROL that the date a status asks for is really on screen.
        if (shows !== null) await expect(page.locator(shows)).toBeVisible();
        else await expect(page.locator('#pregnancyDueDate')).toBeHidden();
      }
    });

    test('the install offer on the last step arriving late moves nothing', async ({ page }) => {
      await recordInstallNoteHeights(page);
      await reachFirstFoodStep(page);
      await settleAnimations(page);
      const cardBottom = await readCardBottom(page);

      // A desktop Chrome decides the app is installable while the step is on
      // screen: the plain sentence becomes the offer with its button.
      const reading = await watch(page, 'the install prompt arriving', () => fireInstallPrompt(page));
      await expect(page.locator('main button:has(svg[class*="lucide-download"])')).toBeVisible();
      expectNoShift(reading, 'install prompt');
      expect(await readCardBottom(page), 'the card grew when the install offer arrived').toBe(cardBottom);
      const heights = await readInstallNoteHeights(page);
      expect(heights.length, 'the recorder must have seen the footnote').toBeGreaterThan(0);
      expect(new Set(heights).size, `the footnote was laid out at ${heights.join(', ')} px`).toBe(1);

      // CONTROL that the recorder sees a change of height at all.
      await page.evaluate((selector) => {
        const line = document.createElement('div');
        line.style.height = '30px';
        document.querySelector(selector)?.append(line);
      }, INSTALL_NOTE_SELECTOR);
      await settleFrames(page);
      expect(
        new Set(await readInstallNoteHeights(page)).size,
        'CONTROL: a grown footnote must be recorded',
      ).toBeGreaterThan(1);
    });

    test.describe('on an iPhone', () => {
      test.use({ userAgent: IPHONE_USER_AGENT });

      test('the install footnote keeps one height from its first paint through every answer', async ({ page }) => {
        await recordInstallNoteHeights(page);
        await reachFirstFoodStep(page);
        await settleAnimations(page);
        // The first paint knows nothing of the device; an effect then finds
        // an iPhone and swaps in the Safari instructions.
        await expect(page.locator('main svg[class*="lucide-share"]')).toBeVisible();
        const cardBottom = await readCardBottom(page);
        expectNoShift(
          await watch(page, 'the install prompt arriving', () => fireInstallPrompt(page)),
          'install prompt',
        );
        await expect(page.locator('main button:has(svg[class*="lucide-download"])')).toBeVisible();
        expect(await readCardBottom(page), 'the card grew when the install offer arrived').toBe(cardBottom);
        const heights = await readInstallNoteHeights(page);
        expect(heights.length, 'the recorder must have seen the footnote').toBeGreaterThan(0);
        expect(new Set(heights).size, `the footnote was laid out at ${heights.join(', ')} px`).toBe(1);
      });
    });
  });
}
