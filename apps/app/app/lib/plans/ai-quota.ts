/**
 * THE AI ALLOWANCE WINDOW, as the app reads it (2026-10-07).
 *
 * The core counts an account's AI requests over a window: a UTC day, which is
 * what every limit was before, or a UTC week from Monday 00:00 to the next
 * Monday 00:00 (`PROTOCOL.md` §5.15 and §5.19). The account view says which in
 * `aiLimitPeriod` (the paid limit's window) and `freeAiLimitPeriod` (the free
 * grant's), and `aiQuota` says what the proxy will hold the NEXT request to.
 *
 * NOTHING HERE AUTHORIZES ANYTHING. The proxy counts and refuses (`429
 * ai-quota-spent`); this module decides only what a screen draws: which window
 * to name, the count in it, and when it starts again.
 *
 * ── A core older than the fields reads as a day ─────────────────────────
 *
 * `AccountView` is cast, not parsed, by the auth client, so this is where the
 * three fields are checked. A missing key and anything that is not exactly
 * `'week'` read as `'day'`, and a missing or malformed `aiQuota` reads as
 * `null`, which draws exactly what the app drew before the fields existed.
 * A newer core that adds a third window must never be able to blank a screen
 * or invent a number: an unknown period voids the whole quota, and the
 * screen falls back to the window it can name.
 *
 * ── `kind` IS NOT READ ───────────────────────────────────────────────────
 *
 * `aiQuota.kind` is `"paid"`, `"free"` or `"trial"`. It is deliberately NOT
 * decoded here, and no screen may name a plan from it. It can say `"free"`
 * for a person who PAYS: while a paid window runs, the core compares the paid
 * limit with the free grant per week and counts the larger, so a Beta
 * supporter on a small plan is counted on the free grant (`PROTOCOL.md`
 * §5.15, the paid floor). The plan's name comes from the biller
 * (`GET /plans/me`), and the numbers come from `aiQuota`.
 */
import { z } from 'zod';

import { clockLocale, clockTimeOptions, dateLabelLocale } from '#app/i18n/date-locale';

/** The window a limit counts over: today, or Monday to the next Monday, both in UTC. */
export type AiLimitPeriod = 'day' | 'week';

/**
 * The window of a limit, or `'day'` for an absent key (a core older than the
 * field) and for any value that is not exactly `'week'`.
 *
 * @param wire - `AccountView.aiLimitPeriod` or `freeAiLimitPeriod` as it arrived.
 */
export function decodeAiLimitPeriod(wire: string | null | undefined): AiLimitPeriod {
  return wire === 'week' ? 'week' : 'day';
}

/** What the proxy will hold the next request to: the limit, the window and the count in it. */
export interface AiQuota {
  /** Units the window allows, above zero. */
  limit: number;
  period: AiLimitPeriod;
  /** The whole window's count: today for a day, Monday to today for a week. */
  used: number;
  /** An ISO instant: the next 00:00 UTC for a day, the next Monday 00:00 UTC for a week. */
  resetsAt: string;
}

/**
 * What the account view's `aiQuota` is typed as on arrival. `period` is a plain
 * string here, not the two words it should be, because this is the boundary
 * where a newer core's third window is turned away, so the type may not
 * pretend it has been.
 */
export interface AiQuotaInput {
  limit: number;
  period: string;
  used: number;
  resetsAt: string;
  /** Present on the wire and never read, see the header. */
  kind?: string;
}

const isoInstantSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'not an instant',
});

// `kind` is left out on purpose, see the header.
const aiQuotaSchema = z.object({
  limit: z.number().int().positive(),
  period: z.enum(['day', 'week']),
  used: z.number().int().min(0),
  resetsAt: isoInstantSchema,
});

/**
 * Reads `AccountView.aiQuota` off the wire. `null` is the core's own "the
 * proxy would refuse", and an absent key (an older core) and anything that is
 * not a whole quota read `null` as well: all of them draw the window the
 * account's own limits name.
 *
 * @param wire - the value as it arrived. The type is the contract, the parse is for the server that breaks it.
 */
export function decodeAiQuota(wire: AiQuotaInput | null | undefined): AiQuota | null {
  const parsed = aiQuotaSchema.safeParse(wire);
  return parsed.success ? parsed.data : null;
}

/** The weekday and the clock time an instant falls on, in the reader's language and zone. */
export interface QuotaResetMoment {
  /** The long weekday name: "Monday", "Montag". */
  weekday: string;
  /** The wall-clock time: "2:00 AM", "02:00". */
  time: string;
}

/**
 * When an allowance starts again, as a weekday and a time in the READER'S
 * zone, or `null` for an instant that does not parse.
 *
 * THE ZONE MATTERS: the core resets at Monday 00:00 UTC, which is Monday 02:00
 * in Berlin in summer and Sunday 20:00 in New York. The weekday is read from
 * the instant in the reader's own zone, so what a person is told is when it
 * happens for THEM. The device zone is the default; a caller may pass one so
 * a test does not depend on the machine it runs on.
 *
 * @param input.resetsAt - `AiQuota.resetsAt`, an ISO instant.
 * @param input.language - the app language, never the browser's own.
 * @param input.timeZone - an IANA zone name, or absent for the device's.
 */
export function formatQuotaReset({
  resetsAt,
  language,
  timeZone,
}: {
  resetsAt: string;
  language: string | null | undefined;
  timeZone?: string;
}): QuotaResetMoment | null {
  const instant = new Date(resetsAt);
  if (Number.isNaN(instant.getTime())) return null;
  const weekday = new Intl.DateTimeFormat(dateLabelLocale(language), { weekday: 'long', timeZone }).format(instant);
  const time = new Intl.DateTimeFormat(clockLocale(language), {
    ...clockTimeOptions(language),
    timeZone,
  }).format(instant);
  return { weekday, time };
}

/** The translate function a caller hands in, narrowed to what the reset line needs. */
type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The line that says when the allowance starts again, or `null` for a count
 * with no instant behind it (a core older than `aiQuota`).
 *
 * A WEEK names the weekday and the time. A DAY names the time only, because
 * the next one is always the day after, and the person's own clock decides
 * what that is called.
 */
export function describeQuotaReset({
  period,
  resetsAt,
  language,
  timeZone,
  t,
}: {
  period: AiLimitPeriod;
  resetsAt: string | null;
  language: string | null | undefined;
  timeZone?: string;
  t: Translate;
}): string | null {
  if (resetsAt === null) return null;
  const moment = formatQuotaReset({ resetsAt, language, timeZone });
  if (moment === null) return null;
  if (period === 'week') {
    return t('account.allowance.resetsWeek', { weekday: moment.weekday, time: moment.time });
  }
  return t('account.allowance.resetsDay', { time: moment.time });
}
