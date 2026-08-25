/**
 * Versioned local schema — the structural source of truth for the on-device
 * primary store (M117/01, the local-first inversion). The TinyBase mirror/outbox
 * were a 30-day *cache* of server-owned diary data; this module defines the
 * durable, authoritative home for a user's tracker data: personal foods, food
 * logs, weight entries, and profile/goals. Every entity is stored as one JSON
 * cell per row (the established pattern in `mirror.ts`/`outbox.ts`), so a row is
 * read/written whole and complex fields (macros) survive a round-trip untouched.
 *
 * `SCHEMA_VERSION` is stamped into every backup envelope (`backup.ts`) so an
 * export taken on an older app build can be migrated forward on import. Bump it
 * (and add a forward migration in `backup.ts`) whenever an entity shape changes.
 *
 * Pure types + id constants only — no runtime deps beyond `import type`, so the
 * pure logic modules (`aggregates.ts`, `backup.ts`) and their unit tests stay
 * browser- and store-free.
 *
 * NOTE (M117/03): this `SCHEMA_VERSION` bump (v1 → v2, adding the three fields
 * below to `LocalProfileGoals`) is a legitimate local-schema extension needed
 * for a faithful server → device profile migration — it is NOT the sync-blob
 * versioning spec 05 asked to leave alone (that constraint binds spec 06's
 * E2EE sync envelope, a different version counter).
 *
 * NOTE (M12x, household portions): `SCHEMA_VERSION` v2 → v3 adds the OPTIONAL
 * `portion` field to `LocalFoodLog` (see that field's doc comment). It is
 * genuinely optional — not just nullable — specifically so every existing
 * `putLocalFoodLog({...})` call site across the app keeps compiling
 * untouched, and so a pre-v3 on-device row (whose JSON blob simply lacks the
 * key) reads back as a perfectly valid v3 `LocalFoodLog` with no migration
 * step required (`log.portion` is `undefined`, same as "never set"). No
 * forward-migration step is needed in `backup.ts` for this bump either, for
 * the same reason.
 * CLOSED 2026-07-28: `backup.ts`'s `foodLogSchema` now DOES carry
 * `portion: displayPortionSchema.nullable().optional()`. Deferring it left a
 * real gap for one round — zod strips unrecognized keys, so an export →
 * import round-trip dropped the chosen unit (grams survived, since
 * `quantityGrams` is authoritative; the "2 eggs" label did not).
 *
 * NOTE (durability round): `SCHEMA_VERSION` v3 → v4 adds the OPTIONAL
 * `attribution` field to `LocalFoodLog` (see that field's doc comment) — same
 * `?: string | null` convention as `portion` above, for the same reason: a
 * pre-v4 on-device row simply lacks the key, so it reads back as a valid v4
 * `LocalFoodLog` with `attribution: undefined` (never set), no migration
 * required. UNLIKE the `portion` bump, `backup.ts`'s `foodLogSchema` WAS
 * extended for this one (`attribution: z.string().nullable().optional()`) —
 * a licence credit dropped silently on export/import is a real compliance
 * gap, not just a cosmetic one, so this round closes it rather than deferring
 * it the way `portion`'s was deferred.
 *
 * NOTE (authoritative net carbs): `SCHEMA_VERSION` v4 → v5 adds the OPTIONAL
 * `netCarbsPer100g` field to `LocalFoodLog` (see that field's doc comment) —
 * same `?: number | null` convention as `portion`/`attribution` above, for the
 * same reason: a pre-v5 on-device row simply lacks the key, so it reads back
 * as a valid v5 `LocalFoodLog` with `netCarbsPer100g: undefined` (never set),
 * which the readers treat exactly as they always have — recomputing net carbs
 * from the stored macro parts. No migration step is required, and none was
 * added. LIKE the `attribution` bump (and unlike `portion`'s), `backup.ts`'s
 * `foodLogSchema` WAS extended for this one: this field is the difference
 * between a fibre-heavy curated food reading 21.7 g and reading a confident,
 * wrong 0 g, so dropping it on an export/import round-trip would silently
 * corrupt the very number the app exists to track.
 *
 * NOTE (authoritative net carbs, part two): `SCHEMA_VERSION` v5 → v6 adds the
 * OPTIONAL `netCarbsPer100g` field to `LocalPersonalFood` — the SAME field, one
 * entity over, on the same `?: number | null` three-state convention as every
 * bump above, so a pre-v6 on-device row reads back as a valid v6
 * `LocalPersonalFood` with the key absent ("never captured") and no migration
 * step is required. v5 stored the figure on the LOG only, which left the
 * scan-confirm path writing two rows from one upstream fact and keeping the
 * figure on just one of them: `handleConfirm` creates a personal food from the
 * applied curated match's macros, and with nowhere to keep the figure /add's
 * "Your food" row for that food re-derived `carbs - fiber - polyols` and
 * rendered a green 0 while the very same food's diary entry read 21.7. One
 * food, two screens, two numbers. `backup.ts`'s `personalFoodSchema` WAS
 * extended for this one too, for the identical reason `foodLogSchema` was.
 *
 * NOTE (M132, fasting): `SCHEMA_VERSION` v6 → v7 is UNLIKE the five bumps
 * above it, and a reader who pattern-matches on them will get this one wrong.
 * Every prior bump added an OPTIONAL FIELD to an EXISTING entity, which needed
 * no migration because a pre-bump row simply lacked the key and
 * `.nullable().optional()` accepted it. This bump adds a whole new entity
 * (`LocalFast`, plus `FASTS_TABLE`) AND a REQUIRED array — `fasts` — to
 * `LocalStoreSnapshot` itself, and a v6 backup envelope has no `fasts` key at
 * all. The forward migration is therefore not a `migrate*` function in
 * `backup.ts` at all: it is `fasts: z.array(fastSchema).default([])` on
 * `snapshotSchema`, which reads a v6 envelope as "this device had no fasts,
 * because fasts did not exist". See that field's comment in `backup.ts`, which
 * spells the same thing out from the other side. Any FUTURE change to
 * `LocalFast`'s own fields is back under the optional-field rules above.
 *
 * NOTE (M135, body metrics): `SCHEMA_VERSION` v7 → v8 is back under the
 * optional-field rules, NOT the v6 → v7 rules: it adds four OPTIONAL fields —
 * `heightCm`, `birthYear`, `biologicalSex`, `reproductiveStatus` — to the
 * EXISTING `LocalProfileGoals` entity, so a pre-v8 row (and a v7 backup
 * envelope) simply lacks the keys and reads back as a valid v8 profile with
 * every one of them absent, i.e. "never told us". There is therefore no
 * `migrateProfileToV8` step in `backup.ts` — only four new lines on
 * `profileGoalsSchema`, without which zod would STRIP the keys and silently
 * empty the person's body metrics on every export/import round trip.
 *
 * They are `?:` rather than bare `| null` for the reason every optional field
 * above is: every existing `LocalProfileGoals` literal in the app and its tests
 * keeps compiling untouched. Semantically absent and `null` mean the same thing
 * here ("not set") — unlike `netCarbsPer100g`, this is a two-state field, and
 * readers must treat both the same way. The whole app has to work with all four
 * unset; that is health-data minimisation, not an unfinished feature.
 *
 * NOTE (M135, micronutrients): `SCHEMA_VERSION` v8 → v9 is under the SAME
 * optional-field rules as v2 → v6 and v7 → v8: it adds ONE optional field —
 * `micronutrientsPer100g` — to the EXISTING `LocalFoodLog` entity, so a pre-v9
 * row (and a v8 backup envelope) simply lacks the key and reads back as a
 * valid v9 log whose micronutrients were never captured. There is therefore no
 * `migrateFoodLogToV9` step in `backup.ts` — only one new line on
 * `foodLogSchema`, without which zod would STRIP the key and silently drop
 * every vitamin and mineral figure on each export/import round trip.
 *
 * The field's THREE states are not the same three as `netCarbsPer100g`'s, and
 * a reader who assumes they are will get the coverage measure wrong: here the
 * states nest — the field may be absent (no micronutrient dimension at all),
 * present with a block absent (that whole vitamin/mineral dimension is
 * missing), or present with a block whose individual figure is `null` (that
 * one nutrient is unknown). All three read as UNCOVERED, never as zero. See
 * `#app/lib/micronutrients`, which owns the contract and the only reader.
 *
 * NOTE (M135, micronutrients part two): `SCHEMA_VERSION` v9 → v10 adds the
 * SAME `micronutrientsPer100g` field to `LocalPersonalFood` — one entity over,
 * under the same optional-field rules, so a pre-v10 row simply lacks the key
 * and reads back as a valid v10 food whose micronutrients were never captured.
 * No `migrateFoodToV10` step; one new line on `backup.ts`'s
 * `personalFoodSchema`, which zod would otherwise strip.
 *
 * This is the v5 → v6 bump happening a second time, for the same reason and on
 * the same path. v9 stored the snapshot on the LOG only, which left
 * scan-confirm writing two rows from one upstream fact and keeping the figures
 * on just one of them: `handleConfirm` creates a personal food from the applied
 * curated match, and with nowhere to keep the snapshot, re-logging that saved
 * food from /add's "Your foods" contributed ZERO micronutrient coverage — the
 * identical food logged from "Recent" contributed full coverage. One food, two
 * entry points, two different coverage answers, and the one that lost the data
 * is the one a person uses for the foods they eat most.
 *
 * A personal food created any OTHER way — hand-typed manual entry, plain AI
 * plate estimate — carries NO micronutrients and must keep carrying none. The
 * vision schema is deliberately never asked to estimate them (it would
 * fabricate), and a person typing a label has not measured them. Absent is the
 * honest answer; a block of zeros would be a lie the coverage model cannot see
 * through.
 *
 * NOTE (M123/07, saved meals): `SCHEMA_VERSION` v10 → v11 is under the SAME
 * rules as v6 → v7 (fasting), NOT the optional-field rules v2 → v6/v8/v9/v10
 * follow: it adds a WHOLE NEW ENTITY — `LocalSavedMeal`, plus `SAVED_MEALS_TABLE`
 * — and a REQUIRED array, `savedMeals`, to `LocalStoreSnapshot` itself. A v10
 * backup envelope has no `savedMeals` key at all, so the forward migration is
 * not a `migrate*` step in `backup.ts`: it is `savedMeals: z.array(savedMealSchema).default([])`
 * on `snapshotSchema`, which reads a v10 envelope as "this device had no saved
 * meals, because saved meals did not exist" — the exact `fasts` precedent, one
 * entity over. Any FUTURE change to `LocalSavedMeal`'s own fields is back under
 * the optional-field rules above.
 */
