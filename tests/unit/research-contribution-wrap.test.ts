/**
 * THE RESEARCH CONTRIBUTION ENVELOPE (M161/03, `PROTOCOL.md` §3.5,
 * `openplate-sync` ADR-0003).
 *
 * The round-trip on its own is a weak test: a seal and an open that both used
 * the WRONG HKDF label would pass it, and the two clients would then disagree
 * with every other implementation of §3.5 while looking perfectly healthy. So
 * the label is pinned from OUTSIDE the module — the study side here derives
 * its KEK straight from `ecies.ts`, once under the research label (which must
 * open the body) and once under the share label (which must not).
 *
 * The AAD is pinned the same way: every field is varied one at a time, because
 * an AAD that bound only some of its fields would still round-trip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContributionAad,
  ContributionOpenError,
  openContribution,
  sealContribution,
} from '../../app/lib/sync/research/contribution-wrap';
import {
  deriveEciesRecipientKek,
  ECIES_PUBLIC_KEY_BYTES,
  generateEciesKeyPair,
  importEciesPrivateKey,
} from '../../app/lib/sync/engine/crypto/ecies';
import { HKDF_INFO } from '../../app/lib/sync/engine/crypto/hkdf';
import { aesGcmDecrypt, AES_GCM_IV_BYTES, splitIvAndCiphertext } from '../../app/lib/sync/engine/crypto/aes-gcm';
import { DAILY_INTAKE_V1 } from '../../app/lib/sync/research/tiers';

const STUDY_ACCOUNT_ID = 7;
const PSEUDONYM = '1YYFSZXRK6DTYM03TZ22VR1M9M';
const CONTRIBUTION_VERSION = 3;

/** A payload that looks like what the reducer actually produces, so a leak of it would be recognisable. */
const PAYLOAD = new TextEncoder().encode(
  JSON.stringify([{ date: '2026-08-24', energyKcal: 120, proteinG: 0.3, carbsG: 41, fatG: 1, fiberG: 4, loggedEntryCount: 2 }]),
);

/** The GCM tag's 16 bytes, which the body length below has to account for. */
const GCM_TAG_BYTES = 16;

