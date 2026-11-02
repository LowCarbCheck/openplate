/**
 * THE USAGE METER on the plan page's hero, decided here (2026-11-02).
 *
 * Pure. It says what the bar and its sentence show for a person with no paid
 * plan, from the account's real figures, and it answers `null` when there is
 * nothing true to show. No figure is ever invented: an unread quota draws no
 * meter, and the hero keeps the meter's box empty.
 *
 * ── A SCAN TRIAL COUNTS ITS SCANS, NOT ITS QUOTA ─────────────────────────
 *
 * On a scan trial `aiQuota` is the per-day burst limit the core holds a trial to
 * (`PROTOCOL.md` §5.19, for example 200 a day), not the ten free scans the person
 * was given. "0 of 200 AI scans used today" would be true and would mislead, so a
 * scan trial reads `trialScans`, the count that runs out. A trial count never
 * resets, so it has no second line.
 *
 * ── A WINDOW THAT HAS ENDED SAYS NOTHING ─────────────────────────────────
 *
 * A quota whose `resetsAt` has passed describes last week. The count starts
 * again at zero, and only the next account read knows the new figures.
 */
import type { AiLimitPeriod, AiQuota } from '#app/lib/plans/ai-quota';
import type { PlanStanding } from '#app/lib/plans/plan-standing';
import type { TrialScans } from '#app/lib/plans/trial-scans';

/** What the meter's sentence counts: the free scans of a trial, or one window of the allowance. */
export type MeterBasis = 'trial-scans' | AiLimitPeriod;

/** One meter, every figure already decided. */
export interface HeroMeter {
  basis: MeterBasis;
  /** Clamped to {@link limit}, so the bar and the sentence never say more than all of it. */
  used: number;
  /** Above zero. */
  limit: number;
  /** When the count starts again, an ISO instant, or `null` for a count that never does. */
  resetsAt: string | null;
}

/** The bar's filled share, in whole percent from 0 to 100. */
export function meterPercent({ used, limit }: Pick<HeroMeter, 'used' | 'limit'>): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used * 100) / limit)));
}

/** A meter from a scan count, or `null` for an account that was given none. */
function scansMeterOf(trial: TrialScans | null | undefined): HeroMeter | null {
  if (trial === null || trial === undefined || trial.granted <= 0) return null;
  return { basis: 'trial-scans', used: trial.granted - trial.left, limit: trial.granted, resetsAt: null };
}

/** A meter from the allowance window, or `null` with no quota or a window that has ended. */
function windowMeterOf({ quota, now }: { quota: AiQuota | null | undefined; now: Date }): HeroMeter | null {
  if (quota === null || quota === undefined) return null;
  if (Date.parse(quota.resetsAt) <= now.getTime()) return null;
  return { basis: quota.period, used: Math.min(quota.used, quota.limit), limit: quota.limit, resetsAt: quota.resetsAt };
}

/**
 * The meter for this person, or `null` for none.
 *
 * @param input.standing - where the person stands.
 * @param input.trialScans - `account.trialScans`, or `null`/absent.
 * @param input.quota - `account.aiQuota`, or `null`/absent for unread.
 * @param input.now - the instant to judge the window against.
 */
export function heroMeterOf({
  standing,
  trialScans,
  quota,
  now,
}: {
  standing: PlanStanding;
  trialScans: TrialScans | null | undefined;
  quota: AiQuota | null | undefined;
  now: Date;
}): HeroMeter | null {
  if (standing.kind === 'trial' && standing.basis === 'scans') return scansMeterOf(trialScans);
  // A TRIAL THAT ENDED ON ITS SCANS still shows them all used. One that ended
  // on its days may have scans left, and the quota is what remains to say.
  if (standing.kind === 'trial-ended' && standing.basis === 'scans' && standing.endedBy === 'scans') {
    return scansMeterOf(trialScans);
  }
  return windowMeterOf({ quota, now });
}
