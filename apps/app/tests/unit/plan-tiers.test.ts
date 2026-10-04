/**
 * The tiers on `/settings/plan` and the privacy box on the order page (M2/05).
 *
 * The page is props only (see `plan-page.test.ts`), so each state is rendered
 * directly, from a NEUTRAL fixture offer: its tier names are placeholders and
 * no real name or price reaches this tier. The view model is pure and is
 * tested on its own.
 *
 *  - tiers present: every tier is listed as served, the own tier is marked,
 *    only an orderable tier carries a radio;
 *  - tiers absent: the page is byte for byte the one-plan page (the control);
 *  - a tier not on sale is listed and never orderable;
 *  - `currentTier` decides who is marked, and the free entry is current when no
 *    tier is named;
 *  - `whatHappens` is drawn above the two boxes, with the privacy link only
 *    where legal pages exist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { PlanScreen, type OrderView } from '../../app/routes/settings.plan';
import { NO_CONSENTS } from '../../app/components/plans/plan-order';
import { offerForTier, tiersViewOf, type TiersView } from '../../app/lib/plans/tier-view';
import { planStanding } from '../../app/lib/plans/plan-standing';
import { planOfferSchema, planViewSchema, type PlanOffer, type PlanView } from '../../app/lib/sync/engine/client/plans-wire';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';
import fixtureOffer from '../fixtures/plan-offer.json';
import fixtureTiers from '../fixtures/plan-offer-tiers.json';

const SELLING: InstanceDescriptor = {
  name: 'Example',
  language: 'de',
  mail: true,
  memberInvites: true,
  plans: true,
  ai: { model: 'fake/vision-1' },
};
const NOW = new Date('2026-09-23T12:00:00.000Z');

const ONE_PLAN: PlanOffer = planOfferSchema.parse(fixtureOffer);
const WITH_TIERS: PlanOffer = planOfferSchema.parse(fixtureTiers);

const NO_PLAN: PlanView = {
  plan: 'none',
  planKey: null,
  interval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  portalAvailable: false,
};

function viewOf(offer: PlanOffer, currentTier: string | null = null): TiersView {
  const view = tiersViewOf({ offer, currentTier });
  assert.ok(view !== null, 'the fixture offer sells tiers');
  return view;
}

describe('the tiers view model', () => {
  it('lists the free entry first and then every tier in the order served', () => {
    assert.deepEqual(
      viewOf(WITH_TIERS).rows.map((row) => row.id),
      ['fixture-zero', 'fixture-alpha', 'fixture-beta', 'fixture-gamma'],
    );
  });

  it('is null for an offer that sells no tiers, which is the one-plan page', () => {
    assert.equal(tiersViewOf({ offer: ONE_PLAN, currentTier: null }), null);
    // A tier list that does not decode is absent too, never a half-read one.
    const broken = planOfferSchema.parse({ ...fixtureTiers, tiers: [{ id: 'x' }] });
    assert.equal(tiersViewOf({ offer: broken, currentTier: null }), null);
    assert.ok(broken.plans.length > 0, 'the legacy plans still sell');
  });

  it('marks the free entry current when no tier is named, and nobody else', () => {
    const rows = viewOf(WITH_TIERS, null).rows;
    assert.deepEqual(
      rows.filter((row) => row.isCurrent).map((row) => row.id),
      ['fixture-zero'],
    );
  });

  it('marks the named tier current and not the free entry', () => {
    const rows = viewOf(WITH_TIERS, 'fixture-beta').rows;
    assert.deepEqual(
      rows.filter((row) => row.isCurrent).map((row) => row.id),
      ['fixture-beta'],
    );
  });

  it('marks nothing for an id the offer does not list', () => {
    assert.deepEqual(viewOf(WITH_TIERS, 'fixture-unknown').rows.filter((row) => row.isCurrent), []);
  });

  it('orders only a tier that is on sale, priced, not current and not free', () => {
    const byId = new Map(viewOf(WITH_TIERS, 'fixture-beta').rows.map((row) => [row.id, row]));
    assert.equal(byId.get('fixture-alpha')?.isOrderable, true);
    assert.equal(byId.get('fixture-beta')?.isOrderable, false, 'the own tier');
    assert.equal(byId.get('fixture-gamma')?.isOrderable, false, 'not on sale');
    assert.equal(byId.get('fixture-gamma')?.isClosedToOrders, true);
    assert.equal(byId.get('fixture-zero')?.isOrderable, false, 'the free entry');
    // THE CONTROL: with no tier named, the same on-sale tier is orderable.
    assert.equal(viewOf(WITH_TIERS, null).rows.find((row) => row.id === 'fixture-beta')?.isOrderable, true);
  });

  it('keeps the feature words this build knows, in the page order, and drops the rest', () => {
    const gamma = viewOf(WITH_TIERS).rows.find((row) => row.id === 'fixture-gamma');
    assert.deepEqual(gamma?.features, ['fasting', 'pantry', 'voice', 'chat']);
  });

  it('offers the picked tier its own prices, and nothing for a tier that cannot be ordered', () => {
    const view = viewOf(WITH_TIERS, 'fixture-beta');
    const alpha = offerForTier({ offer: WITH_TIERS, view, tierId: 'fixture-alpha' });
    assert.deepEqual(alpha?.plans.map((plan) => plan.key), ['monthly', 'yearly']);
    assert.equal(offerForTier({ offer: WITH_TIERS, view, tierId: null }), null);
    assert.equal(offerForTier({ offer: WITH_TIERS, view, tierId: 'fixture-gamma' }), null);
    assert.equal(offerForTier({ offer: WITH_TIERS, view, tierId: 'fixture-beta' }), null);
  });
});

describe('the plan view reads currentTier', () => {
  const body = { ...NO_PLAN };
  it('keeps a named tier', () => {
    assert.equal(planViewSchema.parse({ ...body, currentTier: 'fixture-beta' }).currentTier, 'fixture-beta');
  });
  it('keeps null as null', () => {
    assert.equal(planViewSchema.parse({ ...body, currentTier: null }).currentTier, null);
  });
  it('leaves the key absent when the biller sent none', () => {
    assert.equal('currentTier' in planViewSchema.parse(body), false);
  });
});

interface RenderInput {
  offer: PlanOffer;
  currentTier?: string | null;
  pickedTierId?: string | null;
  canPickTier?: boolean;
  hasLegalPages?: boolean;
  withTiers?: boolean;
}

function render({ offer, currentTier = null, pickedTierId = null, canPickTier = true, hasLegalPages = false, withTiers = true }: RenderInput): string {
  const state = { kind: 'ready', plan: NO_PLAN } as const;
  const standing = planStanding({ instance: SELLING, account: null, planView: NO_PLAN, now: NOW });
  const tiers = withTiers ? tiersViewOf({ offer, currentTier }) : null;
  const orderOffer = tiers === null ? offer : offerForTier({ offer, view: tiers, tierId: pickedTierId });
  const order: OrderView | null =
    orderOffer === null ? null : (
      {
        offer: orderOffer,
        mode: { kind: 'first' },
        selectedPlan: null,
        consents: NO_CONSENTS,
        notice: 'none',
        isOrdering: false,
        whatHappens: orderOffer.whatHappens,
        hasLegalPages,
      }
    );
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      withI18n(
        createElement(PlanScreen, {
          state,
          standing,
          order,
          isOrderLoading: false,
          isOfferUnavailable: false,
          busy: 'none',
          checkoutReturn: 'none',
          portalFailed: false,
          orderYearlyHref: null,
          switchStartsAt: null,
          isAlreadySubscribed: false,
          recapMealCount: null,
          paywallNotice: null,
          offersFreeScansFirst: false,
          paymentConfirmation: 'checking',
          afterPaymentDoor: 'diary',
          tiers,
          pickedTierId,
          canPickTier,
          onPickTier: () => undefined,
          onCheckAgain: () => undefined,
          onSelectPlan: () => undefined,
          onConsentChange: () => undefined,
          onOrder: () => undefined,
          onManage: () => undefined,
        }),
      ),
    ),
  );
}

/** The markup of one tier card, or `null`. */
function tierCard(markup: string, id: string): string | null {
  const start = markup.indexOf(`data-tier-id="${id}"`);
  if (start < 0) return null;
  const next = markup.indexOf('data-slot="plan-tier"', start + 10);
  return markup.slice(start, next < 0 ? undefined : next);
}

