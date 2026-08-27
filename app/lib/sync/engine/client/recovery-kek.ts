/**
 * The recovery-code KEK derivation (design spec D5): `recovery code -> HKDF
 * -> AES-256-GCM KEK`. Deliberately skips Argon2id — a ≥128-bit random code
 * needs no memory-hard stretch (only low-entropy human passphrases do), so
 * its key record's KDF descriptor carries no params at all (D2).
 */
import { decodeCrockfordBase32, encodeCrockfordBase32, groupCharacters } from '../crypto/base32';
import { deriveAesKeyViaHkdf, HKDF_INFO } from '../crypto/hkdf';

/** Recovery-code entropy (D5: "≥128-bit entropy, grouped base32"). 20 bytes = 160 bits, comfortably over the floor. */
export const RECOVERY_CODE_BYTES = 20;

/**
 * Recovery codes are shown in groups of 5. The alphabet itself moved to
 * `crypto/base32.ts` when the share-key fingerprint (ADR-0002) became a second
 * consumer of it — same table, different grouping. Two copies of that table
 * would be a silent way for two different keys to render the same string.
 */
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
  return groupCharacters(encodeCrockfordBase32(raw), GROUP_SIZE);
}

/** Parses a user-entered (possibly re-typed, re-grouped) recovery code back into raw bytes. Returns `null` for an invalid/malformed code. */
export function parseRecoveryCode(formatted: string): Uint8Array | null {
  return decodeCrockfordBase32(formatted);
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
