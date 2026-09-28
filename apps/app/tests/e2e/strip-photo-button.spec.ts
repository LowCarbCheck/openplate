/**
 * The composer strip leads with the large photo button, on every page that owns its own camera (M260).
 *
 * THE REPORT (operator, 2026-09-26). 0.48.0 gave the add sheet a large filled "Plate photo" button,
 * because the operator had called the strip's 44 px camera key "almost hidden" there. Counsel noted
 * that the diary and Overview still ended their strip in exactly that key, and the operator answered:
 * "yes same large button". So the standalone strip draws the sheet's door above its type and speak
 * row, and the row has no camera key any more.
 *
 * WHAT THIS PROVES, at the 390 x 844 phone of this tier:
 *
 * - On `/diary` (the first-ever empty state, and a day with a logged food), on `/dashboard` and on
 *   `/pantry`, the strip holds ONE button named in words (`launcher.platePhoto`, and `launcher.photo`
 *   on the pantry, which photographs a shelf and not a plate). It is at least 64 px tall, as wide
 *   as the strip within 1 px, above the type link, filled with the add sheet's own photo fill (read
 *   off the sheet, never typed here), and it is the strip's one camera control.
 * - A tap on it opens the file chooser and leaves the page where it was: the camera opens inside the
 *   tap, not after a navigation.
 * - At 1280 px the diary's side-by-side placement (`sm:w-72`) holds the stacked strip without a
 *   horizontal overflow and without cutting the label.
 * - At 360 px the label fits in all six languages, on the diary and on the pantry.
 * - The reader can say no: a control shrinks, narrows, moves and unfills the button and adds a
 *   second camera key, and each fault must be reported.
 *
 * WHAT IT DOES NOT PROVE:
 *
 * - The add sheet's own door. `three-tab-bar.spec.ts` measures it, and the component both draw is
 *   one (`app/components/intake/photo-door.tsx`), so the two cannot drift.
 * - What happens after a photo is picked. `pantry-second-photo.spec.ts` and the scan specs own that.
 *
 * RED ON 0.48.0. Run against the 0.48.0 build (openplate 9603605) before the change, every test in
 * this file failed at its first reading: the strip carried no button with a visible name, only the
 * icon-only key named "Photo".
 *
 * WIDTHS ARE READ FROM `clientWidth`, never from `innerWidth`: this project runs with `isMobile`,
 * and a mobile Chromium zooms out on an overflowing page, which would hide the overflow.
 */
