/**
 * THE SNAPSHOT PARTITION (M160/07, `openplate-sync` ADR-0002's amendment) —
 * the test that replaces a one-time audit.
 *
 * A share is full-DEK and the blob is the whole snapshot, so anything left in
 * the shareable region is disclosed to every grantee. Spec 01 audited exactly
 * that and passed on 2026-08-27; spec 04 put the owner's share PRIVATE key
 * into the snapshot the same day. A point-in-time audit of a moving structure
 * is stale the day the structure moves, so the invariant is a test.
 *
 * Two design rules follow, and both are the difference between a real guard
 * and a comforting one:
 *
 *  1. **The key set comes from the REAL snapshot builder**, not a hand-copied
 *     list. A hand-copied list is a second thing to forget, and it would have
 *     passed cleanly through the very failure this exists to catch.
 *  2. **The assertions are POSITIVE.** A grep for the absence of a private key
 *     passes on an empty snapshot, a broken fixture, and a typo'd marker. So
 *     the fixture is fully populated, the diary IS asserted present in the
 *     grantee's view (proving the view is real), and the owner-private markers
 *     are asserted RECOVERABLE through the CDK path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup } from '../../app/lib/local-store/backup';
import {
  putLocalFast,
  putLocalFood,
  putLocalFoodLog,
  putLocalProfileGoals,
  putLocalResearchIdentity,
  putLocalSavedMeal,
  putLocalShareIdentity,
  putLocalSharePeer,
  putLocalStudyEnrolment,
  putLocalWeightEntry,
} from '../../app/lib/local-store/primary-store';
import { SCHEMA_VERSION, type LocalStoreSnapshot } from '../../app/lib/local-store/schema';
import {
  classifySnapshotKey,
  partitionSnapshot,
  recomposeSnapshot,
  SNAPSHOT_KEY_REGIONS,
  type SyncedSnapshot,
} from '../../app/lib/sync/snapshot-partition';
import {
  createPrivateStoreSession,
  openOwnerPrivateRegion,
  sealOwnerPrivateRegion,
} from '../../app/lib/sync/private-store';
import { rewrapPrivateStoreOnServer, type BlobTransport } from '../../app/lib/sync/private-store-rewrap';
import { PRIVATE_STORE_ENTITY_KEY } from '../../app/lib/sync/snapshot-sync';
import { buildEnvelope, parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import type { SyncPayload } from '../../app/lib/sync/engine/envelope/types';
import { ENVELOPE_VERSION } from '../../app/lib/sync/engine/protocol';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import {
  establishPrivateStore,
  openPrivateStore,
  unwrapCdk,
  type EstablishedPrivateStore,
} from '../../app/lib/sync/engine/crypto/private-store';
import { deriveCredentialsFromPassphrase } from '../../app/lib/sync/engine/client/derive-credentials';
import { createPassphraseKdfDescriptor } from '../../app/lib/sync/engine/client/passphrase-kek';
import { ARGON2ID_DEFAULT_PARAMS } from '../../app/lib/sync/engine/crypto/argon2';
import { derivePrivateStoreRecoveryKek } from '../../app/lib/sync/engine/client/recovery-kek';
import { base64ToBytes, bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import {
  generateShareKeyPair,
  unwrapDekAsRecipient,
  wrapDekForRecipient,
} from '../../app/lib/sync/engine/crypto/share-wrap';
import type { PulledBlob, PushBlobHttpResult, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';

const ACCOUNT_ID = 42;
const DEVICE_ID = 'laptop';

/**
 * The two plaintext markers this file hunts for.
 *
 * `PRIVATE_KEY_MARKER` is a slice of a real PKCS#8 header, and the peer label
 * is the kind of thing a person actually types. Both are chosen to be
 * distinctive enough that finding them in a JSON blob means something.
 */
const PRIVATE_KEY_MARKER = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg';
const PEER_LABEL_MARKER = 'Dr. Meier';
const DIARY_MARKER = 'Acerola';

/**
 * ADR-0003's two markers (M161/03). The root is the secret every study
 * pseudonym derives from, so a grantee learning it could recompute this
 * person's identifier in every study they will ever join; the study label is
 * WHICH studies they joined, which is health data even though the key beside
 * it is public.
 */
const PSEUDONYM_ROOT_MARKER = 'cm9vdC10aGF0LW11c3Qtbm90LXJlYWNoLWEtZ3JhbnRlZQ==';
const STUDY_LABEL_MARKER = 'Charite sleep trial';

