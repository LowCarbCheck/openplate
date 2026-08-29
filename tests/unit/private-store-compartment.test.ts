/**
 * THE SEAL MUST NEVER BLANK A COMPARTMENT IT COULD NOT OPEN (M164/01).
 *
 * `readSealedPrivateStore`'s doc comment already states the rule: a `null`
 * "would make the next push OVERWRITE the damaged compartment with an empty
 * one, destroying the account's share keys to hide a parse error". That
 * refusal stopped at the READ. This file is the same rule at the SEAL, which
 * is the hop that actually writes.
 *
 * The loss it guards is unrecoverable, and it needs no corruption to happen:
 * a fresh sign-in whose slot-1 unwrap fails leaves `cdk`/`wraps` at `null`,
 * the seal answered `null`, and the next push replaced a live compartment
 * with nothing. There is no second copy of a CDK.
 *
 * ── Why every assertion here is about BYTES ──────────────────────────────
 *
 * "The compartment survived" is not the claim. A session with no CDK cannot
 * re-seal and must not try — slot 2's KEK was never in it, so anything it
 * rebuilt would carry a recovery wrap nobody can open. The only correct
 * output is the pulled bytes, unchanged, which is why the assertions compare
 * the ciphertext and both wraps rather than "not null".
 *
 * ── And why the owner opens them again at the end ────────────────────────
 *
 * An absence assertion passes against rubbish. So each re-emission is handed
 * back to the session that established the compartment, which opens it and
 * reads the key material out. That is the difference between "something was
 * pushed" and "the account's keys are still there".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  adoptRewrappedSlots,
  createPrivateStoreSession,
  openOwnerPrivateRegion,
  sealOwnerPrivateRegion,
} from '../../app/lib/sync/private-store';
import { EMPTY_OWNER_PRIVATE_REGION, type OwnerPrivateRegion } from '../../app/lib/sync/snapshot-partition';
import {
  establishPrivateStore,
  openPrivateStore,
  sealPrivateStore,
  wrapCdk,
  type EstablishedPrivateStore,
} from '../../app/lib/sync/engine/crypto/private-store';
import {
  COMPARTMENT_KIND,
  taggedCompartmentPlaintext,
  WrongCompartmentKindError,
} from '../../app/lib/sync/compartment-kind';
import { classifySnapshotKey, partitionSnapshot, recomposeSnapshot } from '../../app/lib/sync/snapshot-partition';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup } from '../../app/lib/local-store/backup';
import { openStudyRegion, sealStudyRegion } from '../../app/lib/sync/research/study-compartment';
import type { SealedPrivateStore } from '../../app/lib/sync/snapshot-partition';
import { deriveCredentialsFromPassphrase } from '../../app/lib/sync/engine/client/derive-credentials';
import { createPassphraseKdfDescriptor } from '../../app/lib/sync/engine/client/passphrase-kek';
import { ARGON2ID_DEFAULT_PARAMS } from '../../app/lib/sync/engine/crypto/argon2';
import { derivePrivateStoreRecoveryKek } from '../../app/lib/sync/engine/client/recovery-kek';
import { base64ToBytes, bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { z } from 'zod';

const ACCOUNT_ID = 42;

/** The marker that must survive every path here: the account's own share private key. */
const PRIVATE_KEY_MARKER = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg';

/** The same, one compartment over — a study's private key, which a diary open must never read as an empty region. */
const STUDY_KEY_MARKER = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQh';

