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
import { PlanScreen, readCheckoutReturn, type PlanReadState } from '../../app/routes/settings.plan';
import type { PlanView } from '../../app/lib/sync/engine/client/plans-wire';
import enCommon from '../../app/i18n/locales/en/common.json';

const PAID: PlanView = {
  plan: 'active',
  currentPeriodEnd: '2026-10-09T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

function render(
  state: PlanReadState,
  overrides: { busy?: 'none' | 'checkout' | 'portal'; checkoutReturn?: 'none' | 'success' | 'cancelled'; actionFailed?: boolean } = {},
): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(PlanScreen, {
        state,
        busy: overrides.busy ?? 'none',
        checkoutReturn: overrides.checkoutReturn ?? 'none',
        actionFailed: overrides.actionFailed ?? false,
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
  it('draws both buttons for an account the biller holds a customer for', () => {
    const markup = render({ kind: 'ready', plan: PAID });
    assert.equal(buttonCount(markup), 2);
    assert.ok(markup.includes(enCommon.plan.start));
    assert.ok(markup.includes(enCommon.plan.manage));
  });

  it('draws no manage button when there is nothing to manage', () => {
    // THE CONTROL for the case above. The biller answers a machine coded 404
    // for an account with no customer row, so the button would have exactly
    // one outcome, and it is a failure.
    const markup = render({ kind: 'ready', plan: { ...PAID, portalAvailable: false } });
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
    const markup = render({ kind: 'ready', plan: { plan: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false, portalAvailable: false } });
    assert.equal(markup.includes(enCommon.plan.renewsOn.split('{{date}}')[0] ?? ''), false);
    assert.equal(markup.includes(enCommon.plan.endsOn.split('{{date}}')[0] ?? ''), false);
  });

  it('says the price includes VAT on the screen a consumer reads', () => {
    // M213 spec 07 item 2: no place shows a consumer a net price, and every
    // place that discusses one says so.
    assert.ok(render({ kind: 'ready', plan: PAID }).includes(enCommon.plan.vatNote));
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
    const markup = render({ kind: 'ready', plan: PAID }, { actionFailed: true });
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
