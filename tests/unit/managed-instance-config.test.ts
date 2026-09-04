/**
 * `INSTANCE_MODE`, the refusal of `GATEWAY_URL`, and the one fact derived from
 * the pair: is this a MANAGED instance?
 *
 * The parser is ordinary. The predicate is not: `managed` decides the shape of
 * the product rather than the presence of a card, so both of its failure
 * directions are covered here.
 *
 * - A typo'd `INSTANCE_MODE` that degraded to `'open'` would not present a
 *   feature-missing app. It would present an OPEN one, on an instance an
 *   organization runs for its people: the welcome screen would offer to start
 *   an anonymous diary again. So an unrecognised value stops the boot.
 * - `INSTANCE_MODE=managed` without `SYNC_SERVER_URL` is the same failure
 *   wearing a different hat: every managed behaviour goes through that server,
 *   so answering `false` there would silently re-open the front door. It stops
 *   the boot too, naming both variables.
 * - `GATEWAY_URL` is the variable that USED to make an instance managed
 *   (M187/03, deleted by M192). An operator who upgrades without editing their
 *   environment must not silently get an open instance out of a file that
 *   still reads as a closed one, so setting it at all stops the boot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGatewayUrlUnset,
  isManagedInstance,
  isManagedInstanceConfig,
  parseInstanceMode,
  type PublicConfig,
} from '../../app/config/public-config';

/** An open instance's public config — the self-host default, and the baseline every case below moves off. */
const OPEN_CONFIG: PublicConfig = {
  syncServerUrl: null,
  instancePreset: null,
  analytics: null,
  managed: false,
};

test('an unset, empty, or whitespace INSTANCE_MODE means an open instance', () => {
  assert.equal(parseInstanceMode(undefined), 'open');
  assert.equal(parseInstanceMode(''), 'open');
  assert.equal(parseInstanceMode('   '), 'open');
});

test('both documented modes are accepted, case-insensitively and trimmed', () => {
  assert.equal(parseInstanceMode('open'), 'open');
  assert.equal(parseInstanceMode('managed'), 'managed');
  assert.equal(parseInstanceMode('  MANAGED  '), 'managed');
});

test('an unrecognised INSTANCE_MODE stops the boot rather than quietly re-opening the instance', () => {
  // The likeliest typo, and the one that would be silent: `manged` is not
  // `managed`, and falling back to `open` would offer an anonymous diary to
  // every visitor of an organization's app.
  assert.throws(() => parseInstanceMode('manged'), /Invalid INSTANCE_MODE/);
  assert.throws(() => parseInstanceMode('true'), /Invalid INSTANCE_MODE/);
  assert.throws(() => parseInstanceMode('1'), /Invalid INSTANCE_MODE/);
});

test('GATEWAY_URL set at all stops the boot, and the message names its replacement', () => {
  assert.doesNotThrow(() => assertGatewayUrlUnset(undefined));
  assert.doesNotThrow(() => assertGatewayUrlUnset(''));
  assert.doesNotThrow(() => assertGatewayUrlUnset('   '));

  // Caught by hand rather than with an `assert.throws` predicate: an `unknown`
  // parameter is refused by the anti-slop lint rules.
  let message: string | null = null;
  try {
    assertGatewayUrlUnset('https://gateway.example.com');
  } catch (caught) {
    message = caught instanceof Error ? caught.message : String(caught);
  }
  assert.notEqual(message, null, 'a leftover GATEWAY_URL must not resolve quietly to an open instance');
  assert.match(message ?? '', /GATEWAY_URL/);
  assert.match(message ?? '', /INSTANCE_MODE/, 'the operator has to be told what replaces it');
});

test('an open instance is open with or without sync', () => {
  assert.equal(isManagedInstance({ instanceMode: 'open', syncServerUrl: null }), false);
  assert.equal(
    isManagedInstance({ instanceMode: 'open', syncServerUrl: 'https://sync.example.com' }),
    false,
    'sync alone is an optional extra, not a managed instance',
  );
});

test('managed plus a server address is what makes an instance managed', () => {
  assert.equal(isManagedInstance({ instanceMode: 'managed', syncServerUrl: 'https://sync.example.com' }), true);
});

test('INSTANCE_MODE=managed without SYNC_SERVER_URL stops the boot, naming both variables', () => {
  let message: string | null = null;
  try {
    isManagedInstance({ instanceMode: 'managed', syncServerUrl: null });
  } catch (caught) {
    message = caught instanceof Error ? caught.message : String(caught);
  }
  assert.notEqual(message, null, 'a managed instance without a server must not resolve quietly to "open"');
  assert.match(message ?? '', /INSTANCE_MODE/);
  assert.match(message ?? '', /SYNC_SERVER_URL/, 'the operator has to be told which OTHER variable is missing');
});

test('the UI gate reads false for every shape of "not managed"', () => {
  assert.equal(isManagedInstanceConfig(undefined), false, 'no root loader data — error boundaries take this path');
  assert.equal(isManagedInstanceConfig(OPEN_CONFIG), false);
  assert.equal(isManagedInstanceConfig({ ...OPEN_CONFIG, managed: true }), true);
});
