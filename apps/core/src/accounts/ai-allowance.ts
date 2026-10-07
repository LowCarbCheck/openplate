/**
 * Which AI allowance an account holds right now, as one pure decision.
 *
 * THREE KINDS OF GRANT, AND AN ORDER BETWEEN THEM (2026-09-30):
 *
 *  1. A PAID WINDOW: `allowanceExpiresAt` in the future and a `dailyAiLimit`
 *     above zero. The biller writes both on a payment. The window wins while
 *     it runs, at `dailyAiLimit`, UNLESS the free grant is larger per week
 *     (the paid floor, 2026-10-07, see {@link weeklyEquivalent}).
 *  2. THE FREE GRANT: `freeDailyAiLimit` above zero. It never ends and it is
 *     never scan gated. It applies whenever no paid window is live, so a
 *     person whose paid period ended falls back to it rather than to nothing.
 *     The number an account is held to is {@link effectiveFreeDailyAiLimit}:
 *     its own when above zero, otherwise the instance's standing default
 *     (`DEFAULT_FREE_DAILY_AI_LIMIT`, 2026-10-05), which is `0`, off, on every
 *     instance that did not set it.
 *  3. THE SCAN TRIAL: no date, `trialScans` set, `dailyAiLimit` above zero.
 *     The proxy then counts scans and the trial's day limit.
 *
 * Anything else is refused. A date that has passed is `allowance-expired`,
 * so a person can be told their time ran out. Every other shape, the old
 * "no date, no trial, a limit" standing grant included, is `ai-not-allowed`:
 * migrations 0026 to 0028 moved every such account to the free grant, so that
 * shape is no longer written by anything here and means no grant at all.
 *
 * THE LIMIT IS PART OF THE ANSWER. The proxy reserves against the limit this
 * picked, never against `dailyAiLimit` directly, so an account on the free
 * grant is held to the free number even while its old paid limit sits on the
 * row.
 *
 * EVERY GRANT CARRIES ITS WINDOW (2026-10-07). A limit counts per UTC day
 * or per ISO week in UTC (`protocol.ts`, `AiLimitPeriod`). The paid limit has
 * the account's own `aiLimitPeriod`, `'day'` unless a writer named `'week'`.
 * The free grant has the window of whichever number won: an account's own
 * free limit is per day, the instance default per day or per week. The scan
 * trial is always per day. The column holds only `'day'` or `'week'`: the
 * database refuses any other word (`accounts_ai_limit_period`), and the
 * write paths refuse it first.
 *
 * NOTHING HERE READS A CLOCK, A DATABASE OR AN ENVIRONMENT.
 */
import type { AiLimitPeriod } from '../protocol.js';

/** The refusal for an account with no grant. Distinct from `allowance-expired`, see PROTOCOL.md §5.19. */
export const AI_NOT_ALLOWED = 'ai-not-allowed';

/** The refusal for a paid window that ended with no free grant beneath it. */
export const ALLOWANCE_EXPIRED = 'allowance-expired';

/** A limit and the window it counts in. */
export interface AiLimitWindow {
  limit: number;
  period: AiLimitPeriod;
}

/** No free grant at all: what an instance that set no default gives an account with none of its own. */
export const NO_FREE_AI_LIMIT: AiLimitWindow = { limit: 0, period: 'day' };

/**
 * The free limit an account is held to, with its window: its own column when
 * above zero, which is always per day, otherwise the instance's standing
 * default, per day (`DEFAULT_FREE_DAILY_AI_LIMIT`) or per week
 * (`DEFAULT_FREE_WEEKLY_AI_LIMIT`), which is `0` (none) where the operator set
 * neither.
 *
 * ONE FUNCTION FOR EVERY READER. The proxy reserves against it, and the
 * account view reports it, so the number a person is shown is the number the
 * proxy enforces. An account with its own free limit keeps it whatever the
 * default says, so an operator's grant is never lowered by a default, and a
 * Beta supporter's ten a day stay ten a day when the instance default is
 * weekly.
 */
export function effectiveFreeAiLimit(input: { own: number; instanceDefault: AiLimitWindow }): AiLimitWindow {
  return input.own > 0 ? { limit: input.own, period: 'day' } : input.instanceDefault;
}

