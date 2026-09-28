/**
 * `PlanChoice`, the offer's plans as one radio group (M250/02).
 *
 * Rendered statically, so what is asserted is markup: which radio is checked,
 * which line is drawn and which is only reserved, and what a screen reader is
 * told each radio is called. Figures are read from `planCardFigures` rather
 * than typed, and copy from the shipped catalog, so a rephrase is not a failure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { PlanChoice } from '../../app/components/plans/plan-choice';
import { planCardFigures } from '../../app/lib/plans/plan-prices';
import { planOfferSchema, type PlanKey } from '../../app/lib/sync/engine/client/plans-wire';
import fixtureOffer from '../fixtures/plan-offer.json';
import enCommon from '../../app/i18n/locales/en/common.json';

const OFFER = planOfferSchema.parse(fixtureOffer);
const [MONTHLY_CARD, YEARLY_CARD] = planCardFigures({ plans: OFFER.plans, locale: 'en' });

function render(selectedKey: PlanKey | null): string {
  return renderToStaticMarkup(
    withI18n(createElement(PlanChoice, { plans: OFFER.plans, selectedKey, onSelect: () => undefined })),
  );
}

/** The markup of one card, found by its plan key. */
function card(markup: string, key: PlanKey): string {
  const start = markup.indexOf(`data-plan-key="${key}"`);
  assert.ok(start >= 0, `no card for ${key}`);
  const end = markup.indexOf('</label>', start);
  return markup.slice(start, end);
}

/** The class list of the element carrying a `data-slot`, inside one card. */
function slotClass(cardMarkup: string, slot: string): string {
  const match = new RegExp(`data-slot="${slot}" class="([^"]*)"`).exec(cardMarkup);
  assert.ok(match !== null, `no ${slot} in the card`);
  return match[1] ?? '';
}

describe('the plan cards', () => {
  it('draws one radio per plan in one group, and picks none for the person', () => {
    const markup = render(null);
    assert.equal([...markup.matchAll(/type="radio"/g)].length, 2);
    assert.equal([...markup.matchAll(/name="plan"/g)].length, 2);
    assert.equal(markup.includes('<fieldset'), true);
    assert.equal(markup.includes('checked=""'), false);
  });

  it('checks exactly the plan the caller names', () => {
    // THE CONTROL for "picks none": the same render with a key checks one.
    const markup = render('yearly');
    assert.equal([...markup.matchAll(/checked=""/g)].length, 1);
    assert.match(card(markup, 'yearly'), /checked=""/);
    assert.doesNotMatch(card(markup, 'monthly'), /checked=""/);
  });

  it('shows the monthly equivalent and the saving on the yearly card', () => {
    assert.ok(YEARLY_CARD?.monthlyEquivalent && YEARLY_CARD.saving);
    const yearly = card(render(null), 'yearly');
    assert.ok(
      yearly.includes(enCommon.plan.choice.monthlyEquivalent.replace('{{price}}', YEARLY_CARD.monthlyEquivalent)),
    );
    assert.ok(yearly.includes(enCommon.plan.choice.saving.replace('{{saving}}', YEARLY_CARD.saving)));
    assert.doesNotMatch(slotClass(yearly, 'plan-saving'), /\binvisible\b/);
    assert.doesNotMatch(slotClass(yearly, 'plan-monthly-equivalent'), /\binvisible\b/);
  });

  it('reserves the same two lines on the monthly card, invisible and empty', () => {
    // So the cards line up and a pick never changes a height.
    const monthly = card(render(null), 'monthly');
    assert.match(slotClass(monthly, 'plan-saving'), /\binvisible\b/);
    assert.match(slotClass(monthly, 'plan-monthly-equivalent'), /\binvisible\b/);
    assert.equal(monthly.includes('%'), false);
  });

  it('draws each price and each served term verbatim', () => {
    const markup = render(null);
    assert.ok(MONTHLY_CARD && YEARLY_CARD);
    assert.ok(markup.includes(enCommon.plan.choice.pricePerMonth.replace('{{price}}', MONTHLY_CARD.price)));
    assert.ok(markup.includes(enCommon.plan.choice.pricePerYear.replace('{{price}}', YEARLY_CARD.price)));
    for (const plan of OFFER.plans) assert.ok(markup.includes(plan.term), plan.term);
  });

  it('names each radio by its interval, price and term, and describes it by the rest', () => {
    const yearly = card(render(null), 'yearly');
    const labelled = /aria-labelledby="([^"]*)"/.exec(yearly)?.[1]?.split(' ') ?? [];
    assert.deepEqual(
      labelled.map((id) => id.split('-').at(-1)),
      ['name', 'price', 'term'],
    );
    const described = /aria-describedby="([^"]*)"/.exec(yearly)?.[1]?.split(' ') ?? [];
    assert.deepEqual(
      described.map((id) => id.split('-').at(-1)),
      ['equivalent', 'saving'],
    );
    // THE CONTROL: the monthly card has nothing to describe it by.
    assert.doesNotMatch(card(render(null), 'monthly'), /aria-describedby/);
  });

  it('draws no radius but the circle of the radio mark', () => {
    const markup = render('monthly');
    const radii = [...markup.matchAll(/\brounded(-[a-z0-9[\]]+)?\b/g)].map((match) => match[0]);
    assert.ok(radii.length > 0);
    assert.deepEqual([...new Set(radii)], ['rounded-full']);
  });
});
