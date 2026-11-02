/**
 * THE TIERS, listed as the biller sent them (M2/05, redesigned 2026-11-02).
 *
 * The free entry is a compact strip, and every sold tier is a card: the name, the
 * allowance as the large figure, a true multiple of the free scans, the features
 * that have a screen, the prices with the saving, and one clear press. The name,
 * the description and the prices are the biller's words and figures, drawn as
 * served, and the figures are computed in `tier-view.ts`. What this file writes
 * is chrome. No tier name and no price is in this file.
 *
 * ── A FIRST ORDER PICKS BY RADIO, A SUBSCRIBER SWITCHES BY BUTTON ────────
 *
 * Choosing a tier does not order it. It opens the order block below, which
 * offers that tier's intervals, the order texts and the two consents, exactly
 * as for a single plan. A reader with no plan picks by a radio, for the
 * orderable tiers only: the whole card is its label, and the "Choose" press is a
 * span inside it, so nothing nests one control in another. A SUBSCRIBER
 * (`row.effect` is set) gets a "switch" button on every other tier, and on their
 * own tier when it can move from monthly to yearly; the button reports a pick
 * the same way and names what it does in words. The free entry, and a row nothing
 * can be ordered from, are drawn WITHOUT either, so nothing that cannot be ordered
 * looks like it can.
 *
 * ── A PICK CHANGES COLOUR, NEVER SIZE ────────────────────────────────────
 *
 * Every card is the same box. A neutral card pays for its thinner border in its
 * padding, so it measures what the recommended card's two pixels do, and the
 * press area is a fixed height whatever its words say. Every line that may be
 * empty is reserved (DESIGN.md section 7).
 *
 * ── THE TEAL IS THE ONLY COLOUR ──────────────────────────────────────────
 *
 * The recommended card is the one with a primary border, a filled badge, a filled
 * press and a soft shadow, all from tokens. Every corner is square, and no card
 * has a rule down one side.
 *
 * Props only, apart from `t`, so it renders in a unit test.
 */
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { featureNameKey } from '#app/components/plans/feature-gate';
import { Button, buttonVariants } from '#app/components/ui/button';
import { formatCents } from '#app/lib/plans/plan-prices';
import type { TierRowView } from '#app/lib/plans/tier-view';
import { cn } from '#app/lib/utils';
import type { OfferPlan } from '#app/lib/sync/engine/client/plans-wire';

/** A non-breaking space, so a reserved line keeps one line's height with nothing in it. */
const EMPTY_LINE = ' ';

/**
 * The grid per count of sold tiers. Whole class names, because Tailwind only
 * sees those. One tier keeps the one-plan column, so a lone card is not stretched.
 */
function gridClass(soldCount: number): string {
  if (soldCount >= 3) return 'grid grid-cols-1 gap-4 @3xl:grid-cols-3';
  if (soldCount === 2) return 'grid grid-cols-1 gap-4 @2xl:grid-cols-2';
  return 'mx-auto grid max-w-xl grid-cols-1 gap-4';
}

export interface TierListProps {
  rows: readonly TierRowView[];
  /** The picked tier's id, or `null`. */
  pickedTierId: string | null;
  /** `false` draws the list with no radios and no switch buttons: an order held elsewhere, or a payment being confirmed. */
  canPick: boolean;
  onPick: (tierId: string) => void;
  /**
   * A person pressed a card or a switch, which is what scrolls the order block
   * into view. Not called for an arrow key walking the radios, which must not
   * throw the page around, nor for a pick nobody pressed.
   */
  onReveal?: () => void;
}

/** One sold card's border, fill and shadow. Bordered and tinted when picked, never a left rule. */
function cardClass({
  isPicked,
  isRecommended,
  isClickable,
}: {
  isPicked: boolean;
  isRecommended: boolean;
  isClickable: boolean;
}): string {
  return cn(
    'flex h-full flex-col gap-3 bg-card transition-colors',
    // THE SAME BOX EITHER WAY: one pixel of border less is one pixel of padding more.
    isRecommended ? 'border-2 p-5 shadow-md shadow-primary/20' : 'border p-[21px] shadow-sm',
    isClickable &&
      'cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
    isPicked && 'border-primary bg-primary/5',
    !isPicked && isRecommended && 'border-primary',
    !isPicked && !isRecommended && 'border-border',
    isClickable && !isPicked && !isRecommended && 'hover:border-primary/40',
  );
}

/** A chosen card's press: tinted, not filled, so the order button below is the next thing to press. */
const CHOSEN_PRESS_CLASS = 'border-primary bg-transparent text-primary hover:bg-primary/10 dark:bg-transparent dark:border-primary';

/** The press inside a card: filled on the recommended card, secondary on the rest, tinted once chosen. */
function pressVariant({ isPicked, isRecommended }: { isPicked: boolean; isRecommended: boolean }) {
  if (isPicked) return 'outline' as const;
  return isRecommended ? ('default' as const) : ('secondary' as const);
}

