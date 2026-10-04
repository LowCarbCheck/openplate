/**
 * THE TIERS ON THE PLAN PAGE, as one pure view model (M2/05).
 *
 * The biller sells tiers and says so in the offer (`PlanOffer.tiers`). This
 * module turns that data into the rows the page draws, and it is the whole of
 * what the page knows about a tier: no name, no price, no limit and no feature
 * set is written here. Every one of them is read from the offer.
 *
 * ── ABSENT MEANS TODAY'S PAGE ────────────────────────────────────────────
 *
 * {@link tiersViewOf} answers `null` for an offer with no tiers, and the page
 * draws exactly what it drew before tiers existed. A biller that sells one plan
 * never has to know this module exists.
 *
 * ── THE RANK IS THE ARRAY ORDER ──────────────────────────────────────────
 *
 * The biller lists the free entry first and then every tier on sale, lowest
 * first (`tiers` in `GET /plans/offer`). A tier's position in that array is its
 * rank, and it is the only thing that says whether a move is up or down
 * ({@link moveEffectOf}). No tier id is compared with a literal.
 *
 * ── WHO IS ON WHICH TIER ─────────────────────────────────────────────────
 *
 * The account's tier is `PlanView.tier`, an id the biller chose. A person with
 * no subscription is on the free entry, the first one the biller marks as not
 * sold. An id this offer does not list marks no row and offers no move: the
 * page says nothing rather than guessing a rank.
 *
 * ── WHO MAY ORDER WHAT ───────────────────────────────────────────────────
 *
 * A person with no subscription orders any sold tier, by any of its plans.
 * A SUBSCRIBER moves (M2/04, `plans/plan-switch.ts` in the biller):
 *
 * - to another sold tier, by any of its plans: higher takes effect now, lower
 *   at the end of the paid period;
 * - on their own tier, from monthly to yearly, at the end of the paid period;
 * - never while a payment is overdue, which the biller refuses with a 409.
 *
 * Yearly to monthly on one tier is not offered: the biller refuses it, because
 * the yearly plan already continues monthly after its year.
 */
import { FEATURE_LABELS, isFeatureLabel, type FeatureLabel } from '#app/lib/plans/capabilities';
import {
  PLAN_KEYS,
  type MoveEffect,
  type OfferPlan,
  type PlanKey,
  type PlanOffer,
  type Tier,
} from '#app/lib/sync/engine/client/plans-wire';

/** One row of the tier list, every field already decided. */
export interface TierRowView {
  /** The biller's id for the tier, opaque. */
  id: string;
  name: string;
  description: string;
  /** AI scans a day, `0` for none, `null` when the biller states no limit. */
  dailyAiLimit: number | null;
  /** The features this tier includes that this build knows, in the order the plan page lists them. */
  features: FeatureLabel[];
  /** `true` for the tier the account is on. */
  isCurrent: boolean;
  /** `true` for the entry of a person with no paid tier, which is never ordered. */
  isFree: boolean;
  /** `true` when this row can be ordered, or moved to, by the reader. */
  isOrderable: boolean;
  /** The plans this row can be ordered by for this reader, monthly first. Empty when {@link isOrderable} is not. */
  plans: OfferPlan[];
  /**
   * When a move to this row takes effect, for a SUBSCRIBER. `null` for a first
   * order, which is a payment and not a move.
   */
  effect: MoveEffect | null;
}

export interface TiersView {
  rows: TierRowView[];
  /** `true` when at least one row can be ordered, so the page draws the pick at all. */
  hasOrderableRow: boolean;
}

/** What the page knows about the reader's own plan. */
export interface OwnPlan {
  /** The tier id of the live subscription, or `null` with none. */
  tierId: string | null;
  /** The interval of the live subscription, or `null` with none. */
  planKey: PlanKey | null;
  /** The last payment failed. The biller refuses every move until it is settled. */
  isPastDue: boolean;
}

/** A reader with no subscription. */
export const NO_OWN_PLAN: OwnPlan = { tierId: null, planKey: null, isPastDue: false };

/** The known feature words a capability list names, in the page's order and without duplicates. */
export function knownFeaturesOf(capabilities: readonly string[]): FeatureLabel[] {
  const named = new Set(capabilities.filter(isFeatureLabel));
  return FEATURE_LABELS.filter((label) => named.has(label));
}

