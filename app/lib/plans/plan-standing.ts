/**
 * WHERE A PERSON STANDS WITH A PLAN, asked once for every placement (M250/01).
 *
 * The trial countdown, the offer at the AI limit, the plan page and the account
 * page all need the same answer before they draw anything: does this instance
 * sell a plan, and is this person trying it, past it, paying for it or past
 * paying for it. Four placements deriving that on their own would be four
 * chances to show a countdown to somebody who already pays. So it is one pure
 * function over facts the app already holds, and every placement reads it.
 *
 * ── UNKNOWN MUST NOT SELL ────────────────────────────────────────────────
 *
 * The rule `plans-door.ts` states for the handshake holds for every input
 * here. A handshake not yet read, a plan not yet read, a session not yet
 * resumed and an account view not yet fetched all answer `no-plans`, which
 * every placement draws as nothing. A placement that guessed would tell a
 * paying person their trial is ending.
 *
 * ── THE PLAN IS ASKED BEFORE THE ALLOWANCE ───────────────────────────────
 *
 * The biller extends a paying account's allowance to the end of the period it
 * paid for (`openplate-billing/src/plans/apply-allowance.ts`), so an allowance
 * end date in the future is true of a trial AND of a subscription. Only
 * `/plans/me` tells the two apart, so its status decides first, and the
 * allowance is read only for somebody who has never subscribed.
 *
 * ── THE TRIAL IS A DATE, NOT A SUBSYSTEM ─────────────────────────────────
 *
 * M213/05: the trial is the allowance an invitation writes at redemption,
 * with an end date. There is no trial flag anywhere, so "in a trial" means an
 * allowance above zero with an end date still ahead, and "trial ended" means
 * that date has passed. The boundary instant counts as ENDED, the protocol's
 * "not after" comparison (`PROTOCOL.md` §5.19), the same one
 * `resolveAllowanceDoor` makes, so this function and the AI proxy never
 * disagree about the last second.
 *
 * PURE, AND THE CLOCK IS AN ARGUMENT, so the last minute of a trial and a
 * subscription that ends today are ordinary test cases.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import type { PlanInterval, PlanKey, PlanView } from '#app/lib/sync/engine/client/plans-wire';

import { hasPlansDoor } from './plans-door';

/** One day, the unit a trial countdown speaks in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a person stands.
 *
 * - `no-plans`: draw nothing. The instance sells nothing, a fact is not known
 *   yet, or the person has an open allowance with no end date, which nothing
 *   sold here would improve.
 * - `trial`: an allowance with an end date still ahead. `daysLeft` is whole
 *   days, rounded UP, so the last minute of a trial still reads one day and
 *   never zero.
 * - `trial-ended`: no plan, and no working allowance. `endedAt` is the date
 *   that passed, or `null` for an account that never had an allowance at all,
 *   the same dateless fact `PlansDoor` carries in `use-ai-connection.ts`.
 * - `subscribed`: the biller holds a live subscription. `renews` is `false`
 *   when it was cancelled and runs out at `periodEnd`. `planKey` and
 *   `interval` are `null` when the biller could not name the plan.
 * - `lapsed`: a subscription existed and is over.
 */
export type PlanStanding =
  | { kind: 'no-plans' }
  | { kind: 'trial'; endsAt: string; daysLeft: number }
  | { kind: 'trial-ended'; endedAt: string | null }
  | {
      kind: 'subscribed';
      planKey: PlanKey | null;
      interval: PlanInterval | null;
      /** The ISO instant the paid period ends, the next payment or the last day. `null` when the biller sent none. */
      periodEnd: string | null;
      renews: boolean;
      /** The last payment failed and Stripe is retrying it. Still subscribed, and worth saying so. */
      isPastDue: boolean;
    }
  | { kind: 'lapsed' };

/** The two account facts a standing needs, a subset of the session snapshot's `account`. */
export interface StandingAccount {
  /** `null` is "not read yet", never zero. */
  dailyAiLimit: number | null;
  /** `null` is "no end date" or "not read yet". Neither is expired. */
  allowanceExpiresAt: string | null;
}

/** The single `no-plans` value, so no caller builds a second one. */
export const NO_PLANS: PlanStanding = { kind: 'no-plans' };

/** The statuses under which the biller still holds a live subscription. */
const LIVE_STATUSES = new Set<PlanView['plan']>(['active', 'trialing', 'past_due']);

/**
 * Where this person stands with a plan.
 *
 * @param input.instance - the handshake's descriptor, or `null` while unread.
 * @param input.account - the session's account facts, or `null` with no session.
 * @param input.planView - `GET /plans/me`, or `null` while unread, absent or failed.
 * @param input.now - the instant to compare every date against.
 */
export function planStanding({
  instance,
  account,
  planView,
  now,
}: {
  instance: InstanceDescriptor | null;
  account: StandingAccount | null;
  planView: PlanView | null;
  now: Date;
}): PlanStanding {
  if (!hasPlansDoor(instance)) return NO_PLANS;
  if (planView === null) return NO_PLANS;
  if (LIVE_STATUSES.has(planView.plan)) return subscribedStanding(planView);
  if (planView.plan === 'canceled') return { kind: 'lapsed' };
  return neverSubscribedStanding({ account, now });
}

/** A live subscription, read off the biller's view. */
function subscribedStanding(planView: PlanView): PlanStanding {
  return {
    kind: 'subscribed',
    planKey: planView.planKey,
    interval: planView.interval,
    periodEnd: planView.currentPeriodEnd,
    renews: !planView.cancelAtPeriodEnd,
    isPastDue: planView.plan === 'past_due',
  };
}

/**
 * Somebody the biller has no subscription for: trying it, past it, or never
 * given it.
 *
 * An unparseable end date reads as no date, which is how `resolveAllowanceDoor`
 * treats a hostile or broken value too.
 */
function neverSubscribedStanding({ account, now }: { account: StandingAccount | null; now: Date }): PlanStanding {
  if (account === null || account.dailyAiLimit === null) return NO_PLANS;
  const endsAtMs = account.allowanceExpiresAt === null ? Number.NaN : Date.parse(account.allowanceExpiresAt);
  if (Number.isNaN(endsAtMs)) {
    return account.dailyAiLimit > 0 ? NO_PLANS : { kind: 'trial-ended', endedAt: null };
  }
  const endsAt = account.allowanceExpiresAt;
  if (endsAt === null || endsAtMs <= now.getTime()) return { kind: 'trial-ended', endedAt: endsAt };
  if (account.dailyAiLimit <= 0) return { kind: 'trial-ended', endedAt: null };
  return { kind: 'trial', endsAt, daysLeft: Math.ceil((endsAtMs - now.getTime()) / DAY_MS) };
}
