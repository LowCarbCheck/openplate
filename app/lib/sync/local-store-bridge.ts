/**
 * The ONLY seam between sync and the local store.
 *
 * Everything sync does to the device's data happens through the functions
 * `app/lib/local-store` already exports — `exportBackup` to read, the
 * `putLocal*`/`deleteLocal*` pair to write. No second write path, no direct
 * TinyBase access, no reaching past `persist.ts` into IndexedDB. That is not
 * politeness: those functions are what take `persist.ts`'s save lock, dedupe
 * autosaves and keep the schema-version value honest, and a parallel writer
 * would quietly bypass all three (see `sync-lock.ts` for the ordering rule
 * this preserves).
 *
 * Keeping the seam in one small file also makes the blast radius of a
 * local-store refactor exactly one import list.
 */
import type { Store } from 'tinybase';
import {
  deleteLocalAiSettings,
  deleteLocalFood,
  deleteLocalFoodLog,
  deleteLocalWeightEntry,
  exportBackup,
  getLocalAiSettings,
  getLocalGatewayConnection,
  getLocalResearchIdentity,
  getLocalShareIdentity,
  importBackup,
  listLocalSharePeers,
  listLocalStudyEnrolments,
  migrateEnvelopeForward,
  putLocalAiSettings,
  putLocalGatewayConnection,
  SCHEMA_VERSION,
  type LocalGatewayConnection,
  type LocalStoreSnapshot,
} from '#app/lib/local-store';
import { decideGatewayConnectionApply, pickNewerGatewayConnection } from './gateway-connection-apply';
import {
  partitionSnapshot,
  readSealedPrivateStore,
  type OwnerPrivateRegion,
  type ShareableSnapshot,
  type SyncedSnapshot,
} from './snapshot-partition';

/**
 * Reads the device's full health snapshot — a backup export, PLUS the one key
 * an export deliberately omits.
 *
 * The two projections were identical until M187/02. They are not any more, and
 * the difference is the whole of "the gateway travels but is never exported":
 * `backup.ts`'s `readSnapshot` leaves `gatewayConnection` out because a backup
 * file must carry no provider credential, and this — the SYNC read path, whose
 * output is sealed into the owner-private compartment before it goes anywhere
 * — puts it back. This is the only producer that does, which is why the key is
 * optional on `LocalStoreSnapshot`.
 *
 * `store` is injectable for the tests that build a snapshot the way production
 * reads one; production passes nothing and gets the singleton stores.
 */
export async function readLocalSnapshot({ store }: { store?: Store } = {}): Promise<LocalStoreSnapshot> {
  return {
    ...(await exportBackup({ store })).data,
    gatewayConnection: await getLocalGatewayConnection({ store }),
  };
}

/**
 * Reads ONLY the owner-private region straight from the store.
 *
 * Exists so the apply path has a fallback that costs nothing when a pulled
 * compartment will not open (a slot rewrapped by another device mid-flight, a
 * blob from before the partition). Falling back to what is already on the
 * device means a compartment that cannot be read changes nothing, rather than
 * blanking a clinician's key pair to represent a failure.
 */
export async function readLocalOwnerPrivateRegion(): Promise<OwnerPrivateRegion> {
  return {
    shareIdentity: await getLocalShareIdentity(),
    sharePeers: await listLocalSharePeers(),
    researchIdentity: await getLocalResearchIdentity(),
    studyEnrolments: await listLocalStudyEnrolments(),
    gatewayConnection: await getLocalGatewayConnection(),
  };
}

/**
 * Validates and migrates a snapshot that arrived from another device.
 *
 * Reuses the BACKUP envelope's validator and forward-migration chain rather
 * than growing a second one: a blob and a backup file carry the identical
 * payload, so a snapshot that a restore would reject must not be silently
 * written into the store by sync. It also means a peer running an older
 * `SCHEMA_VERSION` is migrated forward by code that already exists and is
 * already tested.
 *
 * @throws when the payload is not a valid snapshot, or is from a NEWER schema
 * this build cannot safely down-convert. Both are refusals, not warnings —
 * writing a half-understood entity into someone's diary is worse than not
 * syncing.
 */
