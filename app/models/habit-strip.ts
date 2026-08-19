/**
 * Pure helpers for the diary's 7-day habit strip — no DB import so they're
 * unit-testable without a database (same split as `food-log-summary.ts`). The
 * diary loader supplies `today` (a local `YYYY-MM-DD` string derived from the
 * user's time zone) and one entry per windowed day (its logged/net-carb state);
 * these map that onto a fixed-width strip of dots, oldest day first.
 *
 * The strip is calm by design: it never renders a "broken streak" — a gap day
 * is just an empty dot, and being over a carb goal is amber, never destructive
 * red (DESIGN §10 reserves red for carb-quality/delete).
 */
import { isOverCarbGoal } from '#app/lib/goal-progress';
import { shiftDate } from '#app/lib/user-days';

/**
 * A day's dot state:
 * - `none`: no logs that day (empty dot, both modes).
 * - `logged`: has logs, but no carb ceiling is set (filled teal — two-state).
 * - `met`: has logs and net carbs are at/under the ceiling (filled teal).
 * - `over`: has logs and net carbs exceed the ceiling (amber, never red).
 */
export type HabitStripStatus = 'none' | 'logged' | 'met' | 'over';

export interface HabitStripDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** True for the strip's final (right-most) day — the user's current local day. */
  isToday: boolean;
  /** Dot state for this day (see `HabitStripStatus`). */
  status: HabitStripStatus;
}

/** One windowed day's logging outcome, fed into the strip. */
export interface HabitStripDayTotal {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** True when the user logged at least one entry on this date. */
  hasLogs: boolean;
  /** The day's net carbs when it has logs, else null (empty day or no computable basis). */
  netCarbs: number | null;
}

/**
 * Resolves a single day's dot state. A day with logs but no computable net
 * carbs (all-unknown carbs) stays the neutral `logged` dot — we can't honestly
 * judge it against the ceiling, so it's never called `met` or `over`. The
 * met/over split uses `isOverCarbGoal` — the same rounded comparison the
 * diary headline uses — so this dot can never disagree with the headline
 * next to it on the same screen.
 */
function statusForDay(total: HabitStripDayTotal | undefined, netCarbsCeiling: number | null): HabitStripStatus {
  if (!total || !total.hasLogs) return 'none';
  if (netCarbsCeiling === null || total.netCarbs === null) return 'logged';
  return isOverCarbGoal({ netCarbs: total.netCarbs, ceiling: netCarbsCeiling }) ? 'over' : 'met';
}

/**
 * Builds a left-to-right strip of `dayCount` days ending on `today` (inclusive),
 * assigning each a dot state. When `netCarbsCeiling` is null the strip is
 * two-state (`logged`/`none`); when a ceiling is set, logged days split into
 * `met`/`over`.
 *
 * @param today - the current local day as `YYYY-MM-DD` (the right-most dot).
 * @param dayCount - number of dots in the strip.
 * @param days - one entry per windowed day (order-independent, keyed by date).
 * @param netCarbsCeiling - the user's daily net-carb ceiling, or null for two-state.
 * @returns the strip, oldest day first, newest (today) last.
 */
export function buildHabitStrip({
  today,
  dayCount,
  days,
  netCarbsCeiling,
}: {
  today: string;
  dayCount: number;
  days: readonly HabitStripDayTotal[];
  netCarbsCeiling: number | null;
}): HabitStripDay[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return Array.from({ length: dayCount }, (_unused, index) => {
    const offset = dayCount - 1 - index;
    const date = shiftDate(today, -offset);
    return { date, isToday: offset === 0, status: statusForDay(byDate.get(date), netCarbsCeiling) };
  });
}

/** How many of the strip's days have at least one log — for the "Logged N of the last 7 days" line. */
export function countLoggedDays(strip: readonly HabitStripDay[]): number {
  return strip.reduce((total, day) => total + (day.status === 'none' ? 0 : 1), 0);
}
