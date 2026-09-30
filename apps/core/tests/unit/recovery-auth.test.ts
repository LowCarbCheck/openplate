/**
 * The server-side port of the app's recovery AUTH derivation
 * (`src/lib/recovery-auth.ts`), pinned to the app.
 *
 * THE VECTORS BELOW WERE PRODUCED BY THE APP'S OWN CODE, not by this port:
 * `encodeCrockfordBase32` and `deriveRecoveryAuthHash` from
 * `apps/app/app/lib/sync/engine/`, run over the two raw codes named in each
 * case (2026-09-30). The app's `tests/unit/sync-engine/hkdf.test.ts` pins the
 * SAME pairs against its own derivation, so a change on either side fails a
 * test on that side. Regenerate them only by running the app's functions,
 * never by running this port, or the pin proves nothing.
 *
 * Each case has a control that must fail: a code one character away, and a
 * derivation under a sibling label, both produce a different proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, hkdfSync } from 'node:crypto';
import { computeRecoveryVerifier, deriveRecoveryAuthHash, RECOVERY_AUTH_LABEL } from '../../src/lib/recovery-auth.js';
import { computeVerifier } from '../../src/lib/verifier.js';

/** Raw bytes 0x00..0x13, as the app encodes and derives them. */
const COUNTING = { code: '000G40R40M30E209185GR38E1W8124GK', proof: 'Do7W9Mtj++2ihJA+cKjKESkFM5G9/Zs1Pw8t5r2KPJ8=' };
/** The first 20 bytes of SHA-256("openplate-core move-accounts vector"). */
const HASHED = { code: 'MAB0KYA3C9HWD50P5BBG3V6R0QZY3MR5', proof: 'nAu9m+qZmljLzDZ8tH2TqbJ3fMZ1didoXzwxu2+gfu8=' };

test('the port derives the proof the app derives, for both app-produced vectors', () => {
  assert.equal(deriveRecoveryAuthHash(COUNTING.code), COUNTING.proof);
  assert.equal(deriveRecoveryAuthHash(HASHED.code), HASHED.proof);
});

test('control: a code one character away derives a different proof', () => {
  const nearby = `${COUNTING.code.slice(0, -1)}M`;
  assert.notEqual(nearby, COUNTING.code);
  assert.notEqual(deriveRecoveryAuthHash(nearby), COUNTING.proof);
});

test('control: the sibling recovery-KEK label derives a different value from the same code', () => {
  // The label is the whole separation between the value that leaves a device
  // and the key that unwraps the DEK. A port that used the wrong one would pass
  // a round-trip test and fail every real recovery.
  const raw = Buffer.from(Array.from({ length: 20 }, (_unused, index) => index));
  const kekBits = Buffer.from(hkdfSync('sha256', raw, Buffer.alloc(0), 'openplate-sync:recovery-kek:v1', 32));
  assert.notEqual(kekBits.toString('base64'), COUNTING.proof);
  assert.equal(RECOVERY_AUTH_LABEL, 'openplate-sync:recovery-auth:v1');
});

test('the recovery verifier is computeVerifier over the proof STRING, under the given pepper', () => {
  const pepper = 'a'.repeat(64);
  const expected = createHmac('sha256', pepper).update(COUNTING.proof).digest('hex');
  assert.equal(computeRecoveryVerifier({ code: COUNTING.code, pepper }), expected);
  assert.equal(
    computeRecoveryVerifier({ code: COUNTING.code, pepper }),
    computeVerifier({ authHash: COUNTING.proof, pepper }),
  );
  // Control: another pepper, another verifier. This is the whole reason the
  // move recomputes it when an instance's SERVER_SECRET changes.
  assert.notEqual(computeRecoveryVerifier({ code: COUNTING.code, pepper: 'b'.repeat(64) }), expected);
});

test('anything but the canonical 32-character form is refused, and the refusal quotes no code', () => {
  const refusals = [
    COUNTING.code.toLowerCase(),
    `${COUNTING.code.slice(0, 5)}-${COUNTING.code.slice(5)}`,
    COUNTING.code.slice(1),
    `${COUNTING.code.slice(0, -1)}O`,
  ];
  for (const candidate of refusals) {
    assert.throws(
      () => deriveRecoveryAuthHash(candidate),
      (error: Error) => !error.message.includes(candidate) && !error.message.includes(COUNTING.code),
    );
  }
});
