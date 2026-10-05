/**
 * The app side of the 2026-09-28 sign-up funnel contract with the core.
 *
 *  1. `POST /v1/auth/signup-request` carries `plan` and `locale` only when
 *     given, so a request with neither is exactly `{ email }`, as before.
 *  2. `GET /v1/plans/prices` is read without a token, decoded, and every
 *     failure (a 404, a 429, a dead connection, a body that does not decode, a
 *     missing plan) is the sentence without a price, never a half-read figure.
 *  3. The plan client tells its caller when the biller ACCEPTS an order, and
 *     only then, which is when the plan chosen before sign-up is forgotten.
 *  4. A finished `/join` lands on the order page for a chosen plan, where the
 *     instance sells one, and where it lands today otherwise.
 *
 * Every claim has the case that would pass a module ignoring it: the request
 * with no plan beside the one with a plan, the 200 beside the failures, the
 * refusal beside the acceptance, the instance selling nothing beside the one
 * that sells.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SyncAuthClient } from '../../app/lib/sync/engine/client/auth-client';
import { PlansClient, type PlansTransport } from '../../app/lib/sync/engine/client/plans-client';
import { PLAN_PRICES_PATH, planPricesSchema } from '../../app/lib/sync/engine/client/plans-wire';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { JsonValue } from '../../app/lib/sync/engine/protocol';
import { publicPlanPricesOf, readPublicPlanPrices } from '../../app/lib/plans/public-plan-prices';
import { resolveJoinDestination, resolveSignInDestination } from '../../app/lib/sign-in-flow';

const BASE_URL = 'https://sync.example.test';

/**
 * Figures that are nobody's price, so no real price is typed into this public
 * repository and a module that printed a hard-coded one would not match.
 */
const MONTHLY_CENTS = 321;
const YEARLY_CENTS = 2345;

/** A prices body as the core sends it. */
const PRICES_BODY = {
  currency: 'EUR',
  plans: [
    { key: 'monthly', interval: 'month', grossCents: MONTHLY_CENTS },
    { key: 'yearly', interval: 'year', grossCents: YEARLY_CENTS },
  ],
};

/** A fetch that records what it was asked and answers one canned response. */
function recordingFetch(answer: () => Response) {
  const requests: { url: string; method: string; body: string | null; authorization: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = init?.body;
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: body === undefined || body === null ? null : String(body),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return answer();
  };
  return { fetchImpl, requests };
}

/** A fetch whose connection never opens. */
async function deadFetch(): Promise<Response> {
  throw new TypeError('Failed to fetch');
}

/** A JSON response. */
function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('the sign-up request', () => {
  it('sends exactly the address when there is no challenge, no plan and no language', async () => {
    const { fetchImpl, requests } = recordingFetch(() => json({}, 202));
    await new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl }).signupRequest({
      email: 'anna@example.org',
      captchaToken: null,
      plan: null,
      locale: null,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, `${BASE_URL}/v1/auth/signup-request`);
    assert.deepEqual(JSON.parse(requests[0]?.body ?? 'null'), { email: 'anna@example.org' });
  });

  it('carries the chosen plan and the language beside the address and the token', async () => {
    const { fetchImpl, requests } = recordingFetch(() => json({}, 202));
    await new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl }).signupRequest({
      email: 'anna@example.org',
      captchaToken: 'token-1',
      plan: 'yearly',
      locale: 'fr',
    });
    assert.deepEqual(JSON.parse(requests[0]?.body ?? 'null'), {
      email: 'anna@example.org',
      captchaToken: 'token-1',
      plan: 'yearly',
      locale: 'fr',
    });
  });
});