describe('the plan page with tiers', () => {
  const markup = render({ offer: WITH_TIERS });

  it('lists every tier by the name the biller served', () => {
    for (const name of ['Fixture Zero', 'Fixture Alpha', 'Fixture Beta', 'Fixture Gamma']) {
      assert.ok(markup.includes(name), name);
    }
    assert.ok(markup.includes('Fixture description beta.'));
  });

  it('draws the served prices for each interval, from the cents', () => {
    const alpha = tierCard(markup, 'fixture-alpha') ?? '';
    assert.equal([...alpha.matchAll(/data-slot="tier-price"/g)].length, 2);
    assert.match(alpha, /2\.99/);
    assert.match(alpha, /14\.99/);
  });

  it('gives a radio to the orderable tiers only', () => {
    assert.ok((tierCard(markup, 'fixture-alpha') ?? '').includes('type="radio"'));
    assert.ok((tierCard(markup, 'fixture-beta') ?? '').includes('type="radio"'));
    assert.equal((tierCard(markup, 'fixture-gamma') ?? '').includes('type="radio"'), false, 'not on sale');
    assert.equal((tierCard(markup, 'fixture-zero') ?? '').includes('type="radio"'), false, 'the free entry');
  });

  it('marks the own tier and gives it no radio', () => {
    const own = render({ offer: WITH_TIERS, currentTier: 'fixture-beta' });
    const card = tierCard(own, 'fixture-beta') ?? '';
    assert.match(card, /data-current="true"/);
    assert.equal(card.includes('type="radio"'), false);
    // THE CONTROL: the same card with no tier named is neither marked nor without its radio.
    const other = tierCard(markup, 'fixture-beta') ?? '';
    assert.match(other, /data-current="false"/);
    assert.ok(other.includes('type="radio"'));
  });

  it('draws no radio at all for a reader who cannot pick, such as a subscriber', () => {
    assert.equal(render({ offer: WITH_TIERS, currentTier: 'fixture-beta', canPickTier: false }).includes('type="radio"'), false);
  });

  it('draws no order block until a tier is picked, and then the picked tier\'s own prices', () => {
    assert.equal(markup.includes('data-slot="plan-order"'), false);
    const picked = render({ offer: WITH_TIERS, pickedTierId: 'fixture-beta' });
    assert.ok(picked.includes('data-slot="plan-order"'));
    assert.ok(picked.includes('Fixture beta monthly term.'));
    assert.equal(picked.includes('Fixture alpha monthly term.'), false);
  });
});

