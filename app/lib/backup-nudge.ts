/**
 * Pure decision + copy for the backup-nudge banner (M117/08). Spec 01 owns the
 * underlying data (`daysSinceExport` / `daysSinceFirstData` in
 * `#app/lib/local-store`); this module owns when those numbers cross into
 * "worth mentioning" and what the banner says — no DB, no React, so it's
 * directly unit-testable (mirrors `diary-empty-state.ts`).
 *
 * TWO CORRECTIONS, IN ORDER. The original version returned `false` whenever
 * `daysSinceExport` was `null` — "never nudge a device that's never exported."
 * That is backwards: a never-exported device is the population most at risk of
 * losing everything with no durable copy anywhere. The first fix inverted it,
 * so `null` nudged as soon as the device held any data.
 *
 * That over-corrected. Nudging the instant data appears means a user sees a
 * "back up your data" banner minutes after their first food log, when there is
 * one entry to lose and no habit to protect yet — nagging, and nagging is what
 * gets a banner permanently tuned out before the day it matters.
 * `BACKUP_NUDGE_THRESHOLD_DAYS` exists precisely to make this nudge rare.
 *
 * So a never-exported device is now judged on the SAME threshold, measured
 * from a different instant: "days since data first existed" (the `firstDataAt`
 * marker) instead of "days since last export" (which it has no value for). One
 * threshold, two clocks — the nudge means "your only copy is 14+ days old"
 * whether or not an export has ever happened.
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
   * Whole days since this device first held data (the `firstDataAt` marker),
   * or `null` when the marker is absent — either because the device has never
   * held data, or because it predates the marker shipping. Only consulted when
   * `daysSinceExport` is `null`; see `shouldShowBackupNudge` for how the two
   * `null` causes are told apart.
   */
  daysSinceFirstData: number | null;
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
 * The rule, in order:
 *
 * 1. No data at all → never nudge. Nothing to lose yet.
 * 2. Has exported before → nudge once the export is `BACKUP_NUDGE_THRESHOLD_DAYS`
 *    old. Unchanged behaviour.
 * 3. Never exported, marker readable → nudge once the DATA is that old. Same
 *    threshold, measured from when the data first appeared.
 * 4. Never exported, marker missing but data present → nudge.
 *
 * Case 4 is the pre-marker device: `firstDataAt` only started being written in
 * M123, so devices in the field today hold data with no marker at all. Both
 * readings are defensible, and this one is chosen deliberately. A device with
 * data and no marker necessarily acquired that data BEFORE the marker shipped
 * — its data is, by construction, older than any device the marker can
 * measure, so it is on the far side of the threshold rather than the near
 * side. Treating it as "too new to nudge" would permanently silence the nudge
 * for the exact longest-lived, never-exported devices it was written for, and
 * silence it invisibly. The costs are not symmetric: guessing "nudge" costs
 * one dismissible amber banner; guessing "stay quiet" costs a user everything
 * they have, with no backup, and no warning that one was ever needed.
 *
 * @returns whether the nudge threshold has been crossed.
 */
export function shouldShowBackupNudge({ daysSinceExport, daysSinceFirstData, hasData }: BackupNudgeInput): boolean {
  if (!hasData) return false;
  if (daysSinceExport !== null) return daysSinceExport >= BACKUP_NUDGE_THRESHOLD_DAYS;
  if (daysSinceFirstData === null) return true;
  return daysSinceFirstData >= BACKUP_NUDGE_THRESHOLD_DAYS;
}
