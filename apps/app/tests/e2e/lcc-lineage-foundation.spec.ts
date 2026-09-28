/**
 * The foundation of the lowcarbcheck restyle, read off a real page (M243 spec 01):
 * the whole app is drawn in Victor Mono, long-form prose stays in Inter, and the
 * chrome measures exactly what it measured in Inter.
 *
 * WHY A BROWSER AND NOT THE CLASS LIST. `tests/unit/lcc-lineage-foundation.test.ts`
 * proves the source says `font-body`. It cannot prove the page is drawn in Victor Mono: a
 * stylesheet that loses to a later rule, a face that never loads, or a wrapper that resets
 * the family all leave the source correct and the screen wrong.
 *
 * TWO READS, BECAUSE ONE OF THEM LIES. A computed `font-family` is only the DECLARED stack:
 * it says "Victor Mono, then Inter, then monospace" whether or not a single glyph was ever
 * drawn by Victor Mono. The devtools protocol's `CSS.getPlatformFontsForNode` reports the
 * faces that actually PAINTED a node, one entry per face with a glyph count, and whether
 * that face is a web font or a system one. The walk reads the declared stack on every
 * screen; the paint test reads the painted face on a German sentence, a Turkish string and a
 * capital sharp s. A reader that cannot fail is worse than none, so the same painted-face
 * reader is also pointed at text forced into `serif` and into Inter, and must say no.
 *
 * WHY THE CHROME BUDGET RIDES ALONG. Victor Mono is wider than Inter for a mixed-case
 * sentence (13 to 31 percent measured on German strings), and the header is a fixed 64 px,
 * the bottom bar a fixed 57 px, and the document exactly 390 px wide. Those three numbers
 * are asserted on every screen in both languages and both themes, because a face swap that
 * wrapped a title into a second line would break the header and pass every class-list test
 * there is.
 *
 * THE FONT READS POLL. A first visit registers the service worker and reloads once, so a
 * single read after `toBeVisible` can land on the frame before the reload.
 *
 * ── THE GLYPH PROBE, AND WHAT IT RECORDED (2026-09-20, production build) ──
 * Victor Mono is a code font and Turkish is a shipped locale, so a glyph it lacks would fall
 * back to another face in the middle of a line, which looks like a bug and passes every
 * other test. The record is frozen in `RECORDED_FACE`:
 *
 *   ı  İ  ş  ğ  ẞ   drawn by Victor Mono (its latin and latin-ext subsets)
 *   →                NOT drawn by Victor Mono, and NOT drawn by Inter either. U+2192 is in
 *                    none of the six subsets `@fontsource-variable/victor-mono` ships, and
 *                    in none of the seven `@fontsource-variable/inter` ships (both cmaps
 *                    were read with fontTools), so a stack that names Inter behind Victor
 *                    Mono still ends at the device's own monospace face for it. The weight
 *                    summary in the weekly recap uses this arrow in every language.
 *
 * `document.fonts.check` cannot see the second row: it answers true for a character no
 * face's `unicode-range` covers, because no face is waiting to load. Two reads tell instead.
 * The PAINTED-FACE read (devtools protocol) is the decider: it names the face that drew the
 * glyph and says whether that face is a web font, and it does not depend on which fonts the
 * host has installed. The WIDTH read is the corroboration the brief asked for, and it is
 * host-sensitive, so it is only used in two host-independent ways: a covered glyph measures
 * exactly like the reference glyph (it IS Victor Mono, whose advance is flat), and a gap
 * glyph measures exactly like the fallback alone. It runs over `serif` on purpose, and on
 * this host even that is a monospace face (the protocol reports `serif` painted by Cascadia
 * Code at 0.586 em, against Victor Mono's 0.6), so a width difference alone would be a
 * 1.4 px margin at 100 px type. That is why width does not classify anything.
 *
 * The record is a FROZEN SET, like the colour literals in `brand-colors.test.ts`: it fails
 * when a glyph moves in either direction. A `→` that starts drawing in Victor Mono or in
 * Inter is good news, and the test still goes red so the record is edited on purpose.
 */
import { expect, test, type Page } from '@playwright/test';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { BOTTOM_BAR_HEIGHT_PX, INTER, VICTOR_MONO, familyStartsWith } from '../design-contract';
import { completeOnboarding, expectPhoneLayout, useLanguage } from './helpers';

