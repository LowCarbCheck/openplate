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
 * WHAT IS ALLOWED TO MOVE CONTENT: an expansion the person asked for, a picked
 * style revealing its own questions, a picked "Pregnant" revealing its dates.
 * Those are done BEFORE the baseline is taken, and everything after the
 * baseline is typing, picking one of several equal answers, or focus.
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
 * Clicks one control and reads what moved, for a pick among equal answers.
 *
 * @param page - the page under test.
 * @param target - what to click.
 * @param label - how the failure message names the click.
 * @returns every move and the score.
 */
async function clickAndWatch(page: Page, target: Locator, label: string): Promise<EditReading> {
  await settleAnimations(page);
  const baseline = await readTops(page);
  const entriesBefore = (await readShiftEntries(page)).length;
  await target.click();
  await settleFrames(page);
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
  // The deliberate expansion: a carb style reveals its own question.
  await page.locator('input[name="eatingStyle"][value="low-carb"]').check();
  await expect(carbChip(page, 'keto')).toBeVisible();

  // THE CONTROL that the reading can see a move at all: a pick that reveals
  // content (another style, with the kcal field) must be reported. Without it
  // the claims below could pass against a reader that sees nothing.
  const reveal = await clickAndWatch(
    page,
    page.locator('label:has(input[name="eatingStyle"][value="low-carb-low-kcal"])'),
    'picking a style that asks for calories',
  );
  expect(reveal.moves.length, 'CONTROL: revealing the calorie field must move the Continue button').toBeGreaterThan(0);

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

  // The deliberate expansion: "Pregnant" reveals its two date questions.
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
