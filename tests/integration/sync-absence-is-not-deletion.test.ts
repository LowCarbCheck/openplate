/**
 * The two cases that need a SECOND party: a resumed session, and a second
 * device.
 *
 * Both are about the same rule as `sync-eviction-not-deletion.test.ts`, a
 * tombstone needs positive evidence that a delete happened, and both are
 * driven through the real `runSyncCycleUnlocked` against an in-memory service
 * that honours the one thing the cycle depends on, compare-and-swap on
 * `blobVersion`. They do not use the device store, because neither claim is
 * about it: one is about what a SESSION knows, and the other is about what a
 * PEER does with a blob.
 *
 * ── The compartment case ─────────────────────────────────────────────────
 *
 * Every resumed session used to tombstone the owner-private compartment on its
 * first cycle, with no eviction and nothing wrong. `performResume` opens the
 * vault with `cdk: null, pulled: null`; the cycle reads the snapshot BEFORE it
 * pulls; the seal therefore answered "no compartment"; and the stamping read
 * that as a delete. The device that did it kept its own keys, and a NEW device
 * signing in got no share key pair and no research pseudonym root at all, so
 * it was completely silent.
 *
 * ── The spread case ──────────────────────────────────────────────────────
 *
 * A tombstone is not a local mistake. A second, perfectly healthy device pulls
 * the blob and deletes its own rows to agree with it, which is how one evicted
 * phone empties a tablet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { buildEnvelope, parseEnvelope } from '../../app/lib/sync/engine/envelope/build-envelope';
import type { SyncPayload } from '../../app/lib/sync/engine/envelope/types';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import { SCHEMA_VERSION, type LocalFoodLog } from '../../app/lib/local-store';
import { EMPTY_OWNER_PRIVATE_REGION, type SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import {
  createPrivateStoreSession,
  openOwnerPrivateRegion,
  sealedCompartmentOrNull,
  sealOwnerPrivateRegion,
} from '../../app/lib/sync/private-store';
import { establishPrivateStore } from '../../app/lib/sync/engine/crypto/private-store';
import { deriveCredentialsFromPassphrase } from '../../app/lib/sync/engine/client/derive-credentials';
import { createPassphraseKdfDescriptor } from '../../app/lib/sync/engine/client/passphrase-kek';
import { ARGON2ID_DEFAULT_PARAMS } from '../../app/lib/sync/engine/crypto/argon2';
import { derivePrivateStoreRecoveryKek } from '../../app/lib/sync/engine/client/recovery-kek';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import type { PushBlobHttpResult, PulledBlob, SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { PRIVATE_STORE_ENTITY_KEY } from '../../app/lib/sync/snapshot-sync';
import { EVICTED_STORAGE, HEALTHY_STORAGE } from '../sync-integrity-fixtures';

const ACCOUNT_ID = 42;

/** Argon2id stands in as a plain digest. The KDF is not what this file tests. */
async function fakeArgon2id({ passphrase, salt }: { passphrase: string; salt: Uint8Array }): Promise<Uint8Array> {
  const material = new TextEncoder().encode(`${passphrase}::${bytesToBase64(salt)}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

/** `K_pp` for a passphrase, through the REAL derivation. */
async function privateStoreKekFor(passphrase: string): Promise<CryptoKey> {
  const descriptor = createPassphraseKdfDescriptor(new Uint8Array(16).fill(7), ARGON2ID_DEFAULT_PARAMS);
  const credentials = await deriveCredentialsFromPassphrase({ passphrase, descriptor, deriveHash: fakeArgon2id });
  return credentials.privateStoreKek;
}

function foodLog(id: string, name: string): LocalFoodLog {
  return {
    id,
    name,
    quantityGrams: 120,
    macros: { carbs: 4, fiber: 1, sugars: 1, polyols: 0, protein: 20, fat: 6, kcal: 160 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-08-04',
    loggedAt: 1_770_000_000_000,
    createdAt: 1_770_000_000_000,
    logBatchId: null,
  };
}

function snapshotOf(logs: LocalFoodLog[], privateStore: SyncedSnapshot['privateStore'] = null): SyncedSnapshot {
  return {
    foods: [],
    foodLogs: logs,
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    fastingSettings: null,
    privateStore,
  };
}

/** Just enough service to test the loop: compare-and-swap on `blobVersion`, and nothing else. */
function fakeService(dek: Uint8Array) {
  let stored: { version: number; ciphertext: Uint8Array } | null = null;
  const client: Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'> = {
    async pullBlob(): Promise<PulledBlob | null> {
      if (stored === null) return null;
      return {
        blobVersion: stored.version,
        envelopeVersion: 1,
        ciphertext: stored.ciphertext,
        createdAt: '2026-08-04T10:00:00.000Z',
      };
    },
    async pushBlob(input): Promise<PushBlobHttpResult> {
      const current = stored?.version ?? 0;
      if (input.baseVersion !== current) return { status: 'conflict', currentVersion: current };
      stored = { version: current + 1, ciphertext: input.ciphertext };
      return { status: 'accepted', newVersion: stored.version };
    },
  };
  return {
    // SAFETY: the cycle reaches for `pullBlob` and `pushBlob` and nothing else.
    client: client as SyncHttpClient,
    async read(): Promise<SyncPayload> {
      assert.ok(stored !== null, 'nothing is stored');
      return parseEnvelope({
        envelope: { envelopeVersion: 1, ciphertext: stored.ciphertext },
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: stored.version, payloadSchemaVersion: SCHEMA_VERSION },
      });
    },
    async seed(payload: SyncPayload, version: number): Promise<void> {
      const envelope = await buildEnvelope({
        payload,
        dek,
        aadFields: { accountId: ACCOUNT_ID, blobVersion: version, payloadSchemaVersion: SCHEMA_VERSION },
      });
      stored = { version, ciphertext: envelope.ciphertext };
    },
  };
}

// ---------------------------------------------------------------------------

test('a RESUMED session pushes the account’s compartment back, never a tombstone for it', async () => {
  const dek = generateDek();
  const service = fakeService(dek);
  const storage = createMemoryStorage();
  const state = createSyncStateStore({ storage, accountId: ACCOUNT_ID });

  // THE DEVICE THAT MINTED THE COMPARTMENT publishes it, exactly as production
  // does: partition, seal, push.
  const passphraseKek = await privateStoreKekFor('seventeen purple lanterns');
  const established = await establishPrivateStore({
    passphraseKek,
    recoveryKek: await derivePrivateStoreRecoveryKek(new Uint8Array(20).fill(3)),
  });
  const owner = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek, established });
  const ownerSeal = await sealOwnerPrivateRegion({
    session: owner,
    region: {
      ...EMPTY_OWNER_PRIVATE_REGION,
      shareIdentity: { publicKeyRaw: 'a-public-key', privateKeyPkcs8: 'THE-KEY-THAT-MUST-SURVIVE', createdAt: 7 },
    },
  });
  assert.equal(ownerSeal.kind, 'sealed', 'the fixture must carry a real compartment');
  const published = sealedCompartmentOrNull(ownerSeal);

  const first = await runSyncCycleUnlocked({
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state,
    deviceId: 'device-owner',
    readSnapshot: async () => ({
      snapshot: snapshotOf([foodLog('log-1', 'Lentil soup')], published),
      integrity: HEALTHY_STORAGE,
    }),
    applySnapshot: async () => {},
    assertPulledSnapshot: async () => {},
    // SAFETY: the only payload this cycle can pull back is one it pushed.
    parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
  });
  assert.equal(first.pushed, true);

  // NON-VACUITY: the baseline names the compartment, so the cycle below has
  // something it COULD tombstone.
  assert.ok(
    state.load().baseline.perEntity[PRIVATE_STORE_ENTITY_KEY] !== undefined,
    'the baseline must name the compartment',
  );

  // THE RESUME. `performResume` opens the vault with no compartment at all,
  // no CDK, no wraps, nothing pulled, and the cycle reads the snapshot before
  // it pulls, so the seal is asked a question it cannot answer yet.
  const resumed = createPrivateStoreSession({ accountId: ACCOUNT_ID, passphraseKek });
  assert.equal(resumed.cdk, null, 'a resumed session holds no CDK');
  assert.deepEqual(await sealOwnerPrivateRegion({ session: resumed, region: EMPTY_OWNER_PRIVATE_REGION }), {
    kind: 'unknown',
  });

  await runSyncCycleUnlocked({
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state,
    deviceId: 'device-owner',
    // WIRED AS `readSyncedSnapshot` WIRES IT, seal answer and all.
    readSnapshot: async () => {
      const seal = await sealOwnerPrivateRegion({ session: resumed, region: EMPTY_OWNER_PRIVATE_REGION });
      return {
        snapshot: snapshotOf([foodLog('log-1', 'Lentil soup')], sealedCompartmentOrNull(seal)),
        integrity: { ...HEALTHY_STORAGE, isCompartmentKnown: seal.kind !== 'unknown' },
      };
    },
    applySnapshot: async ({ merged }) => {
      await openOwnerPrivateRegion({ session: resumed, sealed: merged.privateStore });
    },
    assertPulledSnapshot: async () => {},
    // SAFETY: as above.
    parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
  });

  // THE CLAIM, read back off the service rather than off any in-memory copy.
  const payload = await service.read();
  assert.deepEqual(payload.syncMeta.tombstones, [], 'a resume must not delete the compartment');
  // SAFETY: `SyncPayload.snapshot` is `unknown` on the wire because a blob may
  // come from any schema version. This one was written by this very test.
  const onTheWire = payload.snapshot as { privateStore: SyncedSnapshot['privateStore'] };
  assert.deepEqual(onTheWire.privateStore, published, 'the account’s compartment must be untouched');

  // POSITIVE: and the resumed session ADOPTED it, which is the outcome the
  // whole path exists for, a new device gets the key pair instead of nothing.
  assert.notEqual(resumed.cdk, null, 'the resumed session must have adopted the compartment');
});

test('a HEALTHY second device keeps its rows when its peer could not prove a delete', async () => {
  const dek = generateDek();
  const service = fakeService(dek);

  // Both devices start from the same two entries on the account.
  const shared = [foodLog('log-a', 'Lentil soup'), foodLog('log-b', 'Rye bread')];
  const evictedStorage = createMemoryStorage();
  const evictedState = createSyncStateStore({ storage: evictedStorage, accountId: ACCOUNT_ID });

  await runSyncCycleUnlocked({
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state: evictedState,
    deviceId: 'device-evicted',
    readSnapshot: async () => ({ snapshot: snapshotOf(shared), integrity: HEALTHY_STORAGE }),
    applySnapshot: async () => {},
    assertPulledSnapshot: async () => {},
    // SAFETY: the only payload this cycle can pull back is one it pushed.
    parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
  });

  // THE EVICTED DEVICE: its baseline names both entries and its store reads
  // empty, with no database behind it.
  assert.equal(
    Object.keys(evictedState.load().baseline.perEntity).length,
    2,
    'the evicted device must remember both entries',
  );
  await runSyncCycleUnlocked({
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state: evictedState,
    deviceId: 'device-evicted',
    readSnapshot: async () => ({ snapshot: snapshotOf([]), integrity: EVICTED_STORAGE }),
    applySnapshot: async () => {},
    assertPulledSnapshot: async () => {},
    // SAFETY: as above.
    parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
  });

  const blob = await service.read();
  assert.deepEqual(blob.syncMeta.tombstones, [], 'the evicted device must publish no deletes');

  // THE SECOND DEVICE, healthy, holding both entries, pulling that blob. This
  // is the hop the production incident took: the tablet did nothing wrong and
  // still lost its rows.
  const peer = { current: snapshotOf(shared) };
  await runSyncCycleUnlocked({
    accountId: ACCOUNT_ID,
    dek,
    http: service.client,
    state: createSyncStateStore({ storage: createMemoryStorage(), accountId: ACCOUNT_ID }),
    deviceId: 'device-peer',
    readSnapshot: async () => ({ snapshot: peer.current, integrity: HEALTHY_STORAGE }),
    applySnapshot: async ({ merged }) => {
      peer.current = merged;
    },
    assertPulledSnapshot: async () => {},
    // SAFETY: as above.
    parseRemoteSnapshot: ({ snapshot }) => snapshot as SyncedSnapshot,
  });

  assert.deepEqual(
    peer.current.foodLogs.map((log) => log.id).toSorted(),
    ['log-a', 'log-b'],
    'a healthy peer must not delete its own rows to agree with a device that lost its copy',
  );
});
