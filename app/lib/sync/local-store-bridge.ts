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
import {
  deleteLocalFood,
  deleteLocalFoodLog,
  deleteLocalWeightEntry,
  exportBackup,
  importBackup,
  migrateEnvelopeForward,
  SCHEMA_VERSION,
  type LocalStoreSnapshot,
} from '#app/lib/local-store';

/** Reads the device's full health snapshot — the same lossless projection a backup export produces. */
export async function readLocalSnapshot(): Promise<LocalStoreSnapshot> {
  return (await exportBackup()).data;
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
}): LocalStoreSnapshot {
  return migrateEnvelopeForward({ schemaVersion, exportedAt: new Date(0).toISOString(), data: snapshot }).data;
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
  merged: LocalStoreSnapshot;
  local: LocalStoreSnapshot;
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
}
