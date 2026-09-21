/**
 * The shell after the Scan button stopped glowing (M243 spec 03a).
 *
 * THE GLOW WENT, THE GEOMETRY DID NOT. The raised circle was the one piece of chrome in this app
 * that painted light in the brand colour: `shadow-lg shadow-primary/40` when active, `shadow-md
 * shadow-primary/20` at rest. Nothing else rests heavier than `shadow-sm`, and lowcarbcheck rests
 * nothing heavier than that anywhere. So the halo is gone and the circle is not.
 *
 * WHY THE CIRCLE STAYS EXACTLY WHERE IT WAS. Three documented clearances are measured off this
 * box: the bottom bar's own `h-14`, `app-wrapper`'s `6rem` of bottom page padding, and
 * `/add/photo`'s sticky action bar. A shadow does not take part in layout, so removing one must
 * move nothing, and
 * "must move nothing" is a claim worth holding: all four values of the circle's rect are frozen
 * below, and the header and the bottom bar are re-measured beside them.
 *
 * ── THE NO-GLOW READER IS SHOWN ABLE TO SAY YES ──
 * "There is no coloured shadow" is the kind of claim that passes when the reader is pointed at the
 * wrong element, at an element with no shadow at all, or at a colour notation it cannot parse. So
 * the reader is FAIL-CLOSED: a value it cannot split into `rgb` layers is `null`, and `null` fails
 * the run. It is then pointed at the old teal glow, which it must flag, at a plain black shadow,
 * which it must not, and at both of those as a REAL BROWSER serialises them.
 *
 * THE RING IS NOT A GLOW. `ring-4 ring-background` is drawn as a `box-shadow` layer too, in the
 * page background colour, and it is geometry: it is what keeps the circle legible where it
 * overlaps the bar. A layer with no offset and no blur is that ring, and it is judged separately,
 * which is why this reader splits layers instead of grepping the string for a colour.
 */
import { expect, test, type Page } from '@playwright/test';

import { BOTTOM_BAR_HEIGHT_PX } from '../design-contract';
import { completeOnboarding, HEADER_HEIGHT, PHONE_WIDTH } from './helpers';

/**
 * The raised circle's box, frozen, read off the production build at the 390 px design width:
 * `h-12 w-12`, centred in the middle of the bar's three slots, raised by `-mt-5` so it stands
 * 17.5 px above the bar's own top edge.
 */
const LAUNCHER_RECT = { x: 171, y: 769.5, width: 48, height: 48 } as const;

/**
 * The old glow and a plain one, in AUTHOR form, which is what an element is styled with. The
 * reader below reads COMPUTED form, where the colour comes first and every length is in px, so
 * these two are only ever injected and read back, never handed to the reader directly.
 */
const TEAL_SHADOW_CSS = '0 8px 24px 0 rgba(20, 184, 166, 0.4)';
const NEUTRAL_SHADOW_CSS = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';

/** The same two in computed form, for the pure half of the control. */
const TEAL_SHADOW_COMPUTED = 'rgba(20, 184, 166, 0.4) 0px 8px 24px 0px';
const NEUTRAL_SHADOW_COMPUTED = 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px';

/** A `ring-4` as the browser serialises it: a colour, no offset, no blur, a spread. */
const RING_COMPUTED = 'rgb(241, 247, 248) 0px 0px 0px 4px';

/** One layer of a computed `box-shadow`. */
interface ShadowLayer {
  /** Red, green and blue, 0 to 255. */
  rgb: readonly [number, number, number];
  /** 0 when the layer paints nothing. */
  alpha: number;
  /** Offset x, offset y, blur, spread, in px, in that order. */
  lengths: readonly number[];
}

/**
 * A computed `box-shadow` split into its layers, or `null` when it cannot be read.
 *
 * WHY IT CAN RETURN NULL. A reader that quietly returns "no colour found" for a notation it does
 * not understand would pass the moment somebody writes the glow in `oklch`. `null` is the
 * fail-closed answer, and the caller treats it as a failure.
 *
 * Chromium serialises a layer as `rgba(r, g, b, a) Xpx Ypx Bpx Spx`, and the only commas in the
 * whole string are inside those parentheses, which is what makes the split below safe.
 *
 * @param boxShadow - a computed `box-shadow` value.
 * @returns the layers, or null when some part of the value is not an `rgb`/`rgba` layer.
 */
