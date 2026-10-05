/**
 * The tiers on `/settings/plan`, the moves between them and the privacy box on
 * the order page (M2/04, M2/05).
 *
 * The page is props only (see `plan-page.test.ts`), so each state is rendered
 * directly, from a NEUTRAL fixture offer: its tier names are placeholders and
 * no real name or price reaches this tier. The view model is pure and is
 * tested on its own.
 *
 *  - tiers present: the free entry first, then every tier as served, the own
 *    tier marked, only an orderable tier carries a radio;
 *  - tiers absent: the page is byte for byte the one-plan page (the control);
 *  - the rank is the array order, and `moveEffectOf` is the whole of the rule
 *    that says "now" or "at the end of the period";
 *  - a subscriber gets a switch button on the other tiers, the yearly plan on
 *    their own monthly tier, and nothing while a payment is overdue;
 *  - `texts.whatHappens` is drawn above the two boxes, with the privacy link
 *    only where legal pages exist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { PlanScreen, readTierParam, type MoveResult, type OrderView } from '../../app/routes/settings.plan';
import { NO_CONSENTS, type OrderMode } from '../../app/components/plans/plan-order';
import {
  NO_OWN_PLAN,
  defaultTierIdOf,
  linkedTierIdOf,
  moveEffectOf,
  offerForTier,
  tiersViewOf,
  type OwnPlan,
  type TiersView,
} from '../../app/lib/plans/tier-view';
import { planStanding } from '../../app/lib/plans/plan-standing';
import {
  planOfferSchema,
  planViewSchema,
  type PlanOffer,
  type PlanView,
  type Tier,
} from '../../app/lib/sync/engine/client/plans-wire';
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

/** A reader on the named tier, on the monthly plan, paid up. */
function onTier(tierId: string, overrides: Partial<OwnPlan> = {}): OwnPlan {
  return { tierId, planKey: 'monthly', isPastDue: false, ...overrides };
}

/** The tiers fixture with its tier list rebuilt by `change`, decoded again the way the page decodes an offer. */
function offerWith(change: (tiers: Tier[]) => Tier[]): PlanOffer {
  return planOfferSchema.parse({ ...fixtureTiers, tiers: change([...(WITH_TIERS.tiers ?? [])]) });
}

function viewOf(offer: PlanOffer, own: OwnPlan = NO_OWN_PLAN): TiersView {
  const view = tiersViewOf({ offer, own });
  assert.ok(view !== null, 'the fixture offer sells tiers');
  return view;
}

function rowOf(view: TiersView, id: string) {
  const row = view.rows.find((candidate) => candidate.id === id);
  assert.ok(row !== undefined, `the view has a row for ${id}`);
  return row;
}

describe('the move effect', () => {
  it('is "now" for a higher rank and "period-end" for the same or a lower one', () => {
    const table: [number, number, string][] = [
      [1, 2, 'now'],
      [1, 3, 'now'],
      [2, 3, 'now'],
      [2, 1, 'period-end'],
      [3, 1, 'period-end'],
      // THE SAME RANK is the one move inside a tier, monthly to yearly.
      [2, 2, 'period-end'],
    ];
    for (const [currentRank, targetRank, expected] of table) {
      assert.equal(moveEffectOf({ currentRank, targetRank }), expected, `${currentRank} to ${targetRank}`);
    }
  });
});

