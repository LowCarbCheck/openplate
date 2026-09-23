/**
 * `/settings/plan`, every state of it, the order page included (M245/04).
 *
 * ── Why the screen is props only ─────────────────────────────────────────
 *
 * There is no DOM test library in this repository, so a state reachable only
 * by clicking is a state nothing checks. `PlanScreen` therefore takes the read
 * state, the order, the busy press, the return marker and the handlers as
 * props, and every state below is rendered directly.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 *  - the order page draws every order text the offer serves and none of its
 *    own; the button carries the served label, is the last element of the
 *    order block, and is held (the `disabled` ATTRIBUTE, never a class
 *    variant) until a plan is picked and both boxes are ticked;
 *  - both boxes start unticked;
 *  - a monthly subscriber's order shows the yearly plan alone and the switch
 *    note with the date; everybody else's shows the payment note;
 *  - the manage button appears where the biller holds a customer, and not
 *    where it does not;
 *  - a cancelled period end reads as the day access STOPS.
 *
 * No assertion pins a translated sentence. Wordsmith owns the wording, so
 * claims are read out of the shipped catalog, and order texts out of the
 * neutral fixture offer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import {
  ORDER_YEARLY_HREF,
  PlanScreen,
  readCheckoutReturn,
  readPlanParam,
  switchStartFor,
  type OrderView,
  type PlanAction,
  type PlanReadState,
} from '../../app/routes/settings.plan';
import { NO_CONSENTS, type ConsentState, type OrderMode, type OrderNotice } from '../../app/components/plans/plan-order';
import {
  DATE_SLOT,
  TERMS_SLOT,
  planOfferSchema,
  type PlanKey,
  type PlanOffer,
  type PlanView,
} from '../../app/lib/sync/engine/client/plans-wire';
import fixtureOffer from '../fixtures/plan-offer.json';
import { planStanding } from '../../app/lib/plans/plan-standing';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';
import enCommon from '../../app/i18n/locales/en/common.json';

/** An instance whose handshake says a biller stands behind it. */
const SELLING: InstanceDescriptor = {
  name: 'Example',
  language: 'de',
  mail: true,
  memberInvites: true,
  plans: true,
  ai: { model: 'fake/vision-1' },
};

/** The clock every render reads, before the fixture period ends. */
const NOW = new Date('2026-09-23T12:00:00.000Z');

const OFFER: PlanOffer = planOfferSchema.parse(fixtureOffer);

const PAID: PlanView = {
  plan: 'active',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: '2026-10-09T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

/** Somebody the biller holds no subscription for. */
const FREE: PlanView = { ...PAID, plan: 'none', planKey: null, interval: null, portalAvailable: false };

/** A subscription that is over, from somebody the biller still holds a customer for. */
const LAPSED: PlanView = { ...PAID, plan: 'canceled', currentPeriodEnd: '2026-08-09T00:00:00.000Z' };

/** A yearly subscription that renews into the monthly plan. */
const YEARLY: PlanView = { ...PAID, planKey: 'yearly', interval: 'year', currentPeriodEnd: '2027-03-15T10:00:00.000Z' };

const BOTH: ConsentState = { terms: true, earlyStart: true };

interface RenderOverrides {
  busy?: PlanAction;
  checkoutReturn?: 'none' | 'success' | 'cancelled';
  portalFailed?: boolean;
  /** `null` draws no order block. Defaults to the fixture offer for anybody without a live plan. */
  offer?: PlanOffer | null;
  selectedPlan?: PlanKey | null;
  consents?: ConsentState;
  notice?: OrderNotice;
  mode?: OrderMode;
  isOfferUnavailable?: boolean;
  orderYearlyHref?: string | null;
  switchStartsAt?: string | null;
  isAlreadySubscribed?: boolean;
  recapMealCount?: number | null;
}

function render(state: PlanReadState, overrides: RenderOverrides = {}): string {
  const standing = planStanding({
    instance: SELLING,
    account: null,
    planView: state.kind === 'ready' ? state.plan : null,
    now: NOW,
  });
  const mode = overrides.mode ?? { kind: 'first' };
  const wantsOrder = state.kind === 'ready' && (standing.kind !== 'subscribed' || mode.kind === 'switch');
  const offer = overrides.offer === undefined ? OFFER : overrides.offer;
  const order: OrderView | null =
    wantsOrder && offer !== null ?
      {
        offer,
        mode,
        selectedPlan: overrides.selectedPlan ?? null,
        consents: overrides.consents ?? NO_CONSENTS,
        notice: overrides.notice ?? 'none',
        isOrdering: overrides.busy === 'order',
      }
    : null;
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
          isOfferUnavailable: overrides.isOfferUnavailable ?? false,
          busy: overrides.busy ?? 'none',
          checkoutReturn: overrides.checkoutReturn ?? 'none',
          portalFailed: overrides.portalFailed ?? false,
          orderYearlyHref: overrides.orderYearlyHref ?? null,
          switchStartsAt: overrides.switchStartsAt ?? null,
          isAlreadySubscribed: overrides.isAlreadySubscribed ?? false,
          recapMealCount: overrides.recapMealCount ?? null,
          onSelectPlan: () => undefined,
          onConsentChange: () => undefined,
          onOrder: () => undefined,
          onManage: () => undefined,
        }),
      ),
    ),
  );
}

