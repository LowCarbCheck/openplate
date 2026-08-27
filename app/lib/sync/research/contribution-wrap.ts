/**
 * THE RESEARCH CONTRIBUTION ENVELOPE (`PROTOCOL.md` §3.5, `openplate-sync`
 * ADR-0003).
 *
 * A contribution is sealed to a STUDY's public key. It is a different artifact
 * from a clinician share, not a narrower one: different payload, different
 * key, different lifecycle, and **no DEK is involved** — the wrap is over the
 * payload directly.
 *
 * ── The construction, frozen ─────────────────────────────────────────────
 *
 * ```
 *   (ephPriv, ephPub) <- ECDH P-256, fresh per contribution
 *   Z    <- ECDH(ephPriv, studyPub)
 *   KEK  <- HKDF-SHA-256(salt = empty, IKM = Z,
 *                        info = "openplate-sync:research-kek:p256:v1")
 *   AAD  <- UTF-8 of canonical fixed-key-order JSON:
 *           {"studyAccountId":<int>,"pseudonym":"<string>",
 *            "contributionVersion":<int>,"schemaTier":"<string>",
 *            "studyKeyFingerprint":"<base64>"}
 *   body <- ephPub(65) || iv(12) || AES-256-GCM(KEK, payload, aad = AAD)
 * ```
 *
 * The label is a NEW frozen one rather than a version of the share label:
 * different purpose, same reasoning that put the curve in the name. It is
 * defined once, in `engine/crypto/hkdf.ts`, alongside every other branch —
 * where the domain-separation argument for all six can be read together. The
 * ECDH → HKDF → KEK step itself is `engine/crypto/ecies.ts`, shared with the
 * share wrap, so the two constructions differ by the label and nothing else.
 *
 * ── The identifier that must not appear ──────────────────────────────────
 *
 * THE AAD CARRIES NO ACCOUNT ID. This is the deliberate inversion of §5.16,
 * where `grantorAccountId` is required because §3.2's AAD binds it. Every
 * field here is reconstructible by the researcher before decryption: four ride
 * in the study-side response, and the fingerprint she computes locally from
 * her own key — which keeps the substitution defence out of the server's
 * hands. Anyone reusing the shared-blob response shape here imports the leak.
 *
 * ── Both directions live here, on purpose ────────────────────────────────
 *
 * {@link sealContribution} is the contributor's; {@link openContribution} is
 * the study's. One module owns both so the study client adds no crypto of its
 * own, and so a change to the packing cannot be made on one side only.
 */
import { aesGcmDecrypt, aesGcmEncrypt, packIvAndCiphertext, splitIvAndCiphertext } from '../engine/crypto/aes-gcm';
import { bytesToBase64 } from '../engine/crypto/base64';
import { toBufferSource } from '../engine/crypto/buffer-source';
import { deriveEciesRecipientKek, deriveEciesSenderKek, ECIES_PUBLIC_KEY_BYTES } from '../engine/crypto/ecies';
import { HKDF_INFO } from '../engine/crypto/hkdf';

/** Everything the AAD binds. Every field is reconstructible by the researcher before decryption — that is the design constraint, not a coincidence. */
export interface ContributionAadFields {
  studyAccountId: number;
  pseudonym: string;
  contributionVersion: number;
  /** The tier NAME (`DAILY_INTAKE_V1`). Bound so a payload cannot be re-presented as a different tier. */
  schemaTier: string;
  /** The study's own public key. Its SHA-256 goes into the AAD; the key itself does not. */
  studyPublicKeyRaw: Uint8Array;
}

/**
 * Why an opened contribution could not be opened.
 *
 * `malformed` is STRUCTURAL and knowable: the body is too short to hold an
 * ephemeral public key and an IV, so nothing was ever sealed in this shape.
 *
 * `unopenable` is a GCM tag failure, and it is deliberately one value rather
 * than two. A tag check does not say why it failed: sealed to a different
 * study key, sealed under a different AAD, or genuinely corrupt are the SAME
 * outcome and no code may pretend to tell them apart. A study client holding
 * an older key pair must therefore treat this as "try the next key I hold",
 * and only report the contribution unopenable once every key has failed.
 */
export type ContributionOpenFailure = 'malformed' | 'unopenable';

/** Thrown by {@link openContribution}. Carries {@link ContributionOpenFailure} so a caller can retry across keys without parsing a message string. */
export class ContributionOpenError extends Error {
  readonly reason: ContributionOpenFailure;

  constructor(reason: ContributionOpenFailure, message: string) {
    super(message);
    this.name = 'ContributionOpenError';
    this.reason = reason;
  }
}

/**
 * Seals a reduced payload to a study's public key.
 *
 * @param payload - the reduced tier, already serialized. Bytes rather than rows so this module owns the crypto and nothing else — the tier's own shape belongs to `tiers.ts`.
 * @returns `ephPub(65) || iv(12) || ciphertext+tag`.
 * @throws when the study key is not a well-formed uncompressed P-256 point, or an AAD field cannot be canonicalised.
 */
