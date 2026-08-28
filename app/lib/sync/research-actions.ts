/**
 * Every research-lane operation the UI can trigger, wired to the vault and the
 * device store — the composition root for `research/`, exactly as
 * `share-actions.ts` is for `sharing.ts`.
 *
 * Nothing here DECIDES anything. The withdrawal's ordering rule lives in
 * `research/withdraw.ts` and the pseudonym derivation in
 * `research/pseudonym.ts`, both testable without a session; this file supplies
 * the transport, the compartment reads and the one store delete.
 *
 * ── Failures throw, absences do not ──────────────────────────────────────
 *
 * A deployment with no research lane answers the ordinary unknown-route 404 on
 * every research path (ADR-0003 prohibition 9). That is not a failure: the
 * reads return `unavailable` and the surface says so in one sentence. A
 * genuine error still throws, because the callers are React handlers that show
 * one.
 */
import {
  deleteLocalStudyEnrolment,
  getLocalResearchIdentity,
  listLocalStudyEnrolments,
  type LocalStudyEnrolment,
} from '#app/lib/local-store';
import { base64ToBytes } from './engine/crypto/base64';
import type { ContributionEnrolment } from './engine/client/http-client';
import { deriveStudyPseudonym } from './research/pseudonym';
import { withdrawFromStudy, type WithdrawalResult } from './research/withdraw';
import { markSyncPending, syncNow } from './sync-actions';
import { getSyncVault, type SyncVault } from './sync-session';

/** A read of a surface that may not exist on this deployment. Mirrors `share-actions.ts`'s `SharingRead`. */
export type ResearchRead<TValue> = { status: 'available'; value: TValue } | { status: 'unavailable' };

function requireVault(operation: string): SyncVault {
  const vault = getSyncVault();
  if (vault === null) throw new Error(`${operation} called without an open sync session`);
  return vault;
}

/**
 * One study this device is pinned to, as the enrolments screen shows it.
 *
 * The PSEUDONYM is on this view deliberately. A contributor who cannot see her
 * own pseudonym cannot ask a researcher to check that a withdrawal was
 * honoured — the pseudonym is the only identifier that exists on the study's
 * side, so without it the question has no subject.
 */
export interface StudyEnrolmentView {
  studyAccountId: number;
  /** The person's own name for the study. Local only; the server has never seen it. */
  label: string | null;
  /** Epoch-ms the fingerprint ceremony passed and this key was pinned. */
  joinedAt: number;
  /**
   * The pseudonym this account presents to this study, derived here and never
   * stored — `null` only on a device whose compartment has the pin but not the
   * root, which no ceremony produces and a partial restore could.
   */
  pseudonym: string | null;
  /** The tier and version the SERVER currently holds, or `null` when nothing has been sent yet — or when the lane is dark. */
  server: { schemaTier: string; contributionVersion: number; updatedAt: string } | null;
}

/**
 * The studies this device is pinned to, annotated with what the server holds.
 *
 * The list is the LOCAL pins, always. A dark lane makes the annotation `null`
 * and nothing else disappear: the pins are still real, and hiding them would
 * hide the withdrawal button for rows that may still exist on a deployment
 * whose lane was switched off after they were written.
 */
export async function loadResearchEnrolments(): Promise<ResearchRead<StudyEnrolmentView[]>> {
  const vault = requireVault('loadResearchEnrolments');
  const enrolments = await listLocalStudyEnrolments();
  const identity = await getLocalResearchIdentity();
  const root = identity === null ? null : base64ToBytes(identity.pseudonymRoot);

  const remote = await vault.http.listMyContributions();
  const byStudy = new Map<number, ContributionEnrolment>(
    remote.status === 'available' ? remote.value.map((row) => [row.studyAccountId, row]) : [],
  );

  const views = await Promise.all(
    enrolments.map(async (enrolment) => describeEnrolment({ enrolment, root, remote: byStudy })),
  );
  // `unavailable` describes the SERVER's surface, and the local pins ride
  // along in it: a screen that showed nothing on a dark lane would be a screen
  // with no way to withdraw.
  return remote.status === 'available' ? { status: 'available', value: views } : { status: 'unavailable' };
}

/** One pin plus what the server says about it. Split out so the derivation above stays a list comprehension. */
async function describeEnrolment({
  enrolment,
  root,
  remote,
}: {
  enrolment: LocalStudyEnrolment;
  root: Uint8Array | null;
  remote: ReadonlyMap<number, ContributionEnrolment>;
}): Promise<StudyEnrolmentView> {
  const row = remote.get(enrolment.studyAccountId) ?? null;
  return {
    studyAccountId: enrolment.studyAccountId,
    label: enrolment.label,
    joinedAt: enrolment.createdAt,
    pseudonym: root === null ? null : await deriveStudyPseudonym({ root, studyAccountId: enrolment.studyAccountId }),
    server:
      row === null ? null : (
        { schemaTier: row.schemaTier, contributionVersion: row.contributionVersion, updatedAt: row.updatedAt }
      ),
  };
}

/**
 * Withdraws from one study and forgets it on this device.
 *
 * The ordering — the wire first, the pin only on a `204` — is
 * `research/withdraw.ts`'s and is asserted there. This function supplies the
 * transport and the one store delete, and adds nothing.
 *
 * NOTE what it does NOT do: it does not touch the pseudonym root. Re-joining
 * this study later presents the SAME pseudonym, and the copy beside this call
 * says so (`research.withdrawal.samePseudonymOnRejoin`).
 */
export async function withdrawFromStudyAction(studyAccountId: number): Promise<WithdrawalResult> {
  const vault = requireVault('withdrawFromStudyAction');
  const result = await withdrawFromStudy({
    transport: vault.http,
    compartment: { deleteEnrolment: deleteLocalStudyEnrolment },
    studyAccountId,
  });
  // The pin lives in the owner-private compartment, so a drop that never
  // reaches the blob is a drop the account's other devices do not have — the
  // same reason `forgetPinnedPeer` syncs. Only on a real withdrawal: a kept
  // pin has nothing to propagate.
  if (result.status === 'withdrawn') {
    markSyncPending();
    await syncNow();
  }
  return result;
}
