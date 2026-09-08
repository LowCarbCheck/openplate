/**
 * THE TWO SCREENS THE M196 SWEEP DID NOT REACH.
 *
 * M196 made the landing page, the legal pages, onboarding and `/recover` tell
 * the truth on a managed instance, where the account keeps an
 * end-to-end-encrypted copy of the diary on the operator's server. Two device-only
 * claims stayed behind, both of them on screens nobody thinks of as marketing
 * copy:
 *
 *  - `offline.body`, the service worker's fallback page. It opens by saying
 *    the diary lives on this device, which is the reassurance the page exists
 *    to give and half the truth on a managed instance.
 *  - `settings.data.description`, the heading of "Your data". A person reading
 *    it is about to download their diary, which is exactly the moment they are
 *    thinking about where else it is.
 *
 * ── Why this file RENDERS ────────────────────────────────────────────────
 *
 * For the reason `landing-doors.test.ts` and `recover-managed-copy.test.ts`
 * render: a source grep proves a ternary was typed, never that the managed
 * branch reaches the screen. Both routes go through `renderToStaticMarkup`
 * under a data router whose ROOT carries the public config, which is the
 * channel `useInstancePolicy()` actually reads.
 *
 * ── And why it also reads the catalog ────────────────────────────────────
 *
 * A render proves the twin is on the screen; it says nothing about whether the
 * twin states the fact it exists to state. The last two suites below check
 * that each twin announces the server's copy and that neither carries a
 * sentence denying it, and both checks are calibrated against a control string
 * that must fail them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import Offline from '../../app/routes/offline';
import SettingsData from '../../app/routes/settings.data';
import enCommon from '../../app/i18n/locales/en/common.json';
import deCommon from '../../app/i18n/locales/de/common.json';
import type { PublicConfig } from '../../app/config/public-config';

/**
 * A managed instance always has a sync server (`isManagedInstance` refuses to
 * boot without one), so the two flags move together here, as they do in
 * `recover-managed-copy.test.ts`.
 */
function publicConfig(managed: boolean): PublicConfig {
  return { syncServerUrl: 'https://sync.openplate.test', analytics: null, instancePreset: null, managed };
}

/**
 * A route component, rendered under a router whose ROOT loader supplies the
 * public config.
 *
 * Neither route exports a loader of its own: the offline page is precached as
 * a static document and the data page reads the browser's store, so the root
 * is the only thing that has to be supplied. Effects do not run under
 * `renderToStaticMarkup`, so the photo-cache card's IndexedDB read stays out
 * of the way.
 *
 * @param route - the route's default export.
 * @param managed - the instance mode this render's public config reports.
 * @returns the page's markup.
 */
function renderRoute(route: ComponentType, managed: boolean): string {
  const config = publicConfig(managed);
  const page = withI18n(createElement(route));
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: page }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * Does the page render this exact source string?
 *
 * `renderToStaticMarkup` escapes the five characters React escapes, so a
 * sentence carrying an apostrophe never appears in the markup as it appears in
 * the catalog. The string is escaped the way React escapes it, then looked for.
 */
function rendersCopy(html: string, text: string): boolean {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
  return html.includes(escaped);
}

describe('the offline fallback page', () => {
  const MANAGED = renderRoute(Offline, true);
  const OPEN = renderRoute(Offline, false);

  it('names the encrypted copy on a managed instance', () => {
    assert.ok(rendersCopy(MANAGED, enCommon.offline.bodyManaged), MANAGED.slice(0, 400));
    assert.ok(!rendersCopy(MANAGED, enCommon.offline.body), 'the device-only body survived');
  });

  it('keeps the device-only body on an open instance, where it is the whole truth', () => {
    assert.ok(rendersCopy(OPEN, enCommon.offline.body), OPEN.slice(0, 400));
    assert.ok(!rendersCopy(OPEN, enCommon.offline.bodyManaged), 'the managed body reached a self-host');
  });

  it('still offers the way back into the diary in both modes', () => {
    // The page's whole job is the button. Pinned so a copy change cannot
    // arrive as a rewrite that drops it.
    for (const html of [MANAGED, OPEN]) assert.ok(html.includes('href="/diary"'), html.slice(0, 400));
  });
});

