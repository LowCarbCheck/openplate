/**
 * THE TIERS, listed as the biller sent them (M2/05).
 *
 * One card per row of `tiersViewOf`: the name, the description and the prices
 * are the biller's words and figures, drawn as served. What this file writes is
 * chrome: the line about scans a day, the names of the features (from the
 * catalog, by feature word), the mark on the person's own tier and the note on
 * a tier that is not on sale. No tier name and no price is in this file.
 *
 * ── A PICK IS ONE RADIO GROUP, FOR THE ORDERABLE TIERS ONLY ──────────────
 *
 * Choosing a tier does not order it. It opens the order block below, which
 * offers that tier's intervals, the order texts and the two consents, exactly
 * as for a single plan. The person's own tier, the free entry and a tier that is
 * not on sale are drawn WITHOUT a radio, so nothing that cannot be ordered looks
 * like it can.
 *
 * ── EVERY CARD DRAWS THE SAME LINES ──────────────────────────────────────
 *
 * The mark and the not-on-sale note are reserved lines (`invisible` when they
 * have nothing to say), so a card keeps its height whatever it is, and picking
 * one changes a colour and never a size.
 *
 * Props only, apart from `t`, so it renders in a unit test.
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { featureNameKey } from '#app/components/plans/feature-gate';
import { formatCents, monthlyEquivalentCents } from '#app/lib/plans/plan-prices';
import type { TierRowView } from '#app/lib/plans/tier-view';
import { cn } from '#app/lib/utils';

/** A non-breaking space, so a reserved line keeps one line's height with nothing in it. */
const EMPTY_LINE = ' ';

export interface TierListProps {
  rows: readonly TierRowView[];
  /** The picked tier's id, or `null`. */
  pickedTierId: string | null;
  /** `false` draws the list with no radios: a subscriber reading the page, or an order held elsewhere. */
  canPick: boolean;
  onPick: (tierId: string) => void;
}

/** One card's border and fill. Bordered and tinted when picked, never a left rule. */
function cardClass({ isPicked, isPickable }: { isPicked: boolean; isPickable: boolean }): string {
  return cn(
    'block border p-3 transition-colors',
    isPickable && 'cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
    isPicked ? 'border-primary bg-primary/5' : 'border-border',
    isPickable && !isPicked && 'hover:border-primary/40',
  );
}

export function TierList({ rows, pickedTierId, canPick, onPick }: TierListProps) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return (
    <fieldset data-slot="plan-tiers" className="space-y-2">
      <legend className="text-sm font-medium">{t('plan.tiers.legend')}</legend>
      <div className="space-y-2 pt-1">
        {rows.map((row) => {
          const isPickable = canPick && row.isOrderable;
          const isPicked = isPickable && row.id === pickedTierId;
          const id = `${baseId}-${row.id}`;
          const body = (
            <>
              <span className="flex items-baseline gap-2">
                <span id={`${id}-name`} data-slot="tier-name" className="flex-1 text-sm font-medium">
                  {row.name}
                </span>
                <span
                  data-slot="tier-current"
                  className={cn('text-xs font-medium text-primary', !row.isCurrent && 'invisible')}
                >
                  {row.isCurrent ? t('plan.tiers.current') : EMPTY_LINE}
                </span>
              </span>
              <span data-slot="tier-description" className="block text-xs text-muted-foreground">
                {row.description}
              </span>
              <span data-slot="tier-limit" className="block text-xs">
                {row.dailyAiLimit === null ? EMPTY_LINE
                : row.dailyAiLimit === 0 ? t('plan.tiers.noScans')
                : t('plan.tiers.dailyLimit', { count: row.dailyAiLimit })}
              </span>
              {row.features.length > 0 && (
                <span data-slot="tier-features" className="block text-xs text-muted-foreground">
                  {t('plan.tiers.includes', { features: row.features.map((feature) => t(featureNameKey(feature))).join(', ') })}
                </span>
              )}
              {row.plans.map((plan) => (
                <span key={plan.key} data-slot="tier-price" data-plan-key={plan.key} className="block text-xs tabular-nums">
                  {t(plan.interval === 'year' ? 'plan.tiers.pricePerYear' : 'plan.tiers.pricePerMonth', {
                    price: formatCents({ cents: plan.grossCents, currency: plan.currency, locale }),
                  })}
                  {monthlyEquivalentCents(plan) === null ? null : (
                    <span className="text-muted-foreground">
                      {' '}
                      {t('plan.choice.monthlyEquivalent', {
                        price: formatCents({
                          cents: monthlyEquivalentCents(plan) ?? 0,
                          currency: plan.currency,
                          locale,
                        }),
                      })}
                    </span>
                  )}
                </span>
              ))}
              <span
                data-slot="tier-not-on-sale"
                className={cn('block text-xs text-muted-foreground', !row.isClosedToOrders && 'invisible')}
              >
                {row.isClosedToOrders ? t('plan.tiers.notOnSale') : EMPTY_LINE}
              </span>
            </>
          );
          if (!isPickable) {
            return (
              <div
                key={row.id}
                data-slot="plan-tier"
                data-tier-id={row.id}
                data-current={row.isCurrent ? 'true' : 'false'}
                className={cardClass({ isPicked: false, isPickable: false })}
              >
                {body}
              </div>
            );
          }
          return (
            <label
              key={row.id}
              data-slot="plan-tier"
              data-tier-id={row.id}
              data-current={row.isCurrent ? 'true' : 'false'}
              className={cardClass({ isPicked, isPickable: true })}
            >
              <input
                type="radio"
                name="tier"
                value={row.id}
                checked={isPicked}
                onChange={() => onPick(row.id)}
                aria-labelledby={`${id}-name`}
                className="sr-only"
              />
              {body}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
