/**
 * A managed core, stubbed for the M253/11 specs: the handshake, the plan
 * reads, the account facts, and the AI proxy.
 *
 * The fake sync service (`global-setup.ts`) stays the source of the session,
 * the sign-in and the diary. Only the facts a consumer instance adds on top
 * of the sync protocol are written onto the wire here, the way `plans-stub.ts`
 * writes `plans: true`: the trial, the allowance, the invite cap and whether
 * invitations wait for a plan.
 *
 * Every field is read PER REQUEST, so a spec can move the account between two
 * reads (a scan trial running out, a plan being bought).
 */
import { expect, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_SYNC_SERVER_URL } from './env';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW } from './plans-stub';

/** What the stubbed core says. Mutate it between loads to move the account. */
export interface ManagedCoreStub {
  /** `AccountView.trialScans`, or `null` for an account with no scan trial. */
  trialScans: { granted: number; left: number } | null;
  /** `AccountView.allowanceExpiresAt`: a paid or granted window, or `null`. */
  allowanceExpiresAt: string | null;
  /** `AccountView.dailyAiLimit`. */
  dailyAiLimit: number;
  /** `AccountView.invitesLeft`. */
  invitesLeft: number | null;
  /** `AccountView.invitesNeedAPlan` (M253/11), or `undefined` to leave the key out, as an older core does. */
  invitesNeedAPlan?: boolean;
  /** `instance.memberInvites` on the handshake. */
  memberInvites: boolean;
  /** The `GET /v1/plans/me` body. */
  planView: object;
  /** Holds every `/health` answer until it settles, for a reading taken before the handshake lands. */
  healthGate?: Promise<void>;
}

/** A trial account that has scans left, on an instance with member invites. */
export function trialAccountStub(left: number): ManagedCoreStub {
  return {
    trialScans: { granted: 10, left },
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: 0,
    invitesNeedAPlan: true,
    memberInvites: true,
    planView: NO_SUBSCRIPTION_VIEW,
  };
}

/** An auth answer that carries the account, every other key kept as the fake sent it. */
const accountEnvelopeSchema = z.looseObject({ account: z.record(z.string(), z.unknown()) });

/** The account fields the stub writes. */
function accountPatch(stub: ManagedCoreStub) {
  const base = {
    dailyAiLimit: stub.dailyAiLimit,
    allowanceExpiresAt: stub.allowanceExpiresAt,
    invitesLeft: stub.invitesLeft,
    trialScans: stub.trialScans,
  };
  return stub.invitesNeedAPlan === undefined ? base : { ...base, invitesNeedAPlan: stub.invitesNeedAPlan };
}

/**
 * Routes the handshake, the plan reads and every auth answer that carries the account.
 *
 * @param page - the page, before its first navigation.
 * @param stub - what the core says, read per request.
 */
export async function routeManagedCore(page: Page, stub: ManagedCoreStub): Promise<void> {
  await page.route(`${E2E_SYNC_SERVER_URL}/health`, async (route) => {
    await stub.healthGate;
    await route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: {
          name: 'openplate-e2e',
          language: 'en',
          mail: true,
          memberInvites: stub.memberInvites,
          plans: true,
          openSignup: true,
          ai: { model: 'e2e-model' },
          trial: { scans: 10 },
        },
      },
    });
  });
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/plans/me`, (route) => route.fulfill({ json: stub.planView }));
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/plans/offer`),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE_OFFER_BODY }),
  );
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/auth/`),
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const envelope = accountEnvelopeSchema.safeParse(text === '' ? null : JSON.parse(text));
      if (!envelope.success) return route.fulfill({ response, body: text });
      return route.fulfill({
        response,
        json: { ...envelope.data, account: { ...envelope.data.account, ...accountPatch(stub) } },
      });
    },
  );
}

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
export const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** One food, every field of the plate schema present. */
const PLATE_ANSWER = {
  foods: [
    {
      name: 'Managed stub rye bread',
      estimatedGrams: 40,
      confidence: 'high',
      portionHint: null,
      macrosPer100g: { carbs: 40, fiber: 6, sugars: null, polyols: null, protein: 8, fat: 3, kcal: 230 },
      macroSource: 'estimated',
      carbBasis: null,
      brand: null,
      servingSize: null,
    },
  ],
  unreadable: false,
  unreadableReason: null,
  notes: null,
};

/** CORS for a stubbed cross-origin answer, including the one header the app must read. */
function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers().origin ?? '*',
    'Access-Control-Expose-Headers': 'X-Trial-Scans-Left',
  };
}

/**
 * Routes the AI proxy: every plate read answers one food, spends one of the
 * stub's trial scans, and states the scans left in `X-Trial-Scans-Left`, as
 * the core does. The ACCOUNT read keeps saying what the stub says, so the
 * spec decides whether the two agree.
 *
 * @param page - the page, before its first navigation.
 * @param counter - the scans left, moved by each answer.
 */
export async function routeManagedProxy(page: Page, counter: { left: number }): Promise<void> {
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/chat/completions`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...corsHeaders(request),
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': request.headers()['access-control-request-headers'] ?? '*',
        },
      });
    }
    counter.left = Math.max(0, counter.left - 1);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...corsHeaders(request), 'X-Trial-Scans-Left': String(counter.left) },
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(PLATE_ANSWER) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    });
  });
}

/**
 * Signs the fixture account in on a managed build, finishing onboarding when
 * its diary holds no profile yet (a managed spec run alone meets a fresh
 * fake service).
 *
 * @param page - a page with its routes installed.
 * @param serverUrl - the managed server's base URL.
 */
export async function signInManaged(page: Page, serverUrl: string): Promise<void> {
  await page.goto(`${serverUrl}/sign-in`);
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|onboarding)/);
  if (!page.url().includes('/onboarding')) return;
  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();
  await page.waitForURL('**/diary');
}
