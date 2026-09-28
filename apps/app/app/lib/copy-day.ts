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

/**
 * The dashboard's and the composer's "Wie gestern" door, decided.
 *
 * `sourceDate` is always the day before `targetDate`: the milestone's reading 3
 * (pick an earlier day) is a non-goal, so nothing here takes a source-day
 * argument and nothing downstream submits one.
 */
export interface RepeatYesterdayOffer {
  /** The day the entries come from, `YYYY-MM-DD`. Always the day before `targetDate`. */
  sourceDate: string;
  /** The day the copy lands on, `YYYY-MM-DD`. What the door submits as `date`. */
  targetDate: string;
  /** How many entries yesterday holds. Never zero: an empty yesterday answers null. */
  sourceCount: number;
  /** How many entries today already holds. Zero on a fresh day. */
  targetCount: number;
}

/**
 * Whether to offer a whole-day repeat of yesterday, and with what numbers.
 *
 * The rule, and only this rule: yesterday has entries AND today has fewer than
 * yesterday. Fewer, not none, so the "I logged breakfast and the rest was the
 * same as yesterday" case still gets the door. An empty yesterday is null
 * whatever today holds, because there is nothing to repeat.
 *
 * Pure by design, and dependency-free: the two day keys arrive already derived
 * from the person's timezone by the caller, so this file still reads no clock
 * and no store.
 *
 * @param logs - every food log on the device; only `dayKey` is read.
 * @param today - the target day key, `YYYY-MM-DD`.
 * @param yesterday - the source day key, `YYYY-MM-DD`, the day before `today`.
 * @returns the offer, or null when there is nothing worth offering.
 */
export function selectRepeatYesterday({
  logs,
  today,
  yesterday,
}: {
  logs: readonly { dayKey: string }[];
  today: string;
  yesterday: string;
}): RepeatYesterdayOffer | null {
  let sourceCount = 0;
  let targetCount = 0;
  for (const log of logs) {
    if (log.dayKey === yesterday) sourceCount += 1;
    else if (log.dayKey === today) targetCount += 1;
  }
  // ONE guard, not two. "Yesterday is non-empty" needs no line of its own:
  // counts are never negative, so `targetCount < sourceCount` already implies
  // `sourceCount > 0`, and an empty yesterday reaches `0 >= 0` and answers
  // null. A second `sourceCount === 0` check here was unreachable, and a
  // deliberate mutation of it changed no test, which is what proved it dead.
  if (targetCount >= sourceCount) return null;
  return { sourceDate: yesterday, targetDate: today, sourceCount, targetCount };
}
