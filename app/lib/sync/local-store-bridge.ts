/**
 * The ONLY seam between sync and the local store.
 *
 * Everything sync does to the device's data happens through the functions
 * `app/lib/local-store` already exports, `exportBackup` to read, the
 * `putLocal*`/`deleteLocal*` pair to write. No second write path, no direct
 * TinyBase access, no reaching past `persist.ts` into IndexedDB. That is not
 * politeness: those functions are what take `persist.ts`'s save lock, dedupe
 * autosaves and keep the schema-version value honest, and a parallel writer
 * would quietly bypass all three (see `sync-lock.ts` for the ordering rule
 * this preserves).
 *
 * ONE removal here is not a `deleteLocal*` call, and could not be:
 * `applyMergedSnapshot` removes rows a PEER deleted, which must not enter this
 * device's delete journal. It uses the store's own
 * `removeEntitiesWithoutJournal`, which is still a local-store function and
 * still takes the same lock, and is the only call site of it in the app.
 *
 * Keeping the seam in one small file also makes the blast radius of a
 * local-store refactor exactly one import list.
 */
import type { Store } from 'tinybase';
import { PRIMARY_DB_NAME } from '#app/lib/local-store/store';
import {
  getPrimaryStore,
  readPersistedTableRowCounts,
  storeRowCounts,
  type PersistedTablesProbe,
} from '#app/lib/local-store/persist';
import { removeEntitiesWithoutJournal } from '#app/lib/local-store/primary-store';
import {
  exportBackup,
  forgetDeletedEntityKeys,
  getLocalResearchIdentity,
  getLocalShareIdentity,
  importBackup,
  listDeletedEntityKeys,
  listLocalSharePeers,
  listLocalStudyEnrolments,
  migrateEnvelopeForward,
  SCHEMA_VERSION,
  type LocalStoreSnapshot,
} from '#app/lib/local-store';
import type { LocalStoreIntegrity } from './snapshot-sync';
import {
  partitionSnapshot,
  readSealedPrivateStore,
  type OwnerPrivateRegion,
  type ShareableSnapshot,
  type SyncedSnapshot,
} from './snapshot-partition';

/**
 * Reads the device's full health snapshot.
 *
 * IDENTICAL TO A BACKUP EXPORT AGAIN, as of M192. Between M187/02 and M192 it
 * was one key wider, it attached `gatewayConnection`, the gateway member
 * token a backup deliberately never carried, and that key went with the
 * gateway.
 *
 * IT MUST NOT GROW A SECOND IndexedDB READ. This function is on the PUSH path,
 * and the version that attached the gateway connection also peeked at the AI
 * store to repair a torn write. A peek was safe; an `await` on that store's
 * load would make every push depend on a database this device may never open,
 * which is a sync that hangs with nothing on screen to say so.
 *
 * The store is injectable for the tests that build a snapshot the way
 * production reads one; production passes nothing and gets the singleton.
 */
export interface LocalSnapshotRead {
  snapshot: LocalStoreSnapshot;
  /** What this read can prove about the device's storage. See {@link LocalStoreIntegrity}. */
  integrity: LocalStoreIntegrity;
  /**
   * The deletes this device has RECORDED and not yet published, as entity keys
   * (`SnapshotIntegrity.deletedEntityKeys`).
   *
   * Read here, off the same store and in the same act as the snapshot, rather
   * than fetched separately by the stamping. A journal read a moment later
   * could describe a different device: a delete that landed in between would be
   * authorised against a snapshot that still holds the row, and a delete that
   * landed just before would not.
   *
   * NOT part of {@link LocalStoreIntegrity}, which is the disk-versus-memory
   * comparison and is also handed to `mergeSnapshots`. The journal answers a
   * different question and only the stamping asks it.
   */
  deletedEntityKeys: ReadonlySet<string>;
}

export async function readLocalSnapshot({ store }: { store?: Store } = {}): Promise<LocalSnapshotRead> {
  const resolved = store ?? (await getPrimaryStore());
  const snapshot = (await exportBackup({ store: resolved })).data;
  return {
    snapshot,
    integrity: await readStoreIntegrity(resolved),
    deletedEntityKeys: new Set(await listDeletedEntityKeys({ store: resolved })),
  };
}

/**
 * Drops the journal rows for deletes that are now agreed.
 *
 * Takes every tombstone key in the payload the cycle just committed, not only
 * the ones this device minted: a tombstone in the committed baseline is
 * carried forward by every later cycle whoever wrote it, so the journal row
 * behind it has nothing left to authorise. Keys the journal does not hold are
 * ignored.
 */
export async function forgetPublishedDeletes(keys: readonly string[]): Promise<void> {
  await forgetDeletedEntityKeys(keys);
}

