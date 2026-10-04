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
 * ── WHO IS ON WHICH TIER ─────────────────────────────────────────────────
 *
 * `currentTier` is an id the biller chose. A person with no paid tier is on the
 * `free` entry, when the offer sends one. An id this offer does not list marks
 * no row: the page says nothing rather than guessing a tier.
 *
 * ── WHO MAY ORDER WHAT ───────────────────────────────────────────────────
 *
 * Only a tier that is on sale, has at least one price, is not the person's
 * own, and is not the free entry. A tier that is not on sale is still LISTED,
 * so a person can see what they have or what is closing, and never orderable.
 */
import { FEATURE_LABELS, isFeatureLabel, type FeatureLabel } from '#app/lib/plans/capabilities';
import type { OfferPlan, PlanOffer, Tier } from '#app/lib/sync/engine/client/plans-wire';

/** One row of the tier list, every field already decided. */
export interface TierRowView {
  /** The biller's id for the tier, opaque. For the free entry, the id the biller gave it. */
  id: string;
  name: string;
  description: string;
  /** AI scans a day, `0` for none, `null` when the biller states no limit. */
  dailyAiLimit: number | null;
  /** The features this tier includes that this build knows, in the order the plan page lists them. */
  features: FeatureLabel[];
  /** `true` for the tier the account is on. */
  isCurrent: boolean;
  /** `true` for the entry of a person with no paid tier. */
  isFree: boolean;
  /** `true` when the tier can be ordered: on sale, priced, not current, not free. */
  isOrderable: boolean;
  /** `true` for a listed tier that is not on sale and is not the person's own, which says so. */
  isClosedToOrders: boolean;
  /** The tier's prices, monthly first, as the offer's own entries. Empty for the free entry. */
  plans: OfferPlan[];
}

export interface TiersView {
  rows: TierRowView[];
  /** `true` when at least one row can be ordered, so the page draws the pick at all. */
  hasOrderableRow: boolean;
}

/** The known feature words a capability list names, in the page's order and without duplicates. */
export function knownFeaturesOf(capabilities: readonly string[]): FeatureLabel[] {
  const named = new Set(capabilities.filter(isFeatureLabel));
  return FEATURE_LABELS.filter((label) => named.has(label));
}

/** A tier's prices as a list, monthly first. */
function plansOf(tier: Pick<Tier, 'prices'>): OfferPlan[] {
  const { monthly, yearly } = tier.prices;
  return [monthly, yearly].filter((plan) => plan !== undefined);
}

/**
 * The rows for an offer, or `null` when the offer sells no tiers.
 *
 * @param input.offer - the decoded offer.
 * @param input.currentTier - the account's tier id, from the plan view or the
 *   offer, or `null`/absent for a person with no paid tier.
 */
export function tiersViewOf({
  offer,
  currentTier,
}: {
  offer: PlanOffer;
  currentTier: string | null | undefined;
}): TiersView | null {
  const tiers = offer.tiers;
  if (tiers === undefined || tiers.length === 0) return null;
  const ownTier = currentTier ?? null;
  const rows: TierRowView[] = [];

  if (offer.free !== undefined) {
    rows.push({
      id: offer.free.id,
      name: offer.free.name,
      description: offer.free.description,
      dailyAiLimit: offer.free.dailyAiLimit,
      features: knownFeaturesOf(offer.free.capabilities),
      // THE FREE ENTRY IS CURRENT FOR A PERSON NAMED NO TIER, and for one named
      // by its own id.
      isCurrent: ownTier === null || ownTier === offer.free.id,
      isFree: true,
      isOrderable: false,
      isClosedToOrders: false,
      plans: [],
    });
  }

  for (const tier of tiers) {
    const plans = plansOf(tier);
    const isCurrent = tier.id === ownTier;
    rows.push({
      id: tier.id,
      name: tier.name,
      description: tier.description,
      dailyAiLimit: tier.dailyAiLimit,
      features: knownFeaturesOf(tier.capabilities),
      isCurrent,
      isFree: false,
      isOrderable: tier.onSale && plans.length > 0 && !isCurrent,
      isClosedToOrders: !tier.onSale && !isCurrent,
      plans,
    });
  }

  return { rows, hasOrderableRow: rows.some((row) => row.isOrderable) };
}

/**
 * The offer as the order block should draw it for a picked tier: the same
 * offer, with the tier's own prices as the plans. `null` when no tier is
 * picked, or the pick is not an orderable row (an id from a stale link).
 */
export function offerForTier({ offer, view, tierId }: { offer: PlanOffer; view: TiersView; tierId: string | null }): PlanOffer | null {
  if (tierId === null) return null;
  const row = view.rows.find((candidate) => candidate.id === tierId && candidate.isOrderable);
  if (row === undefined) return null;
  return { ...offer, plans: row.plans };
}
