/**
 * THE CONTRACT TEST FOR `/v1/plans/*`.
 *
 * ── Why this file is the whole safety net ────────────────────────────────
 *
 * `PROTOCOL.md` §5.22 says out loud that NOTHING behind this prefix is part of
 * the protocol: the routes and the bodies belong to openplate-billing, which
 * is a separate, PRIVATE repository this one cannot import from, and the
 * gateway relays its JSON untouched. So there is no shared type, no generated
 * client and no cross-repo check. What there is, is a transcription in
 * `plans-wire.ts` and this file, which states the transcribed shapes as
 * literals so a renamed field is a failing assertion rather than an
 * `undefined` on a page about money.
 *
 * The literals below were read from `openplate-billing/src/plans/me.ts`
 * (`PlanView`, `toPlanStatus`) and `portal.ts` on 2026-09-09, and from
 * `offer.ts` and `order.ts` (branch `feat/m245-two-plans`) on 2026-09-23.
 *
 * ── Every assertion has a control ────────────────────────────────────────
 *
 * A client that returned `absent` for everything would satisfy the 404 cases
 * on its own, and one that never did would satisfy the success cases. Both are
 * asserted against each other, and the fake transport COUNTS its calls so a
 * method that quietly made two requests is visible.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PlansClient, type PlansTransport } from '../../app/lib/sync/engine/client/plans-client';
import {
  DATE_SLOT,
  ORDER_ALREADY_SUBSCRIBED,
  ORDER_CONSENT_MISSING,
  ORDER_INVALID,
  ORDER_STALE_VERSION,
  ORDER_UNKNOWN_PLAN,
  PLANS_API_PREFIX,
  PLAN_INTERVALS,
  PLAN_KEYS,
  PLAN_STATUSES,
  TERMS_SLOT,
  planOfferSchema,
  planViewSchema,
} from '../../app/lib/sync/engine/client/plans-wire';
import { toRequestError } from '../../app/lib/sync/engine/client/auth-client';
import fixtureOffer from '../fixtures/plan-offer.json';
import type { AuthorizedMethod } from '../../app/lib/sync/engine/client/auth-client';
import type { JsonValue } from '../../app/lib/sync/engine/protocol';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';

/** One request this client made, recorded so a call site can be asserted rather than assumed. */
interface RecordedCall {
  path: string;
  method: AuthorizedMethod;
  body?: JsonValue;
}

/** A transport standing in for the open session, with the calls it recorded. */
interface FakeTransport {
  transport: PlansTransport;
  calls: RecordedCall[];
}

/** What a fake transport does when it is called: answer a body, or fail. */
type TransportBehaviour = { answers: JsonValue } | { fails: () => never };

/** A transport that answers one canned value and records what it was asked. */
function fakeTransport(behaviour: TransportBehaviour): FakeTransport {
  const calls: RecordedCall[] = [];
  const transport: PlansTransport = {
    requestAsAccount: async (input) => {
      calls.push({ path: input.path, method: input.method, body: input.body });
      if ('fails' in behaviour) return behaviour.fails();
      return behaviour.answers;
    },
  };
  return { transport, calls };
}

function notFound(): never {
  throw new SyncRequestError({ kind: 'not-found', message: 'not found', status: 404 });
}

/** One order as the page places it: a key, the offer's language and version, both consents. */
const ORDER = {
  plan: 'yearly',
  locale: 'en',
  consentVersion: 'fixture-consent-1',
  consents: { terms: true, earlyStart: true },
} as const;

/** A refusal from the biller, as the session's transport builds it from the response. */
function refusedWith(status: number, code: string): () => never {
  return () => {
    throw new SyncRequestError({ kind: status === 409 ? 'conflict' : 'invalid', message: code, status, code });
  };
}

