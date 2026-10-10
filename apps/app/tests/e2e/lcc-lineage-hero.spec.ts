/**
 * One hero per screen, and the hero paints graph paper rather than a teal wash (M243 spec 04).
 *
 * WHY THIS CANNOT BE A SOURCE COUNT. `.surface-brand` appears in seven files, and grepping them
 * says nothing about what a PERSON sees: `diary.tsx` builds the class inside a `cn()`,
 * `weekly-recap-card.tsx` renders inside a route, `dev.playground.tsx` is a dev-only page, and the
 * diary's hero is not drawn at all until the day has an entry. The rule is about a SCREEN, so it
 * is read on a screen, in the production build, at a phone width.
 *
 * AT MOST ONE, NOT EXACTLY ONE. Several screens legitimately show zero: an empty diary has no day
 * to summarise, and `/trends` has no week to recap before anything is logged. Both states are
 * walked, the empty first visit and the same device with one food in it, because a second hero
 * that only appears once there is data is exactly the bug this guard is for.
 *
 * ── WHAT THE HERO IS MADE OF NOW ──
 * An ordinary card fill, an ordinary hairline, `shadow-sm`, and the page's graph paper drawn
 * INSIDE the panel from the `--border` token at `HERO_GRID_LINE_ALPHA`, behind the head band only
 * (the fading band the operator chose on 2026-10-11). The paper is solid for the first
 * `HERO_BAND_SOLID_PX` and a cover layer of opaque `--card` hides it from `HERO_BAND_FADE_END_PX`
 * down, so the panel below the band is the plain card fill. The paper is the whole device: it is
 * what marks the hero now that the fill is every other card's, and it is why the dashboard's hero
 * is also asserted to be the only element on that screen painting a grid.
 *
 * ── THE FADE IS READ TWICE, AND ONE OF THE READS IS A PIXEL ──
 * The computed `background-image` says what was ASKED FOR: the cover is the first of three layers
 * and it runs from clear to the card colour between the two heights. That does not say what is
 * DRAWN, so a probe wearing the real class is screenshotted: the band must hold paper, the part
 * under the fade end must be one flat colour (the card's), and the band between must be weaker
 * than the top and stronger than nothing. The probe is empty and fixed to the viewport on purpose:
 * the real hero's rows and tiles would sit on the very pixels being read.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * Controls, each injecting the exact thing the check exists to catch:
 *
 * 1. A second `.surface-brand` element, which must break the count AND the only-grid claim.
 * 2. The old M129 wash, re-injected with `addStyleTag` at a higher precedence, which must break
 *    the paint claim on the real hero.
 * 3. A `shadow-md` probe beside the `shadow-sm` probe, so "the hero rests at shadow-sm" is a
 *    comparison between two different values rather than a string that happens to match.
 * 4. The previous look, whole-panel paper at seven tenths with no cover, set on a probe: the
 *    computed-style reader must reject it and the flat-colour pixel read must find paper in the
 *    lower part.
 * 5. The two schemes must paint different cards, or "the lower part is the card colour" was read
 *    twice off one theme.
 *
 * @area brand-and-lineage
 */
import { expect, test, type Page } from '@playwright/test';

import {
  GRID_CELL_PX,
  HERO_BAND_FADE_END_PX,
  HERO_BAND_SOLID_PX,
  HERO_GRID_LINE_ALPHA,
  GRID_LINE_ALPHA,
} from '../design-contract';
import { completeOnboarding, logFoodManually, PHONE_WIDTH } from './helpers';

/** The phone this tier emulates. */
const PHONE_HEIGHT = 844;

/** Every screen that is allowed a hero, walked in both states. */
const ROUTES = ['/diary', '/dashboard', '/trends', '/fasting', '/nutrients'] as const;

/** The most heroes any one screen may draw. */
const HERO_CEILING = 1;

/** One food, so the diary has a day to summarise and `/trends` has a week to recap. */
const SEEDED_FOOD = { name: 'Hero walk cheddar', grams: '40', carbs: '1.2' } as const;

/** The class the one-hero rule is written in. */
const HERO_SELECTOR = '.surface-brand';

/** The M129 wash this spec replaced, in author form, for the re-injection control. */
const OLD_WASH_CSS =
  'linear-gradient(140deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.07) 45%, hsl(var(--primary) / 0.02) 100%)';

