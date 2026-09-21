/**
 * Unit tests for `#app/components/ui/card`, the shared Card/CardTitle surface
 * used by every card-based screen (diary, add, trends, settings). Pins the
 * DESIGN.md-aligned defaults (the ladder's card radius plus a `shadow-sm`
 * resting elevation, a real `text-base` CardTitle size in the body face, never
 * the display serif) so a future edit can't silently revert Card to the flat,
 * unsized state the design audit called out. A plain SSR render (no DOM needed)
 * is enough to assert on the emitted class list.
 *
 * M243 spec 02 changed the CardTitle half of this file: the title dropped the
 * display serif and `text-lg` for `text-base`, because a serif card title over a
 * tracked label is the generated-template signature. The brand face now draws
 * the word "openplate" and nothing else, through `Wordmark`.
 *
 * M243 spec 03 changed the radius half. The class is read from
 * `tests/design-contract.ts` rather than typed here, because it is a taste call
 * a person may reverse, and Card grew `data-slot="card"` so the browser tier can
 * stop finding a card by its corners. Both are asserted: the radius, because the
 * ladder means nothing if the card is not on its step, and the slot, because
 * three specs now select on it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Card, CardTitle } from '../../app/components/ui/card';
import { Wordmark } from '../../app/components/wordmark';
import { RADIUS_TIER_CLASS } from '../design-contract';

/** Pulls the `class="..."` attribute value out of a single-element SSR render. */
function classListOf(html: string): string[] {
  const match = /class="([^"]*)"/.exec(html);
  if (!match) throw new Error(`No class attribute found in: ${html}`);
  return match[1].split(/\s+/);
}

describe('Card', () => {
  it('rests at shadow-sm on the ladder`s card step', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(Card, {}, 'content')));
    // WHOLE TOKENS, not `includes` on the markup: `sm:rounded-lg` contains the
    // card class as a substring and is a different radius.
    assert.ok(classes.includes(RADIUS_TIER_CLASS.card), `expected ${RADIUS_TIER_CLASS.card}`);
    assert.ok(!classes.includes(RADIUS_TIER_CLASS.hero), 'the hero step is not the card step');
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
  it('defaults to text-base font-semibold (DESIGN.md §4 card title scale)', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, {}, 'Your goals')));
    assert.ok(classes.includes('text-base'));
    assert.ok(classes.includes('font-semibold'));
    assert.ok(!classes.includes('text-lg'), 'the old text-lg default must be gone');
  });

  it('does NOT carry the display serif: card titles are in the body face', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, {}, 'This week')));
    assert.ok(!classes.includes('font-display'), 'a serif card title is the template signature M243 removed');
  });

  it('CONTROL: the same reader sees the serif when it is there, on a caller override and on the wordmark', () => {
    // A reader that could never see `font-display` would pass the absence test above
    // for the wrong reason. Two renders that DO carry it prove it can fail: a caller
    // pushing the class onto a title, and the wordmark, which is the one element that
    // owns it.
    const overridden = classListOf(
      renderToStaticMarkup(createElement(CardTitle, { className: 'font-display' }, 'This week')),
    );
    assert.ok(overridden.includes('font-display'), 'a caller override must be visible to the reader');

    const wordmark = classListOf(renderToStaticMarkup(createElement(Wordmark)));
    assert.ok(wordmark.includes('font-display'), 'the wordmark is the positive control: it wears the serif');
  });

  it('still accepts a caller override (e.g. auth screens at text-xl)', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, { className: 'text-xl' }, 'Welcome back')));
    assert.ok(classes.includes('text-xl'));
  });
});