/**
 * The disk's opinion of what is in memory.
 *
 * THE SECOND READ THIS FUNCTION MAKES IS THE SAME DATABASE, and that is why
 * the ban above allows it: `readPersistedTableRowCounts` opens
 * `openplate-primary`, reads its table object store and closes it again. It is
 * not a second database this device may never have opened, which is the thing
 * the ban is about. (`persist.ts` holds no reusable handle to share: the
 * TinyBase persister owns its own connection and does not expose it, and this
 * probe is deliberately written to open, read and close without ever creating
 * the database as a side effect.)
 *
 * A FAILED PROBE IS TREATED AS NO DATABASE. Nothing is trusted from a read
 * that threw, and "no database" is the answer that withholds every tombstone,
 * which is the direction that keeps the diary.
 */
async function readStoreIntegrity(store: Store): Promise<LocalStoreIntegrity> {
  const probe = await readPersistedTableRowCounts(PRIMARY_DB_NAME).catch(
    (): PersistedTablesProbe => ({ kind: 'absent' }),
  );
  // `absent` AND `blocked` BOTH ANSWER "cannot speak for it". They are
  // different facts, one is "nothing was ever saved" and the other is "another
  // tab is holding the database open", and `persist.ts` must tell them apart
  // before it primes.
  // Here they collapse honestly: neither one read a single row, so neither one
  // may be read as a diary somebody emptied.
  if (probe.kind !== 'present') return { hasPersistedDatabase: false, isTableLoaded: {} };

  const persisted = probe.counts;
  const inMemory = storeRowCounts(store);
  const isTableLoaded: Record<string, boolean> = {};
  for (const table of new Set([...Object.keys(persisted), ...Object.keys(inMemory)])) {
    // EQUALITY, AND MEMORY MAY RUN AHEAD. A table the disk holds MORE of than
    // memory does is a partial or failed load, and nothing about it can be
    // read as a delete. Memory ahead of disk is an unsaved write, which is
    // ordinary and says nothing against a delete beside it.
    isTableLoaded[table] = (persisted[table] ?? 0) <= (inMemory[table] ?? 0);
  }
  return { hasPersistedDatabase: true, isTableLoaded };
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
 * this build cannot safely down-convert. Both are refusals, not warnings ,
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
 * on the next cycle, the "the entry I deleted on my phone keeps coming back"
 * bug. The delete set is computed by comparing what is here now against what
 * the merge decided, so nothing is removed that the merge did not explicitly
 * resolve as a tombstone.
 */
export async function applyMergedSnapshot({
  merged,
  local,
}: {
  /** The full device shape, the shareable region the merge produced, recomposed with an OPENED compartment. */
  merged: LocalStoreSnapshot;
  /** Only the shareable region is needed here: every delete set below is computed from an id-bearing diary collection. */
  local: ShareableSnapshot;
}): Promise<void> {
  const survivingFoods = new Set(merged.foods.map((food) => food.id));
  const survivingLogs = new Set(merged.foodLogs.map((log) => log.id));
  const survivingWeights = new Set(merged.weightEntries.map((entry) => entry.id));
  // No `survivingFasts` set, on purpose (M132): fasts are not merged across
  // devices, `mergeSnapshots` hands `merged.fasts` straight back from the
  // LOCAL snapshot, so there is no remote tombstone that could authorise
  // deleting one. Computing a delete set here would be the bug: a peer running
  // an older build sends no fasts at all, and this loop would wipe every fast
  // on this device. The `importBackup` below re-upserts them unchanged.
  //
  // No surviving-set for `fastingSettings` either, but for the OPPOSITE
  // reason, it IS merged (`snapshot-sync.ts`). It is a SINGLETON with no id
  // so there is no set to diff: the merge hands back one record or `null`, and
  // `importBackup` writes it whole through `putLocalFastingSettingsRecord`.
  // A `null` means no device has ever set a routine, and this path deliberately
  // does not delete on it: the local row, if there is one, is what the merge
  // was built from.

  // NOT THROUGH `deleteLocalFood` AND FRIENDS, on purpose. Those verbs write
  // the DELETE JOURNAL, and the journal means one thing: a delete THIS DEVICE
  // performed. Every row removed here was deleted somewhere else, and a device
  // that records a peer's delete as its own can mint a second, LATER tombstone
  // for it on a cycle that never reached its commit, burying an entity the
  // peer has since re-added. See `removeEntitiesWithoutJournal`.
  await removeEntitiesWithoutJournal({
    reason: 'applied-a-peer-tombstone',
    foodIds: local.foods.filter((food) => !survivingFoods.has(food.id)).map((food) => food.id),
    foodLogIds: local.foodLogs.filter((log) => !survivingLogs.has(log.id)).map((log) => log.id),
    weightEntryIds: local.weightEntries.filter((entry) => !survivingWeights.has(entry.id)).map((entry) => entry.id),
  });

  await importBackup({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: merged });
}
