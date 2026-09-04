/**
 * The admin client: every endpoint on the contract, and the one refusal that
 * is a value rather than an exception.
 *
 * ── Why a fake TRANSPORT and not a fake fetch ────────────────────────────
 *
 * `AdminClient` has one job: turn a method call into a path, a verb and a
 * body, and turn a response back into a parsed shape or a typed outcome. The
 * token lifecycle underneath is `SyncAuthClient`'s, tested in
 * `sync-engine/auth-client-v2.test.ts`, and duplicating it here would test
 * that file twice and this one not at all. What the fake gives instead is the
 * assertion that matters: the exact request each method makes.
 *
 * ── The 403 case is the reason this file exists ──────────────────────────
 *
 * A demoted or suspended administrator is ordinary, and the failure mode it
 * used to produce was a blank page with a stack trace in the console. That it
 * arrives as `{ status: 'forbidden' }` is asserted for EVERY method, because
 * the rule lives in one private helper and a method that bypassed it would
 * look identical from the outside until somebody was demoted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AdminClient, type AdminTransport } from '../../app/lib/admin/admin-client';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { AuthorizedMethod } from '../../app/lib/sync/engine/client/auth-client';
import type { JsonValue } from '../../app/lib/sync/engine/protocol';

/** One request as the client made it. The shape of these is the contract this file pins. */
interface RecordedRequest {
  path: string;
  method: AuthorizedMethod;
  body: JsonValue | undefined;
}

const ACCOUNT: JsonValue = {
  id: 7,
  email: 'anna@example.org',
  displayName: 'Anna',
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 3,
  suspendedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
};

const INVITE: JsonValue = {
  id: 12,
  email: 'bea@example.org',
  displayName: null,
  role: 'member',
  dailyAiLimit: 200,
  expiresAt: '2026-09-11T09:00:00.000Z',
  status: 'pending',
  createdAt: '2026-09-04T09:00:00.000Z',
  redeemedAccountId: null,
};

/** What a fake transport does with a request: answer it, or refuse it. */
type FakeAnswer = { kind: 'body'; body: JsonValue } | { kind: 'error'; error: SyncRequestError };

/** A recording transport and the log it writes to. */
interface FakeTransport {
  transport: AdminTransport;
  requests: RecordedRequest[];
}

/** A client and the log of what it asked for. */
interface RecordedClient {
  client: AdminClient;
  requests: RecordedRequest[];
}

/** A transport that records what it was asked and gives back one canned answer. */
function fakeTransport(answer: FakeAnswer): FakeTransport {
  const requests: RecordedRequest[] = [];
  const transport: AdminTransport = {
    requestAsAccount(input) {
      requests.push({ path: input.path, method: input.method, body: input.body });
      if (answer.kind === 'error') return Promise.reject(answer.error);
      return Promise.resolve(answer.body);
    },
  };
  return { transport, requests };
}

function clientAnswering(body: JsonValue): RecordedClient {
  const { transport, requests } = fakeTransport({ kind: 'body', body });
  return { client: new AdminClient({ transport }), requests };
}

function clientFailingWith(error: SyncRequestError): AdminClient {
  return new AdminClient({ transport: fakeTransport({ kind: 'error', error }).transport });
}

/** The `403` the service sends to an account that is not an administrator, or is suspended. */
function refusing(kind: 'forbidden' | 'suspended'): AdminClient {
  return clientFailingWith(new SyncRequestError({ kind, message: kind, status: 403 }));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('listAccounts asks for one page of people and parses them', async () => {
  const { client, requests } = clientAnswering({ accounts: [ACCOUNT], total: 1 });
  const outcome = await client.listAccounts({ limit: 500 });

  assert.deepEqual(requests, [{ path: '/v1/admin/accounts?limit=500', method: 'GET', body: undefined }]);
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.value.total, 1);
  assert.equal(outcome.value.accounts[0]?.email, 'anna@example.org');
  assert.equal(outcome.value.accounts[0]?.aiUsedToday, 3);
});

test('a paging call with neither bound asks for no query string at all', async () => {
  // An empty `?` is a different URL, and a service that logs or caches by URL
  // sees two of them for one request.
  const { client, requests } = clientAnswering({ accounts: [], total: 0 });
  await client.listAccounts();
  assert.equal(requests[0]?.path, '/v1/admin/accounts');
});

test('getAccount unwraps the envelope', async () => {
  const { client, requests } = clientAnswering({ account: ACCOUNT });
  const outcome = await client.getAccount({ id: 7 });

  assert.equal(requests[0]?.path, '/v1/admin/accounts/7');
  assert.equal(outcome.status === 'ok' && outcome.value.email, 'anna@example.org');
});

test('listInvites parses an invitation, including the fields only an admin sees', async () => {
  const { client, requests } = clientAnswering({ invites: [INVITE], total: 1 });
  const outcome = await client.listInvites({ limit: 500, offset: 0 });

  assert.equal(requests[0]?.path, '/v1/admin/invites?limit=500&offset=0');
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.value.invites[0]?.status, 'pending');
  assert.equal(outcome.value.invites[0]?.expiresAt, '2026-09-11T09:00:00.000Z');
});