/** The words after the large figure. */
function scanFigureKey(period: TierRowView['aiLimitPeriod']): string {
  return period === 'week' ? 'plan.tiers.scanFigure.week' : 'plan.tiers.scanFigure.day';
}

/** The allowance: the large figure over its unit, and the multiple of the free scans. */
function ScanFigure({ row, isAccented }: { row: TierRowView; isAccented: boolean }) {
  const { t, i18n } = useTranslation();
  const multiple =
    row.scanMultiple === null ?
      null
    : new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { maximumFractionDigits: 1 }).format(row.scanMultiple);
  return (
    <span className="block">
      <span data-slot="tier-limit" className="block">
        {row.aiLimit === null ?
          EMPTY_LINE
        : row.aiLimit === 0 ?
          <span className="block text-sm">{t('plan.tiers.noScans')}</span>
        : <>
            <span
              data-slot="tier-figure"
              className={cn('block text-5xl font-semibold leading-none tabular-nums', isAccented && 'text-primary')}
            >
              {row.aiLimit}
            </span>
            <span className="mt-1 block text-sm font-medium first-letter:uppercase">{t(scanFigureKey(row.aiLimitPeriod), { count: row.aiLimit })}</span>
          </>
        }
      </span>
      <span
        data-slot="tier-multiple"
        className={cn('block min-h-5 text-sm text-muted-foreground', multiple === null && 'invisible')}
      >
        {multiple === null ? EMPTY_LINE : t('plan.tiers.multiple', { multiple })}
      </span>
    </span>
  );
}

/** The features that have a screen, as a checklist. Spans and no list, because a label holds phrasing content only. */
function FeatureList({ row }: { row: TierRowView }) {
  const { t } = useTranslation();
  if (row.features.length === 0) return null;
  return (
    <span data-slot="tier-features" className="block space-y-1">
      {row.features.map((feature) => (
        <span key={feature} data-slot="tier-feature" data-feature={feature} className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="block first-letter:uppercase">{t(featureNameKey(feature))}</span>
        </span>
      ))}
    </span>
  );
}

/** One plan's price: large for the first, smaller under it. What a year works out to is the order block's line. */
function PriceLine({ plan, isLead }: { plan: OfferPlan; isLead: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return (
    <span
      data-slot="tier-price"
      data-plan-key={plan.key}
      className={cn('block tabular-nums', isLead ? 'text-2xl font-semibold' : 'text-sm')}
    >
      {t(plan.interval === 'year' ? 'plan.tiers.pricePerYear' : 'plan.tiers.pricePerMonth', {
        price: formatCents({ cents: plan.grossCents, currency: plan.currency, locale }),
      })}
    </span>
  );
}

/** The card above its press: the same lines for every sold tier. */
function CardBody({ row, nameId, isPicked }: { row: TierRowView; nameId: string; isPicked: boolean }) {
  const { t } = useTranslation();
  const [leadPlan, ...otherPlans] = row.prices;
  return (
    <>
      <span className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span id={nameId} data-slot="tier-name" className="text-lg font-semibold">
          {row.name}
        </span>
        {row.isRecommended && (
          <span data-slot="tier-recommended" className="bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            {t('plan.tiers.recommended')}
          </span>
        )}
        <span data-slot="tier-current" className={cn('text-xs font-medium text-primary', !row.isCurrent && 'hidden')}>
          {row.isCurrent ? t('plan.tiers.current') : EMPTY_LINE}
        </span>
      </span>
      {/* THE TEAL FIGURE IS WHERE THE EYE SHOULD LAND: the recommended card, or the
          one the person chose. Three teal figures would highlight nothing. */}
      <ScanFigure row={row} isAccented={row.isRecommended || isPicked} />
      <span data-slot="tier-description" className="block text-sm text-muted-foreground">
        {row.description}
      </span>
      <FeatureList row={row} />
      <span className="mt-auto block space-y-0.5 pt-1">
        {leadPlan !== undefined && <PriceLine plan={leadPlan} isLead />}
        {otherPlans.map((plan) => (
          <PriceLine key={plan.key} plan={plan} isLead={false} />
        ))}
        <span
          data-slot="tier-saving"
          className={cn('block min-h-5 text-sm font-medium text-primary', row.yearlySaving === null && 'invisible')}
        >
          {row.yearlySaving === null ? EMPTY_LINE : t('plan.tiers.saving', { percent: row.yearlySaving })}
        </span>
      </span>
    </>
  );
}

/** The free entry: a strip, not a card equal to the paid ones, and never a press. */
function FreeStrip({ row }: { row: TierRowView }) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="plan-tier"
      data-tier-id={row.id}
      data-current={row.isCurrent ? 'true' : 'false'}
      data-kind="free"
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border bg-muted/40 px-4 py-3"
    >
      <span data-slot="tier-name" className="text-sm font-semibold">
        {row.name}
      </span>
      <span data-slot="tier-current" className={cn('text-xs font-medium text-primary', !row.isCurrent && 'hidden')}>
        {row.isCurrent ? t('plan.tiers.current') : EMPTY_LINE}
      </span>
      <span data-slot="tier-limit" className="text-sm tabular-nums">
        {row.aiLimit === null ?
          null
        : row.aiLimit === 0 ?
          t('plan.tiers.noScans')
        : t(row.aiLimitPeriod === 'week' ? 'plan.tiers.weeklyLimit' : 'plan.tiers.dailyLimit', { count: row.aiLimit })}
      </span>
      <span data-slot="tier-description" className="w-full text-sm text-muted-foreground @2xl:w-auto @2xl:flex-1">
        {row.description}
      </span>
    </div>
  );
}

