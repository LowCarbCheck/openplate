/**
 * The display serif belongs to the word "openplate" and to nothing else (M243 spec 02).
 *
 * Fraunces used to sit on every card title, the header page title, a live number on the
 * pulse tile, a card title override and nine landing headings. A serif used once, on the
 * product's own name, is a signature. A serif on everything is the generated-template tell
 * this milestone removed. `Wordmark` (`app/components/wordmark.tsx`) is the ONE component
 * that writes the class, and this file fails the build if any other file under `app/` does.
 *
 * ── WHAT COUNTS AS A USE ──
 * A whole class token inside a STRING LITERAL: `font-display`, its variants (`md:font-display`,
 * `!font-display`) and the brand role's own utility, `font-brand`, which would be a way round
 * the ban. A comment that names the class is not a use, a longer word (`font-displayed`) is not
 * the token, and the `font-display` PROPERTY in a stylesheet's `@font-face` is not a class, so
 * the sweep reads TypeScript and TSX only. `app.css` is checked separately for an `@apply` of
 * either token, which is the one way a stylesheet could take the serif without a component.
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

/** The one file that may write the serif utilities. */
const WORDMARK_FILE = 'app/components/wordmark.tsx';

/** The utilities that draw in the brand face. `font-brand` is the role, `font-display` the alias. */
const SERIF_UTILITIES = ['font-display', 'font-brand'] as const;

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

/** Whether a class literal asks for one of the serif utilities, as a whole token. */
function asksForSerif(literal: string): boolean {
  return literal.split(/\s+/).some((token) => SERIF_UTILITIES.some((utility) => bareUtility(token) === utility));
}

/** The `path:line` of every serif use in `source`, labelled with `path`. */
function serifUsesIn({ path, source }: { path: string; source: string }): string[] {
  return literalsOf(source)
    .filter(([literal]) => asksForSerif(literal))
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

/** Every serif use under `app/`, as `path:line`, wordmark file included. */
function everySerifUse(): string[] {
  return sourceFiles(APP).flatMap((file) =>
    serifUsesIn({ path: relative(ROOT, file), source: readFileSync(file, 'utf8') }),
  );
}

describe('the display serif is the wordmark and only the wordmark', () => {
  it('is written in exactly one file under app/: the Wordmark component', () => {
    const files = [...new Set(everySerifUse().map((use) => use.split(':')[0]))];
    assert.deepEqual(files, [WORDMARK_FILE], `another file asks for the serif: ${files.join(', ')}`);
  });

  it('is not applied by an @apply in the stylesheet', () => {
    const css = readFileSync(join(APP, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const applies = [...css.matchAll(/@apply\s+([^;]*);/g)].map((match) => match[1]);
    const offenders = applies.filter((applied) => asksForSerif(applied));
    assert.deepEqual(offenders, [], 'the stylesheet must not take the serif through @apply');
  });

  it('CONTROL: the sweep finds the class in the Wordmark file, so it is not blind', () => {
    const inWordmark = serifUsesIn({
      path: WORDMARK_FILE,
      source: readFileSync(join(ROOT, WORDMARK_FILE), 'utf8'),
    });
    assert.ok(inWordmark.length > 0, 'wordmark.tsx must be seen carrying font-display');
  });

  it('CONTROL: a card title, a variant, a template literal and font-brand in another file are all caught', () => {
    const elsewhere = 'app/routes/x.tsx';
    const caught = (source: string): string[] => serifUsesIn({ path: elsewhere, source });
    assert.deepEqual(caught('const a = <h3 className="font-display text-lg">t</h3>;'), [`${elsewhere}:1`]);
    assert.deepEqual(caught('const a = cn("text-sm", "md:font-display");'), [`${elsewhere}:1`]);
    assert.deepEqual(caught('const a = "x";\nconst b = `mt-2 !font-display`;'), [`${elsewhere}:2`]);
    assert.deepEqual(caught('const a = "font-brand text-xl";'), [`${elsewhere}:1`]);
  });

  it('CONTROL: a comment, a longer word, another utility and the CSS property are not caught', () => {
    const elsewhere = 'app/routes/x.tsx';
    const caught = (source: string): string[] => serifUsesIn({ path: elsewhere, source });
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
  it('renders the word openplate in the serif, in a span by default', () => {
    const markup = renderToStaticMarkup(createElement(Wordmark));
    assert.match(markup, /^<span class="font-display">openplate<\/span>$/);
  });

  it('keeps the caller size, weight and colour, and can be the landing h1', () => {
    const markup = renderToStaticMarkup(
      createElement(Wordmark, { as: 'h1', className: 'text-5xl font-bold tracking-tight' }),
    );
    assert.match(markup, /^<h1 class="font-display text-5xl font-bold tracking-tight">openplate<\/h1>$/);
  });

  it('forwards aria-hidden, which the header kicker relies on', () => {
    const markup = renderToStaticMarkup(createElement(Wordmark, { 'aria-hidden': 'true' }));
    assert.match(markup, /aria-hidden="true"/);
  });

  it('CONTROL: a plain span in the same reader does not read as the wordmark', () => {
    const plain = renderToStaticMarkup(createElement('span', { className: 'text-lg' }, 'openplate'));
    assert.doesNotMatch(plain, /font-display/, 'the reader must be able to say no');
  });
});
