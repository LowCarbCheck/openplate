/**
 * The foundation of the lowcarbcheck restyle (M243 spec 01): the whole app speaks in
 * Victor Mono, long-form prose stays in Inter, and the page has a graph-paper utility.
 *
 * Every rule below is read out of the source text, not rendered, because it is a
 * sentence about three files: `app/root.tsx`, `app/app.css` and the four legal routes.
 * The browser tier (`tests/e2e/lcc-lineage-foundation.spec.ts`) reads the computed and
 * the painted face off a real page. This file is the cheap half that fails in a second,
 * before a build.
 *
 * ── THREE FONT ROLES, ONE LINE EACH ──
 * A screen asks for a role (`font-body`, `font-prose`, `font-display`), never for a face.
 * `--font-body` is the one line that decides whether the whole app is in Victor Mono or in
 * Inter, and the face names live nowhere else, so this file pins the roles and then pins
 * that no rule outside them names a face.
 *
 * ── EVERY ASSERTION HAS A CONTROL ──
 * A check that cannot fail is worse than no check. `className.includes('font-body')` would
 * match `sm:font-body` and `font-bodyish`, and a CSS grep would match a rule that lives only
 * inside a comment. So each predicate here works on WHOLE class tokens or on the
 * comment-stripped rule body, and each one is also run against a bad input that must make it
 * answer no: the old `font-sans` body, a `.prose` rule that names the body role, a grid that
 * paints a hex literal.
 *
 * ── WHAT IS NOT PINNED ──
 * WHERE `.surface-grid` is drawn. The landing hero section wears the class and the in-app hero
 * panel draws the same two layers from `.surface-brand`, so a source count here would be the
 * weaker of two answers: `lcc-lineage-landing.spec.ts` and `lcc-lineage-hero.spec.ts` read what
 * a browser actually paints in each place.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { BODY_STACK, BRAND_STACK, GRID_CELL_PX, GRID_LINE_ALPHA, PROSE_STACK } from '../design-contract';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ROOT_SOURCE = readFileSync(join(ROOT, 'app/root.tsx'), 'utf8');
const APP_CSS = readFileSync(join(ROOT, 'app/app.css'), 'utf8');
const LEGAL_DIRECTORY = join(ROOT, 'app/routes/legal');

/** How many legal routes exist today. A fifth page must be added here on purpose. */
const LEGAL_ROUTE_COUNT = 4;

/** The class list of the first `<tag className="...">` in `source`, or null when there is none. */
function classListOfTag({ source, tag }: { source: string; tag: string }): string | null {
  const match = new RegExp(`<${tag}\\s+className="([^"]*)"`).exec(source);
  return match === null ? null : match[1];
}

/** Whether `classList` carries `token` as a whole class, so `sm:font-body` never counts. */
function hasClassToken({ classList, token }: { classList: string | null; token: string }): boolean {
  if (classList === null) return false;
  return classList.split(/\s+/).includes(token);
}

/** The stylesheet with every block comment removed, so a rule written only in prose is not a rule. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Escapes a string for use inside a RegExp. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The declarations of every flat rule for exactly `selector`, in file order. */
function ruleBodiesOf({ css, selector }: { css: string; selector: string }): string[] {
  const pattern = new RegExp(`(?:^|[\\s{}])${escapeForPattern(selector)}\\s*\\{([^}]*)\\}`, 'g');
  return [...withoutComments(css).matchAll(pattern)].map((match) => match[1]);
}

/** The declarations of the first flat rule for exactly `selector`, or null when there is none. */
function ruleBodyOf({ css, selector }: { css: string; selector: string }): string | null {
  return ruleBodiesOf({ css, selector })[0] ?? null;
}

/** Every value a custom property or property is declared with, in file order, comments ignored. */
function valuesOf({ css, property }: { css: string; property: string }): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${escapeForPattern(property)}:\\s*([^;}]*)[;}]`, 'g');
  return [...withoutComments(css).matchAll(pattern)].map((match) => match[1].trim());
}

/** How many times `needle` appears in `text`. */
function occurrencesOf({ text, needle }: { text: string; needle: string }): number {
  return text.split(needle).length - 1;
}

/** Whether the body asks for the body font role, by the class token the body carries. */
function bodyAsksForBodyRole(source: string): boolean {
  return hasClassToken({ classList: classListOfTag({ source, tag: 'body' }), token: 'font-body' });
}

/** Whether `--font-body` is declared exactly once, and as `stack`. */
function bodyRoleIs({ css, stack }: { css: string; stack: string }): boolean {
  const declared = valuesOf({ css, property: '--font-body' });
  return declared.length === 1 && declared[0] === stack;
}

/** Whether some `body` rule turns ligatures off. */
function bodyTurnsLigaturesOff(css: string): boolean {
  return ruleBodiesOf({ css, selector: 'body' }).some((body) => /(?:^|[\s;])font-variant-ligatures:\s*none\b/.test(body));
}

/** Whether `.prose` opts back into the prose role, and into nothing else. */
function proseAsksForProseRole(css: string): boolean {
  const body = ruleBodyOf({ css, selector: '.prose' });
  if (body === null) return false;
  return /(?:^|[\s;])font-family:\s*var\(--font-prose\)\s*;?\s*$/.test(body);
}

/** The grid rule's body, or null when `.surface-grid` is not a rule. */
function gridBodyOf(css: string): string | null {
  return ruleBodyOf({ css, selector: '.surface-grid' });
}

/** Whether both grid layers read the themed border token at the contract alpha, and there are exactly two. */
function gridReadsBorderToken(css: string): boolean {
  const body = gridBodyOf(css);
  if (body === null) return false;
  const layers = occurrencesOf({ text: body, needle: 'linear-gradient(' });
  const reads = occurrencesOf({ text: body, needle: `hsl(var(--border) / ${GRID_LINE_ALPHA})` });
  return layers === 2 && reads === 2;
}

/** Whether the grid rule is free of any `#` colour literal. */
function gridHasNoHexLiteral(css: string): boolean {
  const body = gridBodyOf(css);
  return body !== null && !body.includes('#');
}

