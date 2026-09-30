/**
 * THE STANDING FREE GRANT, as the app reads it (2026-09-30).
 *
 * The core gives an account two daily AI limits (`PROTOCOL.md` §5.15, §5.19):
 * `dailyAiLimit`, the paid window's, which runs while `allowanceExpiresAt` is
 * in the future, and `freeDailyAiLimit`, a free grant with no end date and no
 * scan gate that applies whenever no paid window is live. A Beta supporter
 * holds a free grant, so when a plan they bought ends they fall back to it
 * instead of losing AI, and the app must never lock them.
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

/**
 * The daily limit a screen names, or `null` while the account is not read.
 *
 * THE PROXY'S ORDER, FOR RENDERING ONLY: a live paid window with a limit
 * names its own limit, otherwise a free grant names the free one, and
 * otherwise the paid limit is named as it always was. The last branch keeps
 * a scan trial, an account with no AI and every account read from a core
 * older than the field exactly as they were drawn before.
 */
export function shownDailyAiLimit({
  dailyAiLimit,
  freeDailyAiLimit,
  allowanceExpiresAt,
  now,
}: {
  dailyAiLimit: number | null;
  freeDailyAiLimit: number | null | undefined;
  allowanceExpiresAt: string | null;
  now: Date;
}): number | null {
  if (dailyAiLimit === null) return null;
  if (dailyAiLimit > 0 && isPaidWindowLive({ allowanceExpiresAt, now })) return dailyAiLimit;
  if ((freeDailyAiLimit ?? 0) > 0) return freeDailyAiLimit ?? 0;
  return dailyAiLimit;
}
