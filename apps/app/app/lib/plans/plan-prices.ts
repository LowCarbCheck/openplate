/**
 * THE FIGURES A PLAN CARD SHOWS, derived from the offer and from nothing else
 * (M250/02).
 *
 * The biller sends the gross price of each plan and no marketing numbers. The
 * monthly equivalent of the yearly plan and what it saves against paying
 * monthly are arithmetic on those prices, done here once, so no card, no
 * compact strip and no order page can round them differently.
 *
 * ── ROUNDING NEVER FLATTERS ──────────────────────────────────────────────
 *
 * The saving is rounded DOWN to a whole percent: 4000 against 12 x 500 is
 * 33.3 percent and reads 33, never 34. The monthly equivalent is rounded to
 * the nearest cent, because it describes a price rather than a promise, and
 * 4000 / 12 is 333.33 cents either way. A saving that rounds to zero, or a
 * yearly plan that costs more than twelve months, draws no saving line at all.
 *
 * ── NO PRICE LIVES HERE ──────────────────────────────────────────────────
 *
 * Every number below is an argument. Nothing in this module knows what a
 * plan costs.
 */
import type { OfferPlan, PlanInterval, PlanKey } from '#app/lib/sync/engine/client/plans-wire';

/** Months in a year, the one constant the arithmetic needs. */
const MONTHS_PER_YEAR = 12;

/** Minor units in one major unit. `grossCents` is cents by contract, so this is 100 for every currency it names. */
const CENTS_PER_UNIT = 100;

/** What one plan card draws, every figure already formatted in the reader's language. */
export interface PlanCardFigures {
  key: PlanKey;
  interval: PlanInterval;
  /** The gross price per billing interval, for example "€40.00". */
  price: string;
  /** What the plan costs per month, for a plan billed yearly. `null` for a monthly plan. */
  monthlyEquivalent: string | null;
  /** The saving against twelve monthly payments, for example "33%". `null` when there is none to state. */
  saving: string | null;
  /** The biller's own sentence about how the plan runs, drawn verbatim. */
  term: string;
}

/** A gross amount in the reader's language, from cents. */
export function formatCents({ cents, currency, locale }: { cents: number; currency: string; locale: string }): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / CENTS_PER_UNIT);
}

/** The monthly equivalent of a yearly price, to the nearest cent. `null` for a plan billed monthly. */
export function monthlyEquivalentCents(plan: Pick<OfferPlan, 'interval' | 'grossCents'>): number | null {
  if (plan.interval !== 'year') return null;
  return Math.round(plan.grossCents / MONTHS_PER_YEAR);
}

/**
 * What a yearly plan saves against twelve monthly payments, in whole percent,
 * rounded down.
 *
 * `null` when there is nothing true to say: no monthly plan to compare with, a
 * different currency, or no saving at all.
 */
export function yearlySavingPercent({
  yearly,
  monthly,
}: {
  yearly: Pick<OfferPlan, 'grossCents' | 'currency'>;
  monthly: Pick<OfferPlan, 'grossCents' | 'currency'> | null;
}): number | null {
  if (monthly === null || monthly.currency !== yearly.currency) return null;
  const twelveMonths = monthly.grossCents * MONTHS_PER_YEAR;
  // Integer arithmetic before the division, so 4000 against 6000 is exactly
  // 33 and never 33.99999 or 34 by floating point.
  const percent = Math.floor(((twelveMonths - yearly.grossCents) * 100) / twelveMonths);
  return percent > 0 ? percent : null;
}

/** Every card's figures, in the order the biller sent the plans. */
export function planCardFigures({ plans, locale }: { plans: readonly OfferPlan[]; locale: string }): PlanCardFigures[] {
  const monthly = plans.find((plan) => plan.interval === 'month') ?? null;
  return plans.map((plan) => {
    const equivalent = monthlyEquivalentCents(plan);
    const savingPercent = plan.interval === 'year' ? yearlySavingPercent({ yearly: plan, monthly }) : null;
    return {
      key: plan.key,
      interval: plan.interval,
      price: formatCents({ cents: plan.grossCents, currency: plan.currency, locale }),
      monthlyEquivalent:
        equivalent === null ? null : formatCents({ cents: equivalent, currency: plan.currency, locale }),
      saving:
        savingPercent === null ? null : (
          new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(savingPercent / 100)
        ),
      term: plan.term,
    };
  });
}

/**
 * The lowest a plan costs per month, for the compact offer's "from" line
 * (M250/04), formatted in the reader's language.
 *
 * A monthly plan costs its price; a yearly plan costs its monthly
 * equivalent, the SAME figure its card states (`monthlyEquivalentCents`), so
 * the compact line and the card it links to never disagree by a cent.
 *
 * `null` when there is nothing true to say: no plans, or plans in more than
 * one currency, where "from" would compare euros with something else.
 */
export function lowestMonthlyPrice({ plans, locale }: { plans: readonly OfferPlan[]; locale: string }): string | null {
  const [first] = plans;
  if (first === undefined) return null;
  if (plans.some((plan) => plan.currency !== first.currency)) return null;
  const perMonth = plans.map((plan) => monthlyEquivalentCents(plan) ?? plan.grossCents);
  return formatCents({ cents: Math.min(...perMonth), currency: first.currency, locale });
}
