/**
 * The share key pair and its pinned peers, where they meet the SNAPSHOT
 * (M160/04, `openplate-sync` ADR-0002).
 *
 * Three claims are pinned here, and each has a silent failure mode:
 *
 *  1. A v12 backup still imports. Two REQUIRED keys were added to
 *     `LocalStoreSnapshot`, so without `backup.ts`'s two defaults every
 *     existing backup file on every device becomes un-importable — the exact
 *     trap the `fasts` and `savedMeals` bumps documented before this one.
 *  2. Both survive an export/import round trip. zod STRIPS unrecognized keys,
 *     so a missing line in `snapshotSchema` would drop a clinician's share
 *     PRIVATE KEY on every export and every sync push, invisibly, until a
 *     patient's wrap stopped opening on a restored device.
 *  3. They are MERGED, not passed through from the local side like `fasts`
 *     and `savedMeals`. A pass-through would leave a clinician's second
 *     device with `shareIdentity: null` and no error anywhere — she would
 *     simply see no patients, on a device that looks perfectly healthy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateEnvelopeForward } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import { mergeSnapshots, SYNC_ENTITY_TYPES } from '../../app/lib/sync/snapshot-sync';
import type { StampedSnapshot } from '../../app/lib/sync/snapshot-sync';
import type { LocalShareIdentity, LocalSharePeer, LocalStoreSnapshot } from '../../app/lib/local-store/schema';

const IDENTITY: LocalShareIdentity = {
  publicKeyRaw: 'BJ5xqpaxdRXhW/pVMrRoOGVNCKwhYIhtOI5TsZOQHlZfafThmD/jzLa7ulU7SaqZmKqLxzb2stZMpUFaI2o12I0=',
  privateKeyPkcs8: 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg',
  createdAt: 1_700_000_000_000,
};

function peer(accountId: number): LocalSharePeer {
  return {
    id: String(accountId),
    accountId,
    publicKeyRaw: `key-for-${accountId}`,
    label: 'Dr. Meier',
    createdAt: 1_700_000_000_000 + accountId,
  };
}

function snapshot(overrides: Partial<LocalStoreSnapshot> = {}): LocalStoreSnapshot {
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    shareIdentity: null,
    sharePeers: [],
    ...overrides,
  };
}

function payload(overrides: Partial<LocalStoreSnapshot> = {}): StampedSnapshot {
  return { snapshot: snapshot(overrides), meta: { perEntity: {}, tombstones: [] } };
}

describe('the local schema version', () => {
  it('is 13 — the clinician-sharing bump', () => {
    assert.equal(SCHEMA_VERSION, 13);
  });
});

describe('a v12 backup envelope', () => {
  it('migrates forward to v13 with no share key and no pinned peers', () => {
    const migrated = migrateEnvelopeForward({
      schemaVersion: 12,
      exportedAt: '2026-08-20T10:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], profile: null, fasts: [], savedMeals: [] },
    });

    assert.equal(migrated.schemaVersion, 13);
    assert.equal(migrated.data.shareIdentity, null);
    assert.deepEqual(migrated.data.sharePeers, []);
  });
});

describe('the share identity in a backup envelope', () => {
  it('survives the validator instead of being stripped as an unrecognized key', () => {
    const migrated = migrateEnvelopeForward({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-08-27T10:00:00.000Z',
      data: snapshot({ shareIdentity: IDENTITY, sharePeers: [peer(7)] }),
    });

    assert.deepEqual(migrated.data.shareIdentity, IDENTITY);
    assert.deepEqual(migrated.data.sharePeers, [peer(7)]);
  });
});

describe('mergeSnapshots and the share identity', () => {
  it('lists both share entity types in the synced catalog', () => {
    assert.equal(SYNC_ENTITY_TYPES.shareIdentity, 'shareIdentity');
    assert.equal(SYNC_ENTITY_TYPES.sharePeer, 'sharePeer');
  });

  it('ADOPTS the remote key pair on a device that has none — the second-device case', () => {
    const merged = mergeSnapshots({
      local: payload(),
      remote: {
        snapshot: snapshot({ shareIdentity: IDENTITY }),
        meta: { perEntity: { 'shareIdentity:me': { lamport: 1, deviceId: 'phone' } }, tombstones: [] },
      },
    });

    assert.deepEqual(merged.snapshot.shareIdentity, IDENTITY);
  });

  it('adopts a peer pinned on another device', () => {
    const merged = mergeSnapshots({
      local: payload({ sharePeers: [peer(1)] }),
      remote: {
        snapshot: snapshot({ sharePeers: [peer(2)] }),
        meta: { perEntity: { 'sharePeer:2': { lamport: 1, deviceId: 'phone' } }, tombstones: [] },
      },
    });

    assert.deepEqual(merged.snapshot.sharePeers.map((pinned) => pinned.accountId).toSorted(), [1, 2]);
  });

  it('keeps the local key pair when the remote payload has none', () => {
    const merged = mergeSnapshots({
      local: {
        snapshot: snapshot({ shareIdentity: IDENTITY }),
        meta: { perEntity: { 'shareIdentity:me': { lamport: 3, deviceId: 'laptop' } }, tombstones: [] },
      },
      remote: payload(),
    });

    assert.deepEqual(merged.snapshot.shareIdentity, IDENTITY);
  });
});
