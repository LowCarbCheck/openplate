/**
 * No pure black and no pure white anywhere in the app (owner rule, 2026-10-07).
 *
 * The owner looked at a light-theme page and said a card looked like pure black next to the
 * page. The cause was a card painted at full white on a pale blue-grey page: the harshest
 * neutral the screen can show. The rule that came out of it: no token, class or literal paints
 * black or white at full strength in either theme. Light, the lightest value is
 * `192 50% 98.5%`. Dark, the darkest is `--background` and the lightest is the ink. Every
 * neutral carries hue 192 at low saturation. This file fails on a new pure value.
 *
 * ── TWO CHECKS ──
 * 1. The PALETTE check parses every colour value in `app/app.css` (the `:root` and `.dark`
 *    blocks, and the `hsl()` sidebar copies) and fails on a pure hex or on an HSL lightness
 *    outside 4.5 to 98.5 percent. The bound is the rule written as a number, so a near-pure
 *    value (a card at 99.5 percent) fails too.
 * 2. The SOURCE scan reads every text file under `app/` and `public/site.webmanifest` for the
 *    forms in which a pure value gets typed: a pure hex of any length, an HSL triple at 0 or 100
 *    percent lightness, `rgb()` and `oklch()` at full strength, the Tailwind colour utilities
 *    `bg|text|border|fill|stroke|ring` with `black` or `white`, SVG `fill`, `stroke` and
 *    `stopColor` set to `white` or `black`, and a `black` or `white` mask stop.
 *
 * ── WHAT PASSES BY RULE ──
 * A shadow is black at an opacity, and so is a scrim. `shadow-black/20` is not one of the forms
 * above, so it never reaches the allow list. `rgb(0 0 0 / 0.5)` has an alpha, so it is not a full
 * strength `rgb()` and passes too. Tailwind's own `shadow-sm` to `shadow-2xl` live in
 * node_modules and are not read at all.
 *
 * ── WHAT THIS CANNOT SEE ──
 * Pixels. The mark's glyph, the notification badge (a white silhouette on transparency, because
 * Android reads only the alpha) and the landing screenshots are image files, and this scan reads
 * text. Third-party logos live in the website, not here. They are named in the rule, and the
 * browser tier (`tests/e2e/notification-badge.spec.ts`) holds the badge.
 *
 * ── THE ALLOW LIST ──
 * One row per file, each with its reason. A row also pins the forms it allows, so a file cleared
 * for a scrim cannot quietly gain a solid `bg-black`. A row for a file that no longer holds its
 * form fails, so the list cannot rot into a list of things that used to be needed.
 *
 * ── EVERY ASSERTION HAS A CONTROL ──
 * `assert.deepEqual(violations, [])` passes forever against a scanner that finds nothing. So the
 * scanner is fed a probe with every forbidden form, one per line, and must name each one. It is
 * fed a list of near misses (`shadow-black/20`, the glyph `fffffe`, a longer word) and must name
 * none. A fixture palette with `--card: 0 0% 100%` must fail the palette check, and the same
 * fixture at `192 50% 98.5%` must pass. The allow list is run against a solid `bg-black` in a
 * scrim file and a scrim in a file that has no row.
 *
 * Write colours as HSL triples in comments, never as hex: `brand-colors.test.ts` freezes every
 * teal-ish hex under `app/`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_DIR = join(ROOT, 'app');
const WEB_MANIFEST = join(ROOT, 'public/site.webmanifest');
const APP_CSS = readFileSync(join(APP_DIR, 'app.css'), 'utf8');

/** The rule as numbers: the lightest and the darkest lightness any palette value may have. */
const LIGHTNESS_MIN = 4.5;
const LIGHTNESS_MAX = 98.5;

// ───────────────────────────── the palette check ─────────────────────────────

/** `/* ... *\/` removed, so a colour named in prose is not a colour. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface PaletteBlock {
  /** The selector, trimmed: `:root`, `.dark`. */
  selector: string;
  /** What sits between the braces. */
  body: string;
}

/**
 * The innermost `selector { ... }` blocks of a stylesheet.
 *
 * `@layer base { :root { ... } }` yields the `:root` block, because the match cannot span a
 * nested brace. `@theme`, `@keyframes` and the like come out too, with no colour in them to judge.
 */
