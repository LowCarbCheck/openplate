/**
 * The four figures the fasting screen shows about a practice rather than about
 * one fast: how many you finished, your longest, how many days in a row you are
 * on, and how many hours you fasted this week.
 *
 * Pure, like `models/fasting.ts`: `nowMs` and `timezone` are parameters and
 * nothing in here reads a clock or the store. Every status question is answered
 * by `resolveFastTimeline`, so this module can never disagree with the screen
 * about whether a fast is running.
 *
 * WHY A STREAK AT ALL, AND WHY IT IS FORGIVING
 *
 * DESIGN.md section 10.1 forbids copy that grades the person, and a streak is
 * the classic way an app starts doing exactly that. This one is built to state
 * a fact and not to punish:
 *
 * - A day counts at 60 minutes fasted, not at a completed protocol. The day you
 *   ended early still counts.
 * - The streak may end on YESTERDAY. Checking the app at 07:00, before today
 *   has any fasted minutes in it, must not read "0" and wipe out a fortnight of
 *   work that is still standing. Today extends the streak, it never breaks it.
 * - Minutes are counted by intersecting each fast with each LOCAL day, so a
 *   16:8 fast from 20:00 to 12:00 credits both days it actually covered instead
 *   of only the day it started on.
 *
 * WHY THE ONE HOUR FLOOR IS NOT APPLIED TO THE HOURS FIGURE
 *
 * `completedCount`, `longestMs` and `currentStreakDays` all take a fast
 * seriously only from one hour, because below that "a fast" is not a unit.
 * `hoursLast7Days` is a different kind of claim: it is a count of real fasted
 * hours, so a 40 minute fast contributes its 40 minutes there. Filtering it too
 * would make the week total disagree with the person's own history list.
 *
 * OVERLAPPING FASTS ARE COUNTED TWICE, ON PURPOSE
 *
 * A backup restore can leave two open rows (see `selectCurrentFast`). Rather
 * than adjudicating which of two overlapping fasts is real, this sums both. The
 * alternative is silently dropping a row the person can still see in their
 * history, and the restore case already surfaces in the UI as "Still open" with
 * a Remove action.
 */
import { dayBoundsInTimezone, shiftDate, todayInTimezone } from '#app/lib/user-days';
import type { LocalFast } from '#app/lib/local-store/schema';
import { resolveFastTimeline } from '#app/models/fasting';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/** A fast is a unit of practice from one hour; below that it is a false start. */
export const FAST_MIN_COUNTED_MS = 60 * MS_PER_MINUTE;
/** Minutes a local day needs before it extends the streak. */
export const FAST_STREAK_MIN_DAY_MS = 60 * MS_PER_MINUTE;
/** Days in the rolling week figure, today included. */
export const FAST_WEEK_DAYS = 7;
/**
 * The furthest back a streak walk will look. A person cannot have fasted every
 * day for longer than the app has existed, and an explicit bound is what keeps
 * a corrupt row from turning the walk into an unbounded loop.
 */
const MAX_STREAK_DAYS = 366;

export interface FastingStats {
  /** Fasts that ended after at least one hour, however they ended. */
  completedCount: number;
  /**
   * The longest elapsed of any fast that reached an hour, the running one
   * included. 0 when nothing has. The running fast is measured as far as it has
   * got, so a personal best is beaten while it is being set, not afterwards.
   */
  longestMs: number;
  /** Consecutive local days with at least 60 fasted minutes, ending today or yesterday. */
  currentStreakDays: number;
  /** Hours fasted across the last 7 local days, today included, to one decimal. */
  hoursLast7Days: number;
}

export interface FastingStatsInput {
  fasts: readonly LocalFast[];
  /** The clock reading to resolve against; never read internally. */
  nowMs: number;
  /** IANA zone the person's calendar days are measured in. */
  timezone: string;
}

/**
 * A fast's real span against the clock, or null when it contributes no time at
 * all. A scheduled fast has not happened yet and a cancelled one never ran, so
 * both are excluded before any arithmetic. Otherwise a plan for tonight would
 * show up in tonight's hours.
 */