import type { MicronutrientsPer100g } from '#app/lib/micronutrients';
import type { Macros } from '#app/lib/macros';
import type { DisplayPortion } from '#app/lib/portions/types';
import type { MealType, FoodLogSourceType, FoodSourceType, TrackingFocusType } from '#types/enums';

/**
 * The on-device schema version. Backup envelopes carry it; imports of an older
 * version are migrated forward before they touch the store. Bump on any change
 * to the entity shapes below.
 */
export const SCHEMA_VERSION = 11;

/**
 * The one owner id this app mints. It scopes the device-local surfaces that
 * carry an owner in their key — the photo cache (`${userId}::${logBatchId}`)
 * and the migration-gate stamp.
 *
 * Introduced in M117/04 as the "no account is signed in" sentinel, chosen as
 * `0` because Postgres `serial` account ids always start at 1 and so could
 * never collide with it. Since M128 spec 03 there are no accounts at all, and
 * this is simply THE owner: `photo-rekey.ts` moves every surviving
 * account-keyed photo row onto it at boot. Never invent another owner id.
 *
 * NOT used for anything in the primary store itself, which is device-scoped
 * and has never carried an owner in its keys (see `index.ts`'s header).
 */
export const ANONYMOUS_USER_ID = 0;

// ---------------------------------------------------------------------------
// Table / cell / value ids (the primary store's structural identifiers)
// ---------------------------------------------------------------------------

