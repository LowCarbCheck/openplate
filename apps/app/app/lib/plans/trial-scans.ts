/**
 * THE SCAN TRIAL, as the app reads it (M253/05).
 *
 * The core counts free AI scans per account and says how many are left in two
 * places: `AccountView.trialScans` (`{granted, left}` or `null`) and the
 * `X-Trial-Scans-Left` header on every proxied response of a scan-trial
 * account (`PROTOCOL.md` §5.15, §5.19). This module decodes both, and nothing
 * else here authorizes anything: the proxy refuses the eleventh scan whatever a
 * client believes.
 *
 * ── An older core, and a broken value, read as "no scan trial" ──────────
 *
 * `AccountView` is cast, not parsed, by the auth client (`auth-client.ts`), so
 * this is the boundary where the one new field is checked. A missing key, a
 * `null`, and anything that is not two whole numbers with `left <= granted`
 * all answer `null`, which every reader draws as today's day-based standing.
 * Drawing a count the service did not state would be a promise nobody made.
 */
import { z } from 'zod';

import type { TrialScansWire } from '#app/lib/sync/engine/client/auth-wire';

/** A scan trial: how many free scans the account was given, and how many are left. */
export interface TrialScans {
  granted: number;
  left: number;
}

/** The header the managed proxy sets on a scan-trial account's responses. Transcribed from `PROTOCOL.md` §5.19. */
export const TRIAL_SCANS_LEFT_HEADER = 'X-Trial-Scans-Left';

const trialScansSchema = z
  .object({ granted: z.number().int().min(0), left: z.number().int().min(0) })
  .refine((value) => value.left <= value.granted)
  .nullable()
  .catch(null);

/**
 * The account's scan trial, or `null` for none.
 *
 * @param wire - `AccountView.trialScans` as it arrived, which an older core omits.
 */
export function decodeTrialScans(wire: TrialScansWire | null | undefined): TrialScans | null {
  if (wire === undefined) return null;
  const parsed = trialScansSchema.parse(wire);
  return parsed === null ? null : { granted: parsed.granted, left: parsed.left };
}

const trialEndsAtSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .nullable()
  .catch(null);

/**
 * When the free tier ends by the calendar, as an ISO instant, or `null` for
 * no end date (M267).
 *
 * An absent key (a core older than the field), a `null` and anything that is
 * not a parseable instant all answer `null`, and `null` never locks: a broken
 * value must not end somebody's free tier early.
 *
 * @param wire - `AccountView.trialEndsAt` as it arrived.
 */
export function decodeTrialEndsAt(wire: string | null | undefined): string | null {
  if (wire === undefined) return null;
  return trialEndsAtSchema.parse(wire);
}

/** One day, the unit `TRIAL_DAYS` counts in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many days this account's free tier ran, read off its own creation and
 * end, or `null` when either is unknown (M267).
 *
 * THE ACCOUNT'S OWN NUMBER FIRST, the instance's offer second, the rule the
 * spent-scans heading follows: an operator may change `TRIAL_DAYS` later, and
 * the lock screen must name the days this person was given.
 *
 * COUNTED ON THE CALENDAR, NOT IN HOURS. The core ends the trial at local
 * midnight after the last day, and the sign-up day does not count
 * (`openplate-core` `trialEndsAtFor`, owner decision 2026-09-29), so the time
 * from sign-up to end is anything from just over fourteen days to fifteen. The
 * end is a midnight in the core's zone, so its UTC time of day says how far
 * that zone ran from UTC at the end; both instants are moved by that offset
 * and the count is the calendar days between them, less the sign-up day. The
 * zone itself never reaches the app. The count is off by one only for a
 * sign-up within the hour next to midnight on a trial that crosses a change
 * of the clocks, where the offset at the sign-up differed by that hour.
 */
