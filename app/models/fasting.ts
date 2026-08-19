/**
 * The pure fasting model (M132) — every derivation, formatter and validator the
 * `/fasting` route and the Overview strip read. No DOM, no store, no
 * `Date.now()`: `nowMs` is always a parameter, exactly as `models/dashboard.ts`
 * takes `today`, which is what makes the whole feature's behaviour pinnable by
 * a `node:test` unit file with no browser and no clock.
 *
 * It may `import type` from `#app/lib/local-store/schema`; that module's own
 * header sanctions this ("Pure types + id constants only … so the pure logic
 * modules and their unit tests stay browser- and store-free").
 *
 * ── ELAPSED is the primary figure, not remaining ───────────────────────────
 *
 * The diary hero is remaining-first because a carb ceiling is a budget you
 * spend DOWN. A fast is the opposite shape: an achievement you build UP.
 * Framing a running fast as "7h 48m still owed" turns it into a debt, and
 * DESIGN.md §10.1 forbids copy that grades the person. Remaining is tier 2,
 * deliberately. Do not "harmonise" this with the diary hero.
 *
 * ── Overtime is not an overrun ─────────────────────────────────────────────
 *
 * `--accent-amber` in this app means "over a ceiling you set as a limit". A
 * fast target is a floor you are clearing, not a ceiling you are breaching, so
 * the ring caps at full and stays `text-primary`; the figure keeps counting.
 * `progress` is returned UNCLAMPED for exactly that reason — the caller clamps
 * for the arc while the number carries on.
 *
 * ── Clocks, zones and DST ──────────────────────────────────────────────────
 *
 * Every stored instant is epoch-ms, so a fast that spans a DST transition
 * counts real hours: a 16 h fast is 16 real hours and ends one wall-clock hour
 * later or earlier than naive arithmetic suggests. The "Started 20:04" label
 * still reads 20:04 because `Intl.DateTimeFormat` resolves the zone offset at
 * that instant. This is honest and needs no copy — openplate counts elapsed
 * hours, not wall-clock hours. Travelling across zones mid-fast is the same
 * case: the duration is untouched and the start label re-renders as the
 * correct wall clock where the person now is.
 */
import type { FastProtocolId, LocalFast } from '#app/lib/local-store/schema';

/**
 * The i18next `t` shape, declared locally so the formatters stay pure and
 * driveable from a test with no i18n instance — the same device `hero-stat.tsx`
 * uses.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

export type FastStatus = 'scheduled' | 'active' | 'completed' | 'ended-early' | 'cancelled';

export interface FastProtocol {
  id: Exclude<FastProtocolId, 'custom'>;
  fastingHours: number;
  eatingHours: number;
}

/** The three preset windows, in picker order. */
export const FAST_PROTOCOLS: readonly FastProtocol[] = [
  { id: '16:8', fastingHours: 16, eatingHours: 8 },
  { id: '18:6', fastingHours: 18, eatingHours: 6 },
  { id: '20:4', fastingHours: 20, eatingHours: 4 },
];

export const FAST_MIN_CUSTOM_HOURS = 1;
/**
 * 72 h is the outer edge of commonly-practised extended fasting; past it the
 * app would be implying medical guidance it cannot give. 1 h is the floor at
 * which "a fast" is a meaningful unit.
 */
export const FAST_MAX_CUSTOM_HOURS = 72;
/** How far back a start instant may be placed — backdating "I started at 19:00, it's 21:00 now". */
export const FAST_MAX_BACKDATE_MS = 48 * 60 * 60 * 1000;
/** How far ahead a fast may be scheduled. */
export const FAST_MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** How long the just-ended summary line stays on `/fasting`. */
export const FAST_SUMMARY_WINDOW_MS = 10 * 60 * 1000;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_SECOND = 1000;

// ---------------------------------------------------------------------------
// Timeline — the one derivation everything reads
// ---------------------------------------------------------------------------

