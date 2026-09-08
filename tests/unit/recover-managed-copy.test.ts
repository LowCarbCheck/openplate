/**
 * THE RECOVERY SCREEN MUST NOT GIVE A MANAGED PERSON THE OPPOSITE ADVICE
 * (M196 spec 02).
 *
 * `/recover` is the screen a device lands on when its local diary came back
 * empty. Its whole job is to say what is actually known and offer the remedy
 * that actually exists, and on an open instance that is: nothing was ever sent
 * anywhere, so restore a backup file or start again. Saying so plainly is the
 * point of the page.
 *
 * On a managed instance every word of that is wrong. The account keeps an
 * end-to-end-encrypted copy on the operator's server, so a person who has just
 * lost their diary was being told, at the worst possible moment, that no other
 * copy exists and that fetching one is impossible. The copy is there and one
 * sign-in brings it back.
 *
 * So this file RENDERS the route, both ways, for the reason `landing-doors.test.ts`
 * renders the landing page: a grep proves a ternary exists, not that the
 * managed branch reaches the screen or that the door the managed sentence names
 * is on it. The two directions are equally load-bearing, and the last case
 * below pins what the two leads SAY rather than which key they are, so a later
 * rewrite cannot quietly collapse the pair into one sentence again.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import Recover from '../../app/routes/recover';
import enCommon from '../../app/i18n/locales/en/common.json';
import type { PublicConfig } from '../../app/config/public-config';

/**
 * A managed instance always has a sync server (`isManagedInstance` refuses to
 * boot without one), so the two flags move together here on purpose.
 */
function publicConfig(managed: boolean): PublicConfig {
  return {
    syncServerUrl: 'https://sync.openplate.test',
    analytics: null,
    instancePreset: null,
    managed,
  };
}

/**
 * The real screen, rendered under a router whose ROOT carries the public
 * config, which is the channel `useInstancePolicy()` reads.
 *
 * The route exports no loader of any kind (the backup file is read in the
 * browser), so nothing but the root has to be supplied. Effects do not run
 * under `renderToStaticMarkup`, so the IndexedDB marker read stays out of the
 * way and the "first held data on" line simply does not render.
 *
 * @param managed - the instance mode this render's public config reports.
 * @returns the page's markup.
 */
function renderRecover(managed: boolean): string {
  const config = publicConfig(managed);
  const page = withI18n(createElement(Recover));
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

/** How many times a destination appears as an `href` in the rendered page. */
function hrefCount(html: string, path: string): number {
  return html.split(`href="${path}"`).length - 1;
}

const MANAGED = renderRecover(true);
const OPEN = renderRecover(false);

describe('the recovery screen on a managed instance', () => {
  it('says the copy exists, instead of saying nothing was ever sent', () => {
    assert.ok(rendersCopy(MANAGED, enCommon.recover.leadManaged), MANAGED.slice(0, 400));
    assert.ok(!rendersCopy(MANAGED, enCommon.recover.lead), 'the device-only lead survived');
  });

  it('offers the one door its own sentence names, exactly once', () => {
    // The managed lead ends by telling the person to sign in again. A page
    // that says it without carrying the link makes them hunt for a route they
    // were just told to take, and two links would be the same offer twice.
    assert.equal(hrefCount(MANAGED, '/sign-in'), 1, MANAGED.slice(0, 400));
    assert.ok(MANAGED.includes(enCommon.chrome.signIn), 'the door is unlabelled');
  });

  it('keeps the remedy that needs no account', () => {
    // Restoring from a file works in both modes, and a person holding a backup
    // should not have to sign in first. Pinned so the new door cannot arrive
    // as a replacement for the old one.
    assert.ok(MANAGED.includes(enCommon.recover.restoreHeading), MANAGED.slice(0, 400));
    assert.ok(MANAGED.includes(enCommon.recover.restoreButton));
  });
});

describe('the recovery screen on an open instance', () => {
  it('keeps the lead it always had, because it is true there', () => {
    assert.ok(rendersCopy(OPEN, enCommon.recover.lead), OPEN.slice(0, 400));
    assert.ok(!rendersCopy(OPEN, enCommon.recover.leadManaged), 'the managed lead reached a self-host');
  });

  it('offers no sign-in door, because there is nothing to sign in to', () => {
    assert.equal(hrefCount(OPEN, '/sign-in'), 0, OPEN.slice(0, 400));
  });
});

describe('the two leads state two different facts', () => {
  it('cannot both drift into the same sentence', () => {
    // WITHOUT THIS the four assertions above pass on a "tidy-up" that points
    // both keys at one polite paragraph: each page would render its own key
    // and neither would render the other, because there would be nothing left
    // to tell apart. The FACT each one states is what is pinned here.
    assert.notEqual(enCommon.recover.lead, enCommon.recover.leadManaged);
    assert.match(enCommon.recover.lead, /sends nothing to a server/);
    assert.ok(
      !/sends nothing to a server/.test(enCommon.recover.leadManaged),
      'the managed lead denies the server copy it exists to announce',
    );
    assert.match(enCommon.recover.leadManaged, /sign in again/i);
  });

  it('uses no em dash and no en dash, like every managed string', () => {
    for (const [key, text] of Object.entries({
      'recover.lead': enCommon.recover.lead,
      'recover.leadManaged': enCommon.recover.leadManaged,
    })) {
      assert.ok(!/[–—]/.test(text), `${key} carries a dash: ${text}`);
    }
  });
});
