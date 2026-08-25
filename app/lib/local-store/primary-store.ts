/**
 * The primary store's read/write surface — CRUD over the durable, authoritative
 * on-device tables (personal foods, food logs, weight entries, profile/goals,
 * fasts).
 * This is the "primary commit" the diary/add/weight/goals flows write to and the
 * source the aggregates (`aggregates.ts`) and backup (`backup.ts`) read from.
 *
 * Every entity is stored as ONE JSON cell per row (keyed by the entity's `id`),
 * so a row is read/written whole — the same pattern the mirror/outbox use. Reads
 * return entities in a stable order (createdAt then id) so a backup round-trip is
 * deterministic. The store is injectable (defaults to the IndexedDB-backed
 * singleton) so the pure logic and its unit tests run against a real in-memory
 * store with no browser.
 *
 * CRITICAL (M117/01): no function here ever evicts. This store is primary, not a
 * bounded cache — a write never deletes another row. The only deletes are the
 * explicit per-id `delete*` functions.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import { randomUuid } from '#app/lib/uuid';
import { selectCurrentFast } from '#app/models/fasting';
import { EMPTY_BODY_METRICS, normalizeBodyMetrics, readBodyMetrics } from '#app/models/body-metrics';
import type { BodyMetrics } from '#app/models/body-metrics';
import {
  FASTS_TABLE,
  FOOD_LOGS_TABLE,
  PERSONAL_FOODS_TABLE,
  PRIMARY_ENTITY_CELL,
  PROFILE_GOALS_TABLE,
  PROFILE_ROW_ID,
  SAVED_MEALS_TABLE,
  SCHEMA_VERSION_VALUE,
  WEIGHT_ENTRIES_TABLE,
} from './store';
import { getPrimaryStore, requestPersistentStorage } from './persist';
import { markDeviceHasDataForTable } from './had-data';
import { SCHEMA_VERSION } from './schema';
import type {
  FastProtocolId,
  LocalFast,
  LocalFoodLog,
  LocalPersonalFood,
  LocalProfileGoals,
  LocalSavedMeal,
  LocalWeightEntry,
} from './schema';

/** Every entity kind this store persists as one JSON cell per row. */
type PrimaryEntity = LocalPersonalFood | LocalFoodLog | LocalWeightEntry | LocalProfileGoals | LocalFast | LocalSavedMeal;

/** The entity cell as it comes back off the store — a TinyBase cell, not yet JSON text. */
const entityCellSchema = z.string();

/** Options accepted by every primary-store function — the store defaults to the singleton. */
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
 * storage — this is the "first tracker write" durability trigger. Stamps the
 * schema version the store was last written under, so a future migration can
 * detect the on-disk shape.
 *
 * Also stamps the durable "this device has had data before" marker on the
 * first food-log/profile write (M123 spec 01). It belongs HERE, at the one
 * chokepoint every entity write already passes through, so no future write
 * path can be added that forgets it — `markDeviceHasDataForTable` owns the
 * decision about which tables count, and is a no-op for the rest.
 */
function writeEntity(store: Store, table: string, id: string, entity: PrimaryEntity): void {
  requestPersistentStorage();
  store.setValue(SCHEMA_VERSION_VALUE, SCHEMA_VERSION);
  markDeviceHasDataForTable(store, table);
  store.setRow(table, id, { [PRIMARY_ENTITY_CELL]: JSON.stringify(entity) });
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

/** Every entity in a table, corrupt rows skipped. Unordered — callers sort. */
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
  (await resolveStore(store)).delRow(PERSONAL_FOODS_TABLE, id);
}

// ---------------------------------------------------------------------------
// Food logs
// ---------------------------------------------------------------------------

/** Upserts a food log (keyed by its `id`/`clientId`, so a replay is exactly-once). */
export async function putLocalFoodLog(log: LocalFoodLog, { store }: StoreOption = {}): Promise<LocalFoodLog> {
  writeEntity(await resolveStore(store), FOOD_LOGS_TABLE, log.id, log);
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
  (await resolveStore(store)).delRow(FOOD_LOGS_TABLE, id);
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
  (await resolveStore(store)).delRow(WEIGHT_ENTRIES_TABLE, id);
}