/** The two languages the spec names. German is the wide one, English the one the copy is written in. */
const LOCALES = ['de', 'en'] as const satisfies readonly LanguageCode[];

/** Both themes, because the face must not depend on one. */
const SCHEMES = ['dark', 'light'] as const;

/** Every primary screen the brief lists, each one a place the chrome could wrap. */
const ROUTES = ['/diary', '/dashboard', '/settings', '/trends', '/add/search', '/add/photo'] as const;

/** The public legal pages, each of which is prose and keeps the sans face. */
const LEGAL_ROUTES = ['/terms', '/privacy', '/imprint', '/withdrawal'] as const;

/** The computed family of the app's face. */
const MONO_FAMILY = familyStartsWith(VICTOR_MONO);

/** The computed family of the reading face. */
const SANS_FAMILY = familyStartsWith(INTER);

/**
 * The computed `font-family` of the first element matching `selector`.
 *
 * @param page - the page to read.
 * @param selector - a CSS selector for the element.
 * @returns the computed family stack, as the browser writes it.
 */
async function computedFamilyOf(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
}

/**
 * The height of the fixed bottom bar, or 0 when it is not drawn.
 *
 * @param page - the page to measure.
 * @returns the bar's height in CSS px.
 */
async function bottomBarHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector('[data-slot="bottom-nav-shell"] nav');
    return nav === null ? 0 : Math.round(nav.getBoundingClientRect().height);
  });
}

for (const locale of LOCALES) {
  for (const scheme of SCHEMES) {
    test(`every primary screen is drawn in Victor Mono inside the chrome budget, ${locale} ${scheme}`, async ({
      page,
    }) => {
      // The scheme is set BEFORE the first load: the theme script reads the media
      // query on the first paint, and `dark` is a class it toggles on <html>.
      await page.emulateMedia({ colorScheme: scheme });
      await completeOnboarding(page);
      await useLanguage(page, locale);

      for (const route of ROUTES) {
        await page.goto(route);
        const where = `${route} in ${locale} ${scheme}`;

        // NON-VACUITY: the run must really be in the theme and language it claims,
        // or a dark spec would quietly be a second light one.
        await expect(page.locator('html'), `${where}: the document language`).toHaveAttribute('lang', locale);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')), {
            message: `${where}: the theme class on <html>`,
          })
          .toBe(scheme === 'dark');

        await expect
          .poll(() => computedFamilyOf(page, 'body'), { message: `${where}: the body face` })
          .toMatch(MONO_FAMILY);

        // Ligatures are off on the body, so `->` and `<=` typed in a food name are
        // drawn as typed. The property is inherited, so one read on the body is the app.
        expect(
          await page.evaluate(() => getComputedStyle(document.body).fontVariantLigatures),
          `${where}: ligatures on the body`,
        ).toBe('none');

        // The chrome budget. `expectPhoneLayout` polls the document width and the
        // header height; the bottom bar is read the same way, because it is drawn
        // after the header on a first load.
        await expectPhoneLayout(page);
        await expect
          .poll(() => bottomBarHeight(page), { message: `${where}: the bottom bar height` })
          .toBe(BOTTOM_BAR_HEIGHT_PX);
      }
    });
  }
}

for (const locale of LOCALES) {
  test(`long-form reading stays in Inter on every legal page in ${locale}`, async ({ page }) => {
    await useLanguage(page, locale);

    for (const route of LEGAL_ROUTES) {
      await page.goto(route);
      await expect(page.locator('article p').first(), `${route}: the page has a paragraph`).toBeVisible();

      await expect
        .poll(() => computedFamilyOf(page, 'article p'), { message: `${route}: the paragraph face` })
        .toMatch(SANS_FAMILY);

      // CONTROL on the same page: the read above is not "everything is Inter". The
      // body around the article is still the app's face, so the two reads differ and
      // an article that lost `font-prose` would fail the first one.
      await expect
        .poll(() => computedFamilyOf(page, 'body'), { message: `${route}: the body face` })
        .toMatch(MONO_FAMILY);
    }
  });
}

test('CONTROL: the diary is not drawn in Inter, so the legal read can fail', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/diary');
  await expect(page.locator('main').first()).toBeVisible();

  // A long-form read that came back as Inter on the diary would mean the sans face
  // leaked out of `.prose`. It must be the mono face, and it must not be Inter.
  await expect.poll(() => computedFamilyOf(page, 'main')).toMatch(MONO_FAMILY);
  expect(await computedFamilyOf(page, 'main')).not.toMatch(SANS_FAMILY);
});

