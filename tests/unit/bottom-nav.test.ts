/**
 * Unit tests for `#app/components/bottom-nav`, the mobile-only tab bar.
 * Renders to static markup inside a data router (no DOM needed) so the shape
 * of the bar cannot silently regress.
 *
 * THREE SLOTS SINCE M258 (operator decision, 2026-09-24): Diary, a raised plus
 * that opens the add sheet on a tap, and More, which opens a bottom sheet of
 * every page the bar does not carry. The five-slot bar of 0.46.0 (Diary,
 * Insights, Scan, Add, Menu) is gone, and with it the Scan circle that opened
 * the camera on a tap and the sheet on a long press. The sheets themselves are
 * Radix portals, which `renderToStaticMarkup` draws as nothing, so what is
 * asserted here is the bar; `tests/e2e/three-tab-bar.spec.ts` opens them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { BottomNav } from '../../app/components/bottom-nav';
import { barTabNavigationItems, personalNavigationItems } from '../../app/components/app-sidebar';

/**
 * A hermetic catalog rather than `app/i18n/i18n.ts`: the assertion this file
 * cares about is that the bar asks for `nav.*` and renders whatever comes
 * back, not that the shipped catalog is complete. Inline resources make `init`
 * resolve synchronously, so the very first render already sees them.
 */
void i18next.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        nav: { diary: 'Diary', trends: 'Insights', scan: 'Scan', add: 'Add', more: 'More' },
      },
    },
  },
  react: { useSuspense: false },
});

const LAUNCHER = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');

/** Every `href="..."` value in the rendered markup, in document order. */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
}

/**
 * A DATA router, not a `MemoryRouter`. The add launcher reads this instance's
 * policy through the root loader's public config (`usePublicConfig`), and that
 * read throws outside a data router rather than answering `undefined`. No
 * loader is registered here, so the policy resolves to the open-instance
 * default.
 */
