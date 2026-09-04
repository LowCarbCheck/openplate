/**
 * The auth client against protocol 2 — the five things that are NEW, and the
 * one that is newly typed.
 *
 * ── Why these five and not the whole surface ─────────────────────────────
 *
 * `sync-auth-client.test.ts` already pins the invariant the whole feature rests
 * on (the passphrase never leaves the device) and the token lifecycle.
 * Everything here is a M192 shape that had no test because it had no code:
 *
 *  1. `inviteLookup` — a dead invite is a RETURN, not a throw, and a network
 *     failure is still a throw. Confusing the two is how somebody throws away
 *     a live invitation over a flaky connection.
 *  2. `signup` — the body carries an invite and NO address, and it carries the
 *     recovery escrow. An account created without the escrow is one nobody can
 *     reset, and nothing detects that afterwards.
 *  3. `resetRequest` / `resetOpen` — the request answers nothing a caller may
 *     branch on, and a dead token is a RETURN like a dead invite.
 *  4. `patchAccount` — the updated view is ADOPTED, so the next screen reads
 *     the new name rather than the old one from a stale session.
 *  5. `403 {"error":"account-suspended"}` — the one 403 that is its own
 *     `SyncErrorKind`, because it can land on any authenticated call and every
 *     surface has to say the same true thing about it.
 *
 * The requests are captured and asserted as BODIES, because the shape of what
 * goes on the wire is the contract this file is about.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { SyncAuthClient } from '../../../app/lib/sync/engine/client/auth-client';
import { SyncRequestError } from '../../../app/lib/sync/engine/client/sync-error';
import type { AccountViewWire } from '../../../app/lib/sync/engine/client/auth-wire';

const BASE_URL = 'https://sync.example.test';
const SALT_BASE64 = 'AAECAwQFBgcICQoLDA0ODw==';
const KDF = { salt: SALT_BASE64, params: { memorySizeKib: 8, iterations: 1, parallelism: 1 } };

const ACCOUNT: AccountViewWire = {
  id: 7,
  email: 'anna@example.org',
  displayName: null,
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 3,
  suspendedAt: null,
  createdAt: '2026-09-04T10:00:00.000Z',
};

const TOKENS = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
  refreshToken: 'refresh-1',
  refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
};

/** One JSON document a stub answers with. Every branch below builds one of the §5.x response shapes. */
const stubBodySchema = z.record(z.string(), z.unknown());
type StubBody = z.infer<typeof stubBodySchema>;

const json = (body: StubBody, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * One captured request. The body is stored as TEXT, not as a parsed value: a
 * form of "what went on the wire" that nothing has interpreted is the only
 * form this file can assert the contract against.
 */
interface Captured {
  path: string;
  method: string;
  bodyText: string | null;
}

/** A stub service plus the log of everything it was sent. `route` answers one path; anything else is a 404. */
function stub(route: (path: string) => Response | undefined) {
  const captured: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const raw = init?.body;
    captured.push({ path, method: init?.method ?? 'GET', bodyText: raw instanceof Object ? null : (raw ?? null) });
    return route(path) ?? json({ error: 'unexpected route' }, 404);
  };
  return { fetchImpl, captured };
}

/** A transport that never reaches anything — a `TypeError`, exactly as a browser reports a dead host. */
const unreachableFetch: typeof fetch = async () => {
  throw new TypeError('Failed to fetch');
};

/** The recorded body of one request, parsed at this test's own boundary. */
function bodyOf(captured: Captured[], path: string): StubBody {
  const request = captured.find((entry) => entry.path === path);
  assert.ok(request !== undefined, `nothing was sent to ${path}`);
  assert.ok(request.bodyText !== null, `${path} was sent with no body`);
  return stubBodySchema.parse(JSON.parse(request.bodyText));
}

// ---------------------------------------------------------------------------
// 1. The invite lookup
// ---------------------------------------------------------------------------

test('inviteLookup reports the address the invite was written to', async () => {
  const { fetchImpl, captured } = stub((path) =>
    path.endsWith('/invite-lookup') ?
      json({ email: 'anna@example.org', displayName: 'Anna', expiresAt: '2026-09-11T10:00:00.000Z' })
    : undefined,
  );
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  const looked = await client.inviteLookup({ inviteToken: 'si_TOKEN' });
  assert.deepEqual(looked, {
    email: 'anna@example.org',
    displayName: 'Anna',
    expiresAt: '2026-09-11T10:00:00.000Z',
  });
  // The token, and nothing else. A body that also carried an address would let
  // a caller ask about somebody else's invite.
  assert.deepEqual(bodyOf(captured, '/v1/auth/invite-lookup'), { inviteToken: 'si_TOKEN' });
});