////////////////////////////////////////////////////////////////////////////////
// The painted face
////////////////////////////////////////////////////////////////////////////////

/** A German sentence with every umlaut and the sharp s. */
const GERMAN_SENTENCE = 'Größe für Fußgänger, Äpfel und Übung';

/** A Turkish string with both dotted and dotless i, the cedilla s and the soft g. */
const TURKISH_STRING = 'Işık, İstanbul, ağaç, şeker, ığşİ';

/** A capital sharp s, which lives in the latin-ext subset and not in latin. */
const CAPITAL_SHARP_S = 'STRAẞE, GROẞ';

/** Text the app's stack is expected to paint with something other than Victor Mono. */
const RIGHT_ARROW = '→';

/** One face the browser used to paint a node, as the devtools protocol reports it. */
interface PaintedFont {
  /** The face's family name as the platform reports it, which for a web font is its own name. */
  familyName: string;
  /** True for a web font (`@font-face`), false for a face the device supplied. */
  isCustomFont: boolean;
  /** How many glyphs of the node this face drew. */
  glyphCount: number;
}

/**
 * The faces that PAINTED `text`, read through the devtools protocol.
 *
 * The probe is a real element appended to the page's own body, so with no
 * `forcedFamily` it inherits exactly the stack the app gives its text, never a stack the
 * test invented. The control passes a family and gets that instead.
 *
 * @param page - a page on the production build.
 * @param text - the string to paint.
 * @param forcedFamily - a CSS `font-family` to force on the probe, or null to inherit.
 * @returns one entry per platform face used, with its glyph count.
 */
