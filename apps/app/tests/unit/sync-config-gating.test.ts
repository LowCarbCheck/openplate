/**
 * The `CORE_URL` gate and the CSP origin derived from it.
 *
 * The requirement is absolute: with sync unconfigured, no sync UI renders
 * anywhere and no sync request leaves the app. This file covers the parsing
 * and the predicate every surface funnels through, so "is sync on here" has
 * exactly one answer per instance rather than one per component.
 *
 * The other half — a malformed URL failing the BOOT rather than degrading to
 * "off" — matters because the degraded version is invisible: an operator who
 * typo'd the address would get a working, sync-free app and discover the
 * problem when their second device never showed anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCoreUrl,
  isSyncConfigured,
  parseCoreUrl,
  syncConnectSrcOrigin,
  type PublicConfig,
} from '../../app/config/public-config';
import { ratePassphrase } from '../../app/lib/sync/passphrase-strength';

/** `parseCoreUrl` as the config calls it for the current setting name. */
function parseCoreUrlForTest(raw: string | undefined): string | null {
  return parseCoreUrl({ raw, name: 'CORE_URL' });
}

test('an unset, empty, or whitespace value means sync is OFF', () => {
  assert.equal(parseCoreUrlForTest(undefined), null);
  assert.equal(parseCoreUrlForTest(''), null);
  assert.equal(parseCoreUrlForTest('   '), null);
});

test('a valid URL is kept, with any trailing slash trimmed', () => {
  assert.equal(parseCoreUrlForTest('https://sync.example.com'), 'https://sync.example.com');
  // A trailing slash would produce `https://host//v1/sync/blob` at every call site.
  assert.equal(parseCoreUrlForTest('https://sync.example.com/'), 'https://sync.example.com');
  assert.equal(parseCoreUrlForTest('https://sync.example.com///'), 'https://sync.example.com');
  assert.equal(parseCoreUrlForTest('  http://localhost:4000  '), 'http://localhost:4000');
});

test('a malformed value THROWS rather than silently disabling sync', () => {
  assert.throws(() => parseCoreUrlForTest('sync.example.com'), /not a valid absolute URL/);
  assert.throws(() => parseCoreUrlForTest('httpx://sync.example.com'), /must be an http\(s\) URL/);
  assert.throws(() => parseCoreUrlForTest('ftp://sync.example.com'), /must be an http\(s\) URL/);
});

test('the CSP entry is the ORIGIN only — connect-src ignores paths', () => {
  assert.equal(syncConnectSrcOrigin('https://sync.example.com/base/path'), 'https://sync.example.com');
  assert.equal(syncConnectSrcOrigin('http://localhost:4000'), 'http://localhost:4000');
  assert.equal(syncConnectSrcOrigin(null), null, 'nothing is appended when sync is off');
});

test('a non-default port survives into the CSP entry', () => {
  // Dropping it would silently block every sync request on a self-hosted
  // instance running on a port, with only a console warning to go on.
  assert.equal(syncConnectSrcOrigin('https://sync.example.com:8443'), 'https://sync.example.com:8443');
});

test('isSyncConfigured is false for every shape of "no config"', () => {
  assert.equal(isSyncConfigured(undefined), false, 'no root loader data — error boundaries take this path');
  assert.equal(isSyncConfigured({ coreUrl: null, syncServerUrl: null, instancePreset: null, analytics: null, managed: false, foodDbBackfill: false }), false);
  assert.equal(isSyncConfigured({ coreUrl: '', syncServerUrl: '', instancePreset: null, analytics: null, managed: false, foodDbBackfill: false }), false);
  assert.equal(
    isSyncConfigured({
      coreUrl: 'https://sync.example.com',
      syncServerUrl: 'https://sync.example.com',
      instancePreset: null,
      analytics: null,
      managed: false,
      foodDbBackfill: false,
    }),
    true,
  );
});

