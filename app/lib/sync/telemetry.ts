/**
 * Content-free, no-user-id Matomo custom-event allowlist for sync
 * feature-adoption/crash signal (M117 design spec D9).
 *
 * NOT yet wired to a live `trackEvent` call — M128 spec 04 owns the sync UX
 * and decides where each of these fires — but the event NAMES live here as
 * the single source of truth so that wiring has a fixed contract to build
 * against. (Previously these sat in `app/lib/sync/extension.ts`, which was
 * deleted with the M117 composition seam in M128 spec 01.)
 *
 * Every event in this list must stay CONTENT-FREE: no dimensions, no values,
 * no user id. Forbidden, per D9: any health content, food names, per-user
 * correlation, or IP-derived identity on these events — if a future change
 * ever wants to attach a value/dimension to one of these, that re-enters D8's
 * legal review scope; it does not ship as a quiet addition.
 */
export const SYNC_TELEMETRY_EVENTS = [
  'sync_setup_completed',
  'sync_enabled',
  'recovery_code_generated',
  'sync_pull_failed',
] as const;

export type SyncTelemetryEvent = (typeof SYNC_TELEMETRY_EVENTS)[number];