/** Every `.tsx` file directly under the legal routes, as `[name, source]` pairs. */
function legalSources(): [string, string][] {
  return readdirSync(LEGAL_DIRECTORY)
    .filter((name) => name.endsWith('.tsx'))
    .map((name): [string, string] => [name, readFileSync(join(LEGAL_DIRECTORY, name), 'utf8')]);
}

/** Whether a legal page's `<article>` container asks for the prose role. */
function articleAsksForProseRole(source: string): boolean {
  return hasClassToken({ classList: classListOfTag({ source, tag: 'article' }), token: 'font-prose' });
}

describe('the body face', () => {
  it('asks for the body font role: <body> carries the font-body token', () => {
    assert.equal(bodyAsksForBodyRole(ROOT_SOURCE), true, 'root.tsx <body> must carry font-body');
  });

  it('names no face on the body directly', () => {
    const classList = classListOfTag({ source: ROOT_SOURCE, tag: 'body' });
    for (const token of ['font-sans', 'font-mono', 'font-display']) {
      assert.equal(hasClassToken({ classList, token }), false, `the body must not carry ${token}`);
    }
  });

  it('CONTROL: the old sans body, a responsive variant and a longer token all answer no', () => {
    assert.equal(bodyAsksForBodyRole('<body className="font-sans">'), false, 'the old body must fail');
    assert.equal(bodyAsksForBodyRole('<body className="font-mono">'), false, 'a face token is not the role');
    assert.equal(bodyAsksForBodyRole('<body className="sm:font-body">'), false, 'a responsive variant is not the body');
    assert.equal(bodyAsksForBodyRole('<body className="font-bodyish">'), false, 'a longer token is not font-body');
    assert.equal(bodyAsksForBodyRole('<div className="font-body">'), false, 'a class on another element is not the body');
    assert.equal(bodyAsksForBodyRole('<body className="antialiased font-body">'), true, 'the token is found after another');
  });
});

describe('the three font roles', () => {
  it('declares the body role once, as Victor Mono, then Inter, then the device monospace', () => {
    assert.equal(bodyRoleIs({ css: APP_CSS, stack: BODY_STACK }), true, `--font-body must be exactly: ${BODY_STACK}`);
  });

  it('declares the prose role as Inter and the brand role as Victor Mono, the wordmark\'s', () => {
    assert.deepEqual(valuesOf({ css: APP_CSS, property: '--font-prose' }), [PROSE_STACK]);
    assert.deepEqual(valuesOf({ css: APP_CSS, property: '--font-brand' }), [BRAND_STACK]);
  });

  it('keeps `font-display` as an alias of the brand role, so there is one line that names the wordmark face', () => {
    assert.deepEqual(valuesOf({ css: APP_CSS, property: '--font-display' }), ['var(--font-brand)']);
  });

  it('lets no rule outside the roles set a face: the only font-family declaration is .prose', () => {
    const families = valuesOf({ css: APP_CSS, property: 'font-family' });
    assert.deepEqual(families, ['var(--font-prose)']);
  });

  it('turns ligatures off on the body, so ->, <= and != typed in a food name are drawn as typed', () => {
    assert.equal(bodyTurnsLigaturesOff(APP_CSS), true);
  });

  it('CONTROL: an Inter-first stack, a doubled declaration, a comment-only line and a ligature-on body all answer no', () => {
    assert.equal(
      bodyRoleIs({ css: `@theme { --font-body: 'Inter Variable', sans-serif; }`, stack: BODY_STACK }),
      false,
      'a body role that flipped to Inter must fail',
    );
    assert.equal(
      bodyRoleIs({ css: `@theme { --font-body: ${BODY_STACK}; --font-body: ${BODY_STACK}; }`, stack: BODY_STACK }),
      false,
      'two declarations are two places to flip',
    );
    assert.equal(
      bodyRoleIs({ css: `@theme { /* --font-body: ${BODY_STACK}; */ }`, stack: BODY_STACK }),
      false,
      'a declaration written only in a comment is not a declaration',
    );
    assert.equal(bodyTurnsLigaturesOff('body { color: red; }'), false, 'a body without the property must fail');
    assert.equal(
      bodyTurnsLigaturesOff('body { font-variant-ligatures: normal; }'),
      false,
      'a body that turns ligatures on must fail',
    );
    assert.deepEqual(
      valuesOf({ css: 'body { font-family: "Victor Mono Variable"; }', property: 'font-family' }),
      ['"Victor Mono Variable"'],
      'the sweep above would see a face named outside the roles',
    );
  });
});

