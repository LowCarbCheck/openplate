/**
 * The primary store's read/write surface, CRUD over the durable, authoritative
 * on-device tables (personal foods, food logs, weight entries, profile/goals,
 * fasts).
 * This is the "primary commit" the diary/add/weight/goals flows write to and the
 * source the aggregates (`aggregates.ts`) and backup (`backup.ts`) read from.
 *
 * Every entity is stored as ONE JSON cell per row (keyed by the entity's `id`),
 * so a row is read/written whole, the same pattern the mirror/outbox use. Reads
 * return entities in a stable order (createdAt then id) so a backup round-trip is
 * deterministic. The store is injectable (defaults to the IndexedDB-backed
 * singleton) so the pure logic and its unit tests run against a real in-memory
 * store with no browser.
 *
 * CRITICAL (M117/01): no function here ever evicts. This store is primary, not a
 * bounded cache, a write never deletes another row. The only deletes are the
 * explicit per-id `delete*` functions.
 *
 * EVERY ONE OF THOSE GOES THROUGH `deleteEntity` (M225), which removes the row
 * and writes the entity's key into the DELETE JOURNAL in the same transaction.
 * Sync may only mint a tombstone for a key that journal names, so a delete that
 * reached `delRow` directly is a delete no other device will ever hear about.
 * Grep for `delRow` in this file before adding a path: the three merged
 * collections (personal foods, food logs, weight entries) are the only ones
 * with a delete verb at all. There is ONE other remover,
 * `removeEntitiesWithoutJournal`, and it is the opposite case, rows a PEER
 * deleted, which this device must not claim. Its own doc says why.
 *
 * The two merged SINGLETONS have no delete verb by design: nothing removes the
 * profile row or the fasting-settings row, `clearLocal*` and the `patch*`
 * helpers WRITE a record with cleared fields, so neither can ever be
 * tombstoned, which is exactly right.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import { reportMealFromLog } from '#app/lib/pulse';
import { randomUuid } from '#app/lib/uuid';
import { FAST_NOTE_MAX_LENGTH, selectCurrentFast } from '#app/models/fasting';
import { EMPTY_BODY_METRICS, normalizeBodyMetrics, readBodyMetrics } from '#app/models/body-metrics';
import type { BodyMetrics } from '#app/models/body-metrics';
import {
  DELETED_AT_CELL,
  DELETED_ENTITIES_TABLE,
  FASTING_SETTINGS_ROW_ID,
  FASTING_SETTINGS_TABLE,
  FASTS_TABLE,
  FOOD_LOGS_TABLE,
  PERSONAL_FOODS_TABLE,
  PRIMARY_ENTITY_CELL,
  PROFILE_GOALS_TABLE,
  PROFILE_ROW_ID,
  RESEARCH_IDENTITY_ROW_ID,
  RESEARCH_IDENTITY_TABLE,
  SAVED_MEALS_TABLE,
  SCHEMA_VERSION_VALUE,
  SHARE_IDENTITY_ROW_ID,
  SHARE_IDENTITY_TABLE,
  SHARE_PEERS_TABLE,
  STUDY_ENROLMENTS_TABLE,
  WEIGHT_ENTRIES_TABLE,
} from './store';
import { getPrimaryStore, requestPersistentStorage } from './persist';
import { markDeviceHasDataForTable } from './had-data';
import { entityKey, SCHEMA_VERSION, SYNC_ENTITY_TYPE_BY_TABLE } from './schema';
import type {
  FastMood,
  FastProtocolId,
  LocalFast,
  LocalFastingSettings,
  LocalFoodLog,
  LocalPersonalFood,
  LocalProfileGoals,
  LocalResearchIdentity,
  LocalSavedMeal,
  LocalShareIdentity,
  LocalSharePeer,
  LocalStudyEnrolment,
  LocalWeightEntry,
} from './schema';

/** Every entity kind this store persists as one JSON cell per row. */
type PrimaryEntity =
  | LocalPersonalFood
  | LocalFoodLog
  | LocalWeightEntry
  | LocalProfileGoals
  | LocalFast
  | LocalFastingSettings
  | LocalSavedMeal
  | LocalShareIdentity
  | LocalSharePeer
  | LocalResearchIdentity
  | LocalStudyEnrolment;

/** The entity cell as it comes back off the store, a TinyBase cell, not yet JSON text. */
const entityCellSchema = z.string();

/** Options accepted by every primary-store function, the store defaults to the singleton. */
interface StoreOption {
  store?: Store;
}

async function resolveStore(store: Store | undefined): Promise<Store> {
  return store ?? (await getPrimaryStore());
}

// ---------------------------------------------------------------------------
// Generic row (de)serialization
// ---------------------------------------------------------------------------

/**
 * Writes one entity as a JSON cell, and (on a real browser) requests persistent
 * storage, this is the "first tracker write" durability trigger. Stamps the
 * schema version the store was last written under, so a future migration can
 * detect the on-disk shape.
 *
 * Also stamps the durable "this device has had data before" marker on the
 * first food-log/profile write (M123 spec 01). It belongs HERE, at the one
 * chokepoint every entity write already passes through, so no future write
 * path can be added that forgets it, `markDeviceHasDataForTable` owns the
 * decision about which tables count, and is a no-op for the rest.
 */
function writeEntity(store: Store, table: string, id: string, entity: PrimaryEntity): void {
  requestPersistentStorage();
  store.setValue(SCHEMA_VERSION_VALUE, SCHEMA_VERSION);
  markDeviceHasDataForTable(store, table);
  store.setRow(table, id, { [PRIMARY_ENTITY_CELL]: JSON.stringify(entity) });
}

