/**
 * An account whose first setup never finished, and which never agreed to the
 * consent, is asked for the consent first and then finishes setup (review of
 * M266, 2026-09-29).
 *
 * THE CASE. An account that exists with no key records is repaired by the
 * next sign-in: `signInToSync` answers `setup-incomplete` and the sign-in page
 * runs the setup ceremony, which writes both key records. openplate-core
 * refuses those writes with `403 health-consent-required` to an account that
 * does not hold the instance's current consent, and the sign-in page sits
 * outside the layout that asks for it.
 *
 * WHAT IS REAL: the production build, the fake core server's login and
 * account, the sign-in page, the setup ceremony and its key derivation, the
 * first pull, and the consent gate on the diary. WHAT IS STUBBED: the
 * handshake and the account facts (`managed-core-stub.ts`), and the account's
 * own key records and blob (below), because the shared fixture account
 * already holds both and this file needs an account that holds neither.
 *
 * THE PROMPT AND ITS TWIN differ in one stubbed fact, whether the account
 * holds the consent, so a sign-in that asked everybody fails the twin.
 *
 * @area health-consent
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_CORE_URL } from './env';
import { completeOnboarding } from './helpers';
import {
  HEALTH_CONSENT_REQUIRED,
  refusesForConsent,
  routeManagedCore,
  type ManagedCoreStub,
} from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** Onboarding, a sign-in, two production-cost derivations and a first pull outlast the tier's 30 s per spec. */
const WALK_BUDGET_MS = 120_000;

/** The ceremony derives from the password at production cost before it writes anything. */
const CEREMONY_WAIT_MS = 45_000;

/** How long a press that must send nothing is watched. */
const SILENCE_WATCH_MS = 1_500;

/** The wording the stubbed instance asks consent to. */
const VERSION = '2026-09-28';

/** An instant for a consent on record. */
const AGREED_AT = '2026-09-04T10:11:12.000Z';

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({ healthConsent: z.object({ agree: z.string(), requiredToContinue: z.string() }) })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A member with free scans left, on an instance that asks the current wording. */
function core(accountHealthConsent: ManagedCoreStub['accountHealthConsent']): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: '2030-01-01T00:00:00.000Z',
    dailyAiLimit: 20,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: false,
    healthConsent: { version: VERSION },
    accountHealthConsent,
  };
}

/** One stored key record, in the shape `GET /v1/sync/key-records` lists it. */
interface StoredKeyRecord {
  kind: string;
  kdfDescriptor: unknown;
  wrappedDek: string;
  updatedAt: string;
}

/** The account's own sync rows, as the stand-in below holds them, and the order of the writes that matter. */
interface OwnSyncRows {
  keyRecords: Map<string, StoredKeyRecord>;
  blob: { blobVersion: number; envelopeVersion: number; ciphertext: string; createdAt: string } | null;
  /** `consent` for each consent post and `key-record` for each key-record write, in the order they were sent. */
  writes: string[];
}

const keyRecordBodySchema = z.object({
  kdfDescriptor: z.unknown(),
  wrappedDek: z.string(),
  expectedUpdatedAt: z.string().nullable(),
});
const blobPushBodySchema = z.object({ baseVersion: z.number(), envelopeVersion: z.number(), ciphertext: z.string() });