/**
 * A theme token resolved to the `rgb(r, g, b)` the browser paints it as.
 *
 * READ FROM THE PAGE, never retyped. The tokens are themed and the test tier runs in whichever
 * scheme the browser reports, so a literal here would pin one theme and pass vacuously in the
 * other. A probe given `color: hsl(var(--token))` makes the browser do the conversion.
 *
 * @param page - a loaded page.
 * @param token - the custom property name, with its leading dashes.
 * @returns the computed colour, as `rgb(r, g, b)`.
 */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `hsl(var(${name}))`;
    document.body.append(probe);
    const painted = globalThis.getComputedStyle(probe).color;
    probe.remove();
    return painted;
  }, token);
}

/**
 * The same colour at an alpha, written the way a computed `background-image` writes it.
 *
 * @param rgb - a colour as `rgb(r, g, b)`.
 * @param alpha - the alpha to apply.
 * @returns the colour as `rgba(r, g, b, a)`.
 */
function atAlpha(rgb: string, alpha: number): string {
  const channels = rgb.slice(rgb.indexOf('(') + 1, rgb.lastIndexOf(')'));
  return `rgba(${channels}, ${alpha})`;
}

/** What one element's paint says about it. */
interface HeroPaint {
  /** The computed `background-image`. */
  backgroundImage: string;
  /** The computed `box-shadow`. */
  boxShadow: string;
}

/**
 * The hero's own paint, read off the element the one-hero rule counts.
 *
 * @param page - a page whose screen draws exactly one hero.
 * @returns its background image and its shadow, as the browser computes them.
 */
async function heroPaint(page: Page): Promise<HeroPaint> {
  return page.locator(HERO_SELECTOR).first().evaluate((node) => {
    const style = globalThis.getComputedStyle(node);
    return { backgroundImage: style.backgroundImage, boxShadow: style.boxShadow };
  });
}

/**
 * Whether a computed `background-image` is the hero's graph paper: three linear layers (the cover
 * and the two paper layers), one of them running to the right.
 *
 * `to bottom` IS NOT IN THE COMPUTED STRING. It is the default direction, so a browser drops it
 * on the way out and serialises the vertical layer as `linear-gradient(rgba(...) 1px, ...)`. The
 * first version of this reader looked for both keywords and reported zero grids on a page that
 * was visibly drawing one, which is why the layer COUNT carries the second half of the claim.
 * The cover is a vertical layer too, so the count is three and not two.
 *
 * @param image - a computed `background-image`, or `none`.
 * @returns true when the value is the cover plus the two-layer grid.
 */
function paintsGraphPaper(image: string): boolean {
  const layers = image.split('linear-gradient(').length - 1;
  return layers === HERO_LAYER_COUNT && image.includes('linear-gradient(to right,');
}

/** The cover layer, and the two paper layers under it. */
const HERO_LAYER_COUNT = 3;

/** The clear colour a computed gradient writes for `transparent`. */
const CLEAR = 'rgba(0, 0, 0, 0)';

/**
 * Whether the FIRST layer of a computed `background-image` is the cover: clear down to the solid
 * height, the card colour at the fade end, and nothing else.
 *
 * The first layer is the one painted on top, which is the whole point: a cover listed under the
 * paper would hide nothing. The string is matched from its start for that reason.
 *
 * @param input.image - a computed `background-image`.
 * @param input.card - the `--card` token as `rgb(r, g, b)`.
 * @returns true when the top layer is the clear-to-card cover at the contract heights.
 */
function coversTheLowerPanel({ image, card }: { image: string; card: string }): boolean {
  const expected =
    `linear-gradient(${CLEAR} 0px, ${CLEAR} ${HERO_BAND_SOLID_PX}px, ${card} ${HERO_BAND_FADE_END_PX}px), ` +
    'linear-gradient(to right,';
  return image.startsWith(expected);
}

/**
 * Every non-empty computed `background-image` in the document.
 *
 * The page hands back strings and the predicate above runs in node, so the browser and the
 * assertions cannot drift into two different ideas of what a grid is.
 *
 * @param page - a loaded page.
 * @returns one value per element that paints something.
 */
