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
  getLocalStudyEnrolment,
  listLocalStudyEnrolments,
  putLocalResearchIdentity,
  putLocalStudyEnrolment,
  type LocalStudyEnrolment,
  type LocalSubmittedWindow,
} from '#app/lib/local-store';
import { base64ToBytes } from './engine/crypto/base64';
import type { ContributionEnrolment } from './engine/client/http-client';
import { readLocalSnapshot } from './local-store-bridge';
import { submitContribution, type ContributionSubmitResult } from './research/contribute';
import { runEnrolmentCeremony, type EnrolmentCompartment, type EnrolmentResult } from './research/enrolment';
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
  /**
   * The window this device last SENT to this study, or `null` when it has sent
   * nothing (M163/01).
   *
   * It comes off the LOCAL pin and could come from nowhere else: §5.18's
   * contribution row carries no window, deliberately, so `server` above can
   * say when and at which version but never which days. `null` renders as
   * "nothing sent yet" — never as an empty range and never as today.
   */
  lastSubmission: LocalSubmittedWindow | null;
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
    lastSubmission: enrolment.lastSubmission,
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

// ---------------------------------------------------------------------------
// Joining a study, and sending it a window
// ---------------------------------------------------------------------------

/**
 * Joins a study: the ceremony, wired to this device.
 *
 * Every REFUSAL is `research/enrolment.ts`'s and is asserted there — this
 * function decides nothing. What it supplies is the compartment (or its
 * absence, which is prohibition 4's whole trigger) and the sync that carries a
 * successful pin to the account's other devices.
 *
 * The public key is the one that arrived in the LINK, and the fingerprint is
 * the one typed from the study's printed consent document. The ceremony
 * re-checks them against each other before it writes anything, so nothing
 * above this line can skip the check by calling here directly.
 */
export async function enrolInStudyAction({
  studyAccountId,
  publicKeyBase64,
  typedFingerprint,
  label,
}: {
  studyAccountId: number;
  publicKeyBase64: string;
  typedFingerprint: string;
  /** The person's own name for the study. Local only; the server never sees it. */
  label: string | null;
}): Promise<EnrolmentResult> {
  const vault = requireVault('enrolInStudyAction');
  const result = await runEnrolmentCeremony({
    studyAccountId,
    studyPublicKeyRaw: base64ToBytes(publicKeyBase64),
    typedFingerprint,
    compartment: await enrolmentCompartment(vault),
    label,
  });
  if (result.status !== 'enrolled') return result;

  // The pin AND the pseudonym root live in the owner-private compartment, so
  // an enrolment that never reaches the blob is an enrolment the account's
  // other devices do not have — and a root that never leaves this device is
  // the per-device root prohibition 4 exists to prevent. Same reason
  // `ensureShareIdentity` syncs.
  markSyncPending();
  await syncNow();
  return result;
}

/**
 * The owner-private compartment, or `null` for an account that has none.
 *
 * `cdk === null` means THIS SESSION has no compartment, which is not quite the
 * same thing: a device that signed in and has not pulled yet also reads that
 * way, and refusing it would tell a person with a perfectly good recovery code
 * that they cannot join a study. So a null goes and pulls once — an adopted
 * compartment is exactly what `openOwnerPrivateRegion` does on the way — and
 * only a second null is the answer prohibition 4 is about.
 *
 * A transport failure propagates rather than degrading into `null`. "We could
 * not reach sync" and "this account cannot hold a stable study identity" are
 * different sentences, and only one of them is about the person's account.
 */
async function enrolmentCompartment(vault: SyncVault): Promise<EnrolmentCompartment | null> {
  if (vault.privateStore.cdk === null) await syncNow();
  if (vault.privateStore.cdk === null) return null;

  return {
    researchIdentity: await getLocalResearchIdentity(),
    enrolments: await listLocalStudyEnrolments(),
    writeIdentity: async (identity) => void (await putLocalResearchIdentity(identity)),
    writeEnrolment: async (enrolment) => void (await putLocalStudyEnrolment(enrolment)),
  };
}

/**
 * Sends one window of whole calendar days to one study.
 *
 * The reduction, the seal, the version and the refusal order are all
 * `research/contribute.ts`'s. This function supplies the transport, the
 * device's own snapshot, the pinned key, the pseudonym root and the
 * compartment that module writes the accepted window through.
 *
 * @throws when this device holds no pin for the study, or holds one with no
 * pseudonym root. Both are states no ceremony produces and a partial restore
 * can, and neither has an honest submission to make.
 */
export async function submitContributionAction({
  studyAccountId,
  fromDayKey,
  toDayKey,
}: {
  studyAccountId: number;
  fromDayKey: string;
  toDayKey: string;
}): Promise<ContributionSubmitResult> {
  const vault = requireVault('submitContributionAction');
  const enrolment = await getLocalStudyEnrolment(studyAccountId);
  if (enrolment === null) throw new Error(`this device is not enrolled in study ${studyAccountId}`);
  const identity = await getLocalResearchIdentity();
  if (identity === null) throw new Error(`this device holds a pin for study ${studyAccountId} but no pseudonym root`);

  const result = await submitContribution({
    transport: vault.http,
    // The two verbs `research/contribute.ts` asks for, and no more: the write
    // is its own, beside the branch that decides `submitted`, so no caller can
    // forget to record the window that was sent.
    compartment: {
      getEnrolment: getLocalStudyEnrolment,
      writeEnrolment: async (pin) => void (await putLocalStudyEnrolment(pin)),
    },
    enrolment,
    pseudonymRoot: base64ToBytes(identity.pseudonymRoot),
    snapshot: await readLocalSnapshot(),
    fromDayKey,
    toDayKey,
  });
  // The window it just recorded lives on the pin, in the owner-private
  // compartment — the same reason `withdrawFromStudyAction` syncs. A window
  // that never reaches the blob is a window the account's other devices lack,
  // and they would then offer to send days that have already gone.
  if (result.status === 'submitted') {
    markSyncPending();
    await syncNow();
  }
  return result;
}