/** CORS for a stubbed cross-origin answer. */
function cors(request: Request) {
  return { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' };
}

/**
 * Stands in for the account's key records and blob, starting with neither,
 * which is an account whose first setup never finished. Writes follow the
 * core's consent rule: `403 health-consent-required` while the stub's account
 * does not hold the instance's version.
 */
async function routeUnfinishedAccount(page: Page, stub: ManagedCoreStub): Promise<OwnSyncRows> {
  const rows: OwnSyncRows = { keyRecords: new Map(), blob: null, writes: [] };
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === '/v1/auth/account/health-consent') rows.writes.push('consent');
    if (request.method() === 'PUT' && path.startsWith('/v1/sync/key-records/')) rows.writes.push('key-record');
  });
  await page.route(
    (url) => url.href.startsWith(`${E2E_CORE_URL}/v1/sync/key-records`) || url.href.startsWith(`${E2E_CORE_URL}/v1/sync/blob`),
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') return route.fallback();
      if (request.method() === 'GET' && path === '/v1/sync/key-records') {
        return route.fulfill({ headers: cors(request), json: { records: [...rows.keyRecords.values()] } });
      }
      if (request.method() === 'GET' && path === '/v1/sync/blob') {
        if (rows.blob === null) return route.fulfill({ status: 404, headers: cors(request), json: { error: 'none' } });
        return route.fulfill({ headers: cors(request), json: rows.blob });
      }
      if (refusesForConsent(stub)) {
        return route.fulfill({ status: 403, headers: cors(request), json: { error: HEALTH_CONSENT_REQUIRED } });
      }
      if (request.method() === 'PUT') {
        const kind = path.slice('/v1/sync/key-records/'.length);
        const body = keyRecordBodySchema.parse(request.postDataJSON());
        const existing = rows.keyRecords.get(kind) ?? null;
        if ((existing?.updatedAt ?? null) !== body.expectedUpdatedAt) {
          return route.fulfill({
            status: 409,
            headers: cors(request),
            json: { currentUpdatedAt: existing?.updatedAt ?? null },
          });
        }
        const stored: StoredKeyRecord = { kind, ...body, updatedAt: new Date().toISOString() };
        rows.keyRecords.set(kind, stored);
        return route.fulfill({ headers: cors(request), json: stored });
      }
      const body = blobPushBodySchema.parse(request.postDataJSON());
      const current = rows.blob?.blobVersion ?? 0;
      if (body.baseVersion !== current) {
        return route.fulfill({ status: 409, headers: cors(request), json: { currentVersion: current } });
      }
      rows.blob = { ...body, blobVersion: current + 1, createdAt: new Date().toISOString() };
      return route.fulfill({ headers: cors(request), json: { newVersion: current + 1 } });
    },
  );
  return rows;
}

/** Signs in on a device past onboarding, which starts the repair of the unfinished setup. */
async function signIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
}

function consentBox(page: Page) {
  return page.locator('[data-slot="health-consent-box"]');
}

test('an unfinished setup asks for the consent first, then finishes and opens the diary', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core(null);
  await routeManagedCore(page, stub);
  const rows = await routeUnfinishedAccount(page, stub);
  await signIn(page);

  // ── Asked before anything is written ────────────────────────────────
  await expect(consentBox(page), 'the repair did not ask for the consent').toBeVisible({ timeout: CEREMONY_WAIT_MS });
  await expect(consentBox(page)).not.toBeChecked();
  expect(rows.writes, 'something was written before the consent was asked').toEqual([]);
  await expect(page.getByText(HEALTH_CONSENT_REQUIRED)).toHaveCount(0);

  // ── An unticked box says so and sends nothing ───────────────────────
  await page.getByRole('button', { name: COPY.healthConsent.agree, exact: true }).click();
  await expect(page.getByText(COPY.healthConsent.requiredToContinue, { exact: true })).toBeVisible();
  await page.waitForTimeout(SILENCE_WATCH_MS);
  expect(rows.writes).toEqual([]);

  // ── Ticked: the consent, then the setup, then the diary ─────────────
  await consentBox(page).check();
  await page.getByRole('button', { name: COPY.healthConsent.agree, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/diary', { timeout: CEREMONY_WAIT_MS });
  expect(rows.writes, 'the consent must be recorded before the first key record').toEqual([
    'consent',
    'key-record',
    'key-record',
  ]);
  expect(stub.accountHealthConsent?.version, 'the core recorded no consent').toBe(VERSION);
  expect([...rows.keyRecords.keys()].toSorted()).toEqual(['passphrase', 'recovery']);
  expect(rows.blob, 'the first pull did not push the diary').not.toBeNull();
});

test('the twin: an unfinished setup of an account that agreed finishes without asking', async ({ page }) => {
  test.setTimeout(WALK_BUDGET_MS);
  const stub = core({ version: VERSION, at: AGREED_AT });
  await routeManagedCore(page, stub);
  const rows = await routeUnfinishedAccount(page, stub);
  await signIn(page);

  await page.waitForURL((url) => url.pathname === '/diary', { timeout: CEREMONY_WAIT_MS });
  expect(rows.writes).toEqual(['key-record', 'key-record']);
  expect([...rows.keyRecords.keys()].toSorted()).toEqual(['passphrase', 'recovery']);
  await expect(consentBox(page)).toHaveCount(0);
});
