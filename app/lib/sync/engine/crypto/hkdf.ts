/**
 * HKDF-SHA-256 key derivation (design spec D1) — native WebCrypto
 * (`crypto.subtle`), no WASM. Used for two purposes:
 *  1. Deriving the AES-256-GCM subkey from an Argon2id-stretched passphrase
 *     hash (the "purpose-bound subkey" step of D1's chain).
 *  2. Deriving the recovery-code KEK directly from the recovery code's raw
 *     bytes (D5) — no Argon2id stretch, since a ≥128-bit random code needs
 *     no memory-hard step (only low-entropy human passphrases do).
 *
 * Pure with respect to its inputs (no randomness, no I/O) — `globalThis.crypto`
 * is available natively in both browsers and Node 20+, so this is directly
 * unit-testable with zero mocking.
 */

import { toBufferSource } from './buffer-source';

const AES_256_KEY_BITS = 256;

/**
 * Domain-separation labels for HKDF's `info` parameter — one per
 * purpose-bound subkey this module derives.
 *
 * THESE STRINGS ARE FROZEN CRYPTOGRAPHIC CONSTANTS, not references to a repo
 * name. Changing so much as a character derives entirely different keys and
 * makes every existing wrapped DEK permanently unopenable. The `-sync` in
 * them is part of the label, not a pointer to the `openplate-sync` repo —
 * do not "tidy" them when that repo is renamed, split, or retired.
 *
 * Security review finding #7: `PASSPHRASE_KEK` and `RECOVERY_KEK` are
 * DISTINCT labels (previously both derivations shared one `AES_KEY` label —
 * no cryptographic domain separation between the two KEKs). This is a
 * BREAKING change to already-derived keys — acceptable pre-launch (no
 * production data/accounts exist yet on this feature) but any device that
 * derived a KEK under the old shared label would derive a DIFFERENT key
 * after this change and be unable to unwrap an existing wrapped DEK.
 */
export const HKDF_INFO = {
  /** The passphrase-derived KEK (D1: Argon2id -> HKDF -> this subkey). Never reused for the recovery KEK. */
  PASSPHRASE_KEK: new TextEncoder().encode('openplate-sync:passphrase-kek:v1'),
  /** The recovery-code-derived KEK (D5: HKDF-only, no Argon2id). Never reused for the passphrase KEK. */
  RECOVERY_KEK: new TextEncoder().encode('openplate-sync:recovery-kek:v1'),
  /**
   * The AUTHENTICATION branch (`PROTOCOL.md` §3.1) — the value the client
   * actually sends to the service as its password.
   *
   * It is a SIBLING of `PASSPHRASE_KEK`, not a parent and not a child: both
   * are HKDF outputs over the same Argon2id hash under different `info`
   * labels, so holding one gives no information about the other. That is the
   * entire reason a server can authenticate a user whose data it cannot
   * decrypt, and it is why these two labels must never be collapsed,
   * reordered, or "simplified" into one.
   *
   * Deriving the wrong branch fails SILENTLY in the most expensive way: it
   * authenticates fine and produces a key that decrypts nothing.
   */
  AUTH: new TextEncoder().encode('openplate-sync:auth:v1'),
} as const;

/**
 * Derives a 256-bit AES-GCM `CryptoKey` via HKDF-SHA-256 from `inputKeyMaterial`.
 *
 * @param inputKeyMaterial - the Argon2id-stretched passphrase hash, or the raw recovery-code bytes (D5).
 * @param salt - a random salt (the same one stored in the KEK's key record — not secret).
 * @param info - domain-separation label — `HKDF_INFO.PASSPHRASE_KEK` or `HKDF_INFO.RECOVERY_KEK` (never share a label across the two purposes).
 * @returns a non-extractable `CryptoKey` usable directly with `crypto.subtle.encrypt`/`decrypt` under `AES-GCM`.
 */
export async function deriveAesKeyViaHkdf({
  inputKeyMaterial,
  salt,
  info,
}: {
  inputKeyMaterial: Uint8Array;
  salt: Uint8Array;
  info: Uint8Array;
}): Promise<CryptoKey> {
  // `inputKeyMaterial` is hash-wasm's Argon2id output on every production
  // path. At the pinned version that is a clean standalone array, but the
  // shape of a WASM library's return value is not ours to guarantee across a
  // bump — `toBufferSource` makes it safe either way; see its header.
  const baseKey = await crypto.subtle.importKey('raw', toBufferSource(inputKeyMaterial), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: toBufferSource(salt), info: toBufferSource(info) },
    baseKey,
    { name: 'AES-GCM', length: AES_256_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derives RAW BYTES via HKDF-SHA-256, rather than a `CryptoKey`.
 *
 * Used for exactly one thing: the `AUTH` branch, whose output is not a key
 * this client uses locally but a 32-byte value it base64-encodes and SENDS
 * (`PROTOCOL.md` §3.1). `deriveAesKeyViaHkdf` above deliberately produces
 * non-extractable keys — the right default for anything that stays here — so
 * the one value that must leave gets its own explicitly-named function
 * instead of a flag that would make every KEK extractable too.
 */
export async function deriveHkdfBits({
  inputKeyMaterial,
  salt,
  info,
  lengthBytes,
}: {
  inputKeyMaterial: Uint8Array;
  salt: Uint8Array;
  info: Uint8Array;
  lengthBytes: number;
}): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', toBufferSource(inputKeyMaterial), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toBufferSource(salt), info: toBufferSource(info) },
    baseKey,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}
