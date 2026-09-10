/**
 * `#app/lib/plans/plan-price.server` (M214 spec 02).
 *
 * Two figures no part of this repository is allowed to invent, and one
 * formatter that has to produce a price a German consumer reads as a price.
 * What the tests below guard, in order:
 *
 *  - the formatter really is locale-aware. The German form and the English
 *    form are asserted separately AND against each other, because a formatter
 *    that ignored its locale argument would satisfy either assertion alone by
 *    accident. That comparison is the control case.
 *  - a malformed value is REFUSED rather than read as "unset". Silently
 *    returning `null` for `PLAN_PRICE_EUR=4,99` would leave the terms page
 *    looking exactly like an instance whose owner has supplied nothing, for
 *    the life of the deployment.
 *  - unset really is `null`, which is the self-host default and the state in
 *    which section 4a draws neither sentence.
 *
 * The price used here is deliberately not a price anybody charges: the real
 * figure lives in the operator's environment, and a plausible one written into
 * a test is the first step to a plausible one written into the app.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPlanPrice,
  parsePlanPriceEur,
  parsePlanPricing,
  parsePlanTrialDays,
} from '../../app/lib/plans/plan-price.server';

/** Not a price anyone charges. See the file header. */
const SAMPLE_PRICE_EUR = 12.34;

/** `Intl` puts a non-breaking (or narrow non-breaking) space in front of the German symbol. */
function withPlainSpaces(value: string): string {
  return value.replaceAll(/[\u00a0\u202f]/g, ' ');
}

describe('formatPlanPrice', () => {
  it('writes the German form: comma, then the symbol after the number', () => {
    assert.equal(withPlainSpaces(formatPlanPrice(SAMPLE_PRICE_EUR, 'de-DE')), '12,34 €');
  });

  it('writes the English form: the symbol first, then a dot', () => {
    assert.equal(withPlainSpaces(formatPlanPrice(SAMPLE_PRICE_EUR, 'en')), '€12.34');
  });

  it('THE CONTROL: the two locales really do differ, so neither assertion above can pass by accident', () => {
    assert.notEqual(formatPlanPrice(SAMPLE_PRICE_EUR, 'de-DE'), formatPlanPrice(SAMPLE_PRICE_EUR, 'en'));
  });

  it('formats the bare `de` the app actually uses the same way as `de-DE`', () => {
    // `LanguageCode` is `en` | `de`, so the loader passes `de`, never `de-DE`.
    assert.equal(formatPlanPrice(SAMPLE_PRICE_EUR, 'de'), formatPlanPrice(SAMPLE_PRICE_EUR, 'de-DE'));
  });
});

describe('parsePlanPriceEur', () => {
  it('reads a decimal with two places', () => {
    assert.equal(parsePlanPriceEur('12.34'), SAMPLE_PRICE_EUR);
  });

  it('refuses the German spelling with a comma, naming the variable', () => {
    assert.throws(() => parsePlanPriceEur('12,34'), /PLAN_PRICE_EUR/);
  });

  it('refuses something that is not a number at all', () => {
    assert.throws(() => parsePlanPriceEur('abc'), /PLAN_PRICE_EUR/);
  });

  it('refuses one decimal place, which is a typo and not a price', () => {
    assert.throws(() => parsePlanPriceEur('12.3'), /PLAN_PRICE_EUR/);
  });

  it('reads unset, empty and whitespace as "the owner said nothing"', () => {
    assert.equal(parsePlanPriceEur(undefined), null);
    assert.equal(parsePlanPriceEur(''), null);
    assert.equal(parsePlanPriceEur('   '), null);
  });
});

describe('parsePlanTrialDays', () => {
  it('reads a whole number of days', () => {
    assert.equal(parsePlanTrialDays('3'), 3);
  });

  it('refuses zero days, which is not a trial', () => {
    assert.throws(() => parsePlanTrialDays('0'), /PLAN_TRIAL_DAYS/);
  });

  it('refuses a negative number', () => {
    assert.throws(() => parsePlanTrialDays('-1'), /PLAN_TRIAL_DAYS/);
  });

  it('refuses a value that is not a number', () => {
    assert.throws(() => parsePlanTrialDays('x'), /PLAN_TRIAL_DAYS/);
  });

  it('reads unset and empty as "the owner said nothing"', () => {
    assert.equal(parsePlanTrialDays(undefined), null);
    assert.equal(parsePlanTrialDays(''), null);
  });
});

describe('parsePlanPricing', () => {
  it('an empty environment is two nulls, which is the self-host default', () => {
    assert.deepEqual(parsePlanPricing({}), { priceEur: null, trialDays: null });
  });

  it('the two variables are independent: one set, the other not', () => {
    assert.deepEqual(parsePlanPricing({ PLAN_PRICE_EUR: '12.34' }), { priceEur: SAMPLE_PRICE_EUR, trialDays: null });
    assert.deepEqual(parsePlanPricing({ PLAN_TRIAL_DAYS: '3' }), { priceEur: null, trialDays: 3 });
  });

  it('is frozen, so no caller can rewrite the price after it was parsed', () => {
    const pricing = parsePlanPricing({ PLAN_PRICE_EUR: '12.34', PLAN_TRIAL_DAYS: '3' });
    assert.ok(Object.isFrozen(pricing));
  });
});