/** The number of `<button>` elements a render drew. "No button" is asserted as zero, never as a missing word. */
function buttonCount(markup: string): number {
  return [...markup.matchAll(/<button/g)].length;
}

/** The order button's own markup, or `null` when the render drew none. */
function orderButton(markup: string): string | null {
  return /<button[^>]*data-slot="plan-order-button"[^>]*>(?:(?!<\/button>).)*<\/button>/s.exec(markup)?.[0] ?? null;
}

/** Whether the order button carries the `disabled` ATTRIBUTE, not a `disabled:` class variant. */
function isOrderDisabled(markup: string): boolean {
  const button = orderButton(markup);
  assert.ok(button !== null, 'no order button');
  return /^<button[^>]*\sdisabled=""/.test(button);
}

/** The part of a catalog sentence before its date, so a rephrase does not fail and a swapped branch does. */
function lead(sentence: string): string {
  return sentence.split('{{date}}')[0] ?? '';
}

/** The same thing for a served sentence with a single brace slot. */
function servedLead(sentence: string, slot: string): string {
  return sentence.split(slot)[0] ?? '';
}

/** React escapes an apostrophe in text; the catalog does not. */
function asMarkup(text: string): string {
  return text.replaceAll("'", '&#x27;');
}

describe('the plan page', () => {
  it('draws the order and the manage button for a lapsed account the biller holds a customer for', () => {
    const markup = render({ kind: 'ready', plan: LAPSED });
    assert.equal(buttonCount(markup), 2);
    assert.ok(orderButton(markup) !== null);
    assert.ok(markup.includes(enCommon.plan.manage));
  });

  it('draws no manage button when there is nothing to manage', () => {
    // THE CONTROL for the case above. The biller answers a machine coded 404
    // for an account with no customer row, so the button would have exactly
    // one outcome, and it is a failure.
    const markup = render({ kind: 'ready', plan: { ...LAPSED, portalAvailable: false } });
    assert.equal(buttonCount(markup), 1);
    assert.equal(markup.includes(enCommon.plan.manage), false);
  });

  it('reads a cancelled period end as the day access stops', () => {
    const cancelled = render({ kind: 'ready', plan: { ...PAID, cancelAtPeriodEnd: true } });
    const renewing = render({ kind: 'ready', plan: PAID });
    // Both name the same date, and they say opposite things about it.
    assert.ok(cancelled.includes(lead(enCommon.plan.endsOn)));
    assert.ok(renewing.includes(lead(enCommon.plan.renewsOn)));
    assert.notEqual(cancelled, renewing);
  });

  it('names no date at all when the biller sent none', () => {
    const markup = render({ kind: 'ready', plan: { ...FREE, currentPeriodEnd: null } });
    assert.equal(markup.includes(lead(enCommon.plan.renewsOn)), false);
    assert.equal(markup.includes(lead(enCommon.plan.endsOn)), false);
  });

  it('offers no button in any state where pressing one could not work', () => {
    // Signed out, a door shut under an open tab, and a failed read. All three
    // are sentences, not dead controls.
    for (const state of [{ kind: 'signed-out' }, { kind: 'absent' }, { kind: 'failed' }] satisfies PlanReadState[]) {
      assert.equal(buttonCount(render(state)), 0, `${state.kind} drew a button`);
    }
  });

  it('says what happened when somebody comes back from the payment page', () => {
    assert.ok(render({ kind: 'ready', plan: PAID }, { checkoutReturn: 'success' }).includes(enCommon.plan.returned.success));
    assert.ok(
      render({ kind: 'ready', plan: PAID }, { checkoutReturn: 'cancelled' }).includes(enCommon.plan.returned.cancelled),
    );
    // THE CONTROL: an ordinary visit says neither.
    const plain = render({ kind: 'ready', plan: PAID });
    assert.equal(plain.includes(enCommon.plan.returned.success), false);
    assert.equal(plain.includes(enCommon.plan.returned.cancelled), false);
  });

  it('shows a failed portal press without losing the button', () => {
    const markup = render({ kind: 'ready', plan: LAPSED }, { portalFailed: true });
    assert.ok(markup.includes(enCommon.plan.actionFailed));
    assert.ok(markup.includes(enCommon.plan.manage), 'a failed press left nothing to try again with');
    // THE CONTROL: the line keeps its box, invisible, when nothing failed.
    const quiet = render({ kind: 'ready', plan: LAPSED });
    assert.equal(quiet.includes(enCommon.plan.actionFailed), false);
    assert.equal([...quiet.matchAll(/data-slot="plan-portal-line"/g)].length, 1);
  });

  it('decodes only the two return values the biller sends', () => {
    assert.equal(readCheckoutReturn('success'), 'success');
    assert.equal(readCheckoutReturn('cancelled'), 'cancelled');
    // Transcribed from `checkoutReturnUrls`, which spells it `cancelled`.
    assert.equal(readCheckoutReturn('canceled'), 'none');
    assert.equal(readCheckoutReturn(null), 'none');
  });
});

