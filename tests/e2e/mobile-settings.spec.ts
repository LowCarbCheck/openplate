/**
 * Every settings page this worker owns, on a 360px phone, in English, German
 * and Turkish: nothing tappable is smaller than a fingertip, and no field sits
 * against its own label.
 *
 * WHY GEOMETRY. A control's `className` says what it was asked to be; only a
 * bounding box says what it became. `h-11` on a button inside a flex row that
 * shrinks it is still 32px on screen, and a label that renders `display:inline`
 * ignores the vertical margin the block around it was given, which is exactly
 * how nine fields on three pages ended up 3px from their own label.
 *
 * WHAT IS MEASURED AND WHAT IS NOT. The walk reads the settings chrome
 * (`data-slot="settings-inset"`, the one container every settings surface
 * draws itself in), never the app shell: the header buttons, the Back bar and
 * the bottom nav are the shell's own, and they are measured by the specs that
 * own it. Inside the chrome, four kinds of control are deliberately skipped,
 * each for a reason a reader can check:
 *
 * - A control measuring a pixel or less is visually hidden on purpose (a
 *   `sr-only` radio, a file input behind a button). Its LABEL is the target,
 *   and the label is measured instead.
 * - A radio or checkbox is a 16px mark inside a label card that is the real
 *   target, so the card is measured instead.
 * - A switch is a 32px track at the end of a row, and the row is the target,
 *   so the row is measured instead.
 * - A link rendered `display:inline` is a word inside a sentence. Growing it
 *   would push it out of its own line box and over the text above it; this is
 *   the inline exception WCAG 2.5.8 names, and it is the one thing on these
 *   pages left under 44px on purpose.
 *
 * WHAT WAS MEASURED BEFORE THE FIX (audit, /tmp/op-mobile-shots/settings):
 * the weigh-in delete buttons were 32x32 and the kg/lb toggle 32 tall; the AI
 * page's three disclosure triggers were 20px and its key field and Save button
 * 36px; the fasting page's "Usual start time" label sat ON the same line as
 * its input, 31px of overlap; nine other fields sat 3px from their label.
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding, useLanguage } from './helpers';

/** The narrow end of the phone budget this app is written against. */
const NARROW_PHONE_WIDTH = 360;

/** A generous height, so width is the only thing under test. */
const PHONE_HEIGHT = 844;

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/** The smallest acceptable distance between a field's label and the field itself. */
const MIN_LABEL_GAP_PX = 6;

/** A box this small is visually hidden, and its label is the target instead. */
const HIDDEN_CONTROL_PX = 1;

/** The languages this walk renders in: the source, the longest, and the one the audit broke in. */
const LOCALES = ['en', 'de', 'tr'] as const;

/**
 * The settings pages this worker owns.
 *
 * `/settings/about` is not here: it is another worker's file in the same pass.
 * `/settings/account` and its siblings 404 without a sync server, which this
 * tier does not run.
 */
const PAGES = [
  '/settings',
  '/settings/ai',
  '/settings/profile',
  '/settings/nutrition',
  '/settings/fasting',
  '/settings/preferences',
  '/settings/data',
  '/settings/life-phase',
  '/settings/notifications',
] as const;

/** The settings chrome, and the controls inside it that are their own target. */
const INSET = '[data-slot="settings-inset"]';
const TARGETS = `${INSET} :is(a, button:not([role="switch"]), input:not([type="hidden"]), [role="combobox"])`;

/** One control that is smaller than a fingertip, named by whatever a reader would call it. */
interface TargetReading {
  page: string;
  what: string;
  width: number;
  height: number;
}

/**
 * Every control in the settings chrome that is under the touch floor and is
 * not one of the four documented exceptions.
 *
 * @param page - the page to measure.
 * @param path - the URL being walked, so a failure names it.
 * @returns the offenders, empty when every measured control is big enough.
 */
async function smallTargets(page: Page, path: string): Promise<TargetReading[]> {
  return page.locator(TARGETS).evaluateAll(
    (elements, { floor, hidden, where }) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          if (box.width <= hidden || box.height <= hidden) return false;
          const type = element.getAttribute('type');
          if (type === 'radio' || type === 'checkbox') return false;
          return !(element.tagName === 'A' && getComputedStyle(element).display === 'inline');
        })
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            page: where,
            what: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        })
        .filter((reading) => reading.height + 0.5 < floor || reading.width + 0.5 < floor),
    { floor: TOUCH_TARGET_PX, hidden: HIDDEN_CONTROL_PX, where: path },
  );
}

/**
 * Every row that carries a switch, or every label card that carries a radio,
 * and is itself under the touch floor. These are the two controls whose own
 * box is small by design, so the thing a finger lands on is measured instead.
 *
 * @param page - the page to measure.
 * @param path - the URL being walked, so a failure names it.
 * @returns the offenders, empty when every such row is big enough.
 */
