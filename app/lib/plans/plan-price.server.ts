/**
 * THE TWO FIGURES SECTION 4a OF THE TERMS CARRIES, read from this deployment's
 * own environment and from nowhere else.
 *
 * ## Why they are not in a bundle, and not in this repository
 *
 * `terms.s4aPaymentPrice` and `terms.s4aPaymentTrial` state what a reader will
 * be charged, and how long they may try the thing for free. Both are the
 * operator's facts: the price lives in the biller's price object, the trial
 * length in the account the biller creates. A literal typed here would be a
 * legally operative sentence invented by a program, and it would go on being
 * printed after the real price moved. So a value arrives as `PLAN_PRICE_EUR`
 * or `PLAN_TRIAL_DAYS`, and an instance that sets neither draws neither
 * sentence. See `TermsContentProps`.
 *
 * ## Why the environment is read once, at module scope
 *
 * A malformed value is an operator's mistake, and the only useful moment to
 * say so is the boot. Parsing per request would turn `PLAN_PRICE_EUR=4,99`
 * into a page that silently omits the price for the life of the deployment,
 * which reads exactly like "the owner has not supplied one yet". Unset is
 * `null`. SET AND MALFORMED THROWS, naming the variable.
 *
 * ## Why `.server`
 *
 * `process.env` at module scope. The terms route imports this from its loader
 * only, so the client bundle never contains it. A `.server` import that leaks
 * into a component fails the production client build and nothing before it.
 *
 * The two parsers and the formatter are pure and exported, so
 * `tests/unit/plan-price.test.ts` drives every branch without touching the
 * real environment.
 */
import { z } from 'zod';

/**
 * A gross monthly price as an operator types it: euros, a dot, exactly two
 * decimal places. `4,99` (the German spelling), `4.9` and `abc` are all
 * refused rather than rounded or reinterpreted, because each of them means the
 * operator believes they typed a price and did not.
 */
const PRICE_PATTERN = /^\d+\.\d{2}$/;

/** A whole number of days, one or more. `0` is not a trial, and `-1` is a typo. */
const TRIAL_DAYS_PATTERN = /^[1-9]\d*$/;

const priceSchema = z.string().regex(PRICE_PATTERN);
const trialDaysSchema = z.string().regex(TRIAL_DAYS_PATTERN);

/**
 * The environment this module reads, named rather than taken as a dictionary,
 * so a test hands over exactly the two variables under test.
 */
export interface PlanPriceEnv {
  PLAN_PRICE_EUR?: string | undefined;
  PLAN_TRIAL_DAYS?: string | undefined;
}

/**
 * What this deployment may state about money.
 *
 * `null` on either field means the matching sentence is not drawn. It never
 * means zero, and it is never a placeholder for something downstream to fill
 * in.
 */
export interface PlanPricing {
  readonly priceEur: number | null;
  readonly trialDays: number | null;
}

/** The raw value with its whitespace gone, or `null` when the operator said nothing. */
function readOptional(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * @throws an `Error` naming `PLAN_PRICE_EUR` when the value is set and is not
 * a decimal with two places.
 */
export function parsePlanPriceEur(raw: string | undefined): number | null {
  const value = readOptional(raw);
  if (value === null) return null;
  const parsed = priceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`PLAN_PRICE_EUR must be a decimal with two places, for example 1.00. Got ${JSON.stringify(raw)}`);
  }
  return Number(parsed.data);
}

/**
 * @throws an `Error` naming `PLAN_TRIAL_DAYS` when the value is set and is not
 * a whole number of days above zero.
 */
export function parsePlanTrialDays(raw: string | undefined): number | null {
  const value = readOptional(raw);
  if (value === null) return null;
  const parsed = trialDaysSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`PLAN_TRIAL_DAYS must be a whole number of days above zero. Got ${JSON.stringify(raw)}`);
  }
  return Number(parsed.data);
}

/** Both variables, parsed together and frozen. Pure: the caller supplies the environment. */
export function parsePlanPricing(env: PlanPriceEnv): PlanPricing {
  return Object.freeze({
    priceEur: parsePlanPriceEur(env.PLAN_PRICE_EUR),
    trialDays: parsePlanTrialDays(env.PLAN_TRIAL_DAYS),
  });
}

/**
 * The price as a reader of THIS request's language sees it: `de` gives the
 * comma and a trailing euro sign, `en` gives a leading one.
 *
 * `Intl.NumberFormat` rather than a template, because the decimal separator,
 * the position of the symbol and the space in front of it all differ by
 * locale, and the Preisangabenverordnung expects a total price a German
 * consumer can read as one.
 */
export function formatPlanPrice(priceEur: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(priceEur);
}

/** This deployment's answer, parsed once. See the header for why a bad value throws here. */
export const PLAN_PRICING: PlanPricing = parsePlanPricing({
  PLAN_PRICE_EUR: process.env.PLAN_PRICE_EUR,
  PLAN_TRIAL_DAYS: process.env.PLAN_TRIAL_DAYS,
});