/**
 * Removes one row AND writes down that it was removed, atomically.
 *
 * THE ONE PLACE A DELETE BECOMES A FACT. Sync may only mint a tombstone for a
 * key this journal names (`snapshot-sync.ts`), so a delete that skipped this
 * function is a delete no peer will ever hear about, and a journal row written
 * outside the row's own transaction is a device that can end up claiming a
 * delete it did not perform. `store.transaction` is what makes the pair
 * indivisible: TinyBase commits both writes together, and the autosave
 * listener sees one change, so the disk never holds one half.
 *
 * A table absent from {@link SYNC_ENTITY_TYPE_BY_TABLE} is not merged by sync
 * (fasts, saved meals, the owner-private rows), so there is nothing to record
 * and the row is simply removed. That is not a silent skip: those tables have
 * no tombstones at all, and a journal row for one would be read by nothing.
 */
function deleteEntity(store: Store, table: string, id: string): void {
  const entityType: string | undefined = Object.entries(SYNC_ENTITY_TYPE_BY_TABLE).find(
    ([tableId]) => tableId === table,
  )?.[1];
  if (entityType === undefined) {
    store.delRow(table, id);
    return;
  }
  store.transaction(() => {
    store.delRow(table, id);
    store.setRow(DELETED_ENTITIES_TABLE, entityKey(entityType, id), { [DELETED_AT_CELL]: Date.now() });
  });
}

/**
 * What a caller must name to remove rows WITHOUT recording a delete.
 *
 * A one-member literal union, so the compiler asks the question at every call
 * site: this is not a delete somebody performed, it is this device catching up
 * with one a PEER performed. `reason` is never read at runtime, it is not a
 * guard, it is the sentence the type system forces a future caller to write
 * down before it can reach the only unjournalled removal path in the app.
 */
export interface EntityRemovalWithoutJournal {
  /** The one case there is. A second value belongs here only with the argument for it written beside it. */
  reason: 'applied-a-peer-tombstone';
  /** Personal-food ids the merge resolved as buried elsewhere. */
  foodIds: readonly string[];
  /** Food-log ids the merge resolved as buried elsewhere. */
  foodLogIds: readonly string[];
  /** Weight-entry ids the merge resolved as buried elsewhere. */
  weightEntryIds: readonly string[];
}

/**
 * Removes rows a PEER deleted, leaving the journal alone.
 *
 * THE ONE PATH OUT OF THE JOURNAL, and it exists because the journal means
 * exactly one thing: a delete THIS DEVICE performed. `applyMergedSnapshot`
 * removes rows a merge resolved as buried on another device, and routing those
 * through `deleteLocalFood` and friends made this device claim a peer act as
 * its own. That claim is not harmless the moment a cycle does not reach its
 * commit, which prunes the journal: a refused push, or a tab closed between
 * the apply and the commit, leaves the row behind, and the NEXT cycle mints a
 * fresh tombstone for it at a HIGHER lamport than the peer's. A peer that
 * re-added the entity in between can then lose the tie on device id, and the
 * entity is buried by a device that never deleted it.
 *
 * NOT EXPORTED FROM `#app/lib/local-store`. The barrel is the app-facing
 * surface, every user-facing verb reaches the store through it, and this
 * function is deliberately not on it, so arriving here takes a deep import,
 * the word `WithoutJournal` in the call, and a `reason` typed with the one
 * case there is. `tests/unit/delete-journal-single-writer.test.ts` pins the
 * call site count, so a second one fails the push rather than a review.
 */
export async function removeEntitiesWithoutJournal(
  removal: EntityRemovalWithoutJournal,
  { store }: StoreOption = {},
): Promise<void> {
  const resolved = await resolveStore(store);
  resolved.transaction(() => {
    for (const id of removal.foodIds) resolved.delRow(PERSONAL_FOODS_TABLE, id);
    for (const id of removal.foodLogIds) resolved.delRow(FOOD_LOGS_TABLE, id);
    for (const id of removal.weightEntryIds) resolved.delRow(WEIGHT_ENTRIES_TABLE, id);
  });
}

/**
 * Every delete this device has recorded and not yet published, as entity keys.
 *
 * Read once per sync cycle by the bridge, beside the snapshot itself, so the
 * stamping weighs the journal AS OF the read that produced the snapshot.
 */
export async function listDeletedEntityKeys({ store }: StoreOption = {}): Promise<string[]> {
  return (await resolveStore(store)).getRowIds(DELETED_ENTITIES_TABLE);
}

/**
 * Drops journal rows whose delete is now agreed.
 *
 * Called once a cycle has committed a baseline that carries the tombstone: the
 * row has done its job, and keeping it would grow a list that only ever grows.
 * Nothing is lost by dropping it, because a tombstone already in the baseline
 * is carried forward unconditionally by every later cycle.
 *
 * Keys the journal does not hold are ignored, so the caller may hand over
 * every tombstone in the payload without first working out which are its own.
 */
export async function forgetDeletedEntityKeys(keys: readonly string[], { store }: StoreOption = {}): Promise<void> {
  if (keys.length === 0) return;
  const resolved = await resolveStore(store);
  resolved.transaction(() => {
    for (const key of keys) resolved.delRow(DELETED_ENTITIES_TABLE, key);
  });
}

