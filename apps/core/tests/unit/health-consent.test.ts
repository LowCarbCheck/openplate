/**
 * Explicit consent to health data (Art. 9(2)(a) GDPR), asked by
 * `HEALTH_CONSENT_VERSION`: the handler rules, DB-free.
 *
 * WHAT IS PROVEN HERE. On an instance that asks, signup without the matching
 * consent is refused BEFORE the store is called, so the invite survives; with
 * it, the consent lands on the account at the server's instant. On an
 * instance that asks for none, a submitted consent is ignored. The prompt
 * route records a consent for an existing account, refuses any other
 * version, keeps the first instant on a repeat, and takes a new version.
 *
 * EVERY REFUSAL HAS ITS CONTROL: the same fixture, the same invite, one field
 * changed, and the answer turns into a success. A refusal with no such
 * control would pass against a handler that refused everything.
 *
 * `tests/integration/health-consent.test.ts` holds the same rules against
 * Postgres, the routes and `/health`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRecordHealthConsent, handleSignup } from '../../src/accounts/auth-handlers.js';
import { HEALTH_CONSENT_REQUIRED, isHealthConsentVersion } from '../../src/accounts/health-consent.js';
import { hashToken } from '../../src/lib/tokens.js';
import type { JsonObject, JsonValue } from '../../src/lib/json.js';
import {
  createAuthFixture,
  sampleAuthHash,
  sampleKdfDescriptor,
  sampleRecoveryCode,
  sampleWrappedDek,
  type AuthFixture,
} from './auth-context-fixture.js';

const INVITE_TOKEN = 'si_an-invite-for-the-consent-suite';
const EMAIL = 'anna@example.org';
const VERSION = '2026-09-28';
const NEXT_VERSION = '2027-01-15';

function signupBody(overrides: JsonObject = {}): JsonObject {
  return {
    inviteToken: INVITE_TOKEN,
    authHash: sampleAuthHash(11),
    kdfDescriptor: sampleKdfDescriptor(),
    displayName: null,
    recoveryAuthHash: sampleAuthHash(33),
    recoveryCode: sampleRecoveryCode(),
    keyRecords: [
      { kind: 'passphrase', kdfDescriptor: sampleKdfDescriptor(), wrappedDek: sampleWrappedDek() },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: sampleWrappedDek(41) },
    ],
    ...overrides,
  };
}

/** A fixture with one live invite, on an instance that asks for `version`, or for none when it is `null`. */
function withInvite(version: string | null): AuthFixture {
  const fixture = createAuthFixture();
  fixture.ctx.healthConsent = version === null ? null : { version };
  fixture.store.seedInvite({
    tokenHash: hashToken(INVITE_TOKEN),
    email: EMAIL,
    expiresAt: new Date(fixture.now().getTime() + 7 * 24 * 60 * 60 * 1000),
  });
  return fixture;
}

async function expectRefusedThenAccepted(input: { submitted: JsonValue | undefined }): Promise<void> {
  const fixture = withInvite(VERSION);
  const body = input.submitted === undefined ? signupBody() : signupBody({ healthConsent: input.submitted });

  const refused = await handleSignup(body, fixture.ctx);
  assert.deepEqual(refused, { status: 'invalid', reason: HEALTH_CONSENT_REQUIRED });
  // NOTHING WAS CREATED OR SPENT: the store was never asked.
  assert.equal(await fixture.store.findAccountByEmail(EMAIL), null, 'a refused signup must create no account');
  assert.equal(fixture.store.inviteIsRedeemable(hashToken(INVITE_TOKEN)), true, 'the invite must survive');

  // THE CONTROL: the same invite, the box ticked, and it is a success.
  const accepted = await handleSignup(signupBody({ healthConsent: { version: VERSION } }), fixture.ctx);
  assert.equal(accepted.status, 'created');
}

// ── Signup on an instance that asks ────────────────────────────────────────

test('signup without healthConsent is a 400 that spends nothing, and the same invite then works with it', async () => {
  await expectRefusedThenAccepted({ submitted: undefined });
});

test('signup with another version is refused, whatever it looks like', async () => {
  await expectRefusedThenAccepted({ submitted: { version: '2026-01-01' } });
  // Byte for byte: no trim and no case fold on what the client echoes back.
  await expectRefusedThenAccepted({ submitted: { version: ` ${VERSION}` } });
  await expectRefusedThenAccepted({ submitted: { version: VERSION.toUpperCase().replace('-', '_') } });
});

test('signup with a consent of the wrong type is refused', async () => {
  await expectRefusedThenAccepted({ submitted: VERSION });
  await expectRefusedThenAccepted({ submitted: true });
  await expectRefusedThenAccepted({ submitted: null });
  await expectRefusedThenAccepted({ submitted: { version: 20260928 } });
  await expectRefusedThenAccepted({ submitted: {} });
});

test('signup with the matching consent records the instance version at the server instant', async () => {
  const fixture = withInvite(VERSION);
  const outcome = await handleSignup(signupBody({ healthConsent: { version: VERSION } }), fixture.ctx);
  assert.equal(outcome.status, 'created');
  if (outcome.status !== 'created') throw new Error('unreachable');

  const expected = { version: VERSION, at: fixture.now().toISOString() };
  assert.deepEqual(outcome.body.account.healthConsent, expected);
  // And on the row itself, not only in the response.
  const stored = await fixture.store.findAccountByEmail(EMAIL);
  assert.deepEqual(stored?.healthConsent, { version: VERSION, at: fixture.now() });
});

test('the invite shape gate still answers first: a bad invite with no consent is the 403, not the 400', async () => {
  const fixture = withInvite(VERSION);
  const outcome = await handleSignup(signupBody({ inviteToken: 'not-an-invite' }), fixture.ctx);
  assert.deepEqual(outcome, { status: 'forbidden', reason: 'invite-invalid' });
});

