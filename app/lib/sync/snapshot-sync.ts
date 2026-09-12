/**
 * The PURE core of sync: turning a local-store snapshot into a stamped sync
 * payload, and merging two payloads into one. No fetch, no crypto, no
 * IndexedDB, no clock, everything here is a function of its arguments, which
 * is what makes convergence testable without a server (`functional-core`).
 *
 * ── Where the Lamport stamps come from ────────────────────────────────────
 *
 * The app's write paths (`primary-store.ts`, every route's `clientAction`)
 * know nothing about sync and were deliberately left that way: threading a
 * "bump the sync counter" call through every one of them would put sync in the
 * blast radius of every future feature, and a single missed call site produces
 * a silently non-converging device.
 *
 * Instead each sync cycle DIFFS the current snapshot against the last-synced
 * BASELINE (per-entity content hashes kept in `sync-state.ts`):
 *   - content changed  → `lamport = previous + 1`, stamped with THIS device
 *   - content the same → the previous stamp is carried forward untouched
 *   - entity gone      → a tombstone at `previous + 1`
 *   - entity is back   → a live stamp above any tombstone for it (resurrection)
 *
 * This is a genuine Lamport clock, a stamp only advances when something
 * actually happened, and it costs the rest of the app exactly nothing. The
 * price is granularity: an edit-then-undo between two syncs is invisible,
 * which is the correct outcome anyway.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * Conflict resolution is whole-record last-writer-wins per entity, ordered by
 * `(lamport, deviceId)`, `PROTOCOL.md` §3.3's accepted v1 trade-off. Two
 * devices editing the SAME entry offline means the lower stamp is dropped
 * silently. No field-level merge, no conflict UI. Wall-clock time is never an
 * ordering authority: it drifts, and across devices it is routinely wrong.
 */
import { mergeEntityMaps } from './engine/merge/merge-entities';
import type { MergeCandidate, Tombstone } from './engine/merge/types';
import type { SyncMetaPayload } from './engine/envelope/types';
import type {
  LocalFastingSettings,
  LocalFoodLog,
  LocalPersonalFood,
  LocalProfileGoals,
  LocalWeightEntry,
} from '#app/lib/local-store';
import {
  entityKey as buildEntityKey,
  DELETE_JOURNAL_TAG_BY_TABLE,
  FASTING_SETTINGS_TABLE,
  FASTS_TABLE,
  FOOD_LOGS_TABLE,
  PERSONAL_FOODS_TABLE,
  PROFILE_GOALS_TABLE,
  SAVED_MEALS_TABLE,
  SYNC_ENTITY_TYPE_BY_TABLE,
  WEIGHT_ENTRIES_TABLE,
} from '#app/lib/local-store/schema';
import type { SealedPrivateStore, SyncedSnapshot } from './snapshot-partition';

/** The entity-type tags that appear in tombstones and in namespaced entity keys. */
export const SYNC_ENTITY_TYPES = {
  food: SYNC_ENTITY_TYPE_BY_TABLE[PERSONAL_FOODS_TABLE],
  log: SYNC_ENTITY_TYPE_BY_TABLE[FOOD_LOGS_TABLE],
  weight: SYNC_ENTITY_TYPE_BY_TABLE[WEIGHT_ENTRIES_TABLE],
  profile: SYNC_ENTITY_TYPE_BY_TABLE[PROFILE_GOALS_TABLE],
  /**
   * THE FASTING ROUTINE (the fasting rework), the singleton settings record.
   *
   * It is MERGED, exactly like `profile` above it, and NOT passed through from
   * the local side like `fasts` and `savedMeals` below. The difference is the
   * one that matters: a fast is an EVENT, and "at most one open fast" across
   * two devices is a question with two truthful answers, while a routine is a
   * PREFERENCE, and a person who sets their window on a phone means it on
   * their tablet too. A pass-through would leave the second device blank and
   * look like it had worked.
   *
   * WHOLE-RECORD LAST-WRITER-WINS, ordered by `(lamport, deviceId)` like every
   * other merged entity, NOT by the record's own `updatedAt`. Wall-clock time
   * is never an ordering authority here (see this file's header): it drifts,
   * and across two devices it is routinely wrong. `updatedAt` still earns its
   * place, because it feeds the content hash, so an edit that changes nothing
   * else still reads as a change and still pushes.
   *
   * The granularity is the whole record, so two devices that each change a
   * different field while offline keep only the later one's record. That is
   * the same accepted §3.3 trade-off the profile row has always carried, and
   * a routine is re-set in two taps.
   */
  fastingSettings: SYNC_ENTITY_TYPE_BY_TABLE[FASTING_SETTINGS_TABLE],
  /**
   * THE OWNER-PRIVATE COMPARTMENT (M160/07, `openplate-core` ADR-0002's
   * partition amendment), one entity holding the sealed ciphertext and its
   * two CDK wraps.
   *
   * It is MERGED rather than passed through from the local side like `fasts`
   * and `savedMeals`, and the difference is the whole point: a clinician's
   * second device pulls the blob and must ADOPT the key pair inside, or every
   * share her patients granted is unopenable there. A pass-through would keep
   * `null` and look like it worked.
   *
   * WHOLE-COMPARTMENT GRANULARITY IS ACCEPTED, and it is a real trade-off: the
   * key pair and every pinned peer move as ONE last-writer-wins entity, so two
   * devices that each pin a different clinician while offline keep only the
   * later one's list. Per-entity granularity is impossible without leaving the
   * entity boundaries visible in the shareable region, which is the disclosure
   * this partition exists to remove. Pinning is a rare, deliberate act
   * performed with both people in one room; losing a race between two of them
   * is recoverable by repeating the ceremony.
   */
  privateStore: 'privateStore',
} as const;

/** The fixed entity id of the singleton profile row, it has no id of its own. */
export const PROFILE_ENTITY_ID = 'me';

/** The fixed entity id of the singleton compartment, one per account, so it has no id of its own either. */
export const PRIVATE_STORE_ENTITY_ID = 'me';

