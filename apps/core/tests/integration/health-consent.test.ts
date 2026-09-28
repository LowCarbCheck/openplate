/**
 * Explicit consent to health data (Art. 9(2)(a) GDPR), against the real app,
 * the real routes and Postgres with the committed migrations.
 *
 * THE CONTRACT, END TO END. `/health` publishes `instance.healthConsent`, a
 * version or `null`. On an instance that asks, `POST /v1/auth/signup` without
 * the matching `healthConsent` is `400 health-consent-required` and spends
 * nothing, so the same invite works once the box is ticked. The account view
 * carries `healthConsent: {version, at}` on every surface that returns one.
 * `POST /v1/auth/account/health-consent` records it for an account that
 * predates the version, keeps the first instant on a repeat, and takes a new
 * version. An instance that asks for none ignores the field and answers the
 * prompt route with the ordinary unknown-path 404. The operator reads the
 * consent and cannot write it. Postgres refuses half a consent.
 *
 * AN ACCOUNT FROM BEFORE THE VERSION is made the way production makes one:
 * signed up on a service that asked for nothing, then read by a service on
 * the same database that asks. No row is written by hand.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { sampleAuthHash, sampleSignupBody, startService, type ServiceHarness } from './service-harness.js';
import { accounts } from '../../src/db/schema.js';
import { sqlstate } from '../../src/lib/storage-conflict.js';
import { asObject, type JsonValue } from '../../src/lib/json.js';
import type { SessionResponse } from '../../src/accounts/auth-handlers.js';
import type { AccountView } from '../../src/protocol.js';

const VERSION = '2026-09-28';
const NEXT_VERSION = '2027-01-15';
const EMAIL = 'anna@example.org';
const ADMIN_TOKEN = 'admin-token-for-the-consent-suite-0123456789';
/** Postgres SQLSTATE for a violated CHECK constraint. */
const CHECK_VIOLATION = '23514';

let database: TestDatabase;
/** Every service a test starts, closed after it whatever happened. */
const running: ServiceHarness[] = [];

before(async () => {
  database = await setupTestDatabase();
});

beforeEach(async () => {
  for (const service of running.splice(0)) await service.close();
  await database.reset();
});

after(async () => {
  for (const service of running.splice(0)) await service.close();
  await database.close();
});

async function serve(options: { healthConsent?: string; adminToken?: string } = {}): Promise<ServiceHarness> {
  const service = await startService({
    db: database.db,
    healthConsent: options.healthConsent === undefined ? null : { version: options.healthConsent },
    adminToken: options.adminToken ?? null,
  });
  running.push(service);
  return service;
}

/** The two consent columns as the real store reads them, so a test sees the row and not only a response. */
async function storedConsent(accountId: number): Promise<{ version: string | null; at: Date | null }> {
  const [row] = await database.db
    .select({ version: accounts.healthConsentVersion, at: accounts.healthConsentAt })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!row) throw new Error(`no account ${accountId}`);
  return row;
}

async function accountCount(): Promise<number> {
  const result = await database.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM accounts');
  return result.rows[0]?.n ?? -1;
}

async function inviteIsRedeemed(): Promise<boolean> {
  const result = await database.pool.query<{ redeemed: boolean }>(
    'SELECT redeemed_at IS NOT NULL AS redeemed FROM signup_invites',
  );
  if (result.rows.length !== 1) throw new Error(`expected one invite, found ${result.rows.length}`);
  return result.rows[0]?.redeemed ?? false;
}

/** An account signed up on a service that asked for nothing: every account a hosted instance held before the version. */
async function accountFromBeforeTheVersion(email: string = EMAIL): Promise<SessionResponse> {
  const earlier = await serve();
  return await earlier.signupThroughInvite({ email });
}

async function readAccount(service: ServiceHarness, accessToken: string): Promise<AccountView> {
  const response = await service.request<{ account: AccountView }>({
    method: 'GET',
    path: '/v1/auth/account',
    accessToken,
  });
  assert.equal(response.status, 200);
  return response.body.account;
}

async function postConsent(
  service: ServiceHarness,
  input: { accessToken?: string; body: JsonValue },
): Promise<{ status: number; body: { account?: AccountView; error?: string } }> {
  return await service.request<{ account?: AccountView; error?: string }>({
    method: 'POST',
    path: '/v1/auth/account/health-consent',
    accessToken: input.accessToken,
    body: input.body,
  });
}

// ── The descriptor ─────────────────────────────────────────────────────────

test('/health publishes the version on an instance that asks, and null on one that asks for none', async () => {
  const asking = await serve({ healthConsent: VERSION });
  const silent = await serve();

  const askingBody = await asking.request<{ instance?: JsonValue }>({ method: 'GET', path: '/health' });
  assert.deepEqual(asObject(askingBody.body.instance)?.healthConsent, { version: VERSION });

  const silentBody = await silent.request<{ instance?: JsonValue }>({ method: 'GET', path: '/health' });
  const instance = asObject(silentBody.body.instance);
  assert.ok(instance !== null);
  // `null`, and PRESENT: "this instance asks for no consent" is a statement.
  assert.ok('healthConsent' in instance, 'the key must be present with null, not absent');
  assert.equal(instance.healthConsent, null);
});

