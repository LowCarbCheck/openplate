/**
 * The AI proxy: the money question, the privacy question, and the two headers
 * a client reads.
 *
 * IT RUNS AGAINST A REAL LISTENING UPSTREAM on an ephemeral loopback port, not
 * against a stubbed `fetch`. Every property here is about a real request: which
 * headers arrive at the provider, what a 4xx does to the reservation, whether a
 * body that echoes a photograph back reaches a log. A stubbed `fetch` would
 * assert that this module called a function, which is not the same claim.
 *
 * THE SPEND/RELEASE TABLE IS THE POINT OF THE FILE. Getting it wrong is not a
 * bug that shows up in testing; it is an organization whose allowance is eaten
 * by a misconfiguration, or a free infinite retry loop against a flaky
 * provider. Each row of `proxy.ts`'s table has a case below.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createChatCompletionsHandler } from '../../src/ai/proxy.js';
import { DEFAULT_AI_MAX_OUTPUT_TOKENS } from '../../src/ai/chat-body-policy.js';
import { DEFAULT_CHAT_INPUT_POLICY, type ChatInputPolicy } from '../../src/ai/chat-input-bounds.js';
import { scrubPayloads } from '../../src/ai/scrub.js';
import type { AiQuotaStore, ReserveResult } from '../../src/ai/quota-store.js';
import { createBearerAuthMiddleware } from '../../src/server/bearer-auth.js';
import { utcDayKey } from '../../src/lib/utc-day.js';
import type { JsonValue } from '../../src/lib/json.js';
import { hashToken } from '../../src/lib/tokens.js';
import type { LogFields, Logger } from '../../src/logger.js';
import { createAuthFixture, type AuthFixture } from './auth-context-fixture.js';
import { createUnusedTrialScanStore } from './fake-trial-scans.js';

const servers: Server[] = [];

after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** A base64 run long enough to be a plate photograph as far as the scrubber is concerned. */
const PHOTOGRAPH = 'A'.repeat(120);

interface UpstreamRequest {
  authorization: string | undefined;
  contentType: string | undefined;
  cookie: string | undefined;
  apiKey: string | undefined;
  body: string;
}

interface UpstreamAnswer {
  status: number;
  body: string;
  contentType?: string;
}

interface FakeUpstream {
  baseUrl: string;
  received: UpstreamRequest[];
}

async function startFakeUpstream(
  respond: () => UpstreamAnswer = () => ({ status: 200, body: JSON.stringify({ choices: [] }) }),
): Promise<FakeUpstream> {
  const received: UpstreamRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        cookie: req.headers.cookie,
        apiKey: req.headers['x-api-key'] === undefined ? undefined : String(req.headers['x-api-key']),
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const answer = respond();
      res.writeHead(answer.status, { 'content-type': answer.contentType ?? 'application/json' });
      res.end(answer.body);
    });
  });
  servers.push(server);
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port, and Node returns the string form of
  // an address only for a Unix domain socket, which this never opens.
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, received };
}

interface CapturedLine {
  message: string;
  fields: LogFields | undefined;
}

interface CapturingLogger {
  logger: Logger;
  lines: CapturedLine[];
}

function createCapturingLogger(): CapturingLogger {
  const lines: CapturedLine[] = [];
  const record = (message: string, fields?: LogFields): void => {
    lines.push({ message, fields });
  };
  return { lines, logger: { debug: record, info: record, warn: record, error: record } };
}

/**
 * An in-memory quota store that RECORDS every reserve and release, because the
 * spend/release table is a claim about calls rather than about a final number:
 * a reserve followed by a release leaves the same count as no request at all,
 * so counting alone cannot tell "released" from "never reserved".
 */
interface RecordingQuota extends AiQuotaStore {
  reserves: number;
  releases: number;
  count: number;
  /** The instance-wide counter, and the days it was asked about. */
  instanceReserves: number;
  instanceReleases: number;
  instanceCount: number;
  instanceDays: string[];
  /**
   * Every call in order, as `'instance-reserve'`, `'reserve'`,
   * `'instance-release'`, `'release'`.
   *
   * THE ORDER IS A PROPERTY, not a detail. "The instance's unit is taken
   * before the account's" cannot be observed from two counters: both are 1
   * either way round.
   */
  calls: string[];
  /** The weight of every account reserve, in order (2026-09-30). */
  weights: number[];
}