/** Argon2id stands in as a plain digest. The KDF is not what this file tests, and the real one costs seconds per call. */
async function fakeArgon2id({ passphrase, salt }: { passphrase: string; salt: Uint8Array }): Promise<Uint8Array> {
  const material = new TextEncoder().encode(`${passphrase}::${bytesToBase64(salt)}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

/** `K_pp` for a passphrase, through the REAL derivation — a wrong HKDF label here would fail these tests. */
async function privateStoreKekFor(passphrase: string): Promise<CryptoKey> {
  const descriptor = createPassphraseKdfDescriptor(new Uint8Array(16).fill(7), ARGON2ID_DEFAULT_PARAMS);
  const credentials = await deriveCredentialsFromPassphrase({ passphrase, descriptor, deriveHash: fakeArgon2id });
  return credentials.privateStoreKek;
}

/** A compartment plus the door that opens it, as the device that minted it holds them. */
async function establishedFor(passphrase: string): Promise<{
  established: EstablishedPrivateStore;
  passphraseKek: CryptoKey;
}> {
  const passphraseKek = await privateStoreKekFor(passphrase);
  const recoveryKek = await derivePrivateStoreRecoveryKek(new Uint8Array(20).fill(3));
  return { established: await establishPrivateStore({ passphraseKek, recoveryKek }), passphraseKek };
}

/** The owner-private region as a device that has generated a share key holds it. */
function regionWithShareKey(privateKeyPkcs8: string): OwnerPrivateRegion {
  return {
    ...EMPTY_OWNER_PRIVATE_REGION,
    shareIdentity: { publicKeyRaw: 'public-key', privateKeyPkcs8, createdAt: 7_000 },
  };
}

/** The established compartment's two wraps, in the shape both session types hold them. */
function wrapsOf(established: EstablishedPrivateStore) {
  return { cdkWrapPassphrase: established.cdkWrapPassphrase, cdkWrapRecovery: established.cdkWrapRecovery };
}

/**
 * A compartment sealed around an ARBITRARY plaintext, bypassing both seals.
 *
 * The only way to build an untagged compartment now that both seals tag what
 * they write — and the plaintext is returned beside the bytes so a test can
 * assert what it actually sealed rather than trusting this helper.
 */
async function sealedJson({
  established,
  json,
}: {
  established: EstablishedPrivateStore;
  json: string;
}): Promise<{ sealed: SealedPrivateStore; plaintext: string }> {
  const ciphertext = await sealPrivateStore({
    cdk: established.cdk,
    plaintext: new TextEncoder().encode(json),
    accountId: ACCOUNT_ID,
  });
  return { sealed: { ciphertext: bytesToBase64(ciphertext), ...wrapsOf(established) }, plaintext: json };
}

/**
 * The situation the whole spec is about: a live compartment on the blob, and a
 * session that pulled it and could not open it.
 *
 * The two passphrases are what make the adopt fail, and they are the ordinary
 * case rather than a contrived one — a passphrase change that landed on
 * another device first leaves exactly this state.
 */
async function sessionThatFailedToAdopt() {
  const { established, passphraseKek: ownerKek } = await establishedFor('the passphrase that minted it');
  const owner = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek: ownerKek, established });
  const pulled = await sealOwnerPrivateRegion({ session: owner, region: regionWithShareKey(PRIVATE_KEY_MARKER) });
  assert.ok(pulled !== null, 'the fixture must carry a real compartment, or nothing below is a statement');

  const session = createPrivateStoreSession({
    accountId: ACCOUNT_ID,
    passphraseKek: await privateStoreKekFor('a passphrase this session does not hold'),
  });
  const opened = await openOwnerPrivateRegion({ session, sealed: pulled });

  // NON-VACUITY: the adopt really did fail, and left the session with nothing
  // to seal with. Without this the re-emission below could be an ordinary seal.
  assert.equal(opened, null, 'the fixture must be a compartment this session CANNOT open');
  assert.equal(session.cdk, null);
  assert.equal(session.wraps, null);

  return { session, pulled, ownerKek };
}

describe('the seal after a failed adopt', () => {
  it('re-emits a compartment it could not open, instead of blanking it', async () => {
    const { session, pulled, ownerKek } = await sessionThatFailedToAdopt();

    // The push this session would make. Before the fix this was `null`, and
    // the account's key material left the blob on the next cycle.
    const sealed = await sealOwnerPrivateRegion({ session, region: EMPTY_OWNER_PRIVATE_REGION });
    assert.notEqual(sealed, null, 'the seal blanked a compartment this session merely could not open');

    // POSITIVE: the key material is still reachable through the door that
    // always worked. "Not null" alone would pass on any three strings.
    const owner = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek: ownerKek });
    const opened = await openOwnerPrivateRegion({ session: owner, sealed });
    assert.equal(opened?.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);

    // And the region this session was ASKED to seal is not what came out: it
    // holds no key that could seal it, so passing it through would be a lie.
    assert.notDeepEqual(opened, EMPTY_OWNER_PRIVATE_REGION);
    assert.deepEqual(sealed, pulled);
  });

  it('re-emits bytes byte-identical to the ones it pulled, never a rebuilt compartment', async () => {
    const { session, pulled } = await sessionThatFailedToAdopt();
    const sealed = await sealOwnerPrivateRegion({ session, region: regionWithShareKey('a-local-key-that-differs') });
    assert.ok(sealed !== null);

    // All three fields, separately: a rebuilt `SealedPrivateStore` would carry
    // the same ciphertext with wraps under a KEK this session does not hold,
    // and a `deepEqual` alone would not say which half moved.
    assert.equal(sealed.ciphertext, pulled.ciphertext);
    assert.equal(sealed.cdkWrapPassphrase, pulled.cdkWrapPassphrase);
    assert.equal(sealed.cdkWrapRecovery, pulled.cdkWrapRecovery);
  });

  it('seals to null only when the pull carried no compartment', async () => {
    // A genuinely compartment-less account: created before the partition, and
    // no device has minted one. This is the documented degraded state, and it
    // must keep working — the key material stays on the device rather than
    // being published in the clear.
    const session = createPrivateStoreSession({
      accountId: ACCOUNT_ID,
      passphraseKek: await privateStoreKekFor('any passphrase'),
    });
    assert.equal(await openOwnerPrivateRegion({ session, sealed: null }), null);
    assert.equal(await sealOwnerPrivateRegion({ session, region: EMPTY_OWNER_PRIVATE_REGION }), null);

    // NON-VACUITY, and the whole distinction this spec draws: the SAME session
    // stops answering `null` the moment a pull carries a compartment.
    const { established } = await establishedFor('the passphrase that minted it');
    const owner = createPrivateStoreSession({
      accountId: ACCOUNT_ID,
      passphraseKek: await privateStoreKekFor('the passphrase that minted it'),
      established,
    });
    const pulled = await sealOwnerPrivateRegion({ session: owner, region: regionWithShareKey(PRIVATE_KEY_MARKER) });
    assert.ok(pulled !== null);

    await openOwnerPrivateRegion({ session, sealed: pulled });
    assert.deepEqual(await sealOwnerPrivateRegion({ session, region: EMPTY_OWNER_PRIVATE_REGION }), pulled);
  });
});

/**
 * A COMPARTMENT CARRIES ITS KIND (M164/02).
 *
 * The diary's compartment and the study console's share one crypto
 * construction over two different plaintexts, and — measured, 2026-08-28 —
 * each region's schema parses the other's plaintext without throwing and
 * returns a plausible EMPTY region. Every crypto check passes on the way
 * there: slot 1 unwraps under the passphrase of whichever account signed in,
 * and the AAD binds the account id it really is.
 *
 * So these tests are not about the ciphertext. Each one seals through the
 * REAL producer and opens through the REAL consumer, because the whole defect
 * lives after the decrypt — in what the plaintext was taken to mean.
 */
describe('the compartment carries its kind', () => {
  it('a study compartment is not an empty diary, and is refused', async () => {
    const { established, passphraseKek } = await establishedFor('one passphrase, two possible accounts');
    const studyCompartment = await sealStudyRegion({
      session: {
        accountId: ACCOUNT_ID,
        passphraseKek,
        cdk: established.cdk,
        wraps: wrapsOf(established),
        extras: {},
        pulled: null,
      },
      region: { studyKeyring: [{ publicKey: 'a-public-key', privateKey: STUDY_KEY_MARKER, createdAt: 1_000 }] },
    });
    assert.ok(studyCompartment !== null, 'the fixture must carry a real study compartment');

    // The diary side, holding the very key that opens it. Before M164/02 this
    // returned `{shareIdentity:null,sharePeers:[],...}` — an empty region the
    // next push would have sealed over the study's whole keyring.
    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    await assert.rejects(
      () => openOwnerPrivateRegion({ session, sealed: studyCompartment }),
      // `cause`, because that is what a rejection handler receives — and the
      // predicate asserts the TYPE, not the message: a bare Error carrying the
      // same words would pass a message match and fail this.
      (cause: unknown) => {
        assert.ok(cause instanceof WrongCompartmentKindError, 'a wrong kind must be a named error, not a bare one');
        assert.equal(cause.expected, 'diary');
        assert.equal(cause.actual, 'study');
        return true;
      },
    );

    // NON-VACUITY, and the point of the whole spec: the refusal is NOT a
    // decrypt failure dressed up. The same bytes open perfectly on the side
    // they belong to, which is why nothing before this could see the mistake.
    const opened = await openStudyRegion({
      session: { accountId: ACCOUNT_ID, passphraseKek, cdk: null, wraps: null, extras: {}, pulled: null },
      sealed: studyCompartment,
    });
    assert.equal(opened?.studyKeyring[0]?.privateKey, STUDY_KEY_MARKER);
  });

  it('an untagged compartment opens as a diary, so no older client is locked out', async () => {
    const { established, passphraseKek } = await establishedFor('the passphrase that minted it');
    // Sealed WITHOUT the tag, exactly as every client before M164/02 wrote
    // one. The absent-tag default is the entire forward migration, and this is
    // the only test that can prove it — the seal cannot produce these bytes
    // any more.
    const untagged = await sealedJson({
      established,
      json: JSON.stringify(regionWithShareKey(PRIVATE_KEY_MARKER)),
    });
    assert.ok(!untagged.plaintext.includes('"kind"'), 'the fixture must be untagged, or it proves nothing');

    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    const opened = await openOwnerPrivateRegion({ session, sealed: untagged.sealed });
    assert.equal(opened?.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
  });

  it('a decrypt failure is still null, and never a refusal', async () => {
    // BOTH CASES HERE REACH A REAL DECRYPT ATTEMPT, and that is the whole
    // difficulty of writing this test. The obvious fixture — a session holding
    // the wrong passphrase — never gets that far: with no CDK of its own and a
    // slot-1 unwrap that fails, `candidateCdks` is EMPTY and the open returns
    // `null` without opening anything. A test built on it passes even when
    // `tryOpen` rethrows every error it sees, which is exactly what an
    // injection run proved. So each case below hands the open a CDK it will
    // actually try.
    const { established, passphraseKek } = await establishedFor('the passphrase that minted it');
    const owner = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek, established });
    const pulled = await sealOwnerPrivateRegion({ session: owner, region: regionWithShareKey(PRIVATE_KEY_MARKER) });
    assert.ok(pulled !== null);

    // Case 1: a device with a compartment OF ITS OWN, handed somebody else's.
    // Its CDK is candidate one and fails the tag check on these bytes.
    const other = await establishedFor('a device that minted its own compartment');
    const rival = createPrivateStoreSession({
      accountId: ACCOUNT_ID,
      passphraseKek: other.passphraseKek,
      established: other.established,
    });
    assert.notEqual(rival.cdk, null, 'the fixture must carry a CDK, or no decrypt is attempted at all');
    assert.equal(await openOwnerPrivateRegion({ session: rival, sealed: pulled }), null);

    // Case 2: the right door onto corrupted bytes. Slot 1 unwraps, so the CDK
    // is real and the failure is the GCM tag itself.
    const corrupted = { ...pulled, ciphertext: bytesToBase64(new Uint8Array(64).fill(9)) };
    const holder = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    assert.equal(await openOwnerPrivateRegion({ session: holder, sealed: corrupted }), null);

    // NON-VACUITY: the same session opens the INTACT bytes through the same
    // slot, so the null above is about the ciphertext and not about the door.
    const opened = await openOwnerPrivateRegion({ session: holder, sealed: pulled });
    assert.equal(opened?.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
  });
});

/**
 * A KEY THIS BUILD DOES NOT KNOW SURVIVES A ROUND TRIP (M164/03).
 *
 * `ownerPrivateRegionSchema` is a `z.object`, so it STRIPS what it does not
 * list — measured 2026-08-28: the key comes back missing and nothing throws.
 * `backup.ts:388-394` defends against that by LISTING the fields it must keep,
 * and that defence cannot work across versions: a field a NEWER build added is
 * one this build cannot list. An older device then opens the compartment, loses
 * it, and its next push writes the loss back.
 *
 * ── Why the assertions read the RAW plaintext ────────────────────────────
 *
 * The whole point of an extra is that no schema here mentions it, so no open in
 * this repo can return one — a re-seal asserted through `openOwnerPrivateRegion`
 * could not see the field whether it survived or not. So the re-sealed bytes are
 * opened by hand, with the CDK, and the assertion is on what is actually inside
 * the ciphertext.
 */

/** A field no schema in this repo mentions. It stands for whatever the NEXT release puts in the compartment. */
const FUTURE_KEY = 'clinicianRelayIdentity';

/** Nested and non-trivial on purpose: a shallow equality on a string would pass on a coincidence. */
const FUTURE_VALUE = { publicKeyRaw: 'a-key-this-build-cannot-name', rotations: [1, 2, 3], createdAt: 12_000 };

/**
 * The compartment plaintext exactly as it sits inside the ciphertext.
 *
 * `looseObject` because the keys this build does not know are the entire
 * subject — a `z.object` here would strip the very field under test and every
 * assertion below would be about the schema instead of the seal.
 */
const rawCompartmentSchema = z.looseObject({
  kind: z.string(),
  shareIdentity: z.object({ privateKeyPkcs8: z.string() }).nullable(),
});

/** A compartment as a NEWER client wrote it: this build's region, the tag, and one key from the future. */
async function compartmentFromANewerClient(established: EstablishedPrivateStore) {
  return sealedJson({
    established,
    json: JSON.stringify({
      ...regionWithShareKey(PRIVATE_KEY_MARKER),
      kind: COMPARTMENT_KIND.diary,
      [FUTURE_KEY]: FUTURE_VALUE,
    }),
  });
}

/** The plaintext inside a sealed compartment, read with the CDK and not through any region schema. */
async function readRawPlaintext({
  established,
  sealed,
}: {
  established: EstablishedPrivateStore;
  sealed: SealedPrivateStore;
}) {
  const plaintext = await openPrivateStore({
    cdk: established.cdk,
    ciphertext: base64ToBytes(sealed.ciphertext),
    accountId: ACCOUNT_ID,
  });
  return rawCompartmentSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}

describe('a key this build does not know', () => {
  it('an unknown compartment key survives a round trip', async () => {
    const { established, passphraseKek } = await establishedFor('the passphrase that minted it');
    const fromNewerClient = await compartmentFromANewerClient(established);

    // NON-VACUITY, both halves. The fixture really carries the key, and this
    // build really does not know it — `classifySnapshotKey` is the repo's own
    // list of every key anybody here has ever classified.
    assert.ok(fromNewerClient.plaintext.includes(FUTURE_KEY), 'the fixture must carry the unknown key');
    assert.throws(() => classifySnapshotKey(FUTURE_KEY), 'the key must be one no schema in this repo mentions');

    // OPEN, with the current schemas. The region comes back understood, and
    // the extra is NOT in it — it never leaves the compartment.
    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    const opened = await openOwnerPrivateRegion({ session, sealed: fromNewerClient.sealed });
    assert.ok(opened !== null);
    assert.equal(opened.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
    assert.ok(!Object.keys(opened).includes(FUTURE_KEY), 'an extra must not ride out inside the region');

    // RE-SEAL, with a CHANGED region so the seal cache cannot answer and the
    // bytes are genuinely rewritten. Re-emitting the pulled bytes would prove
    // nothing about preservation.
    const resealed = await sealOwnerPrivateRegion({
      session,
      region: {
        ...opened,
        sharePeers: [{ id: '9', accountId: 9, publicKeyRaw: 'peer-public-key', label: 'Dr. Meier', createdAt: 8_000 }],
      },
    });
    assert.ok(resealed !== null);
    assert.notEqual(
      resealed.ciphertext,
      fromNewerClient.sealed.ciphertext,
      'the re-seal must produce new bytes, or nothing here is a round trip',
    );

    // STILL THERE, AND STILL EQUAL — read out of the ciphertext by hand,
    // because no open in this repo can return a key no schema here mentions.
    const raw = await readRawPlaintext({ established, sealed: resealed });
    assert.deepEqual(raw[FUTURE_KEY], FUTURE_VALUE);

    // And the recognised half of the same bytes still opens: the preservation
    // did not come at the cost of the region.
    const secondDevice = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    const reopened = await openOwnerPrivateRegion({ session: secondDevice, sealed: resealed });
    assert.equal(reopened?.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
    assert.equal(reopened?.sharePeers.length, 1);
  });

  it('a recognized key is never shadowed by a stale extra', async () => {
    const { established, passphraseKek } = await establishedFor('the passphrase that minted it');
    const fromNewerClient = await compartmentFromANewerClient(established);

    // FIRST: a recognised key can never BECOME an extra. The split is by
    // difference against the parsed region, so everything this build
    // understands is taken into the region and only the leftover is carried.
    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    await openOwnerPrivateRegion({ session, sealed: fromNewerClient.sealed });
    // `null` would mean the session never read the plaintext, which after a
    // successful open it has (M164/06) — and every assertion below is about
    // WHICH keys it kept, so the distinction has to be made before them.
    assert.ok(session.extras !== null, 'a successful open must leave the session knowing what it read');
    assert.deepEqual(Object.keys(session.extras), [FUTURE_KEY]);
    assert.ok(
      !Object.keys(session.extras).includes('shareIdentity'),
      'a recognised key must never be carried as an extra',
    );
    assert.ok(!Object.keys(session.extras).includes('kind'), 'the tag is written by the seal, never carried across');

    // SECOND: and even handed a hostile set of extras — one shadowing the
    // account's own share key, one shadowing the kind tag — the seal writes the
    // region LAST and the tag between, so neither can win.
    const plaintext = rawCompartmentSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          taggedCompartmentPlaintext({
            region: regionWithShareKey(PRIVATE_KEY_MARKER),
            kind: COMPARTMENT_KIND.diary,
            extras: {
              shareIdentity: { publicKeyRaw: 'stale', privateKeyPkcs8: 'a-key-that-was-replaced', createdAt: 1 },
              kind: COMPARTMENT_KIND.study,
              [FUTURE_KEY]: FUTURE_VALUE,
            },
          }),
        ),
      ),
    );
    assert.equal(plaintext.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
    assert.equal(plaintext.kind, COMPARTMENT_KIND.diary);

    // NON-VACUITY: the harmless extra beside them did come through, so the two
    // assertions above are about ORDER and not about extras being dropped.
    assert.deepEqual(plaintext[FUTURE_KEY], FUTURE_VALUE);
  });

  it('no compartment extra reaches the device snapshot', async () => {
    const { established, passphraseKek } = await establishedFor('the passphrase that minted it');
    const fromNewerClient = await compartmentFromANewerClient(established);

    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    const ownerPrivate = await openOwnerPrivateRegion({ session, sealed: fromNewerClient.sealed });
    assert.ok(ownerPrivate !== null);

    // NON-VACUITY: the extra WAS carried. Without this the absence below would
    // pass on a compartment that never had one.
    assert.deepEqual(session.extras?.[FUTURE_KEY], FUTURE_VALUE);

    // The snapshot the device would write, built through the real recomposer.
    const { shareable } = partitionSnapshot((await exportBackup({ store: createPrimaryStore() })).data);
    const recomposed = recomposeSnapshot({ shareable, ownerPrivate });
    assert.ok(!Object.keys(recomposed).includes(FUTURE_KEY), 'an extra must never become a snapshot key');
    partitionSnapshot(recomposed);

    // AND THE OTHER FAIL-CLOSED RULE IS UNTOUCHED. Had the extra ridden along,
    // this is what would have happened: the snapshot guard stops the sync
    // rather than letting an unclassified key default into the half a clinician
    // can read. Both rules stand; they answer different questions.
    assert.throws(
      () => partitionSnapshot(Object.assign({}, recomposed, { [FUTURE_KEY]: FUTURE_VALUE })),
      /not classified in SNAPSHOT_KEY_REGIONS/,
    );
  });
});

/**
 * A REFUSAL THAT ARRIVES AFTER THE WRITE IS NOT A REFUSAL (M164/06).
 *
 * Two of the three findings the M164 review reproduced, at the level each one
 * actually lives.
 *
 * ── 1. The tag was read through a schema that could fail on the tag ──────
 *
 * `readCompartmentKind` parsed the WHOLE plaintext through one object schema
 * and answered `'unreadable'` whenever that parse failed. A `kind` of `5`
 * failed it — so a study compartment carrying a non-string tag came back as
 * "there is no tag here", which `parseCompartmentPlaintext` deliberately does
 * not refuse. Measured before the fix: a diary open of
 * `{"kind":5,"studyKeyring":[…]}` SUCCEEDED and returned an empty region.
 *
 * `'unreadable'` has to mean one thing — "this is not an object, so there is
 * nowhere for a tag to be" — or it becomes a door around the refusal.
 *
 * ── 3. A CDK can be adopted without the compartment ever being opened ────
 *
 * `adoptRewrappedSlots` hands the session a CDK and two wraps after a rewrap.
 * The rewrap never decrypts the compartment, so the session's `extras` are
 * still the empty set it started with — and the next seal wrote
 * `{ …{}, kind, …region }` over a newer client's key. Sign in on a new device
 * and change the passphrase before the first sync cycle and that is the whole
 * reproduction.
 */

/** The two wraps a rewrap produces: same CDK, same ciphertext, a door that has moved. */
async function rewrappedSlots({
  established,
  sealed,
  nextKek,
}: {
  established: EstablishedPrivateStore;
  sealed: SealedPrivateStore;
  nextKek: CryptoKey;
}): Promise<SealedPrivateStore> {
  return {
    ciphertext: sealed.ciphertext,
    cdkWrapPassphrase: bytesToBase64(await wrapCdk({ cdk: established.cdk, kek: nextKek })),
    cdkWrapRecovery: sealed.cdkWrapRecovery,
  };
}

describe('the refusal must come before the write', () => {
  it('a non-string kind is refused, not read as an untagged diary', async () => {
    const { established, passphraseKek } = await establishedFor('one passphrase, two possible accounts');
    // A study compartment whose tag is a NUMBER. Nothing this repo writes
    // produces it; a corrupted or hostile plaintext does, and the question is
    // what the diary side does when it decrypts one.
    const mistagged = await sealedJson({
      established,
      json: JSON.stringify({
        kind: 5,
        studyKeyring: [{ publicKey: 'a-public-key', privateKey: STUDY_KEY_MARKER, createdAt: 1_000 }],
      }),
    });

    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    await assert.rejects(
      () => openOwnerPrivateRegion({ session, sealed: mistagged.sealed }),
      (cause: unknown) => {
        assert.ok(cause instanceof WrongCompartmentKindError, 'a tag this build cannot read must be a refusal');
        assert.equal(cause.expected, 'diary');
        // NOT `'study'`: the sniff never runs, because a tag IS present. The
        // build simply cannot say what it means, and guessing is the defect.
        assert.equal(cause.actual, 'unrecognised');
        return true;
      },
    );

    // NON-VACUITY: the same bytes decrypt perfectly. The refusal is about what
    // the plaintext SAYS, not about the door or the ciphertext.
    const plaintext = await openPrivateStore({
      cdk: established.cdk,
      ciphertext: base64ToBytes(mistagged.sealed.ciphertext),
      accountId: ACCOUNT_ID,
    });
    assert.ok(new TextDecoder().decode(plaintext).includes(STUDY_KEY_MARKER));
  });

  it('a rewrap-adopted session re-emits the compartment instead of sealing an empty one', async () => {
    const { established, passphraseKek } = await establishedFor('the passphrase that minted it');
    const fromNewerClient = await compartmentFromANewerClient(established);

    // A device that signed in and CHANGED ITS PASSPHRASE before its first sync
    // cycle. `rewrapPrivateStoreOnServer` unwrapped slot 1 and rewrapped it —
    // it never decrypted the compartment, and neither did this session.
    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    const nextKek = await privateStoreKekFor('the passphrase this device just moved to');
    const rewrapped = await rewrappedSlots({ established, sealed: fromNewerClient.sealed, nextKek });
    adoptRewrappedSlots({ session, cdk: established.cdk, sealed: rewrapped });

    // NON-VACUITY: the session really is holding a usable CDK, so the seal
    // below is not declining for lack of a key.
    assert.notEqual(session.cdk, null, 'the rewrap must have left a CDK, or this proves nothing');

    const resealed = await sealOwnerPrivateRegion({ session, region: EMPTY_OWNER_PRIVATE_REGION });
    assert.ok(resealed !== null, 'a session holding a CDK must still publish a compartment');

    // THE BYTES, not "not null". A session that has never read the plaintext
    // has nothing to say about it, so the only correct output is the
    // compartment it was handed — with the REWRAPPED door on it.
    assert.equal(resealed.ciphertext, fromNewerClient.sealed.ciphertext, 'the ciphertext must be re-emitted verbatim');
    assert.equal(resealed.cdkWrapPassphrase, rewrapped.cdkWrapPassphrase, 'the rewrapped slot must be the one pushed');

    // AND THE KEY IS STILL IN THERE, read out of the ciphertext by hand
    // because no schema in this repo mentions it.
    const raw = await readRawPlaintext({ established, sealed: resealed });
    assert.deepEqual(raw[FUTURE_KEY], FUTURE_VALUE);
    assert.equal(raw.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);

    // AND THE NEW DOOR OPENS IT: the rewrap is not undone by the re-emission.
    const nextSession = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek: nextKek });
    const opened = await openOwnerPrivateRegion({ session: nextSession, sealed: resealed });
    assert.equal(opened?.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);

    // AND ONCE IT HAS OPENED, IT SEALS AGAIN. The refusal is about ignorance,
    // not a permanent state — without this the fix could be "never seal".
    const afterOpen = await sealOwnerPrivateRegion({
      session: nextSession,
      region: { ...EMPTY_OWNER_PRIVATE_REGION, sharePeers: [] },
    });
    assert.ok(afterOpen !== null);
    assert.deepEqual((await readRawPlaintext({ established, sealed: afterOpen }))[FUTURE_KEY], FUTURE_VALUE);
  });
});