/** Table: the user's personal foods, keyed by a client-generated id. */
export const PERSONAL_FOODS_TABLE = 'personalFoods';
/** Table: every food log, keyed by its `clientId` (doubles as the idempotency key). */
export const FOOD_LOGS_TABLE = 'foodLogs';
/** Table: weight entries, keyed by a client-generated id. */
export const WEIGHT_ENTRIES_TABLE = 'weightEntries';
/** Table: profile + goals — a singleton row (see `PROFILE_ROW_ID`). */
export const PROFILE_GOALS_TABLE = 'profileGoals';
/** Table: planned/active/completed fasts, keyed by a client-generated id. */
export const FASTS_TABLE = 'fasts';
/** Table: saved meals (M123/07 item 1), keyed by a client-generated id. */
export const SAVED_MEALS_TABLE = 'savedMeals';

/** The single JSON cell every primary-store row uses to hold its serialized entity. */
export const PRIMARY_ENTITY_CELL = 'entity';

/** The fixed row id for the singleton profile/goals row. */
export const PROFILE_ROW_ID = 'me';

/** Store-level value: the schema version the primary store was last written under. */
export const SCHEMA_VERSION_VALUE = 'schemaVersion';
/** Store-level value: epoch-ms of the last successful backup export (drives the nudge). */
export const LAST_EXPORT_VALUE = 'lastExportAt';
/**
 * Store-level value: epoch-ms the FIRST food log or profile write ever landed
 * on this device — the durable "this device has had data before" marker
 * (M123 spec 01).
 *
 * It lives in the store's VALUES partition (`v`) deliberately. The load/
 * autosave race this spec exists to close empties the TABLES partition (`t`)
 * while `v` is observed to survive, so a `t`-empty/`v`-populated store is not
 * "a new device" — it is "a device that lost its tables". This value is the
 * only thing that can tell those two states apart, and it is readable without
 * consulting `t` at all.
 *
 * Write-once and never cleared: see `had-data.ts`.
 */
