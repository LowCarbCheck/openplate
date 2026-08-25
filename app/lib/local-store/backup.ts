/**
 * Schema-versioned backup: a full-fidelity JSON export/import of the primary
 * store, plus the "days since last export" tracking that drives the backup nudge
 * (M117/01). This supersedes the server-side `export.ts` route as the durable
 * backup story for a local-first user: the whole tracker (personal foods, food
 * logs, weight, profile/goals, fasts) round-trips losslessly through a
 * device-local file, and the envelope's `schemaVersion` lets an export taken on
 * an older build migrate forward on import.
 *
 * Device-only photos are deliberately excluded — they never enter export, sync,
 * or the server (see `photos.ts`).
 *
 * Split: `serializeBackup`/`parseBackupEnvelope`/`migrateEnvelopeForward` are
 * pure (no store, no browser) so they unit-test directly; `exportBackup`/
 * `importBackup`/`restoreBackup` and the nudge readers are the thin store shell.
 */
import { z } from 'zod';
import type { Store } from 'tinybase';
import { displayPortionSchema } from '#app/lib/portions';
import { micronutrientsPer100gSchema } from '#app/lib/micronutrients';
import { LAST_EXPORT_VALUE } from './store';
import { SCHEMA_VERSION } from './schema';
import type { LocalStoreSnapshot } from './schema';
import { getPrimaryStore } from './persist';
import { getFirstDataAt } from './had-data';
import {
  getLocalProfileGoals,
  listLocalFasts,
  listLocalFoodLogs,
  listLocalFoods,
  listLocalSavedMeals,
  listLocalWeightEntries,
  putLocalFast,
  putLocalFood,
  putLocalFoodLog,
  putLocalProfileGoals,
  putLocalSavedMeal,
  putLocalWeightEntry,
} from './primary-store';

/** A device-local backup file: the schema version, the export instant, and the data. */
export interface BackupEnvelope {
  /** The schema version the `data` was exported under (see `SCHEMA_VERSION`). */
  schemaVersion: number;
  /** ISO-8601 instant the export was taken (informational; not used for equality). */
  exportedAt: string;
  /** The full health snapshot (photos excluded). */
  data: LocalStoreSnapshot;
}

// ---------------------------------------------------------------------------
// Validation schema (mirrors the entity shapes in `schema.ts`)
// ---------------------------------------------------------------------------

const macrosSchema = z.object({
  carbs: z.number().nullable(),
  fiber: z.number().nullable(),
  sugars: z.number().nullable(),
  polyols: z.number().nullable(),
  protein: z.number().nullable(),
  fat: z.number().nullable(),
  kcal: z.number().nullable(),
});

const personalFoodSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  macrosPer100g: macrosSchema,
  source: z.enum(['user', 'plate_ai']),
  createdAt: z.number(),
  // Added v6 — the exact counterpart of `foodLogSchema.netCarbsPer100g` below,
  // and present for the identical reason: zod STRIPS unrecognized keys, so
  // omitting this line would silently drop the figure on every export/import,
  // turning a scanned-and-matched fibre-heavy food's 21.7 g back into a
  // confident, wrong 0 g the next time it surfaced as an /add candidate.
  // `.nullable().optional()` because all three states are meaningful and
  // distinct: an absent key means "no authoritative figure was captured"
  // (recompute from parts) while an explicit `null` means "an upstream source
  // was consulted and had none" (never fabricate a 0). No forward-migration
  // step is needed for the v5 → v6 bump — a v5 envelope simply lacks the key,
  // which is already the correct "never captured" state.
  netCarbsPer100g: z.number().nonnegative().nullable().optional(),
  // Added v10 — the exact counterpart of `foodLogSchema.micronutrientsPer100g`
  // below, sharing the same `micronutrientsPer100gSchema` so a food's stored
  // snapshot and a log's can never drift. Present for the identical reason the
  // line above it is: zod STRIPS unrecognized keys, so omitting this would
  // silently drop every vitamin and mineral figure off a saved food on each
  // export/import — and the loss would be invisible, because the restored food
  // would simply start re-logging as uncovered.
  //
  // `.optional()` WITHOUT `.nullable()`, matching the log's field rather than
  // its `netCarbsPer100g` neighbour: this field is never written as an explicit
  // `null`. "Nothing was captured" is the key's absence; the finer-grained
  // unknowns live INSIDE the snapshot. No forward-migration step is needed for
  // the v9 → v10 bump — a v9 envelope's foods simply lack the key, which is
  // already the correct "never captured" state.
  micronutrientsPer100g: micronutrientsPer100gSchema.optional(),
});

const foodLogSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantityGrams: z.number(),
  macros: macrosSchema,
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).nullable(),
  source: z.enum(['manual', 'plate_ai']),
  aiEstimated: z.boolean(),
  curatedSource: z.string().nullable(),
  foodId: z.string().nullable(),
  dayKey: z.string(),
  loggedAt: z.number(),
  createdAt: z.number(),
  logBatchId: z.string().nullable(),
  // Added v3 (household portions) — `.nullable().optional()` for the same
  // reason as `attribution` below: a pre-v3 envelope simply lacks the key,
  // while a post-v3 gram-only entry carries an explicit `null`, and both must
  // parse. Reuses `displayPortionSchema` rather than re-declaring the shape,
  // so this validator can never drift from the one every FORM already parses
  // through (`portionField`).
  //
  // This line was deliberately deferred when the field was added, on the
  // grounds that `backup.ts` wasn't owned by that round — which left a real
  // gap: zod STRIPS unrecognized keys, so an export → import round trip
  // silently turned every "2 eggs" entry back into a bare gram figure. The
  // grams always survived (`quantityGrams` is the authoritative amount), so
  // nothing miscomputed — but the person's own chosen unit vanished from
  // their own backup, with no error to notice it by.
  portion: displayPortionSchema.nullable().optional(),
  // Added v4 (durability round) — OPTIONAL (not just nullable), matching
  // `LocalFoodLog.attribution`'s own convention, so a pre-v4 envelope (whose
  // `foodLogs[].attribution` key is simply absent) still parses cleanly with
  // no migration step: `.optional()` alone would satisfy `z.infer` as
  // `string | undefined`, but this is deliberately `.nullable().optional()`
  // to also accept an explicit `null` (an entry logged post-v4 whose source
  // carried no licence credit), not just a missing key.
  attribution: z.string().nullable().optional(),
  // Added v5 — `.nullable().optional()` for the same reason as `attribution`,
  // but here the two non-numeric states are semantically DISTINCT and both
  // must survive the round-trip: an absent key means "no authoritative figure
  // was captured" (recompute from parts) while an explicit `null` means "an
  // upstream source was consulted and had none" (never fabricate a 0). Zod
  // strips unrecognized keys, so omitting this line would silently drop the
  // figure on every export/import — turning a fibre-heavy curated entry's
  // 21.7 g back into a confident, wrong 0 g. No forward-migration step is
  // needed for the v4 → v5 bump: a v4 envelope simply lacks the key, which is
  // already the correct "never captured" state.
  netCarbsPer100g: z.number().nonnegative().nullable().optional(),
  // Added v9 (micronutrients, M135) — one OPTIONAL field on an EXISTING
  // entity, so this follows the `attribution`/`netCarbsPer100g` rules above and
  // not the `fasts` rule below: a v8 envelope simply lacks the key, which is
  // already the correct "no micronutrients were captured" state, so no
  // forward-migration step is needed. The line itself IS needed — zod strips
  // unrecognized keys, so omitting it would drop every vitamin and mineral
  // figure on each export/import round trip, and the loss would be invisible:
  // the aggregation would just report the day as uncovered.
  //
  // `.optional()` WITHOUT `.nullable()`, unlike its neighbours: this field is
  // never written as an explicit `null`. "Nothing was captured" is expressed by
  // the key's absence, and the finer-grained unknowns live INSIDE the snapshot
  // (an absent block, or a `null` value in a present one) — see
  // `micronutrientsPer100gSchema`, which is shared with the food-resolution
  // parser so a stored snapshot and a freshly-parsed one can never drift.
  micronutrientsPer100g: micronutrientsPer100gSchema.optional(),
});

const weightEntrySchema = z.object({
  id: z.string(),
  dayKey: z.string(),
  weightKg: z.number(),
  loggedAt: z.number(),
  createdAt: z.number(),
});

