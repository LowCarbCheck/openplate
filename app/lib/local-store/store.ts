/**
 * TinyBase store definitions and ids — the single home for the local layer's
 * table/cell identifiers and store factories. `createStore()` is pure JS (no
 * browser needed), so these factories are usable in SSR and in unit tests
 * against a real in-memory store; IndexedDB persistence is layered on in
 * `persist.ts`.
 */
import { createStore, type Store } from 'tinybase';

// The primary store's structural ids live in `schema.ts` (the versioned schema).
// They are re-exported here so this module stays the single lookup point for
// every local-store table/cell id — the primary tables (personal foods, food
// logs, weight entries, profile/goals, and fasts) alongside the outbox/photos/AI
// cache tables below.
export {
  PERSONAL_FOODS_TABLE,
  FOOD_LOGS_TABLE,
  WEIGHT_ENTRIES_TABLE,
  PROFILE_GOALS_TABLE,
  FASTS_TABLE,
  SAVED_MEALS_TABLE,
  PRIMARY_ENTITY_CELL,
  PROFILE_ROW_ID,
  SCHEMA_VERSION_VALUE,
  LAST_EXPORT_VALUE,
  HAD_DATA_MARKER_VALUE,
  MIGRATION_GATE_CLEARED_FOR_VALUE,
  ANONYMOUS_USER_ID,
} from './schema';

/**
 * IndexedDB database name for the PRIMARY store — the durable, authoritative
 * home for personal foods, food logs, weight entries, and profile/goals
 * (M117/01). Distinct from the outbox/photos caches so it is never swept by
 * any cache-eviction path. (The read-through MIRROR store this comment used
 * to also distinguish from was removed in M117/03 deploy-2 — see
 * `index.ts`'s header.)
 */
export const PRIMARY_DB_NAME = 'openplate-primary';
/** IndexedDB database name for the write outbox store. */
export const OUTBOX_DB_NAME = 'openplate-outbox';
/**
 * IndexedDB database name for the on-device plate-photo cache. A dedicated DB
 * (separate from the primary/outbox) so clearing or evicting photos never
 * touches primary tracker data, and photos never enter any sync path.
 */
export const PHOTOS_DB_NAME = 'openplate-photos';
/**
 * IndexedDB database name for the client-side BYOK AI settings + local usage
 * log (M117/02). A dedicated DB, separate from the primary store, so a backup
 * export of tracker health data (`backup.ts`) can never accidentally carry a
 * user's API key — this store is never read by the backup envelope.
 */
export const AI_DB_NAME = 'openplate-ai';

/** Outbox table: one row per queued write, keyed by the record's `clientId`. */
export const OUTBOX_TABLE = 'outbox';
/** Cell holding the JSON-serialized `OutboxRecord`. */
export const OUTBOX_RECORD_CELL = 'record';

/** Photos table: one row per cached plate photo, keyed by its `logBatchId`. */
export const PHOTOS_TABLE = 'photos';
/** Cell holding the base64 data-URL of the (already-downscaled) plate JPEG. */
export const PHOTO_DATA_URL_CELL = 'dataUrl';
/** Cell holding the original JPEG byte size, for the settings usage line. */
export const PHOTO_BYTE_SIZE_CELL = 'byteSize';
/** Cell holding the epoch-ms the photo was cached, for retention GC. */
export const PHOTO_CREATED_AT_CELL = 'createdAt';
/** Store-level value holding the save-photos preference (default ON when unset). */
export const PHOTOS_ENABLED_VALUE = 'enabled';

/** AI-settings table: a SINGLETON row (see `AI_SETTINGS_ROW_ID`) holding the device's BYOK provider/model/key. */
export const AI_SETTINGS_TABLE = 'aiSettings';
/** The fixed row id for the singleton AI-settings row. */
export const AI_SETTINGS_ROW_ID = 'me';
/** AI-usage-events table: one row per recorded scan attempt, keyed by a client-generated id. */
export const AI_USAGE_EVENTS_TABLE = 'aiUsageEvents';
/** The single JSON cell every AI-settings/usage row uses to hold its serialized entity. */
export const AI_ENTITY_CELL = 'entity';

export function createPrimaryStore(): Store {
  return createStore();
}

export function createOutboxStore(): Store {
  return createStore();
}

export function createPhotosStore(): Store {
  return createStore();
}

export function createAiStore(): Store {
  return createStore();
}
