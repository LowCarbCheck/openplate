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