export function TierList({ rows, pickedTierId, canPick, onPick, onReveal }: TierListProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const freeRows = rows.filter((row) => row.isFree);
  const soldRows = rows.filter((row) => !row.isFree);
  // AN ARROW KEY WALKING THE RADIOS must not throw the page around. The browser
  // clicks the next radio during the key's press, so that click is told apart by
  // the key still being down. A pointer's press and the space bar are presses, and
  // pressing the card already chosen scrolls too, though it changes nothing.
  const isKeyWalking = useRef(false);

  return (
    <fieldset data-slot="plan-tiers" className="@container space-y-3">
      <legend className="text-base font-semibold">{t('plan.tiers.legend')}</legend>
      <div className="space-y-4 pt-2">
        {freeRows.map((row) => (
          <FreeStrip key={row.id} row={row} />
        ))}
        <div data-slot="plan-tier-grid" className={gridClass(soldRows.length)}>
          {soldRows.map((row) => {
            const isPickable = canPick && row.isOrderable;
            const isPicked = isPickable && row.id === pickedTierId;
            const nameId = `${baseId}-${row.id}-name`;
            const rowProps = {
              'data-slot': 'plan-tier',
              'data-tier-id': row.id,
              'data-current': row.isCurrent ? 'true' : 'false',
              'data-recommended': row.isRecommended ? 'true' : 'false',
              'data-picked': isPicked ? 'true' : 'false',
            } as const;
            const look = { isPicked, isRecommended: row.isRecommended };
            if (!isPickable) {
              return (
                <div key={row.id} {...rowProps} className={cardClass({ ...look, isClickable: false })}>
                  <CardBody row={row} nameId={nameId} isPicked={isPicked} />
                </div>
              );
            }
            // A SUBSCRIBER'S MOVE: a button, which says in words what it does.
            if (row.effect !== null) {
              return (
                <div key={row.id} {...rowProps} className={cardClass({ ...look, isClickable: false })}>
                  <CardBody row={row} nameId={nameId} isPicked={isPicked} />
                  <Button
                    type="button"
                    data-slot="tier-switch"
                    aria-pressed={isPicked}
                    variant={pressVariant(look)}
                    className={cn('h-11 w-full whitespace-normal md:h-11', isPicked && CHOSEN_PRESS_CLASS)}
                    onClick={() => {
                      onPick(row.id);
                      onReveal?.();
                    }}
                  >
                    {isPicked && <Check aria-hidden="true" />}
                    {row.isCurrent ? t('plan.tiers.switchYearly') : t('plan.tiers.switchTo', { name: row.name })}
                  </Button>
                </div>
              );
            }
            return (
              <label key={row.id} {...rowProps} className={cardClass({ ...look, isClickable: true })}>
                <input
                  type="radio"
                  name="tier"
                  value={row.id}
                  checked={isPicked}
                  onChange={() => onPick(row.id)}
                  onKeyDown={(event) => {
                    isKeyWalking.current = event.key.startsWith('Arrow');
                  }}
                  onKeyUp={() => {
                    isKeyWalking.current = false;
                  }}
                  onClick={() => {
                    if (!isKeyWalking.current) onReveal?.();
                  }}
                  aria-labelledby={nameId}
                  className="sr-only"
                />
                <CardBody row={row} nameId={nameId} isPicked={isPicked} />
                <span
                  data-slot="tier-cta"
                  aria-hidden="true"
                  className={buttonVariants({
                    variant: pressVariant(look),
                    className: cn('h-11 w-full whitespace-normal md:h-11', isPicked && CHOSEN_PRESS_CLASS),
                  })}
                >
                  {isPicked && <Check className="size-4" aria-hidden="true" />}
                  {isPicked ? t('plan.tiers.chosen', { name: row.name }) : t('plan.tiers.choose', { name: row.name })}
                </span>
              </label>
            );
          })}
        </div>
        {soldRows.some((row) => row.prices.length > 0) && (
          <p data-slot="plan-vat-note" className="text-sm text-muted-foreground">
            {t('plan.vatNote')}
          </p>
        )}
      </div>
    </fieldset>
  );
}
