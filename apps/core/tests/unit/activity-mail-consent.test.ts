/**
 * The activity reminder consent at the handler level: the sign-up box and the
 * settings switch, over the fake store.
 *
 * THE CONTROLS. Every "recorded" case has a twin that differs in one input
 * (the instance offers nothing, the box is unticked, the field is absent) and
 * records nothing, so a handler that recorded everything, or nothing, fails.
 * The same on/off sequence runs against Postgres in
 * `tests/integration/activity-mail.integration.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSignup, handleUpdateAccount } from '../../src/accounts/auth-handlers.js';
import { hashToken } from '../../src/lib/tokens.js';
import type { JsonObject } from '../../src/lib/json.js';
import {
  createAuthFixture,
  sampleAuthHash,
  sampleKdfDescriptor,
  sampleRecoveryCode,
  sampleWrappedDek,
  type AuthFixture,
} from './auth-context-fixture.js';

const EMAIL = 'anna@example.org';
const INVITE_TOKEN = 'si_activity-mail-invite';
const MINUTE_MS = 60 * 1000;

function signupBody(overrides: JsonObject = {}): JsonObject {
  return {
    inviteToken: INVITE_TOKEN,
    authHash: sampleAuthHash(11),
    kdfDescriptor: sampleKdfDescriptor(),
    displayName: 'Anna',
    recoveryAuthHash: sampleAuthHash(33),
    recoveryCode: sampleRecoveryCode(),
    keyRecords: [
      { kind: 'passphrase', kdfDescriptor: sampleKdfDescriptor(), wrappedDek: sampleWrappedDek() },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: sampleWrappedDek(41) },
    ],
    ...overrides,
  };
}

/** One live invite, and an instance that offers reminders or not. */
function fixtureWith(input: { isOffered: boolean }): AuthFixture {
  const fixture = createAuthFixture();
  fixture.store.seedInvite({
    tokenHash: hashToken(INVITE_TOKEN),
    email: EMAIL,
    expiresAt: new Date(fixture.now().getTime() + 7 * 24 * 60 * MINUTE_MS),
  });
  fixture.ctx.activityMail = { isOffered: () => input.isOffered, defaultLanguage: 'fr' };
  return fixture;
}

async function signUpWith(input: { fixture: AuthFixture; body: JsonObject }): Promise<number> {
  const outcome = await handleSignup(signupBody(input.body), input.fixture.ctx);
  assert.equal(outcome.status, 'created', JSON.stringify(outcome));
  if (outcome.status !== 'created') throw new Error('unreachable');
  return outcome.body.account.id;
}

async function patch(input: { fixture: AuthFixture; accountId: number; body: JsonObject }): Promise<string> {
  const outcome = await handleUpdateAccount({ accountId: input.accountId, body: input.body }, input.fixture.ctx);
  return outcome.status;
}

async function recordOf(input: { fixture: AuthFixture; accountId: number }) {
  const account = await input.fixture.store.findAccountById(input.accountId);
  if (account === null) throw new Error('the account is gone');
  return account.activityMail;
}

test('a ticked box on an instance that offers reminders records consent at the redemption instant', async () => {
  const fixture = fixtureWith({ isOffered: true });
  const outcome = await handleSignup(signupBody({ activityMail: true, language: 'de' }), fixture.ctx);
  assert.equal(outcome.status, 'created');
  if (outcome.status !== 'created') throw new Error('unreachable');
  assert.equal(outcome.body.account.activityMail, true);
  assert.deepEqual(await recordOf({ fixture, accountId: outcome.body.account.id }), {
    optInAt: fixture.now(),
    optOutAt: null,
    language: 'de',
  });
});

test('a ticked box with no language takes the instance language', async () => {
  const fixture = fixtureWith({ isOffered: true });
  const accountId = await signUpWith({ fixture, body: { activityMail: true } });
  assert.equal((await recordOf({ fixture, accountId })).language, 'fr');
});

test('an unticked box, an absent field, or an instance that offers nothing records nothing', async () => {
  for (const [isOffered, body] of [
    [true, { activityMail: false }],
    [true, {}],
    [false, { activityMail: true }],
  ] as const) {
    const fixture = fixtureWith({ isOffered });
    const accountId = await signUpWith({ fixture, body });
    assert.deepEqual(await recordOf({ fixture, accountId }), { optInAt: null, optOutAt: null, language: null });
  }
});

test('a non-boolean box or an unknown language is a 400 that spends no invite', async () => {
  const fixture = fixtureWith({ isOffered: true });
  assert.equal((await handleSignup(signupBody({ activityMail: 'yes' }), fixture.ctx)).status, 'invalid');
  assert.equal((await handleSignup(signupBody({ activityMail: true, language: 'nl' }), fixture.ctx)).status, 'invalid');
  // The control: the same invite still works, so nothing was spent above.
  assert.equal((await handleSignup(signupBody({ activityMail: true }), fixture.ctx)).status, 'created');
});

