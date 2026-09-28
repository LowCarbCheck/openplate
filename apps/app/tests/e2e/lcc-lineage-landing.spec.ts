/**
 * The landing fold: graph paper behind it, one thin wordmark on it, and it fits the phone (M243 spec 06).
 *
 * WHAT THE SPEC ASKED FOR, and why each claim is read the way it is:
 *
 * ── THE GRID IS READ AS PAINT, IN BOTH THEMES ──
 * `.surface-grid` is a class, and a class is not a picture. The hero's computed `background-image`
 * is read instead, and it has to be the two-layer graph paper drawn in the `--border` token at
 * `GRID_LINE_ALPHA`, which is the same recipe the app's own hero panel draws. Both themes are
 * walked because the token changes and the alpha does not: a grid that vanished in the dark theme
 * would pass a one-theme check and ship invisible. `to bottom` IS NOT IN THE COMPUTED STRING, so
 * the second layer is counted rather than named (see `lcc-lineage-hero.spec.ts`, which learned it
 * the hard way and whose predicate this file repeats deliberately: two readers of the same shape
 * in two specs is cheaper than one import that makes either spec unreadable on its own).
 *
 * ── THE WORDMARK IS THE ONE THIN HEADING, AND `/diary` IS THE CONTROL ──
 * `<Wordmark/>` owns the brand role and sets it at weight 100 (2026-09-21, it was Fraunces
 * before), so the landing's `h1` must compute Victor Mono at weight 100. That claim is worth
 * nothing on its own: a check that read "the page has a thin heading" would pass a build where
 * every heading went thin. So the same reader is pointed at `/diary`'s page title, which must NOT
 * be. A COMPUTED `font-weight` is the declared weight and not the painted one
 * (`lcc-lineage-font.spec.ts` reads the painted face over CDP and is where that claim lives);
 * what is under test here is which ROLE each heading asks for, which is what the declared style
 * says.
 *
 * ── THE PAGE FITS ──
 * `documentElement.scrollWidth` at 390. This is also the regression guard for the hero call to
 * action, which was `whitespace-nowrap` and 376 px wide against 288 px of room at 320 px, so the
 * clip wrapper above it was hiding the last two words of the page's one offer. The narrow width
 * is walked too, because 390 never showed it.
 *
 * ── A CAPTION OVER A GRID LINE ──
 * The paper's whole risk is that it runs under the smallest grey text on the page. The hero's
 * tick line is `text-xs text-muted-foreground`, and a grid line is the `--border` token at
 * `GRID_LINE_ALPHA` composited over the page background, so the WORST pixel that text sits on is
 * computable rather than guessable. The contrast ratio is WCAG 2.1's own formula, and the floor
 * is AA for normal text. Both themes again, since both the ink and the line move with the theme.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * The wordmark claim has `/diary` as its control. The grid claim has a control that strips the
 * background image off the hero and requires the reader to report no paper. The contrast helper
 * is checked against two colours whose ratio is known (black on white is 21, white on white is 1),
 * so a helper that returned a constant cannot pass.
 */
import { expect, test, type Page } from '@playwright/test';

import { GRID_LINE_ALPHA, VICTOR_MONO, WORDMARK_WEIGHT, familyStartsWith } from '../design-contract';
import { completeOnboarding } from './helpers';

/** The design width, and the narrowest the app promises to fit. */
const DESIGN_WIDTH = 390;
const NARROW_WIDTH = 320;
const PHONE_HEIGHT = 844;

/** The two themes. The tokens move, the recipe does not. */
const SCHEMES = ['light', 'dark'] as const;

/** The element the grid is drawn on: the hero section of the landing page. */
const HERO_SELECTOR = 'main .surface-grid';

/** WCAG 2.1 AA for normal text. The hero's tick line is 12 px, which is normal text. */
const AA_NORMAL_TEXT = 4.5;

/** One colour, as three channels the contrast formula can work on. */
interface Channels {
  r: number;
  g: number;
  b: number;
}

/**
 * The three channels out of any `rgb()` or `rgba()` string the browser produced.
 *
 * @param value - a computed colour.
 * @returns its channels.
 */
function channelsOf(value: string): Channels {
  const parts = value.match(/[\d.]+/gu);
  if (parts === null || parts.length < 3) throw new Error(`not a colour: ${value}`);
  return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]) };
}

/**
 * WCAG 2.1's linearisation of one 0-to-255 channel.
 *
 * @param value - the channel as the browser reports it.
 * @returns the linear value, 0 to 1.
 */
