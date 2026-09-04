/**
 * Domain enums shared across the app.
 *
 * These outlived the server-side schema they were named for: openplate keeps
 * no database, and every entity below lives in the browser's IndexedDB store
 * (`app/lib/local-store/`). The literal values are persisted on the device, so
 * changing one is a local-store migration, not a rename.
 */

/** Where a food master row in the local store came from. */
export type FoodSourceType = 'user' | 'plate_ai';

/** Where a food-log entry in the local store came from. */
export type FoodLogSourceType = 'manual' | 'plate_ai';

/** Meal grouping for a food log entry. */
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * The AI provider backing a user's plate-identification requests. Everything a
 * provider DOES — its endpoint, adapter, auth methods, key check and UI
 * placement — is described once in `app/services/vision/registry.ts`; this is
 * the plain enum that registry is keyed by.
 *
 * `'managed'` (M192) is the odd one and is worth its own sentence: it is the
 * only member that is never STORED. On a managed instance the settings are
 * derived from the open session — the sync server's `/v1`, the model it
 * advertises, and the account's own access token as the bearer — so nothing is
 * written into `openplate-ai` for it and no row ever carries this value. It is
 * in the enum because `createVisionProvider` dispatches on it, and putting it
 * anywhere else would mean a second dispatch beside the registry.
 */
export type AiProviderType = 'openrouter' | 'mistral' | 'openai-compatible' | 'anthropic' | 'managed';

/**
 * Outcome of a single plate-identification provider call, recorded on every
 * attempt in the local store's AI usage log. `identified` = foods returned; `no_foods` =
 * a successful (billed) call that found nothing; `error` = the provider call
 * threw (network/non-2xx/malformed output).
 */
export type AiUsageOutcomeType = 'identified' | 'no_foods' | 'error';

/**
 * Which metric a user primarily optimizes for on their local profile.
 * Drives dashboard emphasis and goal copy — `net-carbs` foregrounds the
 * net-carb ceiling, `calories` the kcal target, `habit` the logging streak.
 * NULL on the column means the user hasn't chosen a focus yet.
 */
export type TrackingFocusType = 'net-carbs' | 'calories' | 'habit';

// `SyncKeyRecordKind` used to live here too, for the `sync_key_records.kind`
// column. Both the column and the table are gone (M128 spec 03 — sync storage
// belongs to the standalone `openplate-sync` service now), and the wire-level
// type of the same name survives where the protocol is defined:
// `app/lib/sync/engine/protocol.ts`. There is deliberately no re-export here —
// this file is the DB's enum surface, and that type is no longer a DB concern.
