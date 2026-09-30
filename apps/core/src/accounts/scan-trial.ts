/**
 * The scan trial, as data and pure rules (M253, M267).
 *
 * WHAT IT IS. An account may carry a number of free AI scans
 * (`accounts.trial_scans`), and the AI proxy counts one scan per AI action the
 * person started (`ai/proxy.ts`, `ai/quota-store.ts`). After the last one the
 * proxy answers `403 trial-scans-spent`, and a paid date lifts the gate.
 *
 * WHY A COUNT FIRST. The owner decided on 2026-09-23 that ten scans replace
 * the three day trial: a window punishes the person who signs up on a Friday
 * and scans on Monday, and ten scans measure use rather than the calendar.
 *
 * AND A DAY LIMIT BESIDE IT (M267, owner decision 2026-09-29). The free tier
 * is now "10 free AI scans or 14 days, whichever comes first". An instance
 * with `TRIAL_DAYS` writes `accounts.trial_ends_at` when the trial starts, at
 * redemption, and the proxy answers `403 trial-expired` from that instant on.
 * An account whose trial started before the setting existed, or on an
 * instance without it, carries no end date and keeps the count alone: those
 * people signed up under terms that said "no time limit", and their deal is
 * not changed after the fact.
 *
 * NOTHING HERE READS A CLOCK, A DATABASE OR AN ENVIRONMENT.
 */
import type { InstanceTrial, TrialScansView } from '../protocol.js';

/**
 * What an instance hands a new account through the trial doors: `TRIAL_SCANS`
 * free scans at `TRIAL_DAILY_AI_LIMIT` requests a day, both or neither, and
 * since M267 an optional `TRIAL_DAYS` after which the trial ends even with
 * scans left (`null`: no end date). `timeZone` is `TRIAL_TIME_ZONE`, the IANA
 * zone whose midnight ends the last day, `UTC` unless set. See `config.ts`.
 */
export interface TrialPolicy {
  scans: number;
  dailyAiLimit: number;
  days: number | null;
  timeZone: string;
}

/** The largest `TRIAL_SCANS`, and the largest `trialScans` an operator may set on one account. */
export const MAX_TRIAL_SCANS = 100;

/**
 * The largest `TRIAL_DAYS` (M267). A quarter: the owner's number is fourteen,
 * and a value past this is far more likely an extra digit than a decision.
 */
export const MAX_TRIAL_DAYS = 90;

/** The zone the trial's last midnight falls in when `TRIAL_TIME_ZONE` is unset. */
export const DEFAULT_TRIAL_TIME_ZONE = 'UTC';

/** One day in milliseconds, a window around a midnight and nothing more: days are counted on the calendar. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long a request on one intake id counts as in flight (2026-09-30). While
 * it does, a second request on the id is refused with `409 intake-in-flight`
 * rather than riding on its scan: overlapping requests on one id were the one
 * way to get two answers for one scan, and the app never sends them. Past
 * the window an undelivered request is taken to have died without settling,
 * and the next request on the id takes its scan over (`ai/quota-store.ts`).
 *
 * THIRTY MINUTES IS FAR ABOVE A LIVE REQUEST: the proxy stamps the intake
 * delivered when the provider's headers arrive, and those are bounded by
 * `UPSTREAM_TIMEOUT_MS`, two minutes by default.
 */
export const INTAKE_REUSE_WINDOW_MS = 30 * 60 * 1000;

/** The refusal for a request whose intake id is still in flight on an earlier request. Nothing is spent. */
export const INTAKE_IN_FLIGHT = 'intake-in-flight';

/** How long an intake row is kept at all. The hourly usage sweep deletes older ones. */
export const INTAKE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The shape of an `X-Intake-Id`: 16 to 64 characters of URL-safe base64 or
 * hex, so a UUID without its dashes fits and a UUID with them fits too.
 */
export const INTAKE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** The response header that carries what is left after this request. */
export const TRIAL_SCANS_LEFT_HEADER = 'X-Trial-Scans-Left';

/** The refusal after the last scan. A third code, beside `ai-not-allowed` and `allowance-expired`, see PROTOCOL.md §5.19. */
export const TRIAL_SCANS_SPENT = 'trial-scans-spent';

/**
 * The refusal once a trial's end date has passed (M267), beside
 * {@link TRIAL_SCANS_SPENT}. A fourth code and not `allowance-expired`: that
 * one is a paid or granted window running out, and a client that read it as
 * the free tier ending would tell a person who paid that their trial is over.
 */
