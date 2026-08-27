/**
 * THE ENROLMENT CEREMONY (M161/03, `openplate-sync` ADR-0003 prohibitions 3
 * and 4).
 *
 * Two refusals, and both are tested by asserting that NOTHING WAS WRITTEN —
 * not merely that a status came back. A ceremony that returned
 * `compartment-missing` after minting a root would satisfy a status-only
 * assertion and would still have created the unstable identity prohibition 4
 * exists to prevent, so the fake compartment below records every call.
 *
 * The compartment is injected, which is what makes all of this answerable in a
 * test with no IndexedDB and no sync session.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { LocalResearchIdentity, LocalStudyEnrolment } from '../../app/lib/local-store/schema';
import { runEnrolmentCeremony, type EnrolmentCompartment } from '../../app/lib/sync/research/enrolment';
import { deriveStudyPseudonym, generatePseudonymRoot } from '../../app/lib/sync/research/pseudonym';
import { generateEciesKeyPair } from '../../app/lib/sync/engine/crypto/ecies';
import {
  shareFingerprintDisplay,
  shareKeyFingerprint,
} from '../../app/lib/sync/engine/crypto/share-wrap';
import { base64ToBytes, bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';

const STUDY_ACCOUNT_ID = 4_242;
const NOW = 1_756_000_000_000;

/** A compartment that records every write, so "did this refusal write anything?" is one array away. */
interface RecordingCompartment extends EnrolmentCompartment {
  writtenIdentities: LocalResearchIdentity[];
  writtenEnrolments: LocalStudyEnrolment[];
}

function recordingCompartment(
  { researchIdentity, enrolments }: { researchIdentity: LocalResearchIdentity | null; enrolments: LocalStudyEnrolment[] } = {
    researchIdentity: null,
    enrolments: [],
  },
): RecordingCompartment {
  const writtenIdentities: LocalResearchIdentity[] = [];
  const writtenEnrolments: LocalStudyEnrolment[] = [];
  return {
    researchIdentity,
    enrolments,
    writtenIdentities,
    writtenEnrolments,
    async writeIdentity(identity) {
      writtenIdentities.push(identity);
    },
    async writeEnrolment(enrolment) {
      writtenEnrolments.push(enrolment);
    },
  };
}

describe('the enrolment ceremony', () => {
  it('cannot enrol without a compartment, and writes nothing at all', async () => {
    const study = await generateEciesKeyPair();
    // The fingerprint is CORRECT here on purpose: the refusal must come from
    // the missing compartment, not from a typo, or this test would pass for
    // the wrong reason.
    const typedFingerprint = shareFingerprintDisplay(await shareKeyFingerprint(study.publicKeyRaw));

    const result = await runEnrolmentCeremony({
      studyAccountId: STUDY_ACCOUNT_ID,
      studyPublicKeyRaw: study.publicKeyRaw,
      typedFingerprint,
      compartment: null,
      now: NOW,
    });

    assert.deepEqual(result, { status: 'compartment-missing' });

    // POSITIVE control: the very same call WITH a compartment enrols. Without
    // this, the refusal above would also be satisfied by a ceremony that never
    // works at all.
    const compartment = recordingCompartment();
    const enrolled = await runEnrolmentCeremony({
      studyAccountId: STUDY_ACCOUNT_ID,
      studyPublicKeyRaw: study.publicKeyRaw,
      typedFingerprint,
      compartment,
      now: NOW,
    });
    assert.equal(enrolled.status, 'enrolled');
    assert.equal(compartment.writtenIdentities.length, 1);
    assert.equal(compartment.writtenEnrolments.length, 1);
  });

  it('enrolment pins the study key and derives the pseudonym from the compartment root', async () => {
    const study = await generateEciesKeyPair();
    const compartment = recordingCompartment();

    const result = await runEnrolmentCeremony({
      studyAccountId: STUDY_ACCOUNT_ID,
      studyPublicKeyRaw: study.publicKeyRaw,
      // Typed with different grouping and case, as a person re-typing a
      // printed value actually does. The VALUE is what matters.
      typedFingerprint: shareFingerprintDisplay(await shareKeyFingerprint(study.publicKeyRaw))
        .toLowerCase()
        .replaceAll('-', ' '),
      compartment,
      label: 'Charité sleep trial',
      now: NOW,
    });

    // The root was minted here, and the pseudonym returned is the one that
    // root derives for this study — computed independently below.
    const identity = compartment.writtenIdentities[0];
    assert.ok(identity !== undefined);
    assert.equal(base64ToBytes(identity.pseudonymRoot).byteLength, 32);
    assert.deepEqual(result, {
      status: 'enrolled',
      pseudonym: await deriveStudyPseudonym({
        root: base64ToBytes(identity.pseudonymRoot),
        studyAccountId: STUDY_ACCOUNT_ID,
      }),
    });

    // The pin records the ceremony, and stores NEITHER a fingerprint NOR a
    // pseudonym — both are recomputable, and a stored copy can drift from the
    // thing it claims to describe.
    assert.deepEqual(compartment.writtenEnrolments, [
      {
        id: String(STUDY_ACCOUNT_ID),
        studyAccountId: STUDY_ACCOUNT_ID,
        publicKeyRaw: bytesToBase64(study.publicKeyRaw),
        label: 'Charité sleep trial',
        createdAt: NOW,
      },
    ]);
  });

  it('enrolment refuses a mismatched typed fingerprint, and reuses an existing root', async () => {
    const study = await generateEciesKeyPair();
    const substituted = await generateEciesKeyPair();
    const compartment = recordingCompartment();

    // The substitution attack: the key that arrived is not the one the consent
    // materials describe. Nothing may be pinned, and no pseudonym derived.
    const mismatch = await runEnrolmentCeremony({
      studyAccountId: STUDY_ACCOUNT_ID,
      studyPublicKeyRaw: substituted.publicKeyRaw,
      typedFingerprint: shareFingerprintDisplay(await shareKeyFingerprint(study.publicKeyRaw)),
      compartment,
      now: NOW,
    });
    assert.deepEqual(mismatch, { status: 'fingerprint-mismatch' });
    assert.deepEqual(compartment.writtenIdentities, []);
    assert.deepEqual(compartment.writtenEnrolments, []);

    // A SECOND study reuses the FIRST root. A fresh root would give every
    // study this person already contributes to a new pseudonym, which a
    // researcher reads as a second participant with no history.
    const root = generatePseudonymRoot();
    const existing: LocalResearchIdentity = { pseudonymRoot: bytesToBase64(root), createdAt: 1 };
    const rooted = recordingCompartment({ researchIdentity: existing, enrolments: [] });
    const second = await runEnrolmentCeremony({
      studyAccountId: 99,
      studyPublicKeyRaw: study.publicKeyRaw,
      typedFingerprint: shareFingerprintDisplay(await shareKeyFingerprint(study.publicKeyRaw)),
      compartment: rooted,
      now: NOW,
    });
    assert.deepEqual(rooted.writtenIdentities, [], 'an existing root must never be overwritten');
    assert.deepEqual(second, {
      status: 'enrolled',
      pseudonym: await deriveStudyPseudonym({ root, studyAccountId: 99 }),
    });
  });
});
