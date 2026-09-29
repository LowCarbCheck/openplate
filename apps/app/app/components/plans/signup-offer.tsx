/**
 * WHAT A NEW ACCOUNT GETS, AND WHAT COMES AFTER (2026-09-28).
 *
 * The owner's model for the managed instance: ten free AI scans with no card,
 * then a paid plan. `/sign-up` and the logged-out landing both say so, in up
 * to three lines:
 *
 * 1. the free scans, counted from the handshake (`instance.trial.scans`) and
 *    never from a string, and since M267 the days beside them, "10 free AI
 *    scans or 14 days, whichever comes first", from `instance.trial.days`.
 *    With no day limit the sentence is exactly the one it was before;
 * 2. the price after them, from the anonymous price read, formatted with
 *    `Intl.NumberFormat` in the reader's language, or the sentence with no
 *    price when the read failed. With a day limit it says "after that", not
 *    "when they are used up", because the days may end the free tier first;
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
  /**
   * The days after which the free tier ends anyway, from the handshake, or
   * `null` where the instance promises no day limit (M267). REQUIRED AND
   * NULLABLE, so every caller says which.
   */
  trialDays: number | null;
  /** The price read. `idle` draws no price line at all: the instance sells no plans. */
  prices: PublicPricesRead;
  /** The plan chosen before sign-up, or `null`. Drawn only where a price line is. */
  chosenPlan: PlanKey | null;
  /** `sm` on the sign-up form, `xs` under the landing's buttons, the size of the small print there. */
  size: 'sm' | 'xs';
}

/**
 * The two price sentences for one offer: "when they are used up" where the
 * scans alone end the free tier, "after that" where the days may end it first.
 */
const PRICE_KEYS = {
  scansOnly: { prices: 'signupOffer.prices', noPrices: 'signupOffer.noPrices' },
  withDayLimit: { prices: 'signupOffer.pricesAfter', noPrices: 'signupOffer.noPricesAfter' },
} as const;

/** The widest price sentence this line may need, for the reserve. */
function useSizingSentence(pricesKey: string): string {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const figure = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: SIZING_CURRENCY,
    currencyDisplay: 'code',
  }).format(SIZING_FIGURE_CENTS / 100);
  return t(pricesKey, { monthly: figure, yearly: figure });
}

/** The price line: the reserve, the sentence without a price, and the prices once they are known. */
function PriceLine({
  prices,
  hasDayLimit,
}: {
  prices: Exclude<PublicPricesRead, { kind: 'idle' }>;
  hasDayLimit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const keys = hasDayLimit ? PRICE_KEYS.withDayLimit : PRICE_KEYS.scansOnly;
  const sizing = useSizingSentence(keys.prices);
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
        {t(keys.noPrices)}
      </span>
      {prices.kind === 'ready' && (
        <span data-slot="signup-offer-prices">
          {t(keys.prices, {
            monthly: formatCents({ cents: prices.prices.monthlyCents, currency: prices.prices.currency, locale }),
            yearly: formatCents({ cents: prices.prices.yearlyCents, currency: prices.prices.currency, locale }),
          })}
        </span>
      )}
    </p>
  );
}

export function SignupOffer({ trialScans, trialDays, prices, chosenPlan, size }: SignupOfferProps) {
  const { t } = useTranslation();
  const hasDayLimit = trialDays !== null;
  return (
    <div data-slot="signup-offer" className={cn('space-y-1', size === 'sm' ? 'text-sm' : 'text-xs')}>
      <p data-slot="signup-offer-scans" className="font-medium text-foreground">
        {trialDays === null ?
          t('signupOffer.scans', { count: trialScans })
        : t('signupOffer.scansOrDays', {
            count: trialScans,
            days: t('signupOffer.days', { count: trialDays }),
          })
        }
      </p>
      {prices.kind !== 'idle' && <PriceLine prices={prices} hasDayLimit={hasDayLimit} />}
      {prices.kind !== 'idle' && chosenPlan !== null && (
        <p data-slot="signup-offer-chosen" className="text-muted-foreground">
          {t(CHOSEN_KEY[chosenPlan])}
        </p>
      )}
    </div>
  );
}
