/**
 * The compact offer at the AI limit (M250/04), and the three surfaces that
 * draw it: the notice under a dead AI intake, `/scan`'s connect card, and the
 * refusal under a scan (the last is walked in the browser tier,
 * `tests/e2e/ai-limit-offer.spec.ts`).
 *
 * Rendered statically, so what is asserted is markup. The price is read from
 * `lowestMonthlyPrice`'s own inputs, and every sentence from the shipped
 * catalog, so a rephrase is not a failure. Every "draws the card" has a
 * control beside it that draws none through the same query.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { PlanOfferCompactView } from '../../app/components/plans/plan-offer-compact';
import { NoAiIntakeNotice } from '../../app/components/add/no-ai-intake-notice';
import { isFixedByPayment } from '../../app/components/add/use-ai-connection';
import { PLAN_PAGE_HREF } from '../../app/lib/plans/plans-door';
import { planOfferSchema } from '../../app/lib/sync/engine/client/plans-wire';
import type { AllowanceDoor } from '../../app/lib/ai/managed-ai-settings';
import fixtureOffer from '../fixtures/plan-offer.json';
import enCommon from '../../app/i18n/locales/en/common.json';

const OFFER = planOfferSchema.parse(fixtureOffer);
const CARD = 'data-slot="plan-offer-compact"';

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, withI18n(element)));
}

/** The class list of the price line. */
function priceClass(markup: string): string {
  const match = /data-slot="plan-offer-price" class="([^"]*)"/.exec(markup);
  assert.ok(match !== null, 'no price line in the card');
  return match[1] ?? '';
}

/** Every `href` in a render. */
function hrefsIn(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
}

/** The expected "from" line, from the fixture's own cents and this file's own `Intl` call. */
function expectedFromLine(): string {
  const cents = Math.min(
    ...OFFER.plans.map((plan) => (plan.interval === 'year' ? Math.round(plan.grossCents / 12) : plan.grossCents)),
  );
  const price = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  return enCommon.plan.offer.from.replace('{{price}}', price);
}

describe('the compact offer', () => {
  it('states the lowest monthly price and links to the plan page', () => {
    const markup = render(createElement(PlanOfferCompactView, { plans: OFFER.plans, placement: 'ai-limit' }));
    assert.ok(markup.includes(expectedFromLine()), markup);
    assert.doesNotMatch(priceClass(markup), /\binvisible\b/);
    assert.deepEqual(hrefsIn(markup), [PLAN_PAGE_HREF]);
  });

  it('keeps the price line and the link before the offer arrives, with the line held invisible', () => {
    const markup = render(createElement(PlanOfferCompactView, { plans: null, placement: 'ai-limit' }));
    // THE CONTROL for the render above: the same line exists, holds its box,
    // and says no price.
    assert.match(priceClass(markup), /\binvisible\b/);
    assert.ok(!markup.includes('€'), 'a price was drawn before there was an offer');
    assert.deepEqual(hrefsIn(markup), [PLAN_PAGE_HREF], 'the door went away while the offer was unread');
  });

  it('draws the lead a screen passes, and none when it passes none', () => {
    const lead = 'A lead sentence from the screen.';
    assert.ok(render(createElement(PlanOfferCompactView, { plans: null, placement: 'ai-limit', lead })).includes(lead));
    assert.ok(!render(createElement(PlanOfferCompactView, { plans: null, placement: 'ai-limit' })).includes(lead));
  });
});

describe('the notice under a dead AI intake', () => {
  function notice(door: Parameters<typeof NoAiIntakeNotice>[0]['door']): string {
    return render(
      createElement(NoAiIntakeNotice, {
        door,
        byokMessage: 'byok',
        byokLinkLabel: 'connect',
        byokHref: '/settings/ai',
      }),
    );
  }

  it('turns the plans door into the offer, keeping its sentence as the lead', () => {
    const markup = notice({ kind: 'plans', endedAt: null });
    assert.ok(markup.includes(CARD));
    assert.ok(markup.includes(enCommon.aiIntake.plansNotSwitchedOn));
  });

  it('draws no offer on the administrator door or the ended door of an instance that sells nothing', () => {
    // THE CONTROL: the same query finds no card where no plan is sold.
    for (const door of [
      { kind: 'ask-admin' },
      { kind: 'allowance-ended', endedAt: '2026-09-01T00:00:00.000Z' },
    ] as const) {
      assert.ok(!notice(door).includes(CARD), `${door.kind} drew an offer`);
    }
  });
});

describe('which allowance answers a payment fixes', () => {
  it('is the ended allowance and the one never switched on, never the administrator one', () => {
    const doors: [AllowanceDoor, boolean][] = [
      [{ kind: 'allowance-ended', endedAt: '2026-09-01T00:00:00.000Z' }, true],
      [{ kind: 'not-switched-on' }, true],
      [{ kind: 'ask-admin' }, false],
    ];
    for (const [door, expected] of doors) assert.equal(isFixedByPayment(door), expected, door.kind);
  });
});