/** The plan view as the biller really writes it, field for field. */
const PAID_VIEW = {
  plan: 'active',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: '2026-10-09T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

describe('the plan wire shapes, transcribed from openplate-billing', () => {
  it('names the five statuses the biller narrowed Stripe down to', () => {
    // Transcribed from `toPlanStatus`. Stripe has eight; the three that mean
    // "not paying and not covered" are collapsed into `canceled` before they
    // leave the biller, so a sixth value arriving here is a decode failure
    // rather than an unhandled branch on a screen.
    assert.deepEqual([...PLAN_STATUSES], ['none', 'trialing', 'active', 'past_due', 'canceled']);
  });

  it('decodes exactly the six fields of PlanView', () => {
    const view = planViewSchema.parse(PAID_VIEW);
    assert.deepEqual(Object.keys(view).toSorted(), [
      'cancelAtPeriodEnd',
      'currentPeriodEnd',
      'interval',
      'plan',
      'planKey',
      'portalAvailable',
    ]);
  });

  it('names the two plan keys and the two intervals of the M245/01 catalogue', () => {
    assert.deepEqual([...PLAN_KEYS], ['monthly', 'yearly']);
    assert.deepEqual([...PLAN_INTERVALS], ['month', 'year']);
    const yearly = planViewSchema.parse({ ...PAID_VIEW, planKey: 'yearly', interval: 'year' });
    assert.equal(yearly.planKey, 'yearly');
    assert.equal(yearly.interval, 'year');
  });

  it('reads a missing or unknown plan key as unnamed, never as a failed read', () => {
    // A biller older than M245/01 sends no key at all, and a newer one may
    // name a plan this client has never heard of. Both keep the status.
    const { planKey, interval, ...beforeM245 } = PAID_VIEW;
    assert.equal(planKey, 'monthly');
    assert.equal(interval, 'month');
    const older = planViewSchema.parse(beforeM245);
    assert.equal(older.plan, 'active');
    assert.equal(older.planKey, null);
    assert.equal(older.interval, null);
    const newer = planViewSchema.parse({ ...PAID_VIEW, planKey: 'quarterly', interval: 'quarter' });
    assert.equal(newer.planKey, null);
    assert.equal(newer.interval, null);
  });

  it('refuses a body the biller does not send', () => {
    // THE CONTROL FOR THE DECODER. A schema that parsed anything would pass
    // the case above while telling the page nothing.
    assert.throws(() => planViewSchema.parse({ ...PAID_VIEW, plan: 'incomplete' }));
    assert.throws(() => planViewSchema.parse({ ...PAID_VIEW, currentPeriodEnd: 12 }));
    const { portalAvailable, ...withoutPortal } = PAID_VIEW;
    assert.equal(portalAvailable, true);
    assert.throws(() => planViewSchema.parse(withoutPortal));
  });

  it('accepts the no-subscription view, where the period end really is null', () => {
    const view = planViewSchema.parse({
      plan: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      portalAvailable: false,
    });
    assert.equal(view.currentPeriodEnd, null);
  });
});

describe('the plan client', () => {
  it('reads the plan with one GET at the transcribed path', async () => {
    const { transport, calls } = fakeTransport({ answers: PAID_VIEW });
    const outcome = await new PlansClient({ transport }).readPlan();
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(calls, [{ path: `${PLANS_API_PREFIX}/me`, method: 'GET', body: undefined }]);
    assert.equal(calls.length, 1, 'the plan read made more than one request');
  });

  it('opens the portal with a POST and no body at all', async () => {
    const { transport, calls } = fakeTransport({ answers: { url: 'https://portal.example.test/p/1' } });
    const outcome = await new PlansClient({ transport }).openPortal();
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(calls, [{ path: `${PLANS_API_PREFIX}/portal`, method: 'POST', body: undefined }]);
  });

  it('reads a 404 as absent on every route, because that is the shut door', async () => {
    const { transport } = fakeTransport({ fails: notFound });
    const client = new PlansClient({ transport });
    assert.deepEqual(await client.readPlan(), { status: 'absent' });
    assert.deepEqual(await client.openPortal(), { status: 'absent' });
    assert.deepEqual(await client.placeOrder(ORDER), { kind: 'absent' });
  });

  it('no longer knows the checkout route the order replaced', () => {
    // `POST /plans/checkout` answers 410 since M245/03. A client that still
    // had a way to call it would open a Stripe session with no consent row.
    assert.equal('startCheckout' in PlansClient.prototype, false);
    // THE CONTROL: the same reading finds a method the client does have.
    assert.equal('placeOrder' in PlansClient.prototype, true);
  });

  it('still throws everything that is not a 404', async () => {
    // THE CONTROL FOR THE BRANCH ABOVE. A client that answered `absent` for
    // every failure would make "there is no plan door here" and "the biller
    // fell over" the same sentence on the screen.
    const { transport } = fakeTransport({
      fails: () => {
        throw new SyncRequestError({ kind: 'server', message: 'upstream unreachable', status: 502 });
      },
    });
    await assert.rejects(new PlansClient({ transport }).readPlan(), /upstream unreachable/);
  });

  it('throws on a body it cannot decode, rather than answering a half-read plan', async () => {
    const { transport } = fakeTransport({ answers: { plan: 'active' } });
    await assert.rejects(new PlansClient({ transport }).readPlan());
  });
});

/** The fixture offer with its plans replaced. */
function withPlans(plans: readonly object[]) {
  return { ...fixtureOffer, plans };
}

/** The fixture offer with its terms link replaced. */
function withTerms(terms: string) {
  return { ...fixtureOffer, links: { ...fixtureOffer.links, terms } };
}

describe('the offer, the contract M250 and M245/03 share', () => {
  it('decodes the fixture offer with both plans, their prices and every text', () => {
    const offer = planOfferSchema.parse(fixtureOffer);
    assert.deepEqual(
      offer.plans.map((plan) => [plan.key, plan.interval, plan.grossCents, plan.currency]),
      [
        ['monthly', 'month', 500, 'EUR'],
        ['yearly', 'year', 4000, 'EUR'],
      ],
    );
    assert.deepEqual(Object.keys(offer.texts).toSorted(), [
      'button',
      'earlyStartConsent',
      'heading',
      'paymentNote',
      'summary',
      'switchNote',
      'termsConsent',
      'withdrawal',
    ]);
    assert.deepEqual(Object.keys(offer.links).toSorted(), ['privacy', 'terms', 'withdrawal']);
  });

  it('refuses an offer whose figures the app would derive wrongly', () => {
    // THE CONTROL FOR THE DECODER: each of these differs from the fixture in
    // exactly one place, and the fixture itself decodes above.
    const [monthly, yearly] = fixtureOffer.plans;
    assert.ok(monthly !== undefined && yearly !== undefined);
    assert.throws(() => planOfferSchema.parse(withPlans([monthly, { ...yearly, interval: 'month' }])), /disagree/);
    assert.throws(() => planOfferSchema.parse(withPlans([monthly, { ...yearly, key: 'monthly', interval: 'month' }])), /twice/);
    assert.throws(() => planOfferSchema.parse(withPlans([monthly, { ...yearly, grossCents: 40.5 }])));
    assert.throws(() => planOfferSchema.parse(withPlans([monthly, { ...yearly, grossCents: 0 }])));
    assert.throws(() => planOfferSchema.parse(withPlans([monthly, { ...yearly, currency: 'euro' }])));
    assert.throws(() => planOfferSchema.parse(withPlans([monthly, { ...yearly, key: 'quarterly' }])));
    assert.throws(() => planOfferSchema.parse(withPlans([])));
  });

  it('accepts only app paths as links, so a relayed body cannot send a buyer off the instance', () => {
    assert.equal(planOfferSchema.parse(withTerms('/legal/terms')).links.terms, '/legal/terms');
    assert.throws(() => planOfferSchema.parse(withTerms('https://elsewhere.example/terms')));
    assert.throws(() => planOfferSchema.parse(withTerms('//elsewhere.example/terms')));
  });

  it('reads the offer with one GET, naming the language in the query and nothing else', async () => {
    const { transport, calls } = fakeTransport({ answers: fixtureOffer });
    const outcome = await new PlansClient({ transport }).readOffer({ locale: 'de' });
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(calls, [{ path: `${PLANS_API_PREFIX}/offer?locale=de`, method: 'GET', body: undefined }]);
  });

  it('answers absent for an offer it cannot decode, never a half-drawn one', async () => {
    const { transport } = fakeTransport({ answers: { ...fixtureOffer, plans: [{ key: 'monthly' }] } });
    assert.deepEqual(await new PlansClient({ transport }).readOffer({ locale: 'en' }), { status: 'absent' });
  });

  it('answers absent for the shut door, and still throws a biller that fell over', async () => {
    const shut = fakeTransport({ fails: notFound });
    assert.deepEqual(await new PlansClient({ transport: shut.transport }).readOffer({ locale: 'en' }), {
      status: 'absent',
    });
    const broken = fakeTransport({
      fails: () => {
        throw new SyncRequestError({ kind: 'server', message: 'upstream unreachable', status: 502 });
      },
    });
    await assert.rejects(new PlansClient({ transport: broken.transport }).readOffer({ locale: 'en' }), /unreachable/);
  });
});

describe('the order, transcribed from openplate-billing/src/plans/order.ts', () => {
  it('names the five refusal codes the biller answers', () => {
    assert.deepEqual(
      [ORDER_INVALID, ORDER_UNKNOWN_PLAN, ORDER_CONSENT_MISSING, ORDER_STALE_VERSION, ORDER_ALREADY_SUBSCRIBED],
      ['order-invalid', 'order-unknown-plan', 'order-consent-missing', 'order-stale-version', 'order-already-subscribed'],
    );
  });

  it('posts the plan key, the offer language and version, and both consents, and nothing else', async () => {
    const { transport, calls } = fakeTransport({ answers: { url: 'https://checkout.example.test/s/1' } });
    const outcome = await new PlansClient({ transport }).placeOrder(ORDER);
    assert.deepEqual(outcome, { kind: 'redirect', url: 'https://checkout.example.test/s/1' });
    assert.deepEqual(calls, [
      {
        path: `${PLANS_API_PREFIX}/order`,
        method: 'POST',
        body: {
          plan: 'yearly',
          locale: 'en',
          consentVersion: 'fixture-consent-1',
          consents: { terms: true, earlyStart: true },
        },
      },
    ]);
    // THE PROPERTY THE WHOLE ARRANGEMENT RESTS ON: no price, no account id and
    // no email leaves this client. The account comes from a header the gateway
    // builds from the session, and the price from the biller's own catalogue.
    const sent = JSON.stringify(calls[0]?.body);
    for (const forbidden of ['price', 'accountId', 'email', 'customer', 'grossCents']) {
      assert.equal(sent.includes(forbidden), false, `the order body named ${forbidden}`);
    }
  });

  it('answers a booked switch as a switch, with the day the year starts', async () => {
    const startsAt = '2026-10-09T00:00:00.000Z';
    const { transport } = fakeTransport({ answers: { switched: { plan: 'yearly', startsAt } } });
    assert.deepEqual(await new PlansClient({ transport }).placeOrder(ORDER), {
      kind: 'switched',
      plan: 'yearly',
      startsAt,
    });
  });

  it('throws on a 200 that is neither an address nor a switch', async () => {
    // THE CONTROL for the two answers above: a decoder that accepted anything
    // would send the browser to `undefined`.
    const { transport } = fakeTransport({ answers: { switched: { plan: 'yearly' } } });
    await assert.rejects(new PlansClient({ transport }).placeOrder(ORDER));
  });

  it('tells a stale page from every other 400', async () => {
    const stale = fakeTransport({ fails: refusedWith(400, ORDER_STALE_VERSION) });
    assert.deepEqual(await new PlansClient({ transport: stale.transport }).placeOrder(ORDER), { kind: 'stale' });
    for (const code of [ORDER_INVALID, ORDER_UNKNOWN_PLAN, ORDER_CONSENT_MISSING]) {
      const other = fakeTransport({ fails: refusedWith(400, code) });
      assert.deepEqual(await new PlansClient({ transport: other.transport }).placeOrder(ORDER), {
        kind: 'refused',
        code,
      });
    }
  });

  it('reads the 409 as an account that already pays, and throws any other 409', async () => {
    const paying = fakeTransport({ fails: refusedWith(409, ORDER_ALREADY_SUBSCRIBED) });
    assert.deepEqual(await new PlansClient({ transport: paying.transport }).placeOrder(ORDER), {
      kind: 'already-subscribed',
    });
    const other = fakeTransport({ fails: refusedWith(409, 'something-else') });
    await assert.rejects(new PlansClient({ transport: other.transport }).placeOrder(ORDER), /something-else/);
  });

  it('throws a failed Stripe call, so the page can say so and let the person try again', async () => {
    const { transport } = fakeTransport({ fails: refusedWith(502, 'checkout-failed') });
    await assert.rejects(new PlansClient({ transport }).placeOrder(ORDER), /checkout-failed/);
  });

  it('carries the biller code off a real error response', async () => {
    // The session builds the error from the response; the code must survive
    // that step, or every 400 above would read as `refused`.
    const stale = await toRequestError(
      new Response(JSON.stringify({ error: ORDER_STALE_VERSION }), { status: 400 }),
    );
    assert.equal(stale.status, 400);
    assert.equal(stale.code, ORDER_STALE_VERSION);
    // THE CONTROL: a body with no token carries no code.
    const bare = await toRequestError(new Response('not json', { status: 400 }));
    assert.equal(bare.code, null);
  });
});

describe('the order texts in the offer', () => {
  it('carries the switch note and both slots the page fills', () => {
    const offer = planOfferSchema.parse(fixtureOffer);
    assert.ok(offer.texts.termsConsent.includes(TERMS_SLOT));
    assert.ok(offer.texts.switchNote.includes(DATE_SLOT));
    assert.equal(TERMS_SLOT, '{terms}');
    assert.equal(DATE_SLOT, '{date}');
  });

  it('refuses an offer whose consent has no terms slot, or whose switch note has no date', () => {
    // A consent without its link, or a switch note without its day, is a page
    // that cannot be drawn honestly. Each differs from the fixture in one text.
    const texts = fixtureOffer.texts;
    assert.throws(() => planOfferSchema.parse({ ...fixtureOffer, texts: { ...texts, termsConsent: 'No slot.' } }));
    assert.throws(() => planOfferSchema.parse({ ...fixtureOffer, texts: { ...texts, switchNote: 'No slot.' } }));
    const { switchNote, ...withoutSwitchNote } = texts;
    assert.ok(switchNote.length > 0);
    assert.throws(() => planOfferSchema.parse({ ...fixtureOffer, texts: withoutSwitchNote }));
  });
});