describe('the order page', () => {
  it('draws every order text the offer serves, and the button carries the served label', () => {
    const markup = render({ kind: 'ready', plan: FREE });
    for (const text of [
      OFFER.texts.heading,
      ...OFFER.texts.summary,
      OFFER.texts.withdrawal,
      OFFER.texts.earlyStartConsent,
      OFFER.texts.paymentNote,
      servedLead(OFFER.texts.termsConsent, TERMS_SLOT),
    ]) {
      assert.ok(markup.includes(asMarkup(text)), `the order page lost: ${text}`);
    }
    assert.ok(orderButton(markup)?.includes(OFFER.texts.button));
    // The slot is REPLACED, never drawn.
    assert.equal(markup.includes(TERMS_SLOT), false);
  });

  it('links the terms from inside the consent and the withdrawal page beside its notice', () => {
    const markup = render({ kind: 'ready', plan: FREE });
    assert.match(markup, new RegExp(`<a[^>]*href="${OFFER.links.terms}"[^>]*>${enCommon.chrome.terms}</a>`));
    assert.match(
      markup,
      new RegExp(`<a[^>]*href="${OFFER.links.withdrawal}"[^>]*>${enCommon.plan.order.withdrawalLink}</a>`),
    );
  });

  it('starts with both boxes unticked', () => {
    const markup = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly' });
    const boxes = [...markup.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((match) => match[0]);
    assert.equal(boxes.length, 2);
    for (const box of boxes) assert.equal(box.includes('checked'), false, `a box was ticked: ${box}`);
    // THE CONTROL: a ticked box does carry the attribute this reads.
    const ticked = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly', consents: BOTH });
    assert.equal([...ticked.matchAll(/<input[^>]*type="checkbox"[^>]*checked=""/g)].length, 2);
  });

  it('holds the button until a plan is picked and both boxes are ticked, and says why', () => {
    const unpicked = render({ kind: 'ready', plan: FREE }, { consents: BOTH });
    assert.equal(isOrderDisabled(unpicked), true);
    assert.ok(unpicked.includes(enCommon.plan.choice.pickFirst));

    for (const consents of [NO_CONSENTS, { terms: true, earlyStart: false }, { terms: false, earlyStart: true }]) {
      const markup = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly', consents });
      assert.equal(isOrderDisabled(markup), true, `enabled with ${JSON.stringify(consents)}`);
      assert.ok(markup.includes(enCommon.plan.order.confirmFirst));
    }

    // THE CONTROL: a pick and both boxes enable it, and the line says nothing.
    const ready = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly', consents: BOTH });
    assert.equal(isOrderDisabled(ready), false);
    assert.equal(ready.includes(enCommon.plan.order.confirmFirst), false);
    assert.equal(ready.includes(enCommon.plan.choice.pickFirst), false);
  });

  it('holds the button while the order is in flight', () => {
    const markup = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly', consents: BOTH, busy: 'order' });
    assert.equal(isOrderDisabled(markup), true);
  });

  it('puts the button last in the order block', () => {
    const markup = render({ kind: 'ready', plan: FREE });
    const start = markup.indexOf('data-slot="plan-order"');
    assert.ok(start >= 0, 'no order block');
    const afterButton = markup.slice(markup.indexOf('</button>', markup.indexOf('data-slot="plan-order-button"')));
    // Only closing tags may follow the button before the block ends: no
    // element opens after it inside the block, and nothing after the block.
    assert.match(afterButton, /^<\/button>(?:<\/[a-z]+>)+$/);
    // THE CONTROL that the reading sees an element after the button at all.
    assert.doesNotMatch(`${afterButton.replace(/<\/div>$/, '')}<p>late</p></div>`, /^<\/button>(?:<\/[a-z]+>)+$/);
  });

  it('keeps the line above the button in every state, and says each notice in its own words', () => {
    const cases: [OrderNotice, string][] = [
      ['failed', enCommon.plan.order.failed],
      ['stale', enCommon.plan.order.stale],
      ['already-subscribed', enCommon.plan.order.alreadySubscribed],
    ];
    for (const [notice, sentence] of cases) {
      const markup = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly', notice });
      assert.ok(markup.includes(asMarkup(sentence)), notice);
      assert.match(markup, /data-slot="plan-action-line" role="alert"/);
      assert.equal([...markup.matchAll(/data-slot="plan-action-line"/g)].length, 1);
    }
    const quiet = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly', consents: BOTH });
    assert.equal([...quiet.matchAll(/data-slot="plan-action-line"/g)].length, 1);
    assert.doesNotMatch(quiet, /data-slot="plan-action-line" role="alert"/);
  });

  it('says the order cannot be drawn, and draws no button, when the offer could not be read', () => {
    const markup = render({ kind: 'ready', plan: FREE }, { offer: null, isOfferUnavailable: true });
    assert.ok(markup.includes(enCommon.plan.order.unavailable));
    assert.equal(orderButton(markup), null);
    assert.equal(markup.includes('data-slot="plan-card"'), false);
  });
});

describe('the plan a link names', () => {
  it('reads the two keys and ignores anything else', () => {
    assert.equal(readPlanParam('yearly'), 'yearly');
    assert.equal(readPlanParam('monthly'), 'monthly');
    assert.equal(readPlanParam('Yearly'), null);
    assert.equal(readPlanParam('lifetime'), null);
    assert.equal(readPlanParam(null), null);
  });
});

describe('the status card for a subscriber', () => {
  it('shows a yearly subscriber their plan, the year turning monthly, and only the manage button', () => {
    const markup = render({ kind: 'ready', plan: YEARLY });
    assert.match(markup, /data-slot="plan-status-card" data-plan-key="yearly"/);
    assert.ok(markup.includes(enCommon.plan.card.name.year));
    assert.ok(markup.includes(lead(enCommon.plan.card.yearThenMonthly)));
    assert.equal(buttonCount(markup), 1);
    assert.ok(markup.includes(enCommon.plan.manage));
    assert.equal(orderButton(markup), null, 'a subscriber was offered a second plan');
  });

  it('gives a monthly subscriber the renewal date and no yearly note', () => {
    // THE CONTROL for the note above: same card, monthly plan.
    const markup = render({ kind: 'ready', plan: PAID });
    assert.ok(markup.includes(enCommon.plan.card.name.month));
    assert.ok(markup.includes(lead(enCommon.plan.renewsOn)));
    assert.equal(markup.includes(lead(enCommon.plan.card.yearThenMonthly)), false);
  });

  it('says a cancelled yearly plan ends, rather than that it turns monthly', () => {
    const markup = render({ kind: 'ready', plan: { ...YEARLY, cancelAtPeriodEnd: true } });
    assert.ok(markup.includes(lead(enCommon.plan.endsOn)));
    assert.equal(markup.includes(lead(enCommon.plan.card.yearThenMonthly)), false);
  });

  it('names a payment Stripe is retrying', () => {
    assert.ok(render({ kind: 'ready', plan: { ...YEARLY, plan: 'past_due' } }).includes(enCommon.plan.status.pastDue));
    assert.equal(render({ kind: 'ready', plan: YEARLY }).includes(enCommon.plan.status.pastDue), false);
  });

  it('draws no button when there is no customer to open a portal onto', () => {
    assert.equal(buttonCount(render({ kind: 'ready', plan: { ...YEARLY, portalAvailable: false } })), 0);
  });

  it('is not drawn for somebody without a plan, who gets the order instead', () => {
    const markup = render({ kind: 'ready', plan: FREE });
    assert.equal(markup.includes('data-slot="plan-status-card"'), false);
    assert.ok(orderButton(markup) !== null);
  });

  it('thanks a returning subscriber above the card', () => {
    const markup = render({ kind: 'ready', plan: YEARLY }, { checkoutReturn: 'success' });
    assert.ok(markup.indexOf(enCommon.plan.returned.success) < markup.indexOf('data-slot="plan-status-card"'));
  });
});

describe('a monthly subscriber moving to the yearly plan', () => {
  const START = PAID.currentPeriodEnd ?? '';
  const longDate = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(START));

  it('may move only from a paid monthly plan, and from the end of its paid month', () => {
    const standingOf = (plan: PlanView) => planStanding({ instance: SELLING, account: null, planView: plan, now: NOW });
    assert.equal(switchStartFor(standingOf(PAID)), START);
    // THE CONTROLS: a yearly plan, a payment being retried, no plan at all.
    assert.equal(switchStartFor(standingOf(YEARLY)), null);
    assert.equal(switchStartFor(standingOf({ ...PAID, plan: 'past_due' })), null);
    assert.equal(switchStartFor(standingOf(FREE)), null);
  });

  it('finds a link to the order on the status card', () => {
    const markup = render({ kind: 'ready', plan: PAID }, { orderYearlyHref: ORDER_YEARLY_HREF });
    assert.match(markup, /<a[^>]*href="\/settings\/plan\?plan=yearly"/);
    assert.ok(markup.includes(enCommon.plan.card.orderYearly));
    assert.equal(orderButton(markup), null, 'the order was drawn before the person asked for it');
  });

  it('gets the yearly plan alone and the switch note with the date, instead of the payment note', () => {
    const markup = render(
      { kind: 'ready', plan: PAID },
      { mode: { kind: 'switch', startsAt: START }, selectedPlan: 'yearly' },
    );
    assert.deepEqual(
      [...markup.matchAll(/data-slot="plan-card" data-plan-key="([a-z]+)"/g)].map((match) => match[1]),
      ['yearly'],
    );
    assert.ok(markup.includes(OFFER.texts.switchNote.replace(DATE_SLOT, longDate)));
    assert.equal(markup.includes(OFFER.texts.paymentNote), false);
    assert.equal(markup.includes(DATE_SLOT), false);
    // The status card stays above the order.
    assert.ok(markup.indexOf('data-slot="plan-status-card"') < markup.indexOf('data-slot="plan-order"'));
    // THE CONTROL: a first order carries the payment note and no switch note.
    const first = render({ kind: 'ready', plan: FREE }, { selectedPlan: 'yearly' });
    assert.ok(first.includes(OFFER.texts.paymentNote));
    assert.equal(first.includes(servedLead(OFFER.texts.switchNote, DATE_SLOT)), false);
  });

  it('shows the booked move on the card, and no second link to it', () => {
    const markup = render(
      { kind: 'ready', plan: PAID },
      { orderYearlyHref: ORDER_YEARLY_HREF, switchStartsAt: START },
    );
    assert.ok(markup.includes(lead(enCommon.plan.card.switchBooked)));
    assert.ok(markup.includes(longDate));
    assert.equal(markup.includes(enCommon.plan.card.orderYearly), false);
  });
});

