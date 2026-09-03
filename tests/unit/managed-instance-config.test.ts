/**
 * `GATEWAY_URL`, and the one fact derived from it: is this a MANAGED instance?
 *
 * The two parsers are ordinary. The predicate is not: `managed` decides the
 * shape of the product rather than the presence of a card, so both of its
 * failure directions are covered here.
 *
 * - A typo'd `GATEWAY_URL` that degraded to `null` would not present a
 *   feature-missing app. It would present an OPEN one, on an instance whose
 *   operator is running a closed beta: the welcome screen would offer to start
 *   an anonymous diary again. So a malformed value stops the boot.
 * - `GATEWAY_URL` without `SYNC_SERVER_URL` is the same failure wearing a
 *   different hat: a gateway hands somebody AI, and the account is what
 *   carries that connection to their second device and holds the diary it
 *   produces. Answering `false` there would silently re-open the front door,
 *   so it stops the boot too, naming both variables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gatewayConnectSrcOrigin,
  getGatewayUrl,
  isManagedInstance,
  isManagedInstanceConfig,
  parseGatewayUrl,
  type PublicConfig,
} from '../../app/config/public-config';

/** An open instance's public config — the self-host default, and the baseline every case below moves off. */
const OPEN_CONFIG: PublicConfig = {
  syncServerUrl: null,
  instancePreset: null,
  analytics: null,
  gatewayUrl: null,
  managed: false,
};

test('an unset, empty, or whitespace GATEWAY_URL means no gateway', () => {
  assert.equal(parseGatewayUrl(undefined), null);
  assert.equal(parseGatewayUrl(''), null);
  assert.equal(parseGatewayUrl('   '), null);
});

test('a valid GATEWAY_URL is kept, with any trailing slash trimmed', () => {
  assert.equal(parseGatewayUrl('https://gateway.example.com'), 'https://gateway.example.com');
  // A trailing slash would produce `https://host//v1/gateway/info` at every call site.
  assert.equal(parseGatewayUrl('https://gateway.example.com/'), 'https://gateway.example.com');
  assert.equal(parseGatewayUrl('https://gateway.example.com///'), 'https://gateway.example.com');
  assert.equal(parseGatewayUrl('  http://localhost:8080  '), 'http://localhost:8080');
});

test('a malformed GATEWAY_URL stops the boot rather than quietly re-opening the instance', () => {
  assert.throws(() => parseGatewayUrl('gateway.example.com'), /GATEWAY_URL is not a valid absolute URL/);
  assert.throws(() => parseGatewayUrl('not a url at all'), /GATEWAY_URL is not a valid absolute URL/);
  assert.throws(() => parseGatewayUrl('ftp://gateway.example.com'), /GATEWAY_URL must be an http\(s\) URL/);
  assert.throws(() => parseGatewayUrl('httpx://gateway.example.com'), /GATEWAY_URL must be an http\(s\) URL/);
});

test('the CSP entry is the ORIGIN only — connect-src ignores paths', () => {
  assert.equal(gatewayConnectSrcOrigin('https://gateway.example.com/v1'), 'https://gateway.example.com');
  assert.equal(gatewayConnectSrcOrigin('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(gatewayConnectSrcOrigin(null), null, 'nothing is appended when no gateway is configured');
});

test('a non-default gateway port survives into the CSP entry', () => {
  // Dropping it would block the redeem call and every scan after it, with only
  // a console violation in one browser to go on.
  assert.equal(gatewayConnectSrcOrigin('https://gateway.example.com:8443'), 'https://gateway.example.com:8443');
});

test('no GATEWAY_URL means an OPEN instance, with or without sync', () => {
  assert.equal(isManagedInstance({ gatewayUrl: null, syncServerUrl: null }), false);
  assert.equal(
    isManagedInstance({ gatewayUrl: null, syncServerUrl: 'https://sync.example.com' }),
    false,
    'sync alone is an optional extra, not a managed instance',
  );
});

test('both halves configured is what makes an instance managed', () => {
  assert.equal(
    isManagedInstance({ gatewayUrl: 'https://gateway.example.com', syncServerUrl: 'https://sync.example.com' }),
    true,
  );
});

test('GATEWAY_URL without SYNC_SERVER_URL stops the boot, naming both variables', () => {
  // Three assertions on one message, so the operator is told which variable is
  // missing and why the pair is a pair. `assert.throws` with a predicate would
  // read better and is not available here: an `unknown` parameter is refused
  // by the anti-slop lint rules, so the throw is caught by hand instead.
  let message: string | null = null;
  try {
    isManagedInstance({ gatewayUrl: 'https://gateway.example.com', syncServerUrl: null });
  } catch (caught) {
    message = caught instanceof Error ? caught.message : String(caught);
  }
  assert.notEqual(message, null, 'a gateway without accounts must not resolve quietly to "open"');
  assert.match(message ?? '', /GATEWAY_URL/);
  assert.match(message ?? '', /SYNC_SERVER_URL/, 'the operator has to be told which OTHER variable is missing');
  assert.match(message ?? '', /accounts/, 'and why a gateway without accounts is not a managed instance');
});

test('the UI gate reads false for every shape of "not managed"', () => {
  assert.equal(isManagedInstanceConfig(undefined), false, 'no root loader data — error boundaries take this path');
  assert.equal(isManagedInstanceConfig(OPEN_CONFIG), false);
  assert.equal(
    isManagedInstanceConfig({ ...OPEN_CONFIG, gatewayUrl: 'https://gateway.example.com' }),
    false,
    'the address alone does not flip the shape of the app — `managed` does',
  );
  assert.equal(isManagedInstanceConfig({ ...OPEN_CONFIG, managed: true }), true);
});

test('the gateway address reads null on an instance that configured none', () => {
  assert.equal(getGatewayUrl(undefined), null);
  assert.equal(getGatewayUrl(OPEN_CONFIG), null);
  assert.equal(
    getGatewayUrl({ ...OPEN_CONFIG, gatewayUrl: 'https://gateway.example.com', managed: true }),
    'https://gateway.example.com',
  );
});
