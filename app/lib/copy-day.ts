/**
 * Pure time-mapping for the diary's "copy yesterday's meals" action. No DB, no
 * React — the server action reads the source/target local-day boundaries (via
 * the time-zone utils) and this maps each source entry onto the target day.
 *
 * Choice: an entry keeps its ELAPSED TIME SINCE LOCAL MIDNIGHT, not a literal
 * wall-clock re-parse. On an ordinary day these are identical; across a DST
 * transition the copy can land an hour off the original wall clock, which is an
 * acceptable trade for keeping the copy's within-day ordering intact and the
 * logic dependency-free (no zoned-time reconstruction).
 */

/**
 * Maps a source instant onto the target day, preserving its offset from local
 * midnight.
 *
 * @param sourceMs - the source entry's `loggedAt`, epoch ms.
 * @param sourceDayStartMs - UTC instant of the source day's local midnight, epoch ms.
 * @param targetDayStartMs - UTC instant of the target day's local midnight, epoch ms.
 * @returns the mapped `loggedAt` for the copy, epoch ms.
 */
export function remapInstantToTargetDay({
  sourceMs,
  sourceDayStartMs,
  targetDayStartMs,
}: {
  sourceMs: number;
  sourceDayStartMs: number;
  targetDayStartMs: number;
}): number {
  return targetDayStartMs + (sourceMs - sourceDayStartMs);
}