export function parseShadowLayers(boxShadow: string): ShadowLayer[] | null {
  if (boxShadow === 'none' || boxShadow.trim() === '') return [];
  const layers: ShadowLayer[] = [];
  let consumed = 0;
  for (const match of boxShadow.matchAll(/rgba?\(([^)]*)\)((?:\s+-?[\d.]+px)*)/gu)) {
    consumed += match[0].length;
    const channels = (match[1] ?? '')
      .split(/[,/\s]+/u)
      .filter((part) => part !== '')
      .map((part) => Number.parseFloat(part));
    const [red, green, blue, alpha] = channels;
    if (red === undefined || green === undefined || blue === undefined) return null;
    if ([red, green, blue].some((value) => Number.isNaN(value))) return null;
    const lengths = (match[2] ?? '')
      .trim()
      .split(/\s+/u)
      .filter((part) => part !== '')
      .map((part) => Number.parseFloat(part));
    layers.push({ rgb: [red, green, blue], alpha: alpha ?? 1, lengths });
  }
  // Everything that was not a layer must be separators and whitespace. A leftover word is a
  // notation this reader does not know, and it is not allowed to pass as "no colour".
  const leftover = boxShadow.replace(/rgba?\([^)]*\)((?:\s+-?[\d.]+px)*)/gu, '').replace(/[\s,]/gu, '');
  if (leftover !== '' || consumed === 0) return null;
  return layers;
}

/** A layer with no offset, no blur and a positive spread is the `ring-4`, not a shadow. */
export function isRingLayer(layer: ShadowLayer): boolean {
  const [x = 0, y = 0, blur = 0, spread = 0] = layer.lengths;
  return x === 0 && y === 0 && blur === 0 && spread > 0;
}

/** A grey has three equal channels. Everything else is a colour. */
export function isNeutral(layer: ShadowLayer): boolean {
  const [red, green, blue] = layer.rgb;
  return red === green && green === blue;
}

/**
 * The red, green and blue of a computed colour, or null when it is not an `rgb`/`rgba`.
 *
 * @param colour - a computed colour value.
 * @returns the three channels.
 */
export function rgbOf(colour: string): [number, number, number] | null {
  const layers = parseShadowLayers(`${colour} 0px 0px 0px 0px`);
  const first = layers?.[0];
  return first === undefined ? null : [first.rgb[0], first.rgb[1], first.rgb[2]];
}

/**
 * How many painted, non-ring layers of a shadow are not grey. `-1` when the value cannot be read,
 * so an unreadable shadow can never be mistaken for a clean one.
 *
 * @param boxShadow - a computed `box-shadow` value.
 * @returns the count of coloured shadow layers, or -1.
 */
export function colouredShadowsIn(boxShadow: string): number {
  const layers = parseShadowLayers(boxShadow);
  if (layers === null) return -1;
  return layers.filter((layer) => layer.alpha > 0 && !isRingLayer(layer) && !isNeutral(layer)).length;
}

/**
 * The raised launcher's circle: the first `span` inside the bottom bar's one button that is not
 * the chevron. It carries no slot of its own, and giving it one would be a source change this
 * spec's own subject does not need.
 *
 * @param page - the page to read.
 * @returns the circle's locator.
 */
function launcherCircle(page: Page) {
  return page
    .locator('nav.fixed button:not([aria-haspopup="dialog"])')
    .first()
    .locator('span')
    .first();
}

