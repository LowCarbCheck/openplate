/**
 * The shared primitives, measured on the phone they are drawn on (M242).
 *
 * WHY A SPEC ABOUT `app/components/ui/*`. A primitive has no screen of its
 * own, so every earlier check of it was a check of one caller: the button
 * scale was asserted nowhere and drifted to 32, 36 and 40 px, the sheet's
 * close X sat at 16 x 16 on every drawer in the app, and the shared `Label`
 * was an inline element, which silently turned the 8 px gap its `space-y-2`
 * wrapper promised into 3 px on every form. Each of those is one line in one
 * file and hundreds of screens, which is exactly the shape that needs a guard.
 *
 * EVERY NUMBER HERE IS READ, NEVER PHOTOGRAPHED. Headless Chromium hides
 * scrollbars and never applies `hover:`, so a clipped heading and a 16 px tap
 * target both look fine in a screenshot; `getBoundingClientRect`,
 * `scrollWidth` against `clientWidth` and `document.elementFromPoint` are what
 * see them.
 *
 * EVERY ASSERTION WAS SHOWN RED FIRST, against the tree before the fix:
 * default button 36 px, `sm` 32, `icon` 36, `lg` 40; the drawer's close X
 * 16 x 16; the switch 32 x 18.4 with a 1.38:1 unchecked track; the fasting
 * label ON THE SAME LINE as its field (a negative gap); the German
 * `/terms` h1 at scrollWidth 397 inside 328; calendar day cells 36 x 36 and
 * month buttons 28 x 28; the `/add` nutrition inputs and the meal select at
 * 36; the settings eyebrow at 11 px; the legal lead at 20 px; a card title at
 * `leading-none`.
 *
 * 360 PX, AND THREE LANGUAGES. 360 is the narrowest budget this app is written
 * against (`insights-layout.spec.ts` says the same), and a German or Turkish
 * label is the one that turns a tight row into a broken one, so the walks that
 * depend on a string run in all three.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { completeOnboarding, useLanguage } from './helpers';

/** The tap-target floor every phone control is measured against, in CSS px. */
const TAP_TARGET_PX = 44;

/** The narrow phone this spec measures on. */
const NARROW_PHONE = { width: 360, height: 800 };

/** The narrowest screen the app promises to fit, used for the overflow reads. */
const TINY_PHONE = { width: 320, height: 568 };

/** A CSS pixel of sub-pixel rounding either side still counts as a fit. */
const TOLERANCE_PX = 1;

/** The three languages whose strings change how a row lays out. */
const LOCALES = ['en', 'de', 'tr'] as const;

/** The largest type the legal lead paragraph may use on a phone, in px. */
const LEAD_MAX_PX = 18;

/** The smallest type any label in the app may use, in px (the brief's floor). */
const TEXT_FLOOR_PX = 12;

/** WCAG 1.4.11's floor for a non-text control boundary. */
const CONTROL_CONTRAST_FLOOR = 3;

/** How far above a switch's centre the walk taps, inside a 44 px box and outside an 18 px one. */
const HIT_PROBE_OFFSET_PX = 18;

/** Card titles must give a wrapped second line room: line box over font size. */
const TITLE_LEADING_FLOOR = 1.2;

/**
 * The catalog keys this spec reads that `copy.ts` does not name.
 *
 * Same rule as that module: no sentence is transcribed here, every one is read
 * out of the shipped bundle, so a wordsmith pass rephrasing "Jump to today"
 * moves this spec with it instead of breaking it.
 */
const extraCopySchema = z.object({
  diary: z.object({
    nav: z.object({ previousDay: z.string(), jumpToToday: z.string() }),
  }),
  ui: z.object({ sheet: z.object({ close: z.string() }) }),
  chrome: z.object({ logoMenuLabel: z.string() }),
  awards: z.object({ hide: z.string() }),
  settings: z.object({
    fasting: z.object({ startTime: z.object({ label: z.string() }) }),
  }),
});

/**
 * The extra strings of one language.
 *
 * @param locale - one of the shipped language codes.
 * @returns the parsed subset this spec needs.
 */
