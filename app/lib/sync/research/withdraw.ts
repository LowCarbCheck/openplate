/**
 * WITHDRAWAL (`openplate-sync` PROTOCOL.md §5.18, ADR-0003 prohibitions 5, 6
 * and 8).
 *
 * Three steps, and the middle one is the one that gets skipped: call the
 * endpoint, drop the local enrolment, and tell the truth about what just
 * happened. The third step is copy — it lives in the `research` i18n namespace
 * and is guarded by `tests/unit/research-wording.test.ts` — and the first two
 * live here, in that order, because the ORDER is the guarantee.
 *
 * ── The pin is dropped AFTER the call, and only on a `204` ───────────────
 *
 * A failed call leaves the pin, so a retry is possible. A pin dropped against
 * a live server row is a contribution nobody can withdraw: the pin is the only
 * record on this device that the study exists, and the withdrawal endpoint is
 * addressed by the study's account id. That asymmetry is why the two failure
 * shapes below both keep it — a thrown transport error and a dark lane
 * (`unavailable`) alike. A dark lane is NOT proof there is no row: a
 * deployment that had the research lane lit and then turned it off answers the
 * same 404 over rows that are still in its database (ADR-0003 prohibition 9).
 *
 * ── Dropping the pin is right, not merely safe ───────────────────────────
 *
 * A pin is a verification record — "I typed this study's fingerprint from its
 * consent materials" — and keeping one for a study you have left is a stale
 * claim. Re-enrolling therefore requires typing the fingerprint again, which
 * is the correct reading of re-joining: it is a new consent, and the consent
 * document is the trust anchor (`enrolment.ts`).
 *
 * ── Withdrawal does NOT mint a new pseudonym root ────────────────────────
 *
 * `deriveStudyPseudonym` takes the root and the study account id, and nothing
 * else — the pin is not an input to it. So dropping the pin is safe for the
 * derivation, AND re-enrolling in the same study presents the SAME pseudonym,
 * because the root is per account and lives in the owner-private compartment.
 *
 * That is a real disclosure and not a footnote: a researcher who kept a copy
 * she was told to purge could link a re-enrolled series to the withdrawn one.
 * Minting a fresh root would be worse by a wide margin — it would
 * re-pseudonymise the person in every OTHER study they contribute to, and each
 * of those researchers would read them as a new participant with no history.
 * So the behaviour stands and the honesty burden moves to the copy:
 * `research.withdrawal.samePseudonymOnRejoin`, in both locales.
 *
 * ── Pure with respect to the device ──────────────────────────────────────
 *
 * The transport and the compartment are INJECTED, exactly as `enrolment.ts`'s
 * are, so "did this drop the pin?" is answerable by looking at one object in a
 * test with no IndexedDB and no session.
 */
import type { SyncHttpClient } from '../engine/client/http-client';

/** What this module is allowed to touch on the wire. Narrowed from the client so nothing here can reach a study-side read or a push. */
export type WithdrawalTransport = Pick<SyncHttpClient, 'withdrawContribution'>;

/**
 * The owner-private compartment, as withdrawal is allowed to touch it.
 *
 * One verb, and it is a delete. Withdrawal never writes an enrolment, never
 * touches the pseudonym root, and cannot: the root is not on this interface,
 * so "does withdrawal re-key this person?" is answered by the type.
 */
export interface WithdrawalCompartment {
  /** Removes the pin. Called only after the service answered `204`. */
  deleteEnrolment: (studyAccountId: number) => Promise<void>;
}

/** Every way a withdrawal can end without throwing. Only `withdrawn` removes anything anywhere. */
export type WithdrawalResult =
  /** The row is deleted and the tombstone is written. The pin is gone from this device too. */
  | { status: 'withdrawn' }
  /** This deployment has no research lane (prohibition 9). NOTHING was withdrawn and the pin was KEPT — see this module's header. */
  | { status: 'unavailable' };

/**
 * Withdraws this account's contribution to one study, then forgets the study.
 *
 * @param studyAccountId - the study's sync account id. The endpoint is addressed by it, and so is the pin.
 * @returns `unavailable` when the deployment has no research lane. Nothing was written in that case.
 * @throws whatever the transport throws — an offline device, a `401`, a `5xx`. The pin survives every one of them, which is what makes a retry possible.
 */
export async function withdrawFromStudy({
  transport,
  compartment,
  studyAccountId,
}: {
  transport: WithdrawalTransport;
  compartment: WithdrawalCompartment;
  studyAccountId: number;
}): Promise<WithdrawalResult> {
  // FIRST the wire, and nothing local before it. Reversing these two lines
  // produces a device that has forgotten a study whose row is still being
  // served to a researcher.
  const result = await transport.withdrawContribution(studyAccountId);
  if (result.status === 'unavailable') return { status: 'unavailable' };

  await compartment.deleteEnrolment(studyAccountId);
  return { status: 'withdrawn' };
}