/**
 * When a move from one rank to another takes effect (M2/04).
 *
 * PURE, and the whole rule: a HIGHER rank takes effect now, with the price
 * settled pro rata, and anything else waits for the end of the paid period. The
 * equal case is the one move inside a tier, monthly to yearly, which the biller
 * also books for the end of the period.
 *
 * @param input.currentRank - the position of the reader's tier in `tiers`.
 * @param input.targetRank - the position of the tier moved to.
 */
export function moveEffectOf({ currentRank, targetRank }: { currentRank: number; targetRank: number }): MoveEffect {
  return targetRank > currentRank ? 'now' : 'period-end';
}

/** What a reader may order from one row: the plans, and the effect of a move to it. */
interface RowOrdering {
  plans: OfferPlan[];
  effect: MoveEffect | null;
}

/** The plans a reader may order from one row, and the effect of the move. */
function orderingOf({
  tier,
  index,
  own,
  ownRank,
}: {
  tier: Tier;
  index: number;
  own: OwnPlan;
  ownRank: number;
}): RowOrdering {
  if (!tier.isSold || tier.plans.length === 0) return { plans: [], effect: null };
  const plans = [...tier.plans].toSorted((a, b) => PLAN_KEYS.indexOf(a.key) - PLAN_KEYS.indexOf(b.key));
  if (own.tierId === null) return { plans, effect: null };
  // A SUBSCRIBER: no move while payment is overdue or when the own tier is not in the list.
  if (own.isPastDue || ownRank < 0) return { plans: [], effect: null };
  const effect = moveEffectOf({ currentRank: ownRank, targetRank: index });
  if (index !== ownRank) return { plans, effect };
  // THE OWN TIER: only the yearly plan, and only from the monthly one.
  if (own.planKey !== 'monthly') return { plans: [], effect: null };
  return { plans: plans.filter((plan) => plan.key === 'yearly'), effect };
}

/**
 * The rows for an offer, or `null` when the offer sells no tiers.
 *
 * @param input.offer - the decoded offer.
 * @param input.own - the reader's own plan, {@link NO_OWN_PLAN} for a person with none.
 */
export function tiersViewOf({ offer, own }: { offer: PlanOffer; own: OwnPlan }): TiersView | null {
  const tiers = offer.tiers;
  if (tiers === undefined || tiers.length === 0) return null;
  const ownRank = own.tierId === null ? -1 : tiers.findIndex((tier) => tier.id === own.tierId);
  const rows = tiers.map((tier, index): TierRowView => {
    const ordering = orderingOf({ tier, index, own, ownRank });
    // THE FREE ENTRY IS CURRENT FOR A PERSON WITH NO TIER: the first entry, when it is not sold.
    const isFreeEntry = !tier.isSold;
    return {
      id: tier.id,
      name: tier.name,
      description: tier.description,
      dailyAiLimit: tier.dailyAiLimit,
      features: knownFeaturesOf(tier.capabilities),
      isCurrent: own.tierId === null ? isFreeEntry && index === 0 : index === ownRank,
      isFree: isFreeEntry,
      isOrderable: ordering.plans.length > 0,
      plans: ordering.plans,
      effect: ordering.effect,
    };
  });
  return { rows, hasOrderableRow: rows.some((row) => row.isOrderable) };
}

/**
 * The tier a first order starts on with no tap: the only one that can be
 * ordered. A biller that sells one tier keeps its one step order page. `null`
 * for a subscriber (a move is always chosen) and when there is a choice.
 */
export function defaultTierIdOf(view: TiersView): string | null {
  const orderable = view.rows.filter((row) => row.isOrderable);
  const [only] = orderable;
  if (orderable.length !== 1 || only === undefined || only.effect !== null) return null;
  return only.id;
}

/**
 * The offer as the order block should draw it for a picked tier: the same
 * offer, with the row's own plans as the plans. `null` when no tier is picked,
 * or the pick is not an orderable row (an id from a stale link).
 */
export function offerForTier({ offer, view, tierId }: { offer: PlanOffer; view: TiersView; tierId: string | null }): PlanOffer | null {
  if (tierId === null) return null;
  const row = view.rows.find((candidate) => candidate.id === tierId && candidate.isOrderable);
  if (row === undefined) return null;
  return { ...offer, plans: row.plans };
}