function blocksOf(css: string): PaletteBlock[] {
  return [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((block) => ({
    selector: block[1].trim(),
    body: block[2],
  }));
}

/** HSL lightness of a hex colour, 0 to 100. Eight-digit hex ignores its alpha pair. */
function hexLightness(hex: string): number {
  const digits = hex.slice(1);
  const wide = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const channels = [0, 2, 4].map((start) => Number.parseInt(wide.slice(start, start + 2), 16) / 255);
  return ((Math.max(...channels) + Math.min(...channels)) / 2) * 100;
}

/** A colour value this check judged, so a test can prove the check looked at enough of them. */
interface JudgedValue {
  selector: string;
  /** What it was written as: `--card: 192 50% 98.5%`, `hsl(...)`, a hex. */
  written: string;
  lightness: number;
}

const HEX_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\w-])/gi;
const HSL_FUNCTION = /hsla?\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+([\d.]+)%[^)]*\)/gi;
const BARE_TRIPLE = /(--[\w-]+)\s*:\s*([\d.]+(?:deg)?\s+[\d.]+%\s+([\d.]+)%(?:\s*\/\s*[\d.]+%?)?)\s*;/g;

/** Every colour value in `css` with the lightness it was written at. */
function judgedValuesOf(css: string): JudgedValue[] {
  return blocksOf(css).flatMap(({ selector, body }) => {
    const triples = [...body.matchAll(BARE_TRIPLE)].map((match) => ({
      selector,
      written: `${match[1]}: ${match[2]}`,
      lightness: Number(match[3]),
    }));
    const functions = [...body.matchAll(HSL_FUNCTION)].map((match) => ({
      selector,
      written: match[0],
      lightness: Number(match[1]),
    }));
    const hexes = [...body.matchAll(HEX_COLOUR)].map((match) => ({
      selector,
      written: match[0],
      lightness: hexLightness(match[0]),
    }));
    return triples.concat(functions, hexes);
  });
}

/** One line per palette value outside the bound. Empty means the palette keeps the rule. */
function paletteViolations(css: string): string[] {
  return judgedValuesOf(css)
    .filter(({ lightness }) => lightness < LIGHTNESS_MIN || lightness > LIGHTNESS_MAX)
    .map(
      ({ selector, written, lightness }) =>
        `${selector} { ${written} } is at ${lightness.toFixed(1)}% lightness, outside ${LIGHTNESS_MIN} to ${LIGHTNESS_MAX}`,
    );
}

// ───────────────────────────── the source scan ─────────────────────────────

const FORM_NAMES = [
  'hex-white',
  'hex-black',
  'hsl-white',
  'hsl-black',
  'rgb-white',
  'rgb-black',
  'oklch-white',
  'oklch-black',
  'tailwind-white',
  'tailwind-black',
  'attribute-white',
  'attribute-black',
  'mask-white',
  'mask-black',
] as const;

type FormName = (typeof FORM_NAMES)[number];

interface Hit {
  form: FormName;
  /** The text that matched, so a rule can ask whether it carried an opacity. */
  text: string;
  /** 1 based. */
  line: number;
}

/** Whether a hex colour is full black or full white once its alpha pair is set aside. */
function pureHexForm(hex: string): FormName | null {
  const digits = hex.slice(1).toLowerCase();
  const wide = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const colour = wide.slice(0, 6);
  if (colour === 'ffffff') return 'hex-white';
  if (colour === '000000') return 'hex-black';
  return null;
}

function lineOf({ text, index }: { text: string; index: number }): number {
  return text.slice(0, index).split('\n').length;
}

