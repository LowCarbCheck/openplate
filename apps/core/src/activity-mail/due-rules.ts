/**
 * When an account is due an activity reminder, as pure functions of the row
 * and the clock.
 *
 * TWO KINDS, EACH AT MOST ONCE PER REASON:
 *
 *  - `first-scan`: the person signed up a few days ago and the instance has
 *    never read a photo for them. Once per account, ever.
 *  - `quiet`: the person has not been seen for a while. Once per quiet spell:
 *    a new one is due only after they came back.
 *
 * NEVER TWO MAILS CLOSE TOGETHER, IN BOTH DIRECTIONS. A `quiet` mail is not
 * due while a `first-scan` mail went out inside the quiet days. A `first-scan`
 * mail is not due once any `quiet` mail ever went to the account: first-scan
 * is a one-time nudge for the first weeks after sign-up, and the quiet mail
 * already reached the person.
 *
 * A WINDOW, NOT A THRESHOLD. Each kind is due from `days` after its anchor
 * until seven days later, and never after. Turning a kind on therefore never
 * mails the old accounts that have been quiet for months, and a sender that
 * was down for a day still catches up.
 *
 * THE SAME RULES IN SQL are `db/activity-mail-store.ts`, which selects and
 * claims with them. The sender checks every selected row against these
 * functions and throws when the two disagree, so a drift between them fails
 * the run loudly instead of mailing somebody the rules exclude.
 *
 * NOTHING HERE READS A CLOCK, A DATABASE OR AN ENVIRONMENT.
 */
import type { AiLimitPeriod } from '../protocol.js';
import type { JsonValue } from '../lib/json.js';
import { aiAllowanceFor, effectiveFreeAiLimit, type AiLimitWindow } from '../accounts/ai-allowance.js';
import { isActivityMailConsentActive, type ActivityMailConsent } from './consent.js';

export type ActivityMailKind = 'first-scan' | 'quiet';

/** Every kind, for exhaustive iteration. */
export const ACTIVITY_MAIL_KINDS: readonly ActivityMailKind[] = ['first-scan', 'quiet'];

export function isActivityMailKind(value: JsonValue | undefined): value is ActivityMailKind {
  return ACTIVITY_MAIL_KINDS.some((kind) => kind === value);
}

/** How long after a kind's anchor it stays due. Past this, the moment is gone and no mail goes. */
export const DUE_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `days` before `now`, as an instant. */
export function daysBefore(input: { now: Date; days: number }): Date {
  return new Date(input.now.getTime() - input.days * MS_PER_DAY);
}

/** Whole days from `from` to `to`, rounded down. What a mail says when it names a number of days. */
export function wholeDaysBetween(input: { from: Date; to: Date }): number {
  return Math.floor((input.to.getTime() - input.from.getTime()) / MS_PER_DAY);
}

/** The account facts the AI allowance rule reads. */
export interface AllowanceFacts {
  dailyAiLimit: number;
  aiLimitPeriod: AiLimitPeriod;
  freeDailyAiLimit: number;
  allowanceExpiresAt: Date | null;
  trialScans: number | null;
  trialScansUsed: number;
  trialEndsAt: Date | null;
}

/**
 * Whether the account can have a photo read right now: the allowance the AI
 * proxy would pick (`accounts/ai-allowance.ts`) is above zero, and for a scan
 * trial, a scan is left and the trial has not ended by the calendar.
 *
 * WHY IT IS A RULE. The first-scan mail says "take a photo". Sent to an
 * account with no AI, it promises something the next tap refuses.
 */
