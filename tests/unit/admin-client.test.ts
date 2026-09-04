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

import { z } from 'zod';

import { AdminClient, type AdminTransport } from '../../app/lib/admin/admin-client';
import { adminStatsResponseSchema } from '../../app/lib/admin/admin-wire';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { AuthorizedMethod } from '../../app/lib/sync/engine/client/auth-client';
import type { JsonObject, JsonValue } from '../../app/lib/sync/engine/protocol';

/** One request as the client made it. The shape of these is the contract this file pins. */
interface RecordedRequest {
  path: string;
  method: AuthorizedMethod;
  body: JsonValue | undefined;
}

const ACCOUNT: JsonObject = {
  id: 7,
  email: 'anna@example.org',
  displayName: 'Anna',
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 3,
  suspendedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
};

const INVITE: JsonObject = {
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

/** A client that answers each successive request with the next canned page, body or refusal. */
function clientPaging(pages: readonly FakeAnswer[]): RecordedClient {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const transport: AdminTransport = {
    requestAsAccount(input) {
      requests.push({ path: input.path, method: input.method, body: input.body });
      const answer = pages[index] ?? pages.at(-1);
      index += 1;
      if (answer === undefined) return Promise.resolve(null);
      if (answer.kind === 'error') return Promise.reject(answer.error);
      return Promise.resolve(answer.body);
    },
  };
  return { client: new AdminClient({ transport }), requests };
}

/** One page of a list, as the transport hands it back. */
function page(body: JsonValue): FakeAnswer {
  return { kind: 'body', body };
}

/** `count` accounts with ids starting one past `from`. Only the id has to differ. */
function accountsNumbered(from: number, count: number): JsonValue[] {
  return Array.from({ length: count }, (_item, index) => ({ ...ACCOUNT, id: from + index + 1 }));
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

test('listAccounts asks for a page the service will serve, and parses it', async () => {
  const { client, requests } = clientAnswering({ accounts: [ACCOUNT], total: 1 });
  const outcome = await client.listAccounts();

  // 200, NOT 500. The service caps `limit` at 200 (`PROTOCOL.md` §5.20) and
  // answers `400` above it, which is how the whole admin page rendered its
  // error card while `/stats` beside it returned 200.
  assert.deepEqual(requests, [{ path: '/v1/admin/accounts?limit=200&offset=0', method: 'GET', body: undefined }]);
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.value.total, 1);
  assert.equal(outcome.value.accounts[0]?.email, 'anna@example.org');
  assert.equal(outcome.value.accounts[0]?.aiUsedToday, 3);
});

test('a list longer than one page is followed to the end and concatenated', async () => {
  const { client, requests } = clientPaging([
    page({ accounts: accountsNumbered(0, 200), total: 250 }),
    page({ accounts: accountsNumbered(200, 50), total: 250 }),
  ]);
  const outcome = await client.listAccounts();

  assert.deepEqual(
    requests.map((request) => request.path),
    ['/v1/admin/accounts?limit=200&offset=0', '/v1/admin/accounts?limit=200&offset=200'],
    'the second request follows `offset`, and there is no third',
  );
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.value.accounts.length, 250);
  assert.equal(outcome.value.total, 250);
  assert.equal(outcome.value.accounts[0]?.id, 1, 'the first page comes first');
  assert.equal(outcome.value.accounts[249]?.id, 250, 'and the second is appended, not substituted');
});

test('an empty instance is one request and an empty array', async () => {
  const { client, requests } = clientAnswering({ accounts: [], total: 0 });
  const outcome = await client.listAccounts();

  assert.equal(requests.length, 1, 'a total of 0 is already the whole list');
  assert.equal(outcome.status === 'ok' && outcome.value.accounts.length, 0);
  assert.equal(outcome.status === 'ok' && outcome.value.total, 0);
});

test('a page that comes back empty stops the read, whatever the total claims', async () => {
  // A service reporting a total it will not serve would otherwise spin until
  // the page cap, 50 requests later.
  const { client, requests } = clientPaging([
    page({ accounts: accountsNumbered(0, 200), total: 10_000 }),
    page({ accounts: [], total: 10_000 }),
  ]);
  const outcome = await client.listAccounts();

  assert.equal(requests.length, 2);
  assert.equal(outcome.status === 'ok' && outcome.value.accounts.length, 200);
});

