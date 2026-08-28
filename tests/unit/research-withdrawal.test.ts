/**
 * WITHDRAWAL (M161/05, `openplate-sync` PROTOCOL.md §5.18, ADR-0003).
 *
 * Three claims, and each one is a thing that goes wrong quietly:
 *
 *  1. The pin is dropped only AFTER the service answered, and only on a
 *     success. A pin dropped against a live server row is a contribution
 *     nobody can withdraw — the endpoint is addressed by the study id, and the
 *     pin is the only record on this device that the study exists.
 *  2. Withdrawing twice is fine. §5.18 is idempotent on the service, and the
 *     second call from a device that has already forgotten the study must not
 *     throw at anyone.
 *  3. Re-enrolling presents the SAME pseudonym. Withdrawal does not mint a new
 *     root, and that is a disclosure rather than a footnote: a researcher who
 *     kept a copy she was told to purge could link the two series. The test is
 *     here so nobody "fixes" it into a fresh root, which would re-pseudonymise
 *     the person in every OTHER study they contribute to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LocalResearchIdentity, LocalStudyEnrolment } from '../../app/lib/local-store/schema';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { generateEciesKeyPair } from '../../app/lib/sync/engine/crypto/ecies';
import { shareKeyFingerprint } from '../../app/lib/sync/engine/crypto/share-wrap';
import { runEnrolmentCeremony, type EnrolmentCompartment } from '../../app/lib/sync/research/enrolment';
import { generatePseudonymRoot } from '../../app/lib/sync/research/pseudonym';
import { withdrawFromStudy, type WithdrawalCompartment } from '../../app/lib/sync/research/withdraw';
import type { WithdrawContributionResult } from '../../app/lib/sync/engine/client/http-client';

const STUDY_ACCOUNT_ID = 7;

/** A compartment that records every delete, so "was the pin dropped?" is one array length. */
function compartment(): WithdrawalCompartment & { deleted: number[] } {
  const deleted: number[] = [];
  return { deleted, deleteEnrolment: async (studyAccountId) => void deleted.push(studyAccountId) };
}

test('withdrawal drops the enrolment pin, and only after the service answered', async () => {
  const store = compartment();
  const calls: number[] = [];
  const result = await withdrawFromStudy({
    transport: {
      withdrawContribution: async (studyAccountId): Promise<WithdrawContributionResult> => {
        calls.push(studyAccountId);
        // The ORDER is the guarantee: at the moment the wire call runs, the
        // pin must still be there. A pin dropped first survives no failure.
        assert.deepEqual(store.deleted, [], 'the pin must still exist while the withdrawal is in flight');
        return { status: 'withdrawn' };
      },
    },
    compartment: store,
    studyAccountId: STUDY_ACCOUNT_ID,
  });

  assert.deepEqual(result, { status: 'withdrawn' });
  assert.deepEqual(calls, [STUDY_ACCOUNT_ID], 'the DELETE is addressed by the study account id');
  assert.deepEqual(store.deleted, [STUDY_ACCOUNT_ID], 'the pin is dropped on a 204');
});

test('withdrawal keeps the enrolment when withdrawal fails', async () => {
  // Case 1: the transport threw — offline, a 401, a 5xx. The pin is what makes
  // a retry possible at all.
  const thrown = compartment();
  await assert.rejects(
    withdrawFromStudy({
      transport: {
        withdrawContribution: async (): Promise<WithdrawContributionResult> => {
          throw new Error('network down');
        },
      },
      compartment: thrown,
      studyAccountId: STUDY_ACCOUNT_ID,
    }),
  );
  assert.deepEqual(thrown.deleted, [], 'a thrown withdrawal must leave the pin so the person can try again');

  // Case 2: the lane is dark, so the service answered 404 and withdrew
  // NOTHING. This is the case a "did it not throw?" check gets wrong: a
  // deployment whose research lane was switched off answers the same 404 over
  // rows that are still in its database.
  const dark = compartment();
  const result = await withdrawFromStudy({
    transport: { withdrawContribution: async (): Promise<WithdrawContributionResult> => ({ status: 'unavailable' }) },
    compartment: dark,
    studyAccountId: STUDY_ACCOUNT_ID,
  });
  assert.deepEqual(result, { status: 'unavailable' });
  assert.deepEqual(dark.deleted, [], 'a dark lane withdrew nothing, so the pin must survive it');
});