function renderBottomNav(path = '/diary'): string {
  const router = createMemoryRouter([{ path: '*', element: createElement(BottomNav) }], {
    initialEntries: [path],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The one `<button ...>` opening tag carrying a slot, so its attributes can be read alone. */
function buttonTag(html: string, slot: string): string {
  const match = new RegExp(`<button[^>]*data-slot="${slot}"[^>]*>`).exec(html);
  assert.ok(match !== null, `the bar must draw the ${slot} button`);
  return match[0];
}

describe('BottomNav', () => {
  it('has exactly three slots: the Diary link, the plus, and More', () => {
    const html = renderBottomNav();

    // ONE href in the whole bar: the plus and More open sheets, they go nowhere.
    assert.deepEqual(hrefsOf(html), ['/diary']);
    assert.equal(barTabNavigationItems.length, 1, 'one catalog tab, Diary');
    assert.ok(html.includes('data-slot="bottom-nav-add"'), 'the plus is drawn');
    assert.ok(html.includes('data-slot="bottom-nav-more"'), 'More is drawn');
  });

  it('draws the three in order, so the plus is the centre of three', () => {
    const html = renderBottomNav();
    const diaryAt = html.indexOf('href="/diary"');
    const plusAt = html.indexOf('data-slot="bottom-nav-add"');
    const moreAt = html.indexOf('data-slot="bottom-nav-more"');

    assert.ok(diaryAt !== -1 && diaryAt < plusAt && plusAt < moreAt, 'Diary, then the plus, then More');
  });

  it('keeps every slot labelled in words, the raised plus included', () => {
    const html = renderBottomNav();

    for (const label of ['Diary', 'Add', 'More']) {
      assert.ok(html.includes(`>${label}<`), `${label} must keep its visible text label`);
    }
  });

  it('no longer carries Insights, Scan or the Add link', () => {
    // CONTROL for the three labels above: they are the whole bar, and the
    // three that left must be gone rather than merely moved.
    const html = renderBottomNav();

    assert.ok(!html.includes('>Insights<'), 'Insights is a More tile now');
    assert.ok(!html.includes('>Scan<'), 'Scan is a key inside the add sheet now');
    assert.ok(!hrefsOf(html).includes('/add/search'), 'the Add link is the plus now');
    assert.ok(!hrefsOf(html).includes('/trends'));
  });

  it('makes the plus a button that announces the add sheet, never a link or a camera', () => {
    const tag = buttonTag(renderBottomNav(), 'bottom-nav-add');

    assert.ok(tag.includes('aria-haspopup="dialog"'), 'the plus announces the sheet it opens');
    assert.ok(tag.includes('aria-expanded="false"'), 'and says it is shut');
    assert.ok(!tag.includes('href='), 'it opens a panel, it does not navigate');
  });

  it('makes More a button that announces its sheet', () => {
    const tag = buttonTag(renderBottomNav(), 'bottom-nav-more');

    assert.ok(tag.includes('aria-haspopup="dialog"'));
    assert.ok(tag.includes('aria-expanded="false"'));
    assert.ok(!tag.includes('href='));
  });

  it('opens the sheet on a tap and has no long press left', () => {
    // The circle used to open the camera on a tap and the sheet on a held
    // press. A tap opens the sheet now, through Radix's own trigger, and none
    // of the pointer plumbing the press needed is left to drift.
    assert.match(LAUNCHER, /<SheetTrigger asChild>\s*<button\s+ref=\{triggerRef\}/);
    assert.doesNotMatch(LAUNCHER, /onPointerDown|LONG_PRESS_MS|setTimeout|long-press'/);
    assert.doesNotMatch(LAUNCHER, /onClick=\{handleLauncherClick\}/, 'a tap on the circle opens the camera again');
  });

  it('still carries exactly one camera input, outside any sheet', () => {
    // The sheet's photo key borrows it (`add-launcher-targets.test.ts`).
    const html = renderBottomNav();

    assert.equal((html.match(/capture="environment"/g) ?? []).length, 1);
  });

  it('draws the plus as a raised circle in the brand fill, with a plus in it', () => {
    const html = renderBottomNav();

    assert.ok(html.includes('rounded-full'), 'the flagship action is a circle');
    assert.ok(html.includes('bg-primary text-primary-foreground'), 'filled with the brand, not an outline');
    assert.ok(html.includes('ring-background'), 'ringed so it reads as lifted off the bar');
    assert.ok(html.includes('lucide-plus'), 'the glyph is a plus, not a camera');
    assert.ok(!html.includes('lucide-camera'), 'no camera glyph is left in the bar');
  });

  it("lifts the plus on the add screens, motion-safe, and nowhere else", () => {
    const onAdd = renderBottomNav('/add/describe');
    const scaleIndex = onAdd.indexOf('scale-105');

    assert.notEqual(scaleIndex, -1, 'the plus lifts on an add screen');
    assert.ok(onAdd.slice(0, scaleIndex).endsWith('motion-safe:'), 'scale must be motion-safe: gated');
    assert.ok(buttonTag(onAdd, 'bottom-nav-add').includes('data-active="true"'));
    // CONTROL: on the diary the plus is at rest.
    assert.ok(!renderBottomNav('/diary').includes('scale-105'));
    assert.ok(!buttonTag(renderBottomNav('/diary'), 'bottom-nav-add').includes('data-active'));
  });

  it('lights More on the pages it holds, and not on the ones it does not', () => {
    for (const path of ['/trends', '/dashboard', '/pantry', '/fasting', '/nutrients', '/settings/nutrition']) {
      assert.ok(buttonTag(renderBottomNav(path), 'bottom-nav-more').includes('data-active="true"'), path);
    }
    // CONTROL: Diary is the bar's own tab, and Settings is the avatar menu's.
    for (const path of ['/diary', '/settings', '/settings/ai', '/add/search']) {
      assert.ok(!buttonTag(renderBottomNav(path), 'bottom-nav-more').includes('data-active'), path);
    }
  });

  it('marks the Diary tab with aria-current on its page, and never a button', () => {
    assert.ok(renderBottomNav('/diary').includes('aria-current="page"'));
    // A button is not a page: the tile inside the More sheet carries it.
    assert.ok(!renderBottomNav('/trends').includes('aria-current'));
    assert.ok(!renderBottomNav('/add/search').includes('aria-current'));
  });

  it('carries destinations the shared catalog also carries, the bar never re-lists its own hrefs', () => {
    const catalogHrefs = new Set(personalNavigationItems.map((item) => item.to));

    for (const href of hrefsOf(renderBottomNav())) {
      assert.ok(catalogHrefs.has(href), `${href} must come from personalNavigationItems`);
    }
  });
});
