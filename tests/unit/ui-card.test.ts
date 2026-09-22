/**
 * Unit tests for `#app/components/ui/card`, the shared Card/CardTitle surface
 * used by every card-based screen (diary, add, trends, settings). Pins the
 * DESIGN.md-aligned defaults (square corners plus a `shadow-sm` resting
 * elevation, a real `text-lg` CardTitle size in the body face, never the
 * display serif) so a future edit can't silently revert Card to the flat,
 * unsized state the design audit called out. A plain SSR render (no DOM needed)
 * is enough to assert on the emitted class list.
 *
 * M243 spec 02 changed the CardTitle half of this file: the title dropped the
 * display serif, because a serif card title over a tracked label is the
 * generated-template signature. The brand face now draws the word "openplate"
 * and nothing else, through `Wordmark`. It also dropped to `text-base`, and on
 * 2026-09-21 it went back to `text-lg`: fourteen cards had kept an explicit
 * `text-lg`, so 16 px and 18 px titles shared a screen over one 14 px body.
 *
 * M243 spec 03 had put Card on a five-step radius ladder; the operator retired
 * that ladder on 2026-09-22 for square corners everywhere. Card kept
 * `data-slot="card"` regardless, so the browser tier finds a card by its slot
 * and never by its corners.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Card, CardTitle } from '../../app/components/ui/card';
import { Wordmark } from '../../app/components/wordmark';

/** Pulls the `class="..."` attribute value out of a single-element SSR render. */
function classListOf(html: string): string[] {
  const match = /class="([^"]*)"/.exec(html);
  if (!match) throw new Error(`No class attribute found in: ${html}`);
  return match[1].split(/\s+/);
}

/** Whether `token` is a radius utility, whole or variant-prefixed (`sm:rounded-lg`). */
function isRadiusToken(token: string): boolean {
  return /(?:^|:)rounded(?:-|$)/.test(token);
}

describe('Card', () => {
  it('draws no radius: corners are square', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(Card, {}, 'content')));
    const radiusToken = classes.find(isRadiusToken);
    assert.equal(radiusToken, undefined, `a card must draw no radius, found "${radiusToken}"`);
    assert.ok(classes.includes('shadow-sm'), 'expected shadow-sm');
    assert.ok(!classes.includes('shadow'), 'the bare, unscaled shadow class should not be the resting default');
  });

  it('carries data-slot="card", which is how the browser tier finds a card', () => {
    const html = renderToStaticMarkup(createElement(Card, {}, 'content'));
    assert.match(html, /data-slot="card"/, 'a card must be findable without reading its corners');
    // CONTROL: the same reader would see the attribute missing. `CardTitle`
    // carries a DIFFERENT slot, so a matcher that fired on any `data-slot`
    // would pass this line too.
    const title = renderToStaticMarkup(createElement(CardTitle, {}, 'Your goals'));
    assert.doesNotMatch(title, /data-slot="card"/, 'a card title is not a card');
    assert.match(title, /data-slot="card-title"/, 'and the reader does see the slot it has');
  });

  it('still accepts a className override (e.g. an opt-in brand-tinted hero card)', () => {
    const classes = classListOf(
      renderToStaticMarkup(createElement(Card, { className: 'border-primary/25 bg-primary/10' }, 'content')),
    );
    assert.ok(classes.includes('border-primary/25'));
    assert.ok(classes.includes('bg-primary/10'));
  });
});

describe('CardTitle', () => {
  it('defaults to text-lg font-semibold (DESIGN.md §4 card title scale)', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, {}, 'Your goals')));
    assert.ok(classes.includes('text-lg'));
    assert.ok(classes.includes('font-semibold'));
    assert.ok(!classes.includes('text-base'), 'the M243 text-base default must be gone');
  });

  it('does NOT carry the brand role: card titles are in the body face', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, {}, 'This week')));
    assert.ok(!classes.includes('font-display'), 'a card title in the brand role is the template signature M243 removed');
  });

  it('CONTROL: the same reader sees the brand role when it is there, on a caller override and on the wordmark', () => {
    // A reader that could never see `font-display` would pass the absence test above
    // for the wrong reason. Two renders that DO carry it prove it can fail: a caller
    // pushing the class onto a title, and the wordmark, which is the one element that
    // owns it.
    const overridden = classListOf(
      renderToStaticMarkup(createElement(CardTitle, { className: 'font-display' }, 'This week')),
    );
    assert.ok(overridden.includes('font-display'), 'a caller override must be visible to the reader');

    const wordmark = classListOf(renderToStaticMarkup(createElement(Wordmark)));
    assert.ok(wordmark.includes('font-display'), 'the wordmark is the positive control: it wears the brand role');
  });

  it('still accepts a caller override (e.g. auth screens at text-xl)', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, { className: 'text-xl' }, 'Welcome back')));
    assert.ok(classes.includes('text-xl'));
  });
});