/** The fixed entity id of the singleton fasting settings record, one routine per person, so it has no id of its own. */
export const FASTING_SETTINGS_ENTITY_ID = 'me';

/** The namespaced key the compartment occupies in `perEntity`. One place, so the rewrap path and the merge cannot disagree. */
export const PRIVATE_STORE_ENTITY_KEY = `${SYNC_ENTITY_TYPES.privateStore}:${PRIVATE_STORE_ENTITY_ID}`;

/** One entity's ordering stamp plus the content hash that decides whether it changed. Device-local; the hash never goes on the wire. */
export interface StampedEntity {
  lamport: number;
  deviceId: string;
  /** Content hash of the entity as of the last sync. Absent from the wire payload, it is baseline bookkeeping, not protocol. */
  hash: string;
}

/** The last-synced baseline this device compares against. */
export interface SyncBaseline {
  perEntity: Record<string, StampedEntity>;
  tombstones: Tombstone[];
  /**
   * The ids the two PASS-THROUGH collections held in the payload this device
   * last agreed with.
   *
   * Not in `perEntity`, deliberately and permanently. That record drives the
   * stamping, so an id in it would be diffed, stamped and tombstoned, which is
   * the merge these two collections do not have. This is a plain list of ids
   * and it answers one question: which fasts and saved meals did the account
   * hold last time this device looked? `mergeSnapshots` lets the local list
   * stand only when every one of those ids is still in it or is named in the
   * delete journal, so an emptiness has to be accounted for before it is
   * published.
   *
   * OPTIONAL FOR ONE CYCLE, which is the migration. A baseline written before
   * this field existed has no record of what the account held, so nothing can
   * be accounted for, the table reads as untrusted, and the REMOTE list wins
   * that cycle. `applyMergedSnapshot` computes no delete set for these two, so
   * `importBackup` upserts the account's list beside the device's own rows and
   * nothing local is lost. The baseline this cycle commits carries the ids, and
   * every later cycle is the ordinary case.
   */
  passThrough?: {
    fasts: string[];
    savedMeals: string[];
  };
}

/** A stamped payload, ready to encrypt (or just merged out of two others). */
export interface StampedSnapshot {
  snapshot: SyncedSnapshot;
  meta: SyncMetaPayload;
}

/**
 * Namespaced entity key: `personalFood:abc`. Namespacing prevents a food and a
 * log that share an id from colliding.
 *
 * RE-EXPORTED, NOT REDEFINED. The local store's delete journal is keyed the
 * same way and writes its rows through the same function, so a second spelling
 * here would record deletes under keys this file never looks up, a failure
 * that is silent and always in the direction of losing somebody's delete.
 */
export const entityKey = buildEntityKey;

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/**
 * The hasher is generic over its input on purpose.
 *
 * It walks whatever it is handed structurally, a `LocalFoodLog`, a stamped
 * payload, a nested array, a number, and every caller passes a value whose
 * type is already known at the call site, so the type parameter carries that
 * knowledge through instead of throwing it away. A recursive JSON type would
 * not work here: the local-store entities are `interface`s, which TypeScript
 * refuses to assign to an index-signature type.
 */

/**
 * Deterministic JSON with sorted object keys.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * entities written by different code paths can serialize differently, which
 * would read as "changed" on every single sync and re-push the whole store
 * forever. Sorting the keys removes that.
 */
