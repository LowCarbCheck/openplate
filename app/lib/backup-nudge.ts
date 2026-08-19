/**
 * Pure decision + copy for the backup-nudge banner (M117/08). Spec 01 owns the
 * underlying data (`daysSinceExport` in `#app/lib/local-store`); this module
 * owns when that number crosses into "worth mentioning" and what the banner
 * says — no DB, no React, so it's directly unit-testable (mirrors
 * `diary-empty-state.ts`).
 *
 * INVERSION (post-incident review): the original version of this module
 * returned `false` whenever `daysSinceExport` was `null` — which reads as
 * "never nudge a device that's never exported." That's backwards: a device
 * that's NEVER exported is the population most at risk of losing everything
 * with no durable copy anywhere, not the population safest to stay quiet
 * about. `shouldShowBackupNudge` below nudges on `null` too, gated on
 * `hasData` so a genuinely brand-new, still-empty device (which has also
 * never exported, but has nothing to lose yet) still isn't nagged.
 */

/**
 * Days of un-exported data before the nudge shows. Chosen to be non-nagging
 * (a daily logger who exports weekly never sees it) while still catching a
 * device that's gone a couple of weeks without a durable backup — the
 * scenario that matters is "this is the only copy and it's been a while".
 */
export const BACKUP_NUDGE_THRESHOLD_DAYS = 14;

/** Input to {@link shouldShowBackupNudge}. */
export interface BackupNudgeInput {
  /** Whole days since the last export, or `null` when the device has never exported. */
  daysSinceExport: number | null;
  /**
   * Whether the device currently holds any trackable data (foods, food logs,
   * weight entries, or a saved profile/goals row). A brand-new device with no
   * data yet must never be nudged, even though it has also (trivially) never
   * exported — see `hasAnyLocalData` in `local-store/backup.ts`.
   */
  hasData: boolean;
}

/**
 * Whether the backup-nudge banner should render.
 *
 * A device that has never exported (`daysSinceExport === null`) nudges
 * immediately once it holds any data — it is the population with the LEAST
 * durable copy of its data (a single, unbacked-up on-device store), not the
 * population safest to stay silent about. `hasData: false` is the only case
 * that short-circuits to `false` regardless of `daysSinceExport`: a genuinely
 * empty, brand-new device has nothing to lose yet, so nothing to nudge about.
 *
 * @returns whether the nudge threshold has been crossed.
 */
export function shouldShowBackupNudge({ daysSinceExport, hasData }: BackupNudgeInput): boolean {
  if (!hasData) return false;
  if (daysSinceExport === null) return true;
  return daysSinceExport >= BACKUP_NUDGE_THRESHOLD_DAYS;
}
