/**
 * The activity streak: consecutive local days a person USED the app (M235/01).
 *
 * This is not `computeStreak` (`app/lib/local-store/aggregates.ts:413`) and it
 * must never become it. That walk counts a day only when the diary was logged
 * AND net carbs stayed under the ceiling, so one over-goal day reads as "you
 * broke your streak" to somebody who opened the app every single day. It stays
 * in the codebase as the input to the separate `onplan.*` award family. The
 * walk here asks one question instead: did anything happen that day.
 *
 * The shape of the walk is copied from `resolveStreakDays`
 * (`app/models/fasting-stats.ts:135`) rather than invented a third time: the
 * count ends on today when today is active, and on yesterday when it is not, so
 * a morning check reads the streak that is still standing instead of zero.
 *
 * Pure: no store, no clock. `today` arrives as an argument.
 */
import { shiftDate } from '#app/lib/user-days';

import { signalCountsTowardActive } from './catalog';
import type { LocalActivityMark } from './marks';

/**
 * The furthest back the walk will look.
 *
 * The bound is not a product rule, it is what keeps a corrupt or adversarial
 * input from turning the walk into an unbounded loop. Ten years is far longer
 * than the app has existed, so it can never truncate a real run, and each step
 * is one set lookup.
 */
export const MAX_ACTIVE_STREAK_DAYS = 3660;

/**
 * The days that count as active, sorted oldest first, each listed once.
 *
 * A day is active when it carries at least one signal whose
 * `SIGNAL_COUNTS_TOWARD_ACTIVE` is true. A day carrying only `backup.export` is
 * therefore not active, which is the whole point of that flag.
 *
 * @param marks - every mark held on this device, in any order, duplicates allowed.
 * @returns the active day keys, sorted and unique.
 */
export function activeDayKeys(marks: readonly LocalActivityMark[]): string[] {
  const days = new Set<string>();
  for (const mark of marks) {
    if (!signalCountsTowardActive(mark.signal)) continue;
    days.add(mark.dayKey);
  }
  // `YYYY-MM-DD` sorts lexicographically the same way it sorts chronologically,
  // which is the reason the key is stored zero-padded in the first place.
  return [...days].toSorted();
}

/**
 * The current activity streak, in consecutive local days.
 *
 * Ends on `today` when `today` is active, otherwise on the day before. A day
 * AFTER `today` is ignored entirely: a device whose clock ran fast, or a mark
 * pulled from a device in a further-ahead time zone, must not be able to add to
 * a count a person is asked to trust. Holes and duplicates in `activeDays` are
 * fine; the walk reads a set, not the list's order.
 *
 * @param activeDays - active day keys, as `activeDayKeys` returns them.
 * @param today - the person's current local day, `YYYY-MM-DD`.
 * @returns the number of consecutive active days ending at today or yesterday, 0 when neither is active.
 */
export function computeActiveStreak({ activeDays, today }: { activeDays: readonly string[]; today: string }): number {
  const active = new Set(activeDays.filter((day) => day <= today));
  let cursor = active.has(today) ? today : shiftDate(today, -1);
  let days = 0;
  while (days < MAX_ACTIVE_STREAK_DAYS) {
    if (!active.has(cursor)) return days;
    days += 1;
    cursor = shiftDate(cursor, -1);
  }
  return days;
}
