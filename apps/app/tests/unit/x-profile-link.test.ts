/**
 * The X profile link at the foot of the app menu, in both places that carry it:
 * the desktop sidebar's footer group and the bottom of the phone's More sheet.
 *
 * RENDERED, NOT READ. Each place is drawn to static markup and its anchors are
 * picked out, so a link that is removed, or that points anywhere but
 * `X_PROFILE_URL`, fails here. The More sheet is drawn through its body: the
 * sheet itself lives in a Radix portal, which `renderToStaticMarkup` draws as
 * nothing.
 *
 * THE CONTROL. `anchorsTo` is run again on the same markup with the anchors cut
 * out. It must find none, which is what says the matcher can fail and is not
 * matching something the page prints anyway.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { SidebarXProfileRow } from '../../app/components/app-sidebar';
import { MoreSheetBody } from '../../app/components/more-sheet';
import { SidebarMenu, SidebarProvider } from '../../app/components/ui/sidebar';
import { X_PROFILE_HANDLE, X_PROFILE_URL } from '../../app/lib/brand';

/** No catalog is needed: a missing key prints as the key, and no assertion here reads a label. */
void i18next.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
  react: { useSuspense: false },
});

/** The More sheet's body inside a data router, which its page links need. */
function renderMoreSheetBody(): string {
  const element = createElement(MoreSheetBody, { activeHref: null });
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: ['/diary'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The sidebar row inside the provider and the list the sidebar draws it in. */
function renderSidebarRow(): string {
  const list: ReactElement = createElement(SidebarMenu, null, createElement(SidebarXProfileRow));
  return renderToStaticMarkup(createElement(SidebarProvider, null, list));
}

/** Every opening `<a ...>` tag whose `href` is the given address. */
function anchorsTo(html: string, href: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes(`href="${href}"`));
}

/** The markup with every anchor, its tag and its content, cut out. */
function withoutAnchors(html: string): string {
  return html.replaceAll(/<a\b[\s\S]*?<\/a>/g, '');
}

const PLACES = [
  { place: 'the sidebar footer', render: renderSidebarRow },
  { place: 'the More sheet body', render: renderMoreSheetBody },
];

describe('the X profile link', () => {
  for (const { place, render } of PLACES) {
    it(`is one external anchor to the profile in ${place}`, () => {
      const html = render();
      const anchors = anchorsTo(html, X_PROFILE_URL);
      assert.equal(anchors.length, 1);
      assert.match(anchors[0] ?? '', /target="_blank"/);
      assert.match(anchors[0] ?? '', /rel="noopener noreferrer"/);
    });

    it(`prints the handle as plain text in ${place}`, () => {
      assert.match(render(), new RegExp(`<span[^>]*>${X_PROFILE_HANDLE}</span>`));
    });

    it(`fails the same check when the anchor is removed from ${place}`, () => {
      assert.deepEqual(anchorsTo(withoutAnchors(render()), X_PROFILE_URL), []);
    });
  }

  it('sits last in the More sheet, after the tile grid', () => {
    const html = renderMoreSheetBody();
    assert.ok(html.lastIndexOf('data-slot="more-external"') > html.lastIndexOf('data-slot="more-tile"'));
  });
});
