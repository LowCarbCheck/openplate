/**
 * A button that wraps its label is as tall as its label, from `md` up too (operator
 * report, third time, 2026-10-02).
 *
 * THE REPORT. On a desktop window the three cards on the last onboarding step ("Photograph
 * it", "Write it", "Say it") were about 36 px tall, and the title and the description of one
 * card ran out of its box and over the next card.
 *
 * THE CAUSE. The card is a `SubmitButton`, so a `Button`, and passes `h-auto`. The `default`
 * size of `Button` is `h-11 md:h-9`. `tailwind-merge` keeps one class per variant, and `h-auto`
 * (no variant) and `md:h-9` (the `md` variant) are two different slots, so `h-auto` replaced
 * `h-11` and `md:h-9` stayed. From 768 px up the cap won. `md:h-auto` is the other half; the
 * moved-instance page already wrote it.
 *
 * THE SAME TRAP, AS FOUND BY A SWEEP of every `<Button>` that carries a height class in
 * `app/`: the three large calls to action on the open landing (`h-auto min-h-12`). Their
 * `size="lg"` is `h-12 md:h-10`, so the `md:h-10` was hidden by `min-h-12` for a one-line label,
 * and only a label that wraps shows it. No real label wraps at a desktop width, so that case
 * narrows the button the way a longer label would, with the real class list and the real text.
 *
 * THREE READINGS PER BUTTON, all of them geometry, none of them a screenshot:
 *
 *  1. `scrollHeight <= clientHeight`: nothing inside the box is taller than the box.
 *  2. The union of everything inside it (a `Range` over its contents) lies inside the box.
 *  3. Its content does not reach into a sibling's box: the overlap the operator saw.
 *
 * EVERY READING IS SHOWN ABLE TO FAIL. The control forces the cards back to the 36 px the
 * report named, with an inline style, and the same reader must report all three failures.
 *
 * @area onboarding
 */
import { expect, test, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { EN } from './copy';
import { useLanguage } from './helpers';

/** The phone the tier is written for, and the desktop window the owner saw the report in. */
const SCREENS = [
  { name: 'phone 390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, scale: 2 },
  { name: 'desktop 1280x800', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, scale: 1 },
] as const;

/** What the desktop card measured in the report. Anything taller than this holds its two lines. */
const REPORTED_CARD_HEIGHT_PX = 36;

/** Sub-pixel rounding, not a spill. */
const EPSILON_PX = 0.5;

/** The width a long German or French label is squeezed into, so it takes three lines. */
const SQUEEZED_WIDTH_PX = 150;

/** The tallest one line of a landing label is, at its largest size. */
const MAX_ONE_LINE_PX = 30;

/** The locale whose landing labels are among the longest, with the desktop width they still fit in. */
const LONG_LABEL_LANGUAGE: LanguageCode = 'de';

/** What one button measures. */
interface ButtonReading {
  label: string;
  height: number;
  /** How tall everything inside the box is, in px: one line of the labels read here is under 25. */
  contentHeight: number;
  clientHeight: number;
  scrollHeight: number;
  /** How far the contents reach below the box, in px (0 when they stay inside). */
  spillBelow: number;
  /** How far the contents reach above the box, in px (0 when they stay inside). */
  spillAbove: number;
  /** The labels of the sibling buttons whose box this button's contents run into. */
  overlaps: string[];
}

/**
 * Walks a fresh device from `/welcome` to the last onboarding step.
 *
 * @param page - a page on a device that has never been used.
 */
async function reachFirstFoodStep(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();
  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
}

/**
 * Reads every button the selector names, each against its siblings in the same list.
 *
 * @param page - the page to read.
 * @param selector - a CSS selector for the buttons.
 * @returns one reading per button, in document order.
 */
async function readButtons(page: Page, selector: string): Promise<ButtonReading[]> {
  // Serialised into the page: its helpers cannot move out of it.
  // oxlint-disable unicorn/consistent-function-scoping
  const readings = await page.evaluate((query) => {
    const buttons = [...document.querySelectorAll(query)];
    const contentOf = (button: Element): DOMRect => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getBoundingClientRect();
    };
    const labelOf = (button: Element): string => (button.textContent ?? '').trim().slice(0, 40);
    return buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const content = contentOf(button);
      const overlaps = buttons
        .filter((other) => other !== button)
        .filter((other) => {
          const otherBox = other.getBoundingClientRect();
          const isAcross = content.left < otherBox.right - 0.5 && content.right > otherBox.left + 0.5;
          const isDown = content.top < otherBox.bottom - 0.5 && content.bottom > otherBox.top + 0.5;
          return isAcross && isDown;
        })
        .map(labelOf);
      return {
        label: labelOf(button),
        height: Math.round(box.height * 10) / 10,
        contentHeight: Math.round(content.height * 10) / 10,
        clientHeight: button.clientHeight,
        scrollHeight: button.scrollHeight,
        spillBelow: Math.max(0, Math.round((content.bottom - box.bottom) * 10) / 10),
        spillAbove: Math.max(0, Math.round((box.top - content.top) * 10) / 10),
        overlaps,
      };
    });
  }, selector);
  // oxlint-enable unicorn/consistent-function-scoping
  return readings;
}

