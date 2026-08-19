/**
 * The recovery-code KEK derivation (design spec D5): `recovery code -> HKDF
 * -> AES-256-GCM KEK`. Deliberately skips Argon2id — a ≥128-bit random code
 * needs no memory-hard stretch (only low-entropy human passphrases do), so
 * its key record's KDF descriptor carries no params at all (D2).
 */
import { deriveAesKeyViaHkdf, HKDF_INFO } from '../crypto/hkdf';

/** Recovery-code entropy (D5: "≥128-bit entropy, grouped base32"). 20 bytes = 160 bits, comfortably over the floor. */
export const RECOVERY_CODE_BYTES = 20;

/** A base32 alphabet with no padding, Crockford-style (excludes easily-confused chars: 0/O, 1/I/L). */
const BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP_SIZE = 5;

/** A freshly generated recovery code: the raw entropy the KEK is derived from, plus the grouped form shown to the user. */
export interface RecoveryCode {
  raw: Uint8Array;
  formatted: string;
}

/** Generates a fresh random recovery code, formatted as groups of 5 for readability (D5: "shown once at sync setup"). */
export function generateRecoveryCode(): RecoveryCode {
  const raw = crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES));
  return { raw, formatted: formatRecoveryCode(raw) };
}

/** Encodes raw bytes as a grouped base32 string (`XXXXX-XXXXX-...`) for display/entry. Pure — used by both generation and re-entry validation. */
export function formatRecoveryCode(raw: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return (output.match(new RegExp(`.{1,${GROUP_SIZE}}`, 'g')) ?? [output]).join('-');
}

/** Parses a user-entered (possibly re-typed, re-grouped) recovery code back into raw bytes. Returns `null` for an invalid/malformed code. */
export function parseRecoveryCode(formatted: string): Uint8Array | null {
  const cleaned = formatted.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (cleaned.length === 0) return null;

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const charValue = BASE32_ALPHABET.indexOf(char);
    if (charValue === -1) return null;
    value = (value << 5) | charValue;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** Derives the recovery KEK directly from the raw recovery-code bytes — no Argon2id, no salt (D5). */
export async function deriveRecoveryKek(rawRecoveryCode: Uint8Array): Promise<CryptoKey> {
  // HKDF requires a salt argument; an empty salt is the documented,
  // acceptable choice for HKDF when the input key material is already
  // high-entropy (RFC 5869 §3.1) — true here by construction (a ≥128-bit
  // random code), unlike a human passphrase which always needs a real salt.
  return deriveAesKeyViaHkdf({
    inputKeyMaterial: rawRecoveryCode,
    salt: new Uint8Array(0),
    info: HKDF_INFO.RECOVERY_KEK,
  });
}