test('a dead invite is ONE returned outcome, not four and not a throw', async () => {
  // Unknown, spent, revoked and expired are one `404` on the wire —
  // distinguishing them would let a caller probe which tokens exist — and one
  // screen in the app.
  const { fetchImpl } = stub(() => json({ error: 'invite-invalid' }, 404));
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  assert.deepEqual(await client.inviteLookup({ inviteToken: 'si_DEAD' }), { status: 'invalid' });
});

test('an unreachable service still THROWS from the lookup', async () => {
  // "We could not reach the server" must never be shown as "your invitation is
  // not valid": that is how somebody throws away a live invitation over a
  // flaky connection.
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: unreachableFetch });

  await assert.rejects(
    () => client.inviteLookup({ inviteToken: 'si_TOKEN' }),
    (error) => {
      assert.ok(error instanceof SyncRequestError);
      assert.equal(error.kind, 'transport');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Signup
// ---------------------------------------------------------------------------

test('signup sends the invite and the escrow, and carries no address of its own', async () => {
  const { fetchImpl, captured } = stub((path) =>
    path.endsWith('/signup') ? json({ account: ACCOUNT, tokens: TOKENS }, 201) : undefined,
  );
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  const created = await client.signup({
    inviteToken: 'si_TOKEN',
    authHash: 'AUTH',
    kdfDescriptor: KDF,
    displayName: 'Anna',
    recoveryAuthHash: 'RECOVERY-AUTH',
    recoveryCode: 'ABCDE-FGHJK',
    keyRecords: [
      { kind: 'passphrase', kdfDescriptor: KDF, wrappedDek: 'WRAP-P' },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: 'WRAP-R' },
    ],
  });

  const body = bodyOf(captured, '/v1/auth/signup');
  // NO ADDRESS. The service reads it off the invite, which is what makes the
  // invite the verification: a body carrying its own would let somebody create
  // an account at an address nobody invited.
  assert.equal('email' in body, false, 'the signup body must carry no address');
  assert.equal(body.inviteToken, 'si_TOKEN');
  // THE ESCROW, and both key records, in the same request. An account created
  // without them is one nobody can ever reset, and nothing detects it later.
  assert.equal(body.recoveryAuthHash, 'RECOVERY-AUTH');
  assert.equal(body.recoveryCode, 'ABCDE-FGHJK');
  assert.equal(Array.isArray(body.keyRecords) && body.keyRecords.length, 2);

  // And the session is adopted, so the key-record and blob calls that follow
  // are authenticated without a second round trip.
  assert.equal(created.account.email, 'anna@example.org');
  assert.equal(client.getAccessToken(), 'access-1');
});

// ---------------------------------------------------------------------------
// 3. The mailed reset
// ---------------------------------------------------------------------------

test('resetRequest returns nothing a caller could branch on', async () => {
  const { fetchImpl, captured } = stub((path) => (path.endsWith('/reset/request') ? json({}, 202) : undefined));
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  // `void`, deliberately: the service answers `202` whether or not the address
  // has an account, so a caller that branched on the answer would be building
  // the membership oracle the endpoint exists to refuse.
  const answer = await client.resetRequest({ email: 'anna@example.org' });
  assert.equal(answer, undefined);
  assert.deepEqual(bodyOf(captured, '/v1/auth/reset/request'), { email: 'anna@example.org' });
});

test('resetOpen spends the token for the address and the escrowed code', async () => {
  const { fetchImpl, captured } = stub((path) =>
    path.endsWith('/reset/open') ? json({ email: 'anna@example.org', recoveryCode: 'ABCDE-FGHJK' }) : undefined,
  );
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  assert.deepEqual(await client.resetOpen({ resetToken: 'sr_TOKEN' }), {
    email: 'anna@example.org',
    recoveryCode: 'ABCDE-FGHJK',
  });
  assert.deepEqual(bodyOf(captured, '/v1/auth/reset/open'), { resetToken: 'sr_TOKEN' });
});

test('a dead reset token is a returned outcome, exactly like a dead invite', async () => {
  const { fetchImpl } = stub(() => json({ error: 'reset-invalid' }, 404));
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  assert.deepEqual(await client.resetOpen({ resetToken: 'sr_SPENT' }), { status: 'invalid' });
});

// ---------------------------------------------------------------------------
// 4. Editing the account
// ---------------------------------------------------------------------------

test('patchAccount sends only a display name, and adopts the view it gets back', async () => {
  const renamed: AccountViewWire = { ...ACCOUNT, displayName: 'Anna B' };
  const { fetchImpl, captured } = stub((path) => {
    if (path.endsWith('/auth/login')) return json({ account: ACCOUNT, tokens: TOKENS });
    if (path.endsWith('/auth/account')) return json({ account: renamed });
    return undefined;
  });
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  await client.login({ email: 'anna@example.org', authHash: 'AUTH' });

  assert.deepEqual(await client.patchAccount({ displayName: 'Anna B' }), renamed);
  const patch = captured.find((entry) => entry.method === 'PATCH');
  assert.ok(patch !== undefined, 'the account edit must be a PATCH');
  assert.deepEqual(bodyOf([patch], patch.path), { displayName: 'Anna B' });

  // ADOPTED, not merely returned. A screen two rows away reads the session, and
  // a session still holding the old name is how a saved edit appears not to
  // have saved.
  assert.equal(client.getSession()?.account.displayName, 'Anna B');
});

// ---------------------------------------------------------------------------
// 5. Suspension
// ---------------------------------------------------------------------------

test('a suspended account is its own error kind, on login and on refresh alike', async () => {
  const suspended: typeof fetch = async () => json({ error: 'account-suspended' }, 403);
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: suspended });

  await assert.rejects(
    () => client.login({ email: 'anna@example.org', authHash: 'AUTH' }),
    (error) => {
      assert.ok(error instanceof SyncRequestError);
      // NOT `forbidden`. The same status also means "this invite is not valid"
      // and "this account has no AI allowance", and every surface that can hit
      // a suspension has to say the same true thing about it.
      assert.equal(error.kind, 'suspended');
      return true;
    },
  );
});