export function grantedTrialDays({
  createdAt,
  trialEndsAt,
}: {
  createdAt: string | null | undefined;
  trialEndsAt: string | null | undefined;
}): number | null {
  if (createdAt === null || createdAt === undefined || trialEndsAt === null || trialEndsAt === undefined) return null;
  const endsAtMs = Date.parse(trialEndsAt);
  const createdAtMs = Date.parse(createdAt);
  if (Number.isNaN(endsAtMs) || Number.isNaN(createdAtMs)) return null;
  const zoneOffsetMs = (DAY_MS - (((endsAtMs % DAY_MS) + DAY_MS) % DAY_MS)) % DAY_MS;
  const lastMidnightDay = Math.round((endsAtMs + zoneOffsetMs) / DAY_MS);
  const signUpDay = Math.floor((createdAtMs + zoneOffsetMs) / DAY_MS);
  const days = lastMidnightDay - signUpDay - 1;
  return days > 0 ? days : null;
}

/**
 * How many days of the free tier are left, beside its scans left, or `null`
 * when there is no day line to draw (owner decision 2026-09-30).
 *
 * WHOLE DAYS, ROUNDED UP, as `planStanding`'s `daysLeft` counts them: 30
 * hours left is 2 days, and the last minute is still 1 day, never 0.
 *
 * ONLY FOR A SCAN TRIAL THAT STILL RUNS. `trialScans` is the trial that binds
 * (`bindingTrialScans`), so a paid or granted window, which carries a date
 * and no scan gate, is `null` here. So is an account with no scan trial at
 * all (the "Beta supporter" standing), a trial whose scans are spent, an end
 * that has passed or cannot be read, and no end date.
 */
export function trialDaysLeft({
  trialScans,
  trialEndsAt,
  now,
}: {
  trialScans: TrialScans | null;
  trialEndsAt: string | null | undefined;
  now: Date;
}): number | null {
  if (trialScans === null || trialScans.left <= 0) return null;
  if (trialEndsAt === null || trialEndsAt === undefined) return null;
  const remainingMs = Date.parse(trialEndsAt) - now.getTime();
  if (Number.isNaN(remainingMs) || remainingMs <= 0) return null;
  return Math.ceil(remainingMs / DAY_MS);
}

/**
 * The count a proxied response carried, or `null` when it carried none.
 *
 * A value that is not a whole number at or above zero is `null`: a garbled
 * header must not move a count on screen.
 */
export function readTrialScansLeft(headers: Headers): number | null {
  const raw = headers.get(TRIAL_SCANS_LEFT_HEADER);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number.parseInt(raw, 10);
}

/**
 * The trial after the proxy said how many scans are left.
 *
 * `null` in, `null` out: a header on an account the app believes has no scan
 * trial is not enough to invent a `granted`, and the next account read brings
 * the whole view. The count is clamped to `granted`, so a stale view cannot
 * read "12 of 10".
 */
export function withScansLeft({ trial, left }: { trial: TrialScans | null; left: number }): TrialScans | null {
  if (trial === null) return null;
  return { granted: trial.granted, left: Math.min(left, trial.granted) };
}

/**
 * The scan trial that binds this account, or `null` when none does.
 *
 * A DATE WINS, as in the proxy's ladder (`PROTOCOL.md` §5.19): a future end
 * date is a paid or granted window with no scan gate, and a passed one is
 * `allowance-expired`. Only an account with no date is held to its count, so
 * only then does a screen state it. A paying person must never read "0 of 10
 * free scans left" beside a plan that has no such limit.
 */
export function bindingTrialScans({
  trialScans,
  allowanceExpiresAt,
}: {
  trialScans: TrialScans | null | undefined;
  allowanceExpiresAt: string | null;
}): TrialScans | null {
  if (allowanceExpiresAt !== null) return null;
  return trialScans ?? null;
}

/**
 * A new id for one AI action a person started (`X-Intake-Id`, M253/03).
 *
 * One per action, made where the action starts and reused by every retry the
 * adapter makes for it, so a retry after a provider error never costs a
 * second scan. 32 hexadecimal characters, inside the core's
 * `^[A-Za-z0-9_-]{16,64}$`.
 */
export function newIntakeId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}
