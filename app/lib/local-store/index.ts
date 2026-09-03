/**
 * openplate local-first data layer (TinyBase) — public surface.
 *
 * M117/01 inverted this layer: the local store is now the PRIMARY, authoritative
 * home for the tracker's health data (personal foods, food logs, weight,
 * profile/goals), not a 30-day cache of server rows. The durable store, its
 * aggregates, and the backup path live in `schema.ts` / `primary-store.ts` /
 * `aggregates.ts` / `backup.ts`. M117/03 deploy-2 removed the diary MIRROR
 * cache entirely (`mirror.ts`, `eviction.ts`) — it was a read-through cache of
 * SERVER diary loader payloads, and the server routes it cached no longer
 * exist; the primary store below is always available now, so there is no
 * network-failure fallback left to cache.
 *
 * CONFLICT STANCE: LAST-WRITE-WINS. This is single-user personal data. Multi-
 * device real-time convergence (TinyBase `MergeableStore` + an E2EE
 * synchronizer) is the recorded FUTURE path (spec 06) — the outbox/oplog
 * machinery below is preserved for it, not for server POSTs of health data.
 *
 * DEVICE-OWNERSHIP DECISION (M128 spec 03 — the accountless cutover): the
 * primary store is DEVICE-scoped, not account-scoped — every table here is one
 * flat IndexedDB database per browser profile, with no per-userId namespacing
 * or row-level ownership check anywhere in `primary-store.ts`/`aggregates.ts`.
 * That is now the only coherent design: the app has no accounts at all, so
 * there is no "current account" concept to scope storage keys by. The photo
 * cache — the one local surface that WAS account-keyed, because a shared
 * device used to host several signed-in accounts — is re-keyed onto the
 * `ANONYMOUS_USER_ID` sentinel at boot (`photo-rekey.ts`), so every local
 * surface now agrees on a single owner. A shared family device should use
 * separate browser profiles per person; that is the isolation boundary, and
 * the only one. Don't add per-userId filtering back here piecemeal — there is
 * no identity left for it to filter on. Per-account isolation, if it is ever
 * wanted, arrives with the standalone sync service's own encrypted per-account
 * blob identity (M128 spec 04), not as scoping bolted onto this local store.
 *
 * IndexedDB-backed stores (see `store.ts` / `persist.ts`):
 * - primary (`openplate-primary`): the durable, authoritative tracker data.
 * - outbox  (`openplate-outbox`): queued log intents with client-generated
 *   idempotency ids (reused for the spec-06 encrypted-sync path).
 * - photos  (`openplate-photos`): device-only plate photos, never exported/synced.
 *
 * IMPORTING is always SSR-safe: store access is lazy, so importing this module
 * from a route (whose server loader runs in Node) has no top-level side
 * effects. CALLING a `getXStore()` singleton is NOT server-safe — resolving
 * one outside a browser with IndexedDB now throws loudly (`persist.ts`'s
 * `assertBrowserWithIndexedDb`), rather than silently sharing one in-memory
 * store across every request/user as it used to. Server-side code (and unit
 * tests) must construct a store directly and pass it via `{ store }`.
 */