export function hasUsableAiAllowance(input: {
  account: AllowanceFacts;
  instanceDefaultFreeAiLimit: AiLimitWindow;
  now: Date;
}): boolean {
  const allowance = aiAllowanceFor({
    dailyAiLimit: input.account.dailyAiLimit,
    aiLimitPeriod: input.account.aiLimitPeriod,
    freeAiLimit: effectiveFreeAiLimit({
      own: input.account.freeDailyAiLimit,
      instanceDefault: input.instanceDefaultFreeAiLimit,
    }),
    allowanceExpiresAt: input.account.allowanceExpiresAt,
    trialScans: input.account.trialScans,
    now: input.now,
  });
  if (allowance.kind === 'refused') return false;
  if (allowance.limit <= 0) return false;
  if (allowance.kind !== 'trial') return true;
  const scansLeft = (input.account.trialScans ?? 0) - input.account.trialScansUsed;
  if (scansLeft <= 0) return false;
  return input.account.trialEndsAt === null || input.account.trialEndsAt.getTime() > input.now.getTime();
}

/** What the first-scan rule reads off one account. */
export interface FirstScanCandidate extends AllowanceFacts {
  consent: ActivityMailConsent;
  suspendedAt: Date | null;
  firstScanMailSentAt: Date | null;
  /** Any quiet mail ever sent blocks the first-scan mail for good. */
  quietMailSentAt: Date | null;
  createdAt: Date;
  /** Whether any `ai_usage_days` row exists for the account. */
  hasAiUsage: boolean;
}

/** The rule's inputs beside the account. */
export interface DueContext {
  now: Date;
  /** The kind's `days` from the instance settings. */
  days: number;
}

/** True when `at` lies in the kind's window: at least `days` ago, and less than `days + 7` ago. */
function isInDueWindow(input: { at: Date; context: DueContext }): boolean {
  const opens = daysBefore({ now: input.context.now, days: input.context.days });
  const closes = daysBefore({ now: input.context.now, days: input.context.days + DUE_WINDOW_DAYS });
  return input.at.getTime() <= opens.getTime() && input.at.getTime() > closes.getTime();
}

export function isFirstScanDue(input: {
  account: FirstScanCandidate;
  context: DueContext;
  instanceDefaultFreeAiLimit: AiLimitWindow;
}): boolean {
  const { account, context } = input;
  if (!isActivityMailConsentActive(account.consent)) return false;
  if (account.suspendedAt !== null) return false;
  if (account.firstScanMailSentAt !== null) return false;
  // NEVER TWO MAILS CLOSE TOGETHER: a quiet mail already reached the person.
  if (account.quietMailSentAt !== null) return false;
  if (!isInDueWindow({ at: account.createdAt, context })) return false;
  if (account.hasAiUsage) return false;
  return hasUsableAiAllowance({
    account,
    instanceDefaultFreeAiLimit: input.instanceDefaultFreeAiLimit,
    now: context.now,
  });
}

/** What the quiet rule reads off one account. */
export interface QuietCandidate {
  consent: ActivityMailConsent;
  suspendedAt: Date | null;
  lastSeenAt: Date | null;
  quietMailSentAt: Date | null;
  firstScanMailSentAt: Date | null;
}

export function isQuietDue(input: { account: QuietCandidate; context: DueContext }): boolean {
  const { account, context } = input;
  if (!isActivityMailConsentActive(account.consent)) return false;
  if (account.suspendedAt !== null) return false;
  // No honest value: nothing ever recorded the person here, so there is no
  // spell to be quiet in.
  if (account.lastSeenAt === null) return false;
  if (!isInDueWindow({ at: account.lastSeenAt, context })) return false;
  // ONCE PER SPELL: a second mail only after the person came back.
  const isNewSpell =
    account.quietMailSentAt === null || account.quietMailSentAt.getTime() < account.lastSeenAt.getTime();
  if (!isNewSpell) return false;
  // NEVER TWO MAILS CLOSE TOGETHER: a first-scan mail inside the quiet days blocks this one.
  const quietSince = daysBefore({ now: context.now, days: context.days });
  return account.firstScanMailSentAt === null || account.firstScanMailSentAt.getTime() < quietSince.getTime();
}
