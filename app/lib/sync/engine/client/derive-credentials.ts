/**
 * The one place a master passphrase is turned into the two values a session
 * needs — and the one place where getting the branches wrong would be silent.
 *
 * ```
 *                                  ┌─HKDF(info=PASSPHRASE_KEK)─► KEK_p  (stays here, unwraps the DEK)
 * passphrase ─Argon2id(salt, m,t,p)┤
 *                                  └─HKDF(info=AUTH)──────────► authHash (sent to the service)
 * ```
 *
 * Both branches hang off ONE Argon2id run (`PROTOCOL.md` §3.1). That matters
 * for more than tidiness: Argon2id at 64 MiB is the expensive step, and
 * deriving the branches separately would double a cost the user feels as a
 * frozen screen on a cheap phone.
 *
 * WHAT THIS MODULE DOES NOT DO, deliberately:
 *  - it never stores the passphrase, and never returns it;
 *  - it never returns the Argon2id hash, only the two purpose-bound children,
 *    so no caller can accidentally send the parent (which would hand the
 *    server the material for KEK_p);
 *  - it does not decide where Argon2id runs. `deriveHash` is injected — the
 *    Worker in the browser (`argon2-worker.ts`), tiny in-process parameters in
 *    tests.
 */
import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import { deriveAesKeyViaHkdf, deriveHkdfBits, HKDF_INFO } from '../crypto/hkdf';
import type { Argon2idDeriver } from './setup-keys';
import type { PassphraseKdfDescriptor } from './passphrase-kek';

/** `authHash` length in bytes (`PROTOCOL.md` §3.1 — 32 bytes, base64 on the wire). */
export const AUTH_HASH_BYTES = 32;

/** What a passphrase resolves to: one value to send, one key to keep. */
export interface DerivedCredentials {
  /** Base64 of the `AUTH` HKDF branch — the ONLY passphrase-derived value that ever leaves this device. */
  authHash: string;
  /** The passphrase KEK, non-extractable. Unwraps the account's DEK; never transmitted, never persisted. */
  passphraseKek: CryptoKey;
}

/**
 * Runs Argon2id once and splits the result into the auth branch and the KEK
 * branch.
 *
 * @param passphrase - the master passphrase. Held only for the duration of this call.
 * @param descriptor - the account's KDF descriptor, fetched from `POST /v1/auth/kdf` before login (never assumed).
 * @param deriveHash - where Argon2id runs (see this module's header).
 */
export async function deriveCredentialsFromPassphrase({
  passphrase,
  descriptor,
  deriveHash,
}: {
  passphrase: string;
  descriptor: PassphraseKdfDescriptor;
  deriveHash: Argon2idDeriver;
}): Promise<DerivedCredentials> {
  // The descriptor's OWN parameters, never this build's defaults: an account
  // created under raised costs must still derive correctly on a device whose
  // defaults have since moved (`PROTOCOL.md` §11).
  const salt = base64ToBytes(descriptor.salt);
  const argon2idHash = await deriveHash({ passphrase, salt, params: descriptor.params });

  const [authBits, passphraseKek] = await Promise.all([
    deriveHkdfBits({
      inputKeyMaterial: argon2idHash,
      salt,
      info: HKDF_INFO.AUTH,
      lengthBytes: AUTH_HASH_BYTES,
    }),
    deriveAesKeyViaHkdf({ inputKeyMaterial: argon2idHash, salt, info: HKDF_INFO.PASSPHRASE_KEK }),
  ]);

  return { authHash: bytesToBase64(authBits), passphraseKek };
}
