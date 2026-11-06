/**
 * The mail palette is a COPY of the app's brand tokens, and a copy drifts.
 * Two guards, in the shape `apps/app/tests/unit/brand-colors.test.ts` uses:
 *
 * 1. MIRROR. Each palette constant that claims an app token equals that
 *    token's LIGHT-theme value in `apps/app/app/app.css`, converted from the
 *    HSL triple to hex. The app's own file is read, not a copy of it, so a
 *    palette change there fails here.
 * 2. FREEZE. Every colour literal under `src/mail/` is one of the palette's.
 *    A new colour typed into a letter fails instead of arriving unnoticed.
 *    The palette is hex, so the scan also refuses `rgb()` and `hsl()` calls,
 *    which a hex-only scan would let through.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as palette from '../../src/mail/mail-palette.js';

const APP_CSS = fileURLToPath(new URL('../../../app/app/app.css', import.meta.url));
const MAIL_DIR = fileURLToPath(new URL('../../src/mail', import.meta.url));
const PALETTE_FILE = 'mail-palette.ts';

const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/g;
const COLOUR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/g;

/** The body of the FIRST `:root { ... }` block, which is the light theme. */
function lightThemeBlock(css: string): string {
  const start = css.indexOf(':root {');
  assert.notEqual(start, -1, 'app.css has no :root block');
  const end = css.indexOf('}', start);
  assert.notEqual(end, -1, 'the :root block never closes');
  return css.slice(start, end);
}

/** `--name: H S% L%;` read from a block, as numbers. */
interface HslTriple {
  h: number;
  s: number;
  l: number;
}

function readHslToken(block: string, name: string): HslTriple {
  const match = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%\\s*;`).exec(block);
  if (match === null) throw new Error(`--${name} is not an HSL triple in the light :root block of app.css`);
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

function hslToHex(input: HslTriple): string {
  const s = input.s / 100;
  const l = input.l / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + input.h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** The palette constant that mirrors each app token. */
const MIRRORED = {
  background: palette.MAIL_PAGE_BACKGROUND,
  foreground: palette.MAIL_TEXT,
  primary: palette.MAIL_PRIMARY,
  'muted-foreground': palette.MAIL_MUTED_TEXT,
  border: palette.MAIL_BORDER,
} satisfies Record<string, string>;

for (const [token, constant] of Object.entries(MIRRORED)) {
  test(`the palette's ${token} equals the app's light --${token}`, () => {
    const block = lightThemeBlock(readFileSync(APP_CSS, 'utf8'));
    assert.equal(constant, hslToHex(readHslToken(block, token)));
  });
}

test('the mirror reads the light theme: the .dark block holds a different background', () => {
  // The control for the mirror: if both blocks agreed, reading the wrong one
  // would pass.
  const css = readFileSync(APP_CSS, 'utf8');
  const darkStart = css.indexOf('.dark {');
  assert.notEqual(darkStart, -1, 'expected a .dark block');
  const light = lightThemeBlock(css);
  const dark = css.slice(darkStart, css.indexOf('}', darkStart));
  assert.notEqual(hslToHex(readHslToken(light, 'background')), hslToHex(readHslToken(dark, 'background')));
});

/** Every file under `src/mail/` that can carry a colour, by path relative to it. */
function mailSourceFiles(): string[] {
  return readdirSync(MAIL_DIR, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts') || path.endsWith('.json'))
    .toSorted();
}

function colourLiteralsIn(file: string): string[] {
  const text = readFileSync(join(MAIL_DIR, file), 'utf8');
  return (text.match(HEX_LITERAL) ?? []).map((literal) => literal.toLowerCase());
}

test('every colour literal under src/mail is a palette value, and only the palette file writes one', () => {
  const expected = new Set(Object.values(palette).map((value) => value.toLowerCase()));
  const found = new Set<string>();
  for (const file of mailSourceFiles()) {
    const literals = colourLiteralsIn(file);
    if (file !== PALETTE_FILE) {
      assert.deepEqual(literals, [], `${relative(MAIL_DIR, join(MAIL_DIR, file))} writes a colour literal`);
      continue;
    }
    for (const literal of literals) found.add(literal);
  }
  assert.deepEqual([...found].toSorted(), [...expected].toSorted());
});

test('the palette is the five mirrored tokens plus white, nothing else', () => {
  assert.deepEqual(
    Object.values(palette).toSorted(),
    [...Object.values(MIRRORED), '#ffffff'].toSorted(),
    'a colour was added to the palette without a mirror or a reason',
  );
});

test('no file under src/mail calls rgb(), hsl() or another colour function', () => {
  for (const file of mailSourceFiles()) {
    const text = readFileSync(join(MAIL_DIR, file), 'utf8');
    assert.deepEqual(text.match(COLOUR_FUNCTION) ?? [], [], `${file} calls a colour function`);
  }
});

test('the scan can see a literal: it finds the palette file own values', () => {
  // The control for the scan: a scan that matched nothing would pass above.
  assert.ok(colourLiteralsIn(PALETTE_FILE).length >= Object.values(palette).length);
});
