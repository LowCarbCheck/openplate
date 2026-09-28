/**
 * DESIGN.md moves with the design, or this file goes red.
 *
 * ── WHY ──
 * The document contradicted the tree for eleven months. Section 1.5 taught `rounded-2xl` primary
 * cards while section 5 taught `rounded-lg`; section 4 said the body font was Inter after it was
 * not. A contract nobody can trust is read once and then ignored, and the next person re-derives
 * the language from whatever component they happen to open. So the thing M243 pinned as NUMBERS
 * AND NAMES elsewhere, the font roles in `app/app.css`'s `@theme` block, must also appear in
 * `DESIGN.md`. The radius ladder M243 spec 03 pinned the same way is gone: the operator squared
 * every corner in the app on 2026-09-22, and DESIGN.md's own square-corner rule is checked below
 * by content rather than by a rung-by-rung table, because there is no longer a table to keep in
 * sync.
 *
 * ── WHAT THIS DOES AND DOES NOT CHECK ──
 * It checks that the document NAMES each role, not that the prose around it is good. A sixth font
 * role therefore fails here until somebody writes the sentence that explains it, which is the whole
 * point: the edit that adds the role is the edit that documents it.
 *
 * It deliberately does NOT read the CSS the other way round. `lcc-lineage-foundation.test.ts`
 * already asserts what each role DECLARES. Duplicating it here would mean two files to update for
 * one change.
 *
 * ── EVERY ASSERTION HAS A CONTROL ──
 * `document.includes('--font-body')` is the kind of check that passes forever once it is written,
 * including against a document that says the opposite. So each predicate below is also run
 * against a fixture built to make it answer no: a document missing a role, a document that dropped
 * the square-corner sentence or the `rounded-full` exception.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { BODY_STACK, BRAND_STACK, PROSE_STACK } from '../design-contract';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_CSS = readFileSync(join(ROOT, 'app/app.css'), 'utf8');
const DESIGN_MD = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');

/** How many `--font-*` names the `@theme` block carries today, so a deleted role also fails. */
const FONT_NAME_COUNT = 6;

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

/** The literal sentence DESIGN.md section 5 states the square-corner rule in. */
const SQUARE_CORNER_SENTENCE = 'Every corner is square.';

/** Whether `document` states the square-corner rule and names its one exception. */
function documentTeachesSquareCorners(document: string): boolean {
  return document.includes(SQUARE_CORNER_SENTENCE) && document.includes('`rounded-full`');
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

describe('DESIGN.md states the square-corner rule', () => {
  it('says every corner is square, and names the one exception', () => {
    assert.ok(
      documentTeachesSquareCorners(DESIGN_MD),
      'DESIGN.md section 5 must state the square-corner rule and quote `rounded-full`',
    );
  });

  it('does not still teach the retired radius ladder', () => {
    assert.doesNotMatch(
      DESIGN_MD,
      /\|\s*`dataRow`\s*\|/u,
      'the five-step radius ladder table was retired 2026-09-22; DESIGN.md section 5 must not still carry it',
    );
  });

  it('CONTROL: a document missing the sentence, and one missing the exception, both answer no', () => {
    assert.equal(
      documentTeachesSquareCorners(DESIGN_MD.split(SQUARE_CORNER_SENTENCE).join('Corners are small.')),
      false,
      'a document that dropped the square-corner sentence must fail',
    );
    assert.equal(
      documentTeachesSquareCorners(DESIGN_MD.split('`rounded-full`').join('a round shape')),
      false,
      'a document that dropped the `rounded-full` exception must fail',
    );
    assert.equal(documentTeachesSquareCorners(DESIGN_MD), true, 'the real document must pass');
  });
});