test('the raised Scan button keeps its box and loses its teal glow', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/diary');

  const circle = launcherCircle(page);
  await expect(circle, 'the raised circle must be drawn').toBeVisible();

  // ALL FOUR VALUES, frozen. A shadow takes no part in layout, so this is the claim that the
  // removal was a paint change and nothing else.
  const rect = await circle.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  expect(rect, 'the circle must not have moved or resized').toEqual(LAUNCHER_RECT);

  // The two chrome heights the clearances are measured against, on the same page.
  const header = await page.locator('header.sticky').first().boundingBox();
  expect(Math.round(header?.height ?? 0), 'the header must still be 64 px').toBe(HEADER_HEIGHT);
  const bar = await page.locator('nav.fixed').first().boundingBox();
  expect(Math.round(bar?.height ?? 0), 'the bottom bar must still be 57 px').toBe(BOTTOM_BAR_HEIGHT_PX);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page must still fit the phone').toBe(
    PHONE_WIDTH,
  );

  // NO TEAL LIGHT. The circle paints three kinds of layer and they are judged apart: the `ring-4`,
  // which is geometry and keeps the circle legible against whatever is behind the bar; the resting
  // shadow, which must be grey; and the empty layers Tailwind leaves at zero alpha.
  const painted = await circle.evaluate((node) => {
    const style = getComputedStyle(node);
    return { shadow: style.boxShadow, fill: style.backgroundColor };
  });
  const layers = parseShadowLayers(painted.shadow);
  expect(layers, `the shadow could not be read, which counts as a failure: ${painted.shadow}`).not.toBeNull();
  const visible = (layers ?? []).filter((layer) => layer.alpha > 0);

  const rings = visible.filter(isRingLayer);
  expect(rings.length, `the ring-4 must still be drawn: ${painted.shadow}`).toBe(1);

  const shadows = visible.filter((layer) => !isRingLayer(layer));
  // NOT "no shadow": the circle is a raised control and it rests on one.
  expect(shadows.length, `the circle must still rest on a shadow: ${painted.shadow}`).toBeGreaterThan(0);
  expect(
    shadows.filter((layer) => !isNeutral(layer)).map((layer) => layer.rgb.join()),
    `a shadow under the raised circle is not grey: ${painted.shadow}`,
  ).toEqual([]);

  // AND NOTHING AT ALL IS THE BRAND COLOUR. The circle's own fill IS the brand colour, so it is
  // the comparison value, which means this claim cannot go stale when the teal is retuned.
  expect(isNeutral({ rgb: rgbOf(painted.fill) ?? [0, 0, 0], alpha: 1, lengths: [] }), 'the fill must be the teal').toBe(
    false,
  );
  const brand = rgbOf(painted.fill)?.join();
  expect(
    visible.filter((layer) => layer.rgb.join() === brand).length,
    `a layer paints the brand colour: ${painted.shadow}`,
  ).toBe(0);
});

test('CONTROL: the shadow reader flags the old glow and passes a neutral one', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/diary');

  // The pure reader, on the values it exists to tell apart.
  expect(colouredShadowsIn(TEAL_SHADOW_COMPUTED), 'the old teal glow must be flagged').toBe(1);
  expect(colouredShadowsIn(NEUTRAL_SHADOW_COMPUTED), 'a plain black shadow must not be').toBe(0);
  expect(colouredShadowsIn('none'), 'no shadow is not a coloured shadow').toBe(0);
  // A ring is a layer with a colour and no blur, and it is NOT a glow: the real circle wears one.
  expect(colouredShadowsIn(RING_COMPUTED), 'a ring is not a shadow').toBe(0);
  // And the two together, which is what the circle really paints: the ring passes, the glow does not.
  expect(colouredShadowsIn(`${RING_COMPUTED}, ${TEAL_SHADOW_COMPUTED}`), 'a glow behind a ring is found').toBe(1);
  // Fail-closed: a notation the reader cannot parse is null, which the caller treats as a failure.
  expect(parseShadowLayers('0 8px 24px oklch(0.7 0.15 180)'), 'an unparsed colour must not read as clean').toBeNull();
  expect(parseShadowLayers('0 8px 24px red'), 'a named colour must not read as clean').toBeNull();

  // AND THE SAME ROUND TRIP THROUGH A REAL BROWSER, so the claim is not about a string this test
  // wrote: the browser's own serialisation of both shadows is read back off injected elements.
  const readings = await page.evaluate(
    (shadows) => {
      const read: Record<string, string> = {};
      for (const [name, shadow] of Object.entries(shadows)) {
        const probe = document.createElement('div');
        probe.style.cssText = `position:fixed;top:0;left:0;width:20px;height:20px;box-shadow:${shadow}`;
        document.body.append(probe);
        read[name] = getComputedStyle(probe).boxShadow;
        probe.remove();
      }
      return read;
    },
    { teal: TEAL_SHADOW_CSS, neutral: NEUTRAL_SHADOW_CSS },
  );
  expect(colouredShadowsIn(readings.teal ?? ''), `the browser's teal: ${readings.teal}`).toBe(1);
  expect(colouredShadowsIn(readings.neutral ?? ''), `the browser's neutral: ${readings.neutral}`).toBe(0);
});