const profileGoalsSchema = z.object({
  timezone: z.string().nullable(),
  goalNetCarbsCeilingG: z.number().nullable(),
  goalProteinFloorG: z.number().nullable(),
  goalKcalTarget: z.number().nullable(),
  // Added v2 (M117/03) — see `migrateProfileToV2` for the v1 → v2 default fill.
  targetWeightKg: z.number().nullable(),
  trackingFocus: z.enum(['net-carbs', 'calories', 'habit']).nullable(),
  onboardingCompletedAt: z.number().nullable(),
  updatedAt: z.number(),
  // Added v8 (body metrics, M135) — four OPTIONAL fields on an EXISTING
  // entity, so these follow the `attribution`/`netCarbsPer100g` rules above
  // and not the `fasts` rule below: a v7 envelope simply lacks the keys, which
  // is already the correct "never told us" state, so no forward-migration step
  // is needed. The lines themselves ARE needed: zod strips unrecognized keys,
  // so omitting them would silently empty a person's body metrics on every
  // export/import round trip, and `reproductiveStatus` is the most sensitive
  // datum in the file to lose without a word.
  //
  // `.nullable().optional()` rather than just `.optional()` because the store
  // writes an explicit `null` when a field is cleared, and a cleared field must
  // round-trip as faithfully as a set one.
  heightCm: z.number().positive().nullable().optional(),
  birthYear: z.number().int().nullable().optional(),
  biologicalSex: z.enum(['female', 'male']).nullable().optional(),
  reproductiveStatus: z.enum(['none', 'pregnant', 'lactating']).nullable().optional(),
});

const fastSchema = z.object({
  id: z.string(),
  protocolId: z.enum(['16:8', '18:6', '20:4', 'custom']),
  targetDurationMs: z.number().positive(),
  plannedStartAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  createdAt: z.number(),
});

// Added v11 (saved meals, M123/07) — one item's shape mirrors `foodLogSchema`
// minus placement, for the same reason `schema.ts`'s `LocalSavedMealItem`
// doc comment gives: a saved meal is a template, not a pinned-to-a-day log.
const savedMealItemSchema = z.object({
  name: z.string(),
  quantityGrams: z.number(),
  macros: macrosSchema,
  source: z.enum(['manual', 'plate_ai']),
  aiEstimated: z.boolean(),
  curatedSource: z.string().nullable(),
  foodId: z.string().nullable(),
  portion: displayPortionSchema.nullable().optional(),
  attribution: z.string().nullable().optional(),
  netCarbsPer100g: z.number().nonnegative().nullable().optional(),
  micronutrientsPer100g: micronutrientsPer100gSchema.optional(),
});

const savedMealSchema = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(savedMealItemSchema),
  createdAt: z.number(),
});

const snapshotSchema = z.object({
  foods: z.array(personalFoodSchema),
  foodLogs: z.array(foodLogSchema),
  weightEntries: z.array(weightEntrySchema),
  profile: profileGoalsSchema.nullable(),
  // Added v7 (fasting, M132). READ THIS BEFORE COPYING THE PATTERN ABOVE:
  // every earlier bump in this file added an OPTIONAL FIELD to an existing
  // entity, which needed no migration because a pre-bump row simply lacked the
  // key and `.optional()` accepted it. This bump adds a REQUIRED ARRAY to the
  // snapshot itself, and a v6 envelope has no `fasts` key at all — without a
  // default it would fail `snapshotSchema.safeParse` and every older backup on
  // every device would become un-importable.
  //
  // `.default([])` IS the complete v6 -> v7 forward migration ("this device had
  // no fasts, because fasts did not exist"), which is why there is no
  // `migrateSnapshotToV7` step in `migrateEnvelopeForward` to match
  // `migrateProfileToV2`. Any FUTURE change to `fastSchema`'s own fields is
  // back to the optional-field rules the comments above describe.
  fasts: z.array(fastSchema).default([]),
  // Added v11 (saved meals, M123/07). Same rule as `fasts` above (a whole new
  // entity, not an optional field on an existing one): a v10 envelope has no
  // `savedMeals` key, and `.default([])` IS the complete v10 -> v11 forward
  // migration — "this device had no saved meals, because saved meals did not
  // exist". No `migrateSnapshotToV11` step, for the identical reason there is
  // no `migrateSnapshotToV7` one. See the `NOTE (M123/07, saved meals)` block
  // in `schema.ts`.
  savedMeals: z.array(savedMealSchema).default([]),
});

/**
 * The WRAPPER shape shared by every envelope version — schema-agnostic about
 * `data`. This is deliberately the ONLY thing `parseBackupEnvelope` validates;
 * see the ordering note on `migrateEnvelopeForward` below for why.
 */
const rawEnvelopeSchema = z.object({
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  data: z.unknown(),
});

