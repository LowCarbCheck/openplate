/**
 * THE STUDY KEYRING — every key generation a study has ever minted
 * (`openplate-sync` ADR-0003, "A study is an ordinary sync account").
 *
 * The ADR puts the private key in **the study account's own** owner-private
 * compartment. This module is the plaintext that goes in there, and it is
 * deliberately NOT `OwnerPrivateRegion`: that shape is the DIARY compartment's
 * (`snapshot-partition.ts`), and a study identity added to it would be a key
 * on `LocalStoreSnapshot` — a diary-snapshot key, on every contributor's
 * device, classified by a map that must never be asked about it.
 *
 * ── A GENERATION IS APPENDED, NEVER REPLACED ─────────────────────────────
 *
 * `study.ts` opens a cohort by trying every key it holds, and reports a row
 * un-openable only after all of them have failed. So a console that kept only
 * the newest generation would not lose a key quietly — it would report the
 * study's whole back catalogue as `unopenableCount` after a single rotation,
 * and the cohort would shrink with nothing failing. {@link withNewStudyKeyGeneration}
 * is therefore the only way this keyring grows, and it concatenates.
 *
 * The keyring is ordered oldest-first, and the NEWEST generation is the one a
 * fingerprint is taken of: that is the key a study prints in the consent
 * document it is handing out today. Older generations stay, unprinted, purely
 * so their ciphertexts keep opening.
 */
import { z } from 'zod';

import { base64ToBytes, bytesToBase64 } from '../engine/crypto/base64';
import { generateEciesKeyPair } from '../engine/crypto/ecies';
import type { StudyKeyPair } from './study';

/**
 * ONE generation, in the two base64 forms a compartment's JSON can hold.
 *
 * Base64 rather than `Uint8Array` for the reason `SealedPrivateStore`'s fields
 * are: the compartment plaintext is JSON, and a typed array round-trips
 * through it as an object of numeric keys.
 */
const studyKeyGenerationSchema = z.object({
  /** Uncompressed SEC1 raw public key (65 bytes), base64. Its SHA-256 is §3.5's `studyKeyFingerprint`. */
  publicKey: z.string(),
  /** PKCS#8 private key, base64. It exists in this compartment and in a call frame, and nowhere else — never in a URL, a log or an error. */
  privateKey: z.string(),
  /** Epoch-ms this generation was minted, so a researcher can tell which one the consent document names. */
  createdAt: z.number().int(),
});

export type StudyKeyGeneration = z.infer<typeof studyKeyGenerationSchema>;

/**
 * The STUDY compartment's plaintext.
 *
 * `.default([])` is the whole forward migration, exactly as
 * `ownerPrivateRegionFields` uses it: a compartment written before this
 * existed opens as a study with no keys yet, rather than failing to open.
 */
export const studyPrivateRegionSchema = z.object({
  studyKeyring: z.array(studyKeyGenerationSchema).default([]),
});

export type StudyPrivateRegion = z.infer<typeof studyPrivateRegionSchema>;

/** A study account that has minted nothing yet. */
export const EMPTY_STUDY_PRIVATE_REGION: StudyPrivateRegion = { studyKeyring: [] };

/**
 * Mints a fresh generation. The key pair never touches the network — the
 * public half goes into a consent document by hand, the private half into the
 * compartment.
 *
 * @param now - injected so a test can pin the stamp; production passes none.
 */
export async function generateStudyKeyGeneration({
  now = Date.now,
}: { now?: () => number } = {}): Promise<StudyKeyGeneration> {
  const pair = await generateEciesKeyPair();
  return {
    publicKey: bytesToBase64(pair.publicKeyRaw),
    privateKey: bytesToBase64(pair.privateKeyPkcs8),
    createdAt: now(),
  };
}

/**
 * The region with one more generation on the end.
 *
 * CONCATENATION IS THE POINT — see this module's header. There is no function
 * here that drops a generation, and there must not be one: the only thing a
 * researcher could gain from deleting an old key is a cohort that silently
 * shrinks.
 */
export function withNewStudyKeyGeneration({
  region,
  generation,
}: {
  region: StudyPrivateRegion;
  generation: StudyKeyGeneration;
}): StudyPrivateRegion {
  return { studyKeyring: [...region.studyKeyring, generation] };
}

/** Every generation, decoded into what {@link import('./study').pullStudyCohort} tries. All of them, in mint order. */
export function studyKeyPairsOf(region: StudyPrivateRegion): StudyKeyPair[] {
  return region.studyKeyring.map((generation) => ({
    publicKeyRaw: base64ToBytes(generation.publicKey),
    privateKeyPkcs8: base64ToBytes(generation.privateKey),
  }));
}

/**
 * The generation a fingerprint is taken of: the newest, or `null` on a study
 * that has minted none.
 *
 * Only the public half is returned. Nothing above this module needs the
 * private one, and a function that handed it out would be the first step of
 * every way it could end up on a screen.
 */
export function currentStudyPublicKey(region: StudyPrivateRegion): Uint8Array | null {
  const newest = region.studyKeyring.at(-1);
  return newest === undefined ? null : base64ToBytes(newest.publicKey);
}