function createRecordingQuota(options: { failAt?: number; instanceFailAt?: number } = {}): RecordingQuota {
  const store: RecordingQuota = {
    ...createUnusedTrialScanStore(),
    reserves: 0,
    releases: 0,
    count: 0,
    instanceReserves: 0,
    instanceReleases: 0,
    instanceCount: 0,
    instanceDays: [],
    calls: [],
    weights: [],
    async reserveInstance(input: { day: string; limit: number; weight: number }): Promise<ReserveResult> {
      store.instanceReserves += 1;
      store.instanceDays.push(input.day);
      store.calls.push('instance-reserve');
      // The real store's rule, reproduced: the ceiling is the predicate, and a
      // refusal reports the ceiling as spent.
      if (store.instanceCount + input.weight > (options.instanceFailAt ?? input.limit)) {
        return { ok: false, used: input.limit, limit: input.limit };
      }
      store.instanceCount += input.weight;
      return { ok: true, used: store.instanceCount, limit: input.limit };
    },
    async releaseInstance(input: { day: string; weight: number }): Promise<void> {
      store.instanceReleases += 1;
      store.calls.push('instance-release');
      // Floored at zero, as the real store's `greatest(..., 0)` is.
      store.instanceCount = Math.max(0, store.instanceCount - input.weight);
    },
    async reserve(input: { accountId: number; day: string; limit: number; weight: number }): Promise<ReserveResult> {
      store.reserves += 1;
      store.calls.push('reserve');
      store.weights.push(input.weight);
      // The real store's rule, reproduced: the limit is the predicate, and a
      // refusal reports the limit as spent.
      if (store.count + input.weight > (options.failAt ?? input.limit)) {
        return { ok: false, used: input.limit, limit: input.limit };
      }
      store.count += input.weight;
      return { ok: true, used: store.count, limit: input.limit };
    },
    async release(input: { accountId: number; day: string; weight: number }): Promise<void> {
      store.releases += 1;
      store.calls.push('release');
      // Floored at zero, as the real store's `greatest(..., 0)` is.
      store.count = Math.max(0, store.count - input.weight);
    },
    async countRequestsOn(): Promise<number> {
      return store.count;
    },
    async purgeUsageBefore(): Promise<number> {
      // The retention half of the store, never exercised by the proxy. Present
      // so this fake satisfies the whole port rather than a convenient part.
      return 0;
    },
  };
  return store;
}

interface Harness {
  baseUrl: string;
  fixture: AuthFixture;
  quota: RecordingQuota;
  logger: CapturingLogger;
  accountId: number;
  accessToken: string;
  close(): Promise<void>;
}

/** Boots the REAL handler behind the REAL bearer middleware, with one seeded account. */
async function startProxy(options: {
  upstreamBaseUrl: string;
  /**
   * The account's AI limit. With no `allowanceExpiresAt` it is the operator's
   * standing free grant, which is what an operator's invite writes since
   * 2026-09-30; with one it is the paid window's limit, as the biller writes it.
   */
  dailyAiLimit?: number;
  /** When the account's paid AI window ends. Absent means no paid window, which is what a new account has. */
  allowanceExpiresAt?: Date;
  /** The standing free grant beside a paid window. Absent means none. Read only with `allowanceExpiresAt`. */
  freeDailyAiLimit?: number;
  /**
   * The old standing-grant shape, written the way it was before 2026-09-30:
   * `dailyAiLimit` with no date, no trial and no free grant.
   */
  legacyStandingGrant?: boolean;
  quota?: RecordingQuota;
  timeoutMs?: number;
  /** The whole instance's ceiling per UTC day. Absent means NONE, which is every deployment that has not opted in. */
  instanceDailyLimit?: number | null;
  /** The consent version the instance requires. Absent means none, which is every self-hosted instance. */
  healthConsentVersion?: string;
  /** The consent version on the account. Absent means none on record. */
  accountConsentVersion?: string;
  /** The input bounds and unit size, over the production defaults. */
  inputPolicy?: Partial<ChatInputPolicy>;
}): Promise<Harness> {
  const fixture = createAuthFixture();
  const account = await fixture.store.seedAccount({
    email: 'anna@example.org',
    dailyAiLimit: options.dailyAiLimit ?? 200,
    healthConsent:
      options.accountConsentVersion === undefined
        ? null
        : { version: options.accountConsentVersion, at: fixture.now() },
  });
  if (options.allowanceExpiresAt !== undefined) {
    // Through `updateStanding`, the operator's own write, rather than a
    // fixture-only setter: an invite carries no expiry, so this is the only way
    // the service itself can put a date on an account. The biller's shape: a
    // date and a paid limit, and the free grant the test names or none.
    await fixture.store.updateStanding({
      accountId: account.id,
      allowanceExpiresAt: options.allowanceExpiresAt,
      dailyAiLimit: options.dailyAiLimit ?? 200,
      freeDailyAiLimit: options.freeDailyAiLimit ?? 0,
    });
  }
  if (options.legacyStandingGrant === true) {
    await fixture.store.updateStanding({
      accountId: account.id,
      dailyAiLimit: options.dailyAiLimit ?? 200,
      freeDailyAiLimit: 0,
    });
  }
  await fixture.store.insertTokens([
    {
      accountId: account.id,
      kind: 'access',
      tokenHash: hashToken('an-access-token'),
      familyId: 'family-1',
      expiresAt: new Date(fixture.now().getTime() + 60_000),
    },
  ]);

  const quota = options.quota ?? createRecordingQuota();
  const logger = createCapturingLogger();
  const app = express();
  app.post(
    '/v1/chat/completions',
    express.json({ limit: '8mb' }),
    createBearerAuthMiddleware(fixture.ctx),
    createChatCompletionsHandler({
      upstream: {
        baseUrl: options.upstreamBaseUrl,
        apiKey: 'the-operator-provider-key',
        timeoutMs: options.timeoutMs ?? 5000,
      },
      quota,
      accounts: fixture.store,
      logger: logger.logger,
      instanceDailyLimit: options.instanceDailyLimit ?? null,
      trialInstanceDailyLimit: null,
      trialNetwork: null,
      // The production wiring's shape with no model: the caller's model
      // passes, and the output ceiling is still written in (M256).
      bodyPolicy: { model: null, maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS },
      inputPolicy: { ...DEFAULT_CHAT_INPUT_POLICY, ...options.inputPolicy },
      healthConsent: options.healthConsentVersion === undefined ? null : { version: options.healthConsentVersion },
      now: fixture.now,
    }),
  );

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: as above — an ephemeral TCP port, never a Unix domain socket.
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    fixture,
    quota,
    logger,
    accountId: account.id,
    accessToken: 'an-access-token',
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function postCompletion(harness: Harness, body: JsonValue = { model: 'm', messages: [] }): Promise<Response> {
  return fetch(`${harness.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${harness.accessToken}`,
      'content-type': 'application/json',
      // Two headers a copy-then-overwrite would forward. Neither may reach the
      // provider — see hard rule 3 in `proxy.ts`.
      cookie: 'session=not-yours',
      'x-api-key': 'a-caller-supplied-key',
    },
    body: JSON.stringify(body),
  });
}