describe('the trial recap on the plan page (M250/05)', () => {
  const NO_PLAN: PlanView = { ...PAID, plan: 'none', planKey: null, interval: null, currentPeriodEnd: null };
  const RECAP = 'data-slot="plan-trial-recap"';

  it('names the meals logged with AI, in the plural form the count asks for', () => {
    const many = render({ kind: 'ready', plan: NO_PLAN }, { recapMealCount: 12 });
    assert.ok(many.includes(enCommon.plan.recap.meals_other.replace('{{count}}', '12')), many);
    const one = render({ kind: 'ready', plan: NO_PLAN }, { recapMealCount: 1 });
    assert.ok(one.includes(enCommon.plan.recap.meals_one.replace('{{count}}', '1')), one);
  });

  it('draws no line for no count and for a count of zero', () => {
    // THE CONTROLS for the render above, through the same slot.
    assert.ok(!render({ kind: 'ready', plan: NO_PLAN }, { recapMealCount: null }).includes(RECAP));
    assert.ok(!render({ kind: 'ready', plan: NO_PLAN }, { recapMealCount: 0 }).includes(RECAP));
    assert.ok(render({ kind: 'ready', plan: NO_PLAN }, { recapMealCount: 3 }).includes(RECAP));
  });

  it('sits above the order, so the plans are read after it', () => {
    const markup = render({ kind: 'ready', plan: NO_PLAN }, { recapMealCount: 3 });
    assert.ok(markup.includes('data-slot="plan-order"'), 'the fixture offer drew no order');
    assert.ok(markup.includes(RECAP), 'no recap line was drawn');
    assert.ok(markup.indexOf(RECAP) < markup.indexOf('data-slot="plan-order"'));
  });
});