async function paintedImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .map((node) => globalThis.getComputedStyle(node).backgroundImage)
      .filter((image) => image !== 'none'),
  );
}

/**
 * How many elements anywhere in the document paint graph paper.
 *
 * @param page - a loaded page.
 * @returns the count.
 */
async function gridElementCount(page: Page): Promise<number> {
  return (await paintedImages(page)).filter(paintsGraphPaper).length;
}

/** The probe's width, in CSS px: wide enough to hold several grid cells across. */
const PROBE_WIDTH = 300;

/** The probe's height, in CSS px: taller than the fade end, so there is a lower part to read. */
const PROBE_HEIGHT = 320;

/** A horizontal strip of the probe, in CSS px from its top edge. */
interface Rows {
  top: number;
  height: number;
}

/**
 * Inside the solid band: ends 16 px above where the cover starts, and holds a full grid row at
 * y = 27 (the paper is positioned at -1px, so its lines are at 28k - 1).
 */
const BAND_ROWS: Rows = { top: 0, height: HERO_BAND_SOLID_PX - 16 };

/** Inside the fade, centred on the grid line at y = 111, where the cover is about half opaque. */
const FADE_ROWS: Rows = { top: 100, height: 30 };

/** Under the fade end, with a margin of 10 px for the rasteriser, down to the probe's foot. */
const LOWER_ROWS: Rows = {
  top: HERO_BAND_FADE_END_PX + 10,
  height: PROBE_HEIGHT - HERO_BAND_FADE_END_PX - 10,
};

/**
 * The most ink a strip of plain card may carry. A flat fill is not read back to the digit: a
 * gradient layer is shaded in floating point, and the lower part of the probe came back one channel
 * step off the card colour on one or two channels in both themes (a summed distance of 3 in light
 * and 2 in dark). Three is one step on each of the three channels.
 */
const FLAT_FILL_INK_MAX = 3;

/**
 * The least ink a strip must carry to be called paper. The faintest line the band draws, in the
 * dark theme, is a summed distance of about 56 from the card; the fade at its half way is about 33.
 */
const PAPER_INK_MIN = 20;

/** What a strip of pixels holds. */
interface RegionReading {
  /** The largest summed channel distance from the card colour, 0 for a strip that is all card. */
  ink: number;
}

/**
 * Plants an empty element wearing `.surface-brand` over the top-left of the viewport.
 *
 * AN EMPTY PROBE, NOT THE REAL HERO, because the real hero's rows and tiles carry fills of their
 * own and would sit on the very pixels being read. The probe wears the real class, so it is the
 * real stylesheet that paints it. It has no border and no shadow, so every pixel in it is the
 * panel's own background.
 *
 * @param page - a loaded page.
 * @param extraStyle - extra inline declarations, for a control that paints the old look.
 */
async function plantProbe(page: Page, extraStyle: string): Promise<void> {
  await page.evaluate(
    ({ width, height, extra }) => {
      const probe = document.createElement('div');
      probe.id = 'hero-probe';
      probe.className = 'surface-brand';
      probe.style.cssText =
        `position:fixed;top:0;left:0;width:${width}px;height:${height}px;z-index:2147483647;` +
        `border:0;box-shadow:none;transition:none;${extra}`;
      document.body.append(probe);
    },
    { width: PROBE_WIDTH, height: PROBE_HEIGHT, extra: extraStyle },
  );
}

/**
 * Reads a strip of the probe off a screenshot: how far its furthest pixel is from the card colour.
 *
 * The PNG is decoded in the page (`createImageBitmap` of a blob, which no content security policy
 * governs) so the colours are the browser's own and no image library is needed here.
 *
 * @param input.page - a page with the probe planted.
 * @param input.rows - the strip to read.
 * @param input.card - the `--card` token as `rgb(r, g, b)`.
 * @returns the ink.
 */
async function readRegion({ page, rows, card }: { page: Page; rows: Rows; card: string }): Promise<RegionReading> {
  const png = await page.screenshot({ clip: { x: 0, y: rows.top, width: PROBE_WIDTH, height: rows.height } });
  const channels = card
    .slice(card.indexOf('(') + 1, card.lastIndexOf(')'))
    .split(',')
    .map((channel) => Number(channel));
  return page.evaluate(
    async ({ base64, target }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context to read the screenshot with');
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let ink = 0;
      for (let at = 0; at < data.length; at += 4) {
        const distance =
          Math.abs(data[at] - target[0]) + Math.abs(data[at + 1] - target[1]) + Math.abs(data[at + 2] - target[2]);
        ink = Math.max(ink, distance);
      }
      return { ink };
    },
    { base64: png.toString('base64'), target: channels },
  );
}

