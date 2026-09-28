/**
 * The figures on a plan card, derived from the offer's gross prices (M250/02).
 *
 * The saving is rounded DOWN, so every rounding case below is paired with the
 * value just across it: a function that rounded to nearest would pass the
 * exact 33 percent case and fail its neighbour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCents,
  lowestMonthlyPrice,
  monthlyEquivalentCents,
  planCardFigures,
  yearlySavingPercent,
} from '../../app/lib/plans/plan-prices';
import { planOfferSchema } from '../../app/lib/sync/engine/client/plans-wire';
import fixtureOffer from '../fixtures/plan-offer.json';

const OFFER = planOfferSchema.parse(fixtureOffer);
const MONTHLY = { grossCents: 500, currency: 'EUR' };

describe('the saving against twelve monthly payments', () => {
  it('is 33 percent for 4000 against 12 x 500, the README example', () => {
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 4000, currency: 'EUR' }, monthly: MONTHLY }), 33);
  });

  it('rounds down, never up, so the page never states more than is saved', () => {
    // 4030 against 6000 is 32.83 percent. Nearest would say 33.
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 4030, currency: 'EUR' }, monthly: MONTHLY }), 32);
    // 3990 against 6000 is 33.5 percent. Nearest would say 34.
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 3990, currency: 'EUR' }, monthly: MONTHLY }), 33);
  });

  it('says nothing when there is nothing true to say', () => {
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 6000, currency: 'EUR' }, monthly: MONTHLY }), null);
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 7000, currency: 'EUR' }, monthly: MONTHLY }), null);
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 5990, currency: 'EUR' }, monthly: MONTHLY }), null);
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 4000, currency: 'USD' }, monthly: MONTHLY }), null);
    assert.equal(yearlySavingPercent({ yearly: { grossCents: 4000, currency: 'EUR' }, monthly: null }), null);
  });
});

describe('the monthly equivalent', () => {
  it('divides a yearly price by twelve, to the nearest cent', () => {
    assert.equal(monthlyEquivalentCents({ interval: 'year', grossCents: 4000 }), 333);
    assert.equal(monthlyEquivalentCents({ interval: 'year', grossCents: 4010 }), 334);
  });

  it('is not drawn for a plan that already bills monthly', () => {
    assert.equal(monthlyEquivalentCents({ interval: 'month', grossCents: 500 }), null);
  });
});

describe('the formatted card figures', () => {
  it('formats in the reader language, from cents', () => {
    assert.equal(formatCents({ cents: 4000, currency: 'EUR', locale: 'en' }), '€40.00');
    // THE CONTROL: the same amount in German moves the symbol and the separator.
    assert.equal(formatCents({ cents: 4000, currency: 'EUR', locale: 'de' }).replaceAll('\u00a0', ' '), '40,00 €');
  });

  it('gives the yearly card its equivalent and saving, and the monthly card neither', () => {
    const [monthly, yearly] = planCardFigures({ plans: OFFER.plans, locale: 'en' });
    assert.deepEqual(monthly, {
      key: 'monthly',
      interval: 'month',
      price: '€5.00',
      monthlyEquivalent: null,
      saving: null,
      term: 'Fixture term text for the monthly plan.',
    });
    assert.deepEqual(yearly, {
      key: 'yearly',
      interval: 'year',
      price: '€40.00',
      monthlyEquivalent: '€3.33',
      saving: '33%',
      term: 'Fixture term text for the yearly plan.',
    });
  });

  it('keeps the order the biller sent', () => {
    const reversed = planCardFigures({ plans: OFFER.plans.toReversed(), locale: 'en' });
    assert.deepEqual(
      reversed.map((card) => card.key),
      ['yearly', 'monthly'],
    );
    assert.equal(reversed[0]?.saving, '33%');
  });
});

describe('the lowest a plan costs per month, for the compact offer (M250/04)', () => {
  it("is the yearly plan's monthly equivalent when that is the lower, the same figure its card states", () => {
    const [, yearly] = planCardFigures({ plans: OFFER.plans, locale: 'en' });
    assert.equal(lowestMonthlyPrice({ plans: OFFER.plans, locale: 'en' }), yearly?.monthlyEquivalent);
    assert.equal(lowestMonthlyPrice({ plans: OFFER.plans, locale: 'en' }), '€3.33');
  });

  it('is the monthly price when the yearly plan works out dearer per month', () => {
    // 7200 a year is 6.00 a month, above the 5.00 monthly plan.
    const plans = OFFER.plans.map((plan) =>
      plan.interval === 'year' ? Object.assign(structuredClone(plan), { grossCents: 7200 }) : plan,
    );
    assert.equal(lowestMonthlyPrice({ plans, locale: 'en' }), '€5.00');
  });

  it('says nothing for no plans, or for plans in two currencies', () => {
    assert.equal(lowestMonthlyPrice({ plans: [], locale: 'en' }), null);
    const mixed = OFFER.plans.map((plan) =>
      plan.interval === 'year' ? Object.assign(structuredClone(plan), { currency: 'CHF' }) : plan,
    );
    assert.equal(lowestMonthlyPrice({ plans: mixed, locale: 'en' }), null);
  });
});