// ── Signup on an instance that asks ────────────────────────────────────────

test('signup without the consent is a 400 that spends nothing, and the same invite then works with it', async () => {
  const service = await serve({ healthConsent: VERSION });
  const inviteToken = await service.mintInvite({ email: EMAIL });

  const refused = await service.request<{ error: string }>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: sampleSignupBody({ inviteToken }),
  });
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body, { error: 'health-consent-required' });
  assert.equal(await accountCount(), 0, 'a refused signup must create no account');
  assert.equal(await inviteIsRedeemed(), false, 'a refused signup must not spend the invite');

  // THE CONTROL: the same invite, the box ticked.
  const accepted = await service.request<SessionResponse>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: { ...sampleSignupBody({ inviteToken }), healthConsent: { version: VERSION } },
  });
  assert.equal(accepted.status, 201);
  const at = new Date(service.now()).toISOString();
  assert.deepEqual(accepted.body.account.healthConsent, { version: VERSION, at });
  assert.equal(await inviteIsRedeemed(), true);

  // ON THE ROW, at the server's instant, not only in the response.
  const stored = await storedConsent(accepted.body.account.id);
  assert.equal(stored.version, VERSION);
  assert.equal(stored.at?.toISOString(), at);

  // AND ON EVERY SURFACE THAT RETURNS AN ACCOUNT: the session read and a login.
  assert.deepEqual((await readAccount(service, accepted.body.tokens.accessToken)).healthConsent, {
    version: VERSION,
    at,
  });
  const login = await service.request<SessionResponse>({
    method: 'POST',
    path: '/v1/auth/login',
    body: { email: EMAIL, authHash: sampleAuthHash() },
  });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body.account.healthConsent, { version: VERSION, at });
});

test('signup with another version is refused, and the invite survives it', async () => {
  const service = await serve({ healthConsent: VERSION });
  const inviteToken = await service.mintInvite({ email: EMAIL });

  for (const healthConsent of [{ version: NEXT_VERSION }, { version: '' }, VERSION, null] satisfies JsonValue[]) {
    const refused = await service.request<{ error: string }>({
      method: 'POST',
      path: '/v1/auth/signup',
      body: { ...sampleSignupBody({ inviteToken }), healthConsent },
    });
    assert.equal(refused.status, 400, JSON.stringify(healthConsent));
    assert.deepEqual(refused.body, { error: 'health-consent-required' });
  }
  assert.equal(await accountCount(), 0);
  assert.equal(await inviteIsRedeemed(), false);

  const accepted = await service.request<SessionResponse>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: { ...sampleSignupBody({ inviteToken }), healthConsent: { version: VERSION } },
  });
  assert.equal(accepted.status, 201, 'four refusals must have left the invite redeemable');
});

// ── Signup on an instance that asks for none ───────────────────────────────

test('an instance that asks for no consent ignores the field and records nothing', async () => {
  const service = await serve();
  const inviteToken = await service.mintInvite({ email: EMAIL });

  const created = await service.request<SessionResponse>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: { ...sampleSignupBody({ inviteToken }), healthConsent: { version: VERSION } },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.account.healthConsent, null);
  assert.deepEqual(await storedConsent(created.body.account.id), { version: null, at: null });
});

// ── The prompt route ───────────────────────────────────────────────────────

test('an account from before the version is asked, records its consent once, and keeps the first instant', async () => {
  const session = await accountFromBeforeTheVersion();
  const service = await serve({ healthConsent: VERSION });
  const accessToken = session.tokens.accessToken;

  // What the app reads to decide it must ask.
  assert.equal((await readAccount(service, accessToken)).healthConsent, null);

  const wrong = await postConsent(service, { accessToken, body: { version: NEXT_VERSION } });
  assert.equal(wrong.status, 400);
  assert.deepEqual(wrong.body, { error: 'health-consent-required' });
  assert.deepEqual(await storedConsent(session.account.id), { version: null, at: null });

  const anonymous = await postConsent(service, { body: { version: VERSION } });
  assert.equal(anonymous.status, 401, 'the prompt route is behind the ordinary access token');

  const recorded = await postConsent(service, { accessToken, body: { version: VERSION } });
  assert.equal(recorded.status, 200);
  const at = new Date(service.now()).toISOString();
  assert.deepEqual(recorded.body.account?.healthConsent, { version: VERSION, at });
  assert.equal((await storedConsent(session.account.id)).at?.toISOString(), at);

  // IDEMPOTENT: a retry a minute later answers the same and moves nothing.
  service.advance(60_000);
  const repeat = await postConsent(service, { accessToken, body: { version: VERSION } });
  assert.equal(repeat.status, 200);
  assert.deepEqual(repeat.body.account?.healthConsent, { version: VERSION, at });
  assert.equal((await storedConsent(session.account.id)).at?.toISOString(), at);
  assert.deepEqual((await readAccount(service, accessToken)).healthConsent, { version: VERSION, at });
});

