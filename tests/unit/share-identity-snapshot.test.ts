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
 *  3. They stay in the LOCAL shape and the BACKUP file after the M160/07
 *     partition. Only the SYNCED blob compartments them, because only a blob
 *     is ever handed to a second person — a backup that dropped the share key
 *     would leave a restored device unable to open a single patient's wrap.
 *
 * The MERGE claims that used to live here moved to
 * `tests/unit/snapshot-partition.test.ts`, which owns the compartment: the
 * two entities are no longer synced entities of their own.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateEnvelopeForward } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
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
    researchIdentity: null,
    studyEnrolments: [],
    ...overrides,
  };
}

describe('the local schema version', () => {
  it('is 16 — the submitted-research-window bump (M163/01)', () => {
    assert.equal(SCHEMA_VERSION, 16);
  });
});

describe('a v12 backup envelope', () => {
  it('migrates forward with no share key and no pinned peers', () => {
    const migrated = migrateEnvelopeForward({
      schemaVersion: 12,
      exportedAt: '2026-08-20T10:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], profile: null, fasts: [], savedMeals: [] },
    });

    assert.equal(migrated.schemaVersion, 16);
    assert.equal(migrated.data.shareIdentity, null);
    assert.deepEqual(migrated.data.sharePeers, []);
    // And the v15 keys default the same way, which is the whole of the v14 ->
    // v15 forward migration: "this device had no research identity, because
    // contributing did not exist".
    assert.equal(migrated.data.researchIdentity, null);
    assert.deepEqual(migrated.data.studyEnrolments, []);
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
