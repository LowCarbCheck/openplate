/**
 * THE ECDH → HKDF → KEK STEP, once (`PROTOCOL.md` §3.4 and §3.5).
 *
 * Two features in this product seal something to a key a SECOND PERSON holds:
 * a clinician share (`share-wrap.ts`, ADR-0002) and a research contribution
 * (`../../research/contribution-wrap.ts`, ADR-0003). They wrap different
 * plaintexts under different labels for different principals — but the step
 * that turns a public key into an AES-256-GCM key is byte-for-byte the same,
 * and this module is the only place it exists.
 *
 * Extracted rather than copied for the reason `dek-wrap.ts` takes an optional
 * `additionalData` rather than growing a second wrap implementation: a second
 * copy of a crypto construction does not stay a copy. It drifts by one
 * argument, in one direction, on one path, and a wrong derivation does not
 * throw — it produces a key that decrypts nothing, somewhere else, later.
 *
 * ── What is parameterised, and what is not ───────────────────────────────
 *
 * ONLY the HKDF `info` label. The curve, the shared-secret length, the empty
 * salt and the fresh-ephemeral-per-seal rule are frozen here for every caller,
 * because they are not a caller's decision to make. See `share-wrap.ts`'s
 * header for why P-256 and no negotiation, and `hkdf.ts` for why each label is
 * a separate branch.
 *
 * The EMPTY HKDF SALT is correct on RFC 5869 §3.1 grounds: the input key
 * material is a fresh, high-entropy ECDH output, not a human secret needing a
 * memory-hard stretch or a randomiser. A salt would have to travel with the
 * ciphertext and would change its length.
 *
 * ── The ephemeral private key never leaves this file ─────────────────────
 *
 * {@link deriveEciesSenderKek} generates the ephemeral pair, derives from it,
 * and returns only the KEK and the ephemeral PUBLIC key. The private half's
 * whole lifetime is that call frame — which is what makes a sealed body
 * unopenable by its own author.
 */
import { deriveAesKeyViaHkdf } from './hkdf';
import { toBufferSource } from './buffer-source';

/** The only curve. Not negotiable, not detected, not degraded — see `share-wrap.ts`'s header. */
const ECIES_CURVE = 'P-256';

/** ECDH parameters for key generation and both key imports. `P-256` appears once, here. */
const ECIES_KEY_ALGORITHM: EcKeyGenParams & EcKeyImportParams = { name: 'ECDH', namedCurve: ECIES_CURVE };

/** An uncompressed SEC1 P-256 public key: `0x04 || X(32) || Y(32)`. */
export const ECIES_PUBLIC_KEY_BYTES = 65;

/** The ECDH shared secret's length — P-256's field size, and exactly the HKDF input both constructions specify. */
const SHARED_SECRET_BITS = 256;

/** A key pair in the two serialized forms a snapshot stores. */
export interface EciesKeyPair {
  /** Uncompressed SEC1 raw public key (65 bytes) — the half that travels, and the half a fingerprint is taken of. */
  publicKeyRaw: Uint8Array;
  /** PKCS#8 private key — stored ONLY inside its owner's own encrypted snapshot, never sent anywhere. */
  privateKeyPkcs8: Uint8Array;
}

/**
 * Generates a fresh P-256 key pair for either construction.
 *
 * EXTRACTABLE, unlike every other key in this engine, and that is the cost of
 * ADR-0002's custody decision: the private key has to be serialized into its
 * owner's encrypted snapshot so it inherits multi-device sync and
 * recovery-code recovery from machinery that already exists.
 */
export async function generateEciesKeyPair(): Promise<EciesKeyPair> {
  const pair = await crypto.subtle.generateKey(ECIES_KEY_ALGORITHM, true, ['deriveBits']);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKeyRaw, privateKeyPkcs8 };
}

/** Imports a stored PKCS#8 private key for use in a derivation. Non-extractable: it goes in, it does not come back out. */
export async function importEciesPrivateKey(privateKeyPkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', toBufferSource(privateKeyPkcs8), ECIES_KEY_ALGORITHM, false, ['deriveBits']);
}

/** The sender's half of a derivation: the KEK, and the ephemeral public key the recipient needs to reproduce it. */
export interface EciesSenderKek {
  kek: CryptoKey;
  /** Uncompressed SEC1 (65 bytes). Packed AHEAD of the ciphertext by every caller — it is not a secret. */
  ephemeralPublicKeyRaw: Uint8Array;
}

/**
 * Derives a KEK addressed to `recipientPublicKeyRaw`, under `info`.
 *
 * @param info - the frozen HKDF label for THIS construction (`HKDF_INFO.SHARE_KEK` or `HKDF_INFO.RESEARCH_KEK`). It is the only thing that differs between the two callers, and passing the wrong one produces a key that fails a tag check somewhere else rather than an error here.
 * @throws when the recipient key is not a well-formed uncompressed P-256 point — WebCrypto validates it on import, which is what removes the invalid-curve footgun.
 */
export async function deriveEciesSenderKek({
  recipientPublicKeyRaw,
  info,
}: {
  recipientPublicKeyRaw: Uint8Array;
  info: Uint8Array;
}): Promise<EciesSenderKek> {
  const ephemeral = await crypto.subtle.generateKey(ECIES_KEY_ALGORITHM, true, ['deriveBits']);
  const kek = await deriveKek({ privateKey: ephemeral.privateKey, peerPublicKeyRaw: recipientPublicKeyRaw, info });
  const ephemeralPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  // `ephemeral.privateKey` goes out of scope here and is never returned,
  // stored or logged. Its whole lifetime is this function.
  return { kek, ephemeralPublicKeyRaw };
}

/**
 * Derives the SAME KEK from the recipient's side, given the ephemeral public
 * key that travelled with the ciphertext.
 *
 * Both directions run through {@link deriveKek}, which is why a sender and a
 * recipient cannot derive different keys from the same pair of points.
 */
export async function deriveEciesRecipientKek({
  ephemeralPublicKeyRaw,
  privateKey,
  info,
}: {
  ephemeralPublicKeyRaw: Uint8Array;
  privateKey: CryptoKey;
  info: Uint8Array;
}): Promise<CryptoKey> {
  return deriveKek({ privateKey, peerPublicKeyRaw: ephemeralPublicKeyRaw, info });
}

/** ECDH against `peerPublicKeyRaw`, then HKDF under `info`. The one derivation both constructions and both directions share. */
async function deriveKek({
  privateKey,
  peerPublicKeyRaw,
  info,
}: {
  privateKey: CryptoKey;
  peerPublicKeyRaw: Uint8Array;
  info: Uint8Array;
}): Promise<CryptoKey> {
  const peerPublicKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(peerPublicKeyRaw),
    ECIES_KEY_ALGORITHM,
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    SHARED_SECRET_BITS,
  );
  return deriveAesKeyViaHkdf({
    inputKeyMaterial: new Uint8Array(sharedSecret),
    salt: new Uint8Array(0),
    info,
  });
}
