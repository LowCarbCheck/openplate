/**
 * THE STANDING FREE GRANT, as the app reads it (2026-09-30).
 *
 * The core gives an account two AI limits (`PROTOCOL.md` §5.15, §5.19):
 * `dailyAiLimit`, the paid window's, which runs while `allowanceExpiresAt` is
 * in the future, and `freeDailyAiLimit`, a free grant with no end date and no
 * scan gate that applies whenever no paid window is live. A Beta supporter
 * holds a free grant, so when a plan they bought ends they fall back to it
 * instead of losing AI, and the app must never lock them. Since 2026-10-07 the
 * paid limit counts over a day or a week (`aiLimitPeriod`), and the free grant
 * over its own window (`freeAiLimitPeriod`); the names keep "daily" for
 * compatibility with the wire.
 *
 * NOTHING HERE AUTHORIZES ANYTHING. The proxy picks the grant per request and
 * refuses what it refuses; this module decides only what a screen draws: which
 * limit to name, and whether a plan standing is `free`.
 *
 * ── An older core, and a broken value, read as "no free grant" ──────────
 *
 * `AccountView` is cast, not parsed, by the auth client, so this is the
 * boundary where the field is checked. A missing key, a `null` and anything
 * that is not a whole number from zero up answer `0`, which draws exactly what
 * the app drew before the field existed.
 */
import { z } from 'zod';

import type { AiLimitPeriod, AiQuota } from '#app/lib/plans/ai-quota';

const freeDailyAiLimitSchema = z.number().int().min(0).catch(0);

/**
 * The account's standing free grant per UTC day, `0` for none.
 *
 * @param wire - `AccountView.freeDailyAiLimit` as it arrived, which an older core omits.
 */
export function decodeFreeDailyAiLimit(wire: number | null | undefined): number {
  if (wire === undefined || wire === null) return 0;
  return freeDailyAiLimitSchema.parse(wire);
}

/** Whether the account holds a free grant. `null` and absent are "not read yet" or "none", and neither is one. */
export function hasFreeGrant(account: { freeDailyAiLimit?: number | null }): boolean {
  return (account.freeDailyAiLimit ?? 0) > 0;
}

/**
 * Whether a paid window runs at `now`: an end date after it. The boundary
 * instant has ended, the protocol's "not after" comparison, and a date that
 * does not parse is no window.
 */
export function isPaidWindowLive({
  allowanceExpiresAt,
  now,
}: {
  allowanceExpiresAt: string | null;
  now: Date;
}): boolean {
  if (allowanceExpiresAt === null) return false;
  const endsAt = Date.parse(allowanceExpiresAt);
  return !Number.isNaN(endsAt) && endsAt > now.getTime();
}

/** The limit a screen names and the window it counts over. */
export interface ShownAiLimit {
  limit: number;
  period: AiLimitPeriod;
}

/**
 * The limit a screen names, with its window, or `null` while the account is
 * not read.
 *
 * THE PROXY'S ORDER, FOR RENDERING ONLY: a live paid window with a limit
 * names its own limit and its own window (`aiLimitPeriod`), otherwise a free
 * grant names the free one and ITS window (`freeAiLimitPeriod`), and otherwise
 * the paid limit is named as it always was. The last branch keeps a scan
 * trial, an account with no AI and every account read from a core older than
 * the fields exactly as they were drawn before. A period that is absent is a
 * day, which is what every limit counted over before the week existed.
 *
 * THIS IS THE FALLBACK, NOT THE ANSWER. The core's `aiQuota` is the grant the
 * proxy applies to the next request, and the paid floor can make it differ
 * from this order (see {@link shownAllowance}, which prefers it).
 */
export function shownAiLimit({
  dailyAiLimit,
  aiLimitPeriod,
  freeDailyAiLimit,
  freeAiLimitPeriod,
  allowanceExpiresAt,
  now,
}: {
  dailyAiLimit: number | null;
  aiLimitPeriod?: AiLimitPeriod | null;
  freeDailyAiLimit: number | null | undefined;
  freeAiLimitPeriod?: AiLimitPeriod | null;
  allowanceExpiresAt: string | null;
  now: Date;
}): ShownAiLimit | null {
  if (dailyAiLimit === null) return null;
  if (dailyAiLimit > 0 && isPaidWindowLive({ allowanceExpiresAt, now })) {
    return { limit: dailyAiLimit, period: aiLimitPeriod ?? 'day' };
  }
  if ((freeDailyAiLimit ?? 0) > 0) return { limit: freeDailyAiLimit ?? 0, period: freeAiLimitPeriod ?? 'day' };
  return { limit: dailyAiLimit, period: aiLimitPeriod ?? 'day' };
}

/** What a screen draws about the allowance: the limit, its window, the count in it and the reset. */
export interface ShownAllowance extends ShownAiLimit {
  /**
   * The count in the window, or `null` when this device cannot know it: a
   * WEEKLY limit read without an `aiQuota`. `aiUsedToday` is today only, and
   * a week's count is not it.
   */
  used: number | null;
  /** When the count starts again, an ISO instant, or `null` without an `aiQuota` to say so. */
  resetsAt: string | null;
}

/**
 * The allowance a screen draws, or `null` while the account is not read.
 *
 * `aiQuota` WINS WHEN THE CORE SENT ONE: it is the grant the proxy applies to
 * the next request, with the count in the same window and the reset instant.
 * Without it (an older core, or `null` because the proxy would refuse) the
 * limits the account names are read through {@link shownAiLimit}, and a DAILY
 * limit is counted by `aiUsedToday` as it always was. A WEEKLY limit has no
 * count here, and the screen prints none rather than today's number against a
 * week's limit.
 *
 * RENDER IT, NEVER AUTHORIZE ON IT.
 */
export function shownAllowance({
  dailyAiLimit,
  aiUsedToday,
  aiLimitPeriod,
  freeDailyAiLimit,
  freeAiLimitPeriod,
  allowanceExpiresAt,
  aiQuota,
  now,
}: {
  dailyAiLimit: number | null;
  aiUsedToday: number | null;
  aiLimitPeriod?: AiLimitPeriod | null;
  freeDailyAiLimit: number | null | undefined;
  freeAiLimitPeriod?: AiLimitPeriod | null;
  allowanceExpiresAt: string | null;
  aiQuota?: AiQuota | null;
  now: Date;
}): ShownAllowance | null {
  if (dailyAiLimit === null) return null;
  if (aiQuota !== null && aiQuota !== undefined) {
    return { limit: aiQuota.limit, period: aiQuota.period, used: aiQuota.used, resetsAt: aiQuota.resetsAt };
  }
  const shown = shownAiLimit({
    dailyAiLimit,
    aiLimitPeriod,
    freeDailyAiLimit,
    freeAiLimitPeriod,
    allowanceExpiresAt,
    now,
  });
  if (shown === null) return null;
  const used = shown.period === 'day' ? (aiUsedToday ?? 0) : null;
  return { ...shown, used, resetsAt: null };
}