/** Parses one row's entity cell, or null when absent/corrupt (never throws). */
function readEntity<T>(store: Store, table: string, id: string): T | null {
  if (!store.hasRow(table, id)) return null;
  const raw = entityCellSchema.safeParse(store.getCell(table, id, PRIMARY_ENTITY_CELL));
  if (!raw.success) return null;
  try {
    // SAFETY: this cell is written only by `writeEntity` above, which stores
    // `JSON.stringify` of the very `PrimaryEntity` kind each caller reads back
    // for its own table. A malformed/foreign value throws and is caught.
    return JSON.parse(raw.data) as T;
  } catch {
    return null;
  }
}

/** Every entity in a table, corrupt rows skipped. Unordered, callers sort. */
function readEntities<T>(store: Store, table: string): T[] {
  return store
    .getRowIds(table)
    .map((id) => readEntity<T>(store, table, id))
    .filter((entity): entity is T => entity !== null);
}

/** Stable order for a backup-safe, deterministic read: oldest first, id as tiebreak. */
function byCreatedThenId<T extends { createdAt: number; id: string }>(a: T, b: T): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Personal foods
// ---------------------------------------------------------------------------

/** Upserts a personal food (keyed by `id`). */
export async function putLocalFood(food: LocalPersonalFood, { store }: StoreOption = {}): Promise<LocalPersonalFood> {
  writeEntity(await resolveStore(store), PERSONAL_FOODS_TABLE, food.id, food);
  return food;
}

/** Every personal food, oldest first. */
export async function listLocalFoods({ store }: StoreOption = {}): Promise<LocalPersonalFood[]> {
  return readEntities<LocalPersonalFood>(await resolveStore(store), PERSONAL_FOODS_TABLE).toSorted(byCreatedThenId);
}

/** One personal food by id, or null. */
export async function getLocalFood(id: string, { store }: StoreOption = {}): Promise<LocalPersonalFood | null> {
  return readEntity<LocalPersonalFood>(await resolveStore(store), PERSONAL_FOODS_TABLE, id);
}

/** Removes one personal food by id. */
export async function deleteLocalFood(id: string, { store }: StoreOption = {}): Promise<void> {
  deleteEntity(await resolveStore(store), PERSONAL_FOODS_TABLE, id);
}

// ---------------------------------------------------------------------------
// Food logs
// ---------------------------------------------------------------------------

/**
 * Where a food log came from.
 *
 * `restore` is the bulk path: a backup import, and the merge a sync pull ends
 * in, both of which write hundreds of rows the person is not logging right
 * now. It exists ONLY so that the community pulse below can tell a meal from a
 * copy of a meal. Without it, restoring a backup would report a year of
 * dinners as having been eaten this afternoon.
 */
export type FoodLogOrigin = 'user' | 'restore';

/**
 * Upserts a food log (keyed by its `id`/`clientId`, so a replay is
 * exactly-once).
 *
 * THIS IS THE APP'S ONE "a meal was logged" MOMENT, and therefore the single
 * place the community pulse is told about one (M222 spec 03). Five routes
 * write a log and there is no other function they all pass through;
 * `trackFoodLogged` in `matomo-events.ts` is the only near miss, and that file
 * is barred from carrying a numeric value at all, which a calorie figure is.
 *
 * `reportMealFromLog` does the deciding: it sends nothing unless the person
 * turned the pulse on, it rounds, and it folds rows that share a `logBatchId`
 * into one meal. Nothing here can throw.
 */
export async function putLocalFoodLog(
  log: LocalFoodLog,
  { store, origin = 'user' }: StoreOption & { origin?: FoodLogOrigin } = {},
): Promise<LocalFoodLog> {
  writeEntity(await resolveStore(store), FOOD_LOGS_TABLE, log.id, log);
  if (origin === 'user') reportMealFromLog(log);
  return log;
}

/** Every food log, oldest first. */
export async function listLocalFoodLogs({ store }: StoreOption = {}): Promise<LocalFoodLog[]> {
  return readEntities<LocalFoodLog>(await resolveStore(store), FOOD_LOGS_TABLE).toSorted(byCreatedThenId);
}

/** One food log by id, or null (the diary entry-detail route's single-row read). */
export async function getLocalFoodLog(id: string, { store }: StoreOption = {}): Promise<LocalFoodLog | null> {
  return readEntity<LocalFoodLog>(await resolveStore(store), FOOD_LOGS_TABLE, id);
}

/** The food logs on a given device-local day (`YYYY-MM-DD`), oldest first. */
export async function listLocalFoodLogsForDay(dayKey: string, { store }: StoreOption = {}): Promise<LocalFoodLog[]> {
  return (await listLocalFoodLogs({ store })).filter((log) => log.dayKey === dayKey);
}

/** Removes one food log by id. */
export async function deleteLocalFoodLog(id: string, { store }: StoreOption = {}): Promise<void> {
  deleteEntity(await resolveStore(store), FOOD_LOGS_TABLE, id);
}

// ---------------------------------------------------------------------------
// Weight entries
// ---------------------------------------------------------------------------

/** Upserts a weight entry (keyed by `id`). */
export async function putLocalWeightEntry(
  entry: LocalWeightEntry,
  { store }: StoreOption = {},
): Promise<LocalWeightEntry> {
  writeEntity(await resolveStore(store), WEIGHT_ENTRIES_TABLE, entry.id, entry);
  return entry;
}