// ── The headers, rebuilt rather than copied ────────────────────────────────

test('the upstream sees the operator key and none of the caller headers', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);

  assert.equal(upstream.received.length, 1);
  const forwarded = upstream.received[0];
  assert.ok(forwarded);
  // THE OPERATOR'S KEY REPLACED THE CALLER'S TOKEN, rather than joining it.
  assert.equal(forwarded.authorization, 'Bearer the-operator-provider-key');
  assert.ok(!forwarded.authorization.includes('an-access-token'), 'the access token must never leave this process');
  // BUILT, NOT COPIED: a copy-then-overwrite forwards cookies, `x-api-key` and
  // whatever the next provider decides to read.
  assert.equal(forwarded.cookie, undefined);
  assert.equal(forwarded.apiKey, undefined);
  assert.equal(forwarded.contentType, 'application/json');
  // The body passed through with one addition: this is a proxy, so the only
  // validation it applies is "is it a JSON object", and the one field it
  // writes with no model configured is the output ceiling (M256).
  assert.deepEqual(JSON.parse(forwarded.body), { model: 'm', messages: [], max_tokens: DEFAULT_AI_MAX_OUTPUT_TOKENS });

  await harness.close();
});

test('a body that is not a JSON object is refused without an upstream call', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

  const response = await fetch(`${harness.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${harness.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(['not', 'an', 'object']),
  });
  assert.equal(response.status, 400);
  assert.equal(upstream.received.length, 0, 'a malformed body must not cost an upstream call');
  // And no reservation: the refusal is before the spend.
  assert.equal(harness.quota.reserves, 0);

  await harness.close();
});

// ── The quota ──────────────────────────────────────────────────────────────

test('a limit of 0 is 403 ai-not-allowed, before the upstream and before the reserve', async () => {
  // NOT A 429: there is nothing to wait for, so a retry-after would be a lie.
  // And it returns before `reserve`, whose insert branch is unguarded — a limit
  // of zero reaching it would write a row with `count = 1`.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 0 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'ai-not-allowed' });
  assert.equal(upstream.received.length, 0);
  assert.equal(harness.quota.reserves, 0, 'a zero limit must never reach the quota store');

  await harness.close();
});

// ── The consent to health data (2026-09-29) ────────────────────────────────

test('an account without the consent is 403 health-consent-required, before the allowance and the reserve', async () => {
  // A LIMIT OF ZERO TOO, which is the point of it: were the consent asked
  // after the allowance, this would answer `ai-not-allowed`. The consent sits
  // beside the suspension, first, so an account that never agreed is told the
  // one thing it can act on and spends nothing.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 0, healthConsentVersion: 'v2' });

  const response = await postCompletion(harness);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'health-consent-required' });
  assert.equal(upstream.received.length, 0);
  assert.equal(harness.quota.reserves, 0, 'a refused consent must never reach the quota store');

  await harness.close();
});

test('a consent to an older wording is refused like none', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    healthConsentVersion: 'v2',
    accountConsentVersion: 'v1',
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'health-consent-required' });
  assert.equal(upstream.received.length, 0);

  await harness.close();
});

test('the twin: an account that holds the version is proxied', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    healthConsentVersion: 'v2',
    accountConsentVersion: 'v2',
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);
  assert.equal(upstream.received.length, 1);

  await harness.close();
});

// ── The allowance's end date ───────────────────────────────────────────────

test('an expired allowance is 403 allowance-expired, before the upstream and before the reserve', async () => {
  // A DISTINCT CODE FROM `ai-not-allowed`, because the two sentences a client
  // shows are not the same sentence: "your operator never gave you AI" against
  // "your time ran out".
  const upstream = await startFakeUpstream();
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 200,
    // The fixture clock is 2026-08-04T10:00:00Z, so this lapsed an hour ago.
    allowanceExpiresAt: new Date('2026-08-04T09:00:00.000Z'),
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'allowance-expired' });
  assert.notEqual(response.status, 429, 'there is nothing to wait for, so a Retry-After would be a lie');
  assert.equal(upstream.received.length, 0);
  // THE LOAD-BEARING HALF. `reserve`'s insert branch is unguarded, so a
  // refusal placed after it would write a row with `count = 1` and bill a day
  // of AI to somebody who got no answer.
  assert.equal(harness.quota.reserves, 0, 'an expired allowance must never reach the quota store');

  await harness.close();
});

test('an allowance that expires LATER is not a refusal', async () => {
  // The control for the case above: with the same wiring and a date in the
  // future, the request goes through. Without it, a handler that refused every
  // account would pass the refusal test.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 200,
    allowanceExpiresAt: new Date('2026-08-05T10:00:00.000Z'),
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);
  assert.equal(upstream.received.length, 1);
  assert.equal(harness.quota.reserves, 1);

  await harness.close();
});

test('the boundary instant REFUSES rather than allows', async () => {
  // The date names the moment the allowance is over, not the last moment it
  // works. A `<` instead of a `<=` passes both cases above and fails only
  // here.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 200,
    // Exactly the fixture's clock.
    allowanceExpiresAt: new Date('2026-08-04T10:00:00.000Z'),
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'allowance-expired' });
  assert.equal(harness.quota.reserves, 0);

  await harness.close();
});

test('an account with no end date is not expired, which is what every account starts as', async () => {
  // The other control: `null` must not read as "expired at the epoch". A
  // handler that compared `new Date(account.allowanceExpiresAt ?? 0)` would
  // refuse every account this service has ever created.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 200 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);
  assert.equal(harness.quota.reserves, 1);

  await harness.close();
});

test('a paid window that ended falls back to the free grant, held to the free limit', async () => {
  // The Beta supporter who bought a plan and cancelled (2026-09-30): the biller
  // left the paid limit and the period's end on the row. Before the free
  // grant this was `403 allowance-expired` for good.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 200,
    freeDailyAiLimit: 10,
    allowanceExpiresAt: new Date('2026-08-04T09:00:00.000Z'),
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);
  assert.equal(upstream.received.length, 1);

  await harness.close();
});

test('the reservation takes the free limit, never the paid limit left on the row', async () => {
  // Ten spent today: the free grant's ten are gone, the paid window's 200 are
  // not. A proxy that reserved against `dailyAiLimit` would let this through.
  const upstream = await startFakeUpstream();
  const quota = createRecordingQuota();
  quota.count = 10;
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 200,
    freeDailyAiLimit: 10,
    allowanceExpiresAt: new Date('2026-08-04T09:00:00.000Z'),
    quota,
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('x-quota-limit'), '10');
  assert.equal(upstream.received.length, 0);

  await harness.close();
});

test('the old standing grant shape, a limit with no date and no trial, is ai-not-allowed', async () => {
  // Migrations 0026 to 0028 moved every such account to the free grant, so the
  // shape is no longer a grant: a PATCH that clears a paid date must not
  // leave the paid limit standing for ever.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 200, legacyStandingGrant: true });

  const response = await postCompletion(harness);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'ai-not-allowed' });
  assert.equal(harness.quota.reserves, 0);
  assert.equal(upstream.received.length, 0);

  await harness.close();
});

test('an expired allowance is refused even when the daily limit is generous', async () => {
  // The two refusals are independent: this account has 500 requests a day and
  // has spent none of them, so the only thing that can refuse it is the date.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 500,
    allowanceExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'allowance-expired' });
  assert.equal(harness.quota.count, 0);

  await harness.close();
});

// ── The instance's own ceiling (M212 spec 02) ──────────────────────────────

test('the instance at its ceiling answers 503 ai-instance-ceiling, before the account and before the upstream', async () => {
  // NOT A 429 AND NOT A 403. A 403 would accuse the caller, whose allowance is
  // untouched; the 429 sentence names "your daily quota", which this is not.
  // The service is out of the capacity its operator paid for.
  const upstream = await startFakeUpstream();
  const quota = createRecordingQuota();
  quota.instanceCount = 2;
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 200,
    instanceDailyLimit: 2,
    quota,
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'ai-instance-ceiling' });
  // The fixture clock is 2026-08-04T10:00:00Z, so the next UTC day is 14 hours
  // out, computed by the same two helpers the 429 path uses.
  assert.equal(Number(response.headers.get('retry-after')), 14 * 60 * 60);
  assert.equal(upstream.received.length, 0, 'a refused instance must not reach the provider');
  // THE ACCOUNT PAYS NOTHING. Its allowance is 200 and it has spent none of
  // it, so a per-account reservation here would bill one person for a refusal
  // that is about the whole instance.
  assert.equal(harness.quota.reserves, 0);
  assert.equal(harness.quota.count, 0);

  await harness.close();
});

test('a ceiling that is NOT reached lets the request through, instance unit first', async () => {
  // The control for the case above: same wiring, a ceiling with room in it.
  // Without this half, a handler that refused every request would pass.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 200, instanceDailyLimit: 5 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);
  assert.equal(upstream.received.length, 1);
  // THE ORDER, which two counters cannot show: both are 1 either way round.
  assert.deepEqual(harness.quota.calls, ['instance-reserve', 'reserve']);
  assert.equal(harness.quota.instanceCount, 1);
  assert.equal(harness.quota.count, 1);
  // And both counters key on the same UTC day the account's quota does.
  assert.deepEqual(harness.quota.instanceDays, [utcDayKey(harness.fixture.now())]);

  await harness.close();
});

test('with NO ceiling configured the instance counter is never touched at all', async () => {
  // THE UNCONFIGURED PATH, which is every deployment that has not opted in and
  // every self-hoster. Not "a ceiling nobody reaches": no statement is issued,
  // so no row exists to be read, counted or swept.
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 200 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);
  assert.equal(harness.quota.instanceReserves, 0, 'an instance with no ceiling must issue no instance statement');
  assert.equal(harness.quota.instanceReleases, 0);
  assert.deepEqual(harness.quota.calls, ['reserve']);

  await harness.close();
});

test('a refused per-account reservation gives the instance unit back', async () => {
  // The instance's unit is taken FIRST, so this is the one path where a unit
  // has been taken for a request that is about to be refused. Keeping it would
  // let one account at its own limit eat the whole instance's ceiling by
  // retrying: 200 refusals, 200 units of somebody else's capacity gone.
  const upstream = await startFakeUpstream();
  const quota = createRecordingQuota();
  quota.count = 2;
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 2,
    instanceDailyLimit: 100,
    quota,
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 429, "the account's own limit is what refused this");
  assert.deepEqual(harness.quota.calls, ['instance-reserve', 'reserve', 'instance-release']);
  assert.equal(harness.quota.instanceReleases, 1);
  // BACK WHERE IT STARTED, which is the assertion a pair of counters can make
  // and the call list cannot: the release actually decremented.
  assert.equal(harness.quota.instanceCount, 0);

  await harness.close();
});

test('an upstream 4xx releases BOTH units, so a bad provider key costs the instance nothing', async () => {
  // The spend/release table in `proxy.ts` applies to both counters, row for
  // row. A 4xx means the provider REFUSED the request, so nobody billed it.
  const upstream = await startFakeUpstream(() => ({ status: 400, body: JSON.stringify({ error: 'unknown model' }) }));
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 3, instanceDailyLimit: 100 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 400);
  assert.equal(harness.quota.count, 0, "the account's unit came back");
  assert.equal(harness.quota.instanceCount, 0, "and so did the instance's");
  assert.deepEqual(harness.quota.calls, ['instance-reserve', 'reserve', 'release', 'instance-release']);

  await harness.close();
});

test('the first refusal of a UTC day writes ONE warn line, and later refusals that day write none', async () => {
  // A ceiling set too low has to show up in the log rather than only in a
  // support mail. Once, though: at a reached ceiling EVERY request is refused,
  // so a line per refusal would be the whole day's traffic written to disk.
  const upstream = await startFakeUpstream();
  const quota = createRecordingQuota();
  quota.instanceCount = 1;
  const harness = await startProxy({
    upstreamBaseUrl: upstream.baseUrl,
    dailyAiLimit: 200,
    instanceDailyLimit: 1,
    quota,
  });

  assert.equal((await postCompletion(harness)).status, 503);
  const afterFirst = harness.logger.lines.filter((line) => line.message.includes('instance AI ceiling'));
  assert.equal(afterFirst.length, 1, 'the first refusal of the day must be recorded');

  // WHAT THE LINE CARRIES: the day and the ceiling, which are the two things
  // an operator acts on. And no account id and no body, per PROTOCOL.md §5.19.
  const recorded = afterFirst[0];
  assert.equal(recorded?.fields?.day, '2026-08-04');
  assert.equal(recorded?.fields?.instanceDailyLimit, 1);
  assert.equal(recorded?.fields?.accountId, undefined, 'whoever sent the refused request is not part of this fact');
  const serialized = JSON.stringify(afterFirst);
  assert.ok(!serialized.includes('anna@example.org'));
  assert.ok(!serialized.includes('an-access-token'));

  assert.equal((await postCompletion(harness)).status, 503);
  assert.equal((await postCompletion(harness)).status, 503);
  const afterMore = harness.logger.lines.filter((line) => line.message.includes('instance AI ceiling'));
  assert.equal(afterMore.length, 1, 'a second refusal on the same day must write nothing');

  await harness.close();
});

test('a 2xx SPENDS the reservation and reports both quota headers', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 3 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-quota-used'), '1');
  assert.equal(response.headers.get('x-quota-limit'), '3');
  assert.equal(harness.quota.releases, 0, 'a served request is not refunded');
  assert.equal(harness.quota.count, 1);

  await harness.close();
});

test('an upstream 4xx RELEASES the reservation: the provider refused, so nobody billed it', async () => {
  // Charging for the operator's own misconfiguration is the worst outcome: a
  // broken proxy would silently eat an organization's whole allowance.
  const upstream = await startFakeUpstream(() => ({ status: 400, body: JSON.stringify({ error: 'unknown model' }) }));
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 3 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 400, "the upstream's status passes through");
  assert.equal(harness.quota.reserves, 1);
  assert.equal(harness.quota.releases, 1, 'a 4xx must be refunded');
  assert.equal(harness.quota.count, 0);
  // The headers ride on this response too: a client that only saw them on
  // success could not tell a released reservation from a spent one.
  assert.equal(response.headers.get('x-quota-used'), '1');
  assert.equal(response.headers.get('x-quota-limit'), '3');

  await harness.close();
});

test('an upstream 5xx KEEPS the reservation: the provider ran the request', async () => {
  // Releasing here hands out a free infinite retry loop against a flaky
  // provider, which is exactly when a client retries hardest.
  const upstream = await startFakeUpstream(() => ({ status: 503, body: JSON.stringify({ error: 'overloaded' }) }));
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 3 });

  const response = await postCompletion(harness);
  assert.equal(response.status, 503);
  assert.equal(harness.quota.releases, 0, 'a 5xx must NOT be refunded');
  assert.equal(harness.quota.count, 1);

  await harness.close();
});

test('a connect failure RELEASES: the request never left this host', async () => {
  const harness = await startProxy({
    // A port nothing is listening on. `fetch` reports this as an opaque
    // TypeError, which is why `isTimeoutError` has to read the cause chain.
    upstreamBaseUrl: 'http://127.0.0.1:1/v1',
    dailyAiLimit: 3,
  });

  const response = await postCompletion(harness);
  assert.equal(response.status, 502);
  assert.equal(harness.quota.reserves, 1);
  assert.equal(harness.quota.releases, 1, 'nothing was served, so the unit goes back');
  assert.equal(harness.quota.count, 0);

  await harness.close();
});

test('an upstream that answers 307 gets no second request, and the caller sees the unreachable answer', async () => {
  // A redirect would make undici resend the body, photograph included, to
  // whatever host the Location header names. The second server stands for
  // that host: it must hear nothing.
  const second = await startFakeUpstream();
  const redirecting = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(307, { location: `${second.baseUrl}/chat/completions` });
      res.end();
    });
  });
  servers.push(redirecting);
  redirecting.listen(0);
  await new Promise<void>((resolve) => redirecting.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port, never a Unix domain socket.
  const { port } = redirecting.address() as AddressInfo;
  const harness = await startProxy({ upstreamBaseUrl: `http://127.0.0.1:${port}/v1`, dailyAiLimit: 3 });

  const response = await postCompletion(harness, {
    model: 'm',
    messages: [{ role: 'user', content: PHOTOGRAPH }],
  });

  assert.equal(second.received.length, 0, 'the redirect target received the request body');
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'the upstream provider could not be reached' });
  assert.equal(harness.quota.releases, 1, 'nothing was served, so the unit goes back');

  await harness.close();
});

