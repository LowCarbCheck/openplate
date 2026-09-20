/**
 * The section label, pinned (M243 spec 02): small, semibold, uppercase, lightly tracked and
 * GREY, with a border-coloured hairline when it trails.
 *
 * `SectionEyebrow` has about twenty call sites and had no test at all. It was brand teal with
 * wide tracking, sitting over a serif card title on every card, which is the most reproduced
 * generated-template signature there is. One edit de-tealised every call site, and this file
 * is what stops it drifting back: a `text-primary` on the label, or on ANY uppercase label
 * anywhere under `app/`, fails here.
 *
 * ── THE TWO HALVES ──
 * 1. The component, rendered, so the tokens on the element the browser sees are what is read.
 * 2. A sweep of every string literal under `app/`: no literal may carry the bare `uppercase`
 *    and the bare `text-primary` together. `fast-strip.tsx` inlined its own copy of the recipe
 *    and stayed teal after the component went grey, which is exactly what a component test
 *    alone cannot see. A VARIANT (`hover:text-primary`, `data-[state=active]:text-primary`) is
 *    an active state and is allowed: teal is spent on the thing that is on, never on a label.
 *
 * ── EVERY ASSERTION HAS A CONTROL ──
 * Each predicate is whole-token, so `sm:uppercase` and `hover:text-primary` do not confuse it,
 * while a teal with an alpha (`text-primary/70`) still counts as teal. Each one is also fed a
 * bad input that must make it answer no: the old teal recipe string, a teal rule, an inline
 * copy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SECTION_EYEBROW_CLASS, SectionEyebrow } from '../../app/components/typography';
import { SECTION_EYEBROW_RULE_TOKEN, SECTION_EYEBROW_TOKENS } from '../design-contract';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP = join(ROOT, 'app');

/** The recipe as it was before M243: teal, and four times the tracking. */
const OLD_TEAL_RECIPE = 'text-xs font-semibold uppercase tracking-[0.11em] text-primary';

/** The whitespace-separated tokens of the first `class="..."` attribute of a single-element render. */
function classTokensOf(markup: string): string[] {
  const match = /class="([^"]*)"/.exec(markup);
  if (match === null) throw new Error(`No class attribute in: ${markup}`);
  return match[1].split(/\s+/);
}

/** The class tokens of every element in a render that carries a `class`, in document order. */
function everyClassListIn(markup: string): string[][] {
  return [...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1].split(/\s+/));
}

/** Whether `tokens` holds every recipe token and no teal on the label. */
function isGreyRecipe(tokens: readonly string[]): boolean {
  const hasEveryToken = SECTION_EYEBROW_TOKENS.every((token) => tokens.includes(token));
  return hasEveryToken && !tokens.some(isBareTealText) && !tokens.includes('tracking-[0.11em]');
}

/** Whether a rule element's tokens draw it in the border colour and not in the brand colour. */
function isBorderRule(tokens: readonly string[]): boolean {
  return tokens.includes(SECTION_EYEBROW_RULE_TOKEN) && !tokens.some((token) => token.startsWith('bg-primary'));
}

/** The string literals of a source file, comments removed, as `[literal, line]` pairs. */
function literalsOf(source: string): [string, number][] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
  const found: [string, number][] = [];
  for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const line = code.slice(0, match.index).split('\n').length;
    found.push([match[2], line]);
  }
  return found;
}

/** Whether a class token paints text in the brand colour, at any alpha, and with no variant in front. */
function isBareTealText(token: string): boolean {
  return token === 'text-primary' || token.startsWith('text-primary/');
}

/** Whether a class literal wears the bare `uppercase` token together with bare teal text. */
function isTealMicroCaps(literal: string): boolean {
  const tokens = literal.split(/\s+/);
  return tokens.includes('uppercase') && tokens.some(isBareTealText);
}

