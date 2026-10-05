/**
 * A core that sells plans, stubbed for the browser tier (M250).
 *
 * The fake core server (`tests/integration/fake-sync-service.ts`) is a reading
 * of the SYNC protocol and has no biller behind it, which is exactly right:
 * `PROTOCOL.md` §5.22 says `/v1/plans/*` is not part of the protocol. So a
 * spec about plans routes three things on top of the real fake:
 *
 *  - `/health`, answering the fake's own handshake with `plans: true`, so the
 *    plan door opens through the handshake and never through a probe;
 *  - `GET /v1/plans/me`, answering the plan view the spec names;
 *  - `GET /v1/plans/offer`, answering `tests/fixtures/plan-offer.json`, whose
 *    texts are neutral placeholders. No real order or legal sentence and no
 *    real price reaches this tier;
 *  - `POST /v1/plans/order`, through {@link routeOrder}, when a spec presses
 *    the order button.
 *
 * Everything else, the account, the session and the sign-in, is the fake
 * service's own, so the page reads its plan over a real session.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { E2E_ACCOUNT_EMAIL, E2E_CORE_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';

/**
 * The neutral fixture offer, read off disk so the browser is served the same
 * bytes the unit tier decodes.
 */
export const FIXTURE_OFFER_BODY: string = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/plan-offer.json'),
  'utf8',
);

/**
 * The neutral fixture offer WITH TIERS (M2/05): placeholder names, a free
 * entry, one tier that is not on sale and the biller's privacy lines. No real
 * tier name or price reaches this tier.
 */
export const FIXTURE_TIERS_OFFER_BODY: string = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/plan-offer-tiers.json'),
  'utf8',
);

/** The plan view of somebody the biller holds no subscription for. */
export const NO_SUBSCRIPTION_VIEW = {
  plan: 'none',
  planKey: null,
  interval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  portalAvailable: false,
};

/** The plan view of a yearly subscriber whose year renews into the monthly plan. */
export const YEARLY_SUBSCRIBER_VIEW = {
  plan: 'active',
  planKey: 'yearly',
  interval: 'year',
  currentPeriodEnd: '2027-03-15T10:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

/**
 * The handshake, transcribed rather than patched over the fake's answer, for
 * the reason `push-activation.spec.ts` gives.
 *
 * @param plans - what the handshake says about the biller.
 */
function healthBody(plans: boolean) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    envelopeVersion: ENVELOPE_VERSION,
    serviceVersion: 'fake-e2e',
    instance: {
      name: 'openplate-e2e',
      language: 'en',
      mail: false,
      memberInvites: false,
      plans,
      ai: { model: null },
    },
  };
}

/** What the stubbed biller answers. */
export interface PlansStub {
  /** The `GET /plans/me` body. */
  planView: object;
  /** The `GET /plans/offer` body as text, or `null` to answer the shut door's 404. */
  offerBody: string | null;
  /**
   * What `/health` says about the biller, read PER REQUEST, so a spec can
   * switch the door off while a tab is open. Absent means `true`.
   */
  plans?: boolean;
  /**
   * Holds every `GET /plans/me` answer until it settles, so a spec can take a
   * layout reading BEFORE what the plan read draws arrives (M250/03). Absent
   * answers at once.
   */
  planViewGate?: Promise<void>;
  /** Holds every `GET /plans/offer` answer the same way, for a card that reads the offer lazily (M250/04). */
  offerGate?: Promise<void>;
  /**
   * Holds every `/health` answer, read PER REQUEST like `plans`, so a spec can
   * take a layout reading before anything the handshake decides is drawn
   * (the plan entry in the navigation, M250). Absent answers at once.
   */
  healthGate?: Promise<void>;
}

/** Every offer request the page sent, with the query it named, and how often the handshake was read. */
export interface OfferRequests {
  locales: string[];
  healthReads: number;
  /** How many `GET /plans/me` requests arrived, answered or still held. */
  planViews: number;
}

/**
 * Routes the handshake and the two plan reads.
 *
 * @param page - the page, before its first navigation.
 * @param stub - what the biller answers.
 * @returns the offer requests, recorded as they arrive.
 */