test('a spent allowance is 429 with a Retry-After to the next UTC midnight', async () => {
  const upstream = await startFakeUpstream();
  const quota = createRecordingQuota();
  quota.count = 2;
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 2, quota });

  const response = await postCompletion(harness);
  assert.equal(response.status, 429);
  assert.equal(upstream.received.length, 0, 'a refused reservation must not reach the provider');

  // The fixture clock is 2026-08-04T10:00:00Z, so the reset is 14 hours out.
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.equal(retryAfter, 14 * 60 * 60);
  assert.equal(response.headers.get('x-quota-used'), '2');
  assert.equal(response.headers.get('x-quota-limit'), '2');

  await harness.close();
});

test('the quota is keyed on the UTC day the request arrived in', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
  const seen: string[] = [];
  // Wrap the store so the day it was asked about is observable.
  const inner = harness.quota.reserve.bind(harness.quota);
  harness.quota.reserve = async (input): Promise<ReserveResult> => {
    seen.push(input.day);
    return inner(input);
  };

  await postCompletion(harness);
  assert.deepEqual(seen, [utcDayKey(harness.fixture.now())]);
  assert.equal(seen[0], '2026-08-04');

  await harness.close();
});

// ── The privacy rules ──────────────────────────────────────────────────────

test('a provider that echoes the photograph back has it scrubbed from the response AND the log', async () => {
  // The single most likely way a photograph escapes this process, and the
  // string a debugging instinct most wants to log verbatim.
  const echoed = JSON.stringify({ error: 'rejected', input: `data:image/jpeg;base64,${PHOTOGRAPH}` });
  const upstream = await startFakeUpstream(() => ({ status: 422, body: echoed }));
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

  const response = await postCompletion(harness, {
    model: 'm',
    messages: [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PHOTOGRAPH}` } }] },
    ],
  });
  assert.equal(response.status, 422);

  const body = await response.text();
  assert.ok(!body.includes(PHOTOGRAPH), 'the response relayed the photograph back to the caller');
  assert.ok(body.includes('[redacted]'), 'and it must be visibly redacted rather than silently dropped');

  const logged = JSON.stringify(harness.logger.lines);
  assert.ok(!logged.includes(PHOTOGRAPH), 'the log carries the photograph');
  // The positive half, so a handler that logged nothing would not pass by
  // silence: the failure IS recorded, with a status and byte counts.
  assert.ok(logged.includes('Upstream provider returned an error'));

  await harness.close();
});

test('nothing the proxy logs on the happy path carries a body or a key', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

  await postCompletion(harness, { model: 'm', messages: [{ role: 'user', content: PHOTOGRAPH }] });

  const logged = JSON.stringify(harness.logger.lines);
  assert.ok(logged.includes('Proxied a completion'), 'a proxied call must be recorded');
  for (const secret of [PHOTOGRAPH, 'the-operator-provider-key', 'an-access-token', 'anna@example.org']) {
    assert.ok(!logged.includes(secret), `the log carries "${secret}"`);
  }
  // What it DOES carry: counts, not bytes.
  const proxied = harness.logger.lines.find((line) => line.message === 'Proxied a completion');
  assert.equal(proxied?.fields?.accountId, harness.accountId);
  assert.equal(proxied?.fields?.quotaUsed, 1);

  await harness.close();
});

test('the scrubber redacts data URIs and long base64 runs, and is idempotent', () => {
  const once = scrubPayloads(`before data:image/png;base64,${PHOTOGRAPH} after`);
  assert.equal(once, 'before [redacted] after');
  assert.equal(scrubPayloads(once), once, 'scrubbing a scrubbed string must not change it');

  // A bare run, without the data-URI prefix. It swallows the `id=` label with
  // it, because `i`, `d` and `=` are all in the base64 alphabet and the run is
  // therefore continuous. That over-reach is the SAFE direction and is left
  // alone: a redaction that eats a label is a log line somebody has to read
  // twice, and a redaction that stops one character short is a photograph.
  assert.equal(scrubPayloads(`id=${PHOTOGRAPH}`), '[redacted]');
  // A separator outside the alphabet ends the run, so a field beside a payload
  // survives.
  assert.equal(scrubPayloads(`id: ${PHOTOGRAPH}`), 'id: [redacted]');
  // ...and short identifiers survive whole, or the scrubber would eat the
  // fields somebody actually wanted to read.
  assert.equal(scrubPayloads('accountId=42 family=abc123'), 'accountId=42 family=abc123');
});

// ── Streaming ──────────────────────────────────────────────────────────────

test('a streaming response is piped through unchanged, with the no-transform header', async () => {
  const chunks = 'data: one\n\ndata: two\n\ndata: [DONE]\n\n';
  const upstream = await startFakeUpstream(() => ({
    status: 200,
    body: chunks,
    contentType: 'text/event-stream',
  }));
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

  const response = await postCompletion(harness, { model: 'm', messages: [], stream: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  // Server-sent events die behind a buffering proxy, so this is said explicitly
  // rather than left to whatever reverse proxy the deployment has.
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(await response.text(), chunks, 'the stream must pass through byte for byte');

  await harness.close();
});

// ── The identity gate ──────────────────────────────────────────────────────

test('an unauthenticated caller is 401 and never reaches the quota or the provider', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

  const response = await fetch(`${harness.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'm', messages: [] }),
  });
  assert.equal(response.status, 401);
  assert.equal(harness.quota.reserves, 0);
  assert.equal(upstream.received.length, 0);

  await harness.close();
});

