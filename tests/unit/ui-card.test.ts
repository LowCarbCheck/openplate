/**
 * Unit tests for `#app/components/ui/card` — the shared Card/CardTitle surface
 * used by every card-based screen (diary, add, trends, settings). Pins the
 * DESIGN.md-aligned defaults (rounded-2xl + shadow-sm resting elevation, a real
 * `text-lg` CardTitle size — M129/01 bumped the dominant card radius from
 * rounded-lg to rounded-2xl) so a future edit can't silently revert Card to the
 * flat, unsized state the design audit called out — a plain SSR render (no DOM
 * needed) is enough to assert on the emitted class list.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Card, CardTitle } from '../../app/components/ui/card';

/** Pulls the `class="..."` attribute value out of a single-element SSR render. */
function classListOf(html: string): string[] {
  const match = /class="([^"]*)"/.exec(html);
  if (!match) throw new Error(`No class attribute found in: ${html}`);
  return match[1].split(/\s+/);
}

describe('Card', () => {
  it('rests at shadow-sm with a rounded-2xl radius by default', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(Card, {}, 'content')));
    assert.ok(classes.includes('rounded-2xl'), 'expected rounded-2xl');
    assert.ok(classes.includes('shadow-sm'), 'expected shadow-sm');
    assert.ok(!classes.includes('shadow'), 'the bare, unscaled shadow class should not be the resting default');
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
  });

  it('carries the display serif (M129 soul pass) — card titles are the brand voice app-wide', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, {}, 'This week')));
    assert.ok(classes.includes('font-display'));
  });

  it('still accepts a caller override (e.g. auth screens at text-xl)', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(CardTitle, { className: 'text-xl' }, 'Welcome back')));
    assert.ok(classes.includes('text-xl'));
  });
});