// ── Signup on an instance that asks for none ───────────────────────────────

test('an instance that asks for no consent ignores the field and records nothing', async () => {
  const fixture = withInvite(null);
  const outcome = await handleSignup(signupBody({ healthConsent: { version: VERSION } }), fixture.ctx);
  assert.equal(outcome.status, 'created');
  if (outcome.status !== 'created') throw new Error('unreachable');
  assert.equal(outcome.body.account.healthConsent, null, 'a consent nobody asked for must not be recorded');

  // THE CONTROL for "ignored": the same body on an instance that asks for
  // this version DOES record it, so the `null` above is the policy, not a
  // handler that never writes the field.
  const asking = withInvite(VERSION);
  const recorded = await handleSignup(signupBody({ healthConsent: { version: VERSION } }), asking.ctx);
  if (recorded.status !== 'created') throw new Error(`expected created, got ${recorded.status}`);
  assert.equal(recorded.body.account.healthConsent?.version, VERSION);
});

test('an instance that asks for no consent accepts a signup with no field at all', async () => {
  const fixture = withInvite(null);
  const outcome = await handleSignup(signupBody(), fixture.ctx);
  assert.equal(outcome.status, 'created');
});

// ── The prompt route ───────────────────────────────────────────────────────

/** An existing account created before the instance asked: no consent on record. */
async function existingAccount(version: string | null): Promise<{ fixture: AuthFixture; accountId: number }> {
  const fixture = createAuthFixture();
  const account = await fixture.store.seedAccount({ email: EMAIL });
  fixture.ctx.healthConsent = version === null ? null : { version };
  assert.equal(account.healthConsent, null);
  return { fixture, accountId: account.id };
}

test('the prompt route records the consent of an account that never gave one', async () => {
  const { fixture, accountId } = await existingAccount(VERSION);
  const outcome = await handleRecordHealthConsent({ accountId, body: { version: VERSION } }, fixture.ctx);
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') throw new Error('unreachable');
  assert.deepEqual(outcome.body.account.healthConsent, { version: VERSION, at: fixture.now().toISOString() });
  assert.deepEqual((await fixture.store.findAccountById(accountId))?.healthConsent, {
    version: VERSION,
    at: fixture.now(),
  });
});

test('the prompt route refuses another version and records nothing', async () => {
  const { fixture, accountId } = await existingAccount(VERSION);
  for (const body of [{ version: NEXT_VERSION }, {}, { version: null }, null, VERSION] satisfies JsonValue[]) {
    const outcome = await handleRecordHealthConsent({ accountId, body }, fixture.ctx);
    assert.deepEqual(outcome, { status: 'invalid', reason: HEALTH_CONSENT_REQUIRED }, JSON.stringify(body));
  }
  assert.equal((await fixture.store.findAccountById(accountId))?.healthConsent, null);
});

test('the prompt route is idempotent: a repeat keeps the first instant', async () => {
  const { fixture, accountId } = await existingAccount(VERSION);
  const first = await handleRecordHealthConsent({ accountId, body: { version: VERSION } }, fixture.ctx);
  if (first.status !== 'ok') throw new Error(`expected ok, got ${first.status}`);
  const agreedAt = first.body.account.healthConsent?.at;

  fixture.advance(60 * 60 * 1000);
  const repeat = await handleRecordHealthConsent({ accountId, body: { version: VERSION } }, fixture.ctx);
  if (repeat.status !== 'ok') throw new Error(`expected ok, got ${repeat.status}`);
  assert.equal(repeat.body.account.healthConsent?.at, agreedAt, 'a retry must not move the instant of consent');
});

test('a new version replaces the old one, instant and all', async () => {
  const { fixture, accountId } = await existingAccount(VERSION);
  await handleRecordHealthConsent({ accountId, body: { version: VERSION } }, fixture.ctx);

  // The operator changed the wording, and the person agreed again an hour later.
  fixture.advance(60 * 60 * 1000);
  fixture.ctx.healthConsent = { version: NEXT_VERSION };
  const outcome = await handleRecordHealthConsent({ accountId, body: { version: NEXT_VERSION } }, fixture.ctx);
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.status}`);
  // The control for the idempotence test above: a DIFFERENT version does move it.
  assert.deepEqual(outcome.body.account.healthConsent, { version: NEXT_VERSION, at: fixture.now().toISOString() });
});

test('the prompt route answers not-found on an instance that asks for no consent', async () => {
  const { fixture, accountId } = await existingAccount(null);
  const outcome = await handleRecordHealthConsent({ accountId, body: { version: VERSION } }, fixture.ctx);
  assert.equal(outcome.status, 'not-found');
  assert.equal((await fixture.store.findAccountById(accountId))?.healthConsent, null);
});

test('the prompt route for an account deleted meanwhile is the ordinary 401', async () => {
  const { fixture, accountId } = await existingAccount(VERSION);
  await fixture.store.deleteAccount(accountId);
  const outcome = await handleRecordHealthConsent({ accountId, body: { version: VERSION } }, fixture.ctx);
  assert.equal(outcome.status, 'unauthorized');
});

// ── The version rule ───────────────────────────────────────────────────────

test('a consent version is 1 to 32 letters, digits, dots, underscores and hyphens', () => {
  for (const good of ['2026-09-28', 'v1', 'a', 'A.b_C-9', 'x'.repeat(32)]) {
    assert.equal(isHealthConsentVersion(good), true, good);
  }
  for (const bad of ['', 'x'.repeat(33), '2026 09 28', 'v1/2', '"v1"', 'versión', 'v1\n']) {
    assert.equal(isHealthConsentVersion(bad), false, JSON.stringify(bad));
  }
});
