/**
 * Unit tests for `#app/components/link`, the app's `Link`/`NavLink`, which
 * now route a plain left click through `useAppNavigate` so the history stack
 * is shaped instead of always pushed.
 *
 * Two claims, tested two ways, because this repo has no DOM test library and
 * `renderToStaticMarkup` cannot dispatch a click:
 *
 * - the RENDERED anchor still carries a real `href` (server markup, "copy link
 *   address", a screen reader's link list), proved by rendering it;
 * - the click handler calls `go` and lets a modified click fall through,
 *   proved by reading the source, which is the only honest tool available.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { Link, NavLink } from '../../app/components/link';

const source = readFileSync(fileURLToPath(new URL('../../app/components/link.tsx', import.meta.url)), 'utf8');

/** Render one element at `/diary` inside a memory router, as static markup. */
function renderAt(element: ReturnType<typeof createElement>): string {
  const router = createMemoryRouter([{ path: '/diary', element }], { initialEntries: ['/diary'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('the rendered anchor', () => {
  it('still carries the href, so nothing that reads markup loses the address', () => {
    const markup = renderAt(createElement(Link, { to: '/settings/ai' }, 'AI'));
    assert.match(markup, /<a[^>]*href="\/settings\/ai"/);
  });

  it('keeps the search and hash in the href', () => {
    const markup = renderAt(createElement(Link, { to: '/diary?date=2026-09-01' }, 'That day'));
    assert.match(markup, /href="\/diary\?date=2026-09-01"/);
  });

  it('renders NavLink with an href too', () => {
    const markup = renderAt(createElement(NavLink, { to: '/add' }, 'Add'));
    assert.match(markup, /<a[^>]*href="\/add"/);
  });

  it('the href assertion is not vacuous (control)', () => {
    // Without this, `assert.match(markup, /href=/)` would pass against any
    // page that happens to contain another anchor.
    const markup = renderAt(createElement(Link, { to: '/trends' }, 'Trends'));
    assert.equal(/href="\/settings\/ai"/.test(markup), false);
  });
});

describe('the click handler, read from the source', () => {
  it('calls go with the resolved href', () => {
    assert.match(source, /const href = useHref\(to\);/);
    assert.match(source, /const go = useAppNavigate\(\);/);
    assert.match(source, /event\.preventDefault\(\);\s*\n\s*go\(href\);/);
  });

  it('lets a modified click and a middle click fall through', () => {
    assert.match(source, /event\.button === 0/);
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      assert.match(source, new RegExp(`!event\\.${modifier}`), modifier);
    }
    // The guard must RETURN before `preventDefault`, not merely exist.
    assert.match(source, /if \(!isPlainLeftClick\(event\)\) return;\s*\n\s*event\.preventDefault\(\);/);
  });

  it('lets a targeted link and a download fall through', () => {
    assert.match(source, /if \(download !== undefined\) return;/);
    assert.match(source, /if \(target !== undefined && target !== '_self'\) return;/);
  });

  it("respects a caller's own onClick, including its preventDefault", () => {
    assert.match(source, /onClick\?\.\(event\);\s*\n\s*if \(event\.defaultPrevented\) return;/);
  });

  it('both wrappers use the one shared handler', () => {
    assert.equal(source.match(/useAppNavigationClick\(\{ to, target, download, onClick \}\)/g)?.length, 2);
  });

  it('the source assertions are not vacuous (control)', () => {
    // A pattern that matches nothing must fail, or the block above says
    // nothing at all about this file.
    assert.equal(/go\(somethingElse\)/.test(source), false);
    assert.equal(/event\.button === 1/.test(source), false);
  });
});