function extraCopyFor(locale: string): z.infer<typeof extraCopySchema> {
  return extraCopySchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${locale}/common.json`), 'utf8')),
  );
}

/** One element's drawn box, rounded to a tenth of a pixel so a message reads. */
interface Box {
  width: number;
  height: number;
}

/**
 * The box a control actually occupies.
 *
 * @param locator - the control.
 * @returns its width and height in CSS px.
 */
async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
  });
}

/**
 * Asserts a control is at least 44 px in both directions.
 *
 * @param box - the measured box.
 * @param what - what the failure message should call it.
 */
function expectTapTarget(box: Box, what: string): void {
  expect(box.height, `${what} is ${box.height} px tall, under the ${TAP_TARGET_PX} px floor`).toBeGreaterThanOrEqual(
    TAP_TARGET_PX - TOLERANCE_PX,
  );
  expect(box.width, `${what} is ${box.width} px wide, under the ${TAP_TARGET_PX} px floor`).toBeGreaterThanOrEqual(
    TAP_TARGET_PX - TOLERANCE_PX,
  );
}

/** A colour read off the page, already split into channels and an alpha. */
type Rgba = readonly [number, number, number, number];

/**
 * Reads a computed CSS colour into channels.
 *
 * Chromium serialises every colour these tokens produce as `rgb()` or
 * `rgba()`; anything else is a change worth failing on rather than guessing
 * about, so an unparseable string throws with what it was.
 *
 * @param css - the computed value.
 * @returns the four channels, alpha last.
 */
function parseColour(css: string): Rgba {
  const numbers = css.match(/-?\d+(?:\.\d+)?/gu);
  if (numbers === null || numbers.length < 3) throw new Error(`unreadable colour: ${css}`);
  const [red, green, blue, alpha] = numbers.map(Number);
  return [red ?? 0, green ?? 0, blue ?? 0, numbers.length > 3 ? (alpha ?? 1) : 1];
}

/**
 * Paints a possibly translucent colour onto an opaque one.
 *
 * @param front - the colour on top.
 * @param back - the opaque colour behind it.
 * @returns the resulting opaque colour.
 */
function composite(front: Rgba, back: Rgba): Rgba {
  const mix = (a: number, b: number): number => front[3] * a + (1 - front[3]) * b;
  return [mix(front[0], back[0]), mix(front[1], back[1]), mix(front[2], back[2]), 1];
}

/**
 * One channel of a colour, linearised the way WCAG defines it.
 *
 * @param value - the channel, 0 to 255.
 * @returns the linear value, 0 to 1.
 */
function linearise(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance.
 *
 * @param colour - an opaque colour.
 * @returns its relative luminance.
 */
function luminance(colour: Rgba): number {
  return 0.2126 * linearise(colour[0]) + 0.7152 * linearise(colour[1]) + 0.0722 * linearise(colour[2]);
}

/**
 * The WCAG contrast ratio between a colour and the surface behind it.
 *
 * @param front - the colour to judge, translucency allowed.
 * @param surface - the opaque colour behind it.
 * @returns the ratio, 1 for an invisible colour.
 */
function contrastRatio(front: Rgba, surface: Rgba): number {
  const painted = luminance(composite(front, surface));
  const behind = luminance(surface);
  const lighter = Math.max(painted, behind);
  const darker = Math.min(painted, behind);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

////////////////////////////////////////////////////////////////////////////////
// The button scale (FRONT-07)
////////////////////////////////////////////////////////////////////////////////

for (const locale of LOCALES) {
  test(`every button size on the diary is a ${TAP_TARGET_PX} px target in ${locale}`, async ({ page }) => {
    const copy = extraCopyFor(locale);
    await page.setViewportSize(NARROW_PHONE);
    await completeOnboarding(page);
    await useLanguage(page, locale);

    // A PAST DAY, because that is the only state that draws all three sizes at
    // once: the two date arrows (`icon`), the date itself (`default`) and the
    // "jump to today" escape (`sm`).
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/diary?date=${yesterday}`);

    const previousDay = page.getByRole('link', { name: copy.diary.nav.previousDay });
    expectTapTarget(await boxOf(previousDay), `the icon button "${copy.diary.nav.previousDay}"`);

    // Found through the arrow it sits beside rather than by its own label,
    // which interpolates the day and would pin a formatted date.
    const dateTrigger = previousDay.locator('xpath=..').locator('button[aria-haspopup="dialog"]');
    const trigger = await boxOf(dateTrigger);
    expect(await dateTrigger.getAttribute('data-size'), 'the date button is the default size').toBe('default');
    expectTapTarget({ width: TAP_TARGET_PX, height: trigger.height }, 'the default-size date button');

    // The one outside the popover: the popover's copy of it is a `button`.
    const jumpToToday = page.getByRole('link', { name: copy.diary.nav.jumpToToday });
    expect(await jumpToToday.getAttribute('data-size'), 'the escape is the small size').toBe('sm');
    const escape = await boxOf(jumpToToday);
    expectTapTarget({ width: TAP_TARGET_PX, height: escape.height }, 'the small-size jump-to-today button');
  });
}