describe('the plan page with no tiers', () => {
  it('draws no tier list and exactly the one-plan page', () => {
    const plain = render({ offer: ONE_PLAN, withTiers: false });
    assert.equal(plain.includes('data-slot="plan-tiers"'), false);
    assert.ok(plain.includes('data-slot="plan-order"'));
    // The same offer with a tier-less decode of the tiered body draws the same page,
    // so a biller that never learnt tiers cannot tell this build from the old one.
    const stripped = planOfferSchema.parse({ ...fixtureTiers, tiers: undefined, free: undefined, whatHappens: undefined });
    assert.equal(render({ offer: stripped }), render({ offer: stripped, withTiers: false }));
  });
});

describe('the privacy box on the order page', () => {
  const picked = { offer: WITH_TIERS, pickedTierId: 'fixture-alpha' };

  it('sits above the two consent boxes', () => {
    const markup = render(picked);
    const box = markup.indexOf('data-slot="plan-what-happens"');
    assert.ok(box > 0, 'the box is drawn');
    assert.ok(box < markup.indexOf('data-slot="plan-consent-terms"'), 'above the terms box');
    assert.ok(box < markup.indexOf('data-slot="plan-consent-early-start"'), 'above the early start box');
    assert.ok(markup.includes('Fixture privacy line one.'));
    assert.ok(markup.includes('Fixture privacy line two.'));
  });

  it('links the privacy notice only where legal pages exist', () => {
    assert.ok(/data-slot="plan-what-happens".*href="\/privacy"/s.test(render({ ...picked, hasLegalPages: true })));
    // THE CONTROL: the same render with no legal pages draws the box and no link.
    const without = render({ ...picked, hasLegalPages: false });
    assert.ok(without.includes('data-slot="plan-what-happens"'));
    const box = without.slice(without.indexOf('data-slot="plan-what-happens"'), without.indexOf('data-slot="plan-consent-terms"'));
    assert.equal(box.includes('href="/privacy"'), false);
  });

  it('draws no box when the biller sent no lines', () => {
    const none = planOfferSchema.parse({ ...fixtureTiers, whatHappens: undefined });
    assert.equal(render({ offer: none, pickedTierId: 'fixture-alpha' }).includes('data-slot="plan-what-happens"'), false);
    assert.equal(render({ offer: planOfferSchema.parse({ ...fixtureTiers, whatHappens: '  ' }), pickedTierId: 'fixture-alpha' }).includes('data-slot="plan-what-happens"'), false);
  });

  it('is drawn on the one-plan page too, when the biller sent lines', () => {
    const plain = planOfferSchema.parse({ ...fixtureOffer, whatHappens: 'Fixture privacy line one.' });
    assert.ok(render({ offer: plain, withTiers: false }).includes('data-slot="plan-what-happens"'));
    assert.equal(render({ offer: ONE_PLAN, withTiers: false }).includes('data-slot="plan-what-happens"'), false);
  });
});