export function parseRemoteSnapshot({
  snapshot,
  schemaVersion,
}: {
  snapshot: unknown;
  schemaVersion: number;
}): SyncedSnapshot {
  const migrated = migrateEnvelopeForward({
    schemaVersion,
    exportedAt: new Date(0).toISOString(),
    data: snapshot,
  }).data;
  // The backup chain knows nothing about the compartment, so the two regions
  // are read separately and only the SHAREABLE half survives from it. A
  // pre-partition blob's plaintext `shareIdentity`/`sharePeers` are dropped
  // here rather than adopted: material written into the shareable region is
  // material a grantee may already hold, and re-adopting it would launder a
  // disclosure into the new format (`snapshot-partition.ts`).
  return { ...partitionSnapshot(migrated).shareable, privateStore: readSealedPrivateStore({ snapshot }) };
}

/**
 * Writes a merged snapshot onto the device.
 *
 * DELETES FIRST, then upserts. `importBackup` alone is upsert-only, so an
 * entity another device deleted would survive here forever and be re-uploaded
 * on the next cycle — the "the entry I deleted on my phone keeps coming back"
 * bug. The delete set is computed by comparing what is here now against what
 * the merge decided, so nothing is removed that the merge did not explicitly
 * resolve as a tombstone.
 */
export async function applyMergedSnapshot({
  merged,
  local,
}: {
  /** The full device shape — the shareable region the merge produced, recomposed with an OPENED compartment. */
  merged: LocalStoreSnapshot;
  /** Only the shareable region is needed here: every delete set below is computed from an id-bearing diary collection. */
  local: ShareableSnapshot;
}): Promise<void> {
  const survivingFoods = new Set(merged.foods.map((food) => food.id));
  const survivingLogs = new Set(merged.foodLogs.map((log) => log.id));
  const survivingWeights = new Set(merged.weightEntries.map((entry) => entry.id));
  // No `survivingFasts` set, on purpose (M132): fasts are not merged across
  // devices — `mergeSnapshots` hands `merged.fasts` straight back from the
  // LOCAL snapshot — so there is no remote tombstone that could authorise
  // deleting one. Computing a delete set here would be the bug: a peer running
  // an older build sends no fasts at all, and this loop would wipe every fast
  // on this device. The `importBackup` below re-upserts them unchanged.

  for (const food of local.foods) {
    if (!survivingFoods.has(food.id)) await deleteLocalFood(food.id);
  }
  for (const log of local.foodLogs) {
    if (!survivingLogs.has(log.id)) await deleteLocalFoodLog(log.id);
  }
  for (const entry of local.weightEntries) {
    if (!survivingWeights.has(entry.id)) await deleteLocalWeightEntry(entry.id);
  }

  await importBackup({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: merged });

  // The gateway connection is NOT written by `importBackup`: the backup
  // importer restores a device's own file, and this key is the one thing a
  // backup never carries. It is applied here instead, under the rule in
  // `gateway-connection-apply.ts`.
  await applyGatewayConnection({ synced: merged.gatewayConnection ?? null });
}

/**
 * Lands a synced gateway connection on this device — the impure half of
 * `gateway-connection-apply.ts` (M187/02).
 *
 * Two writes, in this order and for two different reasons. The connection row
 * is the ACCOUNT's record and is written whenever the merge produced a newer
 * one, so the next cycle re-uploads what this device now believes. The AI
 * settings row is this DEVICE's provider configuration, and is touched only
 * where the rule allows — never over a key its owner pasted, connected by
 * OAuth, or took from this instance's preset.
 */
async function applyGatewayConnection({ synced }: { synced: LocalGatewayConnection | null }): Promise<void> {
  const local = await getLocalGatewayConnection();
  const winner = pickNewerGatewayConnection({ synced, local });
  if (winner === null) return;
  if (winner !== local) await putLocalGatewayConnection(winner);

  const decision = decideGatewayConnectionApply({ connection: winner, settings: await getLocalAiSettings() });
  if (decision.action === 'write') await putLocalAiSettings(decision.settings);
  if (decision.action === 'clear') await deleteLocalAiSettings();
}
