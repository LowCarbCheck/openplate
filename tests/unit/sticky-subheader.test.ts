/**
 * `StickySubheader` is the bar that pins under the app header, and its offset is
 * only correct because of a number written in a DIFFERENT file.
 *
 * The bar says `top-16`. The header it must sit under says `min-h-16`. Nothing
 * in the type system or in Tailwind links those two literals, so a future change
 * to the header height, a taller header for a new control, say, would leave this
 * bar either overlapping the header or floating below it with a strip of
 * scrolling page showing through the gap. Neither renders as an error; both just
 * look slightly wrong on one page. So the offset contract is checked by parsing
 * both files and comparing the numbers, with a failure message that names both.
 *
 * The rest is a render: the outer element carries the pin classes and the
 * negative margins that cancel the page padding, and the child it was given is
 * actually inside it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StickySubheader } from '../../app/components/sticky-subheader';

const APP_WRAPPER_PATH = fileURLToPath(new URL('../../app/components/app-wrapper.tsx', import.meta.url));
const SUBHEADER_PATH = fileURLToPath(new URL('../../app/components/sticky-subheader.tsx', import.meta.url));

const CHILD_TEXT = 'the day navigator';

const markup = renderToStaticMarkup(
  createElement(StickySubheader, null, createElement('p', { 'data-testid': 'child' }, CHILD_TEXT)),
);

/** The class list of the single outer element the component renders. */
function readOuterClasses(html: string): string[] {
  const match = /^<div class="([^"]*)"/.exec(html);
  assert.notEqual(match, null, `StickySubheader did not render a <div> with a class attribute. Got: ${html}`);
  return match![1]!.split(/\s+/);
}

describe('StickySubheader pins under the app header', () => {
  const classes = readOuterClasses(markup);

  it('is position: sticky', () => {
    assert.ok(classes.includes('sticky'), `Expected \`sticky\` on the outer element. Got: ${classes.join(' ')}`);
  });

  it('offsets by the header height', () => {
    assert.ok(classes.includes('top-16'), `Expected \`top-16\` on the outer element. Got: ${classes.join(' ')}`);
  });

  it('layers below the header', () => {
    assert.ok(classes.includes('z-30'), `Expected \`z-30\` on the outer element. Got: ${classes.join(' ')}`);
  });

  it('cancels the page padding at both breakpoints', () => {
    for (const cls of ['-mx-4', 'px-4', 'md:-mx-6', 'md:px-6']) {
      assert.ok(
        classes.includes(cls),
        `Expected \`${cls}\` so the bar runs edge to edge like the header, undoing InnerContent's \`p-4 md:p-6\`. Got: ${classes.join(' ')}`,
      );
    }
  });

  it('renders its child inside the bar', () => {
    assert.match(markup, /<div class="[^"]*sticky[^"]*">\s*<p data-testid="child">the day navigator<\/p>\s*<\/div>/);
  });
});

describe('the header offset is one contract across two files', () => {
  it('StickySubheader `top-N` equals the app header `min-h-N`', () => {
    // Parsed here rather than imported from `app-wrapper-sticky-header.test.ts`:
    // importing a sibling test file re-registers its whole suite inside this
    // process, so the same assertions would report twice.
    const headerSource = readFileSync(APP_WRAPPER_PATH, 'utf8');
    const headerAt = headerSource.indexOf('<header', headerSource.indexOf('function InnerContent('));
    assert.notEqual(headerAt, -1, 'No `<header` inside `InnerContent` in app-wrapper.tsx.');
    const headerClasses = headerSource.slice(headerAt, headerSource.indexOf('>', headerAt));
    const headerMatch = /(?:^|\s)min-h-(\d+)(?:\s|"|$)/.exec(headerClasses);
    assert.notEqual(headerMatch, null, `No \`min-h-<number>\` on the <header> in app-wrapper.tsx. Got: ${headerClasses}`);
    const headerHeight = Number(headerMatch![1]);

    const subheaderSource = readFileSync(SUBHEADER_PATH, 'utf8');
    const offsetMatch = /(?:^|\s)top-(\d+)(?:\s|")/.exec(subheaderSource);
    assert.notEqual(offsetMatch, null, 'No `top-<number>` class found in app/components/sticky-subheader.tsx.');
    const offset = Number(offsetMatch![1]);

    assert.equal(
      offset,
      headerHeight,
      `app/components/sticky-subheader.tsx pins at \`top-${offset}\` but the <header> in ` +
        `app/components/app-wrapper.tsx is \`min-h-${headerHeight}\`. These two numbers are one contract: ` +
        `if the subheader offset is smaller the bar hides under the header, if it is larger a strip of ` +
        `scrolling page shows between them. Change both, in both files.`,
    );
  });
});