async function smallSurroundings(page: Page, path: string): Promise<TargetReading[]> {
  return page.locator(`${INSET} :is([role="switch"], input[type="radio"], input[type="checkbox"])`).evaluateAll(
    (elements, { floor, where }) =>
      elements
        .map((element) => {
          const surround = element.closest('label') ?? element.parentElement;
          const box = (surround ?? element).getBoundingClientRect();
          return {
            page: where,
            what: (surround?.textContent ?? element.getAttribute('aria-label') ?? '').trim().slice(0, 40),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        })
        // A box of nothing is a panel that is folded shut (`forceMount` keeps
        // the advanced provider radios in the DOM while they are closed), and
        // a target nobody can see is not a target.
        .filter((reading) => reading.height > 0 && reading.height + 0.5 < floor),
    { floor: TOUCH_TARGET_PX, where: path },
  );
}

/** One field whose label is too close to it, with the distance measured between them. */
interface GapReading {
  page: string;
  what: string;
  gap: number;
}

/**
 * Every labelled field whose label sits above it with less than a readable gap
 * between the two.
 *
 * ABOVE IT, because a label BESIDE its control is the switch-row pattern, where
 * the two share a line on purpose. A field whose left edge starts past the
 * label's right edge is that case, whatever the label's height: the German
 * "Serien und Auszeichnungen ausblenden" wraps to two lines and its switch
 * then sits lower than the top of its own label. Everything else is a stacked
 * field, and a stacked field whose label all but touches it is the defect.
 *
 * @param page - the page to measure.
 * @param path - the URL being walked, so a failure names it.
 * @returns the offenders, empty when every stacked field has room.
 */
async function crowdedLabels(page: Page, path: string): Promise<GapReading[]> {
  return page.locator(`${INSET} label[for]`).evaluateAll(
    (labels, { floor, where }) =>
      labels
        .map((label) => {
          const id = label.getAttribute('for') ?? '';
          const field = id === '' ? null : document.getElementById(id);
          if (field === null) return null;
          const labelBox = label.getBoundingClientRect();
          const fieldBox = field.getBoundingClientRect();
          if (fieldBox.left >= labelBox.right - 1) return null;
          return {
            page: where,
            what: (label.textContent ?? '').trim().slice(0, 40),
            gap: Math.round(fieldBox.top - labelBox.bottom),
          };
        })
        .filter((reading) => reading !== null)
        .filter((reading) => reading.gap < floor),
    { floor: MIN_LABEL_GAP_PX, where: path },
  );
}

/** How many controls the walk actually measured on this page, the non-vacuity read. */
async function measuredCount(page: Page): Promise<number> {
  return page.locator(TARGETS).count();
}

/**
 * Logs one weigh-in through the real form, so `/settings/profile` draws its
 * recent weigh-in list. Without one the list is a sentence, and the row of
 * delete buttons the audit measured at 32x32 is not on screen to measure.
 *
 * @param page - a page on a device past onboarding.
 */
async function logOneWeighIn(page: Page): Promise<void> {
  await page.goto('/settings/profile');
  const form = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="log-weight"]') });
  await form.locator('input[inputmode="decimal"]').fill('82.5');
  await form.getByRole('button').last().click();

  // THE RELOAD IS THE POINT. The row appearing says the store accepted the
  // weigh-in; only a fresh document says it reached disk, and a walk that
  // navigated away first would race the persister (7 to 16ms after render).
  const deleteButtons = page.locator(`${INSET} li button`);
  await expect(deleteButtons.first(), 'the weigh-in must be listed').toBeVisible();
  await page.reload();
  await expect(deleteButtons.first(), 'the weigh-in must survive a reload').toBeVisible();
}

test('no settings control is smaller than a fingertip at 360px, in en, de and tr', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });
  await logOneWeighIn(page);

  let measured = 0;
  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    for (const path of PAGES) {
      await page.goto(path);

      ////////////////////////////////////////////////////////////////////////
      // THE CONTROL AGAINST A VACUOUS PASS: this page drew its settings
      // chrome. Without it, a page that failed to render would offer nothing
      // to measure and pass every assertion below.
      ////////////////////////////////////////////////////////////////////////
      await expect(page.locator(INSET).first(), `${locale} ${path}: must draw its settings chrome`).toBeVisible();
      measured += await measuredCount(page);

      expect(await smallTargets(page, path), `${locale}: a control is under ${TOUCH_TARGET_PX}px`).toEqual([]);
      expect(
        await smallSurroundings(page, path),
        `${locale}: a switch row or radio card is under ${TOUCH_TARGET_PX}px`,
      ).toEqual([]);
    }
  }

  expect(measured, 'the walk must have measured a real number of controls').toBeGreaterThan(50);
});

test('every settings field keeps its distance from its own label at 360px, in en, de and tr', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });

  let measured = 0;
  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator(INSET).first(), `${locale} ${path}: must draw its settings chrome`).toBeVisible();
      measured += await page.locator(`${INSET} label[for]`).count();

      expect(
        await crowdedLabels(page, path),
        `${locale}: a field is under ${MIN_LABEL_GAP_PX}px from its label`,
      ).toEqual([]);
    }
  }

  expect(measured, 'the walk must have measured a real number of labelled fields').toBeGreaterThan(20);
});
