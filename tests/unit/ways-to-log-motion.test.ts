/**
 * Every ways-to-log drawing is complete BEFORE anything moves.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The usual reduced-motion shape is opt-out: animate by default, then switch
 * it off under `prefers-reduced-motion: reduce`. This app deliberately uses the
 * inverse (`app/app.css`, the "Waiting vocabulary" block): the base rules carry
 * no animation at all, and motion is ADDED under `no-preference`. The comment
 * there says why, and it applies with more force here: three onboarding icons
 * that only make sense while they move would leave a person who asked for less
 * motion looking at three shapes with no meaning.
 *
 * So the rule this file enforces is narrow and mechanical: no `wtl-` selector
 * outside the `no-preference` block may declare an animation, and the drawings
 * must not carry SMIL, which no media query can turn off.
 *
 * ── What is READ ─────────────────────────────────────────────────────────
 *
 * Both files, as text. There is no browser here and no CSSOM, so the media
 * query cannot be evaluated; what can be checked is that the animations are
 * declared in exactly one place and that place is the opt-in block.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { WAY_TO_LOG_IDS } from '../../app/lib/ways-to-log';

const APP_CSS = readFileSync(fileURLToPath(new URL('../../app/app.css', import.meta.url)), 'utf8');
const GLYPHS = readFileSync(
  fileURLToPath(new URL('../../app/components/onboarding/ways-to-log-animation.tsx', import.meta.url)),
  'utf8',
);

/**
 * The body of the `no-preference` block that carries the ways-to-log rules,
 * found by brace matching from the block's own opening.
 */
function noPreferenceBlock(): string {
  const marker = APP_CSS.indexOf('Ways-to-log animations');
  assert.notEqual(marker, -1, 'the ways-to-log CSS section is gone');
  const open = APP_CSS.indexOf('@media (prefers-reduced-motion: no-preference) {', marker);
  assert.notEqual(open, -1, 'the ways-to-log rules are no longer inside a no-preference block');
  let depth = 0;
  for (let index = APP_CSS.indexOf('{', open); index < APP_CSS.length; index += 1) {
    const char = APP_CSS[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return APP_CSS.slice(open, index + 1);
    }
  }
  throw new Error('the no-preference block is unbalanced');
}

/** Every `animation`/`animation-delay` declaration that sits outside any media query. */
function animatedWtlRulesOutsideOptIn(): string[] {
  const optIn = noPreferenceBlock();
  const rest = APP_CSS.replace(optIn, '');
  // Rule blocks whose selector mentions a wtl- class, anywhere else in the file.
  const blocks = rest.match(/[^{}]*\.wtl-[^{}]*\{[^{}]*\}/g) ?? [];
  return blocks.filter((block) => /(^|[\s;{])animation\s*:/.test(block) || /animation-delay\s*:/.test(block));
}

describe('motion is opt-in, exactly as the house pattern already is', () => {
  it('declares every ways-to-log animation inside the no-preference block', () => {
    const block = noPreferenceBlock();
    for (const selector of ['.wtl-focus', '.wtl-flash', '.wtl-scanline', '.wtl-row']) {
      assert.match(block, new RegExp(`\\${selector}\\s*\\{`), `${selector} lost its opt-in animation`);
    }
  });

  it('declares none of them anywhere else, so nothing animates by default', () => {
    assert.deepEqual(
      animatedWtlRulesOutsideOptIn(),
      [],
      'a wtl- rule animates outside the no-preference block. That is the opt-OUT shape this app rejected; see the comment above the waiting vocabulary in app.css.',
    );
  });

  it('keeps the base rules to layout only, so the static frame is the drawing as written', () => {
    const marker = APP_CSS.indexOf('Ways-to-log animations');
    // Up to the first keyframe: the plain rules, which are what a browser
    // applies when the person asked for less motion. The keyframes below them
    // are inert until the opt-in block references one.
    const base = APP_CSS.slice(marker, APP_CSS.indexOf('@keyframes', marker));
    assert.match(
      base,
      /transform-box: fill-box;/,
      'the transform origin setup vanished, so scaling would move the glyph off centre',
    );
    assert.doesNotMatch(
      base,
      /opacity\s*:/,
      'a base rule now hides part of a drawing, so the reduced-motion frame is incomplete',
    );
  });
});

describe('each keyframe returns to the frame it started on', () => {
  const KEYFRAMES = ['wtl-shutter', 'wtl-focus', 'wtl-scan'];

  for (const name of KEYFRAMES) {
    it(`${name} declares both 0% and 100%, so the loop cannot drift off the static frame`, () => {
      const start = APP_CSS.indexOf(`@keyframes ${name} {`);
      assert.notEqual(start, -1, `@keyframes ${name} is gone`);
      const body = APP_CSS.slice(start, APP_CSS.indexOf('\n}', start));
      assert.match(body, /(^|[\s,])0%/m, `${name} has no 0% stop`);
      assert.match(body, /(^|[\s,])100%/m, `${name} has no 100% stop`);
    });
  }
});

describe('the drawings themselves', () => {
  it('has one glyph per way, so no card renders an empty box', () => {
    for (const id of WAY_TO_LOG_IDS) {
      const component = `${id.charAt(0).toUpperCase()}${id.slice(1)}Glyph`;
      assert.match(GLYPHS, new RegExp(`function ${component}\\(`), `the ${id} card lost its drawing`);
    }
  });

  it('carries no SMIL, which no media query can switch off', () => {
    assert.doesNotMatch(
      GLYPHS,
      /<animate|<animateTransform|<animateMotion|<set\s/,
      'the glyphs now animate themselves in SVG, ignoring reduced motion entirely',
    );
  });

  it('pulls in no animation runtime', () => {
    assert.doesNotMatch(
      GLYPHS,
      /from '(framer-motion|motion|@react-spring|gsap|lottie|react-lottie)/,
      'an animation dependency arrived for three icons',
    );
  });

  it('is inline SVG rather than an image the reduced-motion switch cannot reach', () => {
    assert.match(GLYPHS, /<svg\b/, 'the glyphs are no longer inline SVG');
    assert.doesNotMatch(GLYPHS, /\.gif|\.webp|<img\b/, 'an animated image cannot be stilled by a media query');
  });
});
