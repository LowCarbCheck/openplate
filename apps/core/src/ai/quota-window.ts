/**
 * The days an AI limit counts over at one instant, and when the count starts
 * again (2026-10-07).
 *
 * ONE FUNCTION FOR THE PROXY AND THE ACCOUNT VIEW. The proxy sums these days
 * before it reserves a unit, and the account view sums the same days for
 * `aiQuota.used` and prints the same `resetsAt`, so "3 of 20 this week,
 * resets Monday" is the number the proxy will hold the next request to.
 *
 *  - `'day'`: today, from 00:00 UTC; the count starts again at the next
 *    00:00 UTC. This is the rule every limit had before the week existed.
 *  - `'week'`: Monday 00:00 UTC to now; the count starts again at the next
 *    Monday 00:00 UTC. A request made on Monday at 00:00:00.000 is in the new
 *    week.
 *
 * Pure: the instant is injected, never read from the clock.
 */
import type { AiLimitPeriod } from '../protocol.js';
import { nextUtcMidnight, nextUtcMonday, utcDayKey, utcWeekStartDayKey } from '../lib/utc-day.js';

/**
 * The `code` beside the sentence of a `429` for a spent allowance (2026-10-07).
 * The body's `error` stays a sentence for older readers, so a client that
 * branches reads this field instead (PROTOCOL.md §5.19).
 */
export const AI_QUOTA_SPENT = 'ai-quota-spent';

export interface QuotaWindow {
  period: AiLimitPeriod;
  /** The first UTC day the window counts, `YYYY-MM-DD`. Today for a day window. */
  fromDay: string;
  /** Today in UTC, `YYYY-MM-DD`: the row a reserve adds to and the last day summed. */
  day: string;
  /** The instant the count starts again. */
  resetsAt: Date;
}

export function quotaWindowOf(input: { period: AiLimitPeriod; now: Date }): QuotaWindow {
  const day = utcDayKey(input.now);
  if (input.period === 'week') {
    return { period: 'week', fromDay: utcWeekStartDayKey(input.now), day, resetsAt: nextUtcMonday(input.now) };
  }
  return { period: 'day', fromDay: day, day, resetsAt: nextUtcMidnight(input.now) };
}
