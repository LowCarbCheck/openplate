/**
 * A BOOKED DOWNGRADE, as the plan page reads it.
 *
 * A downgrade takes effect at the end of the paid period, so for the rest of
 * that period the subscription is on one tier and booked to move to another.
 * The biller says so twice: `GET /plans/me` carries `pendingTier` and
 * `pendingChangeAt`, and so does the order answer that booked it. The person
 * can take the change back (`POST /plans/pending-change/cancel`).
 *
 * ── TWO PURE QUESTIONS ───────────────────────────────────────────────────
 *
 * {@link pendingFactsOf} says WHAT is booked. {@link pendingChangeOf} says
 * whether the page can NAME it. They are apart because the first needs only
 * the biller's ids and the second needs the offer, which arrives later.
 *
 * ── NOTHING IS GUESSED ───────────────────────────────────────────────────
 *
 * The line reads "Switches to <tier> on <day>" beside a button "Keep <tier>".
 * A tier id this offer does not list has no name, and a name typed here would
 * be a tier name compiled into the app. So the page draws the line only when
 * it can name both tiers and the day, and says nothing otherwise, which is
 * what the page did before the field existed.
 */
import type { PlanView } from '#app/lib/sync/engine/client/plans-wire';

import type { TiersView } from './tier-view';

/** What is booked: the biller's tier id and the ISO day it takes effect. */
export interface PendingFacts {
  tierId: string;
  at: string;
}

/** What the status card draws: both tier names, already decided, and the day. */
export interface PendingChange {
  /** The tier the plan switches to. */
  tierName: string;
  /** The tier the person is on now, which "Keep" holds on to. */
  keepTierName: string;
  at: string;
}

/**
 * What is booked, from the freshest source the page holds.
 *
 * @param input.planView - `GET /plans/me`, or `null` while unread. Only a PAIR
 *   counts: a tier without a day, or a day without a tier, cannot be said.
 * @param input.booked - what the order answer of this visit booked, or `null`.
 *   Kept for the moment between the press and the next plan read, and for a
 *   read whose bounded Stripe call failed and so carries no fields.
 * @param input.isCancelled - the person took the change back in this visit.
 *   Wins over everything older, so the line leaves at once.
 */
export function pendingFactsOf({
  planView,
  booked,
  isCancelled,
}: {
  planView: PlanView | null;
  booked: PendingFacts | null;
  isCancelled: boolean;
}): PendingFacts | null {
  if (isCancelled) return null;
  if (planView?.pendingTier !== undefined && planView.pendingChangeAt !== undefined) {
    return { tierId: planView.pendingTier, at: planView.pendingChangeAt };
  }
  return booked;
}

/**
 * The change the card can say, or `null` when it cannot name it.
 *
 * A booked tier that is the tier the person is ON is not a downgrade (a move
 * from monthly to yearly on one tier may carry the same id), and "Switches to
 * X" beside "Keep X" would be a sentence that lies, so it is left out.
 */
export function pendingChangeOf({
  facts,
  tiers,
}: {
  facts: PendingFacts | null;
  tiers: TiersView | null;
}): PendingChange | null {
  if (facts === null || tiers === null) return null;
  const target = tiers.rows.find((row) => row.id === facts.tierId);
  const current = tiers.rows.find((row) => row.isCurrent && !row.isFree);
  if (target === undefined || current === undefined || target.id === current.id) return null;
  return { tierName: target.name, keepTierName: current.name, at: facts.at };
}