test('a suspended account is 403 account-suspended, from the bearer gate', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
  await harness.fixture.store.suspendAccount({ accountId: harness.accountId, suspendedAt: harness.fixture.now() });
  // Suspending revoked the session, so a live token on a suspended account
  // needs minting: that combination is what the gate must catch.
  await harness.fixture.store.insertTokens([
    {
      accountId: harness.accountId,
      kind: 'access',
      tokenHash: hashToken('a-live-token'),
      familyId: 'family-2',
      expiresAt: new Date(harness.fixture.now().getTime() + 60_000),
    },
  ]);

  const response = await fetch(`${harness.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer a-live-token', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'm', messages: [] }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'account-suspended' });
  assert.equal(harness.quota.reserves, 0);
  assert.equal(upstream.received.length, 0);

  await harness.close();
});

test('a successful call stamps last_seen_at, and a failed one does not', async () => {
  const failing = await startFakeUpstream(() => ({ status: 503, body: '{}' }));
  const failed = await startProxy({ upstreamBaseUrl: failing.baseUrl });
  await postCompletion(failed);
  assert.equal(failed.fixture.store.lastSeenFor(failed.accountId), null, 'a failed call is not "seen"');
  await failed.close();

  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
  await postCompletion(harness);
  assert.deepEqual(harness.fixture.store.lastSeenFor(harness.accountId), harness.fixture.now());
  await harness.close();
});

// ── What one request carries in, and what it weighs (2026-09-30) ────────────

/** One user message of `bytes` characters of text, as a body. */
function textRequest(bytes: number): JsonValue {
  return { model: 'm', messages: [{ role: 'user', content: 'x'.repeat(bytes) }] };
}

test('a body over an input bound is 400 ai-request-too-large, naming the bound, before the reserve and the provider', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, instanceDailyLimit: 100 });
  const image = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } };

  const cases: { body: JsonValue; limit: string; max: number }[] = [
    {
      body: { model: 'm', messages: [{ role: 'user', content: [image, image] }] },
      limit: 'image-parts',
      max: 1,
    },
    { body: textRequest(48 * 1024 + 1), limit: 'text-bytes', max: 48 * 1024 },
    {
      // A schema is input the model reads: it counts as text.
      body: { model: 'm', messages: [], response_format: { schema: { description: 'x'.repeat(50_000) } } },
      limit: 'text-bytes',
      max: 48 * 1024,
    },
    {
      body: { model: 'm', messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'hi' })) },
      limit: 'messages',
      max: 4,
    },
  ];
  for (const refusal of cases) {
    const response = await postCompletion(harness, refusal.body);
    assert.equal(response.status, 400, refusal.limit);
    assert.deepEqual(await response.json(), { error: 'ai-request-too-large', limit: refusal.limit, max: refusal.max });
  }
  assert.equal(upstream.received.length, 0, 'a refused body never left this host');
  assert.deepEqual(harness.quota.calls, [], 'a refused body reserved nothing, the instance included');

  // THE CONTROL: the same shapes at the bound are proxied.
  assert.equal((await postCompletion(harness, textRequest(48 * 1024))).status, 200);
  assert.equal(
    (await postCompletion(harness, { model: 'm', messages: [{ role: 'user', content: [image] }] })).status,
    200,
  );
  assert.equal(upstream.received.length, 2);

  await harness.close();
});

test('a heavy request reserves its weight on the account and the instance, and a 4xx gives the same weight back', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 10, instanceDailyLimit: 10 });

  // About 10,000 estimated tokens: two units of 8,192.
  const heavy = await postCompletion(harness, textRequest(40_000));
  assert.equal(heavy.status, 200);
  assert.equal(heavy.headers.get('x-quota-used'), '2');
  assert.equal(harness.quota.count, 2);
  assert.equal(harness.quota.instanceCount, 2);

  // THE CONTROL: a plate-scan-sized request is one unit.
  const light = await postCompletion(harness, textRequest(12_000));
  assert.equal(light.headers.get('x-quota-used'), '3');
  assert.deepEqual(harness.quota.weights, [2, 1]);

  await harness.close();

  const refusing = await startFakeUpstream(() => ({ status: 400, body: '{}' }));
  const released = await startProxy({ upstreamBaseUrl: refusing.baseUrl, dailyAiLimit: 10, instanceDailyLimit: 10 });
  assert.equal((await postCompletion(released, textRequest(40_000))).status, 400);
  assert.equal(released.quota.count, 0, 'the release gave back both units, not one');
  assert.equal(released.quota.instanceCount, 0);
  await released.close();
});

test('a weight that does not fit what is left of the allowance is 429, and the instance units go back', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl, dailyAiLimit: 2, instanceDailyLimit: 10 });

  assert.equal((await postCompletion(harness, textRequest(100))).status, 200);
  const refused = await postCompletion(harness, textRequest(40_000));
  assert.equal(refused.status, 429);
  // SAFETY: the handler answers every refusal as a JSON object, and a body
  // that did not parse would throw here rather than reach the assertion.
  const body = (await refused.json()) as { error?: string };
  assert.match(body.error ?? '', /units used, and this request needs 2/);
  assert.equal(harness.quota.instanceCount, 1, 'the heavy request took nothing from the instance in the end');
  assert.equal(upstream.received.length, 1);

  await harness.close();
});

test('dropped fields are logged by name, never by value, and never reach the provider', async () => {
  const upstream = await startFakeUpstream();
  const harness = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

  const secret = 'a-secret-prompt-inside-a-tool';
  const response = await postCompletion(harness, {
    model: 'm',
    messages: [{ role: 'user', content: 'rice' }],
    tools: [{ type: 'function', function: { name: 'f', description: secret } }],
  });
  assert.equal(response.status, 200);
  const forwarded = upstream.received[0]?.body ?? '';
  assert.ok(!forwarded.includes(secret), 'the dropped field reached the provider');

  const line = harness.logger.lines.find((entry) => entry.message.startsWith('Dropped chat body fields'));
  assert.equal(line?.fields?.fields, 'tools');
  assert.ok(!JSON.stringify(harness.logger.lines).includes(secret), 'a dropped value reached the log');

  await harness.close();
});
