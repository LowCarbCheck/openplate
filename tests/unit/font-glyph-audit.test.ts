/**
 * Which characters the shipped languages need that Victor Mono does not declare (M243 spec 08).
 *
 * Victor Mono is a code font, and Turkish, German, French, Italian and Spanish are shipped
 * locales. A character the face lacks is not an error anywhere: the browser hands it to the next
 * face in the stack, and the line is drawn in two faces, which reads as a bug and passes every other
 * test. This file reads every non-ASCII character out of the six locale bundles and checks it
 * against the `unicode-range` declarations `@fontsource-variable/victor-mono` ships, and it needs no
 * browser, so it fails in a second, before a build.
 *
 * WHAT A RANGE PROVES, AND WHAT IT DOES NOT. `unicode-range` is what the browser asks each subset
 * file for, so a character outside every range can never be drawn by Victor Mono, which is a hard
 * fact. A character INSIDE a range is asked of that file, and whether the file draws it is the
 * browser tier's question: `lcc-lineage-foundation.spec.ts` reads the painted face of `ı İ ş ğ ẞ`
 * off a real page through the devtools protocol, and is where a range that over-promises would show.
 *
 * WHAT IS EXCLUDED. The legal texts (`legal.json`) are long-form reading and are set in Inter.
 *
 * THE KNOWN GAPS ARE A FROZEN SET. `KNOWN_GAPS` lists the characters no range covers, each with the
 * reason it is allowed. It fails in both directions, like the colour literals in
 * `brand-colors.test.ts`: a NEW uncovered character in a bundle fails the audit, and an entry that a
 * range now covers fails it too, because a gap that closed is a record that went stale.
 *
 * TURKISH IS A SECOND FILE. The record at the bottom lists which subset files each locale needs.
 * Only Turkish needs `latin-ext`, which is why `tests/e2e/lcc-lineage-turkish-first-paint.spec.ts`
 * looks at a Turkish first paint. A locale that starts needing a second file fails the record.
 *
 * ── EVERY CHECK HAS A CONTROL ──
 * A character outside every range and outside the allowlist must fail, or an audit that passed
 * everything would pass. The controls hand the SAME functions a snowman and a stale entry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOCALES_DIRECTORY = join(ROOT, 'app/i18n/locales');
const FONT_CSS = join(ROOT, 'node_modules/@fontsource-variable/victor-mono/index.css');

/** The bundle that is long-form reading and is left out. */
const EXCLUDED_BUNDLE = 'legal.json';

/** How many languages ship. A seventh must be added to the audit on purpose. */
const LOCALE_COUNT = 6;

/** A code point range, both ends included. */
type CodePointRange = readonly [low: number, high: number];

/** One subset file of the font: its name and the ranges the browser asks it for. */
interface Subset {
  name: string;
  ranges: readonly CodePointRange[];
}

/** A character no range covers, and why it is allowed to stay that way. */
interface KnownGap {
  character: string;
  why: string;
}

/**
 * The characters that no subset covers and that the app is allowed to draw anyway, each drawn
 * mid-line by the device's own face. Neither Victor Mono nor Inter has them, so putting Inter
 * behind Victor Mono in the stack does not help.
 */
const KNOWN_GAPS: readonly KnownGap[] = [
  {
    character: '←',
    why: 'the back link on the AI settings page ("← Use ... instead") in all six languages; U+2190 is in no Victor Mono or Inter subset',
  },
  {
    character: '→',
    why: 'the weight summary in the weekly recap ("Weight 82 → 80 kg") in all six languages; U+2192 is in no Victor Mono or Inter subset',
  },
  {
    character: '≥',
    why: 'appears only in source comments today, none in a bundle; listed so a future string that uses it is a known device-face glyph, not a red build',
  },
  {
    character: '≈',
    why: 'appears only in source comments today, none in a bundle; listed for the same reason as U+2265',
  },
  {
    character: '≤',
    why: 'appears only in source comments today, none in a bundle; listed for the same reason as U+2265',
  },
  {
    character: '✓',
    why: 'named in the adherence grid comment (`adherence-grid.tsx`), none in a bundle; a dingbat, in no Victor Mono or Inter subset',
  },
];

////////////////////////////////////////////////////////////////////////////////
// Reading the font's own declarations
////////////////////////////////////////////////////////////////////////////////

/**
 * Parses one `unicode-range` value into ranges.
 *
 * Handles the three forms the CSS spec allows: a single code point (`U+131`), a range
 * (`U+0000-00FF`) and a wildcard (`U+4??`, which is `U+400-4FF`).
 *
 * @param value - the text after `unicode-range:`, without the semicolon.
 * @returns every range in the value.
 */
