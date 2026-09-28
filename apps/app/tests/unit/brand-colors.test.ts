/**
 * Every teal-ish colour LITERAL the app ships, pinned, M196 spec 03.
 *
 * `openplate-workspace/CLAUDE.md` says the mark and the palette are defined in `openplate-brand`
 * only, never typed into a member. This is the check for the colour half of that rule. It is not
 * the check a first draft would write, and the reason is worth stating, because the obvious version
 * is wrong here:
 *
 * 1. **The palette is `hsl()` triples, not hex.** `--primary: 179 92% 25%` is not a hex literal at
 *    all, and neither is any other token in `app/app.css`. A test that greps for `#069A9D` and
 *    demands exactly one hit would pass today while saying nothing about the palette.
 * 2. **The mark teal appears only in a COMMENT.** `app/app.css` writes `brand teal, #069A9D` beside
 *    `--macro-carbs` to explain where that hue came from. Deleting it would lose the note and gain
 *    nothing.
 * 3. **There are already three different teals in production**, and which one wins is an OPEN
 *    QUESTION recorded in `openplate-brand/README.md`. It is a decision for a person. Freezing them
 *    is honest; silently picking a winner is not.
 *
 * So this pins the KNOWN SET and fails on a new member. A fourth teal appearing anywhere under
 * `app/`, or in `public/site.webmanifest`, fails the local gate and arrives in review as a question
 * rather than as a colour nobody noticed. Resolving one of the open questions means editing the
 * value AND deleting its row here, which is exactly the review this is for.
 *
 * ── DO NOT "FIX" A FAILURE BY ADDING A ROW ──
 * A new row is a new brand colour. If you are adding one, the value belongs in
 * `openplate-brand/src/tokens.ts` first and the question of whether it should exist belongs to a
 * person before that.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_DIR = join(ROOT, 'app');
const WEB_MANIFEST = join(ROOT, 'public/site.webmanifest');

/**
 * The band this test polices. Cyan through green-teal, and saturated enough to be a CHOICE.
 *
 * The saturation floor is what keeps `#ffffff` and `#000000` out: an achromatic colour has no
 * meaningful hue, so without the floor every white in the tree would read as whatever hue floating
 * point rounding handed it. It is deliberately LOW, at ten percent, because two of the five known
 * literals are near-blacks with a teal cast (`#101718`, `#090d0e`) and those are exactly the kind
 * of quiet second opinion about the brand that this is meant to catch.
 */
const HUE_MIN = 160;
const HUE_MAX = 200;
const SATURATION_FLOOR = 0.1;

interface Hsl {
  /** Degrees, 0 to 360. */
  hue: number;
  /** 0 to 1. Zero for any grey, including white and black. */
  saturation: number;
}

/** `#rrggbb`, lower case, to HSL. Plain arithmetic, no library, because it is six lines. */
function toHsl(hex: string): Hsl {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  if (span === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const saturation = span / (lightness > 0.5 ? 2 - max - min : max + min);
  const raw =
    max === red ? (green - blue) / span
    : max === green ? 2 + (blue - red) / span
    : 4 + (red - green) / span;
  return { hue: (raw * 60 + 360) % 360, saturation };
}

function isTealish(hex: string): boolean {
  const { hue, saturation } = toHsl(hex);
  return saturation >= SATURATION_FLOOR && hue >= HUE_MIN && hue < HUE_MAX;
}

/** Every file this test reads: `app/` in full, plus the one file in `public/` that carries colour. */
function scanned(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scanned(path);
    return /\.(ts|tsx|css|json)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Where a teal was written and what it says. Six-digit hex only: the three-digit form cannot express
 * any of the five below, and no file in the tree uses it. Should one appear, it appears as a value
 * this scan does not see, so the shorthand is expanded here rather than trusted not to be used.
 */
function occurrences(): string[] {
  const files = [...scanned(APP_DIR), WEB_MANIFEST];
  return files
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const found = source.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [];
      return found.map((hex) => ({ path, hex: expand(hex.toLowerCase()) }));
    })
    .filter((hit) => isTealish(hit.hex))
    .map((hit) => `${relative(ROOT, hit.path)} ${hit.hex}`)
    .toSorted();
}

