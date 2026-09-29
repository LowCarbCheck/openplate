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
 * scans left (`null`: no end date). See `config.ts`.
 */
export interface TrialPolicy {
  scans: number;
  dailyAiLimit: number;
  days: number | null;
}

/** The largest `TRIAL_SCANS`, and the largest `trialScans` an operator may set on one account. */
export const MAX_TRIAL_SCANS = 100;

/**
 * The largest `TRIAL_DAYS` (M267). A quarter: the owner's number is fourteen,
 * and a value past this is far more likely an extra digit than a decision.
 */
export const MAX_TRIAL_DAYS = 90;

/** One day in milliseconds, the unit `TRIAL_DAYS` counts in. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How long one intake id may ride on the scan it claimed. See {@link INTAKE_MAX_REQUESTS}. */
export const INTAKE_REUSE_WINDOW_MS = 30 * 60 * 1000;

/**
 * How many upstream requests one intake id may make on one scan: the first
 * try plus the app's one retry without `response_format` (M256/02 measured it;
 * the app's retry after a stale bearer is refused by the bearer check and
 * never reaches the claim). A third request on the same id is a new person
 * action, or a client that reuses ids, and it costs a new scan. So does any
 * request after one on the id delivered an answer, whatever this count says.
 *
 * TWO, NOT THREE, because the count only matters for requests that overlap: a
 * failed request gives its scan back before it answers, so a sequential retry
 * claims afresh anyway. Overlapping requests on one id are the one way to get
 * more than one answer for one scan, and the app never sends them.
 */
export const INTAKE_MAX_REQUESTS = 2;

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
 * `days` IS THE ROW'S, NOT THE CONFIG'S. The doors write `TRIAL_DAYS` on the
 * invite row at mint, and redemption calls this with that value, so an invite
 * minted before the setting existed starts a trial with no end date, as the
 * scan count on the row already works (`db/account-store.ts`, `standingFor`).
 *
 * EXACTLY `days` TIMES TWENTY-FOUR HOURS, off the one instant redemption is
 * stamped with, so the date a test asserts is the date the row carries.
 */
export function trialEndsAtFor(input: { startedAt: Date; days: number | null }): Date | null {
  if (input.days === null) return null;
  return new Date(input.startedAt.getTime() + input.days * MS_PER_DAY);
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