import { expect, test, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { EN, catalogFor } from './copy';
import { completeOnboarding, connectStubAiProvider, logFoodManually, useLanguage } from './helpers';
import { settleAnimations } from './layout-shift';

/** How tall the photo button must be, the add sheet's door. */
const PHOTO_BUTTON_MIN_PX = 64;

/** How far the button's width may differ from the strip's before it counts. */
const WIDTH_TOLERANCE_PX = 1;

/** The phone width the label must fit in every language. */
const NARROW_PHONE_WIDTH = 360;

/** A generous phone height, so width is the only thing that changes. */
const PHONE_HEIGHT = 844;

/** The desktop the side-by-side placements are read at. */
const DESKTOP = { width: 1280, height: 800 } as const;

/** One food, so the diary draws a day and the strip under it. */
const SEEDED_FOOD = { name: 'Strip photo cheddar', grams: '40', carbs: '1.2' } as const;

/**
 * The strip's type link: the writing surface, which goes to the composer without `speak=1`. Every
 * standalone strip draws exactly one, so it is how the strip is found in both builds.
 */
const TYPE_LINK = 'main a[href^="/add/describe"]:not([href*="speak=1"])';

/** Any camera control, a link or a button that draws the camera glyph. */
const CAMERA_CONTROL = ':is(a, button):has(svg.lucide-camera)';

/** What one read of a strip found. */
interface StripReading {
  /** How many type links `main` holds. One, or the strip was not found for certain. */
  typeLinks: number;
  strip: { width: number; left: number; right: number; scrollWidth: number; clientWidth: number };
  typeTop: number;
  /** Every button in the strip whose own words are the expected label. */
  photos: {
    top: number;
    width: number;
    height: number;
    fill: string;
    labelScrollWidth: number;
    labelClientWidth: number;
  }[];
  /** How many camera controls the strip holds. */
  cameras: number;
}

/**
 * Reads the one strip in `main`, found by its type link.
 *
 * The strip is the type link's grandparent: the link sits in the type and speak row, and the row
 * sits in the strip. That holds on 0.48.0 too, so the old build is read, not just missed.
 *
 * @param page - a page with one standalone strip in `main`.
 * @param label - the photo button's visible name in the page's language.
 * @returns the reading.
 */
async function readStrip(page: Page, label: string): Promise<StripReading> {
  await expect(page.locator(TYPE_LINK).first(), 'the strip must be drawn before it is read').toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE, so its helpers cannot move out of it.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate(
    ({ typeSelector, cameraSelector, name }) => {
      const links = document.querySelectorAll(typeSelector);
      const typeLink = links[0];
      const strip = typeLink?.parentElement?.parentElement;
      if (typeLink === undefined || strip === null || strip === undefined) {
        throw new Error('the page has no strip to read');
      }
      const box = strip.getBoundingClientRect();
      const photos = [...strip.querySelectorAll('button')]
        .filter((button) => (button.textContent ?? '').trim() === name)
        .map((button) => {
          const rect = button.getBoundingClientRect();
          const words = [...button.querySelectorAll('span')].find(
            (span) => (span.textContent ?? '').trim() === name,
          );
          return {
            top: rect.top,
            width: rect.width,
            height: rect.height,
            fill: getComputedStyle(button).backgroundColor,
            labelScrollWidth: words?.scrollWidth ?? Number.POSITIVE_INFINITY,
            labelClientWidth: words?.clientWidth ?? 0,
          };
        });
      return {
        typeLinks: links.length,
        strip: {
          width: box.width,
          left: box.left,
          right: box.right,
          scrollWidth: strip.scrollWidth,
          clientWidth: strip.clientWidth,
        },
        typeTop: typeLink.getBoundingClientRect().top,
        photos,
        cameras: strip.querySelectorAll(cameraSelector).length,
      };
    },
    { typeSelector: TYPE_LINK, cameraSelector: CAMERA_CONTROL, name: label },
  );
  // oxlint-enable unicorn/consistent-function-scoping
}

/**
 * Every way a reading breaks the design, one sentence each, so a red line names the fault.
 *
 * @param reading - what {@link readStrip} found.
 * @param options - the label looked for, and the add sheet's photo fill to match.
 * @returns the faults, empty when the strip leads with the large button.
 */
function stripFaults(reading: StripReading, { label, sheetFill }: { label: string; sheetFill: string }): string[] {
  if (reading.typeLinks !== 1) return [`main holds ${reading.typeLinks} type links, not one strip`];
  const [photo] = reading.photos;
  if (reading.photos.length !== 1 || photo === undefined) {
    return [`the strip holds ${reading.photos.length} buttons named "${label}", not one`];
  }
  const faults: string[] = [];
  if (photo.height < PHOTO_BUTTON_MIN_PX) faults.push(`the photo button is ${photo.height} px tall`);
  if (Math.abs(photo.width - reading.strip.width) > WIDTH_TOLERANCE_PX) {
    faults.push(`the photo button is ${photo.width} px wide in a ${reading.strip.width} px strip`);
  }
  if (photo.top >= reading.typeTop) faults.push('the photo button is not above the type link');
  if (photo.fill !== sheetFill) faults.push(`the photo button is filled ${photo.fill}, the sheet's door ${sheetFill}`);
  if (reading.cameras !== 1) faults.push(`the strip holds ${reading.cameras} camera controls`);
  if (photo.labelScrollWidth > photo.labelClientWidth) {
    faults.push(`the label needs ${photo.labelScrollWidth} px in a ${photo.labelClientWidth} px box`);
  }
  if (reading.strip.scrollWidth > reading.strip.clientWidth) {
    faults.push(`the strip overflows: ${reading.strip.scrollWidth} px of content in ${reading.strip.clientWidth} px`);
  }
  return faults;
}

/**
 * The add sheet's photo door fill, read off the open sheet, so the strip is held to the door the
 * operator already approved rather than to a colour typed here.
 */
async function readSheetPhotoFill(page: Page): Promise<string> {
  await page.locator('[data-slot="bottom-nav-add"]').tap();
  const door = page.locator('[data-slot="sheet-content"] [data-slot="add-sheet-photo"]');
  await expect(door, 'the add sheet must show its photo door').toBeVisible();
  const fill = await door.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(fill, 'the sheet door must be filled').not.toBe('rgba(0, 0, 0, 0)');
  return fill;
}

/**
 * Taps the strip's photo button and requires the file chooser, with the page left where it was.
 * A provider must be connected first: without one the gesture navigates instead of asking.
 */
async function expectTapOpensTheCamera(page: Page, label: string): Promise<void> {
  const before = page.url();
  const button = page.locator(TYPE_LINK).locator('xpath=../..').getByRole('button', { name: label, exact: true });
  const chooser = page.waitForEvent('filechooser');
  await button.tap();
  await chooser;
  expect(page.url(), 'the tap must open the camera where the page is, not navigate first').toBe(before);
}

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page);
  await connectStubAiProvider(page);
});