/** `#abc` written out, so a shorthand cannot slip past a six-digit comparison. */
function expand(hex: string): string {
  if (hex.length === 7) return hex;
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}

interface KnownTeal {
  /** Path from the repository root. */
  where: string;
  value: string;
  /** What it paints, and whether `openplate-brand/README.md` records it as an open question. */
  note: string;
}

/**
 * The five teal-ish literals openplate shipped on 2026-09-07, each one accounted for.
 *
 * Three distinct values. That is the problem `openplate-brand` was created to end, and the entries
 * marked DISPUTED are its open questions, verbatim. None of them is resolved here.
 */
const KNOWN: KnownTeal[] = [
  {
    where: 'app/app.css',
    value: '#069a9d',
    note:
      'The MARK teal, in a comment beside `--macro-carbs: 181 93% 32%`, saying where that hue came ' +
      'from. Not disputed as a value: openplate-brand publishes exactly this as the mark. It paints ' +
      'nothing by itself, a comment is not a declaration.',
  },
  {
    where: 'app/app.css',
    value: '#101718',
    note:
      'The dark theme `--card`, quoted in a comment that explains how the adherence ramp was ' +
      'validated against it. A near-black with a teal cast, not an accent.',
  },
  {
    where: 'app/root.tsx',
    value: '#0d968b',
    note:
      'DISPUTED, open question 1. `<meta name="theme-color">`, which tints browser chrome. It matches ' +
      'nothing else in the product and should probably be the mark teal. A person decides, not a test.',
  },
  {
    where: 'public/site.webmanifest',
    value: '#090d0e',
    note:
      'DISPUTED, open question 2. `background_color`, the install splash. The dark `--card` is ' +
      '#101718; a splash and a surface are allowed to differ, it is just not clear these were CHOSEN to.',
  },
  {
    where: 'public/site.webmanifest',
    value: '#0d968b',
    note: 'DISPUTED, open question 1. `theme_color`, the installed-app counterpart of the meta tag above.',
  },
];

describe('teal-ish colour literals', () => {
  it('are exactly the set known on 2026-09-07, and a fourth teal fails this', () => {
    assert.deepEqual(
      occurrences(),
      KNOWN.map((teal) => `${teal.where} ${teal.value}`).toSorted(),
      'a teal appeared, moved or vanished. A NEW one belongs in openplate-brand/src/tokens.ts, not here. ' +
        'A resolved one means deleting its row above and the open question it quotes.',
    );
  });

  it('every known teal carries a note saying what it paints', () => {
    assert.deepEqual(
      KNOWN.filter((teal) => teal.note.length < 40),
      [],
    );
  });

  it('writes the theme colour identically in the meta tag and the manifest', () => {
    const themes = KNOWN.filter((teal) => teal.value === '#0d968b');
    assert.deepEqual(themes.map((teal) => teal.where).toSorted(), ['app/root.tsx', 'public/site.webmanifest']);
  });
});

describe('the palette', () => {
  const css = readFileSync(join(APP_DIR, 'app.css'), 'utf8');

  it('is hsl triples, so the mark teal is never a UI token value', () => {
    assert.match(css, /--primary: 179 92% 25%;/);
    assert.match(css, /--macro-carbs: 181 93% 32%;/);
  });

  it('declares no token to a hex value', () => {
    const declarations = css.match(/^\s*--[a-z-]+:\s*#[0-9a-fA-F]{3,8}/gm) ?? [];
    assert.deepEqual(declarations, [], 'a custom property was given a hex value. The palette is hsl triples.');
  });
});