/** Every `.ts` and `.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe('SectionEyebrow', () => {
  it('renders the grey recipe: small, semibold, uppercase, tracking-wide, muted-foreground', () => {
    const tokens = classTokensOf(renderToStaticMarkup(createElement(SectionEyebrow, {}, 'Breakfast')));
    assert.equal(isGreyRecipe(tokens), true, `expected the grey recipe, got: ${tokens.join(' ')}`);
  });

  it('is NOT teal: text-primary is absent from the label', () => {
    const tokens = classTokensOf(renderToStaticMarkup(createElement(SectionEyebrow, {}, 'Breakfast')));
    assert.equal(tokens.includes('text-primary'), false);
    assert.equal(
      tokens.some((token) => token.startsWith('text-primary')),
      false,
    );
  });

  it('exports the same recipe the component renders, token for token', () => {
    assert.deepEqual(SECTION_EYEBROW_CLASS.split(/\s+/).toSorted(), [...SECTION_EYEBROW_TOKENS].toSorted());
  });

  it('keeps its element: a p by default, an h2 on request, and both wear the recipe', () => {
    const paragraph = renderToStaticMarkup(createElement(SectionEyebrow, {}, 'Goals'));
    const heading = renderToStaticMarkup(createElement(SectionEyebrow, { as: 'h2' }, 'Goals'));
    assert.match(paragraph, /^<p /);
    assert.match(heading, /^<h2 /);
    assert.equal(isGreyRecipe(classTokensOf(heading)), true);
  });

  it('draws the trailing rule in the border colour, and puts the caller class on the wrapper', () => {
    const markup = renderToStaticMarkup(
      createElement(SectionEyebrow, { trailingRule: true, className: 'mb-2' }, 'Lunch'),
    );
    const lists = everyClassListIn(markup);
    const wrapper = lists[0];
    const label = lists[1];
    const rule = lists[2];
    assert.ok(wrapper.includes('mb-2'), 'the caller className belongs on the wrapper when a rule trails');
    assert.equal(label.includes('mb-2'), false, 'and not on the label');
    assert.equal(isGreyRecipe(label), true, 'the label is still the grey recipe');
    assert.equal(isBorderRule(rule), true, `the rule must be bg-border, got: ${rule.join(' ')}`);
  });

  it('CONTROL: the old teal recipe, a teal rule and a half-recipe all answer no', () => {
    assert.equal(isGreyRecipe(OLD_TEAL_RECIPE.split(/\s+/)), false, 'the old string must fail the grey check');
    assert.equal(
      isGreyRecipe([...SECTION_EYEBROW_TOKENS, 'text-primary']),
      false,
      'a label that is grey AND teal must fail',
    );
    assert.equal(
      isGreyRecipe([...SECTION_EYEBROW_TOKENS, 'text-primary/80']),
      false,
      'a teal with an alpha is still teal',
    );
    assert.equal(isGreyRecipe(['text-xs', 'uppercase']), false, 'a partial recipe must fail');
    assert.equal(isBorderRule(['h-px', 'flex-1', 'bg-primary/20']), false, 'the old teal rule must fail');
    assert.equal(isBorderRule(['h-px', 'flex-1', 'bg-border']), true, 'the border rule passes');
  });
});

describe('no teal micro-caps anywhere under app/', () => {
  it('walked the whole tree, so the sweep is not empty', () => {
    // CONTROL for the sweep: zero files would pass it while proving nothing.
    const files = sourceFiles(APP);
    assert.ok(files.length > 300, `expected the whole app tree, walked ${files.length} files`);
  });

  it('finds no string literal with a bare uppercase and a bare text-primary together', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(APP)) {
      for (const [literal, line] of literalsOf(readFileSync(file, 'utf8'))) {
        if (isTealMicroCaps(literal)) offenders.push(`${relative(ROOT, file)}:${line}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a teal uppercase label is the template signature M243 removed. Use SECTION_EYEBROW_CLASS: ${offenders.join(', ')}`,
    );
  });

  it('CONTROL: the sweep sees a plain teal label, an inline copy and a template literal, and lets an active state through', () => {
    assert.equal(isTealMicroCaps(OLD_TEAL_RECIPE), true, 'the old recipe must be caught');
    assert.equal(
      isTealMicroCaps('block text-[11px] font-semibold uppercase tracking-[0.11em] text-primary'),
      true,
      'the fast-strip copy must be caught',
    );
    assert.equal(isTealMicroCaps('uppercase hover:text-primary'), false, 'a hover state is an active state');
    assert.equal(
      isTealMicroCaps('uppercase data-[state=active]:text-primary'),
      false,
      'a selected state is an active state',
    );
    assert.equal(isTealMicroCaps('uppercase text-primary/70'), true, 'a teal with an alpha is still teal');
    assert.equal(isTealMicroCaps('normal-case text-primary'), false, 'teal without caps is not micro-caps');

    const caught = literalsOf('const a = "x";\nconst b = `uppercase text-primary`;\n// "uppercase text-primary"\n');
    assert.deepEqual(
      caught.filter(([literal]) => isTealMicroCaps(literal)),
      [['uppercase text-primary', 2]],
      'a template literal is caught on its own line and a comment line is not',
    );
  });
});
