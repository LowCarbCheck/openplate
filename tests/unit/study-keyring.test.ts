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

import {
  generateCdk,
  openPrivateStore,
  sealPrivateStore,
  wrapCdk,
} from '../../app/lib/sync/engine/crypto/private-store';
import { base64ToBytes, bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import {
  openStudyRegion,
  sealStudyRegion,
  type StudyCompartmentSession,
} from '../../app/lib/sync/research/study-compartment';
import { WrongCompartmentKindError } from '../../app/lib/sync/compartment-kind';
import { openOwnerPrivateRegion, sealOwnerPrivateRegion } from '../../app/lib/sync/private-store';
import { EMPTY_OWNER_PRIVATE_REGION } from '../../app/lib/sync/snapshot-partition';
import {
  currentStudyPublicKey,
  EMPTY_STUDY_PRIVATE_REGION,
  generateStudyKeyGeneration,
  studyKeyPairsOf,
  withNewStudyKeyGeneration,
} from '../../app/lib/sync/research/study-keyring';

const STUDY_ACCOUNT_ID = 4711;

/** A diary's own share private key — the material a wrong-kind mint would have sealed over. */
const SHARE_KEY_MARKER = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg';

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
    extras: {},
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
  assert.ok(sealed !== null, 'an established session sealed nothing');

  // A fresh session, as a second device would have: no CDK, only slot 1.
  const opened = await openStudyRegion({
    session: {
      accountId: STUDY_ACCOUNT_ID,
      passphraseKek: session.passphraseKek,
      cdk: null,
      wraps: null,
      extras: {},
      pulled: null,
    },
    sealed,
  });
  assert.deepEqual(opened, region);

  // AND THE SEAL WROTE THE TAG (M164/02). Asserted on the RAW plaintext, since
  // the region schema strips it on the way out — an open can never see it, so
  // without this line nothing would notice the study seal going untagged. The
  // sniff would keep such a compartment readable, which is precisely why its
  // absence would otherwise be invisible.
  const plaintext = await openPrivateStore({
    cdk: session.cdk,
    ciphertext: base64ToBytes(sealed.ciphertext),
    accountId: STUDY_ACCOUNT_ID,
  });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), { ...region, kind: 'study' });
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
      extras: {},
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
  const stranger = {
    accountId: STUDY_ACCOUNT_ID,
    passphraseKek: strangerKek,
    cdk: null,
    wraps: null,
    extras: {},
    pulled: null,
  };
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
  const fresh = {
    accountId: STUDY_ACCOUNT_ID,
    passphraseKek: strangerKek,
    cdk: null,
    wraps: null,
    extras: {},
    pulled: null,
  };
  assert.equal(await openStudyRegion({ session: fresh, sealed: null }), null);
  assert.equal(await sealStudyRegion({ session: fresh, region: EMPTY_STUDY_PRIVATE_REGION }), null);
});

/**
 * A COMPARTMENT CARRIES ITS KIND (M164/02) — the study side of the twin.
 *
 * This is the REACHABLE direction. `/study` is an open route, so a researcher
 * who types her own diary address into it signs in perfectly well: the address
 * is hers, the passphrase is hers, slot 1 unwraps and the AAD binds the right
 * account. Before M164/02 the console then read her diary compartment as an
 * empty keyring, and the next mint sealed `{studyKeyring:[…]}` over her share
 * private key, her pseudonym root and every study she had joined.
 */
test('a diary compartment is not an empty study, and is refused', async () => {
  const session = await establishedSession();
  const diaryCompartment = await sealOwnerPrivateRegion({
    session: { ...session, cache: null },
    region: {
      ...EMPTY_OWNER_PRIVATE_REGION,
      shareIdentity: { publicKeyRaw: 'a-public-key', privateKeyPkcs8: SHARE_KEY_MARKER, createdAt: 6_000 },
    },
  });
  assert.ok(diaryCompartment !== null, 'the fixture must carry a real diary compartment');

  // The console, holding the very key that opens it.
  const researcherConsole = {
    accountId: STUDY_ACCOUNT_ID,
    passphraseKek: session.passphraseKek,
    cdk: null,
    wraps: null,
    extras: {},
    pulled: null,
  };
  await assert.rejects(
    () => openStudyRegion({ session: researcherConsole, sealed: diaryCompartment }),
    // `cause`, because that is what a rejection handler receives — and the
    // predicate asserts the TYPE, not the message.
    (cause: unknown) => {
      assert.ok(cause instanceof WrongCompartmentKindError, 'a wrong kind must be a named error, not a bare one');
      assert.equal(cause.expected, 'study');
      assert.equal(cause.actual, 'diary');
      return true;
    },
  );

  // NON-VACUITY: the same bytes open on the side they belong to, so the
  // refusal is about what the plaintext IS and not about the crypto — which is
  // exactly why nothing before this could see the mistake.
  const opened = await openOwnerPrivateRegion({
    session: {
      accountId: STUDY_ACCOUNT_ID,
      passphraseKek: session.passphraseKek,
      cdk: null,
      wraps: null,
      cache: null,
      extras: {},
      pulled: null,
    },
    sealed: diaryCompartment,
  });
  assert.equal(opened?.shareIdentity?.privateKeyPkcs8, SHARE_KEY_MARKER);
});