/** The answer: a grant with the limit and window to reserve against, or a refusal code. */
export type AiAllowance =
  | ({ kind: 'paid' } & AiLimitWindow)
  | ({ kind: 'free' } & AiLimitWindow)
  | ({ kind: 'trial' } & AiLimitWindow)
  | { kind: 'refused'; error: typeof AI_NOT_ALLOWED | typeof ALLOWANCE_EXPIRED };

/** The account facts the decision reads. */
export interface AiAllowanceInput {
  /** The paid window's limit (`accounts.daily_ai_limit`), also the scan trial's day limit. */
  dailyAiLimit: number;
  /** The window `dailyAiLimit` counts in while a paid window runs (`accounts.ai_limit_period`). */
  aiLimitPeriod: AiLimitPeriod;
  /** The free grant, already resolved by {@link effectiveFreeAiLimit}. */
  freeAiLimit: AiLimitWindow;
  allowanceExpiresAt: Date | null;
  trialScans: number | null;
}

/**
 * A limit as units per week, to compare two grants whose windows differ: a
 * day limit times seven, a week limit as it is.
 *
 * THE PAID FLOOR (2026-10-07, the owner's "nothing existing gets worse").
 * Buying a plan must never LOWER what a person may use. A Beta supporter
 * holds a free grant of their own, 10 a day, which is 70 a week; the cheapest
 * plan of the managed instance grants 20 a week. Held to the plan, that
 * person would pay and lose 50 scans a week. So while a paid window runs, the
 * grant with the larger weekly equivalent is the one counted, the paid one on
 * a tie. The free grant then keeps its OWN window and limit (10 a day stays
 * 10 a day), because that is the grant the person already had, unchanged.
 * Generic: core knows no plan, only two numbers and their windows.
 */
export function weeklyEquivalent(window: AiLimitWindow): number {
  return window.period === 'day' ? window.limit * 7 : window.limit;
}

/**
 * Whether a paid window runs at `now`. NOT AFTER: the boundary instant has
 * ended, so a rule that let the exact instant through could not be said in
 * one sentence (the same comparison `allowance-expired` has always made).
 */
export function isPaidWindowLive(input: { allowanceExpiresAt: Date | null; now: Date }): boolean {
  return input.allowanceExpiresAt !== null && input.allowanceExpiresAt.getTime() > input.now.getTime();
}

/**
 * The allowance this account holds at `now`. See the module header for the
 * order, which is the whole of the rule.
 */
export function aiAllowanceFor(input: AiAllowanceInput & { now: Date }): AiAllowance {
  const isPaidLive = isPaidWindowLive({ allowanceExpiresAt: input.allowanceExpiresAt, now: input.now });
  if (isPaidLive && input.dailyAiLimit > 0) {
    const paid: AiLimitWindow = { limit: input.dailyAiLimit, period: input.aiLimitPeriod };
    // THE PAID FLOOR: a larger free grant is never lowered by buying a plan.
    if (weeklyEquivalent(input.freeAiLimit) > weeklyEquivalent(paid)) {
      return { kind: 'free', limit: input.freeAiLimit.limit, period: input.freeAiLimit.period };
    }
    return { kind: 'paid', ...paid };
  }
  if (input.freeAiLimit.limit > 0) {
    return { kind: 'free', limit: input.freeAiLimit.limit, period: input.freeAiLimit.period };
  }
  // No limit refuses before the date is read, the order the proxy has always
  // had: "never given AI" is the truer sentence for an account with neither.
  if (input.dailyAiLimit <= 0) return { kind: 'refused', error: AI_NOT_ALLOWED };
  if (input.allowanceExpiresAt !== null) return { kind: 'refused', error: ALLOWANCE_EXPIRED };
  // THE TRIAL IS PER DAY, whatever the period column says: its day limit is
  // a burst bound under a scan count, and nothing writes a weekly trial.
  if (input.trialScans !== null) return { kind: 'trial', limit: input.dailyAiLimit, period: 'day' };
  return { kind: 'refused', error: AI_NOT_ALLOWED };
}
