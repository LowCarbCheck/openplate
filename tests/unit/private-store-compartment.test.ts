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
  createPrivateStoreSession,
  openOwnerPrivateRegion,
  sealOwnerPrivateRegion,
} from '../../app/lib/sync/private-store';
import { EMPTY_OWNER_PRIVATE_REGION, type OwnerPrivateRegion } from '../../app/lib/sync/snapshot-partition';
import {
  establishPrivateStore,
  sealPrivateStore,
  type EstablishedPrivateStore,
} from '../../app/lib/sync/engine/crypto/private-store';
import { WrongCompartmentKindError } from '../../app/lib/sync/compartment-kind';
import { openStudyRegion, sealStudyRegion } from '../../app/lib/sync/research/study-compartment';
import type { SealedPrivateStore } from '../../app/lib/sync/snapshot-partition';
import { deriveCredentialsFromPassphrase } from '../../app/lib/sync/engine/client/derive-credentials';
import { createPassphraseKdfDescriptor } from '../../app/lib/sync/engine/client/passphrase-kek';
import { ARGON2ID_DEFAULT_PARAMS } from '../../app/lib/sync/engine/crypto/argon2';
import { derivePrivateStoreRecoveryKek } from '../../app/lib/sync/engine/client/recovery-kek';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';

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
      session: { accountId: ACCOUNT_ID, passphraseKek, cdk: null, wraps: null, pulled: null },
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
