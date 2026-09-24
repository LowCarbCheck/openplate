/**
 * Unit tests for `#app/components/bottom-nav` — the mobile-only tab bar.
 * Renders to static markup inside a `MemoryRouter` (no DOM needed; `NavLink`
 * only needs router context, not a live browser) so the usability-overhaul
 * fix — a first-class "Add" tab, and "Settings" pointing at Goals instead of
 * the AI-key page — can't silently regress.
 *
 * Goals moved out of this bar first (into the navigation drawer), and Trends
 * followed in the nav-surfaces pass. Insights, the same `/trends`, came back
 * on 2026-09-24 with a fifth slot, a Menu tab that opens the drawer, because a
 * person did not find the drawer behind the header's brand mark. The bar is
 * Diary, Insights, Scan, Add, Menu; the drawer and the sidebar carry the
 * complete map. See the "has exactly five slots" test.
 *
 * The middle slot stopped being a link in the one-tap pass: it opens the
 * camera inside its own tap (`add-launcher.tsx`), so it renders as a button
 * with no href and the bar carries its own capture input.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { BottomNav, type MenuTabProps } from '../../app/components/bottom-nav';
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
        nav: { diary: 'Diary', trends: 'Insights', scan: 'Scan', add: 'Add', menu: 'Menu' },
      },
    },
  },
  react: { useSuspense: false },
});

/** Every `href="..."` value in the rendered markup, in document order. */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

/** The Menu tab as the shell hands it over with the drawer shut. A static render never calls `onOpen`. */
const CLOSED_MENU = { isOpen: false, onOpen: () => {} } satisfies MenuTabProps;

/**
 * A DATA router, not a `MemoryRouter`. The Add launcher reads this instance's
 * policy through the root loader's public config (`usePublicConfig`), and that
 * read throws outside a data router rather than answering `undefined`. No
 * loader is registered here, so the policy resolves to the open-instance
 * default, which is what this file's navigation assertions describe.
 */
function renderBottomNav(path = '/diary', menu: MenuTabProps = CLOSED_MENU): string {
  const router = createMemoryRouter([{ path: '*', element: createElement(BottomNav, { menu }) }], {
    initialEntries: [path],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The one `<button ...>` opening tag carrying the Menu tab's slot, so its attributes can be read alone. */
function menuTabTag(html: string): string {
  const match = /<button[^>]*data-slot="bottom-nav-menu"[^>]*>/.exec(html);
  assert.ok(match !== null, 'the bar must draw the Menu tab');
  return match[0];
}

describe('BottomNav', () => {
  it('has a first-class Add tab — logging a food is no longer an extra step away', () => {
    assert.ok(hrefsOf(renderBottomNav()).includes('/add/search'));
  });

  it('never links Settings/Goals at the AI-key page — that used to be 25% of permanent navigation', () => {
    assert.ok(!hrefsOf(renderBottomNav()).includes('/settings/ai'));
  });

  it('has exactly five slots, with the launcher in the middle', () => {
    // An odd count is what makes the raised centre button a real centre
    // rather than the near-centre M129/04 had to fake with four: three slots
    // did it, and five do. The middle one is not a LINK: it opens the camera
    // inside its own tap (see `add-launcher.tsx`), and the fifth, Menu, opens
    // the drawer, so the three flat destinations are the only hrefs.
    assert.deepEqual(hrefsOf(renderBottomNav()), ['/diary', '/trends', '/add/search']);
    assert.equal(tabNavigationItems.length, 4, 'four catalog tabs, then the Menu tab');
    assert.equal(tabNavigationItems[2]?.to, '/add/photo');
    assert.equal(tabNavigationItems[2]?.tab?.raised, true);
  });

  it('opens the camera from the bar itself rather than travelling to /add/photo first', () => {
    const html = renderBottomNav();

    // The whole point of the pass: the capture input is IN the tab bar, so
    // the tap that starts a scan is the tap that opens the camera.
    assert.ok(html.includes('capture="environment"'), 'the bar carries its own camera input');
    assert.ok(!hrefsOf(html).includes('/add/photo'), 'the launcher must not be a link any more');
  });

  it('ends with a Menu tab that is a labelled button, never a link', () => {
    // The report this answers: nobody could tell that the header's brand mark
    // opens the drawer. So the door says "Menu" in words, and it is a button
    // that announces a dialog, because it goes nowhere.
    const tag = menuTabTag(renderBottomNav());

    assert.ok(tag.includes('aria-haspopup="dialog"'), 'the Menu tab announces the drawer');
    assert.ok(tag.includes('aria-expanded="false"'), 'and says the drawer is shut');
    assert.ok(!tag.includes('href='), 'it opens a panel, it does not navigate');
    assert.ok(renderBottomNav().includes('>Menu<'), 'it is labelled in words, not a bare glyph');
  });

  it('says the drawer is open while it is, whichever door opened it', () => {
    // CONTROL for the line above: the attribute follows the shell's state
    // rather than being written as a literal.
    const tag = menuTabTag(renderBottomNav('/diary', { isOpen: true, onOpen: () => {} }));

    assert.ok(tag.includes('aria-expanded="true"'));
  });

  it('draws the Menu tab LAST, after the four catalog tabs', () => {
    const html = renderBottomNav();
    const menuAt = html.indexOf('data-slot="bottom-nav-menu"');
    const addAt = html.indexOf('href="/add/search"');

    assert.notEqual(addAt, -1);
    assert.ok(menuAt > addAt, 'Menu must be the fifth slot, at the right end of the bar');
  });

  it('has no chevron beside the launcher any more', () => {
    // It left with the move to five slots: in a 72 px slot its 44 px box
    // would have covered most of the circle. The Menu tab is now the bar's
    // one `aria-haspopup` control, so exactly one is drawn.
    assert.equal((renderBottomNav().match(/aria-haspopup="dialog"/g) ?? []).length, 1);
  });

  it('no longer has a Goals tab — it moved into the nav drawer', () => {
    assert.ok(!hrefsOf(renderBottomNav()).includes('/settings/nutrition'));
  });

  it('carries Insights in the second slot, from the catalog entry the drawer also draws', () => {
    assert.equal(hrefsOf(renderBottomNav())[1], '/trends');
    assert.ok(renderBottomNav().includes('>Insights<'));
  });

  it('never promotes the app home into the bar, a sixth slot would take Scan off the centre', () => {
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
    // destination must not touch the five-slot bar the raised Scan button's
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

    for (const label of ['Diary', 'Insights', 'Scan', 'Add', 'Menu']) {
      assert.ok(html.includes(`>${label}<`), `${label} must keep its visible text label`);
    }
  });

  it("gates the active raised button's scale animation on motion-safe", () => {
    const html = renderBottomNav('/add/photo');
    const scaleIndex = html.indexOf('scale-105');

    assert.notEqual(scaleIndex, -1, 'the active Scan tab lifts its circle');
    assert.ok(html.slice(0, scaleIndex).endsWith('motion-safe:'), 'scale must be motion-safe: gated');
  });

  it('marks the active tab with aria-current, raised or flat', () => {
    assert.ok(renderBottomNav('/add/photo').includes('aria-current="page"'), 'the raised tab keeps aria-current');
    assert.ok(renderBottomNav('/diary').includes('aria-current="page"'));
  });
});