describe('the anonymous price read', () => {
  it('reads both prices with one GET, at the transcribed path, with no token', async () => {
    const { fetchImpl, requests } = recordingFetch(() => json(PRICES_BODY));
    const prices = await readPublicPlanPrices({ serverUrl: BASE_URL, fetchImpl });
    assert.deepEqual(prices, { currency: 'EUR', monthlyCents: MONTHLY_CENTS, yearlyCents: YEARLY_CENTS });
    assert.deepEqual(requests, [
      { url: `${BASE_URL}/v1/plans/prices`, method: 'GET', body: null, authorization: null },
    ]);
    assert.equal(PLAN_PRICES_PATH, '/v1/plans/prices');
  });

  it('answers nothing for a 404, a 429 and a 500', async () => {
    for (const status of [404, 429, 500]) {
      const { fetchImpl } = recordingFetch(() => json({ error: 'plans-prices-rate-limited' }, status));
      assert.equal(await readPublicPlanPrices({ serverUrl: BASE_URL, fetchImpl }), null, String(status));
    }
  });

  it('answers nothing for a dead connection and for a body that is not JSON', async () => {
    assert.equal(await readPublicPlanPrices({ serverUrl: BASE_URL, fetchImpl: deadFetch }), null);
    const { fetchImpl } = recordingFetch(() => new Response('<html>', { status: 200 }));
    assert.equal(await readPublicPlanPrices({ serverUrl: BASE_URL, fetchImpl }), null);
  });

  it('answers nothing for a body whose figures the app would state wrongly', async () => {
    const wrong = [
      { ...PRICES_BODY, currency: 'euro' },
      { ...PRICES_BODY, plans: [{ key: 'yearly', interval: 'month', grossCents: YEARLY_CENTS }] },
      { ...PRICES_BODY, plans: [{ key: 'monthly', interval: 'month', grossCents: 3.5 }] },
      { ...PRICES_BODY, plans: [PRICES_BODY.plans[0], PRICES_BODY.plans[0]] },
    ];
    for (const body of wrong) {
      const { fetchImpl } = recordingFetch(() => json(body));
      assert.equal(await readPublicPlanPrices({ serverUrl: BASE_URL, fetchImpl }), null, JSON.stringify(body));
    }
  });

  it('answers nothing when one of the two plans is missing, so no sentence names half a price', () => {
    const onlyMonthly = planPricesSchema.parse({ currency: 'EUR', plans: [PRICES_BODY.plans[0]] });
    assert.equal(publicPlanPricesOf(onlyMonthly), null);
    assert.deepEqual(publicPlanPricesOf(planPricesSchema.parse(PRICES_BODY)), {
      currency: 'EUR',
      monthlyCents: MONTHLY_CENTS,
      yearlyCents: YEARLY_CENTS,
    });
  });

  it('ignores a tiers array and any other key it does not know, as PROTOCOL.md 5.22 promises', () => {
    const withTiers = {
      ...PRICES_BODY,
      tiers: [{ id: 'tier-a', name: 'Alpha', isSold: true, plans: PRICES_BODY.plans }],
      futureField: { anything: true },
    };
    // THE SAME DECODED VALUE as the body with no extra key, so the extra keys changed nothing.
    assert.deepEqual(planPricesSchema.parse(withTiers), planPricesSchema.parse(PRICES_BODY));
    assert.deepEqual(publicPlanPricesOf(planPricesSchema.parse(withTiers)), {
      currency: 'EUR',
      monthlyCents: MONTHLY_CENTS,
      yearlyCents: YEARLY_CENTS,
    });
    // THE CONTROL: a body whose known part is broken is still refused, tiers or not.
    assert.equal(planPricesSchema.safeParse({ ...withTiers, currency: 'euro' }).success, false);
  });
});

/** A transport answering one value, or throwing one error. */
function transport(answer: () => JsonValue): PlansTransport {
  return { requestAsAccount: async () => answer() };
}

const ORDER_INPUT = {
  plan: 'yearly',
  locale: 'en',
  consentVersion: 'v1',
  consents: { terms: true, earlyStart: true },
} as const;