export const HAD_DATA_MARKER_VALUE = 'firstDataAt';
/**
 * Store-level value: the userId the one-time server -> device migration gate
 * (`_personal.tsx`) was last confirmed clear for on THIS device (M117/03
 * follow-up fix). Session-scoped trust: written after a successful gate
 * check, cleared on logout — see `app/lib/local-store/migration-gate.ts`.
 */
export const MIGRATION_GATE_CLEARED_FOR_VALUE = 'migrationGateClearedFor';

// ---------------------------------------------------------------------------
// Entity shapes (the durable, authoritative record types)
// ---------------------------------------------------------------------------

/** A user's personal food (per-100g macros), the offline-first counterpart to `foods`. */
export interface LocalPersonalFood {
  /** Client-generated stable id (the TinyBase rowId). */
  id: string;
  name: string;
  brand: string | null;
  /** Per-100g macros. */
  macrosPer100g: Macros;
  source: FoodSourceType;
  /** Epoch-ms the food was created on-device. */
  createdAt: number;
  /**
   * The AUTHORITATIVE net carbs per 100 g for this food, snapshotted from the
   * upstream source (LCC's origin-aware `FoodMatch.netCarbsPer100g`) at the
   * moment the food was created. The exact counterpart of
   * `LocalFoodLog.netCarbsPer100g` — same figure, same basis, same three
   * states — and it exists for the same reason: `macrosPer100g` above may hold
   * EU-convention "available" carbohydrate with fibre ALREADY excluded, so
   * recomputing `carbs - fiber - polyols` from it double-subtracts the fibre
   * and floors a genuinely high-carb food to a confident, green 0 g. There is
   * no way to reconstruct the figure from the stored parts, which is why it is
   * a stored field rather than a derivation.
   *
   * Already per-100 g here, so unlike the log's copy it needs no rescaling
   * note: `macrosPer100g` is the same basis, and the two stay valid together.
   *
   * Three states, identical to `LocalFoodLog.netCarbsPer100g` and to
   * `computeMacroPreview`'s `authoritativeNetCarbsPer100g` contract:
   *  - ABSENT/`undefined` — no authoritative figure was captured. Readers fall
   *    back to computing from the parts, which is the correct answer for a
   *    hand-typed manual food, a plain AI plate estimate, a food migrated from
   *    the server (whose `foods` table has no such column), and every row
   *    written before this field existed.
   *  - `null` — an upstream source was consulted and its figure is genuinely
   *    unknown for this food. Never fabricate a 0 from it.
   *  - a number — the authoritative figure; it wins outright over the parts.
   *
   * A macro EDIT clears this back to absent (the person has become the source,
   * so a stale upstream figure would now be a lie) — see `handleEditFood` in
   * `app/routes/add.tsx`, which reuses `#app/lib/log-edit`'s
   * `resolveEditedNetCarbsPer100g` so the food and the log clear on exactly the
   * same signal. OPTIONAL, not just nullable — same reasoning as every field
   * above (see the `SCHEMA_VERSION` v5 → v6 note).
   */
  netCarbsPer100g?: number | null;
  /**
   * This food's vitamins and minerals PER 100 g, snapshotted from the upstream
   * source at the moment the food was created — the exact counterpart of
   * `LocalFoodLog.micronutrientsPer100g`, with the same nested three states and
   * the same absolute rule that none of them is ever a zero. Added v10 (M135).
   *
   * Already per-100 g here, like `macrosPer100g` beside it, so unlike the log's
   * copy it needs no rescaling note — the two stay valid together, and
   * `localFoodToCandidate` hands this straight to the portion step, which
   * carries it onto the entry the person logs.
   *
   * Captured for exactly ONE kind of personal food: the one `handleConfirm`
   * (`app/routes/scan.tsx`) creates from an APPLIED CURATED MATCH, whose
   * figures genuinely come from LCC. Deliberately ABSENT for a hand-typed
   * manual food and for a plain AI plate estimate, and that absence is a
   * finding, not a gap: nobody measured those vitamins, so claiming any figure
   * — including zeros — would fabricate data the coverage model then reports as
   * confidently known. Do not "fix" this by filling a block.
   *
   * A macro EDIT does NOT clear this, unlike `netCarbsPer100g` above: net carbs
   * are derived from the very macros being edited, while a vitamin C
   * measurement is an independent fact about the matched food that a person
   * adjusting a carb value has neither measured nor invalidated. `handleEditFood`
   * spreads the existing row, so it survives an edit by construction — the same
   * split `resolveAppliedMatchSnapshot` already draws between the two fields.
   * OPTIONAL, not just nullable — same reasoning as every field above (see the
   * `SCHEMA_VERSION` v9 → v10 note).
   */
  micronutrientsPer100g?: MicronutrientsPer100g;
}