describe('the tiers view model', () => {
  it('lists the entries in the order served, the free one first', () => {
    assert.deepEqual(
      viewOf(WITH_TIERS).rows.map((row) => row.id),
      ['fixture-zero', 'fixture-alpha', 'fixture-beta', 'fixture-gamma'],
    );
    assert.equal(rowOf(viewOf(WITH_TIERS), 'fixture-zero').isFree, true);
    assert.equal(rowOf(viewOf(WITH_TIERS), 'fixture-alpha').isFree, false);
  });

  it('is null for an offer that sells no tiers, which is the one-plan page', () => {
    assert.equal(tiersViewOf({ offer: ONE_PLAN, own: NO_OWN_PLAN }), null);
    // A tier list that does not decode is absent too, never a half-read one.
    const broken = planOfferSchema.parse({ ...fixtureTiers, tiers: [{ id: 'x' }] });
    assert.equal(tiersViewOf({ offer: broken, own: NO_OWN_PLAN }), null);
    assert.ok(broken.plans.length > 0, 'the legacy plans still sell');
  });

  it('marks the free entry current for a reader with no tier, and nobody else', () => {
    assert.deepEqual(
      viewOf(WITH_TIERS).rows.filter((row) => row.isCurrent).map((row) => row.id),
      ['fixture-zero'],
    );
  });

  it('marks the named tier current and not the free entry', () => {
    assert.deepEqual(
      viewOf(WITH_TIERS, onTier('fixture-beta')).rows.filter((row) => row.isCurrent).map((row) => row.id),
      ['fixture-beta'],
    );
  });

  it('marks nothing and offers no move for an id the offer does not list', () => {
    const view = viewOf(WITH_TIERS, onTier('fixture-unknown'));
    assert.deepEqual(view.rows.filter((row) => row.isCurrent), []);
    assert.equal(view.hasOrderableRow, false, 'no rank, so no honest effect to state');
  });

  it('orders every sold tier by every plan for a reader with no subscription, and moves nothing', () => {
    const view = viewOf(WITH_TIERS);
    for (const id of ['fixture-alpha', 'fixture-beta', 'fixture-gamma']) {
      const row = rowOf(view, id);
      assert.equal(row.isOrderable, true, id);
      assert.deepEqual(row.plans.map((plan) => plan.key), ['monthly', 'yearly'], id);
      assert.equal(row.effect, null, `${id}: a first order is a payment, not a move`);
    }
    assert.equal(rowOf(view, 'fixture-zero').isOrderable, false, 'the free entry is never ordered');
    assert.deepEqual(rowOf(view, 'fixture-zero').plans, []);
  });

  it('gives a subscriber "now" for a higher tier and "period-end" for a lower one', () => {
    const view = viewOf(WITH_TIERS, onTier('fixture-beta'));
    assert.equal(rowOf(view, 'fixture-gamma').effect, 'now');
    assert.equal(rowOf(view, 'fixture-alpha').effect, 'period-end');
    // BOTH INTERVALS of another tier can be moved to.
    assert.deepEqual(rowOf(view, 'fixture-gamma').plans.map((plan) => plan.key), ['monthly', 'yearly']);
    assert.equal(rowOf(view, 'fixture-zero').isOrderable, false, 'a subscriber cannot move to the free entry');
  });

  it('offers a monthly subscriber the yearly plan of their own tier, at the end of the period, and nothing else of it', () => {
    const own = rowOf(viewOf(WITH_TIERS, onTier('fixture-beta')), 'fixture-beta');
    assert.equal(own.isCurrent, true);
    assert.equal(own.isOrderable, true);
    assert.deepEqual(own.plans.map((plan) => plan.key), ['yearly']);
    assert.equal(own.effect, 'period-end');
    // THE CONTROLS: a yearly subscriber has nothing to move to on their own tier (the biller refuses it), and neither does a tier without a yearly plan.
    assert.equal(rowOf(viewOf(WITH_TIERS, onTier('fixture-beta', { planKey: 'yearly' })), 'fixture-beta').isOrderable, false);
    const monthlyOnly = offerWith((tiers) =>
      tiers.map((tier) =>
        tier.id === 'fixture-beta' ? Object.assign({}, tier, { plans: tier.plans.filter((plan) => plan.key === 'monthly') }) : tier,
      ),
    );
    assert.equal(rowOf(viewOf(monthlyOnly, onTier('fixture-beta')), 'fixture-beta').isOrderable, false);
  });

  it('offers a subscriber whose payment is overdue no move at all', () => {
    const view = viewOf(WITH_TIERS, onTier('fixture-beta', { isPastDue: true }));
    assert.equal(view.hasOrderableRow, false);
    // THE CONTROL: the same reader, paid up, can move.
    assert.equal(viewOf(WITH_TIERS, onTier('fixture-beta')).hasOrderableRow, true);
  });

  it('keeps the feature words this build knows, in the page order, and drops the rest', () => {
    assert.deepEqual(rowOf(viewOf(WITH_TIERS), 'fixture-gamma').features, ['fasting', 'pantry', 'voice', 'chat']);
  });

  it('offers the picked tier its own plans, and nothing for a row that cannot be ordered', () => {
    const view = viewOf(WITH_TIERS, onTier('fixture-beta'));
    assert.deepEqual(
      offerForTier({ offer: WITH_TIERS, view, tierId: 'fixture-alpha' })?.plans.map((plan) => plan.key),
      ['monthly', 'yearly'],
    );
    assert.deepEqual(
      offerForTier({ offer: WITH_TIERS, view, tierId: 'fixture-beta' })?.plans.map((plan) => plan.key),
      ['yearly'],
    );
    assert.equal(offerForTier({ offer: WITH_TIERS, view, tierId: null }), null);
    assert.equal(offerForTier({ offer: WITH_TIERS, view, tierId: 'fixture-zero' }), null);
  });

  it('starts a first order on the only tier there is, and on none when there is a choice or a move', () => {
    const solo = offerWith((tiers) => tiers.filter((tier) => tier.id !== 'fixture-beta' && tier.id !== 'fixture-gamma'));
    assert.equal(defaultTierIdOf(viewOf(solo)), 'fixture-alpha');
    assert.equal(defaultTierIdOf(viewOf(WITH_TIERS)), null, 'three tiers to choose from');
    assert.equal(defaultTierIdOf(viewOf(solo, onTier('fixture-alpha'))), null, 'a move is always chosen');
  });
});