/** The previous look as inline declarations: paper over the whole panel at seven tenths, no cover. */
const PREVIOUS_LOOK_STYLE =
  `background-image: linear-gradient(to right, hsl(var(--border) / ${GRID_LINE_ALPHA}) 1px, transparent 1px), ` +
  `linear-gradient(to bottom, hsl(var(--border) / ${GRID_LINE_ALPHA}) 1px, transparent 1px);` +
  `background-size: ${GRID_CELL_PX}px ${GRID_CELL_PX}px; background-repeat: repeat;` +
  'background-position: -1px -1px; background-origin: padding-box;';

/**
 * The computed shadow of a probe wearing one Tailwind shadow class.
 *
 * A PROBE, not a literal: the two values moved when Tailwind 4 renamed its shadow scale, and a
 * frozen string would have gone on passing against whatever the build actually emits. The probe
 * is read in the same document as the hero, so both answers come from the same stylesheet.
 *
 * @param page - a loaded page.
 * @param shadowClass - the class to wear, for example `shadow-sm`.
 * @returns the computed `box-shadow`.
 */
async function probeShadow(page: Page, shadowClass: string): Promise<string> {
  return page.evaluate((className) => {
    const probe = document.createElement('div');
    probe.className = className;
    probe.style.cssText = 'position:fixed;top:0;left:0;width:8px;height:8px;transition:none';
    document.body.append(probe);
    const painted = globalThis.getComputedStyle(probe).boxShadow;
    probe.remove();
    return painted;
  }, shadowClass);
}

/**
 * Counts the heroes on every route, in the state the device is already in.
 *
 * @param page - a page on a device in the state being walked.
 * @param state - the state's name, so a failure says which walk found the second hero.
 * @returns one `route: count` line per route, in the order they were walked.
 */
async function walkHeroCounts(page: Page, state: string): Promise<string[]> {
  const counts: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('main').first(), `${state} ${route}: the page must render`).toBeVisible();
    await page.waitForLoadState('load');
    counts.push(`${route}: ${await page.locator(HERO_SELECTOR).count()}`);
  }
  return counts;
}

/**
 * The routes whose count is over the ceiling, as readable lines.
 *
 * @param counts - `route: count` lines from `walkHeroCounts`.
 * @returns the offending lines, empty when every screen is within the ceiling.
 */
function overTheCeiling(counts: readonly string[]): string[] {
  return counts.filter((line) => Number(line.slice(line.lastIndexOf(':') + 1)) > HERO_CEILING);
}

test('at most one hero per screen, empty and with a food in the diary', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await completeOnboarding(page);

  const empty = await walkHeroCounts(page, 'empty');
  expect(overTheCeiling(empty), `a screen drew more than ${HERO_CEILING} hero on a fresh device`).toEqual([]);

  await logFoodManually(page, SEEDED_FOOD);
  const logged = await walkHeroCounts(page, 'logged');
  expect(overTheCeiling(logged), `a screen drew more than ${HERO_CEILING} hero once a food was logged`).toEqual([]);

  // NON-VACUITY. A build that rendered no hero anywhere would satisfy "at most one" on every
  // screen. Logging a food is what brings the diary's own hero back, so the two walks must differ
  // and the logged walk must find heroes.
  const drawn = logged.filter((line) => line.endsWith(': 1'));
  expect(drawn.length, `no screen drew a hero at all, so the ceiling proved nothing: ${logged.join(', ')}`)
    .toBeGreaterThan(2);
  expect(empty, 'the empty diary has no day to summarise, so the two walks cannot be identical').not.toEqual(logged);
});