test('the diary empty state leads with the large photo button, and a tap opens the camera', async ({ page }) => {
  await page.goto('/diary');
  const sheetFill = await readSheetPhotoFill(page);
  const label = EN.launcher.platePhoto;

  expect(stripFaults(await readStrip(page, label), { label, sheetFill }), 'the empty state strip').toEqual([]);
  await expectTapOpensTheCamera(page, label);
});

test('a day with a logged food leads its strip with the large photo button', async ({ page }) => {
  await logFoodManually(page, SEEDED_FOOD);
  await page.goto('/diary');
  const sheetFill = await readSheetPhotoFill(page);
  const label = EN.launcher.platePhoto;

  expect(stripFaults(await readStrip(page, label), { label, sheetFill }), 'the strip under the day').toEqual([]);
  await expectTapOpensTheCamera(page, label);
});

test('Overview leads its strip with the large photo button', async ({ page }) => {
  await page.goto('/dashboard');
  const sheetFill = await readSheetPhotoFill(page);
  const label = EN.launcher.platePhoto;

  expect(stripFaults(await readStrip(page, label), { label, sheetFill }), 'the Overview strip').toEqual([]);
  await expectTapOpensTheCamera(page, label);
});

test('the pantry leads its strip with the large photo button, named for a shelf, not a plate', async ({ page }) => {
  await page.goto('/pantry');
  const sheetFill = await readSheetPhotoFill(page);
  const label = EN.launcher.photo;

  expect(stripFaults(await readStrip(page, label), { label, sheetFill }), 'the pantry strip').toEqual([]);
  // A plate is the wrong picture here: the diary's name must not be on the pantry's button.
  expect((await readStrip(page, EN.launcher.platePhoto)).photos, 'the pantry says "Plate photo"').toEqual([]);
  await expectTapOpensTheCamera(page, label);
});

