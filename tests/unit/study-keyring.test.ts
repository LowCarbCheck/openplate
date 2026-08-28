/**
 * THE STUDY KEYRING KEEPS EVERY GENERATION (M163/03, `openplate-sync`
 * ADR-0003).
 *
 * `study.ts` reports a contribution un-openable only after EVERY key it was
 * given has failed its tag check. So a console that kept only the newest
 * generation would not fail loudly on a rotation — it would report the whole
 * back catalogue as `unopenableCount`, and the cohort would shrink with
 * nothing erroring anywhere. That is the defect these tests exist to catch.
 *
 * The seal-and-open round trip below is not decoration either. The keyring
 * lives NESTED inside the compartment ciphertext, and a compartment plaintext
 * is zod-parsed on the way out — so a field that survives an in-memory
 * assertion can still be stripped on a real open (the M163/01 finding). The
 * only honest assertion is after a genuine seal and a genuine open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateCdk, wrapCdk } from '../../app/lib/sync/engine/crypto/private-store';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { openStudyRegion, sealStudyRegion } from '../../app/lib/sync/research/study-compartment';
import {
  currentStudyPublicKey,
  EMPTY_STUDY_PRIVATE_REGION,
  generateStudyKeyGeneration,
  studyKeyPairsOf,
  withNewStudyKeyGeneration,
} from '../../app/lib/sync/research/study-keyring';

const STUDY_ACCOUNT_ID = 4711;

/** A compartment session with both halves in hand — what a study console holds after establishing or opening one. */
async function establishedSession() {
  const cdk = generateCdk();
  const kek = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  return {
    accountId: STUDY_ACCOUNT_ID,
    passphraseKek: kek,
    cdk,
    wraps: {
      cdkWrapPassphrase: bytesToBase64(await wrapCdk({ cdk, kek })),
      cdkWrapRecovery: bytesToBase64(await wrapCdk({ cdk, kek })),
    },
  };
}

test('a new generation is added, never replacing', async () => {
  const first = await generateStudyKeyGeneration({ now: () => 1_000 });
  const second = await generateStudyKeyGeneration({ now: () => 2_000 });

  const afterFirst = withNewStudyKeyGeneration({ region: EMPTY_STUDY_PRIVATE_REGION, generation: first });
  const afterSecond = withNewStudyKeyGeneration({ region: afterFirst, generation: second });

  // Both generations are held, oldest first.
  assert.equal(afterSecond.studyKeyring.length, 2);
  assert.deepEqual(afterSecond.studyKeyring[0], first);
  assert.deepEqual(afterSecond.studyKeyring[1], second);

  // And both reach the cohort opener, which is the whole reason to keep them:
  // a rotated study's older contributions only open under the older key.
  const pairs = studyKeyPairsOf(afterSecond);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0]?.publicKeyRaw, studyKeyPairsOf(afterFirst)[0]?.publicKeyRaw);

  // The fingerprint is taken of the NEWEST — that is the key a consent
  // document being printed today should name.
  assert.deepEqual(currentStudyPublicKey(afterSecond), pairs[1]?.publicKeyRaw);

  // The region it started from is untouched: nothing here mutates a keyring.
  assert.equal(EMPTY_STUDY_PRIVATE_REGION.studyKeyring.length, 0);
  assert.equal(afterFirst.studyKeyring.length, 1);
});

test('the keyring survives a real compartment seal and open', async () => {
  const session = await establishedSession();
  const generation = await generateStudyKeyGeneration({ now: () => 3_000 });
  const region = withNewStudyKeyGeneration({ region: EMPTY_STUDY_PRIVATE_REGION, generation });

  const sealed = await sealStudyRegion({ session, region });
  assert.notEqual(sealed, null, 'an established session sealed nothing');

  // A fresh session, as a second device would have: no CDK, only slot 1.
  const opened = await openStudyRegion({
    session: { accountId: STUDY_ACCOUNT_ID, passphraseKek: session.passphraseKek, cdk: null, wraps: null },
    sealed,
  });
  assert.deepEqual(opened, region);
});

test('a study compartment cannot be opened as another account', async () => {
  const session = await establishedSession();
  const region = withNewStudyKeyGeneration({
    region: EMPTY_STUDY_PRIVATE_REGION,
    generation: await generateStudyKeyGeneration({ now: () => 4_000 }),
  });
  const sealed = await sealStudyRegion({ session, region });

  // The AAD binds the account id, so a compartment spliced into another
  // account's blob is a tag failure and not a misattributed keyring.
  const opened = await openStudyRegion({
    session: { accountId: STUDY_ACCOUNT_ID + 1, passphraseKek: session.passphraseKek, cdk: null, wraps: null },
    sealed,
  });
  assert.equal(opened, null);
});