/** Argon2id stands in as a plain digest here. The LABELS are what this file tests, and they sit above the hash. */
async function fakeArgon2id({ passphrase, salt }: { passphrase: string; salt: Uint8Array }): Promise<Uint8Array> {
  const material = new TextEncoder().encode(`${passphrase}::${bytesToBase64(salt)}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

/** `K_pp` for a passphrase, through the REAL derivation — so a wrong HKDF label here would fail these tests. */
async function privateStoreKekFor(passphrase: string): Promise<CryptoKey> {
  const descriptor = createPassphraseKdfDescriptor(new Uint8Array(16).fill(7), ARGON2ID_DEFAULT_PARAMS);
  const credentials = await deriveCredentialsFromPassphrase({
    passphrase,
    descriptor,
    deriveHash: fakeArgon2id,
  });
  return credentials.privateStoreKek;
}

/**
 * A FULLY POPULATED snapshot, built by the real builder.
 *
 * `exportBackup` is what `readLocalSnapshot` calls in production, so the key
 * set below is the one that actually reaches the wire — no hand-copied list
 * can drift from it, because there is no hand-copied list.
 */
async function buildPopulatedSnapshot(): Promise<LocalStoreSnapshot> {
  const store = createPrimaryStore();
  await putLocalFood(
    {
      id: 'food-1',
      name: DIARY_MARKER,
      brand: null,
      macrosPer100g: { carbs: 11, fiber: 1, sugars: null, polyols: null, protein: 0.4, fat: 0.3, kcal: 32 },
      source: 'user',
      createdAt: 1_000,
    },
    { store },
  );
  await putLocalFoodLog(
    {
      id: 'log-1',
      name: DIARY_MARKER,
      quantityGrams: 50,
      macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
      mealType: 'snack',
      source: 'manual',
      aiEstimated: false,
      curatedSource: 'lowcarbcheck:acerola',
      foodId: 'food-1',
      dayKey: '2026-08-27',
      loggedAt: 2_000,
      createdAt: 2_000,
      logBatchId: null,
    },
    { store },
  );
  await putLocalWeightEntry(
    { id: 'w-1', dayKey: '2026-08-27', weightKg: 71.2, loggedAt: 3_000, createdAt: 3_000 },
    { store },
  );
  await putLocalProfileGoals(
    {
      timezone: 'Europe/Berlin',
      goalNetCarbsCeilingG: 50,
      goalProteinFloorG: 90,
      goalKcalTarget: 2_000,
      targetWeightKg: 68,
      trackingFocus: 'net-carbs',
      onboardingCompletedAt: 4_000,
      updatedAt: 4_000,
    },
    { store },
  );
  await putLocalFast(
    {
      id: 'fast-1',
      protocolId: '16:8',
      targetDurationMs: 57_600_000,
      plannedStartAt: null,
      startedAt: 5_000,
      endedAt: null,
      createdAt: 5_000,
    },
    { store },
  );
  await putLocalSavedMeal(
    {
      id: 'meal-1',
      name: 'Breakfast',
      items: [
        {
          name: DIARY_MARKER,
          quantityGrams: 30,
          macros: { carbs: 3.3, fiber: null, sugars: null, polyols: null, protein: 0.1, fat: 0.1, kcal: 10 },
          source: 'manual',
          aiEstimated: false,
          curatedSource: null,
          foodId: 'food-1',
        },
      ],
      createdAt: 6_000,
    },
    { store },
  );
  await putLocalShareIdentity(
    {
      publicKeyRaw: 'BJ5xqpaxdRXhW/pVMrRoOGVNCKwhYIhtOI5TsZOQHlZfafThmD/jzLa7ulU7SaqZmKqLxzb2stZMpUFaI2o12I0=',
      privateKeyPkcs8: PRIVATE_KEY_MARKER,
      createdAt: 7_000,
    },
    { store },
  );
  await putLocalSharePeer(
    { id: '9', accountId: 9, publicKeyRaw: 'peer-public-key', label: PEER_LABEL_MARKER, createdAt: 8_000 },
    { store },
  );
  await putLocalResearchIdentity({ pseudonymRoot: PSEUDONYM_ROOT_MARKER, createdAt: 9_000 }, { store });
  await putLocalStudyEnrolment(
    { id: '11', studyAccountId: 11, publicKeyRaw: 'study-public-key', label: STUDY_LABEL_MARKER, createdAt: 10_000 },
    { store },
  );
  return (await exportBackup({ store })).data;
}

/** An established compartment plus the two doors that open it. */
async function establishedFor({
  passphrase,
  recoveryCode,
}: {
  passphrase: string;
  recoveryCode: Uint8Array;
}): Promise<{ established: EstablishedPrivateStore; passphraseKek: CryptoKey; recoveryKek: CryptoKey }> {
  const passphraseKek = await privateStoreKekFor(passphrase);
  const recoveryKek = await derivePrivateStoreRecoveryKek(recoveryCode);
  return { established: await establishPrivateStore({ passphraseKek, recoveryKek }), passphraseKek, recoveryKek };
}

/** The snapshot as it actually goes on the wire: shareable region + sealed compartment. */
async function buildWireSnapshot({
  snapshot,
  established,
  passphraseKek,
}: {
  snapshot: LocalStoreSnapshot;
  established: EstablishedPrivateStore;
  passphraseKek: CryptoKey;
}): Promise<SyncedSnapshot> {
  const { shareable, ownerPrivate } = partitionSnapshot(snapshot);
  const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek, established });
  return { ...shareable, privateStore: await sealOwnerPrivateRegion({ session, region: ownerPrivate }) };
}

/** An in-memory blob store honouring the one rule the rewrap depends on: compare-and-swap on `blobVersion`. */
function fakeBlobTransport(initial: { version: number; ciphertext: Uint8Array }): BlobTransport & {
  current: () => { version: number; ciphertext: Uint8Array };
} {
  let stored = initial;
  const transport: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      return {
        blobVersion: stored.version,
        envelopeVersion: ENVELOPE_VERSION,
        ciphertext: stored.ciphertext,
        createdAt: '2026-08-27T10:00:00.000Z',
      };
    },
    async pushBlob(input: {
      baseVersion: number;
      envelopeVersion: number;
      ciphertext: Uint8Array;
    }): Promise<PushBlobHttpResult> {
      if (input.baseVersion !== stored.version) return { status: 'conflict', currentVersion: stored.version };
      stored = { version: stored.version + 1, ciphertext: input.ciphertext };
      return { status: 'accepted', newVersion: stored.version };
    },
  };
  return { ...transport, current: () => stored };
}

describe('the snapshot classification map', () => {
  it('classifies every snapshot key the real builder produces, and fails closed on one it does not', async () => {
    const snapshot = await buildPopulatedSnapshot();

    // The fixture must be genuinely populated, or every claim below is
    // vacuous: an empty snapshot leaks nothing and classifies nothing.
    assert.ok(snapshot.foods.length > 0 && snapshot.foodLogs.length > 0 && snapshot.weightEntries.length > 0);
    assert.ok(snapshot.fasts.length > 0 && snapshot.savedMeals.length > 0 && snapshot.profile !== null);
    assert.equal(snapshot.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
    assert.equal(snapshot.sharePeers[0]?.label, PEER_LABEL_MARKER);
    assert.equal(snapshot.researchIdentity?.pseudonymRoot, PSEUDONYM_ROOT_MARKER);
    assert.equal(snapshot.studyEnrolments[0]?.label, STUDY_LABEL_MARKER);

    // The key set is DERIVED from that fixture. A new snapshot field arrives
    // here automatically, which is the whole point.
    const producedKeys = Object.keys(snapshot).toSorted();
    assert.deepEqual(Object.keys(SNAPSHOT_KEY_REGIONS).toSorted(), producedKeys);
    for (const key of producedKeys) {
      assert.doesNotThrow(() => classifySnapshotKey(key), `snapshot key "${key}" is unclassified`);
    }

    // ABSENT MEANS FAIL, never means shared.
    assert.throws(() => classifySnapshotKey('providerApiKey'), /not classified/);
    const withUnclassifiedKey: LocalStoreSnapshot = { ...snapshot };
    Object.assign(withUnclassifiedKey, { providerApiKey: 'sk-live-do-not-share' });
    assert.throws(() => partitionSnapshot(withUnclassifiedKey), /not classified/);

    // And the split itself is lossless in both directions.
    const partitioned = partitionSnapshot(snapshot);
    assert.deepEqual(partitioned.ownerPrivate, {
      shareIdentity: snapshot.shareIdentity,
      sharePeers: snapshot.sharePeers,
      researchIdentity: snapshot.researchIdentity,
      studyEnrolments: snapshot.studyEnrolments,
    });
    assert.deepEqual(recomposeSnapshot(partitioned), snapshot);
  });
});

describe('a clinician grantee', () => {
  it('grantee view: decrypts the diary and reaches the compartment only as opaque ciphertext', async () => {
    const snapshot = await buildPopulatedSnapshot();
    const { established, passphraseKek } = await establishedFor({
      passphrase: 'correct horse battery staple',
      recoveryCode: new Uint8Array(20).fill(3),
    });
    const wire = await buildWireSnapshot({ snapshot, established, passphraseKek });

    // A REAL grant: the patient's DEK, wrapped to a clinician's public key.
    const dek = generateDek();
    const clinician = await generateShareKeyPair();
    const shareWrap = await wrapDekForRecipient({
      dek,
      recipientPublicKeyRaw: clinician.publicKeyRaw,
      grantorAccountId: ACCOUNT_ID,
    });
    const envelope = await buildEnvelope({
      payload: { snapshot: wire, syncMeta: { perEntity: {}, tombstones: [] } },
      dek,
      aadFields: { accountId: ACCOUNT_ID, blobVersion: 1, payloadSchemaVersion: SCHEMA_VERSION },
    });

    // Everything below this line is done with what the CLINICIAN holds.
    const granteeDek = await unwrapDekAsRecipient({
      wrap: shareWrap,
      privateKeyPkcs8: clinician.privateKeyPkcs8,
      grantorAccountId: ACCOUNT_ID,
      ownPublicKeyRaw: clinician.publicKeyRaw,
    });
    const granteePayload = await parseEnvelope({
      envelope: { envelopeVersion: ENVELOPE_VERSION, ciphertext: envelope.ciphertext },
      dek: granteeDek,
      aadFields: { accountId: ACCOUNT_ID, blobVersion: 1, payloadSchemaVersion: SCHEMA_VERSION },
    });
    const granteeView = JSON.stringify(granteePayload.snapshot);

    // POSITIVE: the share works. Without this the absence claims below would
    // also pass on an empty blob, a wrong key, or a broken fixture.
    assert.ok(granteeView.includes(DIARY_MARKER), 'the grantee must actually be able to read the diary');

    // POSITIVE: what the grantee reaches instead of the key material is one
    // opaque ciphertext with two wraps it cannot open.
    const compartment = wire.privateStore;
    assert.ok(compartment !== null);
    assert.ok(granteeView.includes(compartment.ciphertext));
    assert.ok(base64ToBytes(compartment.ciphertext).byteLength > 0);

    // And the markers themselves are nowhere in that view.
    assert.equal(granteeView.includes(PRIVATE_KEY_MARKER), false, 'the share private key reached a grantee');
    assert.equal(granteeView.includes(PEER_LABEL_MARKER), false, 'a pinned peer label reached a grantee');
    assert.equal(granteeView.includes(PSEUDONYM_ROOT_MARKER), false, 'the pseudonym root reached a grantee');
    assert.equal(granteeView.includes(STUDY_LABEL_MARKER), false, 'a study enrolment reached a grantee');

    // POSITIVE, the other half: the SAME markers ARE recoverable — through the
    // CDK path, which the grantee has no key for.
    const owner = createPrivateStoreSession({
      accountId: ACCOUNT_ID,
      passphraseKek,
      established,
    });
    const opened = await openOwnerPrivateRegion({ session: owner, sealed: compartment });
    assert.equal(opened?.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
    assert.equal(opened?.sharePeers[0]?.label, PEER_LABEL_MARKER);
    assert.equal(opened?.researchIdentity?.pseudonymRoot, PSEUDONYM_ROOT_MARKER);
    assert.equal(opened?.studyEnrolments[0]?.label, STUDY_LABEL_MARKER);

    // The grantee holds the DEK and the compartment bytes, and still cannot
    // open it: the CDK is behind a key derived from the owner's passphrase.
    const impostor = createPrivateStoreSession({
      accountId: ACCOUNT_ID,
      passphraseKek: await privateStoreKekFor('a different passphrase'),
    });
    assert.equal(await openOwnerPrivateRegion({ session: impostor, sealed: compartment }), null);
  });
});

describe('the owner-private compartment', () => {
  it('compartment opens by passphrase and by recovery code, and not for another account', async () => {
    const snapshot = await buildPopulatedSnapshot();
    const recoveryCode = new Uint8Array(20).fill(11);
    const { established, passphraseKek, recoveryKek } = await establishedFor({
      passphrase: 'correct horse battery staple',
      recoveryCode,
    });
    const wire = await buildWireSnapshot({ snapshot, established, passphraseKek });
    const compartment = wire.privateStore;
    assert.ok(compartment !== null);

    // Door 1: a fresh session that holds nothing but `K_pp` — the second-device
    // case, where the CDK is learned from slot 1 rather than carried over.
    const secondDevice = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
    const byPassphrase = await openOwnerPrivateRegion({ session: secondDevice, sealed: compartment });
    assert.deepEqual(byPassphrase, partitionSnapshot(snapshot).ownerPrivate);
    assert.notEqual(secondDevice.cdk, null, 'the session must adopt the CDK it just learned');

    // Door 2: the recovery code, independently. This is the door that has to
    // work when the passphrase is gone, so it is opened here from the raw
    // primitives rather than through the session.
    const cdk = await unwrapCdk({ wrappedCdk: base64ToBytes(compartment.cdkWrapRecovery), kek: recoveryKek });
    const plaintext = await openPrivateStore({
      cdk,
      ciphertext: base64ToBytes(compartment.ciphertext),
      accountId: ACCOUNT_ID,
    });
    assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), partitionSnapshot(snapshot).ownerPrivate);

    // The AAD binds the account: a compartment spliced into another account's
    // blob fails the tag check rather than decrypting into the wrong diary.
    await assert.rejects(() =>
      openPrivateStore({ cdk, ciphertext: base64ToBytes(compartment.ciphertext), accountId: ACCOUNT_ID + 1 }),
    );

    // The two slots are distinct keys over the same CDK, so neither door can
    // be substituted for the other.
    await assert.rejects(() =>
      unwrapCdk({ wrappedCdk: base64ToBytes(compartment.cdkWrapPassphrase), kek: recoveryKek }),
    );
  });

  it('re-seals to the SAME bytes while its plaintext is unchanged, so an unchanged compartment never burns a blob version', async () => {
    const snapshot = await buildPopulatedSnapshot();
    const { established, passphraseKek } = await establishedFor({
      passphrase: 'correct horse battery staple',
      recoveryCode: new Uint8Array(20).fill(5),
    });
    const session = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek, established });
    const region = partitionSnapshot(snapshot).ownerPrivate;

    const first = await sealOwnerPrivateRegion({ session, region });
    const second = await sealOwnerPrivateRegion({ session, region });
    assert.deepEqual(first, second);

    // A real change must still produce new bytes, or nothing would ever sync.
    const changed = await sealOwnerPrivateRegion({ session, region: { ...region, sharePeers: [] } });
    assert.notDeepEqual(changed, first);
  });
});

describe('a passphrase change', () => {
  it('passphrase change rewraps the compartment, so the old passphrase stops opening it', async () => {
    const snapshot = await buildPopulatedSnapshot();
    const recoveryCode = new Uint8Array(20).fill(9);
    const {
      established,
      passphraseKek: oldKek,
      recoveryKek,
    } = await establishedFor({
      passphrase: 'the old passphrase',
      recoveryCode,
    });
    const newKek = await privateStoreKekFor('the new passphrase');
    const wire = await buildWireSnapshot({ snapshot, established, passphraseKek: oldKek });

    const dek = generateDek();
    const payload: SyncPayload = {
      snapshot: wire,
      syncMeta: { perEntity: { [PRIVATE_STORE_ENTITY_KEY]: { lamport: 4, deviceId: 'phone' } }, tombstones: [] },
    };
    const envelope = await buildEnvelope({
      payload,
      dek,
      aadFields: { accountId: ACCOUNT_ID, blobVersion: 3, payloadSchemaVersion: SCHEMA_VERSION },
    });
    const transport = fakeBlobTransport({ version: 3, ciphertext: envelope.ciphertext });

    const result = await rewrapPrivateStoreOnServer({
      http: transport,
      accountId: ACCOUNT_ID,
      dek,
      deviceId: DEVICE_ID,
      currentKek: oldKek,
      currentSlot: 'passphrase',
      nextPassphraseKek: newKek,
      nextRecoveryKek: null,
    });
    assert.equal(result.status, 'rewrapped');

    // The blob moved on by exactly one version, under the ordinary CAS.
    const stored = transport.current();
    assert.equal(stored.version, 4);
    const reread = await parseEnvelope({
      envelope: { envelopeVersion: ENVELOPE_VERSION, ciphertext: stored.ciphertext },
      dek,
      aadFields: { accountId: ACCOUNT_ID, blobVersion: 4, payloadSchemaVersion: SCHEMA_VERSION },
    });
    // SAFETY: this blob is the one built four lines up from `wire`, a
    // `SyncedSnapshot` by construction, with only its wraps replaced.
    const rewrapped = (reread.snapshot as SyncedSnapshot).privateStore;
    assert.ok(rewrapped !== null);

    // THE OLD PASSPHRASE STOPS OPENING IT. This is the assertion the whole
    // lifecycle exists for; without the rewrap it would still succeed.
    await assert.rejects(() => unwrapCdk({ wrappedCdk: base64ToBytes(rewrapped.cdkWrapPassphrase), kek: oldKek }));

    // The new one does, and it reaches the same key material.
    const afterChange = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek: newKek });
    const opened = await openOwnerPrivateRegion({ session: afterChange, sealed: rewrapped });
    assert.equal(opened?.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);

    // The OTHER door is untouched: a passphrase change must never invalidate
    // the recovery code, which wraps the same unchanged CDK.
    assert.equal(rewrapped.cdkWrapRecovery, established.cdkWrapRecovery);
    assert.deepEqual(
      await unwrapCdk({ wrappedCdk: base64ToBytes(rewrapped.cdkWrapRecovery), kek: recoveryKek }),
      await unwrapCdk({ wrappedCdk: base64ToBytes(rewrapped.cdkWrapPassphrase), kek: newKek }),
    );

    // The ciphertext is untouched too — only the wraps moved.
    assert.equal(rewrapped.ciphertext, wire.privateStore?.ciphertext);

    // And the compartment's stamp advanced with THIS device, so a peer holding
    // the pre-change copy cannot win the merge and undo the rewrap.
    const stamp = reread.syncMeta.perEntity[PRIVATE_STORE_ENTITY_KEY];
    assert.deepEqual(stamp, { lamport: 5, deviceId: DEVICE_ID });
  });

  it('recovery reset opens the compartment by recovery code and moves it onto the new passphrase', async () => {
    const snapshot = await buildPopulatedSnapshot();
    const recoveryCode = new Uint8Array(20).fill(13);
    const {
      established,
      passphraseKek: forgottenKek,
      recoveryKek,
    } = await establishedFor({
      passphrase: 'the forgotten passphrase',
      recoveryCode,
    });
    const newKek = await privateStoreKekFor('the reset passphrase');
    const wire = await buildWireSnapshot({ snapshot, established, passphraseKek: forgottenKek });

    const dek = generateDek();
    const envelope = await buildEnvelope({
      payload: { snapshot: wire, syncMeta: { perEntity: {}, tombstones: [] } },
      dek,
      aadFields: { accountId: ACCOUNT_ID, blobVersion: 1, payloadSchemaVersion: SCHEMA_VERSION },
    });
    const transport = fakeBlobTransport({ version: 1, ciphertext: envelope.ciphertext });

    const result = await rewrapPrivateStoreOnServer({
      http: transport,
      accountId: ACCOUNT_ID,
      dek,
      deviceId: DEVICE_ID,
      // The only door this person has left.
      currentKek: recoveryKek,
      currentSlot: 'recovery',
      nextPassphraseKek: newKek,
      nextRecoveryKek: recoveryKek,
    });
    assert.equal(result.status, 'rewrapped');

    const reread = await parseEnvelope({
      envelope: { envelopeVersion: ENVELOPE_VERSION, ciphertext: transport.current().ciphertext },
      dek,
      aadFields: { accountId: ACCOUNT_ID, blobVersion: 2, payloadSchemaVersion: SCHEMA_VERSION },
    });
    // SAFETY: this blob is the one built four lines up from `wire`, a
    // `SyncedSnapshot` by construction, with only its wraps replaced.
    const rewrapped = (reread.snapshot as SyncedSnapshot).privateStore;
    assert.ok(rewrapped !== null);

    const afterReset = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek: newKek });
    const opened = await openOwnerPrivateRegion({ session: afterReset, sealed: rewrapped });
    assert.equal(opened?.sharePeers[0]?.label, PEER_LABEL_MARKER);
    await assert.rejects(() =>
      unwrapCdk({ wrappedCdk: base64ToBytes(rewrapped.cdkWrapPassphrase), kek: forgottenKek }),
    );
  });
});