async function paintedFontsOf(
  page: Page,
  text: string,
  forcedFamily: string | null,
): Promise<PaintedFont[]> {
  const probeId = 'm243-painted-face-probe';
  await page.evaluate(
    ({ id, content, family }) => {
      document.getElementById(id)?.remove();
      const probe = document.createElement('p');
      probe.id = id;
      probe.textContent = content;
      probe.style.cssText = 'position:absolute;left:0;top:0;margin:0;font-size:24px;';
      if (family !== null) probe.style.fontFamily = family;
      document.body.append(probe);
      // FORCE LAYOUT. The protocol reads the faces off the laid-out text, so a probe
      // that has only been appended reports an empty list, which reads like "painted
      // by nothing" and would make the controls below pass for the wrong reason.
      probe.getBoundingClientRect();
    },
    { id: probeId, content: text, family: forcedFamily },
  );

  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${probeId}` });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts;
  } finally {
    await session.detach();
    await page.evaluate((id) => document.getElementById(id)?.remove(), probeId);
  }
}

/**
 * Whether Victor Mono, and nothing else, painted every glyph of a read.
 *
 * @param fonts - the faces a paint read returned.
 * @returns true only for a non-empty read whose every face is the Victor Mono web font.
 */
function isAllVictorMono(fonts: readonly PaintedFont[]): boolean {
  return fonts.length > 0 && fonts.every((font) => font.isCustomFont && /victor mono/iu.test(font.familyName));
}

test('the painted face is Victor Mono on German, Turkish and capital sharp s, and the reader can say no', async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.goto('/diary');
  await expect(page.locator('header').first()).toBeVisible();

  // THE FACE IS LOADED, not merely declared. `check` answers true for a face that is
  // loaded or that nothing waits on, so it is paired with a status read on the faces
  // themselves: at least one Victor Mono subset must be `loaded`.
  await expect
    .poll(() => page.evaluate((family) => document.fonts.check(`16px "${family}"`), VICTOR_MONO), {
      message: 'document.fonts.check for Victor Mono',
    })
    .toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(
          (family) => [...document.fonts].filter((face) => face.family.includes(family) && face.status === 'loaded').length,
          VICTOR_MONO,
        ),
      { message: 'the Victor Mono subsets that report loaded' },
    )
    .toBeGreaterThan(0);

  for (const [what, text] of [
    ['a German sentence', GERMAN_SENTENCE],
    ['a Turkish string', TURKISH_STRING],
    ['a capital sharp s', CAPITAL_SHARP_S],
  ] as const) {
    await expect
      .poll(async () => isAllVictorMono(await paintedFontsOf(page, text, null)), {
        message: `${what} must be painted by Victor Mono`,
      })
      .toBe(true);
  }

  // CONTROL 1: the same reader, pointed at text forced into `serif`, says no. A reader
  // that returned true for everything would pass the three reads above and prove nothing.
  const serifPaint = await paintedFontsOf(page, GERMAN_SENTENCE, 'serif');
  expect(serifPaint.length, 'the control must have been painted by something').toBeGreaterThan(0);
  expect(isAllVictorMono(serifPaint), 'a serif paragraph must not read as Victor Mono').toBe(false);

  // CONTROL 2: it also says no to another WEB font. Inter is custom, so a reader that
  // only checked `isCustomFont` would call it Victor Mono.
  const interPaint = await paintedFontsOf(page, GERMAN_SENTENCE, `"${INTER}"`);
  expect(interPaint.some((font) => font.isCustomFont), 'Inter is a web font, so the control is custom').toBe(true);
  expect(isAllVictorMono(interPaint), 'an Inter paragraph must not read as Victor Mono').toBe(false);
});

////////////////////////////////////////////////////////////////////////////////
// The glyph probe
////////////////////////////////////////////////////////////////////////////////

/** What drew a glyph: the app's face, or whatever the browser fell back to. */
type GlyphFace = 'victor-mono' | 'fallback';

/**
 * The frozen record of which face draws each glyph the shipped locales need, in a fixed order.
 * See the top of this file for how it was measured and why `→` is the recorded gap.
 */
const RECORDED_FACE: readonly (readonly [string, GlyphFace])[] = [
  ['ı', 'victor-mono'],
  ['İ', 'victor-mono'],
  ['ş', 'victor-mono'],
  ['ğ', 'victor-mono'],
  ['ẞ', 'victor-mono'],
  [RIGHT_ARROW, 'fallback'],
];

/** A known-covered glyph: any Latin letter, in a face whose advance is the same for every glyph. */
const REFERENCE_GLYPH = 'n';

/** How far a width may differ from the reference and still be the same face, in CSS px at 100 px type. */
const WIDTH_TOLERANCE_PX = 0.5;

/** What the page measured for one glyph. */
interface GlyphReading {
  glyph: string;
  /** `document.fonts.check` for Victor Mono over this glyph, after the load. True even for an uncovered glyph. */
  isCheckTrue: boolean;
  /** The glyph's width over the stack `"Victor Mono Variable", serif`. */
  width: number;
  /** The glyph's width in `serif` alone, which is what a fallback glyph measures. */
  fallbackWidth: number;
}

/**
 * The width of `text` drawn at 100 px in `family`, in CSS px.
 *
 * @param page - a page on the production build.
 * @param text - what to draw.
 * @param family - a CSS `font-family` value, fallbacks included.
 * @returns the drawn width.
 */
async function widthOf(page: Page, text: string, family: string): Promise<number> {
  return page.evaluate(
    ({ content, stack }) => {
      const span = document.createElement('span');
      span.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:400 100px ${stack}`;
      span.textContent = content;
      document.body.append(span);
      const width = span.getBoundingClientRect().width;
      span.remove();
      return width;
    },
    { content: text, stack: family },
  );
}

/**
 * Loads the subsets the probe glyphs fall in, so a face still downloading is not measured as a fallback.
 *
 * LOAD FIRST: a face still downloading measures as its fallback, which would read every glyph
 * as a gap. `load` fetches exactly the subsets these characters fall in.
 *
 * @param page - a page on the production build.
 * @param glyphs - the glyphs about to be measured, plus the reference.
 */
async function loadProbeFaces(page: Page, glyphs: string): Promise<void> {
  await page.evaluate(
    async ({ text, victor, inter }) => {
      await document.fonts.load(`400 100px "${victor}"`, text);
      await document.fonts.load(`400 100px "${inter}"`, text);
    },
    { text: glyphs, victor: VICTOR_MONO, inter: INTER },
  );
}

/**
 * Reads every probe glyph over a proportional fallback, at 100 px.
 *
 * @param page - a page on the production build, past its first-visit reload.
 * @param glyphs - the glyphs to probe.
 * @returns one reading per glyph.
 */