interface FastSpan {
  startMs: number;
  endMs: number;
}

function spanOf(fast: LocalFast, nowMs: number): FastSpan | null {
  const timeline = resolveFastTimeline(fast, nowMs);
  if (timeline.status === 'scheduled' || timeline.status === 'cancelled') return null;
  const endMs = timeline.endAt ?? nowMs;
  if (endMs <= timeline.startAt) return null;
  return { startMs: timeline.startAt, endMs };
}

/** Total ms of `spans` that falls inside the half-open window `[fromMs, toMs)`. */
function overlapMs(spans: readonly FastSpan[], fromMs: number, toMs: number): number {
  return spans.reduce((total, span) => total + Math.max(0, Math.min(span.endMs, toMs) - Math.max(span.startMs, fromMs)), 0);
}

/** Fasted ms on one local calendar day, derived from the zone's real day bounds. */
function fastedMsOnDay(spans: readonly FastSpan[], dateKey: string, timezone: string): number {
  const bounds = dayBoundsInTimezone(dateKey, timezone);
  return overlapMs(spans, bounds.start.getTime(), bounds.end.getTime());
}

/**
 * Walks back from `fromDateKey` while each local day carries at least 60 fasted
 * minutes. Bounded by `MAX_STREAK_DAYS`, never by "we ran out of data".
 */
function countStreakFrom(spans: readonly FastSpan[], fromDateKey: string, timezone: string): number {
  let days = 0;
  let dateKey = fromDateKey;
  while (days < MAX_STREAK_DAYS) {
    if (fastedMsOnDay(spans, dateKey, timezone) < FAST_STREAK_MIN_DAY_MS) return days;
    days += 1;
    dateKey = shiftDate(dateKey, -1);
  }
  return days;
}

/**
 * The streak, in consecutive local days. It ends on today when today already
 * has fasted minutes, otherwise on yesterday, so a morning check reads the
 * streak that is still standing instead of zero.
 */
function resolveStreakDays(spans: readonly FastSpan[], todayKey: string, timezone: string): number {
  if (fastedMsOnDay(spans, todayKey, timezone) >= FAST_STREAK_MIN_DAY_MS) {
    return countStreakFrom(spans, todayKey, timezone);
  }
  return countStreakFrom(spans, shiftDate(todayKey, -1), timezone);
}

/** Hours fasted across the rolling 7 local days that end with today. */
function resolveWeekHours(spans: readonly FastSpan[], todayKey: string, timezone: string): number {
  const fromMs = dayBoundsInTimezone(shiftDate(todayKey, -(FAST_WEEK_DAYS - 1)), timezone).start.getTime();
  const toMs = dayBoundsInTimezone(todayKey, timezone).end.getTime();
  return Math.round((overlapMs(spans, fromMs, toMs) / MS_PER_HOUR) * 10) / 10;
}

/**
 * Every practice-level figure the fasting screen shows, derived from the stored
 * rows and a clock reading. TOTAL: an empty list is four zeros, and a corrupt
 * row is excluded rather than thrown on.
 *
 * @param input - the rows, the clock reading and the person's zone.
 * @returns the four figures, derived, nothing stored.
 */
export function selectFastingStats({ fasts, nowMs, timezone }: FastingStatsInput): FastingStats {
  const spans: FastSpan[] = [];
  let completedCount = 0;
  let longestMs = 0;

  for (const fast of fasts) {
    const span = spanOf(fast, nowMs);
    if (span === null) continue;
    spans.push(span);
    const elapsedMs = span.endMs - span.startMs;
    if (elapsedMs < FAST_MIN_COUNTED_MS) continue;
    longestMs = Math.max(longestMs, elapsedMs);
    if (fast.endedAt !== null) completedCount += 1;
  }

  const todayKey = todayInTimezone(timezone, new Date(nowMs));

  return {
    completedCount,
    longestMs,
    currentStreakDays: resolveStreakDays(spans, todayKey, timezone),
    hoursLast7Days: resolveWeekHours(spans, todayKey, timezone),
  };
}
