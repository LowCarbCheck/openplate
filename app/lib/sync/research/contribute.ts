/**
 * THE CONTRIBUTOR'S SUBMISSION (`openplate-sync` ADR-0003, `PROTOCOL.md`
 * §5.18).
 *
 * Reduce the window, seal it to the study's PINNED key, push it under a
 * version strictly greater than the one the server holds. Pure with respect to
 * the device: the snapshot, the pseudonym root, the pinned enrolment and the
 * transport all arrive as arguments, so every rule below is assertable without
 * an IndexedDB or a session — the split `sharing.ts` and `share-actions.ts`
 * established.
 *
 * ── The key is the PINNED one, never a key that just arrived ─────────────
 *
 * `enrolment.publicKeyRaw` was written by `runEnrolmentCeremony` and only ever
 * by it — after the contributor typed the fingerprint printed in the study's
 * consent materials. This module never accepts a key from a response, an
 * invite or a parameter, because a study key that can arrive at submission
 * time is ADR-0003's second-ranked attack with the ceremony routed around.
 *
 * ── The version is the server's plus one, and a 409 is not a failure ─────
 *
 * `contributionVersion` binds into §3.5's AAD, so it must be the value the
 * body was sealed under — which is why it is chosen BEFORE the seal and
 * re-chosen on a conflict rather than patched afterwards. A 409 means another
 * of this person's own devices pushed first; the caller re-runs, since the
 * source is still on this device and the projection is recomputed whole every
 * time.
 *
 * ── The window is recorded HERE, and only after a `submitted` ────────────
 *
 * `LocalStudyEnrolment.lastSubmission` is the one fact on that row which is
 * not recomputable and which the server cannot supply: §5.18's contribution
 * row deliberately carries no window, because a window there would tell the
 * server the date range of a person's diary contribution. So the device has to
 * remember it, and the rule is the one `withdraw.ts` follows — **the local
 * write happens only after the service accepted**. A `conflict`, a
 * `too-large`, an `unknown-study`, an `unavailable` and a thrown transport
 * error all leave the previous value exactly as it was. A screen that names
 * days which were never sent is worse than one that names none, which is
 * M161/05's pin rule stated over a different field.
 *
 * THE COMPARTMENT IS INJECTED RATHER THAN THE WINDOW RETURNED, and that was
 * the open decision. Returning `{fromDayKey, toDayKey}` on `submitted` and
 * letting one caller write it would keep this module store-free — but the
 * invariant would then live in the caller, where the next caller (M163/02's
 * "send a window" surface) can simply not implement it, and nothing here would
 * fail. Putting the write beside the branch that decides `submitted` makes
 * forgetting it impossible rather than merely discouraged.
 *
 * It costs no testability: `compartment` is a two-verb object, exactly as
 * `enrolment.ts`'s and `withdraw.ts`'s are, so "did this rejected submission
 * write anything?" is answered by looking at one recording fake with no
 * IndexedDB and no session. The module stays pure with respect to the DEVICE;
 * it is not pure with respect to its arguments, and never was — it pushes.
 */
import type { LocalStoreSnapshot, LocalStudyEnrolment } from '#app/lib/local-store';
import type { SyncHttpClient } from '../engine/client/http-client';
import { base64ToBytes } from '../engine/crypto/base64';
import { sealContribution } from './contribution-wrap';
import { encodeDailyIntakeV1Payload } from './payload';
import { deriveStudyPseudonym } from './pseudonym';
import { reduceDailyIntakeV1 } from './reduce';
import { DAILY_INTAKE_V1 } from './tiers';

/** What this module is allowed to touch. Narrowed from the client so nothing here can reach a study-side read. */
export type ContributorTransport = Pick<SyncHttpClient, 'listMyContributions' | 'putContribution'>;

/**
 * The owner-private compartment, as a submission is allowed to touch it.
 *
 * Two verbs, and the read is not a convenience. Re-reading the pin instead of
 * patching the `enrolment` argument means a submission that raced a withdrawal
 * records nothing rather than RESURRECTING a pin the person just dropped —
 * `withdraw.ts` deletes the row, and a blind write of a stale in-memory copy
 * would put it back with a window attached.
 *
 * The pseudonym root is deliberately NOT on this interface, so "can a
 * submission re-key this person?" is answered by the type.
 */
export interface ContributionCompartment {
  /** The pin for this study, or `null` if this device no longer holds one. */
  getEnrolment: (studyAccountId: number) => Promise<LocalStudyEnrolment | null>;
  /** Persists the pin. Called only to record an ACCEPTED submission's window. */
  writeEnrolment: (enrolment: LocalStudyEnrolment) => Promise<void>;
}

