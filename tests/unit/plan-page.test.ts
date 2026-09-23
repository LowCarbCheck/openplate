/**
 * `/settings/plan`, every state of it.
 *
 * ── Why the screen is props only ─────────────────────────────────────────
 *
 * There is no DOM test library in this repository, so a state reachable only
 * by clicking is a state nothing checks. `PlanScreen` therefore takes the read
 * state, the busy button, the return marker and the two handlers as props, and
 * every state below is rendered directly.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 *  - the two buttons appear where they are actionable and NOT where they are
 *    not: the portal button is drawn only when the biller says there is a
 *    customer to open one onto, because a button whose only outcome is a 404
 *    is a button that lies;
 *  - a cancelled subscription's period end reads as the day access STOPS, not
 *    as the day it renews, which is the one place this page could contradict
 *    the cancellation somebody just made;
 *  - the VAT sentence is present on the screen a consumer reads, which is
 *    M213 spec 07's requirement about every place a price is discussed.
 *
 * No assertion pins a translated sentence. Wordsmith owns the wording, so
 * claims are read out of the shipped catalog.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { PlanScreen, readCheckoutReturn, readPlanParam, type PlanReadState } from '../../app/routes/settings.plan';
import { planOfferSchema, type PlanKey, type PlanOffer, type PlanView } from '../../app/lib/sync/engine/client/plans-wire';
import fixtureOffer from '../fixtures/plan-offer.json';
import { planStanding } from '../../app/lib/plans/plan-standing';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';

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
import enCommon from '../../app/i18n/locales/en/common.json';

const PAID: PlanView = {
  plan: 'active',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: '2026-10-09T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

/** A subscription that is over, from somebody the biller still holds a customer for. */
const LAPSED: PlanView = { ...PAID, plan: 'canceled', currentPeriodEnd: '2026-08-09T00:00:00.000Z' };

/** A yearly subscription that renews into the monthly plan. */
const YEARLY: PlanView = { ...PAID, planKey: 'yearly', interval: 'year', currentPeriodEnd: '2027-03-15T10:00:00.000Z' };

function render(
  state: PlanReadState,
  overrides: {
    busy?: 'none' | 'checkout' | 'portal';
    checkoutReturn?: 'none' | 'success' | 'cancelled';
    actionFailed?: boolean;
    offer?: PlanOffer | null;
    selectedPlan?: PlanKey | null;
    recapMealCount?: number | null;
  } = {},
): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(PlanScreen, {
        state,
        standing: planStanding({
          instance: SELLING,
          account: null,
          planView: state.kind === 'ready' ? state.plan : null,
          now: NOW,
        }),
        offer: overrides.offer ?? null,
        selectedPlan: overrides.selectedPlan ?? null,
        onSelectPlan: () => undefined,
        busy: overrides.busy ?? 'none',
        checkoutReturn: overrides.checkoutReturn ?? 'none',
        actionFailed: overrides.actionFailed ?? false,
        recapMealCount: overrides.recapMealCount ?? null,
        onStart: () => undefined,
        onManage: () => undefined,
      }),
    ),
  );
}

/** The number of `<button>` elements a render drew. "No button" is asserted as zero, never as a missing word. */
function buttonCount(markup: string): number {
  return [...markup.matchAll(/<button/g)].length;
}

describe('the plan page', () => {
  it('draws both buttons for a lapsed account the biller holds a customer for', () => {
    const markup = render({ kind: 'ready', plan: LAPSED });
    assert.equal(buttonCount(markup), 2);
    assert.ok(markup.includes(enCommon.plan.start));
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
    // Both name the same date, and they say opposite things about it. Read
    // from the catalog with the date interpolated out, so a rephrase does not
    // fail this and a swapped branch does.
    assert.ok(cancelled.includes(enCommon.plan.endsOn.split('{{date}}')[0] ?? ''));
    assert.ok(renewing.includes(enCommon.plan.renewsOn.split('{{date}}')[0] ?? ''));
    assert.notEqual(cancelled, renewing);
  });

  it('names no date at all when the biller sent none', () => {
    const markup = render({ kind: 'ready', plan: { plan: 'none', planKey: null, interval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, portalAvailable: false } });
    assert.equal(markup.includes(enCommon.plan.renewsOn.split('{{date}}')[0] ?? ''), false);
    assert.equal(markup.includes(enCommon.plan.endsOn.split('{{date}}')[0] ?? ''), false);
  });

  it('says the price includes VAT on the screen a consumer reads', () => {
    // M213 spec 07 item 2: no place shows a consumer a net price, and every
    // place that discusses one says so.
    assert.ok(render({ kind: 'ready', plan: LAPSED }).includes(enCommon.plan.vatNote));
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
    // THE CONTROL: an ordinary visit says neither, so the two lines above are
    // really keyed on the return marker.
    const plain = render({ kind: 'ready', plan: PAID });
    assert.equal(plain.includes(enCommon.plan.returned.success), false);
    assert.equal(plain.includes(enCommon.plan.returned.cancelled), false);
  });

  it('shows the failure of a press without losing the buttons', () => {
    const markup = render({ kind: 'ready', plan: LAPSED }, { actionFailed: true });
    assert.ok(markup.includes(enCommon.plan.actionFailed));
    assert.equal(buttonCount(markup), 2, 'a failed press left nothing to try again with');
  });

  it('decodes only the two return values the biller sends', () => {
    assert.equal(readCheckoutReturn('success'), 'success');
    assert.equal(readCheckoutReturn('cancelled'), 'cancelled');
    // Transcribed from `checkoutReturnUrls`, which spells it `cancelled`. The
    // control is that a near miss is not silently accepted.
    assert.equal(readCheckoutReturn('canceled'), 'none');
    assert.equal(readCheckoutReturn(null), 'none');
  });
});

