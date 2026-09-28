/**
 * THE RESEARCH HTTP SURFACE (M161/04, `PROTOCOL.md` §5.18).
 *
 * `SyncHttpClient`'s five research methods, asserted against the wire contract
 * with `fetchImpl` injected — no server, no network. What is checked is what
 * §5.18 actually promises:
 *
 *  - A `404` on ANY research path means this deployment has no research lane
 *    (ADR-0003 prohibition 9). It is reported, never thrown, and the surface
 *    disappears instead of breaking.
 *  - A `409` on the contributor `PUT` carries the integer to re-seal above.
 *  - A `413` is its own outcome: "your window is too wide" is advice both the
 *    contributor and the study can act on.
 *  - The study-side row shape carries NO account id, and that is asserted as
 *    exact key-set equality rather than a spot check — a `notEqual` on one
 *    field passes the moment somebody adds a different one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { SYNC_API_PREFIX } from '../../app/lib/sync/engine/protocol';
import type {
  ContributionEnrolmentWire,
  ListContributionsResponse,
  ListStudyContributionsResponse,
  ListStudyWithdrawalsResponse,
  ProtocolErrorResponse,
  PutContributionConflictResponse,
} from '../../app/lib/sync/engine/protocol';

/** Every JSON document the stub can answer with — §5.18's own response types, so a stub cannot drift from the contract it is standing in for. */
type StubResponseBody =
  | ContributionEnrolmentWire
  | ListContributionsResponse
  | ListStudyContributionsResponse
  | ListStudyWithdrawalsResponse
  | PutContributionConflictResponse
  | ProtocolErrorResponse;

const BASE_URL = 'https://sync.example.test';
const STATIC_TOKENS = { getAccessToken: () => 'access-token', refreshAccessToken: async () => null };

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(handler: (request: CapturedRequest) => Response) {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const sent = init?.body;
    const captured: CapturedRequest = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: sent === undefined || sent === null ? undefined : JSON.parse(String(sent)),
    };
    requests.push(captured);
    return handler(captured);
  };
  return { fetchImpl, requests };
}

