/**
 * A core that sells plans, stubbed for the browser tier (M250).
 *
 * The fake sync service (`tests/integration/fake-sync-service.ts`) is a reading
 * of the SYNC protocol and has no biller behind it, which is exactly right:
 * `PROTOCOL.md` §5.22 says `/v1/plans/*` is not part of the protocol. So a
 * spec about plans routes three things on top of the real fake:
 *
 *  - `/health`, answering the fake's own handshake with `plans: true`, so the
 *    plan door opens through the handshake and never through a probe;
 *  - `GET /v1/plans/me`, answering the plan view the spec names;
 *  - `GET /v1/plans/offer`, answering `tests/fixtures/plan-offer.json`, whose
 *    texts are neutral placeholders. No real order or legal sentence and no
 *    real price reaches this tier.
 *
 * Everything else, the account, the session and the sign-in, is the fake
 * service's own, so the page reads its plan over a real session.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { E2E_ACCOUNT_EMAIL, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';

/**
 * The neutral fixture offer, read off disk so the browser is served the same
 * bytes the unit tier decodes.
 */
export const FIXTURE_OFFER_BODY: string = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/plan-offer.json'),
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
}

/** Every offer request the page sent, with the query it named, and how often the handshake was read. */
export interface OfferRequests {
  locales: string[];
  healthReads: number;
}

/**
 * Routes the handshake and the two plan reads.
 *
 * @param page - the page, before its first navigation.
 * @param stub - what the biller answers.
 * @returns the offer requests, recorded as they arrive.
 */
export async function routePlansCore(page: Page, stub: PlansStub): Promise<OfferRequests> {
  const requests: OfferRequests = { locales: [], healthReads: 0 };
  await page.route(`${E2E_SYNC_SERVER_URL}/health`, (route) => {
    requests.healthReads += 1;
    return route.fulfill({ json: healthBody(stub.plans ?? true) });
  });
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/plans/me`, (route) => route.fulfill({ json: stub.planView }));
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/plans/offer`),
    (route) => {
      requests.locales.push(new URL(route.request().url()).searchParams.get('locale') ?? '');
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
    await page.locator('a[href="/settings/plan"]').click();
  } else {
    await page.goto(`/settings/plan${search}`);
  }
  await page.waitForURL('**/settings/plan**');
}

/**
 * Routes `POST /v1/plans/checkout` to answer an address, standing in for the
 * Stripe page the biller would open. The spec names where "Stripe" sends the
 * browser back to, which is how a return from payment is reached without a
 * payment.
 *
 * @param page - the page, before the button is pressed.
 * @param url - the address the checkout answers.
 */
export async function routeCheckout(page: Page, url: string): Promise<void> {
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/plans/checkout`, (route) => route.fulfill({ json: { url } }));
}
