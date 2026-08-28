/**
 * THE ENROLMENT CEREMONY (`openplate-sync` ADR-0003, prohibitions 3 and 4).
 *
 * Joining a study is two refusals and then three writes, in that order. Both
 * refusals happen BEFORE any side effect, and that ordering is the security
 * property rather than a style choice — the same rule `sharing.ts`'s
 * `runShareCeremony` follows, for the same reason.
 *
 * ── Refusal 1: no compartment, no enrolment ──────────────────────────────
 *
 * The pseudonym root lives in the owner-private compartment, which is what
 * makes it survive a recovery restore and reach a second device. An account
 * without a compartment — the no-recovery-code branch leaves exactly such an
 * account — would get a per-device root, and a person's pseudonym would change
 * when they moved devices or restored. A researcher reads that as a new
 * participant whose series starts from nothing, so ADR-0003 prohibition 4
 * refuses instead of degrading.
 *
 * **The server cannot enforce this and does not try.** It cannot see a
 * compartment. This function is the whole of the guarantee.
 *
 * ── Refusal 2: the typed fingerprint ─────────────────────────────────────
 *
 * ADR-0003 ranks enrolment-time study-key substitution as the second attack,
 * and worse than the clinician case by a factor of N: one substituted study
 * key harvests a whole cohort. The ceremony cannot be the consultation room —
 * a cohort has no room — so the trust anchor moves to the study's
 * ethics-approved consent materials, where the fingerprint is PRINTED. The
 * contributor TYPES it. It is never shown to them first and there is no
 * confirm-what-you-see path anywhere above this function.
 *
 * The fingerprint machinery is `crypto/share-wrap.ts`'s, unchanged and
 * deliberately not re-implemented: 60 bits, twelve Crockford characters, three
 * groups of four. A second ceremony implementation is a second place for the
 * length — which is a security parameter, not a layout choice — to drift.
 *
 * ── Pure with respect to the device ──────────────────────────────────────
 *
 * The compartment is INJECTED, reads and writes and all. That is what makes
 * "did this refusal write anything?" answerable by looking at one object in a
 * test with no IndexedDB and no session.
 */
import type { LocalResearchIdentity, LocalStudyEnrolment } from '#app/lib/local-store';
import { bytesToBase64, base64ToBytes } from '../engine/crypto/base64';
import { shareFingerprintMatchesTyped, shareKeyFingerprint } from '../engine/crypto/share-wrap';
import { deriveStudyPseudonym, generatePseudonymRoot } from './pseudonym';

/**
 * The owner-private compartment, as this ceremony is allowed to touch it.
 *
 * The caller passes `null` for an account that HAS no compartment. Absence is
 * represented by the absence of this object rather than by an empty one, so
 * "no compartment" cannot be mistaken for "a compartment with nothing in it" —
 * the second is a normal account that has simply never enrolled.
 */
export interface EnrolmentCompartment {
  /** This account's pseudonym root, or `null` on an account that has never enrolled. */
  researchIdentity: LocalResearchIdentity | null;
  /** Studies already pinned on this device. */
  enrolments: readonly LocalStudyEnrolment[];
  /** Persists a newly minted root. Called at most once per account, ever. */
  writeIdentity: (identity: LocalResearchIdentity) => Promise<void>;
  /** Persists the pin. Called only after the typed fingerprint matched. */
  writeEnrolment: (enrolment: LocalStudyEnrolment) => Promise<void>;
}

/** Every way an enrolment can end. Only `enrolled` writes anything anywhere. */
export type EnrolmentResult =
  /** Pinned, rooted, and the pseudonym this person will present to this study. */
  | { status: 'enrolled'; pseudonym: string }
  /** This account has no owner-private compartment, so it cannot hold a stable root. NOTHING was written. ADR-0003 prohibition 4. */
  | { status: 'compartment-missing' }
  /** What was typed is not this key's fingerprint. Nothing was pinned and no pseudonym was derived. */
  | { status: 'fingerprint-mismatch' };

/**
 * Runs the whole enrolment: check the compartment, check what was typed, mint
 * the root if this is the first study, pin the key, derive the pseudonym.
 *
 * Re-enrolling in a study already pinned to a DIFFERENT key overwrites the pin
 * — but only through this function, which means only after the new key's
 * fingerprint was typed and matched. That is the honest reading of a study
 * publishing a new key in new consent materials, and it is unlike
 * `runShareCeremony`'s `key-changed`: there, the fingerprint arrives by voice
 * from a person you already know, so a changed key deserves a second look. A
 * study's fingerprint arrives in a document that is itself the trust anchor,
 * and typing it again IS the second look.
 *
 * @param typedFingerprint - what the contributor typed from the study's consent materials. Grouping and case are ignored; the value is not.
 * @param compartment - `null` when the account has no owner-private compartment.
 */
export async function runEnrolmentCeremony({
  studyAccountId,
  studyPublicKeyRaw,
  typedFingerprint,
  compartment,
  label,
  now,
}: {
  studyAccountId: number;
  studyPublicKeyRaw: Uint8Array;
  typedFingerprint: string;
  compartment: EnrolmentCompartment | null;
  /** The person's own name for the study. Local only; the server never sees it. */
  label?: string | null;
  now?: number;
}): Promise<EnrolmentResult> {
  // FIRST, and before the fingerprint is even computed: an account with no
  // compartment cannot hold a stable root, and a pseudonym that changes on a
  // restore is not a degraded contribution — it is a corrupted one.
  if (compartment === null) return { status: 'compartment-missing' };

  const fingerprint = await shareKeyFingerprint(studyPublicKeyRaw);
  if (!shareFingerprintMatchesTyped({ typed: typedFingerprint, fingerprint })) {
    return { status: 'fingerprint-mismatch' };
  }

  const at = now ?? Date.now();
  const root = await resolveRoot({ compartment, at });
  // Pinned only now, after both refusals. A pin is the verification record, so
  // it must never exist for a ceremony that did not pass.
  await compartment.writeEnrolment({
    id: String(studyAccountId),
    studyAccountId,
    publicKeyRaw: bytesToBase64(studyPublicKeyRaw),
    label: label ?? null,
    createdAt: at,
    // A ceremony writes a FRESH pin, window included — the same reason it
    // resets `createdAt`. Re-enrolling is a new consent (this function is
    // reached only by typing the fingerprint again), and carrying a window
    // sent under the previous pin into the new one would make the screen state
    // days about an enrolment that did not exist when they were sent.
    lastSubmission: null,
  });
  return { status: 'enrolled', pseudonym: await deriveStudyPseudonym({ root, studyAccountId }) };
}

/**
 * This account's pseudonym root — the existing one, or a fresh one written on
 * first enrolment.
 *
 * REUSING the existing root is the whole point: a second root would give every
 * study this person already contributes to a new pseudonym, which a researcher
 * reads as a second participant with no history.
 */
async function resolveRoot({
  compartment,
  at,
}: {
  compartment: EnrolmentCompartment;
  at: number;
}): Promise<Uint8Array> {
  const existing = compartment.researchIdentity;
  if (existing !== null) return base64ToBytes(existing.pseudonymRoot);
  const root = generatePseudonymRoot();
  await compartment.writeIdentity({ pseudonymRoot: bytesToBase64(root), createdAt: at });
  return root;
}