describe('the data and backup settings page', () => {
  const MANAGED = renderRoute(SettingsData, true);
  const OPEN = renderRoute(SettingsData, false);

  it('names the encrypted copy on a managed instance', () => {
    assert.ok(rendersCopy(MANAGED, enCommon.settings.data.descriptionManaged), MANAGED.slice(0, 400));
    assert.ok(!rendersCopy(MANAGED, enCommon.settings.data.description), 'the device-only description survived');
  });

  it('keeps the device-only description on an open instance', () => {
    assert.ok(rendersCopy(OPEN, enCommon.settings.data.description), OPEN.slice(0, 400));
    assert.ok(
      !rendersCopy(OPEN, enCommon.settings.data.descriptionManaged),
      'the managed description reached a self-host',
    );
  });

  it('offers the same download in both modes', () => {
    // The sentence above the buttons is the only thing the mode changes. If a
    // branch ever swallowed the export offer, that would be a managed instance
    // taking away the one thing this page exists for.
    for (const html of [MANAGED, OPEN]) {
      assert.ok(html.includes(enCommon.settings.data.downloadCsv), html.slice(0, 400));
      assert.ok(html.includes(enCommon.settings.data.downloadJson), html.slice(0, 400));
    }
  });
});

/** The two twins added here, per locale, paired with the string each one replaces. */
const TWINS = [
  {
    path: 'offline.bodyManaged',
    en: { managed: enCommon.offline.bodyManaged, open: enCommon.offline.body },
    de: { managed: deCommon.offline.bodyManaged, open: deCommon.offline.body },
  },
  {
    path: 'settings.data.descriptionManaged',
    en: { managed: enCommon.settings.data.descriptionManaged, open: enCommon.settings.data.description },
    de: { managed: deCommon.settings.data.descriptionManaged, open: deCommon.settings.data.description },
  },
];

/**
 * Does this string tell the reader that a server holds a copy it cannot read?
 *
 * Three facts have to be present, because two of them alone are each a
 * different sentence: "the server" without "encrypted" is the frightening
 * half, and "encrypted" without "cannot read" is a technical detail rather
 * than a promise. Written to match either locale so one predicate governs both.
 */
function announcesTheLockedCopy(text: string): boolean {
  return (
    /\bserver\b/i.test(text) &&
    /(encrypted|verschlüsselte)/i.test(text) &&
    /(cannot read|nicht lesen)/i.test(text)
  );
}

/**
 * The sentences that DENY a server copy. Each is a true thing an open instance
 * says, and a false thing on a managed one.
 *
 * "the key never leaves this device" is deliberately absent: it is about the
 * KEY, it is true in both modes, and it is the reason the copy is harmless.
 */
const DEVICE_ONLY_DENIALS = [/keeps no copy/i, /no copy of/i, /keine Kopie/i, /nur auf diesem Gerät/i];

function deniesTheServerCopy(text: string): boolean {
  return DEVICE_ONLY_DENIALS.some((pattern) => pattern.test(text));
}

describe('each twin states the fact it was added to state', () => {
  for (const { path, en, de } of TWINS) {
    for (const [locale, pair] of Object.entries({ en, de })) {
      it(`${path} announces the locked copy in ${locale}`, () => {
        assert.ok(announcesTheLockedCopy(pair.managed), `${locale} ${path}: ${pair.managed}`);
      });

      // THE CONTROL. The predicate above is only worth running if it can fail,
      // and the string it must reject is the very one this twin replaces: a
      // "tidy-up" that pointed the managed key back at the open sentence would
      // pass every render assertion in this file and fail here.
      it(`the string ${path} replaces does not announce it, in ${locale}`, () => {
        assert.ok(!announcesTheLockedCopy(pair.open), `the control string already says it: ${pair.open}`);
      });

      it(`${path} denies no server copy in ${locale}`, () => {
        assert.ok(!deniesTheServerCopy(pair.managed), `${locale} ${path}: ${pair.managed}`);
      });
    }
  }

  // THE SECOND CONTROL. `deniesTheServerCopy` returning false for every twin
  // proves nothing unless the detector fires on a sentence that really does
  // deny the copy. The landing card's OPEN body is that sentence, in both
  // locales, and it is the exact wording M196 had to branch away from.
  it('the denial detector fires on a sentence that denies the copy', () => {
    assert.ok(deniesTheServerCopy(enCommon.landing.features.local.body), enCommon.landing.features.local.body);
    assert.ok(deniesTheServerCopy(deCommon.landing.features.local.body), deCommon.landing.features.local.body);
  });

  it('no twin is the string it replaces', () => {
    for (const { path, en, de } of TWINS) {
      assert.notEqual(en.managed, en.open, path);
      assert.notEqual(de.managed, de.open, path);
    }
  });
});