describe('an accepted order', () => {
  it('is told for a Stripe address and for a booked switch', async () => {
    for (const answer of [
      { url: 'https://checkout.stripe.test/c/1' },
      { switched: { plan: 'yearly', startsAt: '2026-10-28T00:00:00.000Z' } },
    ]) {
      let told = 0;
      const client = new PlansClient({ transport: transport(() => answer), onOrderPlaced: () => (told += 1) });
      await client.placeOrder(ORDER_INPUT);
      assert.equal(told, 1, JSON.stringify(answer));
    }
  });

  it('is never told for a refusal, a shut door or a failure', async () => {
    const failures: (() => JsonValue)[] = [
      () => {
        throw new SyncRequestError({ kind: 'invalid', status: 400, message: 'stale', code: 'order-stale-version' });
      },
      () => {
        throw new SyncRequestError({
          kind: 'conflict',
          status: 409,
          message: 'pays',
          code: 'order-already-subscribed',
        });
      },
      () => {
        throw new SyncRequestError({ kind: 'not-found', status: 404, message: 'no biller' });
      },
    ];
    for (const failure of failures) {
      let told = 0;
      const client = new PlansClient({ transport: transport(failure), onOrderPlaced: () => (told += 1) });
      await client.placeOrder(ORDER_INPUT);
      assert.equal(told, 0);
    }
    let told = 0;
    const broken = new PlansClient({
      transport: transport(() => {
        throw new SyncRequestError({ kind: 'server', status: 502, message: 'down' });
      }),
      onOrderPlaced: () => (told += 1),
    });
    await assert.rejects(broken.placeOrder(ORDER_INPUT));
    assert.equal(told, 0);
  });
});

describe('where a finished join lands', () => {
  it('lands on the order page with the chosen plan named, where the instance sells plans', () => {
    for (const gate of ['pass', 'self-heal', 'welcome', 'onboard'] as const) {
      assert.equal(
        resolveJoinDestination({ gate, intendedPlan: 'yearly', sellsPlans: true }),
        '/settings/plan?plan=yearly',
        gate,
      );
    }
    assert.equal(
      resolveJoinDestination({ gate: 'onboard', intendedPlan: 'monthly', sellsPlans: true }),
      '/settings/plan?plan=monthly',
    );
  });

  it('lands where a sign-in lands when no plan was chosen', () => {
    for (const gate of ['pass', 'self-heal', 'recover', 'welcome', 'onboard'] as const) {
      assert.equal(
        resolveJoinDestination({ gate, intendedPlan: null, sellsPlans: true }),
        resolveSignInDestination({ gate }),
      );
    }
  });

  it('never sends a chosen plan to a plan page the instance does not have', () => {
    assert.equal(resolveJoinDestination({ gate: 'onboard', intendedPlan: 'yearly', sellsPlans: false }), '/onboarding');
  });

  it('asks about a possible data loss before the plan', () => {
    assert.equal(resolveJoinDestination({ gate: 'recover', intendedPlan: 'yearly', sellsPlans: true }), '/recover');
  });

  it('names the linked tier beside the plan, and only then', () => {
    assert.equal(
      resolveJoinDestination({ gate: 'onboard', intendedPlan: 'yearly', intendedTier: 'tier-a', sellsPlans: true }),
      '/settings/plan?plan=yearly&tier=tier-a',
    );
    // THE CONTROLS: no tier is the address it always was, and a tier with no plan, an instance
    // that sells nothing, or a possible data loss ahead of it name nothing.
    assert.equal(
      resolveJoinDestination({ gate: 'onboard', intendedPlan: 'yearly', intendedTier: null, sellsPlans: true }),
      '/settings/plan?plan=yearly',
    );
    assert.equal(
      resolveJoinDestination({ gate: 'onboard', intendedPlan: null, intendedTier: 'tier-a', sellsPlans: true }),
      '/onboarding',
    );
    assert.equal(
      resolveJoinDestination({ gate: 'onboard', intendedPlan: 'yearly', intendedTier: 'tier-a', sellsPlans: false }),
      '/onboarding',
    );
    assert.equal(
      resolveJoinDestination({ gate: 'recover', intendedPlan: 'yearly', intendedTier: 'tier-a', sellsPlans: true }),
      '/recover',
    );
  });
});
