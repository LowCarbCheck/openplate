/**
 * Unit tests for `#app/components/app-sidebar`'s `personalNavigationItems` —
 * the desktop sidebar's food-tracker nav. Asserts data only (no render):
 * `AppSidebar` calls `useOptionalUser()`, which needs a real `root`-id data
 * router to resolve (`useRouteLoaderData('root')`) — not worth the harness
 * cost for a five-item label/href check (see `bottom-nav.test.ts` and the
 * usability-overhaul round's memory note for the same judgment call on
 * `app-wrapper.tsx`'s account dropdown).
 *
 * The usability-overhaul fix this used to lock in: the sidebar used to say
 * "Scan Plate" / "Add food" / "AI Settings" while the mobile bottom nav said
 * "Scan" / "Add" / "Goals" for the same five destinations, so a laptop user
 * and a phone user on the same account saw two different maps of the app.
 * Since M129/05 every surface reads catalog KEYS, and since M258 the phone
 * splits the catalog three ways through each entry's `phone` field: Diary is
 * the bar's one tab, Add and Scan sit behind the raised plus, and every other
 * page is a More tile.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeNavigationHref,
  footerNavigationItems,
  personalNavigationItems,
  primaryNavigationItems,
  barTabNavigationItems,
  moreSheetNavigationItems,
} from '../../app/components/app-sidebar';

describe('personalNavigationItems', () => {
  it('lists the ten sidebar destinations, in order, with the same catalog keys/hrefs the phone surfaces use', () => {
    // M129/05: both navs now carry catalog KEYS. Pinning the key (not the
    // rendered English) is what keeps the two navs from drifting — a wording
    // change now lands in one catalog entry and moves both.
    assert.deepEqual(
      personalNavigationItems.map((item) => ({ labelKey: item.labelKey, to: item.to })),
      [
        // The app home leads the list (M134) — it is where the in-app brand
        // mark and the public "Open the tracker" button both point.
        { labelKey: 'nav.dashboard', to: '/dashboard' },
        { labelKey: 'nav.diary', to: '/diary' },
        { labelKey: 'nav.add', to: '/add/search' },
        { labelKey: 'nav.scan', to: '/add/photo' },
        // The pantry (M233/02) sits directly after Scan: it is the second
        // thing the camera is for, the same composer pointed at a shelf.
        { labelKey: 'nav.pantry', to: '/pantry' },
        // The fasting timer (M132) sits with the doing-surfaces, before the
        // reviewing ones.
        { labelKey: 'nav.fasting', to: '/fasting' },
        // Insights, a More tile on a phone since M258.
        { labelKey: 'nav.trends', to: '/trends' },
        // The nutrient screen (M135/06) is a reviewing surface, so it sits
        // beside Insights.
        { labelKey: 'nav.nutrients', to: '/nutrients' },
        { labelKey: 'nav.goals', to: '/settings/nutrition' },
        // The settings HUB, not the Preferences page it used to point at —
        // one setting can't stand in for all of them. It sits in the separated
        // footer group, not among the daily destinations.
        { labelKey: 'nav.settings', to: '/settings' },
      ],
    );
  });

  it('never links directly to the AI-key page — that used to be a top-level desktop destination', () => {
    assert.ok(!personalNavigationItems.some((item) => item.to === '/settings/ai'));
  });

  it('carries no hardcoded English — every label goes through the catalog', () => {
    assert.ok(personalNavigationItems.every((item) => item.labelKey.startsWith('nav.')));
  });
});

describe('navigation surfaces', () => {
  it('gives the sidebar nine primary rows plus a Settings footer', () => {
    assert.deepEqual(
      primaryNavigationItems.map((item) => item.to),
      [
        '/dashboard',
        '/diary',
        '/add/search',
        '/add/photo',
        '/pantry',
        '/fasting',
        '/trends',
        '/nutrients',
        '/settings/nutrition',
      ],
    );
    assert.deepEqual(
      footerNavigationItems.map((item) => item.to),
      ['/settings'],
    );
  });

  it('gives the phone bar exactly one flat tab, Diary', () => {
    // The other two slots are not destinations: the plus opens the add sheet
    // and More opens the More sheet, so neither is a catalog entry.
    assert.deepEqual(
      barTabNavigationItems.map((item) => item.to),
      ['/diary'],
    );
  });

  it('puts Add and Scan behind the plus, and nothing else', () => {
    assert.deepEqual(
      personalNavigationItems.filter((item) => item.phone === 'plus').map((item) => item.to),
      ['/add/search', '/add/photo'],
    );
  });

  it('gives the More sheet the six other pages, the drawer order reversed', () => {
    // Reversed so the most used page is nearest the thumb: the grid fills from
    // the top left, so Overview, first in the catalog, lands bottom right.
    assert.deepEqual(
      moreSheetNavigationItems.map((item) => item.to),
      ['/settings/nutrition', '/nutrients', '/trends', '/fasting', '/pantry', '/dashboard'],
    );
  });

  it('keeps configuration out of the More sheet', () => {
    // Settings, Plan and Administration are in the avatar menu on a phone.
    const tiles = new Set(moreSheetNavigationItems.map((item) => item.to));
    for (const href of ['/settings', '/settings/plan', '/admin']) {
      assert.ok(!tiles.has(href), `${href} must not be a More tile`);
    }
  });

  it('gives every primary page exactly one place on a phone', () => {
    // A page in the bar AND in the sheet would be two doors to one room, and a
    // page in neither would be unreachable on a phone. The split is total and
    // disjoint.
    const onPhone = [
      ...barTabNavigationItems,
      ...personalNavigationItems.filter((item) => item.phone === 'plus'),
      ...moreSheetNavigationItems,
    ].map((item) => item.to);
    assert.deepEqual(onPhone.toSorted(), primaryNavigationItems.map((item) => item.to).toSorted());
    assert.equal(new Set(onPhone).size, onPhone.length);
  });

  it('never gives a footer entry a phone place', () => {
    assert.ok(footerNavigationItems.every((item) => item.phone === undefined));
  });

  it('splits the catalog exhaustively, every destination lands in exactly one sidebar group', () => {
    assert.deepEqual([...primaryNavigationItems, ...footerNavigationItems].length, personalNavigationItems.length);
  });

  it('derives the phone lists from the catalog, a tile is the SAME object the sidebar renders', () => {
    // The anti-drift point of the whole catalog: a tab or a tile cannot carry
    // its own label or href, so the phone and the sidebar cannot disagree.
    for (const item of [...barTabNavigationItems, ...moreSheetNavigationItems]) {
      assert.ok(personalNavigationItems.includes(item), `${item.to} must be a catalog entry`);
    }
  });
});

describe('activeNavigationHref', () => {
  it('highlights the exact destination', () => {
    assert.equal(activeNavigationHref('/diary'), '/diary');
    assert.equal(activeNavigationHref('/settings'), '/settings');
  });

  it('keeps the app home and the diary apart — neither prefix touches the other', () => {
    assert.equal(activeNavigationHref('/dashboard'), '/dashboard');
    assert.equal(activeNavigationHref('/diary'), '/diary');
  });

  it('highlights a parent for its child paths', () => {
    assert.equal(activeNavigationHref('/diary/entry/12'), '/diary');
  });

  it('gives the longest match the highlight — a settings PAGE never lights up the hub row too', () => {
    // The bug this pins: `/settings` and `/settings/nutrition` both live in
    // the catalog, so a naive per-item `startsWith` lit two rows at once.
    assert.equal(activeNavigationHref('/settings/nutrition'), '/settings/nutrition');
    assert.equal(activeNavigationHref('/settings/ai'), '/settings');
  });

  it('returns null outside the catalog', () => {
    assert.equal(activeNavigationHref('/privacy'), null);
  });
});