export const TRIAL_EXPIRED = 'trial-expired';

/**
 * Which of the free tier's two limits ended it (M267). Both refusals carry it
 * as `endedBy`, so a client can name the reason from one field.
 */
export type TrialEndedBy = 'scans' | 'days';

/** The refusal for a malformed `X-Intake-Id`, before any row is written. */
export const INTAKE_ID_INVALID = 'intake-id-invalid';

/**
 * The account view's `trialScans`, or `null` for an account with no scan
 * trial. `left` is never negative, so an operator lowering `granted` below
 * what was used reads as none left, which is the honest answer.
 */
export function trialScansView(input: { granted: number | null; used: number }): TrialScansView | null {
  if (input.granted === null) return null;
  return { granted: input.granted, left: Math.max(0, input.granted - input.used) };
}

/**
 * Whether the scan gate applies to this account right now.
 *
 * A DATE LIFTS IT. An allowance date in the future is a paid or granted
 * window, and the proxy's earlier step already refused a date in the past, so
 * "no date" is the only standing in which the count decides. An account with
 * no trial is a standing grant, exactly as before M253.
 */
export function isScanGated(input: { trialScans: number | null; allowanceExpiresAt: Date | null }): boolean {
  return input.allowanceExpiresAt === null && input.trialScans !== null;
}

/**
 * Whether this account is a scan trial nobody has paid for yet (M253/11).
 *
 * THE SAME DATE RULE AS {@link isScanGated}, READ FOR A DIFFERENT QUESTION.
 * The biller extends `allowanceExpiresAt` on payment and never touches
 * `trialScans`, so a paying account may still carry its trial. What tells the
 * two apart is the date: one in the future is a paid or granted window. The
 * proxy never needs the past-date case, because it refused that request one
 * step earlier; this rule does, and a date that has passed is no plan.
 *
 * AN ACCOUNT WITH NO SCAN TRIAL IS NEVER AN UNPAID TRIAL. An operator's
 * standing grant and every account from before M253 read `false` here, which
 * is what keeps them unaffected.
 */
export function isUnpaidTrial(input: {
  trialScans: number | null;
  allowanceExpiresAt: Date | null;
  now: Date;
}): boolean {
  if (input.trialScans === null) return false;
  if (input.allowanceExpiresAt === null) return true;
  return input.allowanceExpiresAt.getTime() <= input.now.getTime();
}

/**
 * What `/health` promises about the trial: the scans, and the days only when
 * there is a day limit (M267). Absent rather than null, so an instance without
 * `TRIAL_DAYS` publishes exactly the block it published before.
 */
export function instanceTrialOf(trial: TrialPolicy): InstanceTrial {
  if (trial.days === null) return { scans: trial.scans };
  return { scans: trial.scans, days: trial.days };
}

/**
 * When a trial that starts at `startedAt` ends, or `null` for a trial with no
 * end date (M267).
 *
 * THE END OF THE `days`-TH DAY AFTER THE SIGN-UP DAY, at local midnight in
 * `timeZone` (owner decision, 2026-09-29, after BGB 187(1) and 188(1)). The
 * day the account is created does not count, so a trial of fourteen days that
 * starts on 2026-09-29 in Berlin, at 10:00 or at 23:30, ends at 2026-10-14
 * 00:00 Berlin time. It is a calendar rule, not a duration: across a change of
 * the clocks the last day still ends at 00:00 local, and the trial is an hour
 * shorter or longer than `days` + 1 times twenty-four hours.
 *
 * `days` IS THE ROW'S, NOT THE CONFIG'S. The doors write `TRIAL_DAYS` on the
 * invite row at mint, and redemption calls this with that value, so an invite
 * minted before the setting existed starts a trial with no end date, as the
 * scan count on the row already works (`db/account-store.ts`, `standingFor`).
 *
 * `timeZone` IS THE CONFIG'S, READ AT REDEMPTION, AND THAT IS SAFE. The zone
 * does not change the length of the offer: the person still gets `days` whole
 * calendar days after the day they signed up, which is what the invite row and
 * the terms promise. It only decides where the midnight between two days
 * falls, which is a fact about the instance's calendar and not about any one
 * invitation, so it stays off the row. The one instant redemption is stamped
 * with is the instant this counts from, so the date a test asserts is the date
 * the row carries.
 *
 * INTL ONLY, no date library: the zone rules are the runtime's ICU data.
 */