test('withdrawing twice is idempotent from the client side', async () => {
  const store = compartment();
  const transport = {
    // §5.18 is idempotent on the service: the row is already gone and the
    // tombstone is already there, so the second call answers 204 as well.
    withdrawContribution: async (): Promise<WithdrawContributionResult> => ({ status: 'withdrawn' }),
  };

  const first = await withdrawFromStudy({ transport, compartment: store, studyAccountId: STUDY_ACCOUNT_ID });
  const second = await withdrawFromStudy({ transport, compartment: store, studyAccountId: STUDY_ACCOUNT_ID });

  assert.deepEqual(first, { status: 'withdrawn' });
  assert.deepEqual(second, { status: 'withdrawn' }, 'a second withdrawal is a normal outcome, never an error');
  assert.deepEqual(
    store.deleted,
    [STUDY_ACCOUNT_ID, STUDY_ACCOUNT_ID],
    'deleting an absent pin is a no-op, not a throw',
  );
});

test('re-enrolling presents the same pseudonym after a withdrawal', async () => {
  const pair = await generateEciesKeyPair();
  const fingerprint = await shareKeyFingerprint(pair.publicKeyRaw);
  const identity: LocalResearchIdentity = { pseudonymRoot: bytesToBase64(generatePseudonymRoot()), createdAt: 1_000 };
  let enrolments: LocalStudyEnrolment[] = [];

  // ONE compartment across all three acts, because that is the point: the
  // pseudonym root lives here, and neither the withdrawal nor the second
  // ceremony is allowed to replace it.
  const compartmentView: EnrolmentCompartment = {
    researchIdentity: identity,
    get enrolments() {
      return enrolments;
    },
    writeIdentity: async () => assert.fail('an account with a root must never mint a second one'),
    writeEnrolment: async (enrolment) => void (enrolments = [...enrolments, enrolment]),
  };

  const joined = await runEnrolmentCeremony({
    studyAccountId: STUDY_ACCOUNT_ID,
    studyPublicKeyRaw: pair.publicKeyRaw,
    typedFingerprint: fingerprint,
    compartment: compartmentView,
    now: 2_000,
  });
  assert.equal(joined.status, 'enrolled');
  if (joined.status !== 'enrolled') return;

  await withdrawFromStudy({
    transport: { withdrawContribution: async (): Promise<WithdrawContributionResult> => ({ status: 'withdrawn' }) },
    compartment: {
      deleteEnrolment: async (id) => void (enrolments = enrolments.filter((row) => row.studyAccountId !== id)),
    },
    studyAccountId: STUDY_ACCOUNT_ID,
  });
  assert.deepEqual(enrolments, [], 'the pin is gone, so re-joining needs the fingerprint typed again');

  // Re-joining is a NEW consent — the fingerprint is typed again — and it
  // presents the same pseudonym, because `deriveStudyPseudonym` takes the root
  // and the study id and the pin is not an input to it.
  const rejoined = await runEnrolmentCeremony({
    studyAccountId: STUDY_ACCOUNT_ID,
    studyPublicKeyRaw: pair.publicKeyRaw,
    typedFingerprint: fingerprint,
    compartment: compartmentView,
    now: 3_000,
  });
  assert.equal(rejoined.status, 'enrolled');
  if (rejoined.status !== 'enrolled') return;
  assert.equal(
    rejoined.pseudonym,
    joined.pseudonym,
    'withdrawal must not mint a new root: a fresh one would re-pseudonymise this person in every other study too',
  );
});
