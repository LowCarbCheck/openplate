/**
 * Pure copy selection for the streak card (`app/components/streak-card.tsx`,
 * rendered on Trends since the profile page it used to live on was retired).
 * Split out from its consumer so it's safely unit-testable — the copy choice is
 * the part with the interesting edge case, and it needs no local store, no
 * router and no i18next instance to exercise.
 *
 * `computeStreak` (`#app/lib/local-store/aggregates`) only counts a day toward the
 * streak when it's both logged AND at/under the user's net-carb goal (an over-goal
 * day breaks the streak by design). That means `streak` can legitimately be `0` even
 * though food WAS logged today — an over-goal day, or the day after one. The old
 * copy always said "Log a food today to start a streak" whenever `streak` was `0`,
 * which is actively false on a day someone DID log food. `todayHasLogs` (read off
 * the same `dailyTotals` the streak was computed from — its last entry is always
 * today, see `computeDailyTotalsInRange`) disambiguates the two cases.
 */

/** What `describeStreak` needs to know: the computed streak length, and whether today itself has any logs. */
export interface StreakSnapshot {
  streak: number;
  todayHasLogs: boolean;
}

/**
 * A translation lookup, threaded in as a parameter (M129/05).
 *
 * This module must stay pure and importable from `node:test`, so it never
 * imports the i18next singleton — the caller (a React component) passes its
 * own `t` down.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * The streak card's description text for a given `{ streak, todayHasLogs }` snapshot.
 * Singular/plural selection is delegated to i18next's `count` handling rather than
 * branched here, so a language with different plural rules than English gets them.
 */
export function describeStreak({ streak, todayHasLogs }: StreakSnapshot, t: Translate): string {
  if (streak > 0) return t('trends.streak.active', { count: streak });
  if (todayHasLogs) return t('trends.streak.overGoal');
  return t('trends.streak.empty');
}
