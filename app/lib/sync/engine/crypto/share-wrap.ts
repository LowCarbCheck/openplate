/**
 * The share wrap (`PROTOCOL.md` §3.4, `openplate-sync` ADR-0002) — the one
 * asymmetric primitive in this product, and the whole of it.
 *
 * A patient's DEK is already wrapped twice, under two KEKs the owner alone can
 * derive. A SHARE is a third wrapping of that same DEK, addressed to a
 * clinician's PUBLIC key. The server stores one more blob it has no key for;
 * §9.1's "decryption is not withheld by policy, it is unavailable" survives the
 * feature intact, which is the test the design had to pass.
 *
 * ── Why asymmetric, when everything else here is symmetric ────────────────
 *
 * The cheap version — a share code, HKDF, a KEK, mirroring the recovery path —
 * introduces no new primitive and is rejected. It puts a DECRYPTION SECRET IN
 * AN EMAIL. An asymmetric wrap puts only a public key in the mail, which
 * downgrades the strongest mail-channel attack from silent, retroactive
 * compromise to active substitution — detectable by the typed fingerprint
 * ceremony, and never retroactive. ADR-0002 turns on that one paragraph.
 *
 * ── Why P-256, and no negotiation ────────────────────────────────────────
 *
 * P-256 has been in every WebCrypto implementation for a decade, including the
 * older mobile WebViews that are exactly this product's tail; X25519 only went
 * default-on in evergreen browsers during 2025. WebCrypto performs point
 * validation internally, which removes the invalid-curve footgun. And the
 * philosophy here is fail-closed, not feature-detect-and-degrade: a curve
 * negotiation for one wrap format is complexity with no customer. The curve is
 * named in the HKDF label, so a future X25519 construction is a NEW label
 * rather than an ambiguity about what `:v1` once meant.
 *
 * ── The construction, frozen ─────────────────────────────────────────────
 *
 *   (ephPriv, ephPub) <- ECDH P-256, fresh per wrap, discarded after
 *   Z         <- ECDH(ephPriv, recipientPub)
 *   KEK_share <- HKDF-SHA-256(salt = empty, IKM = Z, info = SHARE_KEK)
 *   AAD       <- {"grantorAccountId":<int>,"recipientKeyFingerprint":"<base64>"}
 *   wrap      <- ephPub(65) || iv(12) || AES-256-GCM(KEK_share, DEK, aad=AAD)
 *
 * Pure with respect to its inputs apart from the two documented randomness
 * sources (the ephemeral key pair and the GCM IV), and it touches no store, no
 * network and no clock. The ephemeral private key exists only inside
 * {@link wrapDekForRecipient}'s call frame and is never returned, logged or
 * persisted — that is what makes a wrap unopenable by its own author.
 */
import { bytesToBase64 } from './base64';
import { encodeCrockfordBase32, groupCharacters } from './base32';
import { deriveAesKeyViaHkdf, HKDF_INFO } from './hkdf';
import { unwrapDek, wrapDek } from './dek-wrap';
import { toBufferSource } from './buffer-source';

/** The only curve. Not negotiable, not detected, not degraded — see this module's header. */
const SHARE_CURVE = 'P-256';

/** ECDH parameters for both key generation and key import. `P-256` appears once, here. */
const SHARE_KEY_ALGORITHM: EcKeyGenParams & EcKeyImportParams = { name: 'ECDH', namedCurve: SHARE_CURVE };

/** An uncompressed SEC1 P-256 public key: `0x04 || X(32) || Y(32)`. */
export const SHARE_PUBLIC_KEY_BYTES = 65;

/** The ECDH shared secret's length — P-256's field size, and exactly the HKDF input the construction specifies. */
const SHARED_SECRET_BITS = 256;

/**
 * The share wrap's total length: `ephPub(65) || iv(12) || ciphertext+tag(48)`.
 *
 * A DIFFERENT invariant from the 60-byte key-record wrap (`dek-wrap.ts`): 60
 * for a key record, 125 for a share. They live in different tables and no
 * shared validation path may branch on length to tell them apart.
 */
export const SHARE_WRAP_BYTES = 125;

/** The fingerprint prefix the typed ceremony uses: 12 Crockford base32 characters = 60 bits. */
const FINGERPRINT_DISPLAY_CHARACTERS = 12;

/** Fingerprints are read aloud and typed in groups of four. */
const FINGERPRINT_GROUP_SIZE = 4;

/** A freshly generated share key pair, in the two serialized forms the snapshot stores. */
export interface ShareKeyPair {
  /** Uncompressed SEC1 raw public key (65 bytes) — the value that travels in an invite and is pinned by peers. */
  publicKeyRaw: Uint8Array;
  /** PKCS#8 private key — stored ONLY inside the owner's own DEK-encrypted snapshot, never sent anywhere. */
  privateKeyPkcs8: Uint8Array;
}