async function probeGlyphs(page: Page, glyphs: readonly string[]): Promise<GlyphReading[]> {
  const victorStack = `"${VICTOR_MONO}", serif`;
  const readings: GlyphReading[] = [];
  for (const glyph of glyphs) {
    readings.push({
      glyph,
      isCheckTrue: await page.evaluate(
        ({ family, text }) => document.fonts.check(`400 100px "${family}"`, text),
        { family: VICTOR_MONO, text: glyph },
      ),
      width: await widthOf(page, glyph, victorStack),
      fallbackWidth: await widthOf(page, glyph, 'serif'),
    });
  }
  return readings;
}

test('Victor Mono draws the Turkish and German glyphs, and the arrow is the recorded gap', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/terms');
  await expect(page.locator('h1').first()).toBeVisible();

  const glyphs = RECORDED_FACE.map(([glyph]) => glyph);
  await loadProbeFaces(page, glyphs.join('') + REFERENCE_GLYPH + 'ı');
  const readings = await probeGlyphs(page, glyphs);

  const victorStack = `"${VICTOR_MONO}", serif`;
  const interStack = `"${INTER}", serif`;
  const referenceWidth = await widthOf(page, REFERENCE_GLYPH, victorStack);

  // CONTROL 1: the reference is measurable and the advance is flat. Five reference
  // glyphs are exactly five times one, so a width IS a glyph count in this face and
  // "same width as the reference" means "same advance as Victor Mono".
  expect(referenceWidth, 'the reference glyph must have a width').toBeGreaterThan(0);
  expect(
    Math.abs((await widthOf(page, REFERENCE_GLYPH.repeat(5), victorStack)) - 5 * referenceWidth),
    'Victor Mono must be a flat-advance face for a width comparison to mean anything',
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX);

  // CONTROL 2: the width comparison can see a different face. In Inter, which is
  // proportional, the dotless i and the reference are two different widths.
  expect(
    Math.abs((await widthOf(page, 'ı', interStack)) - (await widthOf(page, REFERENCE_GLYPH, interStack))),
    'a proportional face must read a different width for a narrow glyph',
  ).toBeGreaterThan(WIDTH_TOLERANCE_PX);

  // THE RECORD, decided by the PAINTED face. Every glyph's face must equal the frozen set.
  const measured: (readonly [string, GlyphFace])[] = [];
  for (const glyph of glyphs) {
    const painted = await paintedFontsOf(page, glyph, null);
    measured.push([glyph, isAllVictorMono(painted) ? 'victor-mono' : 'fallback']);
  }
  expect(measured, 'a glyph moved between Victor Mono and the fallback: edit RECORDED_FACE on purpose').toEqual(
    RECORDED_FACE,
  );

  // A glyph recorded as covered must also have its face LOADED. This is the half of
  // `document.fonts.check` that means something, and it stops a not-yet-downloaded
  // face from being measured as a fallback.
  const notReady = readings.filter((reading) => !reading.isCheckTrue).map((reading) => reading.glyph);
  expect(notReady, 'a covered glyph was measured before its subset finished loading').toEqual([]);

  // THE WIDTH CORROBORATION, in the two host-independent ways. A covered glyph measures
  // like the reference, so it really was drawn at Victor Mono's flat advance. A gap glyph
  // measures like the fallback alone, so the browser really did hand it on.
  const gaps = RECORDED_FACE.filter(([, face]) => face === 'fallback').map(([glyph]) => glyph);
  expect(gaps.length, 'the record must name at least one gap for the fallback check to run').toBeGreaterThan(0);
  for (const reading of readings) {
    const isGap = gaps.includes(reading.glyph);
    const expected = isGap ? reading.fallbackWidth : referenceWidth;
    expect(
      Math.abs(reading.width - expected),
      `${reading.glyph} must measure as ${isGap ? 'the fallback alone' : 'the reference glyph'}`,
    ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX);
  }
});

test('the arrow is painted by a system face, not by Victor Mono and not by Inter', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/diary');
  await expect(page.locator('header').first()).toBeVisible();

  const painted = await paintedFontsOf(page, RIGHT_ARROW, null);
  expect(painted.length, 'the arrow must be painted by something').toBeGreaterThan(0);

  // A web font paints it only if a subset carries U+2192, which neither package does.
  // The day one does, this goes red and RECORDED_FACE above is edited with it.
  const webFonts = painted.filter((font) => font.isCustomFont).map((font) => font.familyName);
  expect(webFonts, 'no web font subset carries the right arrow, so the device must draw it').toEqual([]);
});