/**
 * Records a weigh-in for `dayKey`, replacing any existing entry for that same
 * day — one weigh-in per calendar day, the local counterpart of the server's
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

/** The "nothing set yet" profile/goals row — every field unset. */
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
// Body metrics (M135) — four optional profile fields, read/written together
// ---------------------------------------------------------------------------

/**
 * The four optional body metrics off the singleton profile, with every unset
 * field as `null` (a pre-v8 row lacks the keys entirely — see `readBodyMetrics`).
 * Returns the fully-unset shape when no profile has ever been written, so no
 * caller has to special-case a brand-new device.
 */
export async function getLocalBodyMetrics({ store }: StoreOption = {}): Promise<BodyMetrics> {
  return readBodyMetrics(await getLocalProfileGoals({ store }));
}

/**
 * Writes all four body metrics at once, normalising the sex ↔ reproductive-
 * status invariant first (`normalizeBodyMetrics` is the single enforcement
 * point, so no route can store a pregnancy status the person can no longer see
 * or withdraw).
 *
 * Whole-record, not a patch, on purpose: the settings form and the onboarding
 * step both submit every field, and a `null` here CLEARS — which is how the
 * person takes an answer back. Nothing on this path is ever sent anywhere; it
 * lands in IndexedDB and travels only through the JSON backup and the E2EE sync
 * payload, exactly like the rest of the profile.
 */
export async function putLocalBodyMetrics(metrics: BodyMetrics, { store }: StoreOption = {}): Promise<BodyMetrics> {
  const normalized = normalizeBodyMetrics(metrics);
  await patchLocalProfileGoals(normalized, { store });
  return normalized;
}

/** Clears every body metric back to unset — the "remove these details" affordance. */
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
 * effective start — and it does so by CALLING `selectCurrentFast` rather than
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
 * Never call this to create a NEW fast from the UI — that is `createLocalFast`.
 */
export async function putLocalFast(fast: LocalFast, { store }: StoreOption = {}): Promise<LocalFast> {
  writeEntity(await resolveStore(store), FASTS_TABLE, fast.id, fast);
  return fast;
}

/** Reads one fast and refuses when it is missing — the shared guard of every mutation below. */
async function requireLocalFast(id: string, store: Store): Promise<LocalFast> {
  const fast = await getLocalFast(id, { store });
  if (fast === null) throw new Error(`No fast with id ${id}.`);
  return fast;
}

/**
 * Stamps `endedAt`. Throws if the fast does not exist or is already ended —
 * a double-end is a bug, not a no-op, and silently swallowing it would make a
 * duplicated submit look successful while discarding the second end instant.
 */
export async function endLocalFast(
  id: string,
  { endedAt }: { endedAt: number },
  { store }: StoreOption = {},
): Promise<LocalFast> {
  const resolved = await resolveStore(store);
  const fast = await requireLocalFast(id, resolved);
  if (fast.endedAt !== null) throw new Error(`Fast ${id} has already ended.`);
  const ended: LocalFast = { ...fast, endedAt };
  writeEntity(resolved, FASTS_TABLE, ended.id, ended);
  return ended;
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
 * started (`startedAt !== null`) or ended — those take `setLocalFastStart`.
 */
export async function setLocalFastPlannedStart(
  id: string,
  { plannedStartAt }: { plannedStartAt: number },
  { store }: StoreOption = {},
): Promise<LocalFast> {
  const resolved = await resolveStore(store);
  const fast = await requireLocalFast(id, resolved);
  if (fast.endedAt !== null) throw new Error(`Fast ${id} has already ended.`);
  if (fast.startedAt !== null) throw new Error(`Fast ${id} has already started — adjust its start instead.`);
  const rescheduled: LocalFast = { ...fast, plannedStartAt };
  writeEntity(resolved, FASTS_TABLE, rescheduled.id, rescheduled);
  return rescheduled;
}

/** Removes one fast by id. */
export async function deleteLocalFast(id: string, { store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).delRow(FASTS_TABLE, id);
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