test('CONTROL: a second hero on one screen breaks the count and the only-grid claim', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page.locator(HERO_SELECTOR).first(), 'the dashboard must draw its hero').toBeVisible();

  expect(await page.locator(HERO_SELECTOR).count(), 'the dashboard starts with exactly one hero').toBe(1);
  expect(await gridElementCount(page), 'and exactly one element painting graph paper').toBe(1);

  await page.evaluate(() => {
    const second = document.createElement('div');
    second.className = 'surface-brand';
    second.id = 'control-second-hero';
    second.style.cssText = 'position:fixed;top:0;left:0;width:40px;height:40px;z-index:9999';
    document.body.append(second);
  });

  expect(await page.locator(HERO_SELECTOR).count(), 'CONTROL: the count must see the second hero').toBe(2);
  expect(
    overTheCeiling([`/dashboard: ${await page.locator(HERO_SELECTOR).count()}`]),
    'CONTROL: the ceiling reader must report the screen',
  ).toEqual(['/dashboard: 2']);
  expect(await gridElementCount(page), 'CONTROL: the second hero paints paper too, so the grid count must move').toBe(
    2,
  );
});

test('the hero paints graph paper behind its band on the border token, and rests at shadow-sm', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);

  const smallShadow = await probeShadow(page, 'shadow-sm');
  const mediumShadow = await probeShadow(page, 'shadow-md');
  expect(smallShadow, 'the shadow-sm probe must paint something, or the comparison is vacuous').not.toBe('none');
  expect(mediumShadow, 'the two shadow steps must differ, or the claim below proves nothing').not.toBe(smallShadow);

  const borderLine = atAlpha(await tokenColour(page, '--border'), HERO_GRID_LINE_ALPHA);
  const brandLine = atAlpha(await tokenColour(page, '--primary'), HERO_GRID_LINE_ALPHA);
  expect(borderLine, 'the two tokens must resolve differently, or the colour claim is vacuous').not.toBe(brandLine);
  const card = await tokenColour(page, '--card');
  expect(card, 'the card and the border must differ, or the cover claim is vacuous').not.toBe(
    await tokenColour(page, '--border'),
  );

  const checked: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('main').first(), `${route}: the page must render`).toBeVisible();
    await page.waitForLoadState('load');
    if ((await page.locator(HERO_SELECTOR).count()) === 0) continue;

    const paint = await heroPaint(page);
    expect(
      paintsGraphPaper(paint.backgroundImage),
      `${route}: the hero must paint graph paper, and paints ${paint.backgroundImage}`,
    ).toBe(true);
    expect(paint.backgroundImage, `${route}: both layers are drawn in the border token`).toContain(borderLine);
    expect(paint.backgroundImage, `${route}: no layer may be drawn in the brand token`).not.toContain(brandLine);
    expect(paint.backgroundImage, `${route}: the 140 degree wash is what this spec removed`).not.toContain('140deg');
    expect(
      coversTheLowerPanel({ image: paint.backgroundImage, card }),
      `${route}: the top layer must be the cover, clear to ${HERO_BAND_SOLID_PX}px and the card colour at ${HERO_BAND_FADE_END_PX}px, and is ${paint.backgroundImage}`,
    ).toBe(true);
    expect(paint.boxShadow, `${route}: the hero rests at the small shadow`).toBe(smallShadow);
    checked.push(route);
  }

  expect(checked.length, `no screen drew a hero to read: ${ROUTES.join(', ')}`).toBeGreaterThan(2);
});

test('CONTROL: the old wash re-injected fails the paint claim on the real hero', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page.locator(HERO_SELECTOR).first(), 'the dashboard must draw its hero').toBeVisible();

  const borderLine = atAlpha(await tokenColour(page, '--border'), HERO_GRID_LINE_ALPHA);
  const before = await heroPaint(page);
  expect(before.backgroundImage, 'the hero starts on the border token').toContain(borderLine);

  await page.addStyleTag({ content: `.surface-brand { background-image: ${OLD_WASH_CSS} !important; }` });

  const after = await heroPaint(page);
  expect(after.backgroundImage, 'CONTROL: the re-injected wash must be what the reader now sees').toContain('140deg');
  expect(after.backgroundImage, 'CONTROL: and the border-token claim must go red').not.toContain(borderLine);
  expect(paintsGraphPaper(after.backgroundImage), 'CONTROL: a wash is not graph paper').toBe(false);
  expect(
    coversTheLowerPanel({ image: after.backgroundImage, card: await tokenColour(page, '--card') }),
    'CONTROL: a wash has no cover layer on top, so the fade claim must go red too',
  ).toBe(false);
  expect(await gridElementCount(page), 'CONTROL: the screen now paints no graph paper at all').toBe(0);

  // The predicate itself, against the two values it exists to tell apart, so a reader that
  // answered false to everything could not have passed the line above.
  expect(paintsGraphPaper(before.backgroundImage), 'CONTROL: the real hero is graph paper').toBe(true);
  expect(
    coversTheLowerPanel({ image: before.backgroundImage, card: await tokenColour(page, '--card') }),
    'CONTROL: and the real hero has the cover on top',
  ).toBe(true);
});

