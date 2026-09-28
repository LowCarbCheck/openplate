/**
 * Per-day adherence levels for the diary's calendar day picker (`DateNav` in
 * `app/routes/diary.tsx`), so a person paging back through months sees the
 * same verdict and the same colour the 13-week grid uses, on every day they
 * ever logged, not only the last 13 weeks.
 *
 * Deliberately NOT `#app/lib/adherence-grid-days`'s window: that selector
 * enumerates every calendar day in a fixed span, gaps included, because the
 * grid draws a contiguous strip of squares. The calendar instead pages to
 * whatever month the person opens, so there is no fixed span to enumerate,
 * and a gap day would just be a wasted map entry, never rendered. What the
 * two selectors DO share is the per-day totals conversion
 * (`toAdherenceDayTotal`) and the grading itself (`resolveAdherenceDay`), so
 * a day can never read differently on the calendar than it does on the grid.
 */
import { computeDailyEntry } from '#app/models/daily-totals';
import { localFoodLogToSnapshot } from '#app/lib/local-store';
import { toAdherenceDayTotal } from '#app/lib/adherence-grid-days';
import { resolveAdherenceDay } from '#app/models/adherence-grid';
import type { AdherenceGoals } from '#app/models/adherence-grid';
import type { AdherenceCellPaint } from '#app/lib/adherence-cell-fill';
import type { LocalFoodLog } from '#app/lib/local-store/schema';

/** One calendar day's resolved paint, keyed by its local `YYYY-MM-DD` date. Same two fields `AdherenceDay` carries, nothing more: the calendar needs no totals, no verdicts, no counts to paint a square. */
export type CalendarDayLevel = AdherenceCellPaint;

/**
 * Buckets every log by its `dayKey` in one pass, so a diary with years of
 * history costs one scan of `allLogs`, not one scan per distinct day (which
 * is what repeatedly calling `computeDailyTotals` would cost).
 */
function bucketLogsByDay(allLogs: readonly LocalFoodLog[]): Map<string, LocalFoodLog[]> {
  const buckets = new Map<string, LocalFoodLog[]>();
  for (const log of allLogs) {
    const bucket = buckets.get(log.dayKey);
    if (bucket) bucket.push(log);
    else buckets.set(log.dayKey, [log]);
  }
  return buckets;
}

/**
 * The resolved adherence level for every day that has at least one log, over
 * the whole log set. A day with no entry here has no log at all, which the
 * calendar reads as "paint nothing" rather than as an empty/no-data cell,
 * exactly the distinction `resolveAdherenceDay`'s own `no-data` state makes
 * for an unlogged day.
 *
 * @param allLogs - every local food log on the device.
 * @param goals - the user's configured daily goals, built the same way the
 *   dashboard's `adherenceGoals` are (same helpers, same reproductive
 *   addition on `kcalTarget`), so a day never reads a different verdict here
 *   than it would on Overview or `/trends`.
 * @param today - the person's current local day, `YYYY-MM-DD`, decides
 *   `isToday`/`isFuture` for the one day it can apply to.
 * @returns one entry per logged day, keyed by date.
 */
export function selectCalendarDayLevels({
  allLogs,
  goals,
  today,
}: {
  allLogs: readonly LocalFoodLog[];
  goals: AdherenceGoals;
  today: string;
}): Record<string, CalendarDayLevel> {
  return Object.fromEntries(
    Array.from(bucketLogsByDay(allLogs), ([date, logsForDay]): [string, CalendarDayLevel] => {
      const totals = computeDailyEntry(logsForDay.map(localFoodLogToSnapshot));
      const total = toAdherenceDayTotal(date, totals);
      const resolved = resolveAdherenceDay({ total, goals, isToday: date === today, isFuture: date > today });
      return [date, { status: resolved.status, level: resolved.level }];
    }),
  );
}