/**
 * Names every way a reading says its button does not hold its text.
 *
 * @param readings - what `readButtons` returned.
 * @returns one line per failure, empty when every button holds its text.
 */
function failuresOf(readings: readonly ButtonReading[]): string[] {
  return readings.flatMap((reading) => {
    const found: string[] = [];
    if (reading.scrollHeight > reading.clientHeight) {
      found.push(`"${reading.label}": scrollHeight ${reading.scrollHeight} > clientHeight ${reading.clientHeight}`);
    }
    if (reading.spillBelow > EPSILON_PX || reading.spillAbove > EPSILON_PX) {
      found.push(`"${reading.label}": contents spill ${reading.spillAbove} px above, ${reading.spillBelow} px below`);
    }
    if (reading.overlaps.length > 0) {
      found.push(`"${reading.label}": contents run into ${reading.overlaps.map((name) => `"${name}"`).join(', ')}`);
    }
    return found;
  });
}

/**
 * Sets inline, `!important` declarations on every element a selector names. Through the CSSOM,
 * not a `<style>` tag, which a page's content security policy may refuse.
 *
 * @param page - the page to change.
 * @param selector - the elements to change.
 * @param declarations - property names and values.
 */
async function forceStyle(page: Page, selector: string, declarations: Record<string, string>): Promise<void> {
  await page.evaluate(
    ({ query, entries }) => {
      for (const element of document.querySelectorAll(query)) {
        if (!(element instanceof HTMLElement)) continue;
        for (const [property, value] of Object.entries(entries))
          element.style.setProperty(property, value, 'important');
      }
    },
    { query: selector, entries: declarations },
  );
}

/**
 * The three way-to-log cards: submit buttons that are direct children of the step's form. The
 * "later" link-button sits inside a wrapper `div`, so it is not one.
 */
