/**
 * The scrubbed page address is the FIRST entry of the Matomo queue, before any
 * event (2026-10-05).
 *
 * ── The report ───────────────────────────────────────────────────────────
 *
 * Site 18 stored a one-time sign-in token. On 2026-09-02 an
 * `install-prompt-shown` event on `/verify-email?token=<token>` was recorded
 * with the REAL page address. Three other first-load events stored
 * `?checkout=success` and `?range=14&tab=nutrition&slot=dinner`.
 *
 * The cause: `_paq` is a queue that Matomo replays in order when its script
 * loads, and a request reports the custom URL that an earlier entry set, or the
 * real `location.href` when none did. The tracker hook pushed `setCustomUrl`
 * only after the script had loaded, so every event queued before that was
 * replayed ahead of it.
 *
 * ── What is read ─────────────────────────────────────────────────────────
 *
 * The queue itself, the way `analytics-event-levels.test.ts` reads it: a bare
 * `window` with a `location`, a `document` with a referrer, and an empty
 * `_paq`. The assertion is about POSITION. A `setCustomUrl` that is present but
 * sits after the event fixes nothing, so every test finds the event first and
 * requires the stamp to sit before it.
 *
 * Every test here fails against the code before this change: `trackEvent` then
 * pushed itself onto the queue with no `setCustomUrl` ahead of it at all.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  __resetAnalyticsEventLevelForTests,
  setAnalyticsEventLevel,
  stampAnalyticsPage,
  trackInstallPromptShown,
  trackOfflinePageview,
} from '../../app/lib/matomo-events';

const ORIGIN = 'https://openplate.de';

interface StubbedPage {
  paq: unknown[][];
  /** Moves the page, the way a client navigation does. */
  navigate: (href: string) => void;
}

/** Installs a `window` with a mutable `location` and an empty `_paq`, and a `document` with a referrer. */
function stubPage(options: { href: string; referrer: string }): StubbedPage {
  const paq: unknown[][] = [];
  const location = { href: options.href };
  Object.defineProperty(globalThis, 'window', { value: { _paq: paq, location }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', {
    value: { referrer: options.referrer },
    configurable: true,
    writable: true,
  });
  return {
    paq,
    navigate: (href) => {
      location.href = href;
    },
  };
}