/**
 * A single food log — the authoritative entry. `id` is the client-generated
 * `clientId` that doubles as the server-side idempotency key (so the spec-06
 * sync path replays exactly-once). `dayKey` is the device-local calendar day
 * (`YYYY-MM-DD`) the entry belongs to — the local-first source of truth for
 * diary placement, no timezone round-trip required.
 */
export interface LocalFoodLog {
  id: string;
  name: string;
  quantityGrams: number;
  /** Per-serving macros (already scaled from per-100g). */
  macros: Macros;
  mealType: MealType | null;
  source: FoodLogSourceType;
  aiEstimated: boolean;
  curatedSource: string | null;
  /** The personal-food id this log was created from, when any. */
  foodId: string | null;
  /** Device-local calendar day (`YYYY-MM-DD`) — the diary bucket for this entry. */
  dayKey: string;
  /** Epoch-ms the entry is logged against (may be back-dated). */
  loggedAt: number;
  /** Epoch-ms the row was created on-device. */
  createdAt: number;
  /** Shared batch id (copy-yesterday etc.), for grouped undo; null otherwise. */
  logBatchId: string | null;
  /**
   * The DISPLAY portion the person actually chose ("2 eggs"), kept alongside
   * the always-authoritative `quantityGrams` so a reload renders the real
   * unit again instead of a bare gram figure (M12x household portions — see
   * `#app/lib/portions`). `null`/absent for gram-only entries: every log
   * recorded before this field existed, and any entry logged by typing an
   * exact weight that doesn't correspond to a whole portion choice.
   * OPTIONAL, not just nullable — see the `SCHEMA_VERSION` v2 → v3 note above
   * for why.
   */
  portion?: DisplayPortion | null;
  /**
   * The source's licence credit ("Bundeslebensmittelschlüssel (BLS) 4.0 — Max
   * Rubner-Institut, CC BY 4.0 (adapted)"), copied verbatim from the curated
   * match's own `attribution` at the moment this entry was logged. CC BY is a
   * real licence obligation, not a nicety: the credit must survive wherever
   * the underlying data is shown, so this snapshot — not a live re-lookup —
   * is what the entry detail page renders, exactly like `macros`/`name` are
   * already snapshotted rather than re-fetched. `null`/absent for every entry
   * whose source carries no attribution (manual, AI-estimated, or a curated
   * source with no licence string) and for every entry logged before this
   * field existed. OPTIONAL, not just nullable — same reasoning as `portion`
   * above (see the `SCHEMA_VERSION` v3 → v4 note).
   */
  attribution?: string | null;
  /**
   * The AUTHORITATIVE net carbs per 100 g for this food, snapshotted from the
   * upstream source (LCC's origin-aware `FoodMatch.netCarbsPer100g`) at the
   * moment this entry was logged. Load-bearing, not a cache: bls/curated rows
   * report EU-convention "available" carbohydrate with fibre ALREADY excluded,
   * so recomputing `carbs - fiber - polyols` from this entry's own `macros`
   * double-subtracts the fibre and can floor a genuinely high-carb food to a
   * confident, green 0 g. There is no way to reconstruct this figure from the
   * stored parts — hence a stored field rather than a derivation.
   *
   * Stored PER 100 g, deliberately, even though `macros` is per-serving:
   * `quantityGrams` is editable, and a per-serving figure would silently
   * desync the moment someone re-portions the entry, whereas a per-100 g basis
   * rescales correctly forever. `localFoodLogToSnapshot` does the
   * `× quantityGrams / 100` scaling on the way out to the per-serving
   * `FoodLogMacroSnapshot.netCarbs` the day-total math consumes.
   *
   * Three states, mirroring `computeMacroPreview`'s `authoritativeNetCarbsPer100g`
   * contract in `#app/lib/portion-preview`:
   *  - ABSENT/`undefined` — no authoritative figure was captured for this
   *    entry. Readers fall back to computing from parts, which is the correct
   *    answer for a manual entry, an AI plate estimate, and every row logged
   *    before this field existed.
   *  - `null` — an upstream source was consulted and its figure is genuinely
   *    unknown for this food. Never fabricate a 0 from it.
   *  - a number — the authoritative figure; it wins outright over the parts.
   *
   * A macro EDIT clears this back to absent (the user has become the source,
   * so a stale upstream figure would now be a lie); a QUANTITY edit preserves
   * it (per-100 g, so it stays valid). See `diary.entry.$id.tsx`'s `handleSave`.
   * OPTIONAL, not just nullable — same reasoning as `portion`/`attribution`
   * above (see the `SCHEMA_VERSION` v4 → v5 note).
   */
  netCarbsPer100g?: number | null;
  /**
   * The food's vitamins and minerals PER 100 g, snapshotted from the upstream
   * source (LCC's `FoodMatch.micronutrientsPer100g`) at the moment this entry
   * was logged. Added v9 (M135).
   *
   * A snapshot for the same reason `netCarbsPer100g` and `attribution` are: the
   * authoritative figure is the one that was true when the person ate the food.
   * LCC's rows get corrected and re-imported; a live re-lookup would silently
   * rewrite last month's diary, and a food that later loses its match would
   * lose its history with it.
   *
   * Stored PER 100 g, deliberately, for the identical reason `netCarbsPer100g`
   * is: `quantityGrams` is editable, and a per-serving figure would desync the
   * moment someone re-portions the entry. `computeDailyMicronutrients`
   * (`aggregates.ts`) does the `× quantityGrams / 100` scaling on the way out.
   *
   * States — three of them, NESTED, and none of them is zero:
   *  - ABSENT/`undefined` — no micronutrient dimension was captured for this
   *    entry. Correct for a manual entry, an AI plate estimate (the vision
   *    schema is deliberately NOT asked to estimate micronutrients — it would
   *    fabricate them), a BLS/FDC-origin match, and every row logged before
   *    this field existed. Every nutrient is UNCOVERED.
   *  - A BLOCK absent (`vitamins` or `minerals` missing) — that whole dimension
   *    is unavailable for this food. Those nutrients are UNCOVERED.
   *  - A value `null` inside a present block — the source was consulted and has
   *    no figure for that one nutrient. UNCOVERED for it alone.
   * A numeric value, INCLUDING `0`, is a real measurement: it sums as 0 and
   * counts as COVERED. Never fabricate a 0 from any of the three absent states
   * — that is the single correctness rule this whole field exists to serve.
   *
   * Unlike `netCarbsPer100g`, a macro EDIT does NOT clear this. Net carbs are
   * derived from the very macros being edited, so an upstream figure computed
   * for different numbers becomes a lie; a vitamin C measurement is an
   * independent fact about the food that was matched, and the person editing a
   * carb value has not measured — or invalidated — it.
   * OPTIONAL, not just nullable — same reasoning as every field above (see the
   * `SCHEMA_VERSION` v8 → v9 note).
   */
  micronutrientsPer100g?: MicronutrientsPer100g;
}

