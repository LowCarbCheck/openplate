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
 * "Scan" / "Add" / "Goals" for the same five destinations — a laptop user
 * and a phone user on the same account saw two different maps of the app.
 * `BottomNav` has since dropped its Goals tab (moved into `app-wrapper.tsx`'s
 * top-left logo menu, which also carries Profile/AI settings) to keep the
 * mobile footer to its four highest-frequency destinations, so the sidebar
 * and `BottomNav` deliberately no longer have identical destination counts —
 * only the labels/hrefs BOTH navs still share need to keep matching. Since
 * M129/05 that match is asserted on the i18n catalog KEY rather than the
 * English label, which is the thing that can now drift.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeNavigationHref,
  footerNavigationItems,
  personalNavigationItems,
  primaryNavigationItems,
  tabNavigationItems,
} from '../../app/components/app-sidebar';

describe('personalNavigationItems', () => {
  it('lists the nine drawer/sidebar destinations, in order, with the same catalog keys/hrefs BottomNav also uses for its three tabs', () => {
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
        { labelKey: 'nav.add', to: '/add' },
        { labelKey: 'nav.scan', to: '/scan' },
        // The fasting timer (M132) sits with the doing-surfaces, before the
        // reviewing ones — and deliberately never reaches the tab bar.
        { labelKey: 'nav.fasting', to: '/fasting' },
        { labelKey: 'nav.trends', to: '/trends' },
        // The nutrient screen (M135/06) is a reviewing surface, so it sits
        // beside Trends — and never reaches the tab bar either.
        { labelKey: 'nav.nutrients', to: '/nutrients' },
        { labelKey: 'nav.goals', to: '/settings/goals' },
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
  it('gives the drawer and the sidebar the same eight primary rows plus a Settings footer', () => {
    assert.deepEqual(
      primaryNavigationItems.map((item) => item.to),
      ['/dashboard', '/diary', '/add', '/scan', '/fasting', '/trends', '/nutrients', '/settings/goals'],
    );
    assert.deepEqual(
      footerNavigationItems.map((item) => item.to),
      ['/settings'],
    );
  });

  it('gives the tab bar the daily logging loop only, in bar order', () => {
    // Trends and Goals are review/configuration, so they live in the drawer
    // and the sidebar — not in the bar a user taps several times a day.
    assert.deepEqual(
      tabNavigationItems.map((item) => item.to),
      ['/diary', '/scan', '/add'],
    );
  });

  it('never promotes the fasting timer into the bar — three slots is what makes Scan a real centre', () => {
    const fasting = personalNavigationItems.find((item) => item.to === '/fasting');

    assert.ok(fasting !== undefined, 'the catalog must carry the fasting timer');
    assert.equal(fasting.tab, undefined, '/fasting must never carry a tab field');
  });

  it('raises exactly one tab — the signature Scan action', () => {
    assert.deepEqual(
      tabNavigationItems.filter((item) => item.tab?.raised === true).map((item) => item.to),
      ['/scan'],
    );
  });

  it('splits the catalog exhaustively — every destination lands in exactly one drawer group', () => {
    assert.deepEqual([...primaryNavigationItems, ...footerNavigationItems].length, personalNavigationItems.length);
  });

  it('derives tabs from the catalog — a tab entry is the SAME object the drawer renders', () => {
    // The anti-drift point of the whole catalog: a tab can't carry its own
    // label or href, so the bar and the drawer cannot disagree.
    for (const tab of tabNavigationItems) {
      assert.ok(personalNavigationItems.includes(tab), `${tab.to} must be a catalog entry`);
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
    // The bug this pins: `/settings` and `/settings/goals` both live in the
    // catalog, so a naive per-item `startsWith` lit two rows at once.
    assert.equal(activeNavigationHref('/settings/goals'), '/settings/goals');
    assert.equal(activeNavigationHref('/settings/ai'), '/settings');
  });

  it('returns null outside the catalog', () => {
    assert.equal(activeNavigationHref('/privacy'), null);
  });
});