/** A parsed-but-not-yet-migrated envelope: the version is known, the payload shape is not (yet). */
export type RawBackupEnvelope = z.infer<typeof rawEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Pure serialize / parse / migrate
// ---------------------------------------------------------------------------

/** Serializes an envelope to the JSON string a download writes. Pure. */
export function serializeBackup(envelope: BackupEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Parses a backup JSON string into a `RawBackupEnvelope`, validating ONLY the
 * version-agnostic wrapper (`schemaVersion`/`exportedAt`/`data` presence) — not
 * the shape of `data` itself. Throws a clear error on anything malformed (fail
 * fast — a bad backup file must never partly import). Pure.
 *
 * ORDERING FIX (review of commit 6264322): this used to validate `data`
 * against the CURRENT, full `snapshotSchema` at parse time — which would have
 * rejected a genuinely OLDER envelope (a real pre-v2+ payload shape) before
 * `migrateEnvelopeForward` ever got a chance to upgrade it. Validating only
 * the wrapper here, and validating the migrated payload's final shape inside
 * `migrateEnvelopeForward` (AFTER the version-specific upgrade steps run),
 * means older envelopes reach the migration step instead of being
 * short-circuited by a check written for the current version.
 */
export function parseBackupEnvelope(json: string): RawBackupEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid backup file: not valid JSON.');
  }
  const result = rawEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid backup file: ${result.error.issues[0]?.message ?? 'unrecognized shape'}.`);
  }
  return result.data;
}

/**
 * v1 → v2 upgrade step (M117/03): `LocalProfileGoals` gained `targetWeightKg`,
 * `trackingFocus`, and `onboardingCompletedAt`. A v1 envelope's `data.profile`
 * (when present and non-null) predates those fields — fill them with their
 * "unset" default (`null`) rather than rejecting an otherwise-valid older
 * backup. Leaves everything else untouched; a missing/null `profile` (or a
 * `data` shape that isn't even an object) passes through unchanged, so the
 * final schema validation below still catches a genuinely malformed envelope.
 *
 * The "is this even a v1 profile carrier" test is the schema below: a payload
 * that is not an object, or carries no object-valued `profile`, simply fails
 * the parse at the call site and passes through untouched.
 */
const v1ProfileCarrierSchema = z.looseObject({ profile: z.looseObject({}) });
type V1ProfileCarrier = z.infer<typeof v1ProfileCarrierSchema>;

function migrateProfileToV2(payload: V1ProfileCarrier): V1ProfileCarrier {
  return {
    ...payload,
    profile: {
      targetWeightKg: null,
      trackingFocus: null,
      onboardingCompletedAt: null,
      ...payload.profile,
    },
  };
}

/**
 * Migrates a `RawBackupEnvelope` forward to the current `SCHEMA_VERSION`,
 * validating the FINAL payload shape only AFTER any version-specific upgrade
 * steps have run (see the ordering note on `parseBackupEnvelope`). A
 * newer-than-supported envelope is rejected up front, since this build can't
 * know how to safely down-convert it. Pure.
 */
export function migrateEnvelopeForward(envelope: RawBackupEnvelope): BackupEnvelope {
  if (envelope.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Backup is schema v${envelope.schemaVersion}, newer than this app supports (v${SCHEMA_VERSION}). Update the app to import it.`,
    );
  }
  // Per-version upgrade steps slot in here as the schema evolves, each
  // transforming `migratedData` from the previous version's shape into the
  // next, in turn, BEFORE the final validation below.
  let migratedData = envelope.data;
  if (envelope.schemaVersion < 2) {
    const carrier = v1ProfileCarrierSchema.safeParse(migratedData);
    if (carrier.success) migratedData = migrateProfileToV2(carrier.data);
  }
  // There is deliberately no `if (envelope.schemaVersion < 8) …` step for the
  // v7 → v8 body-metrics bump (M135): it added only OPTIONAL fields to an
  // EXISTING entity, so a v7 envelope's profile simply lacks the four keys and
  // `profileGoalsSchema`'s `.nullable().optional()` accepts it as-is — the
  // absent keys already mean "never told us". Filling them with an explicit
  // `null` the way `migrateProfileToV2` had to would change nothing a reader
  // can observe. See `schema.ts`'s `NOTE (M135, body metrics)`.
  //
  // There is deliberately no `if (envelope.schemaVersion < 9) …` step for the
  // v8 → v9 micronutrient bump either, for the same reason: it added ONE
  // OPTIONAL field to the EXISTING food-log entity, so a v8 envelope's logs
  // simply lack `micronutrientsPer100g` and `foodLogSchema`'s `.optional()`
  // accepts them as-is. Filling the key with an empty object would be actively
  // WRONG here — an empty snapshot is indistinguishable from a populated one at
  // the type level, whereas an absent key is exactly "we captured nothing",
  // which is what a pre-v9 log means.
  //
  // Nor is there one for v9 → v10, which put the SAME optional field on the
  // personal-food entity: a v9 envelope's foods simply lack
  // `micronutrientsPer100g` and `personalFoodSchema`'s `.optional()` accepts
  // them as-is. Back-filling it from anywhere would be worse than useless here
  // — the only honest source for a saved food's micronutrients is the match it
  // was created from, which the envelope does not carry, and re-deriving one
  // from a live lookup would rewrite history for a food that has since been
  // edited. Absent means absent.
  //
  // Nor is there one for v10 → v11 (saved meals, M123/07) — that bump is back
  // under the `fasts` rule, not the optional-field rule: `snapshotSchema`'s
  // `savedMeals: z.array(savedMealSchema).default([])` IS the complete
  // migration, exactly as it was for `fasts` at v6 → v7. A v10 envelope simply
  // has no `savedMeals` key, and `.default([])` reads that as "this device had
  // no saved meals, because saved meals did not exist" — there is nothing left
  // for a per-version step to do.

  const result = snapshotSchema.safeParse(migratedData);
  if (!result.success) {
    throw new Error(
      `Backup migration failed: ${result.error.issues[0]?.message ?? 'payload does not match the current schema'}.`,
    );
  }
  return { schemaVersion: SCHEMA_VERSION, exportedAt: envelope.exportedAt, data: result.data };
}

