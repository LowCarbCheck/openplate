/**
 * Wraps/unwraps the account's data-encryption-key (DEK) with a
 * key-encryption-key (KEK) — the indirection D1 requires so a passphrase
 * change (or adding the recovery path) re-wraps this small value only, never
 * re-encrypting the data blob.
 *
 * Security review finding #1: a wrapped DEK is a SINGLE opaque blob — the
 * 12-byte AES-GCM IV PACKED as its first bytes, then the ciphertext+tag
 * (`packIvAndCiphertext`/`splitIvAndCiphertext`, `crypto/aes-gcm.ts` — this
 * is the other of the two canonical packing sites, alongside
 * `envelope/build-envelope.ts`). This is exactly the shape
 * the sync service's `sync_key_records.wrapped_dek` bytea column
 * stores — there is no separate `iv` field anywhere downstream of `wrapDek`.
 */
import { aesGcmDecrypt, aesGcmEncrypt, packIvAndCiphertext, splitIvAndCiphertext } from './aes-gcm';

/** DEK length in bytes — AES-256. */
export const DEK_BYTES = 32;

export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_BYTES));
}

/** Wraps `dek` with `kek`, returning the packed `iv || ciphertext` blob. No AAD — a wrapped DEK isn't bound to a specific blob version (D2: only the data envelope's ciphertext is). */
export async function wrapDek({ dek, kek }: { dek: Uint8Array; kek: CryptoKey }): Promise<Uint8Array> {
  const { iv, ciphertext } = await aesGcmEncrypt({ key: kek, plaintext: dek });
  return packIvAndCiphertext(iv, ciphertext);
}

/** Unwraps a DEK previously wrapped by {@link wrapDek}. Throws if `kek` doesn't match (wrong passphrase/recovery code) or `wrappedDek` is malformed. */
export async function unwrapDek({ wrappedDek, kek }: { wrappedDek: Uint8Array; kek: CryptoKey }): Promise<Uint8Array> {
  const { iv, ciphertext } = splitIvAndCiphertext(wrappedDek);
  return aesGcmDecrypt({ key: kek, iv, ciphertext });
}