function linearise(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.040_45 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 2.1's relative luminance.
 *
 * @param colour - the channels, 0 to 255.
 * @returns the luminance, 0 to 1.
 */
function luminance({ r, g, b }: Channels): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * WCAG 2.1's contrast ratio between two opaque colours.
 *
 * @param pair - the ink and the paper it sits on.
 * @returns the ratio, 1 to 21.
 */
function contrastRatio(pair: { ink: Channels; paper: Channels }): number {
  const a = luminance(pair.ink);
  const b = luminance(pair.paper);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * One colour laid over another at an alpha, which is what a grid line is.
 *
 * @param layers - the line, the page under it, and how opaque the line is.
 * @returns the channels a screen actually shows.
 */
function composite(layers: { over: Channels; under: Channels; alpha: number }): Channels {
  const mix = (top: number, bottom: number): number => Math.round(top * layers.alpha + bottom * (1 - layers.alpha));
  return {
    r: mix(layers.over.r, layers.under.r),
    g: mix(layers.over.g, layers.under.g),
    b: mix(layers.over.b, layers.under.b),
  };
}

/**
 * A theme token resolved to the `rgb(r, g, b)` the browser paints it as.
 *
 * READ FROM THE PAGE, never retyped: the tokens are themed, so a literal here would pin one
 * theme and pass vacuously in the other.
 *
 * @param page - a loaded page.
 * @param token - the custom property name, with its leading dashes.
 * @returns the computed colour.
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
 * Whether a computed `background-image` is the two-layer graph paper.
 *
 * `to bottom` is the default direction and the browser drops it on the way out, so the vertical
 * layer serialises with no keyword at all. The layer COUNT carries the second half of the claim.
 *
 * @param image - a computed `background-image`, or `none`.
 * @returns true when the value is graph paper.
 */
function paintsGraphPaper(image: string): boolean {
  const layers = image.split('linear-gradient(').length - 1;
  return layers === 2 && image.includes('linear-gradient(to right,');
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

/**
 * Puts the page in one theme and loads the landing page at one width.
 *
 * @param page - the page to drive.
 * @param options - the theme and the width to load in.
 */
async function openLanding(page: Page, options: { scheme: (typeof SCHEMES)[number]; width: number }): Promise<void> {
  await page.emulateMedia({ colorScheme: options.scheme });
  await page.setViewportSize({ width: options.width, height: PHONE_HEIGHT });
  await page.goto('/');
  await expect(page.locator(HERO_SELECTOR).first(), 'the landing hero must render').toBeVisible();
  // The theme script toggles a class on `<html>` from the media query, so a read taken before it
  // runs would measure the light tokens in a dark walk.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')), {
      message: `${options.scheme}: the document must be painting that theme`,
    })
    .toBe(options.scheme === 'dark');
}

test('CONTROL: the contrast helper answers 21 for black on white and 1 for white on white', () => {
  const white: Channels = { r: 255, g: 255, b: 255 };
  const black: Channels = { r: 0, g: 0, b: 0 };
  expect(Math.round(contrastRatio({ ink: black, paper: white })), 'black on white is the maximum').toBe(21);
  expect(contrastRatio({ ink: white, paper: white }), 'and a colour on itself is the minimum').toBeCloseTo(1, 5);
  // And the compositor really mixes: a black line at 70 percent over white is dark grey, not white.
  expect(composite({ over: black, under: white, alpha: GRID_LINE_ALPHA }).r).toBe(77);
});

for (const scheme of SCHEMES) {
  test(`the landing hero paints graph paper in the ${scheme} theme`, async ({ page }) => {
    await openLanding(page, { scheme, width: DESIGN_WIDTH });

    const border = await tokenColour(page, '--border');
    const image = await page
      .locator(HERO_SELECTOR)
      .first()
      .evaluate((node) => globalThis.getComputedStyle(node).backgroundImage);

    expect(paintsGraphPaper(image), `${scheme}: the hero must paint graph paper, and paints ${image}`).toBe(true);
    expect(image, `${scheme}: both layers are drawn in the border token`).toContain(
      atAlpha(border, GRID_LINE_ALPHA),
    );

    // CONTROL: take the image away and the same reader must say so, or "paints graph paper" is a
    // sentence this check would answer the same way on a blank page.
    await page.locator(HERO_SELECTOR).first().evaluate((node) => {
      node.style.backgroundImage = 'none';
    });
    const stripped = await page
      .locator(HERO_SELECTOR)
      .first()
      .evaluate((node) => globalThis.getComputedStyle(node).backgroundImage);
    expect(paintsGraphPaper(stripped), 'CONTROL: a hero with no image must not read as graph paper').toBe(false);
  });

  test(`the hero's tick line clears AA over a grid line in the ${scheme} theme`, async ({ page }) => {
    await openLanding(page, { scheme, width: DESIGN_WIDTH });

    // The smallest grey text in the fold. Found by its role in the layout, never by its words,
    // which are wordsmith's and change without telling this file.
    const caption = page.locator(`${HERO_SELECTOR} p.text-xs`).first();
    await expect(caption, 'the hero must carry a muted caption').toBeVisible();

    const ink = channelsOf(await caption.evaluate((node) => globalThis.getComputedStyle(node).color));
    const line = channelsOf(await tokenColour(page, '--border'));
    const page_ = channelsOf(await tokenColour(page, '--background'));
    const worstPixel = composite({ over: line, under: page_, alpha: GRID_LINE_ALPHA });
    const ratio = contrastRatio({ ink, paper: worstPixel });

    // Named in the message, so a failure says how far short it fell rather than just "false".
    expect(
      ratio,
      `${scheme}: the tick line is ${ratio.toFixed(2)}:1 over a grid line, which is under AA`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
}

/** The two computed properties the wordmark is told apart by, as a heading reports them. */
interface ComputedFace {
  family: string;
  weight: string;
}

/** Runs inside the page: what `node` computes for its family and its weight. */
function readComputedFace(node: Element): ComputedFace {
  const style = globalThis.getComputedStyle(node);
  return { family: style.fontFamily, weight: style.fontWeight };
}

test('the landing wordmark is thin, and a page title is not', async ({ page }) => {
  await openLanding(page, { scheme: 'light', width: DESIGN_WIDTH });

  const heading = page.locator('main h1').first();
  await expect(heading, 'the landing must have a heading').toBeVisible();
  const landing = await heading.evaluate(readComputedFace);
  expect(landing.weight, `the landing wordmark must be weight ${WORDMARK_WEIGHT}, and is ${landing.weight}`).toBe(
    WORDMARK_WEIGHT,
  );
  expect(landing.family, `the landing wordmark must be ${VICTOR_MONO}, and is ${landing.family}`).toMatch(
    familyStartsWith(VICTOR_MONO),
  );

  // CONTROL: the same reader, on the app's own page title, must answer the other way. Without
  // this the claim would pass a build in which every heading went thin.
  await completeOnboarding(page);
  await page.goto('/diary');
  const appTitle = page.locator('header.sticky h1').first();
  await expect(appTitle, 'the diary must have a page title').toBeVisible();
  const app = await appTitle.evaluate(readComputedFace);
  expect(app.weight, `CONTROL: a page title must NOT be weight ${WORDMARK_WEIGHT}, and is ${app.weight}`).not.toBe(
    WORDMARK_WEIGHT,
  );
});

for (const width of [NARROW_WIDTH, DESIGN_WIDTH]) {
  test(`the landing fits a ${width} px phone`, async ({ page }) => {
    await openLanding(page, { scheme: 'light', width });

    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(measured.clientWidth, 'the viewport must be the width it was given').toBe(width);
    expect(measured.scrollWidth, 'the document must not scroll sideways').toBe(width);

    // THE CLIP WRAPPER IS NOT ALLOWED TO BE DOING THE WORK. `overflow-x-clip` guards a
    // decorative overhang, and it was also hiding the tail of the page's one offer. Every
    // clipping box in the fold is read for content that runs past it, so a fix that merely moved
    // the overflow under the clip would fail here.
    const clipped = await page.evaluate(() => {
      const found: { what: string; over: number; text: string }[] = [];
      for (const node of document.querySelectorAll('.overflow-x-clip, .overflow-hidden')) {
        const over = node.scrollWidth - node.clientWidth;
        if (over < 2) continue;
        found.push({
          what: node.className.toString().slice(0, 60),
          over,
          text: (node.textContent ?? '').trim().replaceAll(/\s+/gu, ' ').slice(0, 60),
        });
      }
      return found;
    });
    expect(
      clipped.map((entry) => `${entry.what} hides ${entry.over}px of "${entry.text}"`),
      `at ${width} px: a clipping box on the landing is hiding content`,
    ).toEqual([]);

    // CONTROL: the same reader must see a box that really is hiding something.
    const control = await page.evaluate(() => {
      const box = document.createElement('div');
      box.className = 'overflow-hidden';
      box.style.cssText = 'width:40px;height:20px;white-space:nowrap';
      box.textContent = 'CONTROL a string far wider than forty pixels';
      document.body.append(box);
      return box.scrollWidth - box.clientWidth;
    });
    expect(control, 'CONTROL: a 40 px box holding a long line must report an overflow').toBeGreaterThan(2);
  });
}
