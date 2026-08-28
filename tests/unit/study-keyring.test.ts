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
    pulled: null,
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
    session: {
      accountId: STUDY_ACCOUNT_ID,
      passphraseKek: session.passphraseKek,
      cdk: null,
      wraps: null,
      pulled: null,
    },
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
    session: {
      accountId: STUDY_ACCOUNT_ID + 1,
      passphraseKek: session.passphraseKek,
      cdk: null,
      wraps: null,
      pulled: null,
    },
    sealed,
  });
  assert.equal(opened, null);
});

/**
 * M164/01. A console that cannot open the study's compartment must not be the
 * reason the study's private keys leave the blob.
 *
 * The state is ordinary: a second researcher's laptop signing in after a
 * passphrase change that landed elsewhere first. `pushStudyBlob` throws rather
 * than pushing a `null`, and that throw stays — but it is the SECOND line. The
 * first is that the seal has something true to emit, which is the bytes it
 * pulled, unchanged.
 */
test('a study compartment this console could not open is re-emitted, never blanked', async () => {
  const owner = await establishedSession();
  const region = withNewStudyKeyGeneration({
    region: EMPTY_STUDY_PRIVATE_REGION,
    generation: await generateStudyKeyGeneration({ now: () => 5_000 }),
  });
  const pulled = await sealStudyRegion({ session: owner, region });
  assert.ok(pulled !== null, 'the fixture must carry a real compartment, or nothing below is a statement');

  // A console holding a different passphrase: it pulls the compartment and
  // learns nothing from it.
  const strangerKek = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(19), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  const stranger = { accountId: STUDY_ACCOUNT_ID, passphraseKek: strangerKek, cdk: null, wraps: null, pulled: null };
  assert.equal(await openStudyRegion({ session: stranger, sealed: pulled }), null);
  assert.equal(stranger.cdk, null, 'the fixture must be a compartment this console CANNOT open');

  // What it would push. Before M164/01 this was `null`, and every generation
  // in the keyring went with it.
  const reEmitted = await sealStudyRegion({ session: stranger, region: EMPTY_STUDY_PRIVATE_REGION });
  assert.ok(reEmitted !== null, 'the seal blanked a study compartment this console merely could not open');
  assert.equal(reEmitted.ciphertext, pulled.ciphertext);
  assert.equal(reEmitted.cdkWrapPassphrase, pulled.cdkWrapPassphrase);
  assert.equal(reEmitted.cdkWrapRecovery, pulled.cdkWrapRecovery);

  // POSITIVE: the keyring is still in there, read back through the door that
  // works. "Not null" would pass on three arbitrary strings.
  assert.deepEqual(await openStudyRegion({ session: owner, sealed: reEmitted }), region);
  assert.equal(region.studyKeyring.length, 1, 'the fixture must hold a generation for that to mean anything');

  // And a console that pulled NOTHING still seals to null — the fresh study
  // account, which is the degraded state that must keep working.
  const fresh = { accountId: STUDY_ACCOUNT_ID, passphraseKek: strangerKek, cdk: null, wraps: null, pulled: null };
  assert.equal(await openStudyRegion({ session: fresh, sealed: null }), null);
  assert.equal(await sealStudyRegion({ session: fresh, region: EMPTY_STUDY_PRIVATE_REGION }), null);
});
