/**
 * The `SYNC_SERVER_URL` gate and the CSP origin derived from it.
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
  isSyncConfigured,
  parseSyncServerUrl,
  syncConnectSrcOrigin,
  type PublicConfig,
} from '../../app/config/public-config';
import { ratePassphrase } from '../../app/lib/sync/passphrase-strength';

test('an unset, empty, or whitespace value means sync is OFF', () => {
  assert.equal(parseSyncServerUrl(undefined), null);
  assert.equal(parseSyncServerUrl(''), null);
  assert.equal(parseSyncServerUrl('   '), null);
});

test('a valid URL is kept, with any trailing slash trimmed', () => {
  assert.equal(parseSyncServerUrl('https://sync.example.com'), 'https://sync.example.com');
  // A trailing slash would produce `https://host//v1/sync/blob` at every call site.
  assert.equal(parseSyncServerUrl('https://sync.example.com/'), 'https://sync.example.com');
  assert.equal(parseSyncServerUrl('https://sync.example.com///'), 'https://sync.example.com');
  assert.equal(parseSyncServerUrl('  http://localhost:4000  '), 'http://localhost:4000');
});

test('a malformed value THROWS rather than silently disabling sync', () => {
  assert.throws(() => parseSyncServerUrl('sync.example.com'), /not a valid absolute URL/);
  assert.throws(() => parseSyncServerUrl('httpx://sync.example.com'), /must be an http\(s\) URL/);
  assert.throws(() => parseSyncServerUrl('ftp://sync.example.com'), /must be an http\(s\) URL/);
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
  assert.equal(isSyncConfigured({ syncServerUrl: null, instancePreset: null, analytics: null }), false);
  assert.equal(isSyncConfigured({ syncServerUrl: '', instancePreset: null, analytics: null }), false);
  assert.equal(isSyncConfigured({ syncServerUrl: 'https://sync.example.com', instancePreset: null, analytics: null }), true);
});

test('the public config carries exactly three members, and nothing else', () => {
  // A compile-time assertion made runtime-visible: if a FOURTH field is ever
  // added to `PublicConfig`, this fails and forces the addition to be a
  // decision rather than a side effect. The channel is an allowlist.
  //
  // Every member has passed the same test — it is an address the BROWSER dials
  // itself, which this server never proxies:
  //   - `syncServerUrl` (M128 spec 04)
  //   - `instancePreset` (M138 spec 06), an operator-provided AI endpoint
  //   - `analytics` (M165, .adr/0010-hosted-analytics.md), the Matomo the page
  //     itself loads the tracker from. Public by construction: both the URL and
  //     the site id ride in every tracker request the browser makes.
  // See `app/config/public-config.ts`'s header.
  const config: PublicConfig = { syncServerUrl: 'https://sync.example.com', instancePreset: null, analytics: null };
  assert.deepEqual(Object.keys(config).toSorted(), ['analytics', 'instancePreset', 'syncServerUrl']);
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