export function stableStringify<T>(value: T): string {
  if (!(value instanceof Object)) return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .toSorted(([a], [b]) =>
      a < b ? -1
      : a > b ? 1
      : 0,
    );
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

/**
 * 64-bit FNV-1a, as two interleaved 32-bit lanes, rendered hex.
 *
 * 64 bits rather than 32 because a hash collision here is not a crash but a
 * SILENTLY unsynced edit, the change-detection would say "unchanged" and the
 * entity would never leave the device. Two 32-bit lanes are used instead of
 * BigInt purely for speed: this runs over every entity on every sync.
 */
export function contentHash<T>(value: T): string {
  const text = stableStringify(value);
  let lowHash = 0x811c9dc5;
  let highHash = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    lowHash = Math.imul(lowHash ^ code, 0x01000193) >>> 0;
    highHash = Math.imul(highHash ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return lowHash.toString(16).padStart(8, '0') + highHash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Stamping: snapshot + baseline -> stamped payload
// ---------------------------------------------------------------------------

/** The local-store records sync carries, everything `flattenSnapshot` can produce. */
export type SyncEntityValue =
  LocalPersonalFood | LocalFoodLog | LocalWeightEntry | LocalProfileGoals | LocalFastingSettings | SealedPrivateStore;

interface FlatEntity {
  key: string;
  entityType: string;
  entityId: string;
  value: SyncEntityValue;
}

/** Flattens a snapshot into one addressable list, so stamping/merging is written once rather than four times. */
function flattenSnapshot(snapshot: SyncedSnapshot): FlatEntity[] {
  const flattened: FlatEntity[] = [
    ...snapshot.foods.map((food) => toFlat(SYNC_ENTITY_TYPES.food, food.id, food)),
    ...snapshot.foodLogs.map((log) => toFlat(SYNC_ENTITY_TYPES.log, log.id, log)),
    ...snapshot.weightEntries.map((entry) => toFlat(SYNC_ENTITY_TYPES.weight, entry.id, entry)),
  ];
  if (snapshot.profile !== null) {
    flattened.push(toFlat(SYNC_ENTITY_TYPES.profile, PROFILE_ENTITY_ID, snapshot.profile));
  }
  // `null` means this device has never set a routine, and a device with no
  // answer must not be stamped as holding one, an empty record competing in
  // the merge would blank a peer's real routine on the first cycle.
  if (snapshot.fastingSettings !== null) {
    flattened.push(toFlat(SYNC_ENTITY_TYPES.fastingSettings, FASTING_SETTINGS_ENTITY_ID, snapshot.fastingSettings));
  }
  if (snapshot.privateStore !== null) {
    flattened.push(toFlat(SYNC_ENTITY_TYPES.privateStore, PRIVATE_STORE_ENTITY_ID, snapshot.privateStore));
  }
  return flattened;
}

function toFlat(entityType: string, entityId: string, value: SyncEntityValue): FlatEntity {
  return { key: entityKey(entityType, entityId), entityType, entityId, value };
}

// ---------------------------------------------------------------------------
// Evidence: what makes an absence a deletion
// ---------------------------------------------------------------------------

/**
 * ABSENCE IS NOT DELETION.
 *
 * The baseline lives in `localStorage`; the diary lives in IndexedDB. A
 * browser may evict the second and keep the first, and when it does, every
 * entity this device ever synced is missing from the live snapshot while the
 * baseline still names it. Read naively that is indistinguishable from "the
 * person deleted everything", and the difference is a whole diary: a real
 * account lost hers in production to exactly this, and the tombstones spread
 * to her second, healthy device on its next pull.
 *
 * So a tombstone needs POSITIVE EVIDENCE that a delete happened. There are two
 * kinds of it here, and they are not equals.
 *
 * THE AUTHORITY is the DELETE JOURNAL, `SnapshotIntegrity.deletedEntityKeys`:
 * the app writes a key down when it removes a row, in the same transaction and
 * the same database. See that field, and `local-store/schema.ts`, for why
 * co-location is what makes it evidence.
 *
 * THIS RECORD IS THE SECOND SIGNAL, kept but demoted (M225). It is a physical
 * equality between what is on disk and what is in memory, never a ratio and
 * never a threshold. It cannot authorise a tombstone, because disk and memory
 * agree perfectly at zero in every state this rule exists to catch: after
 * `persist.ts` primes a fresh database, after the `t`-store-emptied incident,
 * and after a real total delete. Agreement between two things that failed
 * together is not evidence. What it still does is REFUSE: a table whose disk
 * copy is ahead of its memory copy was half read, and nothing about it can be
 * called a delete even with a journal row beside it. It also carries the
 * partial-load case for `mergeSnapshots`'s two pass-through collections, which
 * have no tombstones and therefore no journal.
 */
export interface LocalStoreIntegrity {
  /**
   * Does the device's IndexedDB database still exist?
   *
   * `false` is `readPersistedTableRowCounts` answering `null`: no database, or
   * one with no table object store. On a device whose baseline is non-empty
   * that is eviction, and NO tombstone may be written from it.
   */
  hasPersistedDatabase: boolean;
  /**
   * Per store table: did every row on disk reach memory?
   *
   * `true` when the disk count equals the memory count (zero and zero
   * included) and when memory is AHEAD of disk, which is an ordinary unsaved
   * write. `false` only when the disk holds MORE than memory does, which is a
   * partial or failed load and has no honest reading as a delete.
   *
   * A table absent from the record is absent from both sides, so it is agreed
   * by definition and readers default it to `true`.
   */
  isTableLoaded: Record<string, boolean>;
}

/** Everything {@link stampSnapshot} weighs before it writes a tombstone. */
export interface SnapshotIntegrity extends LocalStoreIntegrity {
  /**
   * THE AUTHORITY (M225): the entity keys this device WROTE DOWN as deleted.
   *
   * Read out of the delete journal (`local-store/primary-store.ts`), which the
   * delete verbs write in the same transaction as the row removal and in the
   * same database as the diary. A key that is not in here was not deleted by
   * this device, whatever the baseline says about it, so no tombstone is minted
   * for it.
   *
   * Co-location is what makes it evidence rather than another proxy. The
   * journal fails together with the diary: an evicted database takes both, an
   * emptied `t` store takes both, and a freshly primed database has neither.
   * The disk-versus-memory comparison below cannot say that, because disk and
   * memory agree perfectly at zero in every one of those states.
   */
  deletedEntityKeys: ReadonlySet<string>;
  /**
   * Has this session READ the owner-private compartment?
   *
   * `false` is `sealOwnerPrivateRegion` answering `unknown`: no pull has
   * carried a compartment into this session yet, so a snapshot with no
   * compartment in it says nothing about whether the account has one. Every
   * RESUMED session starts here, and every one of them tombstoned the
   * compartment on its first cycle before this field existed.
   */
  isCompartmentKnown: boolean;
  /**
   * Did the seal HOLD the compartment: re-emit the account's bytes because the
   * region it was handed had lost rows nobody wrote down (M226)?
   *
   * `true` is `sealOwnerPrivateRegion` answering `held`. The push is
   * byte-identical to the account's own copy, so nothing is destroyed, and
   * this device's real owner-private changes are NOT published either. That is
   * the same silent cost a withheld tombstone carries, so it is reported the
   * same way: a `privateStore` entry in {@link StampSnapshotResult.withheld},
   * which forbids `shrinkAcknowledged` and fires the heal log.
   *
   * NARROWER THAN {@link SnapshotIntegrity.isCompartmentUnpublished}, and this
   * is the one that must stay narrow. A hold is a shrink the device meant and
   * could not prove, which is worth a notice; the other three unpublished
   * answers include every boot's first cycle, and reporting those here would
   * put a heal notice on each launch and turn `shrinkAcknowledged` off for the
   * first ordinary delete of every session.
   *
   * REQUIRED, like every other field here, and for the reason the whole
   * interface exists: a correctness argument nobody is forced to pass is a
   * correctness argument at zero call sites. It spent M226 optional only
   * because one test file was locked while another worker held it.
   */
  isCompartmentHeld: boolean;
  /**
   * Did this cycle publish NONE of this device's owner-private removals
   * (M228)?
   *
   * The delete journal's prune is keyed on this and on nothing else: a journal
   * row may be spent only after a cycle whose seal wrote this device's region.
   * `describeCompartmentPublication` (`private-store.ts`) is the only producer,
   * and it answers `true` for a held compartment, for a re-emitted `sealed`,
   * and for the `unknown` that EVERY RESUMED SESSION'S FIRST CYCLE gets, the
   * one the held-only reading missed, which spent the un-pin of the tab that
   * closed and let the apply write the peer back.
   *
   * Implied by {@link SnapshotIntegrity.isCompartmentHeld}: a hold publishes
   * nothing, so a `true` there with a `false` here is an incoherent device.
   */
  isCompartmentUnpublished: boolean;
}

/**
 * Which store table each merged entity type is kept in.
 *
 * The link between the disk evidence, which is per table, and a tombstone,
 * which is per entity. `privateStore` is deliberately absent: the compartment
 * is not a table on disk at all, and its evidence is
 * {@link SnapshotIntegrity.isCompartmentKnown}.
 */
const ENTITY_TYPE_TABLES: Record<string, string> = Object.fromEntries(
  Object.entries(SYNC_ENTITY_TYPE_BY_TABLE).map(([table, entityType]) => [entityType, table]),
);

/**
 * May this device say that this entity was DELETED, rather than that it cannot
 * see it?
 *
 * Called only for a NEW tombstone, one this cycle would mint from an entity
 * the baseline names and the snapshot does not. A tombstone already in the
 * baseline is a delete this device published in an earlier cycle and every
 * peer has agreed with; withholding those would resurrect the rows they
 * buried.
 */
function isTombstoneTrusted({
  key,
  entityType,
  integrity,
}: {
  /** The namespaced key, the same string the delete journal records. */
  key: string;
  entityType: string;
  integrity: SnapshotIntegrity;
}): boolean {
  if (entityType === SYNC_ENTITY_TYPES.privateStore) {
    // THE COMPARTMENT IS NOT IN THE JOURNAL, and must not be asked for. It is
    // not a store table, so no `delete*` verb records it, and requiring a
    // journal row here would make the compartment un-tombstonable for good,
    // a device whose owner really did delete their share identity could never
    // say so. Its positive evidence is `isCompartmentKnown`, which answers the
    // same question the journal answers for a table: has this device actually
    // READ the thing it is about to declare gone?
    return integrity.isCompartmentKnown && integrity.hasPersistedDatabase;
  }
  // THE JOURNAL FIRST, AND IT IS THE AUTHORITY. The baseline only says what
  // was once synced; it says nothing at all about why an entity is missing
  // now. Only the journal says a delete HAPPENED.
  if (!integrity.deletedEntityKeys.has(key)) return false;
  // The tag comes off a baseline key, which is a string, so this lookup is a
  // widening one on purpose: an entity type this map does not name is exactly
  // the case the `undefined` branch below refuses.
  const table = ENTITY_TYPE_TABLES[entityType];
  // An entity type nobody has mapped to a table has no evidence behind it, and
  // the fail-safe direction is to keep the data.
  if (table === undefined) return false;
  // SECOND, AND KEPT: the disk-versus-memory comparison is no longer what
  // authorises a tombstone, but it still refuses one from a table this device
  // only half read, where a journal row could be genuine and the snapshot
  // around it still wrong. Defence in depth, and `mergeSnapshots` reads the
  // same record for the two pass-through collections.
  return isTableTrusted({ table, integrity });
}

/**
 * Can this device speak for what one store table currently holds?
 *
 * BOTH SIGNALS, ALWAYS, and neither one alone is enough:
 *
 * - `hasPersistedDatabase` is false when there is no database to compare
 *   against, and `isTableLoaded` is then `{}`, so every per-table lookup
 *   falls back to `true`. A per-table check on its own would therefore call an
 *   evicted device perfectly healthy, which is the exact failure this whole
 *   rule exists to stop.
 * - `isTableLoaded[table]` is false when the disk holds MORE of that one table
 *   than memory does. The database is still there, so the whole-database
 *   signal says nothing about it, and a check on that signal alone would trust
 *   a list the device only half read.
 *
 * A table nobody wrote is absent from both sides, so it is agreed by
 * definition and defaults to `true`.
 */
export function isTableTrusted({ table, integrity }: { table: string; integrity: LocalStoreIntegrity }): boolean {
  if (!integrity.hasPersistedDatabase) return false;
  return integrity.isTableLoaded[table] ?? true;
}

/** What one stamping pass produces: the wire meta to send, and the baseline to persist alongside it. */
export interface StampSnapshotResult {
  meta: SyncMetaPayload;
  baseline: SyncBaseline;
  /**
   * The tombstones this cycle MINTED, the deletes that are new in this push.
   *
   * A strict subset of `meta.tombstones`, which also carries every tombstone
   * the baseline already held. The difference is the whole point: the baseline
   * NEVER COMPACTS its tombstones, so `meta.tombstones.length > 0` is true
   * forever after a device's first delete, and a shrink acknowledgement
   * computed from it acknowledges every push that device will ever make. That
   * defeats the service's guard entirely, on exactly the devices that have
   * deleted something before.
   */
  minted: Tombstone[];
  /**
   * The tombstones this cycle DECLINED to write, because the evidence did not
   * support them.
   *
   * Absent from `meta` and absent from `baseline` on purpose: a withheld
   * tombstone that landed in the baseline would be carried forward as an
   * agreed delete by the very next cycle, which is the same loss one cycle
   * later. It is returned instead so the shell can say so, out loud, and heal
   * the device.
   */
  withheld: Tombstone[];
}

/**
 * Stamps the current snapshot against the last-synced baseline.
 *
 * Returns BOTH the wire meta (no hashes, the service never sees them) and the
 * refreshed baseline, so the caller persists exactly what it just sent.
 */
export function stampSnapshot({
  snapshot,
  baseline,
  deviceId,
  integrity,
}: {
  snapshot: SyncedSnapshot;
  baseline: SyncBaseline;
  deviceId: string;
  /**
   * REQUIRED, and not optional with a permissive default (M224).
   *
   * A correctness argument nobody is forced to pass is a correctness argument
   * at zero call sites: the gate compiles, the suite is green, and every
   * screen is still wrong. Making it required is what puts the question in
   * front of each caller, including the fixtures, where "what does this device
   * actually know?" is the only interesting part of the setup.
   */
  integrity: SnapshotIntegrity;
}): StampSnapshotResult {
  const live = flattenSnapshot(snapshot);
  const liveKeys = new Set(live.map((entity) => entity.key));
  const tombstonesByKey = new Map(
    baseline.tombstones.map((tombstone) => [entityKey(tombstone.entityType, tombstone.entityId), tombstone] as const),
  );

  const perEntity: Record<string, StampedEntity> = {};
  for (const entity of live) {
    const previous = baseline.perEntity[entity.key];
    const hash = contentHash(entity.value);
    const buried = tombstonesByKey.get(entity.key);
    // A resurrected entity must outrank its own tombstone, or the merge would
    // keep deleting it on every sync, the classic "the row I re-added keeps
    // vanishing" bug.
    const floor = Math.max(previous?.lamport ?? 0, buried?.lamport ?? 0);
    perEntity[entity.key] =
      previous !== undefined && previous.hash === hash && buried === undefined ?
        previous
      : { lamport: floor + 1, deviceId, hash };
  }

  const tombstones: Tombstone[] = [];
  // Tombstones this device already published and every peer has agreed with.
  // They are carried forward unconditionally: withholding one would resurrect
  // the row it buried, which is the same class of defect from the other side.
  for (const [key, tombstone] of tombstonesByKey) {
    if (!liveKeys.has(key)) tombstones.push(tombstone);
  }

  const minted: Tombstone[] = [];
  const withheld: Tombstone[] = [];
  for (const [key, previous] of Object.entries(baseline.perEntity)) {
    if (liveKeys.has(key) || tombstonesByKey.has(key)) continue;
    const [entityType, ...idParts] = key.split(':');
    const tombstone: Tombstone = {
      entityId: idParts.join(':'),
      entityType: entityType ?? '',
      lamport: previous.lamport + 1,
      deviceId,
    };
    // THE ONE PLACE AN ABSENCE BECOMES A DELETE. Everything else in this
    // function is arithmetic; this line is the claim.
    if (isTombstoneTrusted({ key, entityType: tombstone.entityType, integrity })) minted.push(tombstone);
    else withheld.push(tombstone);
  }
  tombstones.push(...minted);

  // THE HELD COMPARTMENT IS A WITHHELD REMOVAL, and it is pushed here rather
  // than minted anywhere: it is not a tombstone, it never reaches `meta` or
  // the baseline, and the compartment's own stamp above is carried forward
  // untouched because the held bytes hash to what the cache already held. It
  // exists so the shell cannot call this cycle clean, `shrinkAcknowledged`
  // stays false, and the heal log says which entity type went unpublished.
  if (integrity.isCompartmentHeld) {
    const key = entityKey(SYNC_ENTITY_TYPES.privateStore, PRIVATE_STORE_ENTITY_ID);
    withheld.push({
      entityId: PRIVATE_STORE_ENTITY_ID,
      entityType: SYNC_ENTITY_TYPES.privateStore,
      lamport: (baseline.perEntity[key]?.lamport ?? 0) + 1,
      deviceId,
    });
  }

  return {
    meta: { perEntity: toWireStamps(perEntity), tombstones },
    baseline: { perEntity, tombstones },
    minted,
    withheld,
  };
}

/** All either count needs of a pass-through row: an identity to compare against another list. */
interface PassThroughRow {
  id: string;
}

/**
 * One PASS-THROUGH collection, chosen by the table name
 * {@link PassThroughOutcome.refused} carries.
 *
 * FAIL FAST on anything else. `decidePassThrough` names these two tables and
 * no others, so a third name here is a new pass-through collection whose
 * author has not been asked how it is counted, and guessing would report a
 * restore of zero to somebody whose rows had just come back.
 */
function readPassThroughList({
  table,
  snapshot,
}: {
  table: string;
  snapshot: SyncedSnapshot;
}): readonly PassThroughRow[] {
  if (table === FASTS_TABLE) return snapshot.fasts;
  if (table === SAVED_MEALS_TABLE) return snapshot.savedMeals;
  throw new Error(`No pass-through list is known for the table ${table}.`);
}

/**
 * How many DIARY ROWS this cycle got back that this device could not vouch for.
 *
 * The definition, and every term in it is load-bearing: a row the device could
 * not speak for, which the payload this cycle agreed with holds, and which the
 * apply therefore wrote. It is the number the person is shown, so it may only
 * count things that are now on their device.
 *
 * TWO SOURCES, because there are two ways this device's ignorance is overruled:
 *
 *  1. A WITHHELD TOMBSTONE whose entity is live in the agreed payload. The push
 *     did not carry the delete, the pull carried the row back, and the apply
 *     wrote it.
 *  2. A REFUSED PASS-THROUGH TABLE (`mergeSnapshots`), counted as the ids the
 *     agreed list holds and this device's list did not. Those rows arrive with
 *     no tombstone anywhere, because the two lists are not merged and carry
 *     none; counting only withheld tombstones reported a restore of zero to
 *     somebody whose forty saved meals had just come back.
 *
 * AND THE COMPARTMENT IS NEVER COUNTED. A HELD compartment (M226) is pushed
 * back to the account byte-identical and nothing is written to this device at
 * all, so it is a withheld publication rather than a restore. It rides in
 * `withheld` so the cycle cannot be called clean and so the heal log names it,
 * and it stops there.
 */
export function countRestoredEntities({
  withheld,
  merged,
  local,
  refused,
}: {
  withheld: readonly Tombstone[];
  /** The snapshot this cycle agreed with, merged or local. */
  merged: SyncedSnapshot;
  /** The snapshot this device read, which is what "could not vouch for" is measured against. */
  local: SyncedSnapshot;
  /** The tables whose remote list stood ({@link PassThroughOutcome.refused}). */
  refused: readonly string[];
}): number {
  const liveKeys = new Set(flattenSnapshot(merged).map((entity) => entity.key));
  const restoredEntities = withheld.filter(
    (tombstone) =>
      tombstone.entityType !== SYNC_ENTITY_TYPES.privateStore &&
      liveKeys.has(entityKey(tombstone.entityType, tombstone.entityId)),
  ).length;
  return refused.reduce((total, table) => total + countAdoptedRows({ table, merged, local }), restoredEntities);
}

/**
 * The rows one refused table's agreed list holds and this device's did not.
 *
 * Zero on the MIGRATION cycle, which is the common case for this branch: a
 * baseline written before the pass-through ids were kept can account for
 * nothing, so both tables are refused on every healthy device exactly once,
 * and a healthy device's lists are the account's lists. Nothing is restored and
 * nothing is said.
 */
function countAdoptedRows({
  table,
  merged,
  local,
}: {
  table: string;
  merged: SyncedSnapshot;
  local: SyncedSnapshot;
}): number {
  const localIds = new Set(readPassThroughList({ table, snapshot: local }).map((row) => row.id));
  return readPassThroughList({ table, snapshot: merged }).filter((row) => !localIds.has(row.id)).length;
}

function toWireStamps(perEntity: Record<string, StampedEntity>): SyncMetaPayload['perEntity'] {
  return Object.fromEntries(
    Object.entries(perEntity).map(([key, stamp]) => [key, { lamport: stamp.lamport, deviceId: stamp.deviceId }]),
  );
}

// ---------------------------------------------------------------------------
// Merging: two stamped payloads -> one
// ---------------------------------------------------------------------------

function toCandidateMap(payload: StampedSnapshot) {
  const candidates: Record<string, MergeCandidate<FlatEntity>> = {};
  for (const entity of flattenSnapshot(payload.snapshot)) {
    // An entity present in the snapshot but missing from `perEntity` came from
    // a peer that predates stamping (or a hand-restored blob). Stamp 0 is the
    // right default: it loses to anything that ever carried a real stamp, and
    // still beats nothing at all.
    const stamp = payload.meta.perEntity[entity.key] ?? { lamport: 0, deviceId: '' };
    candidates[entity.key] = { entityId: entity.key, lamport: stamp.lamport, deviceId: stamp.deviceId, value: entity };
  }
  for (const tombstone of payload.meta.tombstones) {
    const key = entityKey(tombstone.entityType, tombstone.entityId);
    const existing = candidates[key];
    // A payload should never carry both, but if it does, the higher stamp is
    // the honest reading of what that device last knew.
    if (existing !== undefined && existing.lamport >= tombstone.lamport) continue;
    candidates[key] = { entityId: key, lamport: tombstone.lamport, deviceId: tombstone.deviceId, value: null };
  }
  return candidates;
}

/**
 * What the pass-through decision produced, beside the merged payload itself.
 *
 * Returned rather than inferred by the caller, because neither half can be
 * recomputed from the merged snapshot: `published` names ids that are no
 * longer in it, and `refused` is a statement about which side won, which two
 * identical lists do not record.
 */
export interface PassThroughOutcome {
  /**
   * The DELETE JOURNAL KEYS of the ids this device's list removed and this
   * merge therefore published (`fast:abc`, `savedMeal:def`).
   *
   * The orchestrator reads it twice: it is the second half of
   * `shrinkAcknowledged`, because a person who cleared forty saved meals shrank
   * the blob on purpose and the service must be told; and it is what the
   * journal prune forgets once the baseline that carries the removal is
   * committed.
   */
  published: string[];
  /**
   * The store tables whose REMOTE list stood, because the local one could not
   * be accounted for.
   *
   * Empty on every ordinary cycle. A table here means this device holds fewer
   * fasts or saved meals than the account does and cannot say why, so the
   * account's list was kept instead of its own.
   */
  refused: string[];
}

/** A merged payload, plus what happened to the two collections the merge does not merge. */
export interface MergedSnapshot extends StampedSnapshot {
  passThrough: PassThroughOutcome;
}

/** One table's verdict: the list that survived, the journal keys it published, and the table id when the remote won. */
interface PassThroughDecision<T> {
  list: T[];
  published: string[];
  refused: string | null;
}

/**
 * WHICH SIDE'S LIST SURVIVES, for one collection that is not merged.
 *
 * THE INVARIANT, and it is the whole of this function: this device may push
 * its own list only when every id its persisted baseline recorded for the
 * table is either still in that list, or is named in the delete journal as a
 * removal this device performed. An id that is in neither is an id this device
 * cannot account for, and the honest reading of that is "I lost it", not "it
 * is gone".
 *
 * The disk-versus-memory signal is kept BESIDE the journal, not instead of it,
 * the same pairing `isTombstoneTrusted` uses: a half-read table can produce a
 * list that accounts for every baseline id and is still wrong about the rows
 * it never read.
 */
function decidePassThrough<T extends { id: string }>({
  table,
  tag,
  local,
  remote,
  baselineIds,
  deletedEntityKeys,
  integrity,
}: {
  table: string;
  /** The journal tag this table's removals are written under (`DELETE_JOURNAL_TAG_BY_TABLE`). */
  tag: string;
  local: T[];
  remote: T[];
  /** The ids the baseline recorded for this table, or `undefined` for a baseline written before it did. */
  baselineIds: string[] | undefined;
  deletedEntityKeys: ReadonlySet<string>;
  integrity: LocalStoreIntegrity;
}): PassThroughDecision<T> {
  const localIds = new Set(local.map((entry) => entry.id));
  const removed = (baselineIds ?? []).filter((id) => !localIds.has(id));
  const removedKeys = removed.map((id) => entityKey(tag, id));
  // A MISSING RECORD IS NOT AN EMPTY ONE. `baselineIds === undefined` is the
  // migration case, a baseline from before this field existed, and it can
  // account for nothing because it recorded nothing. Defaulting it to `[]`
  // would make every one of those devices trusted, which is the state the whole
  // rule exists to refuse.
  const isAccountedFor = baselineIds !== undefined && removedKeys.every((key) => deletedEntityKeys.has(key));
  if (!isTableTrusted({ table, integrity }) || !isAccountedFor) {
    return { list: remote, published: [], refused: table };
  }
  return { list: local, published: removedKeys, refused: null };
}

/**
 * Merges the local payload with a just-pulled remote one.
 *
 * Deterministic and symmetric: both devices running this over the same pair of
 * inputs land on byte-identical output, which is what makes "push, lose the
 * CAS, pull, merge, re-push" terminate instead of ping-ponging.
 */
export function mergeSnapshots({
  local,
  remote,
  integrity,
  baseline,
  deletedEntityKeys,
}: {
  local: StampedSnapshot;
  remote: StampedSnapshot;
  /**
   * What the LOCAL device can prove about its own storage, the same evidence
   * object `stampSnapshot` weighs, and REQUIRED here for the same reason
   * (M224, the pass-through half).
   *
   * It decides one thing only: whether this device's `fasts` and `savedMeals`
   * are trusted to be the whole list. Nothing else in this function reads it,
   * and every stamped entity is merged exactly as before.
   */
  integrity: LocalStoreIntegrity;
  /**
   * The PERSISTED baseline, for its `passThrough` ids and nothing else.
   *
   * It is what the local list is held against: a fast the baseline names and
   * the list does not is either a delete this device wrote down or a row it
   * lost, and only those two ids together can tell which.
   */
  baseline: SyncBaseline;
  /**
   * This device's delete journal, the keys it recorded as removed
   * (`SnapshotIntegrity.deletedEntityKeys`).
   *
   * Passed separately rather than read off `integrity`, because `integrity`
   * here is the narrower {@link LocalStoreIntegrity}: the disk comparison is
   * all the merged entities need, and widening it would put the journal in
   * front of readers that must not weigh it.
   */
  deletedEntityKeys: ReadonlySet<string>;
}): MergedSnapshot {
  const merged = mergeEntityMaps(toCandidateMap(local), toCandidateMap(remote));

  const foods: LocalPersonalFood[] = [];
  const foodLogs: LocalFoodLog[] = [];
  const weightEntries: LocalWeightEntry[] = [];
  let profile: LocalProfileGoals | null = null;
  let fastingSettings: LocalFastingSettings | null = null;
  let privateStore: SealedPrivateStore | null = null;
  const perEntity: SyncMetaPayload['perEntity'] = {};
  const tombstones: Tombstone[] = [];

  for (const key of Object.keys(merged).toSorted()) {
    const candidate = merged[key];
    if (candidate === undefined) continue;
    if (candidate.value === null) {
      const [entityType, ...idParts] = key.split(':');
      tombstones.push({
        entityId: idParts.join(':'),
        entityType: entityType ?? '',
        lamport: candidate.lamport,
        deviceId: candidate.deviceId,
      });
      continue;
    }
    perEntity[key] = { lamport: candidate.lamport, deviceId: candidate.deviceId };
    const entity = candidate.value;
    // `flattenSnapshot` is the only producer of a `FlatEntity`, and each of its
    // `toFlat` calls pairs an `entityType` tag with a value taken from the
    // matching snapshot collection. The tag therefore decides which member of
    // `SyncEntityValue` `entity.value` is, which is what each cast below reads.
    if (entity.entityType === SYNC_ENTITY_TYPES.food) {
      // SAFETY: the `personalFood` tag is only ever attached to a `LocalPersonalFood`.
      foods.push(entity.value as LocalPersonalFood);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.log) {
      // SAFETY: the `foodLog` tag is only ever attached to a `LocalFoodLog`.
      foodLogs.push(entity.value as LocalFoodLog);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.weight) {
      // SAFETY: the `weightEntry` tag is only ever attached to a `LocalWeightEntry`.
      weightEntries.push(entity.value as LocalWeightEntry);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.profile) {
      // SAFETY: the `profile` tag is only ever attached to the singleton `LocalProfileGoals`.
      profile = entity.value as LocalProfileGoals;
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.fastingSettings) {
      // SAFETY: the `fastingSettings` tag is only ever attached to the singleton `LocalFastingSettings`.
      fastingSettings = entity.value as LocalFastingSettings;
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.privateStore) {
      // SAFETY: the `privateStore` tag is only ever attached to the singleton `SealedPrivateStore`.
      privateStore = entity.value as SealedPrivateStore;
    }
  }

  // WHICH SIDE'S LIST SURVIVES, for the two collections that are not merged.
  //
  // THE BOUNDARY HAS NOT MOVED: fasts are still not merged across devices, and
  // the "at most one open fast" question M132 deferred is still open and still
  // needs its own design pass. This decides something much smaller, and only
  // in a state that should never happen: when the device cannot ACCOUNT FOR
  // the ids its own baseline recorded, its shorter list is not a fact about the
  // account, so it must not be the side that wins. Nothing here combines two
  // lists, and on every ordinary cycle, including one where the person
  // genuinely cleared every fast they had, the local list wins exactly as it
  // always has, because every removal was written down as it happened.
  const fastsDecision = decidePassThrough({
    table: FASTS_TABLE,
    tag: DELETE_JOURNAL_TAG_BY_TABLE[FASTS_TABLE],
    local: local.snapshot.fasts,
    remote: remote.snapshot.fasts,
    baselineIds: baseline.passThrough?.fasts,
    deletedEntityKeys,
    integrity,
  });
  const savedMealsDecision = decidePassThrough({
    table: SAVED_MEALS_TABLE,
    tag: DELETE_JOURNAL_TAG_BY_TABLE[SAVED_MEALS_TABLE],
    local: local.snapshot.savedMeals,
    remote: remote.snapshot.savedMeals,
    baselineIds: baseline.passThrough?.savedMeals,
    deletedEntityKeys,
    integrity,
  });

  // FASTS RIDE THROUGH FROM THE LOCAL SIDE, UNTOUCHED (M132).
  //
  // They are deliberately absent from `SYNC_ENTITY_TYPES`, `flattenSnapshot`
  // and `toCandidateMap`, so they are never stamped, never diffed against the
  // remote payload, never tombstoned, and never adopted from another device.
  // A fast round-trips through the LOCAL JSON backup only; the optional E2EE
  // sync feature does not merge fasts across devices yet.
  //
  // That is a scope boundary, not an oversight: the "at most one open fast"
  // invariant is a genuinely hard cross-device question (two phones both
  // holding a running fast have two truthful answers, and picking one writes a
  // duration nobody declared into somebody's history), and it needs its own
  // design pass rather than falling out of a last-writer-wins merge. Passing
  // `local` through keeps this device's own fasts intact through every sync
  // cycle instead of silently emptying them, which a bare `fasts: []` here
  // would do on the very first merge.
  //
  // SAVED MEALS RIDE THROUGH FROM THE LOCAL SIDE TOO, for the identical reason
  // and the identical mechanism (M123/07): they are absent from
  // `SYNC_ENTITY_TYPES`/`flattenSnapshot`/`toCandidateMap`, so `local` passes
  // straight through rather than a bare `savedMeals: []` silently emptying a
  // device's saved meals on its first merge. Unlike fasts there is no hard
  // cross-device invariant blocking a real merge here, this is simply not
  // built yet, and is a smaller, lower-risk follow-up than fasts' was.
  return {
    snapshot: {
      foods,
      foodLogs,
      weightEntries,
      profile,
      // The REMOTE side only when this device cannot account for the ids its
      // baseline recorded, which is an evicted store, a half-loaded table, or a
      // baseline from before the ids were kept (`decidePassThrough`). Local
      // otherwise, always, including when it is empty on purpose.
      fasts: fastsDecision.list,
      savedMeals: savedMealsDecision.list,
      // NOT passed through from `local` like the two above it: the routine is
      // genuinely merged, so a second device adopts it instead of staying
      // blank. See the comment on `SYNC_ENTITY_TYPES.fastingSettings` for why
      // a routine and a fast sit on opposite sides of this line.
      fastingSettings,
      // NOT passed through from `local` like the two above it (M160/04, moved
      // into the compartment by M160/07): the share key pair and the pinned
      // peers are genuinely merged, so a second device adopts them instead of
      // staying blank. What is merged here is the SEALED compartment, this
      // function never sees the key material inside it. See the comment on
      // `SYNC_ENTITY_TYPES.privateStore`.
      privateStore,
    },
    meta: { perEntity, tombstones },
    passThrough: {
      published: [...fastsDecision.published, ...savedMealsDecision.published],
      refused: [fastsDecision.refused, savedMealsDecision.refused].filter((table) => table !== null),
    },
  };
}

/**
 * Rebuilds a baseline from a payload this device has just agreed with (either
 * pushed or adopted wholesale).
 *
 * Recomputing the hashes here, rather than carrying the local ones forward ,
 * is what makes the NEXT cycle see "nothing changed" after adopting a remote
 * entity. Skip it and every sync re-pushes the whole store.
 */
export function baselineFromPayload(payload: StampedSnapshot): SyncBaseline {
  const perEntity: Record<string, StampedEntity> = {};
  for (const entity of flattenSnapshot(payload.snapshot)) {
    const stamp = payload.meta.perEntity[entity.key] ?? { lamport: 0, deviceId: '' };
    perEntity[entity.key] = { lamport: stamp.lamport, deviceId: stamp.deviceId, hash: contentHash(entity.value) };
  }
  return {
    perEntity,
    tombstones: payload.meta.tombstones,
    // THE TWO PASS-THROUGH COLLECTIONS, recorded as plain ids and deliberately
    // NOT as `perEntity` rows. An entry in `perEntity` is stamped, diffed and
    // tombstoned by the next `stampSnapshot`, which is the merge these two do
    // not have; what the next cycle needs from them is only "what did the
    // account hold when I last agreed with it", so that a shorter list can be
    // checked against the delete journal before it is published.
    passThrough: {
      fasts: payload.snapshot.fasts.map((entry) => entry.id),
      savedMeals: payload.snapshot.savedMeals.map((entry) => entry.id),
    },
  };
}

/**
 * Whether two payloads are the same in every way that matters on the wire.
 *
 * The orchestrator uses this to SKIP a push when the merge contributed
 * nothing. Without it, every boot of every device would write a new blob
 * version, burning the 5-version retention window, and turning "open the app"
 * into a write.
 */
export function payloadsEqual(a: StampedSnapshot, b: StampedSnapshot): boolean {
  return stableStringify(canonicalize(a)) === stableStringify(canonicalize(b));
}

/** Stable order for an id-bearing collection, so two devices serialize the same set identically. */
function byId<T extends { id: string }>(items: T[]): T[] {
  return items.toSorted((x, y) => (x.id < y.id ? -1 : 1));
}

function canonicalize(payload: StampedSnapshot) {
  return {
    snapshot: {
      foods: byId(payload.snapshot.foods),
      foodLogs: byId(payload.snapshot.foodLogs),
      weightEntries: byId(payload.snapshot.weightEntries),
      profile: payload.snapshot.profile,
      // The routine IS included, for the same reason `profile` beside it is
      // and `fasts` below is not: it is merged, so a device that changes it
      // has something another device needs, and it must be allowed to push.
      fastingSettings: payload.snapshot.fastingSettings,
      // The compartment IS included, unlike `fasts` below: generating a key
      // pair, pinning a peer, or rewrapping a slot after a passphrase change
      // is a real change another device needs, so it must be allowed to make
      // this device push. It is compared as sealed bytes, which is why
      // `private-store.ts` caches a sealed compartment and re-emits it
      // verbatim while its plaintext is unchanged, a fresh IV on every cycle
      // would make every boot write a new blob version.
      privateStore: payload.snapshot.privateStore,
      // `fasts` is deliberately omitted, for the same reason `mergeSnapshots`
      // passes it straight through: it is not synced, so a fast starting or
      // ending must not be what makes this device burn a blob version.
    },
    meta: {
      perEntity: payload.meta.perEntity,
      tombstones: payload.meta.tombstones.toSorted((x, y) =>
        entityKey(x.entityType, x.entityId) < entityKey(y.entityType, y.entityId) ? -1 : 1,
      ),
    },
  };
}
