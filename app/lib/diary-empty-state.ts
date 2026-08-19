/**
 * Pure decision for which "kind" empty state the diary shows when the viewed
 * day has no entries. No DB, no React — the loader computes the inputs and this
 * picks the message. Kept deliberately gentle: a returning user after a gap is
 * welcomed with a fresh start, never guilted about the days they missed.
 */

/**
 * The three diary empty states:
 * - `first-ever`: the user has never logged anything — invite the first log.
 * - `returning-after-gap`: today is empty and the last log was a while ago —
 *   a warm "fresh start", with no backfill prompts.
 * - `ordinary`: a routine empty day (today or a past day within the recent
 *   window) — the neutral treatment plus the usual add affordances.
 */
export type DiaryEmptyState = 'first-ever' | 'returning-after-gap' | 'ordinary';

/**
 * Resolves the empty state for a day with no entries.
 *
 * @param hasAnyLogs - whether the user has ever logged any food.
 * @param isToday - whether the viewed day is the user's current local day.
 * @param daysSinceLastLog - whole days between the most recent log and today, or
 *   null when the user has never logged (only meaningful with `hasAnyLogs`).
 * @param gapThresholdDays - how many days since the last log counts as "a gap".
 * @returns the empty state to render.
 */
export function resolveDiaryEmptyState({
  hasAnyLogs,
  isToday,
  daysSinceLastLog,
  gapThresholdDays,
}: {
  hasAnyLogs: boolean;
  isToday: boolean;
  daysSinceLastLog: number | null;
  gapThresholdDays: number;
}): DiaryEmptyState {
  if (!hasAnyLogs) return 'first-ever';
  if (isToday && daysSinceLastLog !== null && daysSinceLastLog >= gapThresholdDays) return 'returning-after-gap';
  return 'ordinary';
}