describe('a tier the pricing page linked', () => {
  it('preselects a tier the offer sells, and no other', () => {
    const view = viewOf(WITH_TIERS);
    assert.equal(linkedTierIdOf({ view, tierId: 'fixture-beta' }), 'fixture-beta');
    assert.equal(linkedTierIdOf({ view, tierId: 'fixture-alpha' }), 'fixture-alpha');
  });

  it('ignores an unknown id, the free entry and a tier that is not on sale', () => {
    assert.equal(linkedTierIdOf({ view: viewOf(WITH_TIERS), tierId: 'no-such-tier' }), null, 'unknown');
    assert.equal(linkedTierIdOf({ view: viewOf(WITH_TIERS), tierId: 'fixture-zero' }), null, 'the free entry');
    const unsold = offerWith((tiers) => tiers.map((tier) => (tier.id === 'fixture-beta' ? { ...tier, isSold: false } : tier)));
    assert.equal(linkedTierIdOf({ view: viewOf(unsold), tierId: 'fixture-beta' }), null, 'not on sale');
    // THE CONTROL: the same offer still preselects a tier that is on sale, so the line above can fail.
    assert.equal(linkedTierIdOf({ view: viewOf(unsold), tierId: 'fixture-gamma' }), 'fixture-gamma');
  });

  it('ignores a tier whose sold entry carries no plan', () => {
    const empty = offerWith((tiers) => tiers.map((tier) => (tier.id === 'fixture-beta' ? { ...tier, plans: [] } : tier)));
    assert.equal(linkedTierIdOf({ view: viewOf(empty), tierId: 'fixture-beta' }), null);
  });

  it('is null when nothing was linked, which leaves the page as it was', () => {
    assert.equal(linkedTierIdOf({ view: viewOf(WITH_TIERS), tierId: null }), null);
    assert.equal(defaultTierIdOf(viewOf(WITH_TIERS)), null);
  });

  it('never preselects for a subscriber, whose moves are chosen', () => {
    assert.equal(linkedTierIdOf({ view: viewOf(WITH_TIERS, onTier('fixture-alpha')), tierId: 'fixture-beta' }), null);
  });

  it('is read from the parameter by shape alone', () => {
    assert.equal(readTierParam('fixture-beta'), 'fixture-beta');
    assert.equal(readTierParam('Fixture-Beta'), null);
    assert.equal(readTierParam(''), null);
    assert.equal(readTierParam(null), null);
  });
});