// Primary store: the authoritative on-device home for health data.
export {
  putLocalFood,
  listLocalFoods,
  getLocalFood,
  deleteLocalFood,
  putLocalFoodLog,
  listLocalFoodLogs,
  listLocalFoodLogsForDay,
  getLocalFoodLog,
  deleteLocalFoodLog,
  putLocalWeightEntry,
  listLocalWeightEntries,
  deleteLocalWeightEntry,
  upsertLocalWeightEntryForDay,
  getLocalProfileGoals,
  putLocalProfileGoals,
  patchLocalProfileGoals,
  // Body metrics (M135) — the four optional profile fields, read/written as one
  // record so the sex ↔ reproductive-status invariant has a single home.
  getLocalBodyMetrics,
  putLocalBodyMetrics,
  clearLocalBodyMetrics,
  // Fasts (M132). `createLocalFast` is the GUARDED create (one open fast at a
  // time); `putLocalFast` is the unguarded upsert the backup restore needs.
  createLocalFast,
  putLocalFast,
  listLocalFasts,
  getLocalFast,
  findOpenLocalFast,
  endLocalFast,
  setLocalFastStart,
  setLocalFastPlannedStart,
  deleteLocalFast,
  FastConflictError,
  // Saved meals (M123/07 item 1) — a named, reusable bundle of foods.
  putLocalSavedMeal,
  listLocalSavedMeals,
  getLocalSavedMeal,
  deleteLocalSavedMeal,
  // Clinician sharing (M160/04) — this account's own share key pair, and the
  // peer public keys it has pinned through the typed fingerprint ceremony.
  // The identity's PRIVATE half is the only secret the primary store holds;
  // the BYOK provider key deliberately lives in a separate database
  // (`ai-settings.ts`) and must never move here.
  putLocalShareIdentity,
  getLocalShareIdentity,
  deleteLocalShareIdentity,
  putLocalSharePeer,
  listLocalSharePeers,
  getLocalSharePeer,
  deleteLocalSharePeer,
  // Research contributions (M161/03) — the pseudonym root and the studies
  // pinned by the typed ceremony. Both are OWNER-PRIVATE in the synced
  // snapshot: the root recomputes every pseudonym this person will ever
  // present, and the enrolment list is which studies they joined.
  putLocalResearchIdentity,
  getLocalResearchIdentity,
  putLocalStudyEnrolment,
  listLocalStudyEnrolments,
  getLocalStudyEnrolment,
  deleteLocalStudyEnrolment,
  // The gateway this account joined (M187/02). OWNER-PRIVATE in the synced
  // snapshot and absent from every backup: the member token is a provider
  // credential issued to the person, not to this browser profile.
  putLocalGatewayConnection,
  getLocalGatewayConnection,
} from './primary-store';

// Pure saved-meal builders (no store) — the "save as meal"/"re-log a saved
// meal" arithmetic, kept testable without a store or a DOM.
export { buildSavedMealFromLogs, buildLogsFromSavedMeal } from './saved-meals';

// Local aggregates (daily totals / streak / trend / habit strip), no network read.
export {
  computeDailyTotals,
  computeDailyTotalsInRange,
  computeStreak,
  computeNetCarbTrendSeries,
  computeLocalHabitStrip,
  getLocalDailyTotals,
  getLocalDailyTotalsInRange,
  // Exported so every surface that needs a log's macro snapshot uses THE one
  // mapper rather than hand-rolling a second copy (see its doc comment).
  localFoodLogToSnapshot,
  // Per-nutrient daily micronutrients (M135) — intake and its coverage, never
  // one without the other. See `NutrientDayIntake`.
  computeDailyMicronutrients,
  computeDailyMicronutrientsInRange,
  getLocalDailyMicronutrients,
  getLocalDailyMicronutrientsInRange,
  // The whole selected window as ONE aggregate (M135/06) — a reference intake
  // is a daily amount, so `/nutrients` needs a per-day figure it can compare
  // against one. See `WindowMicronutrients`.
  computeMicronutrientsInWindow,
  DEFAULT_MIN_COVERAGE_FRACTION,
} from './aggregates';
export type {
  LocalDailyTotals,
  TrendPoint,
  DailyMicronutrients,
  WindowMicronutrients,
  NutrientDayIntake,
  NutrientCoverage,
} from './aggregates';

// Local recent-foods / frequent-chips / quick-add-candidate federation
// (M117/03 route cutover — the local counterparts of the server-side
// listRecentFoodsForUser / selectFrequentChips / quick-add-search modules).
export {
  computeLocalRecentFoods,
  selectLocalFrequentChips,
  localRecentFoodToCandidate,
  localFoodToCandidate,
  localCuratedMatchToCandidate,
  federateLocalQuickAddCandidates,
} from './local-quick-add';
export type {
  LocalRecentFood,
  LocalFrequentChip,
  LocalQuickAddSource,
  LocalQuickAddCandidate,
} from './local-quick-add';