// ---------------------------------------------------------------------------
// Store shell: export / import
// ---------------------------------------------------------------------------

async function resolveStore(store: Store | undefined): Promise<Store> {
  return store ?? (await getPrimaryStore());
}

/** Reads the full health snapshot from the primary store (deterministic order). */
async function readSnapshot(store?: Store): Promise<LocalStoreSnapshot> {
  return {
    foods: await listLocalFoods({ store }),
    foodLogs: await listLocalFoodLogs({ store }),
    weightEntries: await listLocalWeightEntries({ store }),
    profile: await getLocalProfileGoals({ store }),
    fasts: await listLocalFasts({ store }),
    savedMeals: await listLocalSavedMeals({ store }),
  };
}

/**
 * Whether the primary store currently holds ANY trackable data — foods, food
 * logs, weight entries, fasts, or a saved profile/goals row. This is the `hasData`
 * signal `#app/lib/backup-nudge`'s `shouldShowBackupNudge` needs to nudge a
 * device that's never exported (the population most at risk of losing its
 * only copy) WITHOUT nagging a genuinely brand-new, still-empty device that
 * has nothing to lose yet.
 */
export async function hasAnyLocalData({ store }: { store?: Store } = {}): Promise<boolean> {
  const snapshot = await readSnapshot(store);
  return (
    snapshot.foods.length > 0 ||
    snapshot.foodLogs.length > 0 ||
    snapshot.weightEntries.length > 0 ||
    // A device whose only data is a fast must not be told it has nothing to lose.
    snapshot.fasts.length > 0 ||
    // Nor one whose only data is a saved meal — it took real effort to name
    // and bundle, and losing it silently would be exactly the failure this
    // nudge exists to prevent.
    snapshot.savedMeals.length > 0 ||
    snapshot.profile !== null
  );
}

/** Upserts every entity in a snapshot into the primary store (non-destructive). */
async function importSnapshot(snapshot: LocalStoreSnapshot, store?: Store): Promise<void> {
  for (const food of snapshot.foods) await putLocalFood(food, { store });
  for (const log of snapshot.foodLogs) await putLocalFoodLog(log, { store });
  for (const entry of snapshot.weightEntries) await putLocalWeightEntry(entry, { store });
  // The UNGUARDED put, deliberately: a restore must reproduce the file rather
  // than adjudicate it, so it may land a second open fast on a device that
  // already has one. `selectCurrentFast` picks the latest effective start and
  // the loser shows in history as "Still open" with a Remove action — nothing
  // is invented, nothing is silently dropped.
  for (const fast of snapshot.fasts) await putLocalFast(fast, { store });
  for (const meal of snapshot.savedMeals) await putLocalSavedMeal(meal, { store });
  if (snapshot.profile) await putLocalProfileGoals(snapshot.profile, { store });
}