test('a new version asks again, refuses the old one, and replaces the record', async () => {
  // Signed up on an instance asking for VERSION, so the consent is on record.
  const first = await serve({ healthConsent: VERSION });
  const session = await first.signupThroughInvite({ email: EMAIL });
  assert.equal(session.account.healthConsent?.version, VERSION);

  // The operator changed the wording.
  const service = await serve({ healthConsent: NEXT_VERSION });
  service.advance(60_000);
  const accessToken = session.tokens.accessToken;
  // What the app compares with `instance.healthConsent.version`.
  assert.equal((await readAccount(service, accessToken)).healthConsent?.version, VERSION);

  const old = await postConsent(service, { accessToken, body: { version: VERSION } });
  assert.equal(old.status, 400, 'the wording this instance no longer asks about is no consent');

  const renewed = await postConsent(service, { accessToken, body: { version: NEXT_VERSION } });
  assert.equal(renewed.status, 200);
  // THE CONTROL for the idempotence above: a different version DOES move the instant.
  assert.deepEqual(renewed.body.account?.healthConsent, {
    version: NEXT_VERSION,
    at: new Date(service.now()).toISOString(),
  });
});

test('the prompt route is the ordinary unknown-path 404 on an instance that asks for no consent', async () => {
  const service = await serve();
  const session = await service.signupThroughInvite({ email: EMAIL });
  const unknown = await service.request<JsonValue>({ method: 'POST', path: '/v1/auth/no-such-route', body: {} });

  const signedIn = await postConsent(service, { accessToken: session.tokens.accessToken, body: { version: VERSION } });
  const anonymous = await postConsent(service, { body: { version: VERSION } });
  // Indistinguishable from a path that was never written, signed in or not.
  for (const response of [signedIn, anonymous]) {
    assert.equal(response.status, 404);
    assert.equal(response.status, unknown.status);
    assert.deepEqual(response.body, unknown.body);
  }
  assert.deepEqual(await storedConsent(session.account.id), { version: null, at: null });
});

// ── The operator ───────────────────────────────────────────────────────────

test('the admin account view shows the consent, and no admin write can set it', async () => {
  const withoutConsent = await accountFromBeforeTheVersion('boris@example.org');
  const service = await serve({ healthConsent: VERSION, adminToken: ADMIN_TOKEN });
  const consenting = await service.signupThroughInvite({ email: EMAIL });
  const at = new Date(service.now()).toISOString();

  const view = await service.request<{ account: AccountView }>({
    method: 'GET',
    path: `/v1/admin/accounts/${consenting.account.id}`,
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(view.status, 200);
  assert.deepEqual(view.body.account.healthConsent, { version: VERSION, at });

  const list = await service.request<{ accounts: AccountView[] }>({
    method: 'GET',
    path: '/v1/admin/accounts',
    adminToken: ADMIN_TOKEN,
  });
  const byId = new Map(list.body.accounts.map((account) => [account.id, account.healthConsent]));
  assert.deepEqual(byId.get(consenting.account.id), { version: VERSION, at });
  assert.equal(byId.get(withoutConsent.account.id), null);

  // READ ONLY. A consent an operator could set on somebody's behalf proves
  // nothing, so the PATCH does not read the field: alone it is an empty patch,
  // and beside a real field it is ignored.
  const alone = await service.request<JsonValue>({
    method: 'PATCH',
    path: `/v1/admin/accounts/${withoutConsent.account.id}`,
    adminToken: ADMIN_TOKEN,
    body: { healthConsent: { version: VERSION, at } },
  });
  assert.equal(alone.status, 400);
  const beside = await service.request<{ account: AccountView }>({
    method: 'PATCH',
    path: `/v1/admin/accounts/${withoutConsent.account.id}`,
    adminToken: ADMIN_TOKEN,
    body: { displayName: 'Boris', healthConsent: { version: VERSION, at } },
  });
  assert.equal(beside.status, 200);
  // The control: the patch DID apply, so the `null` below is the rule.
  assert.equal(beside.body.account.displayName, 'Boris');
  assert.equal(beside.body.account.healthConsent, null);
  assert.deepEqual(await storedConsent(withoutConsent.account.id), { version: null, at: null });
});

// ── The schema ─────────────────────────────────────────────────────────────

test('Postgres refuses half a consent: the version and the instant are set together or not at all', async () => {
  const session = await accountFromBeforeTheVersion();
  const id = session.account.id;

  await assert.rejects(
    database.pool.query(`UPDATE accounts SET health_consent_version = 'v1' WHERE id = $1`, [id]),
    (error: Error) => sqlstate(error) === CHECK_VIOLATION,
  );
  await assert.rejects(
    database.pool.query('UPDATE accounts SET health_consent_at = now() WHERE id = $1', [id]),
    (error: Error) => sqlstate(error) === CHECK_VIOLATION,
  );
  // THE CONTROL: both together is a consent, and it is accepted.
  await database.pool.query(
    `UPDATE accounts SET health_consent_version = 'v1', health_consent_at = now() WHERE id = $1`,
    [id],
  );
  assert.equal((await storedConsent(id)).version, 'v1');
});
