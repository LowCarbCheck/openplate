/**
 * Pure copy selection for the streak, which is the ACTIVITY streak on both
 * screens that show it (M235/06): the card on `/trends` and the header line of
 * the grid card on `/dashboard`.
 *
 * ── WHAT CHANGED, AND WHY THE OLD BRANCH IS GONE ─────────────────────────
 *
 * This module used to describe `computeStreak`, the adherence walk, which
 * counts a day only when the diary was logged AND net carbs stayed at or under
 * the ceiling. That needed a third sentence, `overGoal`, for the honest but
 * unhappy case of a person who logged every day and read zero. M235 replaced
 * the headline with the activity streak, which counts a day a person USED the
 * app, so that case cannot arise and the sentence that explained it is gone
 * with it. `computeStreak` still exists and still has its tests; it feeds the
 * separate `onplan.*` award family now.
 *
 * No loss language, in either branch. A streak that ended is never announced
 * here; the number simply reads lower the next time it is read.
 *
 * Kept as its own module because the copy choice is the testable part, and it
 * needs no local store, no router and no i18next instance to exercise.
 */

/**
 * A translation lookup, threaded in as a parameter (M129/05).
 *
 * This module must stay pure and importable from `node:test`, so it never
 * imports the i18next singleton, the caller (a React component) passes its
 * own `t` down.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * The streak line for a given activity streak.
 *
 * Singular/plural selection is delegated to i18next's `count` handling rather
 * than branched here, so a language with different plural rules than English
 * gets them.
 *
 * @param streak - consecutive days this person used the app, ending today or yesterday.
 * @param t - the caller's translator.
 * @returns the sentence under the streak's title.
 */
export function describeStreak(streak: number, t: Translate): string {
  if (streak > 0) return t('trends.streak.active', { count: streak });
  return t('trends.streak.empty');
}
