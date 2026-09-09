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
 * (`PlanView`, `toPlanStatus`), `checkout.ts` and `portal.ts` on 2026-09-09.
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
import { PLANS_API_PREFIX, PLAN_STATUSES, planViewSchema } from '../../app/lib/sync/engine/client/plans-wire';
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

/** The plan view as the biller really writes it, field for field. */
const PAID_VIEW = {
  plan: 'active',
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

  it('decodes exactly the four fields of PlanView', () => {
    const view = planViewSchema.parse(PAID_VIEW);
    assert.deepEqual(Object.keys(view).toSorted(), [
      'cancelAtPeriodEnd',
      'currentPeriodEnd',
      'plan',
      'portalAvailable',
    ]);
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

  it('opens a checkout with a POST whose only field is the consent language', async () => {
    const { transport, calls } = fakeTransport({ answers: { url: 'https://checkout.example.test/s/1' } });
    const outcome = await new PlansClient({ transport }).startCheckout({ locale: 'de' });
    assert.equal(outcome.status, 'ok');
    assert.equal(outcome.status === 'ok' ? outcome.value.url : null, 'https://checkout.example.test/s/1');
    assert.deepEqual(calls, [
      { path: `${PLANS_API_PREFIX}/checkout`, method: 'POST', body: { locale: 'de' } },
    ]);
    // THE PROPERTY THE WHOLE ARRANGEMENT RESTS ON: no price, no account id and
    // no email leaves this client. The account comes from a header the gateway
    // builds from the session, and the price from the biller's own catalogue.
    const sent = JSON.stringify(calls[0]?.body);
    for (const forbidden of ['price', 'accountId', 'email', 'customer']) {
      assert.equal(sent.includes(forbidden), false, `the checkout body named ${forbidden}`);
    }
  });

  it('opens the portal with a POST and no body at all', async () => {
    const { transport, calls } = fakeTransport({ answers: { url: 'https://portal.example.test/p/1' } });
    const outcome = await new PlansClient({ transport }).openPortal();
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(calls, [{ path: `${PLANS_API_PREFIX}/portal`, method: 'POST', body: undefined }]);
  });

  it('reads a 404 as absent on all three routes, because that is the shut door', async () => {
    const { transport } = fakeTransport({ fails: notFound });
    const client = new PlansClient({ transport });
    assert.deepEqual(await client.readPlan(), { status: 'absent' });
    assert.deepEqual(await client.startCheckout({ locale: 'en' }), { status: 'absent' });
    assert.deepEqual(await client.openPortal(), { status: 'absent' });
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