test('a refusal on the second page ends the whole read', async () => {
  // Being demoted between two requests is the case, and half a list is worse
  // than none.
  const { client, requests } = clientPaging([
    page({ accounts: accountsNumbered(0, 200), total: 250 }),
    { kind: 'error', error: new SyncRequestError({ kind: 'forbidden', message: 'forbidden', status: 403 }) },
  ]);
  const outcome = await client.listAccounts();

  assert.equal(outcome.status, 'forbidden');
  assert.equal(requests.length, 2, 'and it stops there');
});

test('listInvites is paged the same way', async () => {
  const { client, requests } = clientPaging([
    page({ invites: Array.from({ length: 200 }, (_item, index) => ({ ...INVITE, id: index + 1 })), total: 205 }),
    page({ invites: Array.from({ length: 5 }, (_item, index) => ({ ...INVITE, id: index + 201 })), total: 205 }),
  ]);
  const outcome = await client.listInvites();

  assert.deepEqual(
    requests.map((request) => request.path),
    ['/v1/admin/invites?limit=200&offset=0', '/v1/admin/invites?limit=200&offset=200'],
  );
  assert.equal(outcome.status === 'ok' && outcome.value.invites.length, 205);
});

test('getAccount unwraps the envelope', async () => {
  const { client, requests } = clientAnswering({ account: ACCOUNT });
  const outcome = await client.getAccount({ id: 7 });

  assert.equal(requests[0]?.path, '/v1/admin/accounts/7');
  assert.equal(outcome.status === 'ok' && outcome.value.email, 'anna@example.org');
});

test('listInvites parses an invitation, including the fields only an admin sees', async () => {
  const { client, requests } = clientAnswering({ invites: [INVITE], total: 1 });
  const outcome = await client.listInvites();

  assert.equal(requests[0]?.path, '/v1/admin/invites?limit=200&offset=0');
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.value.invites[0]?.status, 'pending');
  assert.equal(outcome.value.invites[0]?.expiresAt, '2026-09-11T09:00:00.000Z');
});

/**
 * The stats body EXACTLY as `openplate-sync` 0.6.0 sends it, transcribed from
 * the network log of the 2026-09-04 walk.
 *
 * Wrapped in `stats`, like every other admin response, and carrying four
 * operator metrics this client has no use for. Reading the counts at the top
 * level is what made the whole console render its retry card behind three
 * `200`s.
 */
const STATS_BODY: JsonValue = {
  stats: {
    accounts: 2,
    accountsWithBlob: 2,
    blobVersions: 5,
    keyRecords: 4,
    blobBytes: 1803,
    pendingInvites: 0,
    admins: 2,
    aiRequestsToday: 1,
  },
};

test('stats reads the four counts out of the `stats` envelope', async () => {
  const { client, requests } = clientAnswering(STATS_BODY);
  const outcome = await client.stats();

  assert.equal(requests[0]?.path, '/v1/admin/stats');
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.deepEqual(outcome.value, { accounts: 2, admins: 2, pendingInvites: 0, aiRequestsToday: 1 });
});

test('stats tolerates the operator metrics it does not use', () => {
  // `accountsWithBlob`, `blobVersions`, `keyRecords` and `blobBytes` are in the
  // body above and must not be in the result, nor cause a refusal: a schema
  // that rejected unknown fields would turn every new server metric into a
  // broken admin page.
  const parsed = adminStatsResponseSchema.parse(STATS_BODY);
  assert.deepEqual(
    Object.keys(parsed.stats).toSorted(),
    ['aiRequestsToday', 'accounts', 'admins', 'pendingInvites'].toSorted(),
  );
});

test('an unwrapped stats body is refused, which is what the defect looked like', async () => {
  // The shape this client used to expect. It must not silently parse as
  // something, and it must not be mistaken for a permission problem.
  const { client } = clientAnswering({ accounts: 4, admins: 1, pendingInvites: 2, aiRequestsToday: 11 });
  await assert.rejects(() => client.stats(), z.ZodError);
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