/**
 * Generates a fresh share key pair on this device.
 *
 * The key is generated EXTRACTABLE, unlike every other key in this engine.
 * That is deliberate and it is the cost of ADR-0002's custody decision: the
 * private key has to be serialized into the owner's encrypted snapshot so it
 * inherits multi-device sync and recovery-code recovery from machinery that
 * already exists. A non-extractable, per-device, hardware-backed key with
 * per-device wraps is the recorded future hardening — deferred, not built.
 */
export async function generateShareKeyPair(): Promise<ShareKeyPair> {
  const pair = await crypto.subtle.generateKey(SHARE_KEY_ALGORITHM, true, ['deriveBits']);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKeyRaw, privateKeyPkcs8 };
}

/**
 * The fingerprint of a share public key: `SHA-256(publicKeyRaw)` rendered in
 * the same Crockford base32 alphabet the recovery code uses, grouped in fours.
 *
 * This is the value the trust ceremony turns on. The clinician's app computes
 * it LOCALLY from her own key and she reads it aloud; the patient TYPES it,
 * and the client refuses the grant unless it matches the fingerprint of the
 * key it actually received. Never render one from server-supplied content — a
 * server-rendered fingerprint is the attacker reading you its own key.
 */
export async function shareKeyFingerprint(publicKeyRaw: Uint8Array): Promise<string> {
  return groupCharacters(encodeCrockfordBase32(await sha256(publicKeyRaw)), FINGERPRINT_GROUP_SIZE);
}

/**
 * The 60-bit prefix a human actually reads and types: the first 12 characters
 * of {@link shareKeyFingerprint}, in three groups of four.
 *
 * 60 bits puts a targeted collision — a server grinding key pairs until the
 * VISIBLE prefix matches the real clinician's — at about 2^60 hashes. Out of
 * reach for this attacker. Forty bits would not be, so this length is a
 * security parameter, not a layout choice.
 */
export function shareFingerprintDisplay(fingerprint: string): string {
  return groupCharacters(stripSeparators(fingerprint).slice(0, FINGERPRINT_DISPLAY_CHARACTERS), FINGERPRINT_GROUP_SIZE);
}

/**
 * Whether what a person TYPED matches a fingerprint computed locally.
 *
 * Grouping, case and separators are ignored, because a person re-typing a
 * string they heard aloud groups it however they like — none of that carries
 * information. What is NOT ignored is the value: a mismatch has no
 * confirm-anyway path anywhere above this function. ADR-0002 prohibition 6:
 * replacing typing with tapping is a security regression, not a
 * simplification, and must be reviewed as one.
 */
export function shareFingerprintMatchesTyped({ typed, fingerprint }: { typed: string; fingerprint: string }): boolean {
  const expected = stripSeparators(fingerprint).slice(0, FINGERPRINT_DISPLAY_CHARACTERS);
  const actual = stripSeparators(typed).slice(0, FINGERPRINT_DISPLAY_CHARACTERS);
  return actual.length === FINGERPRINT_DISPLAY_CHARACTERS && actual === expected;
}

/**
 * Wraps `dek` so that — and only that — the holder of the private key matching
 * `recipientPublicKeyRaw` can unwrap it.
 *
 * @returns exactly {@link SHARE_WRAP_BYTES} bytes.
 * @throws when the recipient key is not a well-formed uncompressed P-256 point
 * (WebCrypto validates it on import), or `grantorAccountId` is not a safe
 * integer.
 */
export async function wrapDekForRecipient({
  dek,
  recipientPublicKeyRaw,
  grantorAccountId,
}: {
  dek: Uint8Array;
  recipientPublicKeyRaw: Uint8Array;
  grantorAccountId: number;
}): Promise<Uint8Array> {
  const ephemeral = await crypto.subtle.generateKey(SHARE_KEY_ALGORITHM, true, ['deriveBits']);
  const kek = await deriveShareKek({ privateKey: ephemeral.privateKey, peerPublicKeyRaw: recipientPublicKeyRaw });
  const additionalData = await buildShareAad({ grantorAccountId, recipientPublicKeyRaw });

  const packed = await wrapDek({ dek, kek, additionalData });
  const ephemeralPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  // `ephemeral.privateKey` goes out of scope here and is never returned,
  // stored or logged. Its whole lifetime is this function.
  return packShareWrap({ ephemeralPublicKeyRaw, packedDek: packed });
}

/**
 * Unwraps a share addressed to this device's own key.
 *
 * `ownPublicKeyRaw` is required rather than derived from the private key
 * because the AAD binds the recipient's FINGERPRINT: the grantee rebuilds it
 * from a key she holds, so no server-supplied value ever enters the trust
 * path. Passing a key the wrap was not addressed to produces a tag failure,
 * which is the intended outcome.
 *
 * @throws when the wrap is the wrong length, when the private key does not
 * match, or when the AAD does not rebuild identically (a spliced row).
 */
