/**
 * THE PLANS ON OFFER, as one radio group (M250/02).
 *
 * Each card shows what the biller sent and what the app can derive from it
 * honestly: the gross price per billing interval, the monthly equivalent of a
 * yearly price, the saving against twelve monthly payments, and the biller's
 * own term sentence. The arithmetic lives in `plan-prices.ts`; the words about
 * the order live in the biller. This file writes neither a price nor a term.
 *
 * ── NOTHING IS PICKED FOR THE PERSON ─────────────────────────────────────
 *
 * `selectedKey` is `null` unless the caller had a reason to set it, and the
 * only reason is a link that named a plan. A pre-selected yearly plan is the
 * nudge German consumer law and this app's own voice both refuse.
 *
 * ── ONE RADIO GROUP, READ ALOUD ONCE ─────────────────────────────────────
 *
 * The radio's name is the interval, the price and the term, in that order, so
 * a screen reader announces what a person would pay and on what terms before
 * anything else. The monthly equivalent and the saving are the DESCRIPTION,
 * and a card that has neither is described by nothing.
 *
 * ── EVERY LINE HAS ITS BOX FROM THE FIRST PAINT ──────────────────────────
 *
 * All cards draw the same four lines. A monthly card's equivalent and saving
 * lines are there and `invisible`, so the two cards line up and picking one
 * changes a colour, never a height. The border does not change width on
 * selection either, only its colour.
 *
 * Props only, apart from `t`: the offer is read by the page that places this,
 * so every state is reachable from `renderToStaticMarkup`.
 */
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useOfferSeen } from '#app/hooks/use-offer-seen';
import { trackPlanPicked, type OfferPlacement } from '#app/lib/matomo-events';
import { planCardFigures, type PlanCardFigures } from '#app/lib/plans/plan-prices';
import type { OfferPlan, PlanKey } from '#app/lib/sync/engine/client/plans-wire';
import { cn } from '#app/lib/utils';

/** The catalog key for each interval's name. A `Record`, so a third interval fails to compile here. */
const INTERVAL_NAME_KEY = {
  month: 'plan.choice.interval.month',
  year: 'plan.choice.interval.year',
} satisfies Record<PlanCardFigures['interval'], string>;

/** The catalog key for each interval's price line. */
const PRICE_LINE_KEY = {
  month: 'plan.choice.pricePerMonth',
  year: 'plan.choice.pricePerYear',
} satisfies Record<PlanCardFigures['interval'], string>;

/** A non-breaking space, so a reserved line keeps one line's height with nothing in it. */
const EMPTY_LINE = '\u00a0';

export interface PlanChoiceProps {
  /** The offer's plans, in the order the biller sent them. */
  plans: readonly OfferPlan[];
  /** The picked plan, or `null` when the person has not picked one. */
  selectedKey: PlanKey | null;
  onSelect: (key: PlanKey) => void;
  /** The radio group's field name. */
  name?: string;
  /**
   * Where this choice is drawn, for the funnel's "offer seen" event, which
   * fires once when the cards are on screen. `null` reports nothing.
   */
  placement?: OfferPlacement | null;
}

/** One card's border and fill. Bordered and tinted when picked, never a left rule. */
function cardClass(isSelected: boolean): string {
  return cn(
    'block cursor-pointer border p-3 transition-colors',
    'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
    isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
  );
}

export function PlanChoice({ plans, selectedKey, onSelect, name = 'plan', placement = null }: PlanChoiceProps) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const groupRef = useRef<HTMLFieldSetElement>(null);
  useOfferSeen({ ref: groupRef, placement });
  const cards = planCardFigures({ plans, locale: i18n.resolvedLanguage ?? i18n.language });

  return (
    <fieldset ref={groupRef} data-slot="plan-choice" className="space-y-2">
      <legend className="text-sm font-medium">{t('plan.choice.legend')}</legend>
      <div className="space-y-2 pt-1">
        {cards.map((card) => {
          const isSelected = card.key === selectedKey;
          const id = `${baseId}-${card.key}`;
          const described = [
            card.monthlyEquivalent === null ? null : `${id}-equivalent`,
            card.saving === null ? null : `${id}-saving`,
          ].filter((part) => part !== null);
          return (
            <label key={card.key} data-slot="plan-card" data-plan-key={card.key} className={cardClass(isSelected)}>
              <input
                type="radio"
                name={name}
                value={card.key}
                checked={isSelected}
                onChange={() => {
                  // THE FUNNEL STEP BELONGS TO THE PICK, not to the caller, so
                  // every place that draws these cards reports it the same way.
                  trackPlanPicked(card.key);
                  onSelect(card.key);
                }}
                aria-labelledby={`${id}-name ${id}-price ${id}-term`}
                aria-describedby={described.length > 0 ? described.join(' ') : undefined}
                className="sr-only"
              />
              <span className="flex items-baseline gap-2">
                {/* THE PICK IS NOT HUE ALONE: a filled dot inside the ring
                    says which card is chosen to somebody who cannot tell teal
                    from grey. A true circle, so `rounded-full` is allowed. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-4 shrink-0 translate-y-0.5 items-center justify-center rounded-full border',
                    isSelected ? 'border-primary' : 'border-muted-foreground/60',
                  )}
                >
                  <span className={cn('size-2 rounded-full bg-primary', !isSelected && 'invisible')} />
                </span>
                <span id={`${id}-name`} className="flex-1 text-sm font-medium">
                  {t(INTERVAL_NAME_KEY[card.interval])}
                </span>
                <span id={`${id}-price`} data-slot="plan-price" className="text-sm font-semibold tabular-nums">
                  {t(PRICE_LINE_KEY[card.interval], { price: card.price })}
                </span>
              </span>
              <span
                id={`${id}-equivalent`}
                data-slot="plan-monthly-equivalent"
                className={cn(
                  'block pl-6 text-xs text-muted-foreground tabular-nums',
                  card.monthlyEquivalent === null && 'invisible',
                )}
              >
                {card.monthlyEquivalent === null ?
                  EMPTY_LINE
                : t('plan.choice.monthlyEquivalent', { price: card.monthlyEquivalent })}
              </span>
              <span
                id={`${id}-saving`}
                data-slot="plan-saving"
                className={cn('block pl-6 text-xs font-medium tabular-nums', card.saving === null && 'invisible')}
              >
                {card.saving === null ? EMPTY_LINE : t('plan.choice.saving', { saving: card.saving })}
              </span>
              <span id={`${id}-term`} data-slot="plan-term" className="block pl-6 text-xs text-muted-foreground">
                {card.term}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