/** Whether the start button carries the `disabled` ATTRIBUTE, not a `disabled:` class variant. */
function isStartDisabled(markup: string): boolean {
  const start = /<button[^>]*>(?:(?!<\/button>).)*<\/button>/gs;
  const buttons = [...markup.matchAll(start)].map((match) => match[0]);
  const startButton = buttons.find((button) => button.includes(enCommon.plan.start));
  assert.ok(startButton !== undefined, 'no start button');
  return /<button[^>]*\sdisabled=""/.test(startButton);
}

describe('the plan page with an offer', () => {
  const OFFER = planOfferSchema.parse(fixtureOffer);
  const FREE: PlanView = { ...PAID, plan: 'none', planKey: null, interval: null, portalAvailable: false };

  it('draws the plan cards for somebody without a plan', () => {
    const markup = render({ kind: 'ready', plan: FREE }, { offer: OFFER });
    assert.equal([...markup.matchAll(/data-slot="plan-card"/g)].length, 2);
    // THE CONTROL: no offer, no cards.
    assert.equal(render({ kind: 'ready', plan: FREE }).includes('data-slot="plan-card"'), false);
  });

  it('holds the start button until a plan is picked, and says why', () => {
    const unpicked = render({ kind: 'ready', plan: FREE }, { offer: OFFER });
    assert.equal(isStartDisabled(unpicked), true);
    assert.ok(unpicked.includes(enCommon.plan.choice.pickFirst));
    // THE CONTROL: the same page with a pick enables it and hides the line.
    const picked = render({ kind: 'ready', plan: FREE }, { offer: OFFER, selectedPlan: 'yearly' });
    assert.equal(isStartDisabled(picked), false);
    assert.equal(picked.includes(enCommon.plan.choice.pickFirst), false);
  });

  it('keeps the old button working where the biller sends no offer', () => {
    assert.equal(isStartDisabled(render({ kind: 'ready', plan: FREE })), false);
  });

  it('reserves the line above the buttons whether or not it says anything', () => {
    for (const markup of [
      render({ kind: 'ready', plan: FREE }, { offer: OFFER }),
      render({ kind: 'ready', plan: FREE }, { offer: OFFER, selectedPlan: 'monthly' }),
      render({ kind: 'ready', plan: FREE }, { offer: OFFER, selectedPlan: 'monthly', actionFailed: true }),
    ]) {
      assert.equal([...markup.matchAll(/data-slot="plan-action-line"/g)].length, 1);
    }
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

/** The part of a catalog sentence before its date, so a rephrase does not fail and a swapped branch does. */
function lead(sentence: string): string {
  return sentence.split('{{date}}')[0] ?? '';
}

describe('the status card for a subscriber', () => {
  it('shows a yearly subscriber their plan, the year turning monthly, and only the manage button', () => {
    const markup = render({ kind: 'ready', plan: YEARLY });
    assert.match(markup, /data-slot="plan-status-card" data-plan-key="yearly"/);
    assert.ok(markup.includes(enCommon.plan.card.name.year));
    assert.ok(markup.includes(lead(enCommon.plan.card.yearThenMonthly)));
    assert.equal(buttonCount(markup), 1);
    assert.ok(markup.includes(enCommon.plan.manage));
    assert.equal(markup.includes(enCommon.plan.start), false, 'a subscriber was offered a second plan');
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
    const markup = render({ kind: 'ready', plan: { ...PAID, plan: 'none', planKey: null, interval: null } });
    assert.equal(markup.includes('data-slot="plan-status-card"'), false);
    assert.ok(markup.includes(enCommon.plan.start));
  });

  it('thanks a returning subscriber above the card', () => {
    const markup = render({ kind: 'ready', plan: YEARLY }, { checkoutReturn: 'success' });
    assert.ok(markup.indexOf(enCommon.plan.returned.success) < markup.indexOf('data-slot="plan-status-card"'));
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
});
