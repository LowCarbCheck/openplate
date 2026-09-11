/**
 * The four `--macro-*` fills, measured against the card they are drawn on
 * (M216).
 *
 * A macro swatch is two pixels wide beside a small uppercase label, and the
 * same token fills a two-pixel meter. Both are decoration by the WCAG letter,
 * which would let them sit at 3:1. They are picked to the 4.5:1 TEXT floor
 * anyway, because a colour that is only just distinguishable from white is not
 * a colour anybody can name, and naming the macro is the entire job of the
 * swatch.
 *
 * The second thing pinned here is the ASSIGNMENT, not just the contrast. M216
 * moved protein off coral and fat off amber: a person read the coral protein
 * as "red, something is wrong" and the amber fat as a warning, and a macro
 * swatch grades nothing. Protein is orange, fat is plum, carbs and fiber are
 * unchanged, and amber is left to mean one thing in this product, over a
 * ceiling. Pinning the hue BANDS rather than the exact triples leaves room to
 * retune a value without rewriting this file, while a slide back toward red or
 * amber fails.
 *
 * ── THE ONE EXEMPTION ──
 * `--macro-carbs` is the mark teal, frozen by `tests/unit/brand-colors.test.ts`
 * and owned by `openplate-brand`, not by this repo. It measures 3.40:1 on a
 * white card, below the text floor the other three clear. That is a brand
 * question for a person, so it is RECORDED here with its own floor rather than
 * quietly excluded, and the exemption itself is asserted to be the only one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const CSS = readFileSync(join(fileURLToPath(new URL('../..', import.meta.url)), 'app/app.css'), 'utf8');

/** The AA floor for text, which is the floor three of the four macro fills are picked to. */
const AA_TEXT = 4.5;

interface Srgb {
  red: number;
  green: number;
  blue: number;
}

/** An `hsl()` triple as app.css writes it: degrees, percent, percent. */
interface HslTriple {
  hue: number;
  saturation: number;
  lightness: number;
}

/** CSS `hsl()` to sRGB, each channel 0..1. Plain arithmetic, no library. */
function toSrgb({ hue, saturation, lightness }: HslTriple): Srgb {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = l - chroma / 2;
  const sextant = Math.floor(hue / 60) % 6;
  const wheel: [number, number, number][] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const [red, green, blue] = wheel[sextant];
  return { red: red + base, green: green + base, blue: blue + base };
}