export async function routePlansCore(page: Page, stub: PlansStub): Promise<OfferRequests> {
  const requests: OfferRequests = { locales: [], healthReads: 0, planViews: 0 };
  await page.route(`${E2E_CORE_URL}/health`, async (route) => {
    requests.healthReads += 1;
    await stub.healthGate;
    // `plans` is read AFTER the gate, so what a held read answers is what the
    // spec says when it lets the read through.
    await route.fulfill({ json: healthBody(stub.plans ?? true) });
  });
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, async (route) => {
    requests.planViews += 1;
    await stub.planViewGate;
    await route.fulfill({ json: stub.planView });
  });
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/plans/offer`),
    async (route) => {
      requests.locales.push(new URL(route.request().url()).searchParams.get('locale') ?? '');
      await stub.offerGate;
      if (stub.offerBody === null) return route.fulfill({ status: 404, json: { error: 'not found' } });
      return route.fulfill({ status: 200, contentType: 'application/json', body: stub.offerBody });
    },
  );
  return requests;
}

/**
 * A signed-in device standing on the plan page.
 *
 * The last hop is a CLICK on the settings hub's plan row, for the reason
 * `push-activation.spec.ts` records: the session is restored after a document
 * load, and a client navigation keeps the one that is already open. Seeing the
 * address on the hub is how this knows the session has landed.
 *
 * @param page - a page with its routes already installed.
 * @param search - a query string for the plan page, for example `?plan=yearly`.
 */
export async function openPlanPageSignedIn(page: Page, search = ''): Promise<void> {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await page.goto('/settings');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
  if (search === '') {
    // THE HUB'S ROW, inside `main`: on a desktop the sidebar carries a plan
    // entry of its own (M250), and the two are the same address.
    await page.locator('main a[href="/settings/plan"]').click();
  } else {
    await page.goto(`/settings/plan${search}`);
  }
  await page.waitForURL('**/settings/plan**');
}

/** The plan view of a monthly subscriber whose month renews. */
export const MONTHLY_SUBSCRIBER_VIEW = {
  plan: 'active',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: '2026-10-09T10:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

/**
 * A monthly subscriber the biller puts on a tier (M2/04): `GET /plans/me` names
 * the tier by the id the tiers fixture uses. THE SAME VIEW with no `tier` key is
 * today's subscriber, so the pair is the control for the tiers world.
 *
 * @param tier - the tier id, from `tests/fixtures/plan-offer-tiers.json`.
 * @param planKey - the interval of the live plan.
 */
export function subscriberOnTier(tier: string, planKey: 'monthly' | 'yearly' = 'monthly') {
  return {
    ...MONTHLY_SUBSCRIBER_VIEW,
    planKey,
    interval: planKey === 'monthly' ? 'month' : 'year',
    tier,
  };
}

/**
 * A tier subscriber with a downgrade booked (M2): the same view as
 * {@link subscriberOnTier} plus the two fields the biller adds to `GET /plans/me`
 * while a change waits for the end of the period. THE SAME VIEW without them is
 * the control.
 *
 * @param input.tier - the tier the subscriber is on.
 * @param input.pendingTier - the tier the booked change moves to.
 * @param input.pendingChangeAt - the ISO instant the change takes effect.
 */
export function subscriberWithPendingChange(input: { tier: string; pendingTier: string; pendingChangeAt: string }) {
  return {
    ...subscriberOnTier(input.tier),
    pendingTier: input.pendingTier,
    pendingChangeAt: input.pendingChangeAt,
  };
}

/** One answer of the stubbed `POST /v1/plans/order`. */
export interface OrderAnswer {
  status: number;
  json: object;
}

/** What the page posted to the order route, and whether it ever reached for the gone checkout route. */
export interface OrderRequests {
  bodies: unknown[];
  checkoutCalls: number;
}

/**
 * Routes `POST /v1/plans/order` (M245/03), and the checkout route it replaced.
 *
 * The answers are used in order, and the last one repeats, so a spec can
 * answer "stale" once and "go to Stripe" after. The spec names where "Stripe"
 * sends the browser back to, which is how a return from payment is reached
 * without a payment. `POST /v1/plans/checkout` answers 410, as the biller
 * does, and is counted: the page must never reach for it.
 *
 * @param page - the page, before the button is pressed.
 * @param answers - what the biller answers, one per order.
 * @returns the order bodies, recorded as they arrive.
 */
export async function routeOrder(page: Page, answers: readonly OrderAnswer[]): Promise<OrderRequests> {
  const requests: OrderRequests = { bodies: [], checkoutCalls: 0 };
  await page.route(`${E2E_CORE_URL}/v1/plans/order`, (route) => {
    requests.bodies.push(route.request().postDataJSON());
    const answer = answers[Math.min(requests.bodies.length, answers.length) - 1];
    if (answer === undefined) throw new Error('routeOrder was given no answer');
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  await page.route(`${E2E_CORE_URL}/v1/plans/checkout`, (route) => {
    requests.checkoutCalls += 1;
    return route.fulfill({ status: 410, json: { error: 'checkout-gone' } });
  });
  return requests;
}

/** What the page sent to the pending-change cancel route. */
export interface PendingCancelRequests {
  /** The HTTP method of each request, so a spec can say it was a POST and only that. */
  methods: string[];
  /** The raw body of each request, `null` for none: the biller reads none. */
  bodies: Array<string | null>;
}

/**
 * Routes `POST /v1/plans/pending-change/cancel` (M2). The answers are used in
 * order and the last one repeats, like {@link routeOrder}'s.
 *
 * @param page - the page, before the button is pressed.
 * @param answers - what the biller answers, one per press.
 * @param onAnswer - called with each answer as it is given, so a spec can make
 *   the next `GET /plans/me` say what the biller would say after it.
 * @returns the requests, recorded as they arrive.
 */
export async function routePendingCancel(
  page: Page,
  answers: readonly OrderAnswer[],
  onAnswer: (answer: OrderAnswer) => void = () => {},
): Promise<PendingCancelRequests> {
  const requests: PendingCancelRequests = { methods: [], bodies: [] };
  await page.route(`${E2E_CORE_URL}/v1/plans/pending-change/cancel`, (route) => {
    requests.methods.push(route.request().method());
    requests.bodies.push(route.request().postData());
    const answer = answers[Math.min(requests.methods.length, answers.length) - 1];
    if (answer === undefined) throw new Error('routePendingCancel was given no answer');
    onAnswer(answer);
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return requests;
}

/** What the page posted to the portal route. */
export interface PortalRequests {
  bodies: unknown[];
}

/**
 * Routes `POST /v1/plans/portal` and records each body the page sent. The
 * answer sends the browser to `returnTo`, standing in for Stripe's portal, so
 * the press ends on a page of this app rather than on the network.
 *
 * @param page - the page, before the button is pressed.
 * @param returnTo - the address the answer names.
 * @returns the portal bodies, recorded as they arrive.
 */
export async function routePortal(page: Page, returnTo: string): Promise<PortalRequests> {
  const requests: PortalRequests = { bodies: [] };
  await page.route(`${E2E_CORE_URL}/v1/plans/portal`, (route) => {
    requests.bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { url: returnTo } });
  });
  return requests;
}

/** The fields an allowance sets, leaving an absent `createdAt` and `trialScans` as the fake's own. */
function accountPatch({
  dailyAiLimit,
  allowanceExpiresAt,
  createdAt,
  trialScans,
  capabilities,
}: AccountAllowance): AccountAllowance {
  const patch: AccountAllowance = { dailyAiLimit, allowanceExpiresAt };
  if (createdAt !== undefined) patch.createdAt = createdAt;
  if (trialScans !== undefined) patch.trialScans = trialScans;
  if (capabilities !== undefined) patch.capabilities = capabilities;
  return patch;
}

/** An auth answer that carries the account, every other key kept as the fake sent it. */
const accountEnvelopeSchema = z.looseObject({ account: z.record(z.string(), z.unknown()) });

/** The allowance facts a spec gives the fixture account. */
export interface AccountAllowance {
  dailyAiLimit: number;
  /** The ISO instant the allowance ends, or `null` for none. */
  allowanceExpiresAt: string | null;
  /**
   * The ISO instant the account says it was created, or absent for the fake's
   * own. The trial recap counts from it (M250/05), and the fixture account is
   * shared by every spec in a run, so a spec that counts its own meals starts
   * the account at its own start and leaves earlier specs' meals outside.
   */
  createdAt?: string;
  /**
   * The account's free AI scans (M253/05), or absent for the fake's own, which
   * sends none, like a core older than the field.
   */
  trialScans?: { granted: number; left: number } | null;
  /**
   * The account's effective feature list (M2/05): the labels its plan includes,
   * `null` for everything, or absent to leave the key out, as a core older than
   * the field does. Absent and `null` both read as open on the device.
   */
  capabilities?: readonly string[] | null;
}

/**
 * Gives the fixture account an allowance, on every auth answer that carries
 * the account (the sign-in, the resume, the account read).
 *
 * THE FAKE SERVICE IS LEFT ALONE. It models the sync protocol and holds no
 * allowance dates, which is right for it; a trial is a fact about a consumer
 * instance, so it is written onto the wire here, the way the handshake's
 * `plans: true` is. Everything else in the body is the fake's own answer.
 *
 * @param page - the page, before its first navigation.
 * @param allowance - what the account answers.
 */
export async function routeAccountAllowance(page: Page, allowance: AccountAllowance): Promise<void> {
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/auth/`),
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const envelope = accountEnvelopeSchema.safeParse(text === '' ? null : JSON.parse(text));
      if (!envelope.success) return route.fulfill({ response, body: text });
      return route.fulfill({
        response,
        json: { ...envelope.data, account: { ...envelope.data.account, ...accountPatch(allowance) } },
      });
    },
  );
}

/** A promise a spec settles by hand, for `PlansStub.planViewGate`. */
export interface Gate {
  promise: Promise<void>;
  open: () => void;
}

/** A closed gate. `open()` lets everything it holds through, once and for good. */
export function createGate(): Gate {
  let resolveGate: (() => void) | null = null;
  const promise = new Promise<void>((settle) => {
    resolveGate = settle;
  });
  return { promise, open: () => resolveGate?.() };
}