describe('.prose', () => {
  it('opts back into the prose role', () => {
    assert.equal(proseAsksForProseRole(APP_CSS), true, 'app.css needs .prose { font-family: var(--font-prose); }');
  });

  it('CONTROL: the body role, a face token, a comment-only rule, a missing rule and a longer selector all answer no', () => {
    assert.equal(proseAsksForProseRole('.prose { font-family: var(--font-body); }'), false, 'the body role must fail');
    assert.equal(proseAsksForProseRole('.prose { font-family: var(--font-sans); }'), false, 'a face token bypasses the role');
    assert.equal(
      proseAsksForProseRole('/* .prose { font-family: var(--font-prose); } */'),
      false,
      'a rule that exists only in a comment is not a rule',
    );
    assert.equal(proseAsksForProseRole('.other { color: red; }'), false, 'no .prose rule must fail');
    assert.equal(
      proseAsksForProseRole('.prose-zinc { font-family: var(--font-prose); }'),
      false,
      'a longer selector is a different rule',
    );
    assert.equal(
      proseAsksForProseRole('.a { top: 0 }\n.prose { font-family: var(--font-prose); }'),
      true,
      'a real rule passes',
    );
  });
});

describe('.surface-grid', () => {
  it('is a rule in app.css', () => {
    assert.notEqual(gridBodyOf(APP_CSS), null, 'app.css needs a .surface-grid rule');
  });

  it('paints two gradient layers, both from the themed border token at the contract alpha', () => {
    assert.equal(gridReadsBorderToken(APP_CSS), true);
  });

  it('writes no # colour literal', () => {
    assert.equal(gridHasNoHexLiteral(APP_CSS), true);
  });

  it('uses the contract cell size', () => {
    const body = gridBodyOf(APP_CSS);
    const cell = `background-size:\\s*${GRID_CELL_PX}px ${GRID_CELL_PX}px`;
    assert.ok(body !== null && new RegExp(cell).test(body), `the cell size is ${GRID_CELL_PX}px by ${GRID_CELL_PX}px`);
  });

  it('CONTROL: a brand-token grid, a one-layer grid and a hex grid all answer no', () => {
    const brandTokenGrid =
      `.surface-grid { background-image: linear-gradient(to right, hsl(var(--primary) / ${GRID_LINE_ALPHA}) 1px, transparent 1px), ` +
      `linear-gradient(to bottom, hsl(var(--primary) / ${GRID_LINE_ALPHA}) 1px, transparent 1px); }`;
    const oneLayerGrid = `.surface-grid { background-image: linear-gradient(to right, hsl(var(--border) / ${GRID_LINE_ALPHA}) 1px, transparent 1px); }`;
    const hexGrid =
      `.surface-grid { background-image: linear-gradient(to right, hsl(var(--border) / ${GRID_LINE_ALPHA}) 1px, transparent 1px), ` +
      'linear-gradient(to bottom, #cccccc 1px, transparent 1px); }';
    assert.equal(gridReadsBorderToken(brandTokenGrid), false, 'a grid on the brand token must fail');
    assert.equal(gridReadsBorderToken(oneLayerGrid), false, 'a single layer is not a grid');
    assert.equal(gridReadsBorderToken(hexGrid), false, 'a layer that skips the token must fail');
    assert.equal(gridHasNoHexLiteral(hexGrid), false, 'a hex literal in the rule must fail');
    assert.equal(gridHasNoHexLiteral('.other { color: red; }'), false, 'a missing rule must not pass as clean');
  });
});

describe('the legal pages', () => {
  it('finds every legal route, so the sweep below is not empty', () => {
    // CONTROL for the sweep: a walk over zero files would pass it while proving nothing.
    assert.equal(legalSources().length, LEGAL_ROUTE_COUNT, 'a legal route was added or removed: update the count');
  });

  it('gives every legal <article> container the font-prose token', () => {
    const offenders = legalSources()
      .filter(([, source]) => !articleAsksForProseRole(source))
      .map(([name]) => name);
    assert.deepEqual(offenders, [], `these legal pages would render in the body's monospace: ${offenders.join(', ')}`);
  });

  it('CONTROL: the old container, a face token and a responsive-only container answer no', () => {
    assert.equal(
      articleAsksForProseRole('<article className="prose prose-zinc dark:prose-invert max-w-none">'),
      false,
      'the container as it was must fail',
    );
    assert.equal(articleAsksForProseRole('<article className="font-sans prose">'), false, 'a face token must fail');
    assert.equal(articleAsksForProseRole('<article className="sm:font-prose prose">'), false, 'a responsive variant must fail');
    assert.equal(articleAsksForProseRole('<article className="font-prose prose">'), true, 'the token itself passes');
  });
});