// Schema-versioned backup + the backup-nudge (last-export) tracking.
export {
  serializeBackup,
  parseBackupEnvelope,
  migrateEnvelopeForward,
  exportBackup,
  importBackup,
  restoreBackup,
  markExported,
  getLastExportAt,
  daysSinceExport,
  computeDaysSinceExport,
  // "Days since data first existed" — what the backup nudge measures a
  // never-exported device against (M123/01 item 4). Derived from the
  // `firstDataAt` marker below, so it outlives a tables wipe.
  daysSinceFirstData,
  computeDaysSinceFirstData,
  hasAnyLocalData,
} from './backup';
export type { BackupEnvelope, RawBackupEnvelope } from './backup';

// The durable "this device has had data before" marker (M123 spec 01). Lives
// in the store's VALUES partition, which survives the tables wipe the
// load/autosave race causes — so it is the only thing that can tell "never
// onboarded" apart from "lost its tables". `_personal.tsx`'s onboarding gate
// is its consumer: an empty-logs read must consult `hasEverHadData` before it
// is allowed to treat the device as a fresh install.
export { hasEverHadData, getFirstDataAt, marksDeviceHasData } from './had-data';

// Versioned schema: the constant + the entity/snapshot types.
export { SCHEMA_VERSION, ANONYMOUS_USER_ID } from './schema';
export type {
  LocalPersonalFood,
  LocalFoodLog,
  LocalWeightEntry,
  LocalProfileGoals,
  LocalStoreSnapshot,
  LocalFast,
  FastProtocolId,
  BiologicalSex,
  ReproductiveStatus,
  LocalSavedMeal,
  LocalSavedMealItem,
  LocalShareIdentity,
  LocalSharePeer,
  LocalResearchIdentity,
  LocalStudyEnrolment,
  LocalSubmittedWindow,
  LocalGatewayConnection,
  ConnectedGatewayConnection,
} from './schema';

// BYOK AI settings + local-only usage log (M117/02) — device-only, never
// synced/backed-up, never sent to the openplate server.
export { getLocalAiSettings, putLocalAiSettings, deleteLocalAiSettings } from './ai-settings';
export type { LocalAiSettings } from './ai-settings';
export {
  recordLocalAiUsageEvent,
  listLocalAiUsageEvents,
  computeLocalMonthlyAiUsage,
  getLocalMonthlyAiUsage,
} from './ai-usage-log';
export type { LocalAiUsageEvent } from './ai-usage-log';

// Outbox/oplog machinery (preserved for the spec-06 encrypted-sync path).
export { enqueueLogIntent, pendingEntriesForDate, listOutboxRecords, flushOutbox, flushOutboxOnce } from './outbox';
export { clientTodayKey } from './time';
export { resolveLocalTimezone } from './timezone';

// Migration-gate device stamp (M117/03). Its original caller — `_personal.tsx`'s
// account-scoped server → device migration gate — is gone with the account
// system (M128 spec 03), so nothing in the app reads it today. Kept as the
// device-local "this gate has been confirmed clear here" primitive rather than
// deleted, since the sync client (M128 spec 04) needs exactly this shape and
// the stored value itself still exists on every device that ran the M117 build.
export {
  shouldSkipMigrationGateCheck,
  getMigrationGateClearedFor,
  setMigrationGateClearedFor,
  clearMigrationGateStamp,
} from './migration-gate';
export { shouldFallbackOffline } from './offline-fallback';
export { buildOfflineLogInput } from './add-offline-input';
export type {
  OutboxRecord,
  OutboxIntent,
  OutboxStatus,
  PendingLogEntry,
  PendingLogDisplay,
  EnqueueLogInput,
  FlushResult,
  FlushSurface,
} from './types';
