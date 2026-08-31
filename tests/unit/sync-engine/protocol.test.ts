/**
 * CROSS-REPO DRIFT GUARD for the sync wire contract (M128 spec 01).
 *
 * `app/lib/sync/engine/protocol.ts` here and `src/protocol.ts` in the
 * `openplate-sync` repo are hand-maintained duplicates of one contract. There
 * is no shared package and no shared CI, so nothing structurally prevents one
 * side from being edited alone — and a silent protocol split between a client
 * and the server holding the user's only synced copy of their data is about
 * the worst failure this system has.
 *
 * The defence is deliberately dumb: the EXPECTED values below are TRANSCRIBED
 * literals, not imports. Both repos carry the same block
 * (`tests/unit/protocol.test.ts` there). Changing the protocol therefore
 * means editing four places — two sources and two tests — and forgetting any
 * of them fails a test instead of shipping.
 *
 * When you DO intend to change the contract: update `PROTOCOL.md` first (it
 * is the normative document), then both `protocol.ts` files, then both of
 * these tests, in the same change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOB_VERSION_RETENTION,
  ENVELOPE_VERSION,
  MAX_BLOB_BYTES,
  PROTOCOL_VERSION,
  SYNC_API_PREFIX,
  SYNC_KEY_RECORD_KINDS,
  checkProtocolCompatibility,
  isProtocolHandshake,
  SIGNUP_MODES,
  isSyncKeyRecordKind,
} from '../../../app/lib/sync/engine/protocol';

// --- Transcribed from openplate-sync/src/protocol.ts. Keep in lockstep. ---
const EXPECTED_PROTOCOL_VERSION = 1;
const EXPECTED_ENVELOPE_VERSION = 1;
const EXPECTED_MAX_BLOB_BYTES = 2 * 1024 * 1024;
const EXPECTED_BLOB_VERSION_RETENTION = 5;
// `/v1/sync` since M128 spec 02 — the standalone service versions its whole
// URL space, so the blob routes sit beside `/v1/auth/*`. Pre-1.0, so no
// PROTOCOL_VERSION bump (PROTOCOL.md §7).
const EXPECTED_SYNC_API_PREFIX = '/v1/sync';
const EXPECTED_KEY_RECORD_KINDS = ['passphrase', 'recovery'];
// -------------------------------------------------------------------------

test('PROTOCOL_VERSION matches the value the service repo declares', () => {
  assert.equal(PROTOCOL_VERSION, EXPECTED_PROTOCOL_VERSION);
});

test('ENVELOPE_VERSION matches the value the service repo declares', () => {
  assert.equal(ENVELOPE_VERSION, EXPECTED_ENVELOPE_VERSION);
});

test('size and retention limits match the values the service repo enforces', () => {
  assert.equal(MAX_BLOB_BYTES, EXPECTED_MAX_BLOB_BYTES);
  assert.equal(BLOB_VERSION_RETENTION, EXPECTED_BLOB_VERSION_RETENTION);
});

test('the route prefix and key-record kinds match the service repo', () => {
  assert.equal(SYNC_API_PREFIX, EXPECTED_SYNC_API_PREFIX);
  assert.deepEqual([...SYNC_KEY_RECORD_KINDS], EXPECTED_KEY_RECORD_KINDS);
});

test('checkProtocolCompatibility accepts a service reporting our exact versions', () => {
  const result = checkProtocolCompatibility({
    protocolVersion: PROTOCOL_VERSION,
    envelopeVersion: ENVELOPE_VERSION,
    serviceVersion: '0.1.0',
  });
  assert.equal(result.status, 'compatible');
});

test('checkProtocolCompatibility REFUSES a protocol-version mismatch, with both versions named', () => {
  const result = checkProtocolCompatibility({
    protocolVersion: PROTOCOL_VERSION + 1,
    envelopeVersion: ENVELOPE_VERSION,
    serviceVersion: '0.2.0',
  });
  assert.equal(result.status, 'incompatible');
  if (result.status !== 'incompatible') return;
  assert.match(result.reason, new RegExp(String(PROTOCOL_VERSION + 1)));
  assert.match(result.reason, new RegExp(String(PROTOCOL_VERSION)));
});

test('checkProtocolCompatibility REFUSES an envelope-version mismatch even when the protocol matches', () => {
  const result = checkProtocolCompatibility({
    protocolVersion: PROTOCOL_VERSION,
    envelopeVersion: ENVELOPE_VERSION + 1,
    serviceVersion: '0.2.0',
  });
  assert.equal(result.status, 'incompatible');
});

test('isProtocolHandshake rejects malformed handshake documents', () => {
  assert.equal(isProtocolHandshake({ protocolVersion: 1, envelopeVersion: 1, serviceVersion: '0.1.0' }), true);
  assert.equal(isProtocolHandshake({ protocolVersion: '1', envelopeVersion: 1, serviceVersion: '0.1.0' }), false);
  assert.equal(isProtocolHandshake({ protocolVersion: 1, envelopeVersion: 1 }), false);
  assert.equal(isProtocolHandshake(null), false);
  assert.equal(isProtocolHandshake('not a handshake'), false);
});

test('signupMode is optional, so a service older than the field is still accepted', () => {
  // THE COMPATIBILITY TRAP THIS PINS: making the field required would be an
  // "additive" change that silently refuses every instance deployed before it.
  assert.equal(isProtocolHandshake({ protocolVersion: 1, envelopeVersion: 1, serviceVersion: '0.1.0' }), true);

  for (const signupMode of SIGNUP_MODES) {
    assert.equal(
      isProtocolHandshake({ protocolVersion: 1, envelopeVersion: 1, serviceVersion: '0.1.0', signupMode }),
      true,
      signupMode,
    );
  }

  // A value outside the vocabulary is refused rather than passed through — a
  // client must not act on a mode it does not understand.
  assert.equal(
    isProtocolHandshake({ protocolVersion: 1, envelopeVersion: 1, serviceVersion: '0.1.0', signupMode: 'sometimes' }),
    false,
  );
});

test('isSyncKeyRecordKind accepts exactly the two documented kinds', () => {
  assert.equal(isSyncKeyRecordKind('passphrase'), true);
  assert.equal(isSyncKeyRecordKind('recovery'), true);
  assert.equal(isSyncKeyRecordKind('Passphrase'), false);
  assert.equal(isSyncKeyRecordKind(undefined), false);
});