test('CONTROL: the reader reports a small, narrow, low, unfilled button and a second camera key', async ({ page }) => {
  await page.goto('/diary');
  const sheetFill = await readSheetPhotoFill(page);
  const label = EN.launcher.platePhoto;
  expect(stripFaults(await readStrip(page, label), { label, sheetFill }), 'the strip before the control').toEqual([]);

  await page.evaluate(
    ({ typeSelector, name }) => {
      const strip = document.querySelector(typeSelector)?.parentElement?.parentElement;
      const button = [...(strip?.querySelectorAll('button') ?? [])].find(
        (candidate) => (candidate.textContent ?? '').trim() === name,
      );
      if (strip === null || strip === undefined || button === undefined) throw new Error('nothing to break');
      // `transition:none`, or a read in the same frame sees the old height (`Button` has none,
      // but a hover or active class might).
      button.style.cssText = 'min-height:0;height:44px;width:50%;background:transparent;transition:none';
      // Below the row, which puts it under the type link.
      strip.append(button);
      // A second camera: the old icon-only key, back beside the speak key.
      const key = document.createElement('button');
      key.innerHTML = '<svg class="lucide lucide-camera"></svg>';
      strip.firstElementChild?.append(key);
    },
    { typeSelector: TYPE_LINK, name: label },
  );
  await settleAnimations(page);

  const faults = stripFaults(await readStrip(page, label), { label, sheetFill });
  for (const fault of ['px tall', 'px wide in a', 'not above the type link', 'is filled', 'camera controls']) {
    expect(faults.some((line) => line.includes(fault)), `the reader missed "${fault}": ${faults.join('; ')}`).toBe(true);
  }
});

test('at 1280 px the diary side-by-side placement holds the stacked strip', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/diary');
  const label = EN.launcher.platePhoto;
  const reading = await readStrip(page, label);

  expect(reading.photos.length, 'the strip holds one photo button at 1280 px').toBe(1);
  expect(reading.strip.width, 'the empty state strip is the `sm:w-72` placement, 288 px').toBe(288);
  expect(
    reading.strip.scrollWidth,
    `the strip overflows: ${reading.strip.scrollWidth} px of content in ${reading.strip.clientWidth} px`,
  ).toBeLessThanOrEqual(reading.strip.clientWidth);
  const [photo] = reading.photos;
  expect(photo?.labelScrollWidth, 'the label is cut').toBeLessThanOrEqual(photo?.labelClientWidth ?? 0);
  expect(Math.abs((photo?.width ?? 0) - reading.strip.width), 'the button fills the strip').toBeLessThanOrEqual(
    WIDTH_TOLERANCE_PX,
  );
  const card = await page.locator('[data-slot="diary-empty-first-ever"]').boundingBox();
  if (card === null) throw new Error('the first-ever card has no box');
  expect(reading.strip.right, 'the strip runs past its card').toBeLessThanOrEqual(card.x + card.width);
});

test('the photo button label fits at 360 px in all six languages, on the diary and the pantry', async ({ page }) => {
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });

  for (const locale of SUPPORTED_LANGUAGES) {
    await useLanguage(page, locale);
    const copy = catalogFor(locale);
    for (const [path, label] of [
      ['/diary', copy.launcher.platePhoto],
      ['/pantry', copy.launcher.photo],
    ] as const) {
      await page.goto(path);
      const reading = await readStrip(page, label);
      // NON-VACUITY: the button is found by this language's words, so a page left in English
      // cannot pass for a fit.
      expect(reading.photos.length, `${locale} ${path}: one button named "${label}"`).toBe(1);
      const [photo] = reading.photos;
      expect(
        photo?.labelScrollWidth,
        `${locale} ${path}: "${label}" needs ${photo?.labelScrollWidth} px in ${photo?.labelClientWidth} px`,
      ).toBeLessThanOrEqual(photo?.labelClientWidth ?? 0);
      expect(reading.strip.right, `${locale} ${path}: the strip runs past the viewport`).toBeLessThanOrEqual(
        NARROW_PHONE_WIDTH,
      );
    }
  }

  // THE CONTROL: the same reader must see a label that does not fit.
  await page.evaluate(
    ({ typeSelector }) => {
      const strip = document.querySelector(typeSelector)?.parentElement?.parentElement;
      const words = strip?.querySelector('button span');
      if (words === null || words === undefined) throw new Error('no label to lengthen');
      words.textContent = 'Photographiere das ganze Regal mit allem darin';
    },
    { typeSelector: TYPE_LINK },
  );
  const long = await readStrip(page, 'Photographiere das ganze Regal mit allem darin');
  const [photo] = long.photos;
  expect(photo?.labelScrollWidth ?? 0, 'CONTROL: an overlong label must read as cut').toBeGreaterThan(
    photo?.labelClientWidth ?? 0,
  );
});