test('a refresh refused for a suspension ends the session, like any other refusal', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).endsWith('/auth/login')) return json({ account: ACCOUNT, tokens: TOKENS });
    calls += 1;
    return json({ error: 'account-suspended' }, 403);
  };
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });
  await client.login({ email: 'anna@example.org', authHash: 'AUTH' });

  // `null` rather than a throw: "the user must sign in again" is an expected
  // state of a long-lived app, and a device that treated it as an unexplained
  // error would retry a refresh it can never win for as long as the tab lives.
  assert.equal(await client.refreshAccessToken(), null);
  assert.equal(client.getSession(), null);
  assert.equal(calls, 1, 'a refused refresh must not be retried');
});

test('an ordinary 403 is still `forbidden` — only the documented token is a suspension', async () => {
  const fetchImpl: typeof fetch = async () => json({ error: 'invite-invalid' }, 403);
  const client = new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl });

  await assert.rejects(
    () =>
      client.signup({
        inviteToken: 'si_DEAD',
        authHash: 'AUTH',
        kdfDescriptor: KDF,
        recoveryAuthHash: 'R',
        recoveryCode: 'C',
        keyRecords: [],
      }),
    (error) => {
      assert.ok(error instanceof SyncRequestError);
      assert.equal(error.kind, 'forbidden');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// The instance descriptor
// ---------------------------------------------------------------------------

test('instance() reads the model an instance advertises, and fails OPEN', async () => {
  const withAi: typeof fetch = async () =>
    json({
      protocolVersion: 2,
      envelopeVersion: 1,
      serviceVersion: '0.6.0',
      instance: { name: 'openplate', language: 'de', mail: true, ai: { model: 'google/gemini-3.7-flash' } },
    });
  assert.deepEqual((await new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: withAi }).instance())?.ai, {
    model: 'google/gemini-3.7-flash',
  });

  // FAILS OPEN, unlike `handshake()`: nothing this answers can destroy
  // anything, and refusing to name a model on doubt just hides a working
  // feature behind a blank card.
  assert.equal(await new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: unreachableFetch }).instance(), null);

  const older: typeof fetch = async () => json({ protocolVersion: 2, envelopeVersion: 1, serviceVersion: '0.6.0' });
  assert.equal(await new SyncAuthClient({ baseUrl: BASE_URL, fetchImpl: older }).instance(), null);
});
