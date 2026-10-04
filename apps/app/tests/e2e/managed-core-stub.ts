/**
 * A managed core, stubbed for the M253/11 specs: the handshake, the plan
 * reads, the account facts, and the AI proxy.
 *
 * The fake core server (`global-setup.ts`) stays the source of the session,
 * the sign-in and the diary. Only the facts a consumer instance adds on top
 * of the sync protocol are written onto the wire here, the way `plans-stub.ts`
 * writes `plans: true`: the trial, the allowance, the invite cap and whether
 * invitations wait for a plan.
 *
 * Every field is read PER REQUEST, so a spec can move the account between two
 * reads (a scan trial running out, a plan being bought).
 *
 * THE CONSENT RULE, OPT IN (2026-09-29). `routeConsentRequiredSync` and
 * `routeConsentRequiredProxy` answer sync writes and scans with the core's
 * `403 health-consent-required` while the stub's account does not hold the
 * instance's version, so a spec can change the wording while a page is open
 * and watch the app meet the refusal. Specs that do not call them keep the
 * fake core server's answers, which ask nothing.
 */
import { expect, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_CORE_URL } from './env';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW } from './plans-stub';
import { fetchRouteText, fulfilUnlessAbandoned } from './route-fetch';

/** What the stubbed core says. Mutate it between loads to move the account. */
export interface ManagedCoreStub {
  /** `AccountView.trialScans`, or `null` for an account with no scan trial. */
  trialScans: { granted: number; left: number } | null;
  /**
   * `AccountView.trialEndsAt` (M267): when the free tier ends by the
   * calendar, `null` for no end date, or absent to leave the key out, as a
   * core older than the field does.
   */
  trialEndsAt?: string | null;
  /** `instance.trial.days` on the handshake (M267), or absent for a trial with no day limit. */
  trialDays?: number;
  /** `AccountView.createdAt`, or absent to keep the fake's own instant. The lock screen counts the days from it. */
  createdAt?: string;
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
  /** `instance.plans` on the handshake, or absent for `true`. `false` is the beta and self-hosted shape. */
  plans?: boolean;
  /** `AccountView.role`, or absent to keep the fake's own (a member). */
  role?: 'admin' | 'member';
  /** `AccountView.displayName`, or absent to keep the fake's own (the fixture account has none). */
  displayName?: string | null;
  /**
   * `instance.healthConsent` on the handshake (`PROTOCOL.md` §5.6): the
   * version of the wording a person agrees to, `null` for an instance that
   * asks nothing, or absent to leave the key out as a core older than the
   * field does. Read per request, so a spec can change the wording while a
   * page is open.
   */
  healthConsent?: { version: string } | null;
  /**
   * `AccountView.healthConsent`: the consent on record, `null` for none, or
   * absent to leave the key out. The consent route below writes it, the way
   * the core does, so a reload reads what was agreed to.
   */
  accountHealthConsent?: { version: string; at: string } | null;
  /**
   * What the core answers to `POST /v1/auth/refresh`, or absent to leave the
   * fake core server's own answer (a rotated pair). `unauthorized` is a
   * revoked token family (`401`); `suspended` is an account an administrator
   * suspended (`403 account-suspended`, `PROTOCOL.md` §4). Read per request,
   * so a spec can sign in normally and then end the session on the next load.
   */
  refreshRefusal?: 'unauthorized' | 'suspended';
  /**
   * `AccountView.capabilities` (M2/05): the labels the plan includes, `null` for
   * everything, or absent to leave the key out as a core older than the field
   * does. Read per request.
   */
  capabilities?: readonly string[] | null;
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

/** The body of `POST /v1/auth/account/health-consent` (`PROTOCOL.md` §5.15.1). */
const healthConsentBodySchema = z.object({ version: z.string() });

/** The `403` body the core uses for a suspended account (`PROTOCOL.md` §4), the token `sync-error.ts` reads. */
const ACCOUNT_SUSPENDED = 'account-suspended';

/** The one refusal of both consent paths, transcribed from `PROTOCOL.md` §5.15.1. */
export const HEALTH_CONSENT_REQUIRED = 'health-consent-required';

/** The account fields the stub writes. */
function accountPatch(stub: ManagedCoreStub) {
  const base = {
    dailyAiLimit: stub.dailyAiLimit,
    allowanceExpiresAt: stub.allowanceExpiresAt,
    invitesLeft: stub.invitesLeft,
    trialScans: stub.trialScans,
  };
  const withCreated = stub.createdAt === undefined ? base : { ...base, createdAt: stub.createdAt };
  const withEnd = stub.trialEndsAt === undefined ? withCreated : { ...withCreated, trialEndsAt: stub.trialEndsAt };
  const withRole = stub.role === undefined ? withEnd : { ...withEnd, role: stub.role };
  const withName = stub.displayName === undefined ? withRole : { ...withRole, displayName: stub.displayName };
  const withInvites =
    stub.invitesNeedAPlan === undefined ? withName : { ...withName, invitesNeedAPlan: stub.invitesNeedAPlan };
  const withConsent =
    stub.accountHealthConsent === undefined ? withInvites : { ...withInvites, healthConsent: stub.accountHealthConsent };
  return stub.capabilities === undefined ? withConsent : { ...withConsent, capabilities: stub.capabilities };
}

/** The handshake's instance block, with `healthConsent` only when the stub names one. */
function instanceBlock(stub: ManagedCoreStub) {
  const instance = new Map<string, unknown>([
    ['name', 'openplate-e2e'],
    ['language', 'en'],
    ['mail', true],
    ['memberInvites', stub.memberInvites],
    ['plans', stub.plans ?? true],
    ['openSignup', true],
    ['ai', { model: 'e2e-model' }],
    ['trial', stub.trialDays === undefined ? { scans: 10 } : { scans: 10, days: stub.trialDays }],
  ]);
  if (stub.healthConsent !== undefined) instance.set('healthConsent', stub.healthConsent);
  return Object.fromEntries(instance);
}

/**
 * Routes the handshake, the plan reads and every auth answer that carries the account.
 *
 * @param page - the page, before its first navigation.
 * @param stub - what the core says, read per request.
 */
export async function routeManagedCore(page: Page, stub: ManagedCoreStub): Promise<void> {
  await page.route(`${E2E_CORE_URL}/health`, async (route) => {
    await stub.healthGate;
    await route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: instanceBlock(stub),
      },
    });
  });
  await page.route(`${E2E_CORE_URL}/v1/plans/me`, (route) => route.fulfill({ json: stub.planView }));
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/plans/offer`),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE_OFFER_BODY }),
  );
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/auth/`),
    async (route) => {
      // A spec that loads a new document mid-request drops this one: see `route-fetch.ts`.
      const fetched = await fetchRouteText(route);
      if (fetched === null) return;
      const { response, text } = fetched;
      const envelope = accountEnvelopeSchema.safeParse(text === '' ? null : JSON.parse(text));
      if (!envelope.success) return fulfilUnlessAbandoned(() => route.fulfill({ response, body: text }));
      return fulfilUnlessAbandoned(() =>
        route.fulfill({
          response,
          json: { ...envelope.data, account: { ...envelope.data.account, ...accountPatch(stub) } },
        }),
      );
    },
  );
  // REGISTERED AFTER the route above, so it answers first. The refresh is the
  // call a resumed session spends first, so refusing it is how a spec ends a
  // session the SERVER ended, in the two ways the core can: a revoked token
  // family and a suspended account.
  await page.route(`${E2E_CORE_URL}/v1/auth/refresh`, (route) => {
    const request = route.request();
    // The preflight goes on to the fake service, which answers it for every path.
    if (request.method() !== 'POST' || stub.refreshRefusal === undefined) return route.fallback();
    const cors = { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' };
    if (stub.refreshRefusal === 'suspended') {
      return route.fulfill({ status: 403, headers: cors, json: { error: ACCOUNT_SUSPENDED } });
    }
    return route.fulfill({ status: 401, headers: cors, json: { error: 'invalid refresh token' } });
  });
  // REGISTERED AFTER the route above, so it answers first (`PROTOCOL.md`
  // §5.15.1). The fake service has no such route; this is the core's rule:
  // 404 where the instance asks nothing, 400 for another version, and 200
  // with the account otherwise, keeping the first instant on a repeat.
  await page.route(`${E2E_CORE_URL}/v1/auth/account/health-consent`, async (route) => {
    const request = route.request();
    // The preflight goes on to the fake service, which answers it for every path.
    if (request.method() !== 'POST') return route.fallback();
    const cors = { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' };
    const asked = stub.healthConsent ?? null;
    if (asked === null) return route.fulfill({ status: 404, headers: cors, json: { error: 'not found' } });
    const body = healthConsentBodySchema.safeParse(request.postDataJSON());
    if (!body.success || body.data.version !== asked.version) {
      return route.fulfill({ status: 400, headers: cors, json: { error: HEALTH_CONSENT_REQUIRED } });
    }
    if (stub.accountHealthConsent?.version !== asked.version) {
      stub.accountHealthConsent = { version: asked.version, at: new Date().toISOString() };
    }
    const authorization = request.headers().authorization ?? '';
    const read = await fetch(`${E2E_CORE_URL}/v1/auth/account`, { headers: { authorization } });
    const envelope = accountEnvelopeSchema.parse(await read.json());
    return route.fulfill({
      status: read.status,
      headers: cors,
      json: { ...envelope, account: { ...envelope.account, ...accountPatch(stub) } },
    });
  });
}

/** What the sync refusal below saw: every write it let through and every one it refused. */
export interface SyncWriteLog {
  accepted: number;
  refused: number;
}

/**
 * Whether the stubbed core refuses a data route to this account, by the
 * core's own rule (`PROTOCOL.md` §4): the instance names a version and the
 * account does not hold exactly that one.
 */
export function refusesForConsent(stub: ManagedCoreStub): boolean {
  const asked = stub.healthConsent ?? null;
  return asked !== null && stub.accountHealthConsent?.version !== asked.version;
}

/**
 * The two reads under `/v1/sync` an account without the consent keeps (its
 * own blob and its own key records), so sign-in and the export still work.
 */
function isOwnCopyRead(request: Request): boolean {
  if (request.method() !== 'GET') return false;
  const path = new URL(request.url()).pathname;
  return path === '/v1/sync/blob' || path === '/v1/sync/key-records';
}

/**
 * Routes every sync write through the core's consent rule: `403
 * health-consent-required` while the stub's account does not hold the
 * instance's version, the fake core server otherwise. Read per request, so a
 * spec can change the wording while a page is open and the next push meets it.
 *
 * @param page - the page, before its first navigation.
 * @param stub - what the core says, the same object `routeManagedCore` reads.
 * @returns the writes seen so far, counted as they arrive.
 */
export async function routeConsentRequiredSync(page: Page, stub: ManagedCoreStub): Promise<SyncWriteLog> {
  const log: SyncWriteLog = { accepted: 0, refused: 0 };
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/sync/`),
    (route) => {
      const request = route.request();
      // The preflight goes on to the fake service, which answers it for every path.
      if (request.method() === 'OPTIONS' || isOwnCopyRead(request)) return route.fallback();
      if (!refusesForConsent(stub)) {
        log.accepted += 1;
        return route.fallback();
      }
      log.refused += 1;
      const cors = { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' };
      return route.fulfill({ status: 403, headers: cors, json: { error: HEALTH_CONSENT_REQUIRED } });
    },
  );
  return log;
}

/** The three account routes the core refuses to an account without the consent (`PROTOCOL.md` §5.15.1). */
function isConsentGatedAccountWrite(request: Request): boolean {
  const path = new URL(request.url()).pathname;
  if (request.method() === 'PATCH') return path === '/v1/auth/account';
  if (request.method() !== 'POST') return false;
  return path === '/v1/auth/invites' || path === '/v1/auth/change-passphrase';
}

/**
 * Routes the account page's three writes through the core's consent rule:
 * renaming the account, inviting somebody and changing the passphrase answer
 * `403 health-consent-required` while the stub's account does not hold the
 * instance's version, and reach the fake core server otherwise. Registered
 * AFTER `routeManagedCore`, so it answers first.
 *
 * @param page - the page, before its first navigation.
 * @param stub - what the core says, the same object `routeManagedCore` reads.
 * @returns how many writes were refused, counted as they arrive.
 */
export async function routeConsentRequiredAccountWrites(page: Page, stub: ManagedCoreStub): Promise<{ refused: number }> {
  const log = { refused: 0 };
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/auth/`),
    (route) => {
      const request = route.request();
      if (!isConsentGatedAccountWrite(request) || !refusesForConsent(stub)) return route.fallback();
      log.refused += 1;
      const cors = { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' };
      return route.fulfill({ status: 403, headers: cors, json: { error: HEALTH_CONSENT_REQUIRED } });
    },
  );
  return log;
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
  await page.route(`${E2E_CORE_URL}/v1/chat/completions`, (route) => {
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

/** What the consent-ruled proxy below saw: every scan it answered and every one it refused. */
export interface ProxyCallLog {
  answered: number;
  refused: number;
}

/**
 * Routes the AI proxy through the core's consent rule, like
 * {@link routeConsentRequiredSync} does for sync writes: `403
 * health-consent-required` while the stub's account does not hold the
 * instance's version (`PROTOCOL.md` §5.19), one food otherwise. Read per
 * request, so a spec can change the wording while the scan screen is open.
 *
 * @param page - the page, before its first navigation.
 * @param stub - what the core says, the same object `routeManagedCore` reads.
 * @returns the scans seen so far, counted as they arrive.
 */
export async function routeConsentRequiredProxy(page: Page, stub: ManagedCoreStub): Promise<ProxyCallLog> {
  const log: ProxyCallLog = { answered: 0, refused: 0 };
  await page.route(`${E2E_CORE_URL}/v1/chat/completions`, (route) => {
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
    if (refusesForConsent(stub)) {
      log.refused += 1;
      return route.fulfill({ status: 403, headers: corsHeaders(request), json: { error: HEALTH_CONSENT_REQUIRED } });
    }
    log.answered += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders(request),
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(PLATE_ANSWER) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    });
  });
  return log;
}

/**
 * Signs the fixture account in on a managed build, finishing onboarding when
 * its diary holds no profile yet (a managed spec run alone meets a fresh
 * fake service).
 *
 * A LOCKED ACCOUNT ENDS ON THE PLAN PAGE (the paywall, 2026-09-28): a stub
 * with the free scans spent and no plan signs in there, after onboarding when
 * there was one to finish.
 *
 * @param page - a page with its routes installed.
 * @param serverUrl - the managed server's base URL.
 */
export async function signInManaged(page: Page, serverUrl: string): Promise<void> {
  await page.goto(`${serverUrl}/sign-in`);
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|onboarding|settings\/plan)/);
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
  await page.waitForURL(/\/(diary|settings\/plan)$/);
}