export interface FastTimeline {
  status: FastStatus;
  /** The instant the fast counts from: `startedAt ?? plannedStartAt ?? createdAt`. */
  startAt: number;
  /** The recorded end, or null while scheduled/active. */
  endAt: number | null;
  /** ms from `startAt` to `endAt ?? nowMs`, floored at 0. Zero while scheduled. */
  elapsedMs: number;
  /** ms left before the target, floored at 0. */
  remainingMs: number;
  /** ms past the target, floored at 0. */
  overtimeMs: number;
  /**
   * `elapsedMs / targetDurationMs`, floored at 0 and UNCLAMPED above — the
   * caller clamps for the arc so the ring can cap while the figure keeps
   * counting.
   */
  progress: number;
  /** Scheduled only: ms until `startAt`. 0 in every other status. */
  startsInMs: number;
  /** True once `elapsedMs >= targetDurationMs`. */
  hasReachedTarget: boolean;
}

/**
 * The instant a fast counts from. Module-private and used by BOTH
 * `resolveFastTimeline` and `selectCurrentFast`, so the two can never diverge
 * about which fast is running or when it began.
 */
function effectiveStartAt(fast: LocalFast): number {
  return fast.startedAt ?? fast.plannedStartAt ?? fast.createdAt;
}

/**
 * Resolves one fast against a clock reading. TOTAL: every `LocalFast` × every
 * `nowMs` yields a renderable status, including rows the app itself can never
 * produce (both start fields null, an end before the start, a zero target) —
 * a restored backup or a stepped device clock can produce all three, and a
 * screen that throws on them would be worse than one that renders them.
 *
 * @param fast - the stored row.
 * @param nowMs - the clock reading to resolve against (never read internally).
 * @returns every figure the UI needs, derived, nothing stored.
 */
export function resolveFastTimeline(fast: LocalFast, nowMs: number): FastTimeline {
  const startAt = effectiveStartAt(fast);
  const endAt = fast.endedAt;
  const isScheduled = endAt === null && fast.startedAt === null && fast.plannedStartAt !== null && nowMs < startAt;

  // `Math.max(0, …)` is load-bearing: a device clock stepped backwards mid-fast
  // would otherwise produce a negative elapsed, a negative progress, and an arc
  // drawn backwards.
  const elapsedMs = isScheduled ? 0 : Math.max(0, (endAt ?? nowMs) - startAt);
  const remainingMs = Math.max(0, fast.targetDurationMs - elapsedMs);
  const overtimeMs = Math.max(0, elapsedMs - fast.targetDurationMs);
  // Guarding the divisor keeps `Infinity`/`NaN` from a corrupt row out of
  // `computeRingGeometry`.
  const progress = fast.targetDurationMs > 0 ? Math.max(0, elapsedMs / fast.targetDurationMs) : 0;

  return {
    status: resolveFastStatus(fast, { startAt, elapsedMs, isScheduled }),
    startAt,
    endAt,
    elapsedMs,
    remainingMs,
    overtimeMs,
    progress,
    startsInMs: isScheduled ? Math.max(0, startAt - nowMs) : 0,
    hasReachedTarget: elapsedMs >= fast.targetDurationMs,
  };
}

/**
 * The status derivation, first match wins:
 *
 *  R1 ended at or before its own start        -> `cancelled`
 *  R2 ended, elapsed >= target                -> `completed`
 *  R3 ended, elapsed < target                 -> `ended-early`
 *  R4 not ended, `startedAt` set              -> `active` (beats R5)
 *  R5 not ended, planned instant has passed   -> `active`, with NOTHING written
 *  R6 not ended, planned instant still ahead  -> `scheduled`
 *  R7 not ended, neither start field set      -> `active` from `createdAt`
 *
 * R1 is the `cancelled` fallback. The UI DELETES a cancelled plan rather than
 * keeping a row — a history list logging every plan you backed out of is a
 * shame ledger (DESIGN.md §10.1) — so R1 is only reachable through a restored
 * backup or a clock jump. It exists so this function stays total. The `<=`
 * absorbs the equal case (ended at the exact planned instant).
 *
 * R7 is a corrupt or hand-edited row: `createLocalFast` always writes at least
 * one start field. Falling back to `createdAt` is the only non-inventing choice
 * available.
 */