test(`the landing's large buttons are ${TAP_TARGET_PX} px targets`, async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE);
  // NO ONBOARDING: a device that has never been used is what sees the landing.
  await page.goto('/');

  const large = page.locator('[data-slot="button"][data-size="lg"]');
  const count = await large.count();
  // NON-VACUITY: a landing that drew no large button would pass a bare loop.
  expect(count, 'the landing must draw at least one large button').toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const button = large.nth(index);
    if (!(await button.isVisible())) continue;
    expectTapTarget({ width: TAP_TARGET_PX, height: (await boxOf(button)).height }, `large button ${index}`);
  }
});

////////////////////////////////////////////////////////////////////////////////
// The sheet's close X (FRONT-06, HEALTH-12)
////////////////////////////////////////////////////////////////////////////////

for (const locale of ['en', 'de'] as const) {
  test(`the menu drawer closes with a ${TAP_TARGET_PX} px target in ${locale}`, async ({ page }) => {
    const copy = extraCopyFor(locale);
    await page.setViewportSize(NARROW_PHONE);
    await completeOnboarding(page);
    await useLanguage(page, locale);
    await page.goto('/diary');

    await page.getByRole('button', { name: copy.chrome.logoMenuLabel }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    const close = drawer.getByRole('button', { name: copy.ui.sheet.close });
    expectTapTarget(await boxOf(close), 'the drawer close button');
  });
}

////////////////////////////////////////////////////////////////////////////////
// The switch (SET-05) and the eyebrow (FRONT-16, SET-15)
////////////////////////////////////////////////////////////////////////////////

for (const locale of ['en', 'de'] as const) {
  test(`the preferences switch has a ${TAP_TARGET_PX} px hit area and a visible track in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize(NARROW_PHONE);
    await completeOnboarding(page);
    await useLanguage(page, locale);
    await page.goto('/settings/preferences');

    const toggle = page.locator('[data-slot="switch"]#awards-hidden');
    await expect(toggle).toBeVisible();
    await expect(toggle, 'the walk measures the UNCHECKED track').toHaveAttribute('data-state', 'unchecked');

    // THE VISUAL SIZE IS NOT THE TARGET. The control stays small on purpose;
    // what has to be 44 px is what a thumb can hit, so this is read as a hit
    // test at a point the old 18 px control did not answer at, not as a box.
    const probe = await toggle.evaluate((element, offset) => {
      const rect = element.getBoundingClientRect();
      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;
      const above = document.elementFromPoint(centreX, centreY - offset);
      const below = document.elementFromPoint(centreX, centreY + offset);
      return {
        aboveHits: element.contains(above),
        belowHits: element.contains(below),
        visualHeight: Math.round(rect.height * 10) / 10,
      };
    }, HIT_PROBE_OFFSET_PX);
    expect(probe.aboveHits, `a tap ${HIT_PROBE_OFFSET_PX} px above the switch must reach it`).toBe(true);
    expect(probe.belowHits, `a tap ${HIT_PROBE_OFFSET_PX} px below the switch must reach it`).toBe(true);
    // The whole point of the pseudo-element: the drawn control did NOT grow.
    expect(probe.visualHeight, 'the drawn switch stays small').toBeLessThan(TAP_TARGET_PX);

    const colours = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      let surface = 'rgb(255, 255, 255)';
      let ancestor = element.parentElement;
      while (ancestor !== null) {
        const painted = getComputedStyle(ancestor).backgroundColor;
        if (painted !== 'rgba(0, 0, 0, 0)' && painted !== 'transparent') {
          surface = painted;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      return { track: style.backgroundColor, border: style.borderTopColor, surface };
    });

    const surface = parseColour(colours.surface);
    const best = Math.max(
      contrastRatio(parseColour(colours.track), surface),
      contrastRatio(parseColour(colours.border), surface),
    );
    expect(
      best,
      `the unchecked track (${colours.track}) and its border (${colours.border}) both vanish into ${colours.surface}`,
    ).toBeGreaterThanOrEqual(CONTROL_CONTRAST_FLOOR);
  });
}

test(`no settings eyebrow is drawn under ${TEXT_FLOOR_PX} px`, async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE);
  await completeOnboarding(page);
  await page.goto('/settings');

  const eyebrows = page.locator('section > h2');
  await expect(eyebrows.first()).toBeVisible();
  const sizes = await eyebrows.evaluateAll((elements) =>
    elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  );
  expect(sizes.length, 'the hub must label its groups').toBeGreaterThan(1);
  expect(Math.min(...sizes), 'the smallest eyebrow on the hub').toBeGreaterThanOrEqual(TEXT_FLOOR_PX);
});

////////////////////////////////////////////////////////////////////////////////
// The label's own line (SET-02)
////////////////////////////////////////////////////////////////////////////////

/** The smallest gap between a label and the field it names, in px. */
const LABEL_GAP_FLOOR_PX = 6;

for (const locale of LOCALES) {
  test(`the fasting start-time label sits above its field in ${locale}`, async ({ page }) => {
    const copy = extraCopyFor(locale);
    await page.setViewportSize(NARROW_PHONE);
    await completeOnboarding(page);
    await useLanguage(page, locale);
    await page.goto('/settings/fasting');

    const field = page.locator('input[name="routineStartMinute"]');
    await expect(field).toBeVisible();

    const measured = await field.evaluate((input) => {
      const label = input.id === '' ? null : document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label === null) return null;
      return {
        gap: Math.round((input.getBoundingClientRect().top - label.getBoundingClientRect().bottom) * 10) / 10,
        display: getComputedStyle(label).display,
      };
    });

    expect(measured, `the "${copy.settings.fasting.startTime.label}" field must have a label`).not.toBeNull();
    expect(
      measured?.gap ?? -1,
      `the label and its field are ${measured?.gap ?? -1} px apart (display ${measured?.display ?? 'unknown'})`,
    ).toBeGreaterThanOrEqual(LABEL_GAP_FLOOR_PX);
  });
}

////////////////////////////////////////////////////////////////////////////////
// The legal type scale (SET-01, SET-12)
////////////////////////////////////////////////////////////////////////////////

for (const locale of LOCALES) {
  test(`no heading on /terms spills out of its box in ${locale}`, async ({ page }) => {
    await page.setViewportSize(NARROW_PHONE);
    await useLanguage(page, locale);
    await page.goto('/terms');
    await expect(page.locator('h1').first()).toBeVisible();

    const spilling = await page.evaluate(() =>
      [...document.querySelectorAll('h1, h2, h3')]
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({
          text: (element.textContent ?? '').slice(0, 40),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        })),
    );
    expect(spilling, 'a heading needs more room than its column gives it').toEqual([]);

    const tooWide = await page.evaluate(
      (budget) =>
        [...document.body.querySelectorAll('*')]
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > budget.width + budget.tolerance && rect.height > 0)
          .map(({ element, rect }) => `${element.tagName.toLowerCase()} ${Math.round(rect.width)}px`),
      { width: NARROW_PHONE.width, tolerance: TOLERANCE_PX },
    );
    expect(tooWide, 'nothing on a legal page may be wider than the phone').toEqual([]);
  });
}

test(`the legal lead paragraph is at most ${LEAD_MAX_PX} px on a phone`, async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE);
  await page.goto('/terms');
  await expect(page.locator('h1').first()).toBeVisible();

  // The lead is the largest paragraph sitting directly in the article, above
  // the first section, so the maximum is the number under test.
  const sizes = await page
    .locator('article > p')
    .evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(sizes.length, 'the page must open with a lead').toBeGreaterThan(0);
  expect(Math.max(...sizes), 'the largest paragraph above the first section').toBeLessThanOrEqual(LEAD_MAX_PX);
});

////////////////////////////////////////////////////////////////////////////////
// The card title (FRONT-18)
////////////////////////////////////////////////////////////////////////////////

test('a two-line card title does not run its lines together', async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE);
  await useLanguage(page, 'de');
  // `/recover` is the screen the audit measured: a German title that wraps.
  await page.goto('/recover');

  const title = page.locator('[data-slot="card-title"]').first();
  await expect(title).toBeVisible();

  const measured = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      wrap: `${style.getPropertyValue('text-wrap')} ${style.getPropertyValue('text-wrap-style')}`,
      height: Math.round(element.getBoundingClientRect().height),
    };
  });

  // NON-VACUITY: a one-line title would satisfy any leading rule.
  expect(measured.height, 'the German title must wrap for this to mean anything').toBeGreaterThan(
    measured.fontSize * 1.6,
  );
  expect(
    measured.lineHeight / measured.fontSize,
    `card titles draw at line-height ${measured.lineHeight} on font-size ${measured.fontSize}`,
  ).toBeGreaterThanOrEqual(TITLE_LEADING_FLOOR);
  expect(measured.wrap, 'card titles balance their lines').toContain('balance');
});

////////////////////////////////////////////////////////////////////////////////
// The form controls (FRONT-14) and the calendar (FRONT-13)
////////////////////////////////////////////////////////////////////////////////

test(`the manual add form draws ${TAP_TARGET_PX} px inputs and select`, async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE);
  await completeOnboarding(page);
  await page.goto('/add');
  await page.getByRole('button', { name: EN.add.search.addManually }).click();

  const form = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="manual"]') });
  await form.getByRole('button', { name: EN.add.manual.nutritionToggle }).click();

  // The one input on this form with no per-caller height: what the primitive
  // itself decides.
  expectTapTarget(
    { width: TAP_TARGET_PX, height: (await boxOf(form.locator('input[name="carbs"]'))).height },
    'the carbs input',
  );
  expectTapTarget(
    { width: TAP_TARGET_PX, height: (await boxOf(form.locator('[data-slot="select-trigger"]').first())).height },
    'the meal select',
  );
});

/**
 * The date picker, opened and finished animating.
 *
 * THE WAIT IS NOT A SLEEP AND IT IS NOT OPTIONAL. The popover opens with
 * `zoom-in-95`, so every box inside it reads at 95 percent of its real size
 * until the keyframes end: the first draft of this spec measured a 44 px day
 * cell as 42 and a 36 px one as 34.4. Waiting on the element's own animations
 * measures the calendar at rest.
 *
 * @param page - a page showing the diary.
 * @param previousDayLabel - what this language calls the previous-day arrow.
 * @returns the popover.
 */
async function openDatePicker(page: Page, previousDayLabel: string): Promise<Locator> {
  const previousDay = page.getByRole('link', { name: previousDayLabel });
  await previousDay.locator('xpath=..').locator('button[aria-haspopup="dialog"]').click();
  const popover = page.locator('[data-slot="popover-content"]');
  await expect(popover.locator('[role="grid"]').first()).toBeVisible();
  await popover.first().evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  return popover;
}

test(`the date picker's cells are ${TAP_TARGET_PX} px tall and it still fits a 320 px phone`, async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE);
  await completeOnboarding(page);
  await page.goto('/diary');

  const popover = await openDatePicker(page, extraCopyFor('en').diary.nav.previousDay);

  const cells = popover.locator('[data-day] button');
  const cellCount = await cells.count();
  expect(cellCount, 'the picker must draw a month of days').toBeGreaterThan(20);
  const cellBoxes = await cells.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
    }),
  );
  expect(Math.min(...cellBoxes.map((box) => box.height)), 'the shortest day cell').toBeGreaterThanOrEqual(
    TAP_TARGET_PX - TOLERANCE_PX,
  );
  // A seven-column grid cannot be 44 px wide on a 320 px screen, so the width
  // budget is "as wide as the row allows, never square-tiny": 40 px is the
  // floor a 320 px phone can still honour.
  expect(Math.min(...cellBoxes.map((box) => box.width)), 'the narrowest day cell at 360').toBeGreaterThanOrEqual(40);

  const monthButtons = popover.locator('nav button');
  expect(await monthButtons.count(), 'the picker must offer both month arrows').toBeGreaterThanOrEqual(2);
  const monthBoxes = await monthButtons.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
    }),
  );
  for (const box of monthBoxes) expectTapTarget(box, 'a month arrow');

  const widthAt360 = await popover.first().evaluate((element) => element.getBoundingClientRect().width);
  expect(widthAt360, 'the picker must fit the 360 px phone').toBeLessThanOrEqual(NARROW_PHONE.width - 2 * TOLERANCE_PX);

  await page.keyboard.press('Escape');
  await page.setViewportSize(TINY_PHONE);
  const tiny = await openDatePicker(page, extraCopyFor('en').diary.nav.previousDay);
  const widthAt320 = await tiny.first().evaluate((element) => element.getBoundingClientRect().width);
  expect(widthAt320, 'the picker must fit the 320 px phone too').toBeLessThanOrEqual(TINY_PHONE.width);
});
