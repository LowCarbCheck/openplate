/**
 * Unit tests for `#app/components/bottom-nav` — the mobile-only tab bar.
 * Renders to static markup inside a `MemoryRouter` (no DOM needed; `NavLink`
 * only needs router context, not a live browser) so the usability-overhaul
 * fix — a first-class "Add" tab, and "Settings" pointing at Goals instead of
 * the AI-key page — can't silently regress.
 *
 * Goals moved out of this bar first (into the top-left navigation drawer), and
 * Trends followed in the nav-surfaces pass: the bar is now the DAILY LOGGING
 * LOOP only — Diary · Scan · Add — and the drawer/sidebar carry the complete
 * map. See the "still has exactly three slots" test.
 *
 * The middle slot stopped being a link in the one-tap pass: it opens the
 * camera inside its own tap (`add-launcher.tsx`), so it renders as a button
 * with no href and the bar carries its own capture input.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { BottomNav } from '../../app/components/bottom-nav';
import { personalNavigationItems, tabNavigationItems } from '../../app/components/app-sidebar';

/**
 * A hermetic three-key catalog rather than `app/i18n/i18n.ts`: the assertion
 * this file cares about is that the bar asks for `nav.*` and renders whatever
 * comes back, not that the shipped catalog is complete (that's the catalog's
 * own concern). Inline resources make `init` resolve synchronously, so the
 * very first `renderToStaticMarkup` below already sees them.
 */
void i18next.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        nav: { diary: 'Diary', scan: 'Scan', add: 'Add' },
        launcher: { moreOptions: 'More ways to add food' },
      },
    },
  },
  react: { useSuspense: false },
});

/** Every `href="..."` value in the rendered markup, in document order. */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

function renderBottomNav(path = '/diary'): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(BottomNav)));
}

describe('BottomNav', () => {
  it('has a first-class Add tab — logging a food is no longer an extra step away', () => {
    assert.ok(hrefsOf(renderBottomNav()).includes('/add'));
  });

  it('never links Settings/Goals at the AI-key page — that used to be 25% of permanent navigation', () => {
    assert.ok(!hrefsOf(renderBottomNav()).includes('/settings/ai'));
  });

  it('still has exactly three slots, with the launcher in the middle', () => {
    // Three slots is what makes the raised centre button a real center rather
    // than the near-center M129/04 had to fake with four. The middle one is
    // no longer a LINK: it opens the camera inside its own tap (see
    // `add-launcher.tsx`), so it renders as a button and carries no href.
    // The bar's two flat tabs are the only hrefs left.
    assert.deepEqual(hrefsOf(renderBottomNav()), ['/diary', '/add']);
    assert.equal(tabNavigationItems.length, 3);
    assert.equal(tabNavigationItems[1]?.to, '/scan');
    assert.equal(tabNavigationItems[1]?.tab?.raised, true);
  });

  it('opens the camera from the bar itself rather than travelling to /scan first', () => {
    const html = renderBottomNav();

    // The whole point of the pass: the capture input is IN the tab bar, so
    // the tap that starts a scan is the tap that opens the camera.
    assert.ok(html.includes('capture="environment"'), 'the bar carries its own camera input');
    assert.ok(!hrefsOf(html).includes('/scan'), 'the launcher must not be a link any more');
  });

  it('offers a visible, labelled way into the rest of the sheet', () => {
    // A long press is a bonus path, never the only one — so there is a
    // chevron button beside the launcher, and it says what it opens.
    const html = renderBottomNav();

    assert.ok(html.includes('aria-haspopup="dialog"'), 'the chevron announces the sheet');
    assert.ok(html.includes('More ways to add food'), 'and it is labelled, not a bare glyph');
  });

  it('no longer has a Goals tab — it moved into the nav drawer', () => {
    assert.ok(!hrefsOf(renderBottomNav()).includes('/settings/goals'));
  });

  it('no longer has a Trends tab — reviewing a week is not the daily logging loop', () => {
    assert.ok(!hrefsOf(renderBottomNav()).includes('/trends'));
  });

  it('never promotes the app home into the bar — three slots is what makes Scan a real centre', () => {
    // Asserted on the CATALOG, not just the markup: this is the edit that
    // would quietly break the raised button's geometry, and it would break it
    // by adding a `tab` field over in `app-sidebar.tsx`, not here.
    const dashboard = personalNavigationItems.find((item) => item.to === '/dashboard');

    assert.ok(dashboard !== undefined, 'the catalog must still carry the app home');
    assert.equal(dashboard.tab, undefined, '/dashboard must never carry a tab field');
    assert.ok(!hrefsOf(renderBottomNav()).includes('/dashboard'));
  });

  it('never shows the fasting timer in the bar', () => {
    // The markup-side half of `app-sidebar.test.ts`'s catalog guard: adding a
    // destination must not touch the three-slot bar the raised Scan button's
    // geometry depends on.
    assert.ok(!hrefsOf(renderBottomNav()).includes('/fasting'));
  });

  it('carries destinations the shared catalog also carries — the bar never re-lists its own hrefs', () => {
    const catalogHrefs = new Set(personalNavigationItems.map((item) => item.to));

    for (const href of hrefsOf(renderBottomNav())) {
      assert.ok(catalogHrefs.has(href), `${href} must come from personalNavigationItems`);
    }
  });

  it('draws Scan as a raised circular button in the brand fill', () => {
    const html = renderBottomNav();

    assert.ok(html.includes('rounded-full'), 'the flagship action is a circle');
    assert.ok(html.includes('bg-primary text-primary-foreground'), 'filled with the brand, not an outline');
    assert.ok(html.includes('ring-background'), 'ringed so it reads as lifted off the bar');
  });

  it('keeps every tab labelled — the raised button is not an icon-only mystery', () => {
    const html = renderBottomNav();

    for (const label of ['Diary', 'Scan', 'Add']) {
      assert.ok(html.includes(`>${label}<`), `${label} must keep its visible text label`);
    }
  });

  it("gates the active raised button's scale animation on motion-safe", () => {
    const html = renderBottomNav('/scan');
    const scaleIndex = html.indexOf('scale-105');

    assert.notEqual(scaleIndex, -1, 'the active Scan tab lifts its circle');
    assert.ok(html.slice(0, scaleIndex).endsWith('motion-safe:'), 'scale must be motion-safe: gated');
  });

  it('marks the active tab with aria-current, raised or flat', () => {
    assert.ok(renderBottomNav('/scan').includes('aria-current="page"'), 'the raised tab keeps aria-current');
    assert.ok(renderBottomNav('/diary').includes('aria-current="page"'));
  });
});
