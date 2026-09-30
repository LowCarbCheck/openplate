/**
 * The recovery-code AUTH PROOF, derived on the server from an escrowed code.
 *
 * WHY A CLIENT DERIVATION LIVES HERE AT ALL. Everywhere else this service only
 * ever compares a `recoveryAuthHash` a client sent (`lib/verifier.ts`); it
 * never derives one. The one exception is moving accounts between instances
 * (`move-accounts/`): an account that already lives on the target instance
 * keeps its escrowed code, but the instance's `SERVER_SECRET` changes, so its
 * `accounts.recovery_verifier` must be recomputed under the new pepper. The
 * server holds the code (ADR-0005), so it can run the same HKDF branch the
 * client runs and HMAC the result, and nothing else in the service calls this.
 *
 * THIS IS A PORT, AND THE ORIGINAL WINS. The source of truth is the app's
 * `deriveRecoveryAuthHash` (`apps/app/app/lib/sync/engine/client/recovery-kek.ts`)
 * over its `decodeCrockfordBase32` (`engine/crypto/base32.ts`). Both are pinned
 * to ONE known-answer vector, produced by the app's own code: this module's
 * `tests/unit/recovery-auth.test.ts` and the app's `hkdf.test.ts`. A change on
 * either side fails that side's test instead of silently locking every
 * recovered account out.
 *
 * THE BYTES, exactly as PROTOCOL.md §3.1 and the app fix them:
 *   raw   = Crockford base32 decode of the canonical 32-character code (20 bytes)
 *   bits  = HKDF-SHA-256(IKM = raw, salt = empty, info = "openplate-sync:recovery-auth:v1", L = 32)
 *   proof = standard base64 of bits, with padding, and THAT STRING is the HMAC input
 *
 * Pure module, no config, no DB, no clock. The code is never logged, and no
 * error message here quotes it.
 */
import { hkdfSync } from 'node:crypto';
import { RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH } from '../accounts/auth-input.js';
import { computeVerifier } from './verifier.js';

/** The frozen HKDF `info` label of the recovery AUTH branch. Its bytes, not its name, are the contract. */
export const RECOVERY_AUTH_LABEL = 'openplate-sync:recovery-auth:v1';

/** 160 bits, the recovery code's entropy (PROTOCOL.md §3.1). 32 base32 characters decode to exactly this many bytes. */
const RECOVERY_CODE_BYTES = 20;

/** The proof's width, the same 32 bytes the passphrase `authHash` has. */
const RECOVERY_AUTH_BYTES = 32;

const BITS_PER_CHARACTER = 5;
const BITS_PER_BYTE = 8;

/**
 * Decodes the canonical code (32 upper-case Crockford characters, no grouping,
 * exactly what `parseRecoveryCode` seals) into its 20 raw bytes.
 *
 * STRICTER THAN THE APP'S DECODER on purpose: the app accepts grouping and
 * lower case because a person typed it, and this input is our own sealed
 * column. Anything that is not the canonical form is a corrupted escrow, and
 * deriving a proof from it would write a verifier nothing can match.
 */
function decodeCanonicalRecoveryCode(code: string): Buffer {
  if (code.length !== RECOVERY_CODE_LENGTH) {
    throw new Error(`a canonical recovery code has ${RECOVERY_CODE_LENGTH} characters`);
  }
  const bytes: number[] = [];
  let buffered = 0;
  let bufferedBits = 0;
  for (const character of code) {
    const digit = RECOVERY_CODE_ALPHABET.indexOf(character);
    if (digit === -1) throw new Error('a canonical recovery code uses only the Crockford base32 alphabet');
    buffered = ((buffered << BITS_PER_CHARACTER) | digit) & 0xffff;
    bufferedBits += BITS_PER_CHARACTER;
    if (bufferedBits >= BITS_PER_BYTE) {
      bytes.push((buffered >>> (bufferedBits - BITS_PER_BYTE)) & 0xff);
      bufferedBits -= BITS_PER_BYTE;
    }
  }
  if (bytes.length !== RECOVERY_CODE_BYTES) {
    throw new Error(`a canonical recovery code decodes to ${RECOVERY_CODE_BYTES} bytes`);
  }
  return Buffer.from(bytes);
}

/** The base64 recovery proof a client would send for this code, the HMAC input of `accounts.recovery_verifier`. */
export function deriveRecoveryAuthHash(code: string): string {
  const raw = decodeCanonicalRecoveryCode(code);
  const bits = hkdfSync('sha256', raw, Buffer.alloc(0), Buffer.from(RECOVERY_AUTH_LABEL, 'utf8'), RECOVERY_AUTH_BYTES);
  return Buffer.from(bits).toString('base64');
}

/** The value `accounts.recovery_verifier` holds for this code under this pepper, computed by the one `computeVerifier`. */
export function computeRecoveryVerifier(input: { code: string; pepper: string }): string {
  return computeVerifier({ authHash: deriveRecoveryAuthHash(input.code), pepper: input.pepper });
}