/** Every weight entry, oldest first. */
export async function listLocalWeightEntries({ store }: StoreOption = {}): Promise<LocalWeightEntry[]> {
  return readEntities<LocalWeightEntry>(await resolveStore(store), WEIGHT_ENTRIES_TABLE).toSorted(byCreatedThenId);
}

/** Removes one weight entry by id. */
export async function deleteLocalWeightEntry(id: string, { store }: StoreOption = {}): Promise<void> {
  deleteEntity(await resolveStore(store), WEIGHT_ENTRIES_TABLE, id);
}

/**
 * Records a weigh-in for `dayKey`, replacing any existing entry for that same
 * day, one weigh-in per calendar day, the local counterpart of the server's
 * `(userId, measuredAt)` unique-index upsert. Reuses the existing row's id
 * (and original `createdAt`) when one exists for the day, so the row is
 * updated in place rather than duplicated; otherwise mints a fresh id. Shared
 * by every route that logs a weigh-in (`settings.goals.tsx`, `onboarding.tsx`).
 */
export async function upsertLocalWeightEntryForDay(
  { dayKey, weightKg }: { dayKey: string; weightKg: number },
  { store }: StoreOption = {},
): Promise<LocalWeightEntry> {
  const resolved = await resolveStore(store);
  const existing = (await listLocalWeightEntries({ store: resolved })).find((entry) => entry.dayKey === dayKey);
  const now = Date.now();
  const entry: LocalWeightEntry = {
    id: existing?.id ?? randomUuid(),
    dayKey,
    weightKg,
    loggedAt: now,
    createdAt: existing?.createdAt ?? now,
  };
  writeEntity(resolved, WEIGHT_ENTRIES_TABLE, entry.id, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Profile / goals (singleton)
// ---------------------------------------------------------------------------

/** The singleton profile/goals row, or null when never written. */
export async function getLocalProfileGoals({ store }: StoreOption = {}): Promise<LocalProfileGoals | null> {
  return readEntity<LocalProfileGoals>(await resolveStore(store), PROFILE_GOALS_TABLE, PROFILE_ROW_ID);
}

/** Writes the singleton profile/goals row. */
export async function putLocalProfileGoals(
  profile: LocalProfileGoals,
  { store }: StoreOption = {},
): Promise<LocalProfileGoals> {
  writeEntity(await resolveStore(store), PROFILE_GOALS_TABLE, PROFILE_ROW_ID, profile);
  return profile;
}

/** The "nothing set yet" profile/goals row, every field unset. */
const EMPTY_PROFILE_GOALS: LocalProfileGoals = {
  timezone: null,
  goalNetCarbsCeilingG: null,
  goalProteinFloorG: null,
  goalKcalTarget: null,
  targetWeightKg: null,
  trackingFocus: null,
  onboardingCompletedAt: null,
  updatedAt: 0,
  heightCm: null,
  birthYear: null,
  biologicalSex: null,
  reproductiveStatus: null,
  pregnancyDueDate: null,
  lactationStartDate: null,
  // Added v20 (M210). `null` is the honest default and not a hidden pick: the
  // readers go through `effectiveEatingStyle`, which derives a style from the
  // goal numbers while this is null, so a device that has never onboarded is
  // graded by what it actually knows.
  eatingStyle: null,
};

/**
 * Merges `patch` onto the existing profile/goals row (or the empty defaults
 * when never written) and writes the result, stamping a fresh `updatedAt`.
 * `undefined` in `patch` leaves a field alone; `null` clears it (same
 * undefined-vs-null convention as the server's `updateUserProfile`). Shared by
 * every route that partially updates the profile (`onboarding.tsx`,
 * `settings.goals.tsx`) so none of them has to hand-spread every field.
 */
export async function patchLocalProfileGoals(
  patch: Partial<Omit<LocalProfileGoals, 'updatedAt'>>,
  { store }: StoreOption = {},
): Promise<LocalProfileGoals> {
  const resolved = await resolveStore(store);
  const existing = (await getLocalProfileGoals({ store: resolved })) ?? EMPTY_PROFILE_GOALS;
  const merged: LocalProfileGoals = { ...existing, ...patch, updatedAt: Date.now() };
  writeEntity(resolved, PROFILE_GOALS_TABLE, PROFILE_ROW_ID, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Body metrics (M135), four optional profile fields, read/written together
// ---------------------------------------------------------------------------

/**
 * The optional body metrics off the singleton profile, with every unset field
 * as `null` (an older row lacks the keys entirely, see `readBodyMetrics`).
 * Returns the fully-unset shape when no profile has ever been written, so no
 * caller has to special-case a brand-new device.
 */
export async function getLocalBodyMetrics({ store }: StoreOption = {}): Promise<BodyMetrics> {
  return readBodyMetrics(await getLocalProfileGoals({ store }));
}

/**
 * Writes every body metric at once, normalising the sex, status and date
 * invariants first (`normalizeBodyMetrics` is the single enforcement point, so
 * no route can store a pregnancy status, a due date or a lactation start date
 * the person can no longer see or withdraw).
 *
 * Whole-record, not a patch, on purpose: the settings form and the onboarding
 * step both submit every field, and a `null` here CLEARS, which is how the
 * person takes an answer back. Nothing on this path is ever sent anywhere; it
 * lands in IndexedDB and travels only through the JSON backup and the E2EE sync
 * payload, exactly like the rest of the profile.
 */
export async function putLocalBodyMetrics(metrics: BodyMetrics, { store }: StoreOption = {}): Promise<BodyMetrics> {
  const normalized = normalizeBodyMetrics(metrics);
  await patchLocalProfileGoals(normalized, { store });
  return normalized;
}

/** Clears every body metric back to unset, the "remove these details" affordance. */
export async function clearLocalBodyMetrics({ store }: StoreOption = {}): Promise<BodyMetrics> {
  return putLocalBodyMetrics({ ...EMPTY_BODY_METRICS }, { store });
}

// ---------------------------------------------------------------------------
// Fasts (M132)
// ---------------------------------------------------------------------------

/**
 * Thrown by `createLocalFast` when a non-ended fast already exists. A typed
 * error (not a string match) so the route can branch on `instanceof` and show
 * a neutral message instead of a stack trace.
 */
export class FastConflictError extends Error {
  constructor() {
    super('A fast is already scheduled or running.');
    this.name = 'FastConflictError';
  }
}

/**
 * Thrown when a reflection note is longer than `FAST_NOTE_MAX_LENGTH`. A typed
 * error for the same reason `FastConflictError` is one: the route branches on
 * `instanceof` and says "that is too long" in the person's language, instead
 * of matching a string or showing a stack trace.
 *
 * REJECT, never truncate. Cutting somebody's own sentence in half and storing
 * the stump loses words they wrote and cannot see were lost, the same class
 * of silent damage as auto-ending a running fast.
 */
export class FastNoteTooLongError extends Error {
  constructor(length: number) {
    super(`A fast note may be at most ${FAST_NOTE_MAX_LENGTH} characters; this one is ${length}.`);
    this.name = 'FastNoteTooLongError';
  }
}

/**
 * How a fast felt and what the person wrote about it, the pair every
 * reflection write takes, so `endLocalFast` and `setLocalFastReflection` can
 * never disagree about the rules.
 *
 * Both members are optional AND nullable, and the three states differ:
 * absent leaves the stored value alone on an edit, `null` clears it, and a
 * value sets it.
 */
export interface FastReflection {
  mood?: FastMood | null;
  note?: string | null;
}

/**
 * THE one enforcement point for the note ceiling.
 *
 * @throws {FastNoteTooLongError} when the note is longer than
 * `FAST_NOTE_MAX_LENGTH`. An absent or `null` note passes, because neither is
 * a note.
 */
function assertNoteWithinLimit(note: string | null | undefined): void {
  if (note === undefined || note === null) return;
  if (note.length > FAST_NOTE_MAX_LENGTH) throw new FastNoteTooLongError(note.length);
}

/**
 * Applies a reflection to a fast row. `undefined` leaves a field as it stands,
 * so `setLocalFastReflection(id, { note })` edits the note without erasing a
 * mood the person recorded when the fast ended.
 */
function withReflection(fast: LocalFast, { mood, note }: FastReflection): LocalFast {
  // Each key is ASSIGNED only when it was given, rather than written as
  // `mood: mood ?? fast.mood`. Assigning `undefined` would leave the key
  // PRESENT-and-undefined on the returned row, which is a different object
  // from the one that never had it, `JSON.stringify` drops it on the way to
  // the store, so the row a caller holds and the row it reads back would stop
  // being equal.
  const reflected: LocalFast = { ...fast };
  if (mood !== undefined) reflected.mood = mood;
  if (note !== undefined) reflected.note = note;
  return reflected;
}

/** Every stored fast, oldest first (createdAt then id). */
export async function listLocalFasts({ store }: StoreOption = {}): Promise<LocalFast[]> {
  return readEntities<LocalFast>(await resolveStore(store), FASTS_TABLE).toSorted(byCreatedThenId);
}

/** One fast by id, or null. */
export async function getLocalFast(id: string, { store }: StoreOption = {}): Promise<LocalFast | null> {
  return readEntity<LocalFast>(await resolveStore(store), FASTS_TABLE, id);
}

/**
 * The single non-ended fast, or null. When the invariant has been broken by a
 * backup restore (see `putLocalFast`), returns the one with the LATEST
 * effective start, and it does so by CALLING `selectCurrentFast` rather than
 * re-implementing its tiebreak, so the store and the model can never disagree
 * about which fast is "the" one. `app/models/fasting.ts` is pure (it imports
 * only types from `schema.ts`), so this import adds no runtime cycle.
 */
export async function findOpenLocalFast({ store }: StoreOption = {}): Promise<LocalFast | null> {
  return selectCurrentFast(await listLocalFasts({ store }));
}

/**
 * Creates a fast, GUARDED: throws `FastConflictError` when a non-ended fast
 * already exists. This is the single enforcement point for the one-fast-at-a-
 * time invariant.
 *
 * REJECT, never auto-end the prior fast: silently stamping an `endedAt` on
 * someone's running fast to make room for a new one writes a duration they
 * never declared into their own history, which is a lie the person can't see
 * being told. The UI never offers the picker while a fast is open, so this
 * throw is a belt-and-braces backstop against a double submit or a second tab,
 * not a user-facing error path.
 */
export async function createLocalFast(
  input: {
    protocolId: FastProtocolId;
    targetDurationMs: number;
    plannedStartAt: number | null;
    startedAt: number | null;
  },
  { store }: StoreOption = {},
): Promise<LocalFast> {
  const resolved = await resolveStore(store);
  const open = await findOpenLocalFast({ store: resolved });
  if (open !== null) throw new FastConflictError();
  const fast: LocalFast = {
    id: randomUuid(),
    protocolId: input.protocolId,
    targetDurationMs: input.targetDurationMs,
    plannedStartAt: input.plannedStartAt,
    startedAt: input.startedAt,
    endedAt: null,
    createdAt: Date.now(),
  };
  writeEntity(resolved, FASTS_TABLE, fast.id, fast);
  return fast;
}

/**
 * UNGUARDED upsert. Exists for exactly two callers:
 *  - `backup.ts`'s `importSnapshot`, which must restore whatever the file
 *    holds rather than reject it, and
 *  - the adjust/end paths below, which write a row that already exists.
 * Never call this to create a NEW fast from the UI, that is `createLocalFast`.
 */
export async function putLocalFast(fast: LocalFast, { store }: StoreOption = {}): Promise<LocalFast> {
  writeEntity(await resolveStore(store), FASTS_TABLE, fast.id, fast);
  return fast;
}

/** Reads one fast and refuses when it is missing, the shared guard of every mutation below. */
async function requireLocalFast(id: string, store: Store): Promise<LocalFast> {
  const fast = await getLocalFast(id, { store });
  if (fast === null) throw new Error(`No fast with id ${id}.`);
  return fast;
}

/**
 * Stamps `endedAt`. Throws if the fast does not exist or is already ended ,
 * a double-end is a bug, not a no-op, and silently swallowing it would make a
 * duplicated submit look successful while discarding the second end instant.
 */
export async function endLocalFast(
  id: string,
  { endedAt, mood, note }: { endedAt: number } & FastReflection,
  { store }: StoreOption = {},
): Promise<LocalFast> {
  // BEFORE the read and before any write: a rejected end must leave the fast
  // running, not end it and then complain about the note.
  assertNoteWithinLimit(note);
  const resolved = await resolveStore(store);
  const fast = await requireLocalFast(id, resolved);
  if (fast.endedAt !== null) throw new Error(`Fast ${id} has already ended.`);
  const ended: LocalFast = { ...withReflection(fast, { mood, note }), endedAt };
  writeEntity(resolved, FASTS_TABLE, ended.id, ended);
  return ended;
}

/**
 * Records or edits the reflection on a fast that has ALREADY ended, the
 * "I meant to say" path, reached from the history list long after the summary
 * card is gone.
 *
 * Deliberately NOT restricted to ended fasts: a person may want to note how a
 * running fast is going, and refusing would be a rule the screen cannot
 * explain. What it does refuse is a note over the ceiling, through the same
 * `assertNoteWithinLimit` the end path uses.
 *
 * @throws {FastNoteTooLongError} when the note is too long.
 * @throws when no fast has that id.
 */
export async function setLocalFastReflection(
  id: string,
  { mood, note }: FastReflection,
  { store }: StoreOption = {},
): Promise<LocalFast> {
  assertNoteWithinLimit(note);
  const resolved = await resolveStore(store);
  const fast = await requireLocalFast(id, resolved);
  const reflected = withReflection(fast, { mood, note });
  writeEntity(resolved, FASTS_TABLE, reflected.id, reflected);
  return reflected;
}

/**
 * Sets `startedAt` on an open fast (the Adjust affordance). Also clears
 * `plannedStartAt` to null: once the person has declared a real start, the
 * plan is spent, and leaving both set means two sources for one fact.
 */
export async function setLocalFastStart(
  id: string,
  { startedAt }: { startedAt: number },
  { store }: StoreOption = {},
): Promise<LocalFast> {
  const resolved = await resolveStore(store);
  const fast = await requireLocalFast(id, resolved);
  if (fast.endedAt !== null) throw new Error(`Fast ${id} has already ended.`);
  const started: LocalFast = { ...fast, startedAt, plannedStartAt: null };
  writeEntity(resolved, FASTS_TABLE, started.id, started);
  return started;
}

/**
 * Moves a SCHEDULED fast's planned start. Throws when the fast has already
 * started (`startedAt !== null`) or ended, those take `setLocalFastStart`.
 */
export async function setLocalFastPlannedStart(
  id: string,
  { plannedStartAt }: { plannedStartAt: number },
  { store }: StoreOption = {},
): Promise<LocalFast> {
  const resolved = await resolveStore(store);
  const fast = await requireLocalFast(id, resolved);
  if (fast.endedAt !== null) throw new Error(`Fast ${id} has already ended.`);
  if (fast.startedAt !== null) throw new Error(`Fast ${id} has already started, adjust its start instead.`);
  const rescheduled: LocalFast = { ...fast, plannedStartAt };
  writeEntity(resolved, FASTS_TABLE, rescheduled.id, rescheduled);
  return rescheduled;
}

/** Removes one fast by id. */
export async function deleteLocalFast(id: string, { store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).delRow(FASTS_TABLE, id);
}

// ---------------------------------------------------------------------------
// Fasting settings (the fasting rework), a SINGLETON, mirroring the profile
// row above: a whole-record write for the restore path, a merging patch for
// every screen.
// ---------------------------------------------------------------------------

/**
 * The "nothing set yet" fasting settings, every field unset, and `updatedAt`
 * 0 so a never-written record LOSES any merge against a real one.
 *
 * Null across the board is the honest default, not a hidden pick: a device
 * that has never opened `/fasting` has chosen no routine, and offering 16:8
 * here would put a decision on screen that nobody made.
 */
const EMPTY_FASTING_SETTINGS: LocalFastingSettings = {
  routineProtocolId: null,
  routineStartMinute: null,
  routineCustomHours: null,
  extendedAcknowledgedAt: null,
  updatedAt: 0,
};

/**
 * The singleton fasting settings row, or the fully-unset defaults when it has
 * never been written.
 *
 * Returns defaults rather than `null`, unlike `getLocalProfileGoals`, because
 * every caller of this one wants a record to read fields off, and the "has a
 * routine" question is answered by `routineProtocolId !== null` rather than by
 * the record's existence. The BACKUP path needs the distinction and reads the
 * row directly (`peekLocalFastingSettings`), so an untouched device exports
 * `fastingSettings: null` instead of a row of nulls.
 */
export async function getLocalFastingSettings({ store }: StoreOption = {}): Promise<LocalFastingSettings> {
  // A COPY of the defaults, never the module constant itself: a caller that
  // mutated what it got back would rewrite the "nothing set yet" answer for
  // every later reader in the page.
  return (await peekLocalFastingSettings({ store })) ?? { ...EMPTY_FASTING_SETTINGS };
}

/**
 * The stored row as it actually is: `null` when this device has never written
 * one. The one reader that must tell "never set" from "set to nothing", the
 * backup/sync snapshot builder, which would otherwise export a record of nulls
 * from a device that has no routine, and hand it to the merge as a real
 * answer.
 */
export async function peekLocalFastingSettings({ store }: StoreOption = {}): Promise<LocalFastingSettings | null> {
  return readEntity<LocalFastingSettings>(await resolveStore(store), FASTING_SETTINGS_TABLE, FASTING_SETTINGS_ROW_ID);
}

/**
 * Merges `patch` onto the stored settings (or the unset defaults) and writes
 * the result, stamping a fresh `updatedAt`. `undefined` leaves a field alone;
 * `null` clears it, the same undefined-versus-null convention
 * `patchLocalProfileGoals` uses, so no screen has to hand-spread the record.
 *
 * This is the path every screen takes. The restore path is
 * {@link putLocalFastingSettingsRecord}, which must NOT re-stamp.
 */
export async function putLocalFastingSettings(
  patch: Partial<Omit<LocalFastingSettings, 'updatedAt'>>,
  { store }: StoreOption = {},
): Promise<LocalFastingSettings> {
  const resolved = await resolveStore(store);
  const existing = (await peekLocalFastingSettings({ store: resolved })) ?? EMPTY_FASTING_SETTINGS;
  const merged: LocalFastingSettings = { ...existing, ...patch, updatedAt: Date.now() };
  writeEntity(resolved, FASTING_SETTINGS_TABLE, FASTING_SETTINGS_ROW_ID, merged);
  return merged;
}

/**
 * Writes the record WHOLE, `updatedAt` included. Exists for exactly two
 * callers, the same two `putLocalFast` serves:
 *  - `backup.ts`'s `importSnapshot`, and
 *  - the sync apply path, which goes through that same importer.
 *
 * Never call it from a screen. Re-stamping `updatedAt` on a restore would make
 * every import look like a fresh local edit, which is a change this device
 * would then push over a peer's genuinely newer routine.
 */
export async function putLocalFastingSettingsRecord(
  settings: LocalFastingSettings,
  { store }: StoreOption = {},
): Promise<LocalFastingSettings> {
  writeEntity(await resolveStore(store), FASTING_SETTINGS_TABLE, FASTING_SETTINGS_ROW_ID, settings);
  return settings;
}

// ---------------------------------------------------------------------------
// Saved meals (M123/07 item 1)
// ---------------------------------------------------------------------------

/** Upserts a saved meal (keyed by `id`). */
export async function putLocalSavedMeal(meal: LocalSavedMeal, { store }: StoreOption = {}): Promise<LocalSavedMeal> {
  writeEntity(await resolveStore(store), SAVED_MEALS_TABLE, meal.id, meal);
  return meal;
}

/** Every saved meal, oldest first. */
export async function listLocalSavedMeals({ store }: StoreOption = {}): Promise<LocalSavedMeal[]> {
  return readEntities<LocalSavedMeal>(await resolveStore(store), SAVED_MEALS_TABLE).toSorted(byCreatedThenId);
}

/** One saved meal by id, or null. */
export async function getLocalSavedMeal(id: string, { store }: StoreOption = {}): Promise<LocalSavedMeal | null> {
  return readEntity<LocalSavedMeal>(await resolveStore(store), SAVED_MEALS_TABLE, id);
}

/** Removes one saved meal by id. Never touches any entry already re-logged from it (items were copied in, not referenced). */
export async function deleteLocalSavedMeal(id: string, { store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).delRow(SAVED_MEALS_TABLE, id);
}

// ---------------------------------------------------------------------------
// Clinician sharing: this account's own key pair, and the peers it has pinned
// (M160/04, `openplate-core` ADR-0002)
// ---------------------------------------------------------------------------

/**
 * Stores this account's share key pair. A SINGLETON, like the profile row.
 *
 * The private key half is written here and nowhere else. It reaches another
 * device only inside the DEK-encrypted sync blob; no caller may post it, log
 * it, or put it in an error message.
 */
export async function putLocalShareIdentity(
  identity: LocalShareIdentity,
  { store }: StoreOption = {},
): Promise<LocalShareIdentity> {
  writeEntity(await resolveStore(store), SHARE_IDENTITY_TABLE, SHARE_IDENTITY_ROW_ID, identity);
  return identity;
}

/** This account's share key pair, or null on a device that has never generated one (the normal state, sharing is opt-in). */
export async function getLocalShareIdentity({ store }: StoreOption = {}): Promise<LocalShareIdentity | null> {
  return readEntity<LocalShareIdentity>(await resolveStore(store), SHARE_IDENTITY_TABLE, SHARE_IDENTITY_ROW_ID);
}

/**
 * Removes this account's share key pair.
 *
 * Deleting it makes every wrap ever addressed to it permanently unopenable ,
 * the same one-way act as deleting a key record. Nothing calls this
 * automatically, and nothing may.
 */
export async function deleteLocalShareIdentity({ store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).delRow(SHARE_IDENTITY_TABLE, SHARE_IDENTITY_ROW_ID);
}

/**
 * Pins a peer's share public key.
 *
 * CALL THIS ONLY FROM A PASSED FINGERPRINT CEREMONY (ADR-0002 prohibition 6).
 * The existence of the row is what records that the ceremony happened, so a
 * call from anywhere else, a server response, an invite payload taken on
 * trust, an "accept the changed key?" prompt, writes a lie that every later
 * re-wrap then believes.
 */
export async function putLocalSharePeer(peer: LocalSharePeer, { store }: StoreOption = {}): Promise<LocalSharePeer> {
  writeEntity(await resolveStore(store), SHARE_PEERS_TABLE, peer.id, peer);
  return peer;
}

/** Every pinned peer, oldest first. */
export async function listLocalSharePeers({ store }: StoreOption = {}): Promise<LocalSharePeer[]> {
  return readEntities<LocalSharePeer>(await resolveStore(store), SHARE_PEERS_TABLE).toSorted(byCreatedThenId);
}

/** One pinned peer by account id, or null when this device has never verified that account's key. */
export async function getLocalSharePeer(
  accountId: number,
  { store }: StoreOption = {},
): Promise<LocalSharePeer | null> {
  return readEntity<LocalSharePeer>(await resolveStore(store), SHARE_PEERS_TABLE, String(accountId));
}

/** Un-pins a peer. Local only, it revokes nothing on the server, which is a separate, explicit act. */
export async function deleteLocalSharePeer(accountId: number, { store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).delRow(SHARE_PEERS_TABLE, String(accountId));
}

// ---------------------------------------------------------------------------
// Research contributions: this account's pseudonym root, and the studies it
// has pinned (M161/03, `openplate-core` ADR-0003)
// ---------------------------------------------------------------------------

/**
 * Stores this account's pseudonym root. A SINGLETON, like the share identity.
 *
 * WRITE IT ONCE. Overwriting an existing root re-pseudonymises this person in
 * every study they already contribute to, and a researcher reads the new
 * pseudonym as a second participant with no history, so the only callers are
 * first enrolment (`runEnrolmentCeremony`, which reuses any existing root) and
 * a backup restore, which is reproducing a root rather than minting one.
 */
export async function putLocalResearchIdentity(
  identity: LocalResearchIdentity,
  { store }: StoreOption = {},
): Promise<LocalResearchIdentity> {
  writeEntity(await resolveStore(store), RESEARCH_IDENTITY_TABLE, RESEARCH_IDENTITY_ROW_ID, identity);
  return identity;
}

/** This account's pseudonym root, or null on a device that has never enrolled in a study (the normal state, contributing is opt-in). */
export async function getLocalResearchIdentity({ store }: StoreOption = {}): Promise<LocalResearchIdentity | null> {
  return readEntity<LocalResearchIdentity>(
    await resolveStore(store),
    RESEARCH_IDENTITY_TABLE,
    RESEARCH_IDENTITY_ROW_ID,
  );
}

/**
 * Pins a study's public key.
 *
 * CALL THIS ONLY FROM A PASSED FINGERPRINT CEREMONY (ADR-0003's second-ranked
 * attack). The row's existence is what records that the fingerprint printed in
 * the study's consent materials was typed and matched, a call from anywhere
 * else writes a lie that every later contribution is then sealed to.
 */
export async function putLocalStudyEnrolment(
  enrolment: LocalStudyEnrolment,
  { store }: StoreOption = {},
): Promise<LocalStudyEnrolment> {
  writeEntity(await resolveStore(store), STUDY_ENROLMENTS_TABLE, enrolment.id, enrolment);
  return enrolment;
}

/** Every study this account has enrolled in, oldest first. */
export async function listLocalStudyEnrolments({ store }: StoreOption = {}): Promise<LocalStudyEnrolment[]> {
  return readEntities<LocalStudyEnrolment>(await resolveStore(store), STUDY_ENROLMENTS_TABLE).toSorted(byCreatedThenId);
}

/** One enrolment by study account id, or null when this device has never joined that study. */
export async function getLocalStudyEnrolment(
  studyAccountId: number,
  { store }: StoreOption = {},
): Promise<LocalStudyEnrolment | null> {
  return readEntity<LocalStudyEnrolment>(await resolveStore(store), STUDY_ENROLMENTS_TABLE, String(studyAccountId));
}

/**
 * Removes an enrolment. LOCAL ONLY, it withdraws nothing on the server, which
 * is a separate, explicit act (`DELETE /contributions/:studyAccountId`), and
 * the server's copy is the one erasure has to reach.
 */
export async function deleteLocalStudyEnrolment(studyAccountId: number, { store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).delRow(STUDY_ENROLMENTS_TABLE, String(studyAccountId));
}
// ---------------------------------------------------------------------------
// The gateway this account joined (M187/02), the singleton that travels in
// the owner-private compartment
// ---------------------------------------------------------------------------
