/**
 * DESIGN.md moves with the design, or this file goes red.
 *
 * ── WHY ──
 * The document contradicted the tree for eleven months. Section 1.5 taught `rounded-2xl` primary
 * cards while section 5 taught `rounded-lg`; section 4 said the body font was Inter after it was
 * not. A contract nobody can trust is read once and then ignored, and the next person re-derives
 * the language from whatever component they happen to open. So the two things M243 pinned as
 * NUMBERS AND NAMES elsewhere, the font roles in `app/app.css`'s `@theme` block and the radius
 * ladder in `tests/design-contract.ts`, must also appear in `DESIGN.md`.
 *
 * ── WHAT THIS DOES AND DOES NOT CHECK ──
 * It checks that the document NAMES each role and each rung, not that the prose around them is
 * good. A sixth font role or a sixth radius tier therefore fails here until somebody writes the
 * sentence that explains it, which is the whole point: the edit that adds the rung is the edit
 * that documents it.
 *
 * It deliberately does NOT read the CSS the other way round. `lcc-lineage-foundation.test.ts`
 * already asserts what each role DECLARES, and `radius-tiers.test.ts` already asserts which files
 * may draw which class. Duplicating either here would mean two files to update for one change.
 *
 * ── EVERY ASSERTION HAS A CONTROL ──
 * `document.includes('--font-body')` is the kind of check that passes forever once it is written,
 * including against a document that says the opposite. So each predicate below is also run
 * against a fixture built to make it answer no: a document missing a role, a ladder row whose
 * class belongs to the tier above, a row that dropped its pixel size.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  BODY_STACK,
  BRAND_STACK,
  PROSE_STACK,
  RADIUS_TIER_CLASS,
  RADIUS_TIER_PX,
  type RadiusTier,
} from '../design-contract';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_CSS = readFileSync(join(ROOT, 'app/app.css'), 'utf8');
const DESIGN_MD = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');

/** How many `--font-*` names the `@theme` block carries today, so a deleted role also fails. */
const FONT_NAME_COUNT = 6;

/**
 * The ladder's rungs, in the order `tests/design-contract.ts` declares them. Written out rather
 * than read off `RADIUS_TIER_PX`'s keys, because `Object.keys` answers `string[]` and narrowing it
 * back would be an unchecked assertion. The first test below compares the two lists, so a sixth
 * tier added over there fails here until it is added to this line and to DESIGN.md.
 */
const RADIUS_TIERS = ['dataRow', 'control', 'card', 'tile', 'hero'] as const satisfies readonly RadiusTier[];

/** The stylesheet with every block comment removed, so a name written only in prose is not a name. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The body of the first `@theme { … }` block, brace matched.
 *
 * `@theme inline` further down the file declares the sidebar colours and no font at all, so the
 * match is anchored on the opening brace rather than on the at-rule name alone.
 *
 * @param css - the whole stylesheet.
 * @returns the declarations between the braces, or null when there is no such block.
 */