describe('the offer reads the real biller shape', () => {
  it('keeps the rank order, the sold flag and the plans of each entry', () => {
    const tiers = WITH_TIERS.tiers ?? [];
    assert.deepEqual(tiers.map((tier) => tier.isSold), [false, true, true, true]);
    assert.deepEqual(tiers[0]?.plans, []);
    assert.equal(tiers[3]?.plans[1]?.grossCents, 3499);
  });

  it('reads the privacy lines from texts', () => {
    assert.equal(WITH_TIERS.texts.whatHappens, 'Fixture privacy line one.\n\nFixture privacy line two.');
    assert.equal(ONE_PLAN.texts.whatHappens, undefined);
  });

  it('reads an offer whose legacy plans are empty when a sold tier carries the prices, and refuses one that sells nothing', () => {
    assert.ok(planOfferSchema.safeParse({ ...fixtureTiers, plans: [] }).success);
    // THE CONTROLS: no plans and no tiers, or tiers with nothing priced, is no offer.
    assert.equal(planOfferSchema.safeParse({ ...fixtureOffer, plans: [] }).success, false);
    const unpriced = (WITH_TIERS.tiers ?? []).map((tier) => Object.assign({}, tier, { plans: [] }));
    assert.equal(planOfferSchema.safeParse({ ...fixtureTiers, plans: [], tiers: unpriced }).success, false);
  });

  it('refuses a tier that lists one plan key twice, by dropping the tier list', () => {
    const first = WITH_TIERS.tiers?.[1];
    assert.ok(first !== undefined);
    const twice = Object.assign({}, first, { plans: [...first.plans, ...first.plans.slice(0, 1)] });
    const offer = planOfferSchema.parse({ ...fixtureTiers, tiers: [twice] });
    assert.equal(offer.tiers, undefined);
  });
});

describe('the plan view reads tier', () => {
  const body = { ...NO_PLAN };
  it('keeps a named tier', () => {
    assert.equal(planViewSchema.parse({ ...body, tier: 'fixture-beta' }).tier, 'fixture-beta');
  });
  it('keeps null as null', () => {
    assert.equal(planViewSchema.parse({ ...body, tier: null }).tier, null);
  });
  it('leaves the key absent when the biller sent none', () => {
    assert.equal('tier' in planViewSchema.parse(body), false);
  });
});

const SUBSCRIBED: PlanView = {
  plan: 'active',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: '2026-10-09T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
  tier: 'fixture-beta',
};

interface RenderInput {
  offer: PlanOffer;
  planView?: PlanView;
  pickedTierId?: string | null;
  canPickTier?: boolean;
  hasLegalPages?: boolean;
  withTiers?: boolean;
  moveResult?: MoveResult | null;
  notice?: OrderView['notice'];
}

/** What the page knows about the reader, from the plan view the way the route reads it. */
function ownPlanOf(planView: PlanView): OwnPlan {
  if (planView.planKey === null) return NO_OWN_PLAN;
  return { tierId: planView.tier ?? null, planKey: planView.planKey, isPastDue: planView.plan === 'past_due' };
}