/** Builds a schema-versioned export envelope from the primary store's current data. */
export async function exportBackup({ store, now }: { store?: Store; now?: () => Date } = {}): Promise<BackupEnvelope> {
  const clock = now ?? (() => new Date());
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: clock().toISOString(),
    data: await readSnapshot(store),
  };
}

/**
 * Imports a (possibly older-version) envelope into the primary store, migrating
 * it forward first. Upsert semantics: existing rows with matching ids are
 * overwritten, others are added — a restore into a fresh store is exact, and a
 * restore into a populated store merges.
 */
export async function importBackup(envelope: BackupEnvelope, { store }: { store?: Store } = {}): Promise<void> {
  const migrated = migrateEnvelopeForward(envelope);
  await importSnapshot(migrated.data, store);
}

/** Parses a backup JSON string and restores it into the primary store. Returns the migrated envelope. */
export async function restoreBackup(json: string, { store }: { store?: Store } = {}): Promise<BackupEnvelope> {
  const migrated = migrateEnvelopeForward(parseBackupEnvelope(json));
  await importSnapshot(migrated.data, store);
  return migrated;
}

// ---------------------------------------------------------------------------
// Backup nudge: last-export tracking (copy/placement is spec 08's job)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between an export instant and `now`; null when never exported. Pure. */
export function computeDaysSinceExport(lastExportMs: number | null, nowMs: number): number | null {
  if (lastExportMs === null) return null;
  return Math.max(0, Math.floor((nowMs - lastExportMs) / MS_PER_DAY));
}

/** The last-export instant as it comes back off the store — a TinyBase value, not yet an epoch-ms. */
const lastExportValueSchema = z.number();

/** Records that the user has just exported a backup (stamps the last-export instant). */
export async function markExported({ store, now }: { store?: Store; now?: () => number } = {}): Promise<void> {
  const clock = now ?? Date.now;
  (await resolveStore(store)).setValue(LAST_EXPORT_VALUE, clock());
}

/** The epoch-ms of the last export, or null when the user has never exported. */
export async function getLastExportAt({ store }: { store?: Store } = {}): Promise<number | null> {
  const value = lastExportValueSchema.safeParse((await resolveStore(store)).getValue(LAST_EXPORT_VALUE));
  return value.success ? value.data : null;
}

/**
 * Whole days since the last backup export, or null when never exported — the
 * datum the spec-08 nudge banner ("you have N days of un-exported data") reads.
 */
export async function daysSinceExport({ store, now }: { store?: Store; now?: () => number } = {}): Promise<
  number | null
> {
  const clock = now ?? Date.now;
  return computeDaysSinceExport(await getLastExportAt({ store }), clock());
}

// ---------------------------------------------------------------------------
// Backup nudge: "days since data first existed" (M123/01 item 4)
// ---------------------------------------------------------------------------

/**
 * Whole days between the instant this device first held data and `now`; null
 * when the device never has (or its marker is unreadable). Pure.
 *
 * Deliberately identical in shape to `computeDaysSinceExport` — same floor-to-
 * whole-days rounding, same `Math.max(0, …)` clamp against a clock that has
 * moved backwards, and the same null-means-"no instant to measure from"
 * semantics. The two feed one comparison against
 * `BACKUP_NUDGE_THRESHOLD_DAYS`, so they must not round differently.
 */
export function computeDaysSinceFirstData(firstDataMs: number | null, nowMs: number): number | null {
  if (firstDataMs === null) return null;
  return Math.max(0, Math.floor((nowMs - firstDataMs) / MS_PER_DAY));
}

/**
 * Whole days since this device first held data, or null when it never has —
 * the datum `shouldShowBackupNudge` measures a NEVER-EXPORTED device against,
 * in place of the `daysSinceExport` it has no value for.
 *
 * Reads `getFirstDataAt`, which lives in the store's VALUES partition and so
 * survives the tables wipe this spec exists to contain — meaning a device that
 * just lost its tables still reports the true age of its data, not zero.
 */
export async function daysSinceFirstData({ store, now }: { store?: Store; now?: () => number } = {}): Promise<
  number | null
> {
  const clock = now ?? Date.now;
  return computeDaysSinceFirstData(await getFirstDataAt({ store }), clock());
}