/** A weight measurement, one per entry (a day may hold more than one). */
export interface LocalWeightEntry {
  id: string;
  /** Device-local calendar day (`YYYY-MM-DD`) the measurement belongs to. */
  dayKey: string;
  weightKg: number;
  loggedAt: number;
  createdAt: number;
}

/**
 * Biological sex, as the reference-intake tables segment it (M135). A
 * string-literal union rather than a boolean because the data has two named
 * columns, and because a union can grow a value without every reader having to
 * re-read what `true` meant.
 *
 * This is a lookup key into nutrient reference data, nothing more — it is never
 * shown back to the person as a label about them, and the settings surface
 * always offers "prefer not to say", which stores nothing at all.
 */
export type BiologicalSex = 'female' | 'male';

/**
 * Pregnancy / lactation status (M135). A union, not a boolean, because the
 * reference-intake tables carry SEPARATE `pregnancy` and `lactation` columns —
 * a boolean could not tell them apart, and would force a second flag later.
 * `none` is the explicit "not applicable" value, so the person can put the
 * answer back exactly the way they found it.
 *
 * The most sensitive datum this app stores. It lives only in the browser's
 * IndexedDB, rides the JSON backup and the E2EE sync payload like every other
 * profile field (both of which the server cannot read — see ADR-0006), and is
 * never part of any outbound request: the food API only ever receives a food
 * name.
 */