test('the dashboard hero is the topmost card and the only element painting graph paper', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);
  await page.goto('/dashboard');

  const cards = page.locator('[data-slot="card"]');
  await expect(cards.first(), 'the dashboard must draw its cards').toBeVisible();
  expect(await cards.count(), 'a claim about the TOPMOST card needs more than one card').toBeGreaterThan(2);
  await expect(cards.first(), 'the first card on the page is the hero').toHaveClass(/(?:^|\s)surface-brand(?:\s|$)/u);

  expect(await gridElementCount(page), 'exactly one element on the screen paints graph paper').toBe(1);

  // CONTROL: the second card is a plain card, so "the first one is the hero" is not a sentence
  // that any card would satisfy.
  await expect(cards.nth(1), 'CONTROL: the card under the hero must not wear the hero class').not.toHaveClass(
    /(?:^|\s)surface-brand(?:\s|$)/u,
  );
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the paper sits behind the head band only, and the lower hero is the plain card (${scheme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
    await page.emulateMedia({ colorScheme: scheme });
    await completeOnboarding(page);
    await page.goto('/dashboard');
    await expect(page.locator(HERO_SELECTOR).first(), 'the dashboard must draw its hero').toBeVisible();

    const card = await tokenColour(page, '--card');
    await plantProbe(page, '');
    const band = await readRegion({ page, rows: BAND_ROWS, card });
    const fade = await readRegion({ page, rows: FADE_ROWS, card });
    const lower = await readRegion({ page, rows: LOWER_ROWS, card });

    expect(band.ink, `${scheme}: the band holds paper, well away from the card colour`).toBeGreaterThan(PAPER_INK_MIN);
    expect(fade.ink, `${scheme}: the fade still shows some paper`).toBeGreaterThan(FLAT_FILL_INK_MAX);
    expect(fade.ink, `${scheme}: but weaker than the band shows it`).toBeLessThan(band.ink);
    expect(lower.ink, `${scheme}: below the fade the panel is the card colour and nothing else`).toBeLessThanOrEqual(
      FLAT_FILL_INK_MAX,
    );
  });
}

test('CONTROL: the two schemes paint different cards, so the flat-colour read is not one theme twice', async ({
  page,
}) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.emulateMedia({ colorScheme: 'light' });
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page.locator(HERO_SELECTOR).first()).toBeVisible();
  const light = await tokenColour(page, '--card');

  // The theme is decided when the page loads, so the dark card is read after a reload.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator(HERO_SELECTOR).first()).toBeVisible();
  expect(await tokenColour(page, '--card'), 'CONTROL: the dark card must not be the light one').not.toBe(light);
});

test('CONTROL: the previous look, paper over the whole panel, is caught by both readers', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page.locator(HERO_SELECTOR).first(), 'the dashboard must draw its hero').toBeVisible();

  const card = await tokenColour(page, '--card');
  await plantProbe(page, PREVIOUS_LOOK_STYLE);
  const lower = await readRegion({ page, rows: LOWER_ROWS, card });
  expect(lower.ink, 'CONTROL: whole-panel paper leaves paper in the lower part').toBeGreaterThan(PAPER_INK_MIN);

  const image = await page.locator('#hero-probe').evaluate((node) => globalThis.getComputedStyle(node).backgroundImage);
  expect(image, 'CONTROL: the probe now carries the old two layers').toContain('rgba(');
  expect(paintsGraphPaper(image), 'CONTROL: two layers are no longer the hero recipe').toBe(false);
  expect(coversTheLowerPanel({ image, card }), 'CONTROL: and there is no cover on top').toBe(false);
});