test('on, off, on again, off again: fresh instants, and the consent instant is never cleared', async () => {
  const fixture = fixtureWith({ isOffered: true });
  const accountId = await signUpWith({ fixture, body: {} });
  const onAt = fixture.now();
  assert.equal(await patch({ fixture, accountId, body: { activityMail: true } }), 'ok');
  assert.deepEqual(await recordOf({ fixture, accountId }), { optInAt: onAt, optOutAt: null, language: null });

  // A repeat while active keeps the first instant.
  fixture.advance(MINUTE_MS);
  assert.equal(await patch({ fixture, accountId, body: { activityMail: true, language: 'tr' } }), 'ok');
  assert.deepEqual(await recordOf({ fixture, accountId }), { optInAt: onAt, optOutAt: null, language: 'tr' });

  fixture.advance(MINUTE_MS);
  const offAt = fixture.now();
  assert.equal(await patch({ fixture, accountId, body: { activityMail: false } }), 'ok');
  assert.deepEqual(await recordOf({ fixture, accountId }), { optInAt: onAt, optOutAt: offAt, language: 'tr' });

  fixture.advance(MINUTE_MS);
  const againAt = fixture.now();
  assert.equal(await patch({ fixture, accountId, body: { activityMail: true } }), 'ok');
  assert.deepEqual(await recordOf({ fixture, accountId }), { optInAt: againAt, optOutAt: offAt, language: 'tr' });

  fixture.advance(MINUTE_MS);
  const offAgainAt = fixture.now();
  assert.equal(await patch({ fixture, accountId, body: { activityMail: false } }), 'ok');
  assert.deepEqual(await recordOf({ fixture, accountId }), {
    optInAt: againAt,
    optOutAt: offAgainAt,
    language: 'tr',
  });

  // A second off while already off keeps the first withdrawal instant.
  fixture.advance(MINUTE_MS);
  assert.equal(await patch({ fixture, accountId, body: { activityMail: false } }), 'ok');
  assert.equal((await recordOf({ fixture, accountId })).optOutAt?.getTime(), offAgainAt.getTime());
});

test('the account view reports the active consent, both ways round', async () => {
  const fixture = fixtureWith({ isOffered: true });
  const accountId = await signUpWith({ fixture, body: { activityMail: true } });
  fixture.advance(MINUTE_MS);
  const off = await handleUpdateAccount({ accountId, body: { activityMail: false } }, fixture.ctx);
  assert.ok(off.status === 'ok' && off.body.account.activityMail === false);
  fixture.advance(MINUTE_MS);
  const on = await handleUpdateAccount({ accountId, body: { activityMail: true } }, fixture.ctx);
  assert.ok(on.status === 'ok' && on.body.account.activityMail === true);
});

test('turning reminders off works on an instance that offers none', async () => {
  const fixture = fixtureWith({ isOffered: true });
  const accountId = await signUpWith({ fixture, body: { activityMail: true } });
  fixture.ctx.activityMail = { isOffered: () => false, defaultLanguage: 'fr' };
  fixture.advance(MINUTE_MS);
  assert.equal(await patch({ fixture, accountId, body: { activityMail: false } }), 'ok');
  assert.notEqual((await recordOf({ fixture, accountId })).optOutAt, null);
});

test('a PATCH must name a field, and a language goes only with activityMail: true', async () => {
  const fixture = fixtureWith({ isOffered: true });
  const accountId = await signUpWith({ fixture, body: {} });
  assert.equal(await patch({ fixture, accountId, body: {} }), 'invalid');
  assert.equal(await patch({ fixture, accountId, body: { language: 'de' } }), 'invalid');
  assert.equal(await patch({ fixture, accountId, body: { activityMail: false, language: 'de' } }), 'invalid');
  assert.equal(await patch({ fixture, accountId, body: { activityMail: 'on' } }), 'invalid');
  assert.equal(await patch({ fixture, accountId, body: { activityMail: true, language: 'xx' } }), 'invalid');
  // Nothing above wrote anything.
  assert.deepEqual(await recordOf({ fixture, accountId }), { optInAt: null, optOutAt: null, language: null });
  // The control: the valid forms pass.
  assert.equal(await patch({ fixture, accountId, body: { activityMail: true, language: 'de' } }), 'ok');
  assert.equal(await patch({ fixture, accountId, body: { displayName: null } }), 'ok');
});

test('a PATCH with only activityMail leaves the display name alone', async () => {
  const fixture = fixtureWith({ isOffered: true });
  const accountId = await signUpWith({ fixture, body: {} });
  assert.equal(await patch({ fixture, accountId, body: { activityMail: true } }), 'ok');
  assert.equal((await fixture.store.findAccountById(accountId))?.displayName, 'Anna');
  // The control: naming it does change it.
  assert.equal(await patch({ fixture, accountId, body: { activityMail: true, displayName: 'Ann' } }), 'ok');
  assert.equal((await fixture.store.findAccountById(accountId))?.displayName, 'Ann');
});