afterEach(() => {
  __resetAnalyticsEventLevelForTests();
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

/** The queue entry at `index`, or a failing assertion that names what was there instead. */
function entryAt(paq: readonly unknown[][], index: number): unknown[] {
  const entry = paq[index];
  assert.ok(entry, `expected a queue entry at ${index}, queue was ${JSON.stringify(paq)}`);
  return entry;
}

const TOKEN_PAGES = [
  { path: '/verify-email?token=abc', scrubbed: `${ORIGIN}/verify-email`, secret: 'abc' },
  { path: '/reset-passphrase?token=x', scrubbed: `${ORIGIN}/reset-passphrase`, secret: 'token=x' },
  {
    path: '/oauth/openrouter/callback?code=y',
    scrubbed: `${ORIGIN}/oauth/openrouter/callback`,
    secret: 'code=y',
  },
  { path: '/settings/plan?checkout=success', scrubbed: `${ORIGIN}/settings/plan`, secret: 'checkout' },
  {
    path: '/trends?range=14&tab=nutrition&slot=dinner#chart',
    scrubbed: `${ORIGIN}/trends`,
    secret: 'range=14',
  },
] as const;

describe('an event queued before the tracker has initialised', () => {
  for (const page of TOKEN_PAGES) {
    it(`finds a scrubbed setCustomUrl ahead of it on ${page.path}`, () => {
      const stub = stubPage({ href: `${ORIGIN}${page.path}`, referrer: '' });
      setAnalyticsEventLevel('product');

      // No tracker hook has run: this is the child-effect event that arrives first.
      trackInstallPromptShown();

      const first = entryAt(stub.paq, 0);
      assert.equal(first[0], 'setCustomUrl', `the first entry was ${JSON.stringify(first)}`);
      assert.equal(first[1], page.scrubbed);
      const url = String(first[1]);
      assert.doesNotMatch(url, /token/);
      assert.doesNotMatch(url, /\?/);
      assert.doesNotMatch(url, /#/);
      assert.ok(!url.includes(page.secret), `the custom URL still carries ${page.secret}`);
      assert.deepEqual(entryAt(stub.paq, 1), ['trackEvent', 'PWA', 'install-prompt-shown']);
    });
  }

  it('also stamps the referrer, scrubbed, before the event', () => {
    const stub = stubPage({
      href: `${ORIGIN}/diary`,
      referrer: `${ORIGIN}/verify-email?token=fromreferrer`,
    });
    setAnalyticsEventLevel('product');

    trackInstallPromptShown();

    assert.deepEqual(stub.paq, [
      ['setCustomUrl', `${ORIGIN}/diary`],
      ['setReferrerUrl', `${ORIGIN}/verify-email`],
      ['trackEvent', 'PWA', 'install-prompt-shown'],
    ]);
    assert.doesNotMatch(JSON.stringify(stub.paq), /fromreferrer/);
  });

  it('stamps once per page, however many events the page fires', () => {
    const stub = stubPage({ href: `${ORIGIN}/diary?a=1`, referrer: '' });
    setAnalyticsEventLevel('product');

    trackInstallPromptShown();
    trackOfflinePageview();

    assert.deepEqual(stub.paq, [
      ['setCustomUrl', `${ORIGIN}/diary`],
      ['trackEvent', 'PWA', 'install-prompt-shown'],
      ['trackEvent', 'PWA', 'offline-pageview'],
    ]);
  });

  it('stamps nothing when the level lets no event out, so a pageviews instance queues nothing extra', () => {
    const stub = stubPage({ href: `${ORIGIN}/verify-email?token=abc`, referrer: '' });
    setAnalyticsEventLevel('pageviews');

    trackInstallPromptShown();

    assert.deepEqual(stub.paq, []);
  });
});

describe('the hook stamps the queue before it pushes anything of its own', () => {
  it('puts setCustomUrl ahead of disableCookies when no event came first', () => {
    const stub = stubPage({ href: `${ORIGIN}/verify-email?token=abc`, referrer: '' });

    // What the hook's load effect does, in its order.
    stampAnalyticsPage();
    stub.paq.push(['disableCookies']);

    assert.deepEqual(entryAt(stub.paq, 0), ['setCustomUrl', `${ORIGIN}/verify-email`]);
    assert.deepEqual(entryAt(stub.paq, 1), ['disableCookies']);
  });

  it('is done in the hook source before the first of its own pushes', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../app/hooks/use-matomo-tracker.ts', import.meta.url)),
      'utf8',
    );
    const stamp = source.indexOf('stampAnalyticsPage();');
    const firstPush = source.indexOf("_paq.push(['disableCookies'])");
    assert.ok(stamp !== -1, 'the hook never stamps the queue');
    assert.ok(firstPush !== -1, 'the hook no longer pushes disableCookies, update this test');
    assert.ok(stamp < firstPush, 'the hook pushes disableCookies before it stamps the queue');
  });

  it('force pushes again for a pageview, so Matomo gets a fresh custom URL per view', () => {
    const stub = stubPage({ href: `${ORIGIN}/diary`, referrer: '' });

    stampAnalyticsPage();
    stampAnalyticsPage();
    stampAnalyticsPage({ force: true });

    assert.deepEqual(
      stub.paq.map((entry) => entry[0]),
      ['setCustomUrl', 'setCustomUrl'],
    );
  });
});

describe('a client navigation', () => {
  it('stamps the new page before the events of the new route', () => {
    const stub = stubPage({ href: `${ORIGIN}/diary`, referrer: '' });
    setAnalyticsEventLevel('product');
    trackInstallPromptShown();

    stub.navigate(`${ORIGIN}/settings/plan?checkout=success`);
    trackOfflinePageview();

    assert.deepEqual(stub.paq, [
      ['setCustomUrl', `${ORIGIN}/diary`],
      ['trackEvent', 'PWA', 'install-prompt-shown'],
      ['setCustomUrl', `${ORIGIN}/settings/plan`],
      ['trackEvent', 'PWA', 'offline-pageview'],
    ]);
  });

  it('stamps again when the person comes back to an earlier page', () => {
    const stub = stubPage({ href: `${ORIGIN}/diary`, referrer: '' });
    setAnalyticsEventLevel('product');
    trackInstallPromptShown();
    stub.navigate(`${ORIGIN}/trends?range=14`);
    trackOfflinePageview();
    stub.navigate(`${ORIGIN}/diary`);
    trackOfflinePageview();

    const stamps = stub.paq.filter((entry) => entry[0] === 'setCustomUrl').map((entry) => entry[1]);
    assert.deepEqual(stamps, [`${ORIGIN}/diary`, `${ORIGIN}/trends`, `${ORIGIN}/diary`]);
  });
});