export type ReproductiveStatus = 'none' | 'pregnant' | 'lactating';

/** The singleton profile + daily goals row. */
export interface LocalProfileGoals {
  /** IANA time zone, or null when not yet set (device zone is used as fallback). */
  timezone: string | null;
  goalNetCarbsCeilingG: number | null;
  goalProteinFloorG: number | null;
  goalKcalTarget: number | null;
  /** Target body weight in kg, or null when not set (added v2, M117/03). */
  targetWeightKg: number | null;
  /** Selected tracking focus, or null when not chosen yet (added v2, M117/03). */
  trackingFocus: TrackingFocusType | null;
  /**
   * Epoch-ms the onboarding wizard was completed (or skipped — skipping still
   * stamps completion, see `app/lib/onboarding.ts`), or null while still
   * pending. Added v2, M117/03 — onboarding completion is now a LOCAL concept
   * (the server no longer holds a profile row for a new account at all).
   */
  onboardingCompletedAt: number | null;
  /** Epoch-ms of the last profile/goals write. */
  updatedAt: number;
  /**
   * Standing height in centimetres (added v8, M135). Feeds the Mifflin-St Jeor
   * energy estimate in `#app/models/body-metrics`; nothing else reads it.
   * Absent/`null` — and the estimate simply isn't offered.
   */
  heightCm?: number | null;
  /**
   * Year of birth (added v8, M135). Deliberately the YEAR, not a date of
   * birth: the reference-intake data is bucketed into age bands five years wide
   * at their narrowest (14-18, 19-30, 31-50, 51-70, over 70), so a full birth
   * date would collect precision the feature cannot use. Collecting less is the
   * point, not a shortcut.
   */
  birthYear?: number | null;
  /** Biological sex (added v8, M135) — reference intakes are sex-segmented. */
  biologicalSex?: BiologicalSex | null;
  /**
   * Pregnancy / lactation status (added v8, M135). Only meaningful alongside
   * `biologicalSex === 'female'`; `normalizeBodyMetrics`
   * (`#app/models/body-metrics`) is the single place that keeps the two
   * consistent, so a sex change can never strand a stale status.
   */
  reproductiveStatus?: ReproductiveStatus | null;
}

/**
 * Which fasting window a fast targets. The three named protocols are the
 * conventional time-restricted-eating windows (fasting hours : eating hours);
 * `custom` means the person typed their own hour count and the real target
 * lives in `targetDurationMs`.
 *
 * The literals are deliberately NOT translated — "16:8" is written the same in
 * every language this app ships, and turning it into a catalog key would only
 * create a way for the two locales to disagree about a number.
 */
export type FastProtocolId = '16:8' | '18:6' | '20:4' | 'custom';

/**
 * One fast — planned, running, or finished. Status is never stored: it is
 * derived from these timestamps against `now` (see `app/models/fasting.ts`'s
 * `resolveFastTimeline`), which is what lets a scheduled fast auto-activate
 * with no background job, no notification, and no write.
 */
export interface LocalFast {
  /** Client-generated stable id (the TinyBase rowId). */
  id: string;
  protocolId: FastProtocolId;
  /**
   * The target length in ms. ALWAYS authoritative, including for a named
   * protocol — `protocolId` is a label, this is the number. A future change to
   * what "16:8" means must not retroactively rewrite a finished fast.
   */
  targetDurationMs: number;
  /**
   * Epoch-ms the fast is planned to begin, or null for a start-now fast.
   * Once this instant passes and `endedAt` is still null the fast IS active —
   * nothing writes anything to make that true.
   */
  plannedStartAt: number | null;
  /**
   * Epoch-ms the fast actually began — written ONLY when the person set it
   * explicitly (started now, or adjusted the start time). Auto-activation
   * leaves this null on purpose, so the row stays honest about what the person
   * actually declared. Readers use `startedAt ?? plannedStartAt`.
   */
  startedAt: number | null;
  /** Epoch-ms the fast was ended. Null while scheduled or running. */
  endedAt: number | null;
  /** Epoch-ms the row was created on-device. */
  createdAt: number;
}