/**
 * The sniff, and why it is not padding: `/study` has been an unconditional
 * route since M163/03, so an untagged study compartment can already exist —
 * and the service is zero-knowledge, so nobody can look on the server and
 * check. Without this, such a study is locked out of its own keyring.
 */
test('an untagged compartment carrying a keyring still opens as a study', async () => {
  const session = await establishedSession();
  const generation = await generateStudyKeyGeneration({ now: () => 7_000 });
  // Sealed WITHOUT the tag, as every console before M164/02 wrote one. The
  // seal cannot produce these bytes any more, so this is the only place the
  // pre-tag shape still exists.
  const json = JSON.stringify({ studyKeyring: [generation] });
  assert.ok(!json.includes('"kind"'), 'the fixture must be untagged, or it proves nothing');
  const ciphertext = await sealPrivateStore({
    cdk: session.cdk,
    plaintext: new TextEncoder().encode(json),
    accountId: STUDY_ACCOUNT_ID,
  });

  const opened = await openStudyRegion({
    session: {
      accountId: STUDY_ACCOUNT_ID,
      passphraseKek: session.passphraseKek,
      cdk: null,
      wraps: null,
      extras: {},
      pulled: null,
    },
    sealed: { ciphertext: bytesToBase64(ciphertext), ...session.wraps },
  });
  // Not "did not throw": the generation itself is read back, because a lockout
  // and an empty keyring look identical from a truthy assertion.
  assert.deepEqual(opened?.studyKeyring, [generation]);
});

/**
 * A KEY THIS BUILD DOES NOT KNOW SURVIVES A ROUND TRIP (M164/03) — the study
 * side of the twin.
 *
 * `studyPrivateRegionSchema` strips what it does not list, exactly as the
 * diary's does, and a field a NEWER console added is one this build cannot
 * list. Two consoles on either side of a release is an ordinary state, and
 * without preservation the older one deletes the newer one's field on its next
 * mint.
 *
 * The assertion is on the RAW plaintext for the same reason the tag's is: no
 * open in this repo can return a key no schema here mentions, so an open-based
 * assertion could not tell survival from loss.
 */
test('an unknown key survives the study compartment round trip', async () => {
  const session = await establishedSession();
  const futureKey = 'studyRelayRoster';
  const futureValue = { members: ['a', 'b'], rotatedAt: 12_000 };

  // A compartment as a NEWER console wrote it: a keyring, the tag, and one key
  // this build has never heard of.
  const first = await generateStudyKeyGeneration({ now: () => 8_000 });
  const ciphertext = await sealPrivateStore({
    cdk: session.cdk,
    plaintext: new TextEncoder().encode(
      JSON.stringify({ studyKeyring: [first], kind: 'study', [futureKey]: futureValue }),
    ),
    accountId: STUDY_ACCOUNT_ID,
  });
  const fromNewerConsole = { ciphertext: bytesToBase64(ciphertext), ...session.wraps };

  // A second researcher's console, with no CDK of its own — the ordinary
  // second device.
  const researcherConsole: StudyCompartmentSession = {
    accountId: STUDY_ACCOUNT_ID,
    passphraseKek: session.passphraseKek,
    cdk: null,
    wraps: null,
    extras: {},
    pulled: null,
  };
  const opened = await openStudyRegion({ session: researcherConsole, sealed: fromNewerConsole });
  assert.ok(opened !== null, 'the fixture must open, or nothing below is a statement');
  assert.equal(opened.studyKeyring.length, 1);
  assert.ok(!Object.keys(opened).includes(futureKey), 'an extra must not ride out inside the region');

  // NON-VACUITY: the unknown key was carried onto the session, ready for the
  // seal. Without this the survival below could be an accident of the fixture.
  assert.deepEqual(researcherConsole.extras[futureKey], futureValue);

  // A MINT — a genuinely different region, so these are new bytes and not the
  // ones that were pulled.
  const second = await generateStudyKeyGeneration({ now: () => 9_000 });
  const resealed = await sealStudyRegion({
    session: researcherConsole,
    region: withNewStudyKeyGeneration({ region: opened, generation: second }),
  });
  assert.ok(resealed !== null);
  assert.notEqual(resealed.ciphertext, fromNewerConsole.ciphertext, 'the mint must produce new bytes');

  // STILL THERE, STILL EQUAL — and beside it the keyring this console did
  // understand, now two generations long.
  const plaintext = await openPrivateStore({
    cdk: session.cdk,
    ciphertext: base64ToBytes(resealed.ciphertext),
    accountId: STUDY_ACCOUNT_ID,
  });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), {
    [futureKey]: futureValue,
    kind: 'study',
    studyKeyring: [first, second],
  });
});