/** Every pure value written in `text`, whatever the form. */
function scanText(text: string): Hit[] {
  const hits: Hit[] = [];
  const add = ({ form, match }: { form: FormName; match: RegExpExecArray | RegExpMatchArray }): void => {
    hits.push({ form, text: match[0], line: lineOf({ text, index: match.index ?? 0 }) });
  };

  for (const match of text.matchAll(HEX_COLOUR)) {
    const form = pureHexForm(match[0]);
    if (form !== null) add({ form, match });
  }

  // Lightness 0 or 100 with any hue and saturation: `0 0% 0%`, `0 0% 100%`, `192 50% 100%`.
  for (const match of text.matchAll(/(?<![\w.%-])[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+(0|100)(?:\.0+)?%(?![\w.%])/g)) {
    add({ form: match[1] === '100' ? 'hsl-white' : 'hsl-black', match });
  }

  // Full strength with no alpha. `rgb(0 0 0 / 0.5)` is a shadow or a scrim, and passes by rule.
  for (const match of text.matchAll(/rgba?\(\s*(?:0\s*[\s,]\s*0\s*[\s,]\s*0|255\s*[\s,]\s*255\s*[\s,]\s*255)\s*\)/gi)) {
    add({ form: /^rgba?\(\s*0/i.test(match[0]) ? 'rgb-black' : 'rgb-white', match });
  }

  for (const match of text.matchAll(/oklch\(\s*(?:1|100%)\s+0\s+0\s*\)/gi)) add({ form: 'oklch-white', match });
  for (const match of text.matchAll(/oklch\(\s*0%?\s+0\s+0\s*\)/gi)) add({ form: 'oklch-black', match });

  // `bg-white`, `dark:ring-black/5`. A longer word (`bg-white-ish`, `text-blackout`) is not the colour.
  for (const match of text.matchAll(
    /(?<![\w-])(?:bg|text|border|fill|stroke|ring)-(black|white)(?![\w-])(?:\/\d+)?/g,
  )) {
    add({ form: match[1] === 'white' ? 'tailwind-white' : 'tailwind-black', match });
  }

  // `fill="white"`, `stroke: black`, `stopColor={'white'}`, `stop-color: black`.
  for (const match of text.matchAll(
    /\b(?:fill|stroke|stopColor|stop-color)\s*[=:]\s*\{?\s*["'`]?(white|black)(?![\w-])/gi,
  )) {
    add({ form: match[1].toLowerCase() === 'white' ? 'attribute-white' : 'attribute-black', match });
  }

  // A mask stop: `black_84%` in a Tailwind arbitrary value, `(black 84%` in a plain gradient.
  for (const match of text.matchAll(/(?<![\w-])(white|black)_\d+%|[(,]\s*(white|black)\s+\d+%/g)) {
    const colour = match[1] ?? match[2];
    add({ form: colour === 'white' ? 'mask-white' : 'mask-black', match });
  }

  return hits;
}

interface AllowedFile {
  /** Path from the app root, with forward slashes. */
  file: string;
  /** The forms this file may carry, and no others. */
  forms: readonly FormName[];
  /** When true, a Tailwind form in this file must carry an opacity (`/50`). A solid one still fails. */
  needsOpacity: boolean;
  /** Why a pure value is correct here. */
  reason: string;
}

/**
 * Every file that may carry a pure value, and why. Adding a row is a decision about the rule, so
 * the reason has to say why a token will not do.
 */
const ALLOWED_FILES: readonly AllowedFile[] = [
  {
    file: 'app/components/qr-code.tsx',
    forms: ['hex-white', 'hex-black'],
    needsOpacity: false,
    reason:
      'The QR code. A scanner needs black modules on a white ground in either theme, and the spec asks for the maximum contrast, so this one pair is not a theme colour.',
  },
  {
    file: 'app/components/share-invite-link-card.tsx',
    forms: ['tailwind-white'],
    needsOpacity: false,
    reason:
      'The ground behind the QR code, so the white margin the spec requires reaches the card edge in the dark theme too.',
  },
  {
    file: 'app/components/ui/alert-dialog.tsx',
    forms: ['tailwind-black'],
    needsOpacity: true,
    reason: 'The scrim behind a dialog: black at an opacity, which dims the page and paints no surface.',
  },
  {
    file: 'app/components/ui/sheet.tsx',
    forms: ['tailwind-black'],
    needsOpacity: true,
    reason: 'The scrim behind a sheet: black at an opacity, which dims the page and paints no surface.',
  },
  {
    file: 'app/routes/landing-open.tsx',
    forms: ['tailwind-black', 'tailwind-white', 'mask-black'],
    needsOpacity: true,
    reason:
      'The hairline ring that stops a screenshot bleeding into the page is black or white at 5 percent, an overlay and not a surface. The crop fade is a mask stop: only its alpha is used, and it paints nothing.',
  },
];

/** The hits in `text` that no allow row covers. `file` is the path from the app root. */
function violationsIn({ file, text }: { file: string; text: string }): string[] {
  const row = ALLOWED_FILES.find((candidate) => candidate.file === file);
  return scanText(text)
    .filter((hit) => {
      if (row === undefined || !row.forms.includes(hit.form)) return true;
      const isTailwind = hit.form.startsWith('tailwind');
      return row.needsOpacity && isTailwind && !hit.text.includes('/');
    })
    .map((hit) => `${file}:${hit.line} ${hit.form} \`${hit.text}\``);
}

/** Every file the scan reads: all text under `app/`, plus the one manifest in `public/`. */
function scannedFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scannedFiles(path);
    return /\.(ts|tsx|css|json|md|svg|html)$/.test(entry.name) ? [path] : [];
  });
}

function everyScannedFile(): string[] {
  return [...scannedFiles(APP_DIR), WEB_MANIFEST];
}

/** A path from the app root with forward slashes, whatever the platform. */
function appPath(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

// ───────────────────────────── the tests ─────────────────────────────

describe('the palette keeps the rule', () => {
  it(`every colour value in app.css sits between ${LIGHTNESS_MIN} and ${LIGHTNESS_MAX} percent lightness`, () => {
    assert.deepEqual(
      paletteViolations(APP_CSS),
      [],
      'a palette value reached pure black or pure white. The lightest light value is 192 50% 98.5%, the darkest dark value is --background.',
    );
  });

  it('judged both themes and the hsl() sidebar copies, so a blind parse cannot pass', () => {
    const judged = judgedValuesOf(APP_CSS);
    const selectors = judged.map((value) => value.selector);
    assert.ok(selectors.filter((selector) => selector === ':root').length >= 40, 'too few :root values judged');
    assert.ok(selectors.filter((selector) => selector === '.dark').length >= 40, 'too few .dark values judged');
    assert.ok(
      judged.some((value) => value.written.startsWith('hsl(') && value.selector === '.dark'),
      'the hsl() sidebar block of the dark theme was not judged',
    );
    assert.ok(
      judged.some((value) => value.written.startsWith('hsl(') && value.selector === ':root'),
      'the hsl() sidebar block of the light theme was not judged',
    );
  });

  it('still holds the two ends it is meant to guard, so the bound is not looser than the rule', () => {
    const lightness = new Map(
      judgedValuesOf(APP_CSS).map((value) => [`${value.selector} ${value.written}`, value.lightness]),
    );
    assert.equal(lightness.get(':root --card: 192 50% 98.5%'), 98.5, 'the light card is the lightest light value');
    // The dark page was lifted from 4.5 to 6.5 percent on 2026-10-07; LIGHTNESS_MIN stays 4.5 because it guards pure black, not the lift.
    assert.equal(lightness.get('.dark --background: 192 22% 6.5%'), 6.5, 'the dark page is the darkest dark value');
  });
});

describe('no source file paints a pure value outside the allow list', () => {
  it('finds none under app/ or in the manifest', () => {
    const violations = everyScannedFile().flatMap((path) =>
      violationsIn({ file: appPath(path), text: readFileSync(path, 'utf8') }),
    );
    assert.deepEqual(
      violations,
      [],
      'a pure black or white was typed. Use a token (`bg-card`, `text-primary-foreground`, `text-destructive-foreground`). ' +
        'A shadow or a scrim takes `shadow-black/20` or `bg-black/50`. Anything else needs a row in ALLOWED_FILES with a reason.\n  ' +
        violations.join('\n  '),
    );
  });

  it('reads a plausible number of files, so a broken walk cannot pass vacuously', () => {
    assert.ok(everyScannedFile().length > 500, `read only ${everyScannedFile().length} files`);
    assert.ok(everyScannedFile().includes(WEB_MANIFEST), 'the manifest was not read');
  });

  it('keeps every allow row real: the file exists, the reason is a sentence, and the form is still there', () => {
    for (const row of ALLOWED_FILES) {
      const path = join(ROOT, row.file);
      assert.ok(existsSync(path), `${row.file} no longer exists, so its allow row is dead. Delete the row.`);
      assert.ok(row.reason.length >= 60, `${row.file} needs a reason that says why a token will not do`);
      const found = new Set(scanText(readFileSync(path, 'utf8')).map((hit) => hit.form));
      for (const form of row.forms) {
        assert.ok(found.has(form), `${row.file} no longer holds ${form}. Delete it from its allow row.`);
      }
    }
  });

  it('lists each file once', () => {
    const files = ALLOWED_FILES.map((row) => row.file);
    assert.equal(new Set(files).size, files.length, 'one row per allowed file');
  });
});

describe('CONTROL: the scanner reports every forbidden form', () => {
  /** One forbidden spelling per line, with the form it must be reported as. */
  const PROBE: readonly (readonly [string, FormName])[] = [
    ['fill="#ffffff"', 'hex-white'],
    ['color: #FFF;', 'hex-white'],
    ['color: #ffff;', 'hex-white'],
    ['color: #ffffffff;', 'hex-white'],
    ['fill="#000000"', 'hex-black'],
    ['color: #000;', 'hex-black'],
    ['color: #0000;', 'hex-black'],
    ['--ink: 0 0% 0%;', 'hsl-black'],
    ['--card: 0 0% 100%;', 'hsl-white'],
    ['--card: 192 50% 100%;', 'hsl-white'],
    ['color: hsl(0, 0%, 100%);', 'hsl-white'],
    ['color: rgb(0 0 0);', 'rgb-black'],
    ['color: rgb(0, 0, 0);', 'rgb-black'],
    ['color: rgb(255 255 255);', 'rgb-white'],
    ['color: rgba(255, 255, 255)', 'rgb-white'],
    ['color: oklch(1 0 0);', 'oklch-white'],
    ['color: oklch(0 0 0);', 'oklch-black'],
    ['className="bg-white"', 'tailwind-white'],
    ['className="text-white"', 'tailwind-white'],
    ['className="border-white"', 'tailwind-white'],
    ['className="fill-white"', 'tailwind-white'],
    ['className="stroke-white"', 'tailwind-white'],
    ['className="dark:ring-white/5"', 'tailwind-white'],
    ['className="bg-black"', 'tailwind-black'],
    ['className="text-black"', 'tailwind-black'],
    ['className="border-black"', 'tailwind-black'],
    ['className="fill-black"', 'tailwind-black'],
    ['className="stroke-black"', 'tailwind-black'],
    ['className="ring-black/5"', 'tailwind-black'],
    ['className="fixed inset-0 bg-black/50"', 'tailwind-black'],
    ['<rect fill="white" />', 'attribute-white'],
    ["<path stroke='white' />", 'attribute-white'],
    ['<stop stopColor="white" />', 'attribute-white'],
    ['<stop stop-color: white />', 'attribute-white'],
    ['<rect fill="black" />', 'attribute-black'],
    ['<path stroke: black />', 'attribute-black'],
    ['<stop stopColor={"black"} />', 'attribute-black'],
    ['className="[mask-image:linear-gradient(to_bottom,white_84%,transparent)]"', 'mask-white'],
    ['className="[mask-image:linear-gradient(to_bottom,black_84%,transparent)]"', 'mask-black'],
    ['mask-image: linear-gradient(to bottom, black 84%, transparent)', 'mask-black'],
  ];

  it('names the one form each probe line carries', () => {
    for (const [line, form] of PROBE) {
      assert.deepEqual(
        scanText(line).map((hit) => hit.form),
        [form],
        `the scanner did not report exactly ${form} for: ${line}`,
      );
    }
  });

  it('the probe covers every form the scanner can report', () => {
    assert.deepEqual(new Set(PROBE.map(([, form]) => form)), new Set(FORM_NAMES));
  });

  it('reports every form when the whole probe is one string', () => {
    const everything = PROBE.map(([line]) => line).join('\n');
    assert.deepEqual(new Set(scanText(everything).map((hit) => hit.form)), new Set(FORM_NAMES));
  });

  it('puts a hit on the line it was written on', () => {
    assert.equal(scanText('one\ntwo\ncolor: #fff;')[0].line, 3);
  });
});

describe('CONTROL: what passes by rule is not reported', () => {
  const NEAR_MISSES = [
    'className="shadow-md shadow-black/20"',
    'className="hover:shadow-white/10"',
    'color: #fffffe;',
    'color: #fffffd;',
    'color: #010101;',
    'color: #101718;',
    '--card: 192 50% 98.5%;',
    '--background: 192 24% 4.5%;',
    'color: hsl(192 50% 98.5%);',
    'color: rgb(0 0 0 / 0.5);',
    'color: rgba(0, 0, 0, 0.1);',
    'color: oklch(0.99 0.01 192);',
    'className="whitespace-nowrap"',
    'className="bg-white-ish text-blackout"',
    'className="text-primary-foreground bg-card"',
    'className="text-destructive-foreground"',
    'the egg white and the black beans',
    'background-position: 0 0% 100',
    'transparent 20% 100%',
  ];

  it('reports nothing for shadows, near neutrals, longer words and prose', () => {
    for (const line of NEAR_MISSES) {
      assert.deepEqual(scanText(line), [], `the scanner reported a pass-by-rule line: ${line}`);
    }
  });
});

describe('CONTROL: the palette check fails a pure fixture and passes a fixed one', () => {
  it('fails `--card: 0 0% 100%`', () => {
    const violations = paletteViolations(':root { --card: 0 0% 100%; }');
    assert.equal(violations.length, 1);
    assert.match(violations[0], /:root \{ --card: 0 0% 100% \} is at 100\.0% lightness/);
  });

  it('passes the same card at 192 50% 98.5%', () => {
    assert.deepEqual(paletteViolations(':root { --card: 192 50% 98.5%; }'), []);
  });

  it('fails a pure black page in the dark theme', () => {
    assert.equal(paletteViolations('.dark { --background: 0 0% 0%; }').length, 1);
  });

  it('fails a near-black page just under the bound, so the bound is not the pure value only', () => {
    assert.equal(paletteViolations('.dark { --background: 192 24% 4.4%; }').length, 1);
    assert.deepEqual(paletteViolations('.dark { --background: 192 24% 4.5%; }'), []);
  });

  it('fails a near-white card just over the bound', () => {
    assert.equal(paletteViolations(':root { --card: 192 50% 98.6%; }').length, 1);
  });

  it('fails the hsl() sidebar copy and a pure hex, inside a layer', () => {
    const css = '@layer base { :root { --sidebar-primary-foreground: hsl(0 0% 100%); --x: #ffffff; } }';
    assert.equal(paletteViolations(css).length, 2);
  });

  it('ignores a pure value that only a comment names', () => {
    assert.deepEqual(paletteViolations(':root { /* was 0 0% 100% */ --card: 192 50% 98.5%; }'), []);
  });
});

describe('CONTROL: the allow list is keyed by file and by form', () => {
  it('lets the scrim file carry bg-black at an opacity', () => {
    assert.deepEqual(violationsIn({ file: 'app/components/ui/sheet.tsx', text: 'fixed inset-0 bg-black/50' }), []);
  });

  it('fails a SOLID bg-black in the same scrim file', () => {
    assert.equal(violationsIn({ file: 'app/components/ui/sheet.tsx', text: 'fixed inset-0 bg-black' }).length, 1);
  });

  it('fails the same scrim in a file that has no row', () => {
    assert.equal(violationsIn({ file: 'app/components/ui/dialog.tsx', text: 'fixed inset-0 bg-black/50' }).length, 1);
  });

  it('fails a form the row does not name, in a file that has one', () => {
    assert.equal(violationsIn({ file: 'app/components/qr-code.tsx', text: 'className="text-white"' }).length, 1);
  });

  it('lets the QR code carry its pair', () => {
    assert.deepEqual(violationsIn({ file: 'app/components/qr-code.tsx', text: 'fill="#ffffff" fill="#000000"' }), []);
  });
});