function resolveFastStatus(
  fast: LocalFast,
  { startAt, elapsedMs, isScheduled }: { startAt: number; elapsedMs: number; isScheduled: boolean },
): FastStatus {
  if (fast.endedAt !== null) {
    if (fast.endedAt <= startAt) return 'cancelled';
    return elapsedMs >= fast.targetDurationMs ? 'completed' : 'ended-early';
  }
  return isScheduled ? 'scheduled' : 'active';
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Whether a fast is still open — `endedAt === null`. */
export function isOpenFast(fast: LocalFast): boolean {
  return fast.endedAt === null;
}

/** Latest effective start first; ties break on `createdAt`, then `id`, so the order is total. */
function byLatestStart(a: LocalFast, b: LocalFast): number {
  return effectiveStartAt(b) - effectiveStartAt(a) || b.createdAt - a.createdAt || b.id.localeCompare(a.id);
}

/**
 * The fast `/fasting` and the Overview strip operate on, or null.
 *
 * The one-open-fast invariant is enforced on create (`createLocalFast`), but a
 * BACKUP RESTORE bypasses it by design — `importSnapshot` reproduces the file
 * rather than adjudicating it, so a restore onto a device that already has a
 * running fast can leave two open rows. Rather than inventing an end instant
 * for the loser (which would write a lie into the person's history), this picks
 * the one with the LATEST effective start and leaves the other in the list.
 * `selectFastHistory` then renders it as "Still open", with a Remove action —
 * nothing is fabricated, nothing is silently dropped, and the person can clean
 * it up.
 */
export function selectCurrentFast(fasts: readonly LocalFast[]): LocalFast | null {
  return fasts.filter(isOpenFast).toSorted(byLatestStart)[0] ?? null;
}

/** Everything except the current fast, NEWEST effective start first. */
export function selectFastHistory(fasts: readonly LocalFast[]): LocalFast[] {
  const current = selectCurrentFast(fasts);
  return fasts.filter((fast) => fast.id !== current?.id).toSorted(byLatestStart);
}

/**
 * The fast whose end is recent enough to still deserve a summary line, or null.
 * Never returns a `cancelled` row — there is nothing to report about a plan
 * that never ran.
 */
export function selectRecentlyEndedFast(fasts: readonly LocalFast[], nowMs: number): LocalFast | null {
  return (
    fasts
      .filter((fast) => {
        if (fast.endedAt === null) return false;
        const age = nowMs - fast.endedAt;
        if (age < 0 || age > FAST_SUMMARY_WINDOW_MS) return false;
        return resolveFastTimeline(fast, nowMs).status !== 'cancelled';
      })
      .toSorted((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Compact duration: "16h 4m" / "16h" / "42m" / "0m". Minutes are dropped when
 * they are zero AND there is at least one hour, so a preset target renders as
 * "16h" rather than "16h 0m". Sub-minute durations render "0m" rather than
 * "0h 0m" — a fast that has just started reads as zero minutes, not as broken.
 * Truncates rather than rounds: an elapsed figure must never claim a minute
 * that has not finished.
 *
 * Takes `t` because the units are language-dependent (German writes
 * "16 Std 4 Min" — period-free on purpose: this string is interpolated at the
 * END of sentences like `fasting.toast.ended`, and a trailing "Std." there
 * would render "0 Min.."), the same device `formatHeroStat` uses.
 */
export function formatFastDuration(ms: number, t: Translate): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return t('fasting.duration.minutesOnly', { minutes });
  if (minutes === 0) return t('fasting.duration.hoursOnly', { hours });
  return t('fasting.duration.hoursMinutes', { hours, minutes });
}

/**
 * The LIVE countdown only: "16:04:12" — hours unpadded and never wrapped at 24,
 * minutes and seconds zero-padded, no locale involvement (H:MM:SS is written
 * the same everywhere). Render it in `font-sans tabular-nums`, never
 * `font-display` (DESIGN.md §4 — the Fraunces subset has no `tnum`, so the
 * digits would jitter once a second).
 */
export function formatFastClock(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "+2h 14m" — `formatFastDuration` with a sign, minute resolution. */
export function formatFastOvertime(ms: number, t: Translate): string {
  return `+${formatFastDuration(ms, t)}`;
}

/**
 * What this fast was aiming at, as a label: the protocol id for a preset
 * ("16:8"), the formatted duration for a custom one ("9h"). Never invents a
 * protocol name for a custom duration.
 */
export function fastTargetLabel(fast: LocalFast, t: Translate): string {
  return fast.protocolId === 'custom' ? formatFastDuration(fast.targetDurationMs, t) : fast.protocolId;
}

// ---------------------------------------------------------------------------
// Input parsing and validation
// ---------------------------------------------------------------------------

/** Milliseconds for a preset protocol id; null for 'custom'. */
export function protocolTargetMs(id: FastProtocolId): number | null {
  const protocol = FAST_PROTOCOLS.find((candidate) => candidate.id === id);
  return protocol === undefined ? null : protocol.fastingHours * MS_PER_HOUR;
}

/** Whole hours in [FAST_MIN_CUSTOM_HOURS, FAST_MAX_CUSTOM_HOURS]. */
export function isValidCustomHours(hours: number): boolean {
  return Number.isInteger(hours) && hours >= FAST_MIN_CUSTOM_HOURS && hours <= FAST_MAX_CUSTOM_HOURS;
}

/** Hours -> ms. Callers must have passed `isValidCustomHours` first. */
export function customHoursToMs(hours: number): number {
  return hours * MS_PER_HOUR;
}

/** The shape a native `<input type="datetime-local">` submits. */
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Parses a native `<input type="datetime-local">` value ("2026-08-06T20:00")
 * into epoch-ms, or null when it is absent/malformed.
 *
 * The value carries NO zone, and `Date.parse` reads it in the RUNTIME's zone —
 * which is correct and deliberate: the widget renders the DEVICE's wall clock,
 * so reinterpreting it in the stored profile timezone would show one time and
 * mean another. Fasting is wall-clock-of-where-you-are. (Day labels in history
 * still use `resolveLocalTimezone(profile)` like the rest of the app; the
 * asymmetry is the point — the widget must mean what it displays.)
 *
 * The regex guard runs BEFORE `Date.parse`, and it is load-bearing: without it
 * `Date.parse('2026')` happily returns a real UTC-midnight instant, which would
 * silently schedule a fast eight months ago.
 */
export function parseLocalDateTimeInput(value: string): number | null {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export type PlannedStartProblem = 'too-far-back' | 'too-far-ahead' | 'in-future';

/**
 * Bounds a chosen start instant. `allowFuture: false` is the Adjust-an-active-
 * fast case (a running fast cannot have started later than now).
 *
 * A start instant in the PAST is never a problem when `allowFuture` is true —
 * backdating is the single most-requested real-world need, and rejecting it
 * would force the person to lie about when they started.
 *
 * @returns the first problem found, or null when the instant is acceptable.
 */
export function validateStartInstant(
  atMs: number,
  { nowMs, allowFuture }: { nowMs: number; allowFuture: boolean },
): PlannedStartProblem | null {
  if (!allowFuture && atMs > nowMs) return 'in-future';
  if (atMs < nowMs - FAST_MAX_BACKDATE_MS) return 'too-far-back';
  if (atMs > nowMs + FAST_MAX_SCHEDULE_AHEAD_MS) return 'too-far-ahead';
  return null;
}

/** Two-digit zero pad for the `YYYY-MM-DDTHH:mm` the native widget wants. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Epoch-ms -> `YYYY-MM-DDTHH:mm` in the runtime zone (seeds the Adjust field). */
export function toLocalDateTimeInputValue(atMs: number): string {
  const at = new Date(atMs);
  const date = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
  return `${date}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/** The hour a "start tonight" fast defaults to — see `defaultPlannedStartLocal`. */
const DEFAULT_PLANNED_START_HOUR = 20;

/**
 * The default value for the schedule field: today at 20:00 local, or tomorrow
 * at 20:00 when 20:00 has already passed (the boundary is "already passed", so
 * exactly 20:00 rolls to tomorrow).
 *
 * 20:00 is the conventional start of an evening-to-midday eating window — a
 * 16:8 fast from 20:00 lands at 12:00, which is the shape most people mean when
 * they say "tonight".
 */
export function defaultPlannedStartLocal(nowMs: number): string {
  const at = new Date(nowMs);
  at.setHours(DEFAULT_PLANNED_START_HOUR, 0, 0, 0);
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
  return toLocalDateTimeInputValue(at.getTime());
}