test('the public config carries exactly six members, and nothing else', () => {
  // A compile-time assertion made runtime-visible: if a FIFTH field is ever
  // added to `PublicConfig`, this fails and forces the addition to be a
  // decision rather than a side effect. The channel is an allowlist.
  //
  // `coreUrl` and `syncServerUrl` are ONE fact under two names: the second is
  // the old name of the first, kept for one release so a copy of the app
  // cached before the rename keeps finding its server.
  //
  // Three members passed the same test — each is an address the BROWSER dials
  // itself, which this server never proxies:
  //   - `syncServerUrl` (M128 spec 04)
  //   - `instancePreset` (M138 spec 06), an operator-provided AI endpoint
  //   - `analytics` (M165, .adr/0010-hosted-analytics.md), the Matomo the page
  //     itself loads the tracker from. Public by construction: both the URL and
  //     the site id ride in every tracker request the browser makes.
  //
  // `gatewayUrl` (M187 spec 03) was a fourth address and is GONE (M192): the
  // core server took over the AI proxy, so the browser dials one host.
  //
  // `managed` is the ONE member that is not an address, and it is admitted on
  // a different ground: it decides the SHAPE of the app (one door or two).
  // Deriving it per screen instead would let "this is a managed instance" be
  // true on one and false on the next.
  //
  // `foodDbBackfill` (M251/04) is admitted on the same ground as `managed`: a
  // boolean about the instance, not an address and not a secret. It decides
  // whether a proposal request can leave the page at all, and the key and the
  // upstream address it depends on stay on the server.
  const config: PublicConfig = {
    coreUrl: 'https://sync.example.com',
    syncServerUrl: 'https://sync.example.com',
    instancePreset: null,
    analytics: null,
    managed: false,
    foodDbBackfill: false,
  };
  assert.deepEqual(Object.keys(config).toSorted(), [
    'analytics',
    'coreUrl',
    'foodDbBackfill',
    'instancePreset',
    'managed',
    'syncServerUrl',
  ]);
});

test('the passphrase strength hint never blocks, and never flatters a short passphrase', () => {
  // Below the 12-character floor nothing earns better than "weak", however
  // many symbols are thrown at it — a short passphrase with punctuation is
  // still short, and this feature has no reset that recovers the data.
  assert.equal(ratePassphrase('Ab1!'), 'weak');
  assert.equal(ratePassphrase('Ab1!Ab1!Ab'), 'weak', '10 characters with every class is still under the floor');
  assert.equal(ratePassphrase('correcthorse'), 'fair', 'clearing the floor is never "weak"');
  assert.equal(ratePassphrase('Correct horse1!!'), 'strong', '16 characters with variety');
  assert.equal(ratePassphrase('seventeen purple lanterns drifting'), 'strong');
});

test('a malformed value names the setting it was read from', () => {
  assert.throws(() => parseCoreUrl({ raw: 'nope', name: 'SYNC_SERVER_URL' }), /^Error: SYNC_SERVER_URL is not a valid/);
  assert.throws(() => parseCoreUrl({ raw: 'nope', name: 'CORE_URL' }), /^Error: CORE_URL is not a valid/);
});

test('getCoreUrl takes coreUrl, falls back to the old syncServerUrl, and answers null with neither', () => {
  assert.equal(getCoreUrl({ coreUrl: 'https://core.example.com', syncServerUrl: null }), 'https://core.example.com');
  assert.equal(
    getCoreUrl({ coreUrl: 'https://core.example.com', syncServerUrl: 'https://old.example.com' }),
    'https://core.example.com',
    'the new field wins when both are there',
  );
  assert.equal(getCoreUrl({ coreUrl: null, syncServerUrl: null }), null);
  assert.equal(getCoreUrl(undefined), null, 'no root loader data');
});

test('a config from an older server, with no coreUrl at all, still has its server', () => {
  // What an older server's loader JSON holds once it is parsed: the new field is simply not there.
  const olderServerConfig = { syncServerUrl: 'https://old.example.com' };

  assert.equal(getCoreUrl(olderServerConfig), 'https://old.example.com');
});

test('control: a reader of coreUrl alone would lose the older server, which the case above forbids', () => {
  const olderServerConfig: Pick<PublicConfig, 'syncServerUrl'> & Partial<Pick<PublicConfig, 'coreUrl'>> = {
    syncServerUrl: 'https://old.example.com',
  };

  assert.equal(olderServerConfig.coreUrl ?? null, null, 'the older config has no coreUrl');
  assert.notEqual(getCoreUrl(olderServerConfig), olderServerConfig.coreUrl ?? null);
});