/** Every way a submission can end. Only `submitted` sends a body anywhere. */
export type ContributionSubmitResult =
  | { status: 'submitted'; pseudonym: string; contributionVersion: number }
  /** This deployment has no research lane (prohibition 9). NOTHING was reduced, sealed or sent. */
  | { status: 'unavailable' }
  /** No such study account here — or, on a dark deployment, the same 404. The service answers one code for both and this client must not invent a distinction it cannot make. */
  | { status: 'unknown-study' }
  /** Another of this account's devices pushed a higher version first. Recompute at `currentVersion + 1` and retry; nothing was written. */
  | { status: 'conflict'; currentVersion: number }
  /** The sealed contribution exceeds the service's cap. The window is too wide — narrow it. This is advice, not an error. */
  | { status: 'too-large' };

/**
 * Reduces, seals and pushes one contribution for `[fromDayKey, toDayKey]`.
 *
 * @param pseudonymRoot - the 256-bit root from the owner-private compartment. Never sent, never logged; it derives the pseudonym and nothing else.
 * @param enrolment - the study's PINNED row. The key comes from here or the submission does not happen.
 * @param compartment - the owner-private compartment. Touched ONLY on an accepted submission, and only to record the window.
 * @returns the outcome, including the pseudonym this person presents to this study — the one identifier the study will ever see.
 */
export async function submitContribution({
  transport,
  compartment,
  enrolment,
  pseudonymRoot,
  snapshot,
  fromDayKey,
  toDayKey,
  now,
}: {
  transport: ContributorTransport;
  compartment: ContributionCompartment;
  enrolment: LocalStudyEnrolment;
  pseudonymRoot: Uint8Array;
  snapshot: LocalStoreSnapshot;
  fromDayKey: string;
  toDayKey: string;
  /** Epoch-ms to stamp an accepted submission with. Injected so the record is assertable. */
  now?: number;
}): Promise<ContributionSubmitResult> {
  // Read FIRST, before anything is reduced or sealed: on a deployment with no
  // research lane there is nothing to send, and a client that reduced a
  // person's diary anyway would have built a payload for no reason.
  const existing = await transport.listMyContributions();
  if (existing.status === 'unavailable') return { status: 'unavailable' };

  const previous = existing.value.find((row) => row.studyAccountId === enrolment.studyAccountId) ?? null;
  const contributionVersion = (previous?.contributionVersion ?? 0) + 1;
  const pseudonym = await deriveStudyPseudonym({ root: pseudonymRoot, studyAccountId: enrolment.studyAccountId });

  const body = await sealContribution({
    payload: encodeDailyIntakeV1Payload(reduceDailyIntakeV1({ snapshot, fromDayKey, toDayKey })),
    studyPublicKeyRaw: base64ToBytes(enrolment.publicKeyRaw),
    studyAccountId: enrolment.studyAccountId,
    pseudonym,
    contributionVersion,
    schemaTier: DAILY_INTAKE_V1,
  });

  const result = await transport.putContribution({
    studyAccountId: enrolment.studyAccountId,
    pseudonym,
    schemaTier: DAILY_INTAKE_V1,
    body,
    contributionVersion,
  });
  // Every refusal returns BEFORE the record below. Moving the record above
  // this block, or past any one of these three lines, produces a device that
  // names days it never sent.
  if (result.status === 'not-found') return { status: 'unknown-study' };
  if (result.status === 'too-large') return { status: 'too-large' };
  if (result.status === 'conflict') return { status: 'conflict', currentVersion: result.currentVersion };

  await recordSubmittedWindow({
    compartment,
    studyAccountId: enrolment.studyAccountId,
    fromDayKey,
    toDayKey,
    at: now ?? Date.now(),
  });
  return { status: 'submitted', pseudonym, contributionVersion: result.enrolment.contributionVersion };
}

/**
 * Records the window an ACCEPTED submission carried, on the pin it was sent
 * under.
 *
 * Called from exactly one place — the last statement of {@link
 * submitContribution}, after every refusal has returned. It is exported for
 * naming and testing, not as a second entry point: a caller that reached for
 * this directly would be claiming a submission it did not make.
 *
 * A missing pin writes NOTHING and is not an error: the person withdrew while
 * the push was in flight, and re-creating the row would undo that withdrawal
 * on this device.
 */
export async function recordSubmittedWindow({
  compartment,
  studyAccountId,
  fromDayKey,
  toDayKey,
  at,
}: {
  compartment: ContributionCompartment;
  studyAccountId: number;
  fromDayKey: string;
  toDayKey: string;
  at: number;
}): Promise<void> {
  const pinned = await compartment.getEnrolment(studyAccountId);
  if (pinned === null) return;
  await compartment.writeEnrolment({ ...pinned, lastSubmission: { fromDayKey, toDayKey, at } });
}