export async function sealContribution({
  payload,
  studyPublicKeyRaw,
  studyAccountId,
  pseudonym,
  contributionVersion,
  schemaTier,
}: {
  payload: Uint8Array;
  studyPublicKeyRaw: Uint8Array;
  studyAccountId: number;
  pseudonym: string;
  contributionVersion: number;
  schemaTier: string;
}): Promise<Uint8Array> {
  const additionalData = await buildContributionAad({
    studyAccountId,
    pseudonym,
    contributionVersion,
    schemaTier,
    studyPublicKeyRaw,
  });
  const { kek, ephemeralPublicKeyRaw } = await deriveEciesSenderKek({
    recipientPublicKeyRaw: studyPublicKeyRaw,
    info: HKDF_INFO.RESEARCH_KEK,
  });
  const { iv, ciphertext } = await aesGcmEncrypt({ key: kek, plaintext: payload, additionalData });
  return packContributionBody({ ephemeralPublicKeyRaw, packedCiphertext: packIvAndCiphertext(iv, ciphertext) });
}

/**
 * Opens a contribution with the study's private key — the researcher's side.
 *
 * `aad` is passed in rather than rebuilt from a server response inside this
 * function, and that ordering is the substitution defence: the study client
 * builds the AAD from four fields it received and a fingerprint it computed
 * from ITS OWN key, so a server that substituted a key cannot produce a body
 * that opens.
 *
 * @throws {ContributionOpenError} — see {@link ContributionOpenFailure} for why a tag failure is one reason and not three.
 */
export async function openContribution({
  body,
  privateKey,
  aad,
}: {
  body: Uint8Array;
  privateKey: CryptoKey;
  aad: Uint8Array;
}): Promise<Uint8Array> {
  const { ephemeralPublicKeyRaw, packedCiphertext } = splitContributionBody(body);
  const kek = await deriveEciesRecipientKek({ ephemeralPublicKeyRaw, privateKey, info: HKDF_INFO.RESEARCH_KEK });
  const { iv, ciphertext } = splitIvAndCiphertext(packedCiphertext);
  try {
    return await aesGcmDecrypt({ key: kek, iv, ciphertext, additionalData: aad });
  } catch {
    throw new ContributionOpenError(
      'unopenable',
      'contribution did not open: sealed to a different study key, built under a different AAD, or corrupt — indistinguishable',
    );
  }
}

/**
 * The AAD, as canonical fixed-key-order JSON.
 *
 * Built by string concatenation rather than `JSON.stringify` on an object: the
 * byte sequence IS the contract, and it must not depend on a property order
 * the language merely happens to preserve today. Both ends build it here, so a
 * byte of drift fails a tag check on the very first round-trip rather than in
 * production. Exported because the STUDY side must rebuild it from its own
 * response and its own key.
 *
 * The string fields go through `JSON.stringify` individually so a pseudonym or
 * tier containing a quote or a backslash escapes identically on both sides.
 */
export async function buildContributionAad({
  studyAccountId,
  pseudonym,
  contributionVersion,
  schemaTier,
  studyPublicKeyRaw,
}: ContributionAadFields): Promise<Uint8Array> {
  if (!Number.isSafeInteger(studyAccountId) || !Number.isSafeInteger(contributionVersion)) {
    // Interpolated raw into the JSON below, so a non-integer would produce a
    // string neither end could reproduce — fail here, loudly, instead.
    throw new Error(
      `studyAccountId and contributionVersion must be safe integers, got ${studyAccountId} and ${contributionVersion}`,
    );
  }
  const fingerprintBase64 = bytesToBase64(
    new Uint8Array(await crypto.subtle.digest('SHA-256', toBufferSource(studyPublicKeyRaw))),
  );
  const json =
    `{"studyAccountId":${studyAccountId},"pseudonym":${JSON.stringify(pseudonym)},` +
    `"contributionVersion":${contributionVersion},"schemaTier":${JSON.stringify(schemaTier)},` +
    `"studyKeyFingerprint":${JSON.stringify(fingerprintBase64)}}`;
  return new TextEncoder().encode(json);
}

/**
 * The contribution body's OWN packing: a 65-byte ephemeral public key ahead of
 * the canonical `iv || ciphertext` pair.
 *
 * The same shape as a share wrap and deliberately NOT the same function: a
 * share is a fixed 125 bytes and its splitter asserts that length, while a
 * contribution's payload is as long as the window. No shared validation path
 * may branch on length to tell the two apart.
 */
function packContributionBody({
  ephemeralPublicKeyRaw,
  packedCiphertext,
}: {
  ephemeralPublicKeyRaw: Uint8Array;
  packedCiphertext: Uint8Array;
}): Uint8Array {
  const body = new Uint8Array(ephemeralPublicKeyRaw.byteLength + packedCiphertext.byteLength);
  body.set(ephemeralPublicKeyRaw, 0);
  body.set(packedCiphertext, ephemeralPublicKeyRaw.byteLength);
  return body;
}

/** The two parts a contribution body splits into: the ephemeral public key, and the packed `iv || ciphertext`. */
interface ContributionBodyParts {
  ephemeralPublicKeyRaw: Uint8Array;
  packedCiphertext: Uint8Array;
}

function splitContributionBody(body: Uint8Array): ContributionBodyParts {
  if (body.byteLength <= ECIES_PUBLIC_KEY_BYTES) {
    throw new ContributionOpenError(
      'malformed',
      `contribution body must be longer than its ${ECIES_PUBLIC_KEY_BYTES}-byte ephemeral key, got ${body.byteLength}`,
    );
  }
  return {
    ephemeralPublicKeyRaw: body.slice(0, ECIES_PUBLIC_KEY_BYTES),
    packedCiphertext: body.slice(ECIES_PUBLIC_KEY_BYTES),
  };
}