describe('a research contribution', () => {
  it('contribution round-trips to the study key, under the RESEARCH label and no other', async () => {
    const study = await generateEciesKeyPair();
    const aadFields = {
      studyAccountId: STUDY_ACCOUNT_ID,
      pseudonym: PSEUDONYM,
      contributionVersion: CONTRIBUTION_VERSION,
      schemaTier: DAILY_INTAKE_V1,
      studyPublicKeyRaw: study.publicKeyRaw,
    };

    const body = await sealContribution({ payload: PAYLOAD, ...aadFields });

    // Structure: `ephPub(65) || iv(12) || ciphertext+tag`.
    assert.equal(body.byteLength, ECIES_PUBLIC_KEY_BYTES + AES_GCM_IV_BYTES + PAYLOAD.byteLength + GCM_TAG_BYTES);
    assert.equal(body[0], 0x04, 'the leading 65 bytes must be an uncompressed SEC1 point');

    // POSITIVE: the study opens it. Without this the refusals below would also
    // pass on a body that opened for nobody.
    const privateKey = await importEciesPrivateKey(study.privateKeyPkcs8);
    const aad = await buildContributionAad(aadFields);
    assert.deepEqual(await openContribution({ body, privateKey, aad }), PAYLOAD);

    // THE LABEL IS PINNED FROM OUTSIDE THE MODULE. Deriving the KEK here, under
    // the research label, decrypts the body — so `contribution-wrap.ts` really
    // did seal under `openplate-sync:research-kek:p256:v1` and not under some
    // other branch it also opens with.
    const { iv, ciphertext } = splitIvAndCiphertext(body.slice(ECIES_PUBLIC_KEY_BYTES));
    const ephemeralPublicKeyRaw = body.slice(0, ECIES_PUBLIC_KEY_BYTES);
    const researchKek = await deriveEciesRecipientKek({
      ephemeralPublicKeyRaw,
      privateKey,
      info: HKDF_INFO.RESEARCH_KEK,
    });
    // `.catch(() => null)` so a wrong label fails as THIS named assertion
    // rather than as a bare WebCrypto `OperationError` with no explanation.
    const underResearchLabel = await aesGcmDecrypt({ key: researchKek, iv, ciphertext, additionalData: aad }).catch(
      () => null,
    );
    assert.deepEqual(
      underResearchLabel,
      PAYLOAD,
      'the body was not sealed under openplate-sync:research-kek:p256:v1',
    );

    // And the SHARE label does not open it. The two constructions are
    // identical apart from this string, so nothing else distinguishes them.
    const shareKek = await deriveEciesRecipientKek({ ephemeralPublicKeyRaw, privateKey, info: HKDF_INFO.SHARE_KEK });
    await assert.rejects(() => aesGcmDecrypt({ key: shareKek, iv, ciphertext, additionalData: aad }));

    // The payload is not sitting in the body in the clear.
    assert.equal(new TextDecoder().decode(body).includes('energyKcal'), false);

    // A fresh ephemeral key per contribution: the same payload sealed twice is
    // two different bodies, so a server cannot tell a re-push from a repeat.
    assert.notDeepEqual(await sealContribution({ payload: PAYLOAD, ...aadFields }), body);
  });

  it('contribution fails under a wrong AAD, field by field, and refuses a malformed body', async () => {
    const study = await generateEciesKeyPair();
    const privateKey = await importEciesPrivateKey(study.privateKeyPkcs8);
    const aadFields = {
      studyAccountId: STUDY_ACCOUNT_ID,
      pseudonym: PSEUDONYM,
      contributionVersion: CONTRIBUTION_VERSION,
      schemaTier: DAILY_INTAKE_V1,
      studyPublicKeyRaw: study.publicKeyRaw,
    };
    const body = await sealContribution({ payload: PAYLOAD, ...aadFields });

    // EVERY field is bound, checked one at a time — an AAD that bound only
    // some of them would still round-trip and would still be spliceable.
    const wrongAads = [
      { ...aadFields, studyAccountId: STUDY_ACCOUNT_ID + 1 },
      { ...aadFields, pseudonym: `${PSEUDONYM.slice(0, 25)}1` },
      { ...aadFields, contributionVersion: CONTRIBUTION_VERSION + 1 },
      { ...aadFields, schemaTier: 'daily-intake:v2' },
      { ...aadFields, studyPublicKeyRaw: (await generateEciesKeyPair()).publicKeyRaw },
    ];
    for (const fields of wrongAads) {
      const aad = await buildContributionAad(fields);
      await assert.rejects(
        () => openContribution({ body, privateKey, aad }),
        (error: Error) => error instanceof ContributionOpenError && error.reason === 'unopenable',
      );
    }

    // ANOTHER STUDY'S KEY is the same outcome, and deliberately not a
    // distinguishable one: a tag check does not say why it failed, so a study
    // client holding an older key pair must read `unopenable` as "try the next
    // key I hold", never as "this contribution is corrupt".
    const otherStudy = await generateEciesKeyPair();
    const otherPrivateKey = await importEciesPrivateKey(otherStudy.privateKeyPkcs8);
    const rightAad = await buildContributionAad(aadFields);
    await assert.rejects(
      () => openContribution({ body, privateKey: otherPrivateKey, aad: rightAad }),
      (error: Error) => error instanceof ContributionOpenError && error.reason === 'unopenable',
    );

    // A STRUCTURAL failure IS distinguishable, and is the only thing that is.
    await assert.rejects(
      () => openContribution({ body: body.slice(0, 40), privateKey, aad: rightAad }),
      (error: Error) => error instanceof ContributionOpenError && error.reason === 'malformed',
    );

    // The AAD carries NO ACCOUNT ID — §5.16's `grantorAccountId` is exactly
    // what must not be imported here (ADR-0003 prohibition 2).
    const aadText = new TextDecoder().decode(rightAad);
    assert.equal(aadText.includes('AccountId'), true, 'the study account id is bound');
    assert.equal(aadText.includes('grantorAccountId'), false);
    assert.equal(aadText.includes('contributorAccountId'), false);
    assert.equal(
      aadText.startsWith('{"studyAccountId":7,"pseudonym":'),
      true,
      'the AAD is canonical fixed-key-order JSON',
    );
  });
});
