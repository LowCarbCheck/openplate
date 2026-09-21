/**
 * The brand role belongs to the word "openplate" and to nothing else (M243 spec 02, the recipe
 * of 2026-09-21).
 *
 * The role is `--font-brand`, reached through the `font-display` utility. It used to be Fraunces,
 * a display serif that sat on every card title, the header page title, a live number and nine
 * landing headings. It is Victor Mono at weight 100 now, and it still belongs to one component:
 * `Wordmark` (`app/components/wordmark.tsx`) is the ONE place that writes the class, and this file
 * fails the build if any other file under `app/` does. A card title in the brand role is thin
 * where every other title is semibold, which is the template tell M243 removed in another form.
 *
 * ── WHAT COUNTS AS A USE ──
 * A whole class token inside a STRING LITERAL: `font-display`, its variants (`md:font-display`,
 * `!font-display`) and the brand role's own utility, `font-brand`, which would be a way round
 * the ban. A comment that names the class is not a use, a longer word (`font-displayed`) is not
 * the token, and the `font-display` PROPERTY in a stylesheet's `@font-face` is not a class, so
 * the sweep reads TypeScript and TSX only. `app.css` is checked separately for an `@apply` of
 * either token, which is the one way a stylesheet could take the role without a component.
 *
 * ── EVERY ASSERTION HAS A CONTROL ──
 * The sweep is fed fixtures that must be caught (the class in another file, behind a variant,
 * as `font-brand`) and fixtures that must not be (a comment, a longer word, the CSS property).
 * It must also find the class in `wordmark.tsx` itself, so a sweep that matched nothing at all
 * cannot pass by being blind. The live-figure guards in `fast-chip.test.ts` and
 * `fasting-strip.test.ts` stay: they are the same rule read at the two figures most likely to
 * break it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Wordmark } from '../../app/components/wordmark';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP = join(ROOT, 'app');

/** The one file that may write the brand role's utilities. */
const WORDMARK_FILE = 'app/components/wordmark.tsx';

/** The utilities that draw in the brand role. `font-brand` is the role, `font-display` the alias. */
const BRAND_UTILITIES = ['font-display', 'font-brand'] as const;

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

/** The token with any `variant:` prefixes and a leading `!` removed, so `md:!font-display` is `font-display`. */
function bareUtility(token: string): string {
  const last = token.split(':').at(-1) ?? token;
  return last.startsWith('!') ? last.slice(1) : last;
}

/** Whether a class literal asks for one of the brand utilities, as a whole token. */
function asksForBrandRole(literal: string): boolean {
  return literal.split(/\s+/).some((token) => BRAND_UTILITIES.some((utility) => bareUtility(token) === utility));
}