function parseUnicodeRange(value: string): CodePointRange[] {
  const ranges: CodePointRange[] = [];
  for (const part of value.split(',')) {
    const token = part.trim().replace(/^U\+/iu, '');
    if (token === '') continue;
    if (token.includes('?')) {
      ranges.push([Number.parseInt(token.replaceAll('?', '0'), 16), Number.parseInt(token.replaceAll('?', 'F'), 16)]);
      continue;
    }
    const [from, to] = token.split('-');
    const low = Number.parseInt(from, 16);
    ranges.push([low, to === undefined ? low : Number.parseInt(to, 16)]);
  }
  return ranges;
}

/**
 * Reads every subset a Victor Mono stylesheet declares.
 *
 * @param css - the text of `index.css`.
 * @returns one subset per `@font-face`, named by its file (`latin`, `latin-ext`, `greek`, ...).
 */
function parseSubsets(css: string): Subset[] {
  const subsets: Subset[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/gu)) {
    const body = block[1];
    const name = /victor-mono-(.+?)-wght-normal\.woff2/u.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/u.exec(body)?.[1];
    if (name === undefined || range === undefined) continue;
    subsets.push({ name, ranges: parseUnicodeRange(range) });
  }
  return subsets;
}

/**
 * The subsets whose ranges cover a code point.
 *
 * @param subsets - the parsed subsets.
 * @param codePoint - the character's code point.
 * @returns the names, in file order; empty when no subset covers it.
 */
function subsetsCovering({ subsets, codePoint }: { subsets: readonly Subset[]; codePoint: number }): string[] {
  return subsets
    .filter((subset) => subset.ranges.some(([low, high]) => codePoint >= low && codePoint <= high))
    .map((subset) => subset.name);
}

////////////////////////////////////////////////////////////////////////////////
// Reading the bundles
////////////////////////////////////////////////////////////////////////////////

/** A JSON value, so a bundle can be walked without a cast. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Any JSON document, parsed recursively. */
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);

/** A JSON object, for walking its entries. */
const jsonObjectSchema = z.record(z.string(), jsonSchema);

/**
 * Every string in a document, keys included, decoded (so an escaped arrow in the file is a real arrow here).
 *
 * @param value - a parsed bundle, or a part of one.
 * @param into - the list to add to.
 */
function collectText(value: Json, into: string[]): void {
  const text = z.string().safeParse(value);
  if (text.success) {
    into.push(text.data);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, into);
    return;
  }
  const object = jsonObjectSchema.safeParse(value);
  if (!object.success) return;
  for (const [key, child] of Object.entries(object.data)) {
    into.push(key);
    collectText(child, into);
  }
}

/** A bundle that was read: which locale and file it is, and every string in it. */
interface Bundle {
  locale: string;
  file: string;
  text: string;
}

/**
 * Reads every locale bundle except the legal texts.
 *
 * @returns one entry per `app/i18n/locales/<locale>/<file>.json`.
 */
function readBundles(): Bundle[] {
  const bundles: Bundle[] = [];
  for (const locale of readdirSync(LOCALES_DIRECTORY).toSorted()) {
    const directory = join(LOCALES_DIRECTORY, locale);
    for (const file of readdirSync(directory).toSorted()) {
      if (!file.endsWith('.json') || file === EXCLUDED_BUNDLE) continue;
      const strings: string[] = [];
      collectText(jsonSchema.parse(JSON.parse(readFileSync(join(directory, file), 'utf8'))), strings);
      bundles.push({ locale, file, text: strings.join('\n') });
    }
  }
  return bundles;
}

/** Where a character first appeared. */
interface Occurrence {
  character: string;
  locale: string;
  file: string;
}

/**
 * Every distinct non-ASCII character in the bundles, with where it first appears.
 *
 * @param bundles - the bundles to scan.
 * @returns one entry per distinct character, in code point order.
 */
function nonAsciiCharacters(bundles: readonly Bundle[]): Occurrence[] {
  const first = new Map<string, Occurrence>();
  for (const bundle of bundles) {
    for (const character of bundle.text) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint < 0x80 || first.has(character)) continue;
      first.set(character, { character, locale: bundle.locale, file: bundle.file });
    }
  }
  return [...first.values()].toSorted((a, b) => (a.character.codePointAt(0) ?? 0) - (b.character.codePointAt(0) ?? 0));
}

/**
 * The characters no subset covers and no known gap explains.
 *
 * @param options - the characters found, the subsets, and the allowlist.
 * @returns the offenders, each with where it was found.
 */