export async function unwrapDekAsRecipient({
  wrap,
  privateKeyPkcs8,
  grantorAccountId,
  ownPublicKeyRaw,
}: {
  wrap: Uint8Array;
  privateKeyPkcs8: Uint8Array;
  grantorAccountId: number;
  ownPublicKeyRaw: Uint8Array;
}): Promise<Uint8Array> {
  const { ephemeralPublicKeyRaw, packedDek } = splitShareWrap(wrap);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    toBufferSource(privateKeyPkcs8),
    SHARE_KEY_ALGORITHM,
    false,
    ['deriveBits'],
  );
  const kek = await deriveShareKek({ privateKey, peerPublicKeyRaw: ephemeralPublicKeyRaw });
  const additionalData = await buildShareAad({ grantorAccountId, recipientPublicKeyRaw: ownPublicKeyRaw });
  return unwrapDek({ wrappedDek: packedDek, kek, additionalData });
}

/**
 * The share wrap's OWN packing.
 *
 * Deliberately not `packIvAndCiphertext`: that pair is the canonical
 * `iv || ciphertext` site and every reader of a 60-byte key-record wrap
 * depends on it meaning exactly that. A share puts a 65-byte ephemeral public
 * key AHEAD of the same pair, so it peels its own prefix and hands the rest
 * to the canonical split, rather than bending the canonical split to know
 * about a second format.
 */
function packShareWrap({
  ephemeralPublicKeyRaw,
  packedDek,
}: {
  ephemeralPublicKeyRaw: Uint8Array;
  packedDek: Uint8Array;
}): Uint8Array {
  const wrap = new Uint8Array(ephemeralPublicKeyRaw.byteLength + packedDek.byteLength);
  wrap.set(ephemeralPublicKeyRaw, 0);
  wrap.set(packedDek, ephemeralPublicKeyRaw.byteLength);
  return wrap;
}

/** The two parts a share wrap splits into: the ephemeral public key, and the packed `iv || ciphertext` {@link unwrapDek} understands. */
interface ShareWrapParts {
  ephemeralPublicKeyRaw: Uint8Array;
  packedDek: Uint8Array;
}

function splitShareWrap(wrap: Uint8Array): ShareWrapParts {
  if (wrap.byteLength !== SHARE_WRAP_BYTES) {
    throw new Error(`share wrap must be exactly ${SHARE_WRAP_BYTES} bytes, got ${wrap.byteLength}`);
  }
  return {
    ephemeralPublicKeyRaw: wrap.slice(0, SHARE_PUBLIC_KEY_BYTES),
    packedDek: wrap.slice(SHARE_PUBLIC_KEY_BYTES),
  };
}

/**
 * ECDH -> HKDF -> the AES-256-GCM share KEK. Both directions of the wrap run
 * through this one function, which is why sender and recipient cannot derive
 * different keys from the same pair of points.
 *
 * The EMPTY HKDF SALT is correct here, on the same RFC 5869 §3.1 grounds
 * `PROTOCOL.md` already argues for the recovery code: the input key material
 * is a fresh, high-entropy ECDH output, not a human secret needing a
 * memory-hard stretch or a randomiser. Do not "fix" it by inventing a salt —
 * a salt would have to travel with the wrap and would change its length.
 */
async function deriveShareKek({
  privateKey,
  peerPublicKeyRaw,
}: {
  privateKey: CryptoKey;
  peerPublicKeyRaw: Uint8Array;
}): Promise<CryptoKey> {
  const peerPublicKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(peerPublicKeyRaw),
    SHARE_KEY_ALGORITHM,
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
    info: HKDF_INFO.SHARE_KEK,
  });
}

/**
 * The wrap's additional authenticated data, as canonical fixed-key-order JSON.
 *
 * Built by string concatenation rather than `JSON.stringify` on an object:
 * the byte sequence IS the contract, and it must not depend on a property
 * order the language merely happens to preserve today. Both ends build it
 * here, so a byte of drift fails a tag check on the very first round-trip
 * rather than in production.
 *
 * It binds the recipient's KEY FINGERPRINT, not the grantee's account id,
 * because substitution attacks the key — so the key is what the binding names.
 * It also lets the clinician rebuild this string from a fingerprint she
 * computed locally instead of one the server handed her.
 */
async function buildShareAad({
  grantorAccountId,
  recipientPublicKeyRaw,
}: {
  grantorAccountId: number;
  recipientPublicKeyRaw: Uint8Array;
}): Promise<Uint8Array> {
  if (!Number.isSafeInteger(grantorAccountId)) {
    // Interpolated raw into the JSON below, so a non-integer would produce a
    // string neither end could reproduce — fail here, loudly, instead.
    throw new Error(`grantorAccountId must be a safe integer, got ${grantorAccountId}`);
  }
  const fingerprintBase64 = bytesToBase64(await sha256(recipientPublicKeyRaw));
  const json = `{"grantorAccountId":${grantorAccountId},"recipientKeyFingerprint":${JSON.stringify(fingerprintBase64)}}`;
  return new TextEncoder().encode(json);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toBufferSource(bytes)));
}

function stripSeparators(fingerprint: string): string {
  return fingerprint.toUpperCase().replace(/[^0-9A-Z]/g, '');
}
