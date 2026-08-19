/**
 * Unit tests for `#app/components/typography` — the shared H1/H2/H3/P scale.
 * Renders to static markup (no DOM needed, plain SSR string output) so the
 * three-tier body scale (`default`/`lead` primary, `subtle`/`small`/`muted`
 * secondary, `meta` tertiary) and the token-based heading colors can't
 * silently drift.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { H1, H3, P } from '../../app/components/typography';

/** Pulls the `class="..."` attribute value out of a single-element SSR render. */
function classListOf(html: string): string[] {
  const match = /class="([^"]*)"/.exec(html);
  if (!match) throw new Error(`No class attribute found in: ${html}`);
  return match[1].split(/\s+/);
}

describe('P', () => {
  it('"meta" is the tertiary tier: text-xs, muted', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(P, { variant: 'meta' }, 'Logged 2 hours ago')));
    assert.ok(classes.includes('text-xs'));
    assert.ok(classes.includes('text-muted-foreground'));
  });

  it('"default" (primary body copy) is not sized down to the meta tier', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(P, {}, 'Body copy')));
    assert.ok(!classes.includes('text-xs'));
  });
});

describe('H1', () => {
  it('"pageHeader" uses the semantic foreground token, not a hardcoded zinc shade', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(H1, { variant: 'pageHeader' }, 'Title')));
    assert.ok(classes.includes('text-foreground'));
    assert.ok(!classes.some((c) => c.includes('zinc')));
  });
});

describe('H3', () => {
  it('"websiteAttachmentHeader" also tracks the foreground token in both themes', () => {
    const classes = classListOf(renderToStaticMarkup(createElement(H3, { variant: 'websiteAttachmentHeader' }, 'Attachment')));
    assert.ok(classes.includes('text-foreground'));
    assert.ok(!classes.some((c) => c.includes('zinc')));
  });
});
