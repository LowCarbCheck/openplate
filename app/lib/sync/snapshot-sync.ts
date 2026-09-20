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
  LocalActivityMark,
  LocalAward,
  LocalFast,
  LocalFastingSettings,
  LocalFoodLog,
  LocalPantryItem,
  LocalPersonalFood,
  LocalProfileGoals,
  LocalWeightEntry,
} from '#app/lib/local-store';
import {
  ACTIVITY_MARKS_TABLE,
  AWARDS_TABLE,
  entityKey as buildEntityKey,
  DELETE_JOURNAL_TAG_BY_TABLE,
  FASTING_SETTINGS_TABLE,
  FASTS_TABLE,
  FOOD_LOGS_TABLE,
  PANTRY_ITEMS_TABLE,
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
   * ONE FAST (M240/01, ADR-0014), an event with its own id, merged like a food
   * log.
   *
   * IT WAS A PASS-THROUGH UNTIL M240/01, the headline one, because "at most
   * one open fast" across two devices is a question with two truthful answers
   * and M132 declined to answer it out of a bare last-writer-wins merge. The
   * cost of declining was that a fast lived on exactly one device: an erase, a
   * lost phone or a new tablet and the fasting history was gone, while the
   * routine beside it travelled fine.
   *
   * ADR-0014 MERGES THEM AND STILL DOES NOT ANSWER THE INVARIANT, which is the
   * point. Two devices that each started a fast offline end up holding BOTH,
   * on both devices. `selectCurrentFast` shows the latest-started one as
   * current and `selectFastHistory` renders the other as still open with a
   * Remove action, which is the answer the app has had since M132 for a backup
   * restore. A merge-time resolution would silently drop a row the person can
   * see, and it would drop the one the screen calls current.
   *
   * WHOLE-RECORD LAST-WRITER-WINS per fast, ordered by `(lamport, deviceId)`
   * like every other merged entity. Ending a fast, writing a mood or a note is
   * an edit to one row, so the device that wrote last wins that row, and two
   * devices editing the SAME fast offline is the accepted §3.3 trade-off the
   * profile row has always carried.
   *
   * DELETES TRAVEL, which a pass-through's never did. `deleteLocalFast`
   * journals the removal, `stampSnapshot` mints a tombstone from that journal
   * row, and the peer's `applyMergedSnapshot` removes the row. An evicted
   * device mints nothing, under the ordinary ADR-0013 rule, so it repopulates
   * from the account instead of emptying it.
   */
  fast: SYNC_ENTITY_TYPE_BY_TABLE[FASTS_TABLE],
  /**
   * ONE PANTRY ROW (M240/02, ADR-0015), an ingredient on a shelf, merged like a
   * food log.
   *
   * IT WAS THE LAST PASS-THROUGH WITH NO GUARD AT ALL, on the M233/02 argument
   * that a working list of what is in one fridge is stale within days and
   * belongs to the device that photographed the shelf. The owner reversed it:
   * a shopping list that is only on the phone you left at home is not a
   * shopping list, and somebody who photographs a fridge on a tablet cooks
   * from a phone.
   *
   * WHOLE-RECORD LAST-WRITER-WINS per row, ordered by `(lamport, deviceId)`.
   * `mergePantry` already merges two CAPTURES by name on one device; this
   * merges two DEVICES by row id, and the two do not meet: a row that reached
   * this device by sync is an ordinary stored row by the time a capture is
   * reconciled against it.
   *
   * DELETES TRAVEL, which is the whole cost of the reversal. The pantry had no
   * delete journal at all before this, and `replaceLocalPantry` dropped rows
   * with a bare `delRow`. Both removal paths journal now, or an evicted device
   * would be indistinguishable from a person who emptied their shelf and
   * ADR-0013 would refuse the shrink for ever.
   *
   * NO IMAGE BYTES RIDE WITH IT. `LocalPantryItem` is a name, an amount, a
   * unit, a category, how the row arrived and two timestamps. The fridge
   * photograph is read in the browser, sent to the person's own AI provider
   * and never stored, so there is nothing here the partition has to hold back.
   */
  pantryItem: SYNC_ENTITY_TYPE_BY_TABLE[PANTRY_ITEMS_TABLE],
  /**
   * THE FASTING ROUTINE (the fasting rework), the singleton settings record.
   *
   * It is MERGED, exactly like `profile` above it and like `fast` beside it
   * since M240/01. When this comment was written the routine was the merged
   * half of a feature whose events were passed through, and that split is
   * gone: what is left of it is the GRANULARITY, one record for the routine
   * against one entity per fast.
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
   * AN ACTIVITY MARK (M235/03), one immutable row per (day, signal).
   *
   * MERGED, and the row id is what makes the merge enough. A mark's id is
   * `${dayKey}#${signal}`, so a phone that logs food and a tablet that runs a
   * fast on the same day write two DIFFERENT entity ids, and
   * `mergeEntityMaps` passes an entity present on only one side through
   * untouched. Both marks survive, and the merge engine is not touched. A
   * single row per day holding a SET of signals would have needed a union
   * merge, which is the design this milestone rejected.
   *
   * A PASS-THROUGH WOULD HAVE BEEN THE WRONG STANCE, unlike `savedMeals` and
   * `pantryItems`: letting the local list stand whole drops every mark the
   * other device wrote, which is precisely the streak a person would then be
   * told they do not have. `fasts` took the pass-through stance when this was
   * written and has been merged since M240/01.
   *
   * NOTHING HERE IS EVER TOMBSTONED. The table has no delete verb, so it is
   * absent from `DELETE_JOURNAL_TAG_BY_TABLE` and `isTombstoneTrusted`
   * withholds every tombstone this device's baseline might imply for a mark.
   * An evicted store therefore cannot delete another device's record of what
   * that person did.
   *
   * The row is written ONCE and never updated (`putLocalActivityMark` reads
   * before it writes), so its content hash never changes, `stampSnapshot`
   * carries the previous stamp forward, and opening the app ten times a day
   * pushes nothing.
   */
  activityMark: SYNC_ENTITY_TYPE_BY_TABLE[ACTIVITY_MARKS_TABLE],
  /**
   * AN EARNED AWARD (M235/03), one immutable row per catalog key.
   *
   * MERGED for the mark's reason and with the same mechanism: the row id IS
   * the catalog key, so two devices that earn the same award while offline
   * write the SAME id and converge on one row rather than two. Which device's
   * `earnedAt` survives is decided by `(lamport, deviceId)` and is accepted:
   * nothing branches on that number beyond display, and both devices are
   * describing the same achievement.
   *
   * `seenAt` IS THE ONE FIELD LAST-WRITER-WINS CAN COST SOMEBODY, and the cost
   * is one repeated note, never data. `applyMergedSnapshot` re-stamps a
   * `seenAt` the merge carried, so the field only ever moves from null to a
   * number and the two devices stop disagreeing about it.
   *
   * NEVER REVOKED, so like a mark it has no delete verb, no journal tag and no
   * tombstone anybody can trust.
   */
  award: SYNC_ENTITY_TYPE_BY_TABLE[AWARDS_TABLE],
  /**
   * THE OWNER-PRIVATE COMPARTMENT (M160/07, `openplate-core` ADR-0002's
   * partition amendment), one entity holding the sealed ciphertext and its
   * two CDK wraps.
   *
   * It is MERGED rather than passed through from the local side like
   * `savedMeals`, and the difference is the whole point: a clinician's
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
   * The ids the PASS-THROUGH collection held in the payload this device last
   * agreed with.
   *
   * Not in `perEntity`, deliberately and permanently. That record drives the
   * stamping, so an id in it would be diffed, stamped and tombstoned, which is
   * the merge this collection does not have. This is a plain list of ids and
   * it answers one question: which saved meals did the account hold last time
   * this device looked? `mergeSnapshots` lets the local list stand only when
   * every one of those ids is still in it or is named in the delete journal,
   * so an emptiness has to be accounted for before it is published.
   *
   * IT HELD A `fasts` LIST TOO UNTIL M240/01 (ADR-0014). A fast is a merged
   * entity now, so its ids live in `perEntity` with every other merged row and
   * its removals are tombstones rather than a shrunk list. A persisted state
   * written before that still carries the key; `sync-state.ts` drops it on the
   * way in, which is the whole migration.
   *
   * OPTIONAL FOR ONE CYCLE, which is the other migration. A baseline written
   * before this field existed has no record of what the account held, so
   * nothing can be accounted for, the table reads as untrusted, and the REMOTE
   * list wins that cycle. `applyMergedSnapshot` computes no delete set for it,
   * so `importBackup` upserts the account's list beside the device's own rows
   * and nothing local is lost. The baseline this cycle commits carries the
   * ids, and every later cycle is the ordinary case.
   */
  passThrough?: {
    savedMeals: string[];
    /**
     * One hash of the saved meals' CONTENT, as the payload this device last
     * agreed with held them (M240 counsel item 4).
     *
     * The ids above answer "which meals did the account hold", which is what
     * `decidePassThrough` needs and all it needs: it decides whether a SHORTER
     * list may be published, and an edit does not shorten anything. This
     * answers a different question, for the sign-out dialog: has this device
     * got a saved meal the account has not been told about? An id set cannot
     * see a RENAME, and a destructive confirm that under-warns is the one
     * place in the app where being wrong is unrecoverable.
     *
     * OPTIONAL, and that is the migration. Every baseline written before this
     * field is missing it, and a required field would fail the whole parse and
     * discard the baseline, tombstones and all, which is the fail-soft cost
     * `sync-state.ts` documents at length. Absent reads as "this device
     * recorded no content", which the dialog treats as "cannot vouch" and
     * warns about. No `STATE_FORMAT_VERSION` bump for the same reason the
     * `passThrough` record itself did not need one: the old shape still parses
     * and nothing is incompatible.
     */
    savedMealsHash?: string;
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
  | LocalPersonalFood
  | LocalFoodLog
  | LocalWeightEntry
  | LocalProfileGoals
  | LocalFast
  | LocalPantryItem
  | LocalFastingSettings
  | LocalActivityMark
  | LocalAward
  | SealedPrivateStore;

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
    // A FAST IS ONE ENTITY (M240/01), addressed by its own client-generated
    // id, so two devices that each start a fast write two different keys and
    // both survive the merge. That is the whole mechanism; nothing anywhere
    // adjudicates two open fasts, and `snapshot-sync.ts` deliberately has no
    // opinion about what a fast MEANS.
    ...snapshot.fasts.map((entry) => toFlat(SYNC_ENTITY_TYPES.fast, entry.id, entry)),
    // A PANTRY ROW IS ONE ENTITY (M240/02), addressed by its own id, so two
    // devices that each photograph a shelf keep both readings and the person
    // reconciles them on screen exactly as they already reconcile two captures
    // on one device.
    ...snapshot.pantryItems.map((entry) => toFlat(SYNC_ENTITY_TYPES.pantryItem, entry.id, entry)),
    // THE ROW IS THE FACT (M235/03). A mark is addressed by its own
    // `${dayKey}#${signal}` id and an award by its catalog key, which is why
    // both can be stamped and merged one row at a time without the engine
    // learning anything about either of them.
    ...snapshot.activityMarks.map((mark) => toFlat(SYNC_ENTITY_TYPES.activityMark, mark.id, mark)),
    // AN AWARD HAS NO `id` FIELD, its `key` IS its row id, in the store and
    // here. Spelling it `award.key` rather than adding a duplicate `id` to the
    // entity keeps one name for one thing.
    ...snapshot.awards.map((award) => toFlat(SYNC_ENTITY_TYPES.award, award.key, award)),
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
 * FAIL FAST on anything else. `decidePassThrough` names ONE table now and no
 * others, so a second name here is a new pass-through collection whose author
 * has not been asked how it is counted, and guessing would report a restore of
 * zero to somebody whose rows had just come back. It named two until M240/01
 * (ADR-0014) moved `fasts` onto the merged side, where a restore is counted
 * from the withheld tombstones instead.
 */
function readPassThroughList({
  table,
  snapshot,
}: {
  table: string;
  snapshot: SyncedSnapshot;
}): readonly PassThroughRow[] {
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
 *     no tombstone anywhere, because that list is not merged and carries none;
 *     counting only withheld tombstones reported a restore of zero to somebody
 *     whose forty saved meals had just come back. A restored FAST is counted
 *     by source 1 since M240/01, because a fast is merged and a device that
 *     could not vouch for one withholds its tombstone like any other row.
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
 * nothing, so the table is refused on every healthy device exactly once, and a
 * healthy device's list is the account's list. Nothing is restored and nothing
 * is said.
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
   * saved meals than the account does and cannot say why, so the account's
   * list was kept instead of its own.
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
 * A DECLARED END IS NEVER LOST, whichever copy of a fast wins the merge
 * (M240 counsel item 2).
 *
 * ── The sequence this closes ─────────────────────────────────────────────
 *
 * `setLocalFastStart` and `setLocalFastPlannedStart` refuse to touch a fast
 * that has ended, but they read THIS device's copy, and a device that has not
 * synced yet holds a copy that is still running. So: the person ends the fast
 * on their phone; they adjust its start on a stale tablet; both edits stamp at
 * the same lamport, because both were made against the same baseline; and
 * `pickMergeWinner` breaks the tie on DEVICE ID. Half the time the tablet
 * wins, and the fast is open again with the end the person declared gone.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * When the winning copy has no end and the losing copy has one, keep every
 * field of the winner and carry the loser's `endedAt` onto it, with the
 * reflection that was declared in the same act (`endLocalFast` writes
 * `endedAt`, `mood` and `note` together).
 *
 * IT INVENTS NOTHING, which is the line ADR-0014 holds. The instant written is
 * one the person declared on one of their own devices; the merge only refuses
 * to drop it. Nothing is deleted either: the row survives with the winner's
 * protocol, target and start.
 *
 * ── Why it converges ─────────────────────────────────────────────────────
 *
 * `pickMergeWinner` is symmetric, so both devices agree on which copy won and
 * which lost from the same pair of payloads, whichever side each passes as
 * `local`. This function then reads only those two rows. And it is idempotent:
 * once the end is carried, the winner HAS an end, so a second pass changes
 * nothing.
 *
 * @param winner - the copy the stamps chose.
 * @param loser - the other side's copy of the same id, or `undefined` when only one side held it.
 */
function withDeclaredEnd(winner: LocalFast, loser: LocalFast | undefined): LocalFast {
  if (loser === undefined) return winner;
  if (winner.endedAt !== null) return winner;
  if (loser.endedAt === null) return winner;
  // THE REFLECTION GOES WITH THE END, and only where the loser has one. An
  // absent key stays absent rather than becoming an explicit `null`, or the
  // content hash would move for a row nothing happened to and the device would
  // push a blob version over punctuation.
  const carried: LocalFast = { ...winner, endedAt: loser.endedAt };
  if (loser.mood !== undefined) carried.mood = loser.mood;
  if (loser.note !== undefined) carried.note = loser.note;
  return carried;
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
   * It decides one thing only: whether this device's `savedMeals` are trusted
   * to be the whole list. Nothing else in this function reads it, and every
   * stamped entity is merged exactly as before. It decided the same for
   * `fasts` until M240/01 (ADR-0014) made them a stamped entity.
   */
  integrity: LocalStoreIntegrity;
  /**
   * The PERSISTED baseline, for its `passThrough` ids and nothing else.
   *
   * It is what the local list is held against: a saved meal the baseline names
   * and the list does not is either a delete this device wrote down or a row
   * it lost, and only those two ids together can tell which.
   */
  baseline: SyncBaseline;
  /**
   * This device's delete journal, the keys it recorded as removed
   * (`SnapshotIntegrity.deletedEntityKeys`).
   *
   * Passed separately rather than read off `integrity`, because `integrity`
   * here is the narrower {@link LocalStoreIntegrity}: the disk comparison is
   * all the merged entities need, and widening it would put the journal in
   * front of readers that must not weigh it. The merged entities, `fasts`
   * among them since M240/01, weigh the journal one step earlier instead, in
   * `stampSnapshot`, which is where a tombstone is authorised.
   */
  deletedEntityKeys: ReadonlySet<string>;
}): MergedSnapshot {
  const merged = mergeEntityMaps(toCandidateMap(local), toCandidateMap(remote));

  const foods: LocalPersonalFood[] = [];
  const foodLogs: LocalFoodLog[] = [];
  const weightEntries: LocalWeightEntry[] = [];
  const mergedFasts: LocalFast[] = [];
  // BOTH SIDES' COPIES, BY ID, so the loop below can ask what the OTHER copy of
  // a fast said. `mergeEntityMaps` hands back the winner and discards the
  // loser, and a declared end living only on the loser is exactly what
  // `withDeclaredEnd` exists to rescue.
  const fastsById = new Map<string, LocalFast[]>();
  for (const entry of [...local.snapshot.fasts, ...remote.snapshot.fasts]) {
    const held = fastsById.get(entry.id);
    if (held === undefined) fastsById.set(entry.id, [entry]);
    else held.push(entry);
  }
  const mergedPantry: LocalPantryItem[] = [];
  const activityMarks: LocalActivityMark[] = [];
  const awards: LocalAward[] = [];
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
    if (entity.entityType === SYNC_ENTITY_TYPES.fast) {
      // SAFETY: the `fast` tag is only ever attached to a `LocalFast`.
      const winner = entity.value as LocalFast;
      // AND THE OTHER SIDE'S COPY, if there was one. `withDeclaredEnd` is the
      // only thing in this merge that reads the losing row, and it reads one
      // field of it.
      const loser = fastsById.get(winner.id)?.find((held) => held !== winner);
      mergedFasts.push(withDeclaredEnd(winner, loser));
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.pantryItem) {
      // SAFETY: the `pantryItem` tag is only ever attached to a `LocalPantryItem`.
      mergedPantry.push(entity.value as LocalPantryItem);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.activityMark) {
      // SAFETY: the `activityMark` tag is only ever attached to a `LocalActivityMark`.
      activityMarks.push(entity.value as LocalActivityMark);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.award) {
      // SAFETY: the `award` tag is only ever attached to a `LocalAward`.
      awards.push(entity.value as LocalAward);
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

  // WHICH SIDE'S LIST SURVIVES, for the one collection that is not merged.
  //
  // It decides something small, and only in a state that should never happen:
  // when the device cannot ACCOUNT FOR the ids its own baseline recorded, its
  // shorter list is not a fact about the account, so it must not be the side
  // that wins. Nothing here combines two lists, and on every ordinary cycle,
  // including one where the person genuinely deleted every saved meal they
  // had, the local list wins exactly as it always has, because every removal
  // was written down as it happened.
  //
  // `fasts` WENT THROUGH HERE UNTIL M240/01. A fast is merged now, so the
  // eviction case it guarded is carried by the ordinary ADR-0013 machinery
  // instead: an evicted device mints no tombstone for a fast it cannot see,
  // the account's row survives the merge, and the apply writes it back.
  const savedMealsDecision = decidePassThrough({
    table: SAVED_MEALS_TABLE,
    tag: DELETE_JOURNAL_TAG_BY_TABLE[SAVED_MEALS_TABLE],
    local: local.snapshot.savedMeals,
    remote: remote.snapshot.savedMeals,
    baselineIds: baseline.passThrough?.savedMeals,
    deletedEntityKeys,
    integrity,
  });

  // SAVED MEALS RIDE THROUGH FROM THE LOCAL SIDE (M123/07): they are absent
  // from `SYNC_ENTITY_TYPES`/`flattenSnapshot`/`toCandidateMap`, so `local`
  // passes straight through rather than a bare `savedMeals: []` silently
  // emptying a device's saved meals on its first merge. There is no hard
  // cross-device invariant blocking a real merge here, this is simply not
  // built yet, and M240/01 having merged `fasts` makes it the smaller,
  // lower-risk follow-up it always was.
  return {
    snapshot: {
      foods,
      foodLogs,
      weightEntries,
      profile,
      // MERGED, one entity per fast (M240/01), and NOTHING ELSE. The list is
      // built by the loop above out of `mergeEntityMaps`, so a fast either
      // device holds is in the result and a fast either device buried is out
      // of it. There is no merge-time adjudication of any kind on top.
      //
      // TWO OPEN FASTS ARE A STATE THIS MERGE MAY PRODUCE, and it must.
      // `createLocalFast` refuses a second open fast on ONE device, and two
      // devices offline can still each start one. The screen already has an
      // answer for that: `selectCurrentFast` shows the LATEST-started open
      // fast as current and `selectFastHistory` renders the other as still
      // open, with a Remove action. A merge that picked one and deleted the
      // rest would silently drop a row the person can see and could remove
      // themselves, and it would drop the one the screen calls current. The
      // person decides; the merge carries whatever they decide, because a
      // Remove is a journalled delete like any other.
      fasts: mergedFasts,
      savedMeals: savedMealsDecision.list,
      // MERGED, one entity per row (M240/02, ADR-0015), and this line used to
      // be a plain `local.snapshot.pantryItems` pass-through with no guard at
      // all. The argument for that was that a shelf belongs to the fridge
      // beside it; the owner reversed it, because the person, not the fridge,
      // is who the list is for.
      //
      // TWO SHELVES DO NOT FIGHT. Two devices that each photographed a fridge
      // wrote two different sets of row ids, so `mergeEntityMaps` keeps both
      // and the person sees one combined list they can edit down, which is the
      // same thing they already do when they photograph the same fridge twice
      // on one device.
      pantryItems: mergedPantry,
      // MARKS AND AWARDS ARE MERGED (M235/03), which replaces the pass-through
      // placeholder M235/02 left here.
      //
      // Both lists are built by the loop above out of `mergeEntityMaps`, so a
      // row either side holds is in the result: a phone that logged food and a
      // tablet that ran a fast on the same day write two different mark ids and
      // the person keeps both signals. A pass-through would have published this
      // device's list whole and dropped the peer's rows on every pull, which is
      // the defect this milestone exists to avoid, and it is silent: the
      // streak simply reads lower.
      //
      // There is no `decidePassThrough` around them, and none is needed. That
      // guard exists so a device cannot publish an EMPTINESS it cannot account
      // for, and an emptiness here is not publishable at all: neither table has
      // a delete verb, so a row missing from this device's snapshot produces no
      // trusted tombstone and the remote row simply survives the merge. An
      // evicted store therefore repopulates from the account instead of
      // erasing it.
      activityMarks,
      awards,
      // MERGED, like the fasts above it since M240/01: a second device adopts
      // the routine instead of staying blank. See the comment on
      // `SYNC_ENTITY_TYPES.fastingSettings` for what is left of the difference
      // between a routine and a fast, which is the granularity and not the
      // stance.
      fastingSettings,
      // NOT passed through from `local` (M160/04, moved
      // into the compartment by M160/07): the share key pair and the pinned
      // peers are genuinely merged, so a second device adopts them instead of
      // staying blank. What is merged here is the SEALED compartment, this
      // function never sees the key material inside it. See the comment on
      // `SYNC_ENTITY_TYPES.privateStore`.
      privateStore,
    },
    meta: { perEntity, tombstones },
    passThrough: {
      published: savedMealsDecision.published,
      refused: [savedMealsDecision.refused].filter((table) => table !== null),
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
    // THE PASS-THROUGH COLLECTION, recorded as plain ids and deliberately NOT
    // as `perEntity` rows. An entry in `perEntity` is stamped, diffed and
    // tombstoned by the next `stampSnapshot`, which is the merge this one does
    // not have; what the next cycle needs from it is only "what did the account
    // hold when I last agreed with it", so that a shorter list can be checked
    // against the delete journal before it is published.
    //
    // `fasts` WAS RECORDED HERE TOO UNTIL M240/01. A fast is merged now, so
    // `flattenSnapshot` above already put every fast id into `perEntity` with
    // its stamp and its content hash, and recording the ids a second time here
    // would be a second, weaker answer to a question the baseline has already
    // answered properly.
    passThrough: {
      savedMeals: payload.snapshot.savedMeals.map((entry) => entry.id),
      // AND ONE HASH OF THE CONTENT (M240 counsel item 4), sorted through
      // `byId` first for the reason `canonicalize` sorts it: the order the
      // store returns a list in is not a change, and two devices have to hash
      // the same set identically or the dialog warns on every sign-out.
      savedMealsHash: contentHash(byId(payload.snapshot.savedMeals)),
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
      // SAVED MEALS ARE INCLUDED, and they are the one pass-through collection
      // that is. They travel: `mergeSnapshots` runs this device's list through
      // `decidePassThrough` and publishes it, so the account holds them and a
      // second device gets them back after an erase.
      //
      // Nothing else here can notice them. They are not merged, so they own no
      // `meta.perEntity` key, and with the list absent from this function two
      // payloads that differed only in a saved meal canonicalized identically:
      // creating one, renaming one or deleting one left the cycle calling
      // itself clean and the device sent nothing, until some unrelated change
      // to a food log pushed the blob and carried the meal along with it. On a
      // device that was erased or lost first, that meal was simply gone.
      //
      // Sorted through `byId` for the reason `foods` and `foodLogs` above are
      // sorted: the order a list comes back from the store in is not a change,
      // and two devices have to serialize the same set identically or every
      // cycle reads as a difference and pushes forever.
      savedMeals: byId(payload.snapshot.savedMeals),
      // FASTS ARE INCLUDED SINCE M240/01 (ADR-0014), and they used to be the
      // one collection this function deliberately omitted, on the ground that
      // a fast told the account nothing so a fast must not burn a blob
      // version. It tells the account everything now: starting one, ending
      // one, writing a mood or a note has to reach the person's other device,
      // and the cycle that carries it is a push.
      //
      // `meta.perEntity` below would already catch every one of those, because
      // a merged fast owns a key there and an edit advances its lamport. The
      // list is compared as well for the reason the `savedMeals` above it is:
      // the one time this function was trusted to infer a change from a
      // neighbouring field, a saved meal went unpushed until something else
      // happened to write the blob, and on a phone that was erased first the
      // meal was simply gone.
      //
      // Sorted through `byId`, so two devices serialize the same set
      // identically and an ordinary cycle does not read as a difference.
      fasts: byId(payload.snapshot.fasts),
      // THE PANTRY IS INCLUDED FOR THE FASTS' REASON (M240/02). A shelf
      // photographed on a tablet has to reach the phone somebody shops with,
      // so the cycle that captured it is a push. `meta.perEntity` below would
      // already catch it; the list is compared as well, sorted through `byId`,
      // exactly as `fasts` and `savedMeals` above it are.
      pantryItems: byId(payload.snapshot.pantryItems),
      profile: payload.snapshot.profile,
      // The routine IS included, for the same reason `profile` beside it is:
      // it is merged, so a device that changes it has something another device
      // needs, and it must be allowed to push.
      fastingSettings: payload.snapshot.fastingSettings,
      // The compartment IS included: generating a key
      // pair, pinning a peer, or rewrapping a slot after a passphrase change
      // is a real change another device needs, so it must be allowed to make
      // this device push. It is compared as sealed bytes, which is why
      // `private-store.ts` caches a sealed compartment and re-emits it
      // verbatim while its plaintext is unchanged, a fresh IV on every cycle
      // would make every boot write a new blob version.
      privateStore: payload.snapshot.privateStore,
      // `pantryItems` IS INCLUDED SINCE M240/02 (ADR-0015), directly below,
      // and was omitted here for the whole of M233/02's life on the ground
      // that photographing a shelf is not news for the account.
      //
      // `activityMarks` and `awards` are omitted too, and for a third reason
      // again (M235/03): they ARE merged, so a new mark must make this device
      // push, and it does, through `meta.perEntity` below. Every merged row
      // owns a key there, so two payloads holding different marks can never
      // compare equal, and listing the rows here as well would only add a
      // second ordering this file would have to keep stable.
    },
    meta: {
      perEntity: payload.meta.perEntity,
      tombstones: payload.meta.tombstones.toSorted((x, y) =>
        entityKey(x.entityType, x.entityId) < entityKey(y.entityType, y.entityId) ? -1 : 1,
      ),
    },
  };
}