const CARD_SELECTOR = 'main form > button[name="destination"]';

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test.use({
      viewport: screen.viewport,
      isMobile: screen.isMobile,
      hasTouch: screen.hasTouch,
      deviceScaleFactor: screen.scale,
    });

    test('the three first-food cards are as tall as their text and hold it', async ({ page }) => {
      await reachFirstFoodStep(page);
      await expect(page.locator(CARD_SELECTOR)).toHaveCount(3);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const readings = await readButtons(page, CARD_SELECTOR);
      expect(readings, 'the step draws three cards').toHaveLength(3);
      expect(failuresOf(readings), 'a card spills or runs into another').toEqual([]);
      for (const reading of readings) {
        expect(reading.height, `"${reading.label}" is taller than the 36 px of the report`).toBeGreaterThan(
          REPORTED_CARD_HEIGHT_PX,
        );
      }
    });

    test('CONTROL: cards forced to the reported 36 px fail every reading', async ({ page }) => {
      await reachFirstFoodStep(page);
      await expect(page.locator(CARD_SELECTOR)).toHaveCount(3);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await forceStyle(page, CARD_SELECTOR, { height: `${REPORTED_CARD_HEIGHT_PX}px` });

      const readings = await readButtons(page, CARD_SELECTOR);
      const failures = failuresOf(readings);
      expect(
        failures.filter((line) => line.includes('scrollHeight')).length,
        'CONTROL: the scrollHeight reading must fail',
      ).toBeGreaterThan(0);
      expect(
        failures.filter((line) => line.includes('contents spill')).length,
        'CONTROL: the spill reading must fail',
      ).toBeGreaterThan(0);
      expect(
        failures.filter((line) => line.includes('run into')).length,
        'CONTROL: the overlap reading must fail',
      ).toBeGreaterThan(0);
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
// The open landing's three wrapping calls to action
////////////////////////////////////////////////////////////////////////////////

/**
 * The landing's three calls to action: the hero's, the middle one and the close. They are the
 * ones that wrap (`whitespace-normal`); the other links to the same page are one-line labels.
 */
const CTA_SELECTOR = 'main a[data-slot="button"][href="/dashboard"].whitespace-normal';

/**
 * Opens the open landing in a language and waits for its fonts.
 *
 * @param page - a fresh page.
 * @param language - the language the document renders in.
 */
async function openLanding(page: Page, language: LanguageCode): Promise<void> {
  await useLanguage(page, language);
  await page.goto('/');
  await expect(page.locator(CTA_SELECTOR).first(), 'the landing draws its calls to action').toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * Squeezes every call to action into a narrow box, the way a longer label would, keeping its
 * real classes and its real text.
 *
 * @param page - the landing, loaded.
 */
async function squeezeCtas(page: Page): Promise<void> {
  await forceStyle(page, CTA_SELECTOR, { width: `${SQUEEZED_WIDTH_PX}px`, 'max-width': `${SQUEEZED_WIDTH_PX}px` });
}

for (const screen of SCREENS) {
  test.describe(`landing, ${screen.name}`, () => {
    test.use({
      viewport: screen.viewport,
      isMobile: screen.isMobile,
      hasTouch: screen.hasTouch,
      deviceScaleFactor: screen.scale,
    });

    test(`the calls to action hold a label that wraps, in ${LONG_LABEL_LANGUAGE}`, async ({ page }) => {
      expect(SUPPORTED_LANGUAGES, 'the long-label language is a shipped one').toContain(LONG_LABEL_LANGUAGE);
      await openLanding(page, LONG_LABEL_LANGUAGE);
      await squeezeCtas(page);

      const readings = await readButtons(page, CTA_SELECTOR);
      expect(readings.length, 'the landing draws the hero, the middle and the closing call').toBeGreaterThanOrEqual(3);
      for (const reading of readings) {
        // CONTROL that the label really wrapped, read off its text and not off its box, which is
        // the very thing under test: one line of these labels is 24 px or less.
        expect(reading.contentHeight, `"${reading.label}" took more than one line`).toBeGreaterThan(MAX_ONE_LINE_PX);
      }
      expect(failuresOf(readings), 'a call to action spills its own label').toEqual([]);
    });
  });
}

// ONE TEST PER LANGUAGE: six reloads in one test would spend the tier's 30 s per spec.
for (const language of SUPPORTED_LANGUAGES) {
  test(`the landing calls to action hold their label at the natural width, in ${language}`, async ({ page }) => {
    await openLanding(page, language);
    const readings = await readButtons(page, CTA_SELECTOR);
    expect(readings.length, 'the landing draws its calls to action').toBeGreaterThanOrEqual(3);
    expect(failuresOf(readings), `${language}: a call to action spills its own label`).toEqual([]);
  });
}

test('CONTROL: a call to action forced to a short height fails the reader', async ({ page }) => {
  await openLanding(page, LONG_LABEL_LANGUAGE);
  await squeezeCtas(page);
  await forceStyle(page, CTA_SELECTOR, { height: '40px', 'min-height': '0' });
  const failures = failuresOf(await readButtons(page, CTA_SELECTOR));
  expect(failures.length, 'CONTROL: a squeezed, 40 px call to action must be reported').toBeGreaterThan(0);
});