/**
 * One food inside a saved meal (M123/07 item 1) — everything a fresh
 * `LocalFoodLog` needs to be recreated from this snapshot at re-log time,
 * EXCEPT placement (`dayKey`/`loggedAt`/`mealType`/`logBatchId`), which a
 * re-log always sets fresh for the moment it's actually logged — a saved
 * meal is not itself pinned to a day or a meal slot, only its re-logged
 * instances are. Deliberately the same field set `LocalFoodLog` carries for
 * "what was eaten" (name/quantity/macros/provenance/portion/attribution/
 * authoritative figures), so `buildSavedMealFromLogs`/`buildLogsFromSavedMeal`
 * (`saved-meals.ts`) are a straight field copy in each direction, not a lossy
 * projection.
 */
export interface LocalSavedMealItem {
  name: string;
  quantityGrams: number;
  /** Per-serving macros (already scaled from per-100g), exactly as `LocalFoodLog.macros`. */
  macros: Macros;
  source: FoodLogSourceType;
  aiEstimated: boolean;
  curatedSource: string | null;
  /** The personal-food id this item was created from, when any — see `LocalFoodLog.foodId`. */
  foodId: string | null;
  /** The chosen display portion ("2 eggs"), same convention as `LocalFoodLog.portion`. */
  portion?: DisplayPortion | null;
  /** The source's licence credit, same convention as `LocalFoodLog.attribution`. */
  attribution?: string | null;
  /** Authoritative per-100g net carbs, same three-state convention as `LocalFoodLog.netCarbsPer100g`. */
  netCarbsPer100g?: number | null;
  /** Per-100g vitamins/minerals, same convention as `LocalFoodLog.micronutrientsPer100g`. */
  micronutrientsPer100g?: MicronutrientsPer100g;
}

/**
 * A named, reusable bundle of foods (M123/07 item 1) — "save as meal" bundles
 * one or more currently-logged foods (typically a whole meal group) into this
 * shape, and re-logging it creates one fresh `LocalFoodLog` per item, stamped
 * with whatever day/time/meal the re-log names. A saved meal is a TEMPLATE,
 * never a log itself: editing or deleting it never touches any entry already
 * logged from it (the items were copied in, not referenced).
 */
export interface LocalSavedMeal {
  /** Client-generated stable id (the TinyBase rowId). */
  id: string;
  /** The person's chosen name ("Sunday breakfast"). */
  name: string;
  items: LocalSavedMealItem[];
  /** Epoch-ms the meal was saved on-device. */
  createdAt: number;
}

/**
 * A full, lossless snapshot of the primary store's health data — the payload a
 * backup envelope carries (`backup.ts`). Device-only photos are deliberately
 * excluded (they never enter export, sync, or the server — see `photos.ts`).
 */
export interface LocalStoreSnapshot {
  foods: LocalPersonalFood[];
  foodLogs: LocalFoodLog[];
  weightEntries: LocalWeightEntry[];
  profile: LocalProfileGoals | null;
  /**
   * Added v7 (fasting, M132) — REQUIRED, unlike every optional field added by
   * the five bumps before it. A v6 envelope has no `fasts` key, so
   * `backup.ts`'s `.default([])` is what makes an older backup importable; see
   * the `NOTE (M132, fasting)` block at the top of this file.
   *
   * NOT merged across devices by the E2EE sync engine: `snapshot-sync.ts`'s
   * `mergeSnapshots` passes the LOCAL side through untouched (see its comment).
   * Fasts round-trip through the JSON backup only.
   */
  fasts: LocalFast[];
  /**
   * Added v11 (saved meals, M123/07) — REQUIRED, under the same rule as
   * `fasts` above (a whole new entity, not an optional field on an existing
   * one). A v10 envelope has no `savedMeals` key; `backup.ts`'s
   * `.default([])` is the complete v10 → v11 forward migration. See the
   * `NOTE (M123/07, saved meals)` block at the top of this file.
   */
  savedMeals: LocalSavedMeal[];
}