function findUncovered({
  found,
  subsets,
  gaps,
}: {
  found: readonly Occurrence[];
  subsets: readonly Subset[];
  gaps: readonly KnownGap[];
}): Occurrence[] {
  const allowed = new Set(gaps.map((gap) => gap.character));
  return found.filter(
    (occurrence) =>
      !allowed.has(occurrence.character) &&
      subsetsCovering({ subsets, codePoint: occurrence.character.codePointAt(0) ?? 0 }).length === 0,
  );
}

/**
 * The allowlist entries that a subset now covers, which are stale records.
 *
 * @param options - the allowlist and the subsets.
 * @returns the entries whose character a range covers.
 */
function findStaleGaps({ gaps, subsets }: { gaps: readonly KnownGap[]; subsets: readonly Subset[] }): KnownGap[] {
  return gaps.filter((gap) => subsetsCovering({ subsets, codePoint: gap.character.codePointAt(0) ?? 0 }).length > 0);
}

/**
 * The subset files a locale's text needs, counting `latin` as the base every page loads.
 *
 * A character `latin` covers needs no other file, so a code point in both `latin` and another
 * subset (a combining mark, say) is counted once, as `latin`.
 *
 * @param options - the bundles of one locale, the subsets and the allowlist.
 * @returns the needed subset names, sorted.
 */
function subsetsNeededBy({
  bundles,
  subsets,
  gaps,
}: {
  bundles: readonly Bundle[];
  subsets: readonly Subset[];
  gaps: readonly KnownGap[];
}): string[] {
  const allowed = new Set(gaps.map((gap) => gap.character));
  const needed = new Set<string>();
  for (const occurrence of nonAsciiCharacters(bundles)) {
    if (allowed.has(occurrence.character)) continue;
    const covering = subsetsCovering({ subsets, codePoint: occurrence.character.codePointAt(0) ?? 0 });
    needed.add(covering.includes('latin') ? 'latin' : (covering[0] ?? 'none'));
  }
  return [...needed].toSorted();
}

const SUBSETS = parseSubsets(readFileSync(FONT_CSS, 'utf8'));
const BUNDLES = readBundles();
const FOUND = nonAsciiCharacters(BUNDLES);

////////////////////////////////////////////////////////////////////////////////
// The audit
////////////////////////////////////////////////////////////////////////////////

describe('the font glyph audit reads the real font and the real bundles', () => {
  it('reads the six subsets Victor Mono declares, each with ranges', () => {
    assert.deepEqual(
      SUBSETS.map((subset) => subset.name).toSorted(),
      ['cyrillic', 'cyrillic-ext', 'greek', 'latin', 'latin-ext', 'vietnamese'],
    );
    for (const subset of SUBSETS) {
      assert.ok(subset.ranges.length > 0, `${subset.name} has no parsed ranges`);
    }
  });

  it('reads all six locales and leaves the legal texts out', () => {
    assert.equal(new Set(BUNDLES.map((bundle) => bundle.locale)).size, LOCALE_COUNT);
    assert.ok(BUNDLES.length >= LOCALE_COUNT * 2, 'each locale has at least a common and a releases bundle');
    assert.ok(
      BUNDLES.every((bundle) => bundle.file !== EXCLUDED_BUNDLE),
      'the legal bundles must be excluded',
    );
  });

  it('finds the characters the brief names, so the scan is not reading nothing', () => {
    const found = new Set(FOUND.map((occurrence) => occurrence.character));
    for (const character of ['ß', 'ü', 'ı', 'İ', 'ş', 'Ş', 'ğ', 'œ', '→', '←']) {
      assert.ok(found.has(character), `the scan did not find ${character} in any bundle`);
    }
    assert.ok(FOUND.length > 30, `only ${FOUND.length} distinct non-ASCII characters were found`);
  });

  it('covers every non-ASCII character in the bundles, or names it as a known gap', () => {
    const uncovered = findUncovered({ found: FOUND, subsets: SUBSETS, gaps: KNOWN_GAPS });
    assert.deepEqual(
      uncovered.map(
        (occurrence) =>
          `U+${(occurrence.character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')} ${occurrence.character} in ${occurrence.locale}/${occurrence.file}`,
      ),
      [],
      'a character no Victor Mono subset covers will be drawn mid-line by another face; cover it or add it to KNOWN_GAPS with a reason',
    );
  });

  it('keeps every known gap a real gap, so a closed one is noticed and deleted', () => {
    assert.deepEqual(
      findStaleGaps({ gaps: KNOWN_GAPS, subsets: SUBSETS }).map((gap) => gap.character),
      [],
      'a subset now covers this character, so its KNOWN_GAPS entry is stale',
    );
  });

  it('gives every known gap a reason', () => {
    for (const gap of KNOWN_GAPS) {
      assert.ok(gap.why.length > 20, `${gap.character} needs a reason that says where it is used and why it is allowed`);
    }
    assert.equal(new Set(KNOWN_GAPS.map((gap) => gap.character)).size, KNOWN_GAPS.length, 'no duplicate entries');
  });

  it('covers the Turkish and German letters the brief lists, in the latin or latin-ext subset', () => {
    for (const character of ['ı', 'İ', 'ş', 'Ş', 'ğ', 'Ğ', 'ẞ', 'ß', 'ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü']) {
      const covering = subsetsCovering({ subsets: SUBSETS, codePoint: character.codePointAt(0) ?? 0 });
      assert.ok(
        covering.includes('latin') || covering.includes('latin-ext'),
        `${character} is covered by no latin subset (${covering.join(', ') || 'none'})`,
      );
    }
  });
});

