/**
 * WHAT A NEW ACCOUNT GETS, AND WHAT COMES AFTER (2026-09-28).
 *
 * The owner's model for the managed instance: ten free AI scans with no card,
 * then a paid plan. `/sign-up` and the logged-out landing both say so, in up
 * to three lines:
 *
 * 1. the free scans, counted from the handshake (`instance.trial.scans`) and
 *    never from a string;
 * 2. the price after them, from the anonymous price read, formatted with
 *    `Intl.NumberFormat` in the reader's language, or the sentence with no
 *    price when the read failed;
 * 3. on `/sign-up` only, the plan the person chose on the pricing page.
 *
 * ── THE PRICE LINE HAS ITS BOX BEFORE THE PRICE ARRIVES ──────────────────
 *
 * The price read answers after the page is drawn, and the line under it must
 * not move (DESIGN.md section 7). So the line is one grid cell holding every
 * sentence it can say: the price sentence with a sizing figure, always
 * invisible, the sentence without a price, invisible unless it is the answer,
 * and the real price sentence once it is known. The cell is as tall as the
 * tallest of them from the first paint. The sizing figure is wider than any
 * real price in the same format, so the real sentence never needs more room
 * than the reserve took.
 *
 * ── NO PRICE LIVES HERE ──────────────────────────────────────────────────
 *
 * The sizing figure is a width, never shown and never read aloud; the prices
 * arrive as data. This repository is public and names no price.
 *
 * Props only, apart from `t`, so every state renders in a unit test.
 */
import { useTranslation } from 'react-i18next';

import type { PublicPricesRead } from '#app/hooks/use-public-plan-prices';
import { formatCents } from '#app/lib/plans/plan-prices';
import type { PlanKey } from '#app/lib/sync/engine/client/plans-wire';
import { cn } from '#app/lib/utils';

/**
 * NOT A PRICE: the widest figure the price line reserves room for, in minor
 * units. Four digits before the decimal mark in every format this app ships,
 * drawn invisibly with the currency's three-letter code, which is wider than
 * any currency symbol.
 */
const SIZING_FIGURE_CENTS = 999_999;

/** The currency the sizing figure is formatted in. Its code, not its symbol, is drawn. */
const SIZING_CURRENCY = 'EUR';

/** The sentence for each chosen plan. A `Record`, so a third plan fails to compile here. */
const CHOSEN_KEY = {
  monthly: 'signupOffer.chosenMonthly',
  yearly: 'signupOffer.chosenYearly',
} satisfies Record<PlanKey, string>;

export interface SignupOfferProps {
  /** The free scans a new account starts with, from the handshake. */
  trialScans: number;
  /** The price read. `idle` draws no price line at all: the instance sells no plans. */
  prices: PublicPricesRead;
  /** The plan chosen before sign-up, or `null`. Drawn only where a price line is. */
  chosenPlan: PlanKey | null;
  /** `sm` on the sign-up form, `xs` under the landing's buttons, the size of the small print there. */
  size: 'sm' | 'xs';
}

/** The widest price sentence this line may need, for the reserve. */
function useSizingSentence(): string {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const figure = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: SIZING_CURRENCY,
    currencyDisplay: 'code',
  }).format(SIZING_FIGURE_CENTS / 100);
  return t('signupOffer.prices', { monthly: figure, yearly: figure });
}

/** The price line: the reserve, the sentence without a price, and the prices once they are known. */
function PriceLine({ prices }: { prices: Exclude<PublicPricesRead, { kind: 'idle' }> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const sizing = useSizingSentence();
  const isUnavailable = prices.kind === 'unavailable';
  return (
    <p data-slot="signup-offer-price-line" className="grid text-muted-foreground [&>*]:col-start-1 [&>*]:row-start-1">
      <span aria-hidden="true" className="invisible">
        {sizing}
      </span>
      <span
        data-slot="signup-offer-no-prices"
        aria-hidden={isUnavailable ? undefined : true}
        className={cn(!isUnavailable && 'invisible')}
      >
        {t('signupOffer.noPrices')}
      </span>
      {prices.kind === 'ready' && (
        <span data-slot="signup-offer-prices">
          {t('signupOffer.prices', {
            monthly: formatCents({ cents: prices.prices.monthlyCents, currency: prices.prices.currency, locale }),
            yearly: formatCents({ cents: prices.prices.yearlyCents, currency: prices.prices.currency, locale }),
          })}
        </span>
      )}
    </p>
  );
}

export function SignupOffer({ trialScans, prices, chosenPlan, size }: SignupOfferProps) {
  const { t } = useTranslation();
  return (
    <div data-slot="signup-offer" className={cn('space-y-1', size === 'sm' ? 'text-sm' : 'text-xs')}>
      <p data-slot="signup-offer-scans" className="font-medium text-foreground">
        {t('signupOffer.scans', { count: trialScans })}
      </p>
      {prices.kind !== 'idle' && <PriceLine prices={prices} />}
      {prices.kind !== 'idle' && chosenPlan !== null && (
        <p data-slot="signup-offer-chosen" className="text-muted-foreground">
          {t(CHOSEN_KEY[chosenPlan])}
        </p>
      )}
    </div>
  );
}