function render({
  offer,
  planView = NO_PLAN,
  pickedTierId = null,
  canPickTier = true,
  hasLegalPages = false,
  withTiers = true,
  moveResult = null,
  notice = 'none',
}: RenderInput): string {
  const state = { kind: 'ready', plan: planView } as const;
  const standing = planStanding({ instance: SELLING, account: null, planView, now: NOW });
  const tiers = withTiers ? tiersViewOf({ offer, own: ownPlanOf(planView) }) : null;
  const orderOffer = tiers === null ? offer : offerForTier({ offer, view: tiers, tierId: pickedTierId });
  const row = tiers?.rows.find((candidate) => candidate.id === pickedTierId);
  const mode: OrderMode = row?.effect ? { kind: 'move', effect: row.effect } : { kind: 'first' };
  const order: OrderView | null =
    orderOffer === null ? null : (
      {
        offer: orderOffer,
        mode,
        selectedPlan: null,
        consents: NO_CONSENTS,
        notice,
        isOrdering: false,
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
          moveResult,
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

  it('lists every entry by the name the biller served', () => {
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

  it('gives a radio to the orderable tiers only, and no switch button to a first order', () => {
    assert.ok((tierCard(markup, 'fixture-alpha') ?? '').includes('type="radio"'));
    assert.ok((tierCard(markup, 'fixture-gamma') ?? '').includes('type="radio"'));
    assert.equal((tierCard(markup, 'fixture-zero') ?? '').includes('type="radio"'), false, 'the free entry');
    assert.equal(markup.includes('data-slot="tier-switch"'), false);
  });

  it('draws no radio and no button for a reader who cannot pick', () => {
    const held = render({ offer: WITH_TIERS, canPickTier: false });
    assert.equal(held.includes('type="radio"'), false);
    assert.equal(render({ offer: WITH_TIERS, planView: SUBSCRIBED, canPickTier: false }).includes('data-slot="tier-switch"'), false);
  });

  it('draws no order block until a tier is picked, and then the picked tier\'s own prices', () => {
    assert.equal(markup.includes('data-slot="plan-order"'), false);
    const picked = render({ offer: WITH_TIERS, pickedTierId: 'fixture-beta' });
    assert.ok(picked.includes('data-slot="plan-order"'));
    assert.ok(picked.includes('Fixture beta monthly term.'));
    assert.equal(picked.includes('Fixture alpha monthly term.'), false);
  });
});

describe('the plan page for a subscriber on a tier', () => {
  const markup = render({ offer: WITH_TIERS, planView: SUBSCRIBED });

  it('marks the own tier and gives every other sold tier a switch button, and the free entry none', () => {
    assert.match(tierCard(markup, 'fixture-beta') ?? '', /data-current="true"/);
    assert.ok((tierCard(markup, 'fixture-alpha') ?? '').includes('data-slot="tier-switch"'));
    assert.ok((tierCard(markup, 'fixture-gamma') ?? '').includes('data-slot="tier-switch"'));
    assert.equal((tierCard(markup, 'fixture-zero') ?? '').includes('data-slot="tier-switch"'), false);
    assert.equal(markup.includes('type="radio"'), false, 'a move is a button, not a radio');
  });

  it('names the target in the button, and the own tier\'s button says it is the yearly plan', () => {
    assert.match(tierCard(markup, 'fixture-gamma') ?? '', /Switch to Fixture Gamma/);
    assert.match(tierCard(markup, 'fixture-beta') ?? '', /Pay yearly instead/);
  });

  it('says before the order when an upgrade takes effect: now, settled pro rata', () => {
    const upgrade = render({ offer: WITH_TIERS, planView: SUBSCRIBED, pickedTierId: 'fixture-gamma' });
    assert.match(upgrade, /data-order-mode="move"/);
    assert.match(upgrade, /takes effect now/);
    assert.match(upgrade, /pro rata/);
    assert.equal(upgrade.includes('end of your paid period'), false);
  });

  it('says before the order when a downgrade takes effect: at the end of the paid period', () => {
    const downgrade = render({ offer: WITH_TIERS, planView: SUBSCRIBED, pickedTierId: 'fixture-alpha' });
    assert.match(downgrade, /end of your paid period/);
    assert.equal(downgrade.includes('takes effect now'), false);
  });

  it('asks the same two consents as a first order, above the same button, and the privacy box above them', () => {
    const move = render({ offer: WITH_TIERS, planView: SUBSCRIBED, pickedTierId: 'fixture-gamma' });
    assert.ok(move.includes('data-slot="plan-consent-terms"'));
    assert.ok(move.includes('data-slot="plan-consent-early-start"'));
    assert.ok(move.indexOf('data-slot="plan-what-happens"') < move.indexOf('data-slot="plan-consent-terms"'));
    assert.ok(move.indexOf('data-slot="plan-consent-early-start"') < move.indexOf('data-slot="plan-order-button"'));
  });

  it('offers the plans of the target tier, and the yearly plan alone on the own tier', () => {
    const other = render({ offer: WITH_TIERS, planView: SUBSCRIBED, pickedTierId: 'fixture-gamma' });
    assert.ok(other.includes('Fixture gamma monthly term.') && other.includes('Fixture gamma yearly term.'));
    const own = render({ offer: WITH_TIERS, planView: SUBSCRIBED, pickedTierId: 'fixture-beta' });
    assert.ok(own.includes('Fixture beta yearly term.'));
    assert.equal(own.includes('Fixture beta monthly term.'), false);
  });

  it('says what the biller answered once the move is done, in the place of the order block', () => {
    const now = render({ offer: WITH_TIERS, planView: SUBSCRIBED, moveResult: { effect: 'now', startsAt: '2026-09-23T12:00:00.000Z' } });
    assert.match(now, /data-slot="plan-move-result"[^>]*data-effect="now"/);
    assert.match(now, /Your plan has changed/);
    const later = render({ offer: WITH_TIERS, planView: SUBSCRIBED, moveResult: { effect: 'period-end', startsAt: '2026-10-09T00:00:00.000Z' } });
    assert.match(later, /Your plan changes on October 9, 2026/);
    // THE CONTROLS: nothing is said with no result, and the order block replaces the line while a tier is picked.
    assert.equal(markup.includes('data-slot="plan-move-result"'), false);
    const picked = render({
      offer: WITH_TIERS,
      planView: SUBSCRIBED,
      pickedTierId: 'fixture-gamma',
      moveResult: { effect: 'now', startsAt: '2026-09-23T12:00:00.000Z' },
    });
    assert.equal(picked.includes('data-slot="plan-move-result"'), false);
  });

  it('shows a refused move in the action line, which has its box from the first paint', () => {
    const refused = render({ offer: WITH_TIERS, planView: SUBSCRIBED, pickedTierId: 'fixture-gamma', notice: 'move-refused' });
    assert.match(refused, /data-slot="plan-action-line" role="alert"[^>]*>This change is not possible right now/);
    const quiet = render({ offer: WITH_TIERS, planView: SUBSCRIBED, pickedTierId: 'fixture-gamma' });
    assert.ok(/data-slot="plan-action-line"[^>]*min-h-10/.test(quiet), 'the line is there with nothing to say');
    assert.equal(quiet.includes('not possible right now'), false);
  });

  it('offers a subscriber whose payment is overdue no switch button', () => {
    const overdue = render({ offer: WITH_TIERS, planView: { ...SUBSCRIBED, plan: 'past_due' } });
    assert.equal(overdue.includes('data-slot="tier-switch"'), false);
  });
});

describe('the plan page with no tiers', () => {
  it('draws no tier list and exactly the one-plan page', () => {
    const plain = render({ offer: ONE_PLAN, withTiers: false });
    assert.equal(plain.includes('data-slot="plan-tiers"'), false);
    assert.ok(plain.includes('data-slot="plan-order"'));
    // The same offer with a tier-less decode of the tiered body draws the same page,
    // so a biller that never learnt tiers cannot tell this build from the old one.
    const stripped = planOfferSchema.parse({ ...fixtureTiers, tiers: undefined });
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
    const texts = { ...fixtureTiers.texts };
    const none = planOfferSchema.parse({ ...fixtureTiers, texts: { ...texts, whatHappens: undefined } });
    assert.equal(render({ offer: none, pickedTierId: 'fixture-alpha' }).includes('data-slot="plan-what-happens"'), false);
    const blank = planOfferSchema.parse({ ...fixtureTiers, texts: { ...texts, whatHappens: '  ' } });
    assert.equal(render({ offer: blank, pickedTierId: 'fixture-alpha' }).includes('data-slot="plan-what-happens"'), false);
  });

  it('is drawn on the one-plan page too, when the biller sent lines', () => {
    const plain = planOfferSchema.parse({ ...fixtureOffer, texts: { ...fixtureOffer.texts, whatHappens: 'Fixture privacy line one.' } });
    assert.ok(render({ offer: plain, withTiers: false }).includes('data-slot="plan-what-happens"'));
    assert.equal(render({ offer: ONE_PLAN, withTiers: false }).includes('data-slot="plan-what-happens"'), false);
  });
});