test('stats parses the four counts the console shows', async () => {
  const { client, requests } = clientAnswering({ accounts: 4, admins: 1, pendingInvites: 2, aiRequestsToday: 11 });
  const outcome = await client.stats();

  assert.equal(requests[0]?.path, '/v1/admin/stats');
  assert.equal(outcome.status === 'ok' && outcome.value.pendingInvites, 2);
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

test('patchAccount sends ONLY the fields it was given', async () => {
  // The whole point of the patch body. A request that also carried
  // `displayName: undefined` would serialize the key away, but one built by
  // spreading a full record would send `displayName: null` and clear somebody's
  // name on every allowance change.
  const { client, requests } = clientAnswering({ account: ACCOUNT });
  await client.patchAccount({ id: 7, dailyAiLimit: 500 });

  assert.deepEqual(requests, [{ path: '/v1/admin/accounts/7', method: 'PATCH', body: { dailyAiLimit: 500 } }]);
});

test('patchAccount keeps an explicit null, which is how a name is cleared', async () => {
  const { client, requests } = clientAnswering({ account: ACCOUNT });
  await client.patchAccount({ id: 7, displayName: null });

  assert.deepEqual(requests[0]?.body, { displayName: null });
});

test('patchAccount carries a suspension as a boolean, both ways', async () => {
  const { client, requests } = clientAnswering({ account: ACCOUNT });
  await client.patchAccount({ id: 7, suspended: true });
  await client.patchAccount({ id: 7, suspended: false });

  assert.deepEqual(
    requests.map((request) => request.body),
    [{ suspended: true }, { suspended: false }],
  );
});

test('deleteAccount is a DELETE, and a 204 is a success rather than a parse failure', async () => {
  // The transport answers `null` for a body-less response, and every method
  // that can receive one has to survive it.
  const { client, requests } = clientAnswering(null);
  const outcome = await client.deleteAccount({ id: 7 });

  assert.deepEqual(requests, [{ path: '/v1/admin/accounts/7', method: 'DELETE', body: undefined }]);
  assert.equal(outcome.status, 'ok');
});

test('sendResetMail reports whether the link went out or came back', async () => {
  const mailed = clientAnswering({ emailed: true, link: null });
  const outcome = await mailed.client.sendResetMail({ id: 7 });
  assert.deepEqual(mailed.requests, [{ path: '/v1/admin/accounts/7/reset-mail', method: 'POST', body: undefined }]);
  assert.deepEqual(outcome.status === 'ok' ? outcome.value : null, { emailed: true, link: null });

  const handed = clientAnswering({ emailed: false, link: 'https://app.example.test/reset#token=sr_x' });
  const second = await handed.client.sendResetMail({ id: 7 });
  assert.equal(second.status === 'ok' && second.value.link, 'https://app.example.test/reset#token=sr_x');
});

test('createInvite sends the address and only the options that were chosen', async () => {
  const { client, requests } = clientAnswering({ invite: INVITE, emailed: true, link: null });
  const outcome = await client.createInvite({ email: 'bea@example.org', dailyAiLimit: 200, expiresInDays: 7 });

  assert.deepEqual(requests, [
    {
      path: '/v1/admin/invites',
      method: 'POST',
      body: { email: 'bea@example.org', dailyAiLimit: 200, expiresInDays: 7 },
    },
  ]);
  assert.equal(outcome.status === 'ok' && outcome.value.invite.email, 'bea@example.org');
  assert.equal(outcome.status === 'ok' && outcome.value.emailed, true);
});

test('revokeInvite deletes, and resendInvite posts to the row rather than creating a second one', async () => {
  const revoke = clientAnswering(null);
  await revoke.client.revokeInvite({ id: 12 });
  assert.deepEqual(revoke.requests, [{ path: '/v1/admin/invites/12', method: 'DELETE', body: undefined }]);

  const resend = clientAnswering({ invite: INVITE, emailed: false, link: 'https://app.example.test/join#invite=si_x' });
  const outcome = await resend.client.resendInvite({ id: 12 });
  assert.deepEqual(resend.requests, [{ path: '/v1/admin/invites/12/resend', method: 'POST', body: undefined }]);
  assert.equal(outcome.status === 'ok' && outcome.value.link, 'https://app.example.test/join#invite=si_x');
});

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

test('EVERY method turns a 403 into a typed outcome instead of throwing', async () => {
  for (const kind of ['forbidden', 'suspended'] as const) {
    const client = refusing(kind);
    const outcomes = await Promise.all([
      client.listAccounts(),
      client.getAccount({ id: 7 }),
      client.patchAccount({ id: 7, dailyAiLimit: 1 }),
      client.deleteAccount({ id: 7 }),
      client.sendResetMail({ id: 7 }),
      client.createInvite({ email: 'bea@example.org' }),
      client.listInvites(),
      client.revokeInvite({ id: 12 }),
      client.resendInvite({ id: 12 }),
      client.stats(),
    ]);
    assert.equal(outcomes.length, 10, 'every endpoint on the contract is covered');
    for (const outcome of outcomes) assert.equal(outcome.status, 'forbidden', `${kind} must not throw`);
  }
});

test('anything that is NOT a 403 still throws', async () => {
  // A 500 is not something an administrator can act on, and folding it into
  // the same union would make "the server fell over" render as "you are not an
  // administrator".
  const client = clientFailingWith(new SyncRequestError({ kind: 'server', message: 'boom', status: 500 }));
  await assert.rejects(() => client.listAccounts(), SyncRequestError);
});

test('a malformed body fails at the boundary rather than rendering as undefined', async () => {
  // `aiUsedToday` missing would render "undefined of 200" and read as a
  // quiet day rather than as a bug.
  const { client } = clientAnswering({ accounts: [{ ...ACCOUNT, aiUsedToday: undefined }], total: 1 });
  await assert.rejects(() => client.listAccounts());
});
