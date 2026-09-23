/**
 * THE COMPACT FORM OF THE PLAN CARDS, for the moment the AI allowance ends
 * (M250/04).
 *
 * `PlanChoice` is the whole offer, on the plan page. This is the same offer
 * folded to one line and one button, for a screen somebody opened to log a
 * meal: what a plan costs per month at the least, and the way to the page
 * that sells it. It never starts an order itself; the plan page does that,
 * with the terms beside the button.
 *
 * ── THE PRICE IS THE OFFER'S, AND ONLY WHEN THERE IS ONE ────────────────
 *
 * The "from" figure is `lowestMonthlyPrice` over the offer's plans, the same
 * arithmetic the cards use, so this line and the card it links to state the
 * same cents. An offer not yet read, a biller older than the offer and a body
 * that does not decode all leave the line empty and keep the button, which is
 * exactly the link this screen drew before M250: unknown must not sell, and it
 * must not take the door away either.
 *
 * ── THE BOX IS THE SAME BEFORE AND AFTER THE OFFER ARRIVES ───────────────
 *
 * The offer is read lazily, when this card mounts. Until it answers, the price
 * line is there and `invisible`, holding one line's height, so the price
 * fills a box that was already drawn and nothing under the card moves
 * (DESIGN.md section 7).
 *
 * `PlanOfferCompactView` takes props only, so every state renders in a unit
 * test; `PlanOfferCompact` reads the offer and passes it in.
 */
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import { Button } from '#app/components/ui/button';
import { usePlanOffer } from '#app/hooks/use-plan-offer';
import { useOfferSeen } from '#app/hooks/use-offer-seen';
import type { OfferPlacement } from '#app/lib/matomo-events';
import { lowestMonthlyPrice } from '#app/lib/plans/plan-prices';
import { offerLocaleFor, PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';
import type { OfferPlan } from '#app/lib/sync/engine/client/plans-wire';
import { cn } from '#app/lib/utils';

/** A non-breaking space, so the reserved price line keeps one line's height with nothing in it. */
const EMPTY_LINE = '\u00a0';

export interface PlanOfferCompactProps {
  /** Where the card is drawn, for the funnel's "offer seen". */
  placement: OfferPlacement;
  /**
   * The sentence above the price, already translated, or `null` for none.
   * The screen's own: a notice that says why AI is off passes it here, and a
   * refusal that already said so above the card passes nothing.
   */
  lead?: string | null;
}

export interface PlanOfferCompactViewProps extends PlanOfferCompactProps {
  /** The offer's plans, or `null` while unread or when there is no offer to draw. */
  plans: readonly OfferPlan[] | null;
}

export function PlanOfferCompactView({ plans, placement, lead = null }: PlanOfferCompactViewProps) {
  const { t, i18n } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const fromPrice =
    plans === null ? null : lowestMonthlyPrice({ plans, locale: i18n.resolvedLanguage ?? i18n.language });
  // SEEN MEANS A PRICE WAS SEEN. The bare link before the offer arrives, or
  // without one, is the door M213 drew, not an offer.
  useOfferSeen({ ref: cardRef, placement, isEnabled: fromPrice !== null });

  return (
    <div ref={cardRef} data-slot="plan-offer-compact" className="space-y-2 border border-border bg-card p-3">
      {lead !== null && <p className="text-xs text-muted-foreground">{lead}</p>}
      <p
        data-slot="plan-offer-price"
        className={cn('text-sm font-semibold tabular-nums', fromPrice === null && 'invisible')}
      >
        {fromPrice === null ? EMPTY_LINE : t('plan.offer.from', { price: fromPrice })}
      </p>
      <Button asChild className="w-full">
        <Link to={PLAN_PAGE_HREF}>{t('aiIntake.plansLink')}</Link>
      </Button>
    </div>
  );
}

/** The card, with the offer read when it mounts. */
export function PlanOfferCompact({ placement, lead = null }: PlanOfferCompactProps) {
  const { i18n } = useTranslation();
  const offerRead = usePlanOffer({ isEnabled: true, locale: offerLocaleFor(i18n.language) });
  const plans = offerRead.settled ? (offerRead.offer?.plans ?? null) : null;
  return <PlanOfferCompactView plans={plans} placement={placement} lead={lead} />;
}