function themeBlockOf(css: string): string | null {
  const source = withoutComments(css);
  const start = source.search(/@theme\s*\{/u);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

/** Every `--font-*` custom property the `@theme` block declares, in file order, deduplicated. */
function fontNamesOf(css: string): string[] {
  const block = themeBlockOf(css);
  if (block === null) return [];
  const names = [...block.matchAll(/(--font-[a-z0-9-]+)\s*:/gu)].map((match) => match[1]);
  return [...new Set(names)];
}

/** Whether `document` writes `name` as a whole token, so `--font-brand` never satisfies `--font-b`. */
function namesToken({ document, name }: { document: string; name: string }): boolean {
  return new RegExp(`${name}(?![a-z0-9-])`, 'u').test(document);
}

/** Every `--font-*` name the `@theme` block declares that `document` never writes. */
function fontNamesMissingFrom({ document, css }: { document: string; css: string }): string[] {
  return fontNamesOf(css).filter((name) => !namesToken({ document, name }));
}

/**
 * The one line of `document` that names `tier`, or null when no line does.
 *
 * A LINE, not the whole document, because the ladder is a table and the point of the table is
 * that the tier, its class and its pixel size sit together. Spread across three paragraphs they
 * could each be right and the row still be wrong.
 *
 * @param document - the document's text.
 * @param tier - the tier name, as `tests/design-contract.ts` spells it.
 * @returns the first line carrying the tier name in backticks.
 */
function ladderRowFor({ document, tier }: { document: string; tier: RadiusTier }): string | null {
  return document.split('\n').find((line) => line.includes(`\`${tier}\``)) ?? null;
}

/** Whether the ladder row for `tier` carries its class as a whole token and its pixel size. */
function ladderRowIsComplete({ document, tier }: { document: string; tier: RadiusTier }): boolean {
  const row = ladderRowFor({ document, tier });
  if (row === null) return false;
  const carriesClass = row.includes(`\`${RADIUS_TIER_CLASS[tier]}\``);
  const carriesPx = new RegExp(`(?<![0-9])${RADIUS_TIER_PX[tier]}(?![0-9])`, 'u').test(row);
  return carriesClass && carriesPx;
}

/** Every tier whose row in `document` is missing, incomplete, or carries the wrong class. */
function tiersMissingFrom(document: string): RadiusTier[] {
  return RADIUS_TIERS.filter((tier) => !ladderRowIsComplete({ document, tier }));
}

describe('DESIGN.md names every font role in the @theme block', () => {
  it('finds the block, and it declares the names this test expects to judge', () => {
    assert.notEqual(themeBlockOf(APP_CSS), null, 'app.css must have an `@theme { … }` block');
    assert.equal(
      fontNamesOf(APP_CSS).length,
      FONT_NAME_COUNT,
      `expected ${FONT_NAME_COUNT} --font-* names, found: ${fontNamesOf(APP_CSS).join(', ')}`,
    );
  });

  it('DESIGN.md writes every one of them', () => {
    assert.deepEqual(
      fontNamesMissingFrom({ document: DESIGN_MD, css: APP_CSS }),
      [],
      'a --font-* name reached app.css without reaching DESIGN.md section 4',
    );
  });

  it('DESIGN.md quotes the three role stacks the tests hold', () => {
    for (const stack of [BODY_STACK, PROSE_STACK, BRAND_STACK]) {
      assert.ok(DESIGN_MD.includes(stack), `DESIGN.md section 4 must quote the stack \`${stack}\``);
    }
  });

  it('CONTROL: a document missing a role, and a near-miss name, both answer no', () => {
    const stripped = DESIGN_MD.split('--font-prose').join('--font-elsewhere');
    assert.deepEqual(
      fontNamesMissingFrom({ document: stripped, css: APP_CSS }),
      ['--font-prose'],
      'a document that dropped the prose role must fail',
    );
    assert.equal(namesToken({ document: '--font-bodyish', name: '--font-body' }), false, 'a longer name is not the name');
    assert.equal(namesToken({ document: '--font-body', name: '--font-body' }), true, 'the name itself must match');
  });

  it('CONTROL: a stylesheet whose @theme block declares no font answers with an empty list', () => {
    assert.deepEqual(fontNamesOf('@theme { --radius: 0.5rem; }'), [], 'no font declared, no name found');
    assert.deepEqual(fontNamesOf('.prose { font-family: var(--font-prose); }'), [], 'a rule is not the theme block');
  });
});

describe('DESIGN.md names every rung of the radius ladder', () => {
  it('judges exactly the tiers the design contract declares, in its order', () => {
    assert.deepEqual(
      Object.keys(RADIUS_TIER_PX),
      [...RADIUS_TIERS],
      'a tier was added to or removed from `tests/design-contract.ts`; add it here and to DESIGN.md section 5',
    );
  });

  it('every tier has a row carrying its name, its class and its pixel size', () => {
    assert.deepEqual(
      tiersMissingFrom(DESIGN_MD),
      [],
      'DESIGN.md section 5 must carry one table row per tier in `tests/design-contract.ts`',
    );
  });

  it('CONTROL: a row with the wrong class, a row with no pixel size, and a missing row all fail', () => {
    const wrongClass = '| `card` | `rounded-2xl` | 8 | every card |';
    assert.equal(ladderRowIsComplete({ document: wrongClass, tier: 'card' }), false, 'the hero class is not the card class');

    const noPixels = '| `card` | `rounded-lg` | every card |';
    assert.equal(ladderRowIsComplete({ document: noPixels, tier: 'card' }), false, 'a row without 8 is not a row');

    const complete = '| `card` | `rounded-lg` | 8 | every card |';
    assert.equal(ladderRowIsComplete({ document: complete, tier: 'card' }), true, 'the real row must pass');

    const withoutTile = DESIGN_MD.split('`tile`').join('`tiles`');
    assert.deepEqual(tiersMissingFrom(withoutTile), ['tile'], 'a document that dropped the tile rung must fail');
  });

  it('CONTROL: the data row rung is not satisfied by a longer class', () => {
    const rounder = '| `dataRow` | `rounded-md` | 4 | a data row |';
    assert.equal(ladderRowIsComplete({ document: rounder, tier: 'dataRow' }), false, '`rounded-md` is the control step');
  });
});
