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
 * @returns the outcome, including the pseudonym this person presents to this study — the one identifier the study will ever see.
 */
export async function submitContribution({
  transport,
  enrolment,
  pseudonymRoot,
  snapshot,
  fromDayKey,
  toDayKey,
}: {
  transport: ContributorTransport;
  enrolment: LocalStudyEnrolment;
  pseudonymRoot: Uint8Array;
  snapshot: LocalStoreSnapshot;
  fromDayKey: string;
  toDayKey: string;
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
  if (result.status === 'not-found') return { status: 'unknown-study' };
  if (result.status === 'too-large') return { status: 'too-large' };
  if (result.status === 'conflict') return { status: 'conflict', currentVersion: result.currentVersion };
  return { status: 'submitted', pseudonym, contributionVersion: result.enrolment.contributionVersion };
}