/** The `path:line` of every brand-role use in `source`, labelled with `path`. */
function brandUsesIn({ path, source }: { path: string; source: string }): string[] {
  return literalsOf(source)
    .filter(([literal]) => asksForBrandRole(literal))
    .map(([, line]) => `${path}:${line}`);
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

/** Every brand-role use under `app/`, as `path:line`, wordmark file included. */
function everyBrandUse(): string[] {
  return sourceFiles(APP).flatMap((file) =>
    brandUsesIn({ path: relative(ROOT, file), source: readFileSync(file, 'utf8') }),
  );
}

describe('the brand role is the wordmark and only the wordmark', () => {
  it('is written in exactly one file under app/: the Wordmark component', () => {
    const files = [...new Set(everyBrandUse().map((use) => use.split(':')[0]))];
    assert.deepEqual(files, [WORDMARK_FILE], `another file asks for the brand role: ${files.join(', ')}`);
  });

  it('is not applied by an @apply in the stylesheet', () => {
    const css = readFileSync(join(APP, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const applies = [...css.matchAll(/@apply\s+([^;]*);/g)].map((match) => match[1]);
    const offenders = applies.filter((applied) => asksForBrandRole(applied));
    assert.deepEqual(offenders, [], 'the stylesheet must not take the brand role through @apply');
  });

  it('CONTROL: the sweep finds the class in the Wordmark file, so it is not blind', () => {
    const inWordmark = brandUsesIn({
      path: WORDMARK_FILE,
      source: readFileSync(join(ROOT, WORDMARK_FILE), 'utf8'),
    });
    assert.ok(inWordmark.length > 0, 'wordmark.tsx must be seen carrying font-display');
  });

  it('CONTROL: a card title, a variant, a template literal and font-brand in another file are all caught', () => {
    const elsewhere = 'app/routes/x.tsx';
    const caught = (source: string): string[] => brandUsesIn({ path: elsewhere, source });
    assert.deepEqual(caught('const a = <h3 className="font-display text-lg">t</h3>;'), [`${elsewhere}:1`]);
    assert.deepEqual(caught('const a = cn("text-sm", "md:font-display");'), [`${elsewhere}:1`]);
    assert.deepEqual(caught('const a = "x";\nconst b = `mt-2 !font-display`;'), [`${elsewhere}:2`]);
    assert.deepEqual(caught('const a = "font-brand text-xl";'), [`${elsewhere}:1`]);
  });

  it('CONTROL: a comment, a longer word, another utility and the CSS property are not caught', () => {
    const elsewhere = 'app/routes/x.tsx';
    const caught = (source: string): string[] => brandUsesIn({ path: elsewhere, source });
    assert.deepEqual(caught('// never "font-display" on a live number\nconst a = 1;'), []);
    assert.deepEqual(caught('/* the "font-display" utility */\nconst a = 1;'), []);
    assert.deepEqual(caught('const a = "font-displayed text-lg";'), [], 'a longer word is a different token');
    assert.deepEqual(caught('const a = "font-sans font-mono font-prose font-body";'), [], 'the other roles are free');
    assert.deepEqual(caught('const a = "text-lg";\nconst b = { fontDisplay: "swap" };'), []);
  });

  it('walked the whole tree, so the sweep is not empty', () => {
    const files = sourceFiles(APP);
    assert.ok(files.length > 300, `expected the whole app tree, walked ${files.length} files`);
  });
});

describe('Wordmark', () => {
  it('renders the word openplate, "open" in teal, thin, in a span by default', () => {
    const markup = renderToStaticMarkup(createElement(Wordmark));
    assert.match(
      markup,
      /^<span class="font-display font-thin tracking-\[-0\.03em\]"><span class="text-primary">open<\/span>plate<\/span>$/,
    );
  });

  it('reads as one word: the text is openplate, with no space where the colour changes', () => {
    const text = renderToStaticMarkup(createElement(Wordmark)).replace(/<[^>]+>/g, '');
    assert.equal(text, 'openplate');
  });

  it('keeps the caller size and ink, and can be the landing h1', () => {
    const markup = renderToStaticMarkup(createElement(Wordmark, { as: 'h1', className: 'text-5xl sm:text-6xl' }));
    assert.match(markup, /^<h1 class="font-display font-thin tracking-\[-0\.03em\] text-5xl sm:text-6xl">/);
    assert.match(markup, /<\/h1>$/);
  });

  it('lifts the word only when it sits beside the mark', () => {
    const beside = renderToStaticMarkup(createElement(Wordmark, { besideMark: true }));
    const alone = renderToStaticMarkup(createElement(Wordmark));
    assert.match(beside, /relative top-\[-0\.08em\]/);
    assert.doesNotMatch(alone, /top-\[/, 'the kicker and the landing heading have no mark beside them');
  });

  it('keeps the weight and the tracking whatever size and ink the caller passes', () => {
    const markup = renderToStaticMarkup(createElement(Wordmark, { className: 'text-lg text-foreground' }));
    assert.match(markup, /font-thin/);
    assert.match(markup, /tracking-\[-0\.03em\]/);
  });

  it('forwards aria-hidden, which the header kicker relies on', () => {
    const markup = renderToStaticMarkup(createElement(Wordmark, { 'aria-hidden': 'true' }));
    assert.match(markup, /aria-hidden="true"/);
  });

  it('CONTROL: a plain span in the same reader does not read as the wordmark', () => {
    const plain = renderToStaticMarkup(createElement('span', { className: 'text-lg' }, 'openplate'));
    assert.doesNotMatch(plain, /font-display/, 'the reader must be able to say no');
    assert.doesNotMatch(plain, /font-thin/, 'the reader must be able to say no');
    assert.doesNotMatch(plain, /text-primary/, 'the reader must be able to say no');
  });
});

/** How many `<Wordmark` tags in a source file ask for `besideMark`, and how many do not. */
interface WordmarkUses {
  lifted: number;
  alone: number;
}

describe('the places that draw the word', () => {
  function usesOf(path: string): WordmarkUses {
    const tags = readFileSync(join(ROOT, path), 'utf8').match(/<Wordmark\b[^>]*>/g) ?? [];
    return {
      lifted: tags.filter((tag) => /\bbesideMark\b/.test(tag)).length,
      alone: tags.filter((tag) => !/\bbesideMark\b/.test(tag)).length,
    };
  }

  it('lifts the word wherever the mark is beside it: sidebar, public header, onboarding, the drawer', () => {
    for (const path of ['app/components/app-sidebar.tsx', 'app/components/public-wrapper.tsx', 'app/routes/onboarding.tsx']) {
      assert.deepEqual(usesOf(path), { lifted: 1, alone: 0 }, `${path} draws the word beside the mark`);
    }
    assert.equal(usesOf('app/components/app-wrapper.tsx').lifted, 1, 'the drawer header lifts the word');
  });

  it('leaves the word alone where no mark is beside it: the phone kicker and the landing heading', () => {
    assert.equal(usesOf('app/components/app-wrapper.tsx').alone, 1, 'the kicker is the one lone use in app-wrapper');
    assert.deepEqual(usesOf('app/routes/index.tsx'), { lifted: 0, alone: 1 }, 'the landing heading has no mark beside it');
  });

  it('CONTROL: the reader tells a lifted tag from a lone one', () => {
    const lifted = '<Wordmark besideMark className="text-lg" />'.match(/<Wordmark\b[^>]*>/g) ?? [];
    const alone = '<Wordmark className="text-lg" />'.match(/<Wordmark\b[^>]*>/g) ?? [];
    assert.equal(lifted.filter((tag) => /\bbesideMark\b/.test(tag)).length, 1);
    assert.equal(alone.filter((tag) => /\bbesideMark\b/.test(tag)).length, 0);
  });

  /** A weight or a tracking class on a `<Wordmark`: the recipe belongs to the component, not the caller. */
  const RECIPE_CLASS = /font-(?:thin|light|normal|medium|semibold|bold)|tracking-/;

  it('CONTROL: the recipe reader flags a tag that passes a weight or a tracking', () => {
    assert.match('<Wordmark className="text-lg font-semibold" />', RECIPE_CLASS);
    assert.match('<Wordmark className="text-5xl tracking-tight" />', RECIPE_CLASS);
    assert.doesNotMatch('<Wordmark besideMark className="text-lg text-foreground" />', RECIPE_CLASS);
  });

  it('passes no weight or tracking class to the word: the recipe is in the component', () => {
    for (const path of [
      'app/components/app-sidebar.tsx',
      'app/components/app-wrapper.tsx',
      'app/components/public-wrapper.tsx',
      'app/routes/onboarding.tsx',
      'app/routes/index.tsx',
    ]) {
      const tags = readFileSync(join(ROOT, path), 'utf8').match(/<Wordmark\b[^>]*>/g) ?? [];
      for (const tag of tags) {
        assert.doesNotMatch(tag, RECIPE_CLASS, `${path}: ${tag}`);
      }
    }
  });
});
