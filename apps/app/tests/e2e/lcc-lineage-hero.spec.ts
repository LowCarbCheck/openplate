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
 * INSIDE the panel from the `--border` token at `GRID_LINE_ALPHA`. The paper is the whole
 * device: it is what marks the hero now that the fill is every other card's, and it is why the
 * dashboard's hero is also asserted to be the only element on that screen painting a grid.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * Three controls, each injecting the exact thing the check exists to catch:
 *
 * 1. A second `.surface-brand` element, which must break the count AND the only-grid claim.
 * 2. The old M129 wash, re-injected with `addStyleTag` at a higher precedence, which must break
 *    the paint claim on the real hero.
 * 3. A `shadow-md` probe beside the `shadow-sm` probe, so "the hero rests at shadow-sm" is a
 *    comparison between two different values rather than a string that happens to match.
 */
import { expect, test, type Page } from '@playwright/test';

import { GRID_LINE_ALPHA } from '../design-contract';
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
 * Whether a computed `background-image` is graph paper: two linear layers, one of them running
 * to the right.
 *
 * `to bottom` IS NOT IN THE COMPUTED STRING. It is the default direction, so a browser drops it
 * on the way out and serialises the vertical layer as `linear-gradient(rgba(...) 1px, ...)`. The
 * first version of this reader looked for both keywords and reported zero grids on a page that
 * was visibly drawing one, which is why the layer COUNT carries the second half of the claim.
 *
 * @param image - a computed `background-image`, or `none`.
 * @returns true when the value is the two-layer grid.
 */
function paintsGraphPaper(image: string): boolean {
  const layers = image.split('linear-gradient(').length - 1;
  return layers === 2 && image.includes('linear-gradient(to right,');
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

test('the hero paints graph paper on the border token, and rests at shadow-sm', async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);

  const smallShadow = await probeShadow(page, 'shadow-sm');
  const mediumShadow = await probeShadow(page, 'shadow-md');
  expect(smallShadow, 'the shadow-sm probe must paint something, or the comparison is vacuous').not.toBe('none');
  expect(mediumShadow, 'the two shadow steps must differ, or the claim below proves nothing').not.toBe(smallShadow);

  const borderLine = atAlpha(await tokenColour(page, '--border'), GRID_LINE_ALPHA);
  const brandLine = atAlpha(await tokenColour(page, '--primary'), GRID_LINE_ALPHA);
  expect(borderLine, 'the two tokens must resolve differently, or the colour claim is vacuous').not.toBe(brandLine);

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

  const borderLine = atAlpha(await tokenColour(page, '--border'), GRID_LINE_ALPHA);
  const before = await heroPaint(page);
  expect(before.backgroundImage, 'the hero starts on the border token').toContain(borderLine);

  await page.addStyleTag({ content: `.surface-brand { background-image: ${OLD_WASH_CSS} !important; }` });

  const after = await heroPaint(page);
  expect(after.backgroundImage, 'CONTROL: the re-injected wash must be what the reader now sees').toContain('140deg');
  expect(after.backgroundImage, 'CONTROL: and the border-token claim must go red').not.toContain(borderLine);
  expect(paintsGraphPaper(after.backgroundImage), 'CONTROL: a wash is not graph paper').toBe(false);
  expect(await gridElementCount(page), 'CONTROL: the screen now paints no graph paper at all').toBe(0);

  // The predicate itself, against the two values it exists to tell apart, so a reader that
  // answered false to everything could not have passed the line above.
  expect(paintsGraphPaper(before.backgroundImage), 'CONTROL: the real hero is graph paper').toBe(true);
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
