/**
 * Which AI allowance an account holds right now, as one pure decision.
 *
 * THREE KINDS OF GRANT, AND AN ORDER BETWEEN THEM (2026-09-30):
 *
 *  1. A PAID WINDOW: `allowanceExpiresAt` in the future and a `dailyAiLimit`
 *     above zero. The biller writes both on a payment. The window wins while
 *     it runs, at `dailyAiLimit`.
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
 * NOTHING HERE READS A CLOCK, A DATABASE OR AN ENVIRONMENT.
 */

/** The refusal for an account with no grant. Distinct from `allowance-expired`, see PROTOCOL.md §5.19. */
export const AI_NOT_ALLOWED = 'ai-not-allowed';

/** The refusal for a paid window that ended with no free grant beneath it. */
export const ALLOWANCE_EXPIRED = 'allowance-expired';

/**
 * The free daily limit an account is held to: its own column when above zero,
 * otherwise the instance's standing default, which is `0` (none) where the
 * operator set none.
 *
 * ONE FUNCTION FOR EVERY READER. The proxy reserves against it, and the
 * account view reports it, so the number a person is shown is the number the
 * proxy enforces. An account with its own free limit keeps it whatever the
 * default says, so an operator's grant is never lowered by a default.
 */
export function effectiveFreeDailyAiLimit(input: { own: number; instanceDefault: number }): number {
  return input.own > 0 ? input.own : input.instanceDefault;
}

/** The answer: a grant with the daily limit to reserve against, or a refusal code. */
export type AiAllowance =
  | { kind: 'paid'; dailyLimit: number }
  | { kind: 'free'; dailyLimit: number }
  | { kind: 'trial'; dailyLimit: number }
  | { kind: 'refused'; error: typeof AI_NOT_ALLOWED | typeof ALLOWANCE_EXPIRED };

/** The account facts the decision reads. */
export interface AiAllowanceInput {
  dailyAiLimit: number;
  freeDailyAiLimit: number;
  allowanceExpiresAt: Date | null;
  trialScans: number | null;
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
  if (isPaidLive && input.dailyAiLimit > 0) return { kind: 'paid', dailyLimit: input.dailyAiLimit };
  if (input.freeDailyAiLimit > 0) return { kind: 'free', dailyLimit: input.freeDailyAiLimit };
  // No limit refuses before the date is read, the order the proxy has always
  // had: "never given AI" is the truer sentence for an account with neither.
  if (input.dailyAiLimit <= 0) return { kind: 'refused', error: AI_NOT_ALLOWED };
  if (input.allowanceExpiresAt !== null) return { kind: 'refused', error: ALLOWANCE_EXPIRED };
  if (input.trialScans !== null) return { kind: 'trial', dailyLimit: input.dailyAiLimit };
  return { kind: 'refused', error: AI_NOT_ALLOWED };
}