function json(body: StubResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The ordinary unknown-route 404 an instance without `SYNC_RESEARCH` answers on every path below. */
function notFound(): Response {
  return json({ error: 'Not Found' }, 404);
}

function client(fetchImpl: typeof fetch): SyncHttpClient {
  return new SyncHttpClient({ baseUrl: BASE_URL, tokens: STATIC_TOKENS, fetchImpl });
}

test('every read reports unavailable when the research lane is dark, and none of them throws', async () => {
  const { fetchImpl } = stubFetch(() => notFound());
  const sync = client(fetchImpl);

  assert.deepEqual(await sync.listMyContributions(), { status: 'unavailable' });
  assert.deepEqual(await sync.listStudyContributions(), { status: 'unavailable' });
  assert.deepEqual(await sync.listStudyWithdrawals(), { status: 'unavailable' });
  // The PUT's 404 is the SAME code for "no such study" and "no research lane";
  // the client must not invent a distinction it cannot make.
  assert.deepEqual(
    await sync.putContribution({
      studyAccountId: 7,
      pseudonym: 'P',
      schemaTier: 'daily-intake:v1',
      body: new Uint8Array([1, 2, 3]),
      contributionVersion: 1,
    }),
    { status: 'not-found' },
  );
  // Withdrawal is idempotent and a dark lane has no row to remove.
  await sync.withdrawContribution(7);
});

test('putContribution base64-encodes the body and sends the version it was sealed under', async () => {
  const { fetchImpl, requests } = stubFetch(() =>
    json({
      studyAccountId: 7,
      pseudonym: 'P',
      schemaTier: 'daily-intake:v1',
      contributionVersion: 4,
      createdAt: '2026-08-28T09:00:00.000Z',
      updatedAt: '2026-08-28T09:00:00.000Z',
    }),
  );

  const result = await client(fetchImpl).putContribution({
    studyAccountId: 7,
    pseudonym: 'P',
    schemaTier: 'daily-intake:v1',
    body: new Uint8Array([0, 1, 250, 255]),
    contributionVersion: 4,
  });

  assert.deepEqual(result, {
    status: 'accepted',
    enrolment: {
      studyAccountId: 7,
      pseudonym: 'P',
      schemaTier: 'daily-intake:v1',
      contributionVersion: 4,
      createdAt: '2026-08-28T09:00:00.000Z',
      updatedAt: '2026-08-28T09:00:00.000Z',
    },
  });
  assert.equal(requests[0]?.method, 'PUT');
  assert.equal(requests[0]?.url, `${BASE_URL}${SYNC_API_PREFIX}/contributions/7`);
  assert.deepEqual(requests[0]?.body, {
    pseudonym: 'P',
    schemaTier: 'daily-intake:v1',
    body: 'AAH6/w==',
    contributionVersion: 4,
  });
});

test('a 409 returns the current version rather than throwing', async () => {
  const { fetchImpl } = stubFetch(() => json({ currentVersion: 9 }, 409));

  assert.deepEqual(
    await client(fetchImpl).putContribution({
      studyAccountId: 7,
      pseudonym: 'P',
      schemaTier: 'daily-intake:v1',
      body: new Uint8Array([1]),
      contributionVersion: 4,
    }),
    { status: 'conflict', currentVersion: 9 },
  );
});

test('a 413 is a too-large outcome, because the window is advice both sides can act on', async () => {
  const { fetchImpl } = stubFetch(() => json({ error: 'contribution too large' }, 413));

  assert.deepEqual(
    await client(fetchImpl).putContribution({
      studyAccountId: 7,
      pseudonym: 'P',
      schemaTier: 'daily-intake:v1',
      body: new Uint8Array([1]),
      contributionVersion: 4,
    }),
    { status: 'too-large' },
  );
});

test('the study read echoes the account id once and carries no account id per row', async () => {
  const { fetchImpl, requests } = stubFetch(() =>
    json({
      studyAccountId: 7,
      contributions: [
        {
          pseudonym: 'P',
          contributionVersion: 3,
          schemaTier: 'daily-intake:v1',
          body: 'AAH6/w==',
          createdAt: '2026-08-28T09:00:00.000Z',
        },
      ],
    }),
  );

  const page = await client(fetchImpl).listStudyContributions();
  assert.equal(page.status, 'available');
  if (page.status !== 'available') return;
  assert.equal(page.value.studyAccountId, 7);
  assert.equal(requests[0]?.url, `${BASE_URL}${SYNC_API_PREFIX}/study/contributions`);

  // EXACT KEY-SET EQUALITY. Prohibition 2 is broken by an ADDED field, and a
  // spot check for one name passes the moment somebody adds a different one.
  assert.deepEqual(Object.keys(page.value.contributions[0] ?? {}).toSorted(), [
    'body',
    'contributionVersion',
    'createdAt',
    'pseudonym',
    'schemaTier',
  ]);
  assert.deepEqual(page.value.contributions[0]?.body, new Uint8Array([0, 1, 250, 255]));
});

test('the withdrawals read returns pseudonyms and timestamps, and nothing else', async () => {
  const { fetchImpl, requests } = stubFetch(() =>
    json({ withdrawals: [{ pseudonym: 'P', withdrawnAt: '2026-08-27T12:00:00.000Z' }] }),
  );

  const withdrawals = await client(fetchImpl).listStudyWithdrawals();
  assert.equal(withdrawals.status, 'available');
  if (withdrawals.status !== 'available') return;
  assert.equal(requests[0]?.url, `${BASE_URL}${SYNC_API_PREFIX}/study/withdrawals`);
  assert.deepEqual(Object.keys(withdrawals.value[0] ?? {}).toSorted(), ['pseudonym', 'withdrawnAt']);
});

test('withdrawal is a DELETE addressed by the study account id', async () => {
  const { fetchImpl, requests } = stubFetch(() => new Response(null, { status: 204 }));

  await client(fetchImpl).withdrawContribution(7);
  assert.equal(requests[0]?.method, 'DELETE');
  assert.equal(requests[0]?.url, `${BASE_URL}${SYNC_API_PREFIX}/contributions/7`);
});