export function trialEndsAtFor(input: { startedAt: Date; days: number | null; timeZone: string }): Date | null {
  if (input.days === null) return null;
  const signUpDay = wallClockAt({ instant: input.startedAt.getTime(), timeZone: input.timeZone });
  // Calendar arithmetic on the date alone: `Date.UTC` rolls the day over the
  // month and the year, and no clock change can touch a date with no time.
  const lastMidnight = new Date(Date.UTC(signUpDay.year, signUpDay.month - 1, signUpDay.day + input.days + 1));
  return new Date(
    localMidnight({
      year: lastMidnight.getUTCFullYear(),
      month: lastMidnight.getUTCMonth() + 1,
      day: lastMidnight.getUTCDate(),
      timeZone: input.timeZone,
    }),
  );
}

/** A wall clock reading in one zone, to the second. `month` counts from 1. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** One formatter per zone, made once: a formatter is costly to build and cheap to reuse. */
const WALL_CLOCK_FORMATS = new Map<string, Intl.DateTimeFormat>();

function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  const known = WALL_CLOCK_FORMATS.get(timeZone);
  if (known !== undefined) return known;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  WALL_CLOCK_FORMATS.set(timeZone, format);
  return format;
}

/** What the clocks in `timeZone` read at `instant`. */
function wallClockAt(input: { instant: number; timeZone: string }): WallClock {
  const parts = wallClockFormat(input.timeZone).formatToParts(input.instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** How far `timeZone`'s clocks run ahead of UTC at `instant`, in milliseconds. Negative west of Greenwich. */
function offsetAt(input: { instant: number; timeZone: string }): number {
  const wall = wallClockAt(input);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(input.instant / 1000) * 1000;
}

/**
 * The instant `timeZone`'s clocks read 00:00:00 on the given date.
 *
 * Two candidates, one per offset the zone had a day before and a day after
 * the date's UTC midnight, and each is checked against the wall clock. On an
 * ordinary day both agree. Where a change of the clocks makes midnight happen
 * twice, the first one wins; where it skips midnight (no zone this instance is
 * run in does), the day starts at the change. That is the "compatible" choice
 * the Temporal proposal makes for the same two cases.
 */
function localMidnight(input: { year: number; month: number; day: number; timeZone: string }): number {
  const { year, month, day, timeZone } = input;
  const utcMidnight = Date.UTC(year, month - 1, day);
  const offsetBefore = offsetAt({ instant: utcMidnight - MS_PER_DAY, timeZone });
  const offsetAfter = offsetAt({ instant: utcMidnight + MS_PER_DAY, timeZone });
  const candidates = [utcMidnight - offsetBefore, utcMidnight - offsetAfter];
  const exact = candidates.filter((instant) => {
    const wall = wallClockAt({ instant, timeZone });
    return (
      wall.year === year &&
      wall.month === month &&
      wall.day === day &&
      wall.hour === 0 &&
      wall.minute === 0 &&
      wall.second === 0
    );
  });
  if (exact.length > 0) return Math.min(...exact);
  return utcMidnight - offsetBefore;
}

/**
 * Whether the free tier has ended for this account right now, and by which
 * limit, or `null` while it still runs or does not apply (M267).
 *
 * ONLY WHERE THE SCAN GATE APPLIES ({@link isScanGated}): a paid or granted
 * window lifts both limits, and an account with no scan trial has neither.
 *
 * THE SCANS ARE ASKED FIRST, and that is what "whichever comes first" means
 * here. With both limits spent the scans ran out first, because a trial past
 * its end date is refused before it can spend another scan. The boundary
 * instant of the end date counts as ended, the protocol's "not after" rule
 * (`PROTOCOL.md` §5.19), the same one `allowance-expired` follows.
 *
 * THE SCAN COUNT HERE IS A SNAPSHOT. The proxy's atomic claim stays the
 * authority on the last scan; this answer decides the day limit, which has no
 * counter to race.
 */
export function trialEndedBy(input: {
  trialScans: number | null;
  trialScansUsed: number;
  trialEndsAt: Date | null;
  allowanceExpiresAt: Date | null;
  now: Date;
}): TrialEndedBy | null {
  if (input.allowanceExpiresAt !== null || input.trialScans === null) return null;
  if (input.trialScansUsed >= input.trialScans) return 'scans';
  if (input.trialEndsAt !== null && input.trialEndsAt.getTime() <= input.now.getTime()) return 'days';
  return null;
}