/** One sRGB channel, gamma expanded to linear light. */
function linearize(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
function luminance({ red, green, blue }: Srgb): number {
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

/** WCAG contrast ratio, 1 to 21, order independent. */
function contrastRatio(a: Srgb, b: Srgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The declared value of one custom property inside one theme block.
 *
 * Reads the DECLARATION, `--name: <h> <s>% <l>%;`, so the many times these
 * token names appear inside app.css's doc comments can never be mistaken for
 * a value.
 */
function readToken(section: string, name: string): HslTriple {
  const match = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%\\s*;`).exec(section);
  if (match === null) throw new Error(`app.css declares no --${name} in this theme block`);
  return { hue: Number(match[1]), saturation: Number(match[2]), lightness: Number(match[3]) };
}

/** The two halves of app.css, split at the one `.dark {` selector. */
interface ThemeSections {
  /** Everything before `.dark {`, which is where `:root` declares the light palette. */
  light: string;
  /** `.dark {` onward. */
  dark: string;
}

/** The `:root` half and the `.dark` half of app.css, split at the one `.dark {` selector. */
function themeSections(): ThemeSections {
  const index = CSS.indexOf('.dark {');
  assert.ok(index > 0, 'app.css must carry a .dark theme block');
  return { light: CSS.slice(0, index), dark: CSS.slice(index) };
}

interface MacroToken {
  /** The custom property, without the leading dashes. */
  name: string;
  /**
   * The ratio this fill must clear against its own theme's `--card`.
   *
   * `AA_TEXT` for every macro the app owns. `--macro-carbs` carries a lower
   * one with the reason written beside it, and the last test in this file
   * asserts it is the only token that does.
   */
  floor: number;
  /** Allowed hue band, inclusive, in degrees. */
  hue: [number, number];
  note: string;
}

const MACRO_TOKENS: MacroToken[] = [
  {
    name: 'macro-carbs',
    floor: 3,
    hue: [160, 200],
    note:
      'THE ONE EXEMPTION. The mark teal, frozen at `181 93% 32%` by brand-colors.test.ts and owned by ' +
      'openplate-brand. It measures about 3.4:1 on a white card, below the text floor the other three ' +
      'clear. Moving it is a brand decision for a person, not a nudge in this repo.',
  },
  {
    name: 'macro-protein',
    floor: AA_TEXT,
    hue: [15, 45],
    note: 'Orange since M216. Was coral at hue 349, which a person read as red, meaning "something is wrong".',
  },
  {
    name: 'macro-fat',
    floor: AA_TEXT,
    hue: [260, 310],
    note: 'Plum since M216. Was amber at hue 36, which a person read as a warning. Amber now means over a ceiling only.',
  },
  {
    name: 'macro-fiber',
    floor: AA_TEXT,
    hue: [100, 150],
    note: 'Sage, unchanged by M216.',
  },
];

describe('the contrast maths itself', () => {
  it('reports the two ratios everybody knows, so a green run below is not the maths agreeing with itself', () => {
    const white = toSrgb({ hue: 0, saturation: 0, lightness: 100 });
    const black = toSrgb({ hue: 0, saturation: 0, lightness: 0 });
    assert.equal(Math.round(contrastRatio(white, black) * 100) / 100, 21);
    assert.equal(contrastRatio(white, white), 1);
  });

  it('places a known hue in the right sextant', () => {
    const orange = toSrgb({ hue: 30, saturation: 100, lightness: 50 });
    assert.ok(orange.red > orange.green && orange.green > orange.blue, 'hue 30 must be red-dominant and warm');
    const plum = toSrgb({ hue: 283, saturation: 100, lightness: 50 });
    assert.ok(plum.blue > plum.red && plum.red > plum.green, 'hue 283 must be blue-dominant with red in it');
  });
});

for (const theme of ['light', 'dark'] as const) {
  describe(`the ${theme} macro fills`, () => {
    const section = themeSections()[theme];
    const card = toSrgb(readToken(section, 'card'));

    for (const token of MACRO_TOKENS) {
      it(`--${token.name} clears ${token.floor}:1 on the ${theme} card`, () => {
        const ratio = contrastRatio(toSrgb(readToken(section, token.name)), card);
        assert.ok(
          ratio >= token.floor,
          `--${token.name} measures ${ratio.toFixed(2)}:1 on the ${theme} card, under its ${token.floor}:1 floor. ${token.note}`,
        );
      });
    }
  });

  describe(`the ${theme} macro hues`, () => {
    const section = themeSections()[theme];

    for (const token of MACRO_TOKENS) {
      it(`--${token.name} sits between ${token.hue[0]} and ${token.hue[1]} degrees`, () => {
        const { hue } = readToken(section, token.name);
        assert.ok(
          hue >= token.hue[0] && hue <= token.hue[1],
          `--${token.name} is at hue ${hue}, outside ${token.hue[0]}..${token.hue[1]}. ${token.note}`,
        );
      });
    }
  });
}

describe('the exemption', () => {
  it('is only ever the mark teal, and every other macro is held to the text floor', () => {
    assert.deepEqual(
      MACRO_TOKENS.filter((token) => token.floor < AA_TEXT).map((token) => token.name),
      ['macro-carbs'],
      'a second macro dropped below the AA text floor. Pick a darker value instead of lowering the floor.',
    );
  });

  it('keeps a hue band for protein that the pre-M216 coral would have failed', () => {
    const protein = MACRO_TOKENS.find((token) => token.name === 'macro-protein');
    assert.ok(protein !== undefined);
    const coralHue = 349;
    assert.ok(
      coralHue < protein.hue[0] || coralHue > protein.hue[1],
      'the protein hue band must exclude the coral this redesign removed, or the band asserts nothing',
    );
  });
});