describe('the audit can fail', () => {
  it('reports a character outside every range and outside the allowlist', () => {
    const snowman: Occurrence = { character: '☃', locale: 'control', file: 'control.json' };
    const uncovered = findUncovered({ found: [snowman], subsets: SUBSETS, gaps: KNOWN_GAPS });
    assert.deepEqual(uncovered, [snowman], 'a snowman is in no Victor Mono range and no allowlist, so it must fail');
  });

  it('reports a known gap once the allowlist no longer names it', () => {
    const arrow: Occurrence = { character: '→', locale: 'control', file: 'control.json' };
    assert.deepEqual(findUncovered({ found: [arrow], subsets: SUBSETS, gaps: KNOWN_GAPS }), [], 'allowlisted');
    assert.deepEqual(findUncovered({ found: [arrow], subsets: SUBSETS, gaps: [] }), [arrow], 'not allowlisted');
  });

  it('would fail on the real bundles without the allowlist, on exactly the two arrows they use', () => {
    // The real scan, the real ranges, and no allowlist: the audit must have something to say.
    assert.deepEqual(
      findUncovered({ found: FOUND, subsets: SUBSETS, gaps: [] }).map((occurrence) => occurrence.character),
      ['←', '→'],
    );
  });

  it('does not report a covered character', () => {
    const covered: Occurrence = { character: 'ı', locale: 'control', file: 'control.json' };
    assert.deepEqual(findUncovered({ found: [covered], subsets: SUBSETS, gaps: [] }), []);
  });

  it('reports an allowlist entry that a range covers as stale', () => {
    const stale: KnownGap = { character: 'ı', why: 'a control entry that a range covers, so it is stale' };
    assert.deepEqual(findStaleGaps({ gaps: [stale], subsets: SUBSETS }), [stale]);
  });

  it('parses a single code point, a range and a wildcard', () => {
    assert.deepEqual(parseUnicodeRange('U+0131'), [[0x131, 0x131]]);
    assert.deepEqual(parseUnicodeRange('U+0000-00FF,U+2212'), [
      [0x0, 0xff],
      [0x2212, 0x2212],
    ]);
    assert.deepEqual(parseUnicodeRange('U+4??'), [[0x400, 0x4ff]]);
  });
});

describe('which subset files each locale needs', () => {
  /** The record. Only Turkish needs the second file, and that is why it has a first paint check. */
  const NEEDED = new Map<string, readonly string[]>([
    ['de', ['latin']],
    ['en', ['latin']],
    ['es', ['latin']],
    ['fr', ['latin']],
    ['it', ['latin']],
    ['tr', ['latin', 'latin-ext']],
  ]);

  it('matches the record, so a locale that starts needing a second file is noticed', () => {
    for (const [locale, expected] of NEEDED) {
      const needed = subsetsNeededBy({
        bundles: BUNDLES.filter((bundle) => bundle.locale === locale),
        subsets: SUBSETS,
        gaps: KNOWN_GAPS,
      });
      assert.deepEqual(
        needed,
        [...expected],
        `${locale} now needs ${needed.join(' + ')}. A second file swaps in late and reflows the first paint: extend tests/e2e/lcc-lineage-turkish-first-paint.spec.ts to ${locale}, then update this record.`,
      );
    }
  });

  it('reads the record from all six locales', () => {
    assert.equal(NEEDED.size, LOCALE_COUNT);
    assert.deepEqual([...NEEDED.keys()].toSorted(), [...new Set(BUNDLES.map((bundle) => bundle.locale))].toSorted());
  });

  it('can tell a locale that needs one file from one that needs two', () => {
    const turkish = subsetsNeededBy({ bundles: BUNDLES.filter((bundle) => bundle.locale === 'tr'), subsets: SUBSETS, gaps: KNOWN_GAPS });
    const english = subsetsNeededBy({ bundles: BUNDLES.filter((bundle) => bundle.locale === 'en'), subsets: SUBSETS, gaps: KNOWN_GAPS });
    assert.notDeepEqual(turkish, english);
  });
});
