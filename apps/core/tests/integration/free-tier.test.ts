/**
 * The standing free grant (2026-09-30), against real Postgres.
 *
 * THREE CLAIMS, EACH WITH ITS CONTROL:
 *  1. Migrations 0026 to 0028 move the old "limit, no date, no trial" shape to
 *     `free_daily_ai_limit` once, and never again: the value is frozen after
 *     the migration, so a later write of that shape grants nothing.
 *  2. Redemption writes the free grant for an operator's invite, and never for
 *     a member's, even after the inviter deleted their account.
 *  3. The proxy falls back to the free grant when a paid window ends, reserves
 *     against the free limit, and refuses the old shape.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { runMigrations } from '../../src/db/client.js';
import { createDrizzleInviteStore } from '../../src/db/invite-store.js';
import { accounts, aiUsageDays } from '../../src/db/schema.js';
import { dropDatabase, setupEmptyDatabase, setupTestDatabase, type TestDatabase } from './db-harness.js';
import { sampleSignupBody, startService, type ServiceHarness } from './service-harness.js';

const MIGRATIONS = 'drizzle/migrations';
/** The last migration before the free grant existed. */
const LAST_BEFORE_FREE_GRANT = 25;

let database: TestDatabase;
let upstream: Server;
let upstreamBaseUrl: string;
let upstreamCalls: number;

before(async () => {
  database = await setupTestDatabase();
  upstream = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      upstreamCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'a plate' } }] }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => upstream.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form
  // only for a Unix domain socket, which this never opens.
  upstreamBaseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  upstreamCalls = 0;
});

// ── 1. The backfill ──────────────────────────────────────────────────────────

/** A migrations folder holding only the entries up to `lastIndex`, the way a deployment before them saw it. */
async function migrationsUpTo(lastIndex: number): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'openplate-free-tier-'));
  await mkdir(join(folder, 'meta'));
  // SAFETY: drizzle-kit writes this file, and every journal it writes has an
  // `entries` array of `{ idx, tag }` objects; the migrator reads it the same way.
  const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
  for (const entry of entries) await cp(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  await writeFile(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return folder;
}

test('the migrations move the old standing grant to the free grant once, and freeze it', async () => {
  const handle = await setupEmptyDatabase({ suffix: 'free_backfill' });
  const partial = await migrationsUpTo(LAST_BEFORE_FREE_GRANT);
  try {
    await runMigrations({ db: handle.db, migrationsFolder: partial });
    // One row per shape the proxy ever saw, written by the schema before 0026.
    const standings: [string, number, string | null, number | null][] = [
      ['beta-supporter@example.org', 10, null, null],
      ['paid-and-ended@example.org', 200, '2026-09-01T00:00:00Z', null],
      ['paying@example.org', 200, '2099-01-01T00:00:00Z', null],
      ['trial@example.org', 20, null, 10],
      ['no-ai@example.org', 0, null, null],
    ];
    for (const [email, limit, expiresAt, trialScans] of standings) {
      await handle.pool.query(
        'INSERT INTO accounts (email, verifier, kdf_descriptor, daily_ai_limit, allowance_expires_at, trial_scans) ' +
          "VALUES ($1, 'v', '{}'::jsonb, $2, $3, $4)",
        [email, limit, expiresAt, trialScans],
      );
    }

    await runMigrations({ db: handle.db, migrationsFolder: MIGRATIONS });

    const read = async (): Promise<Record<string, [number, number]>> => {
      const rows = await handle.pool.query<{ email: string; daily_ai_limit: number; free_daily_ai_limit: number }>(
        'SELECT email, daily_ai_limit, free_daily_ai_limit FROM accounts',
      );
      return Object.fromEntries(rows.rows.map((row) => [row.email, [row.daily_ai_limit, row.free_daily_ai_limit]]));
    };
    assert.deepEqual(await read(), {
      // The only shape that moves: a limit with no date and no trial.
      'beta-supporter@example.org': [10, 10],
      // THE CONTROLS: a paid window, ended or live, a trial, and no AI keep none.
      'paid-and-ended@example.org': [200, 0],
      'paying@example.org': [200, 0],
      'trial@example.org': [20, 0],
      'no-ai@example.org': [0, 0],
    });

    // FROZEN, not generated: the old shape written after the migration grants
    // nothing, and a new row takes the default of 0.
    await handle.pool.query("UPDATE accounts SET daily_ai_limit = 500 WHERE email = 'no-ai@example.org'");
    await handle.pool.query(
      "INSERT INTO accounts (email, verifier, kdf_descriptor, daily_ai_limit) VALUES ('later@example.org', 'v', '{}'::jsonb, 7)",
    );
    const frozen = await read();
    assert.deepEqual(frozen['no-ai@example.org'], [500, 0]);
    assert.deepEqual(frozen['later@example.org'], [7, 0]);
  } finally {
    await rm(partial, { recursive: true, force: true });
    await handle.close();
    await dropDatabase({ url: handle.url });
  }
});

// ── 2. Redemption ────────────────────────────────────────────────────────────

/** Mints one invite straight through the store, the door named by `source` and `invitedByAccountId`. */
async function mintInvite(input: {
  email: string;
  dailyAiLimit: number;
  invitedByAccountId: number | null;
  source: 'member' | null;
}): Promise<string> {
  const minted = await createDrizzleInviteStore(database.db).mint({
    email: input.email,
    displayName: null,
    role: 'member',
    dailyAiLimit: input.dailyAiLimit,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    now: new Date(),
    invitedByAccountId: input.invitedByAccountId,
    source: input.source,
    trialScans: null,
    trialDays: null,
  });
  if (!minted.ok) throw new Error(`could not mint an invite for ${input.email}: ${minted.reason}`);
  return minted.minted.token;
}

async function redeem(service: ServiceHarness, token: string): Promise<number> {
  const created = await service.request<{ account: { id: number } }>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: sampleSignupBody({ inviteToken: token }),
  });
  assert.equal(created.status, 201);
  return created.body.account.id;
}

async function standingOf(accountId: number): Promise<{
  dailyAiLimit: number;
  freeDailyAiLimit: number;
  hasDate: boolean;
}> {
  const [row] = await database.db.select().from(accounts).where(eq(accounts.id, accountId));
  if (row === undefined) throw new Error(`no account ${accountId}`);
  return {
    dailyAiLimit: row.dailyAiLimit,
    freeDailyAiLimit: row.freeDailyAiLimit,
    hasDate: row.allowanceExpiresAt !== null,
  };
}

test('an operator invite with no trial redeems as a standing free grant', async () => {
  const service = await startService({ db: database.db });
  try {
    const id = await redeem(
      service,
      await mintInvite({ email: 'granted@example.org', dailyAiLimit: 10, invitedByAccountId: null, source: null }),
    );
    assert.deepEqual(await standingOf(id), { dailyAiLimit: 0, freeDailyAiLimit: 10, hasDate: false });
  } finally {
    await service.close();
  }
});

test('a member invite whose inviter deleted their account still redeems as the member day trial', async () => {
  const service = await startService({
    db: database.db,
    memberInvites: { dailyAiLimit: 20, allowanceDays: 7 },
  });
  try {
    const inviter = await service.signupThroughInvite({ email: 'inviter@example.org' });
    const token = await mintInvite({
      email: 'friend@example.org',
      dailyAiLimit: 20,
      invitedByAccountId: inviter.account.id,
      source: 'member',
    });
    // `ON DELETE SET NULL`: the row now looks like an operator's mint by its
    // inviter column alone.
    await database.db.delete(accounts).where(eq(accounts.id, inviter.account.id));

    const id = await redeem(service, token);
    assert.deepEqual(await standingOf(id), { dailyAiLimit: 20, freeDailyAiLimit: 0, hasDate: true });
  } finally {
    await service.close();
  }
});

test('a member invite on an instance that turned member invites off redeems with no AI at all', async () => {
  const service = await startService({ db: database.db, memberInvites: null });
  try {
    const inviter = await service.signupThroughInvite({ email: 'inviter@example.org' });
    const token = await mintInvite({
      email: 'friend@example.org',
      dailyAiLimit: 20,
      invitedByAccountId: inviter.account.id,
      source: 'member',
    });
    const id = await redeem(service, token);
    // Before 2026-09-30 this was a limit of 20 with no date, for ever.
    assert.deepEqual(await standingOf(id), { dailyAiLimit: 0, freeDailyAiLimit: 0, hasDate: false });
  } finally {
    await service.close();
  }
});

// ── 3. The proxy ─────────────────────────────────────────────────────────────

async function startWithAi(): Promise<ServiceHarness> {
  return startService({ db: database.db, ai: { baseUrl: upstreamBaseUrl, apiKey: 'sk-upstream', timeoutMs: 5_000 } });
}

async function complete(service: ServiceHarness, accessToken: string) {
  return service.request<{ error?: string }>({
    method: 'POST',
    path: '/v1/chat/completions',
    accessToken,
    body: { model: 'a-vision-model', messages: [{ role: 'user', content: 'what is on this plate?' }] },
  });
}

test('a paid window that ended falls back to the free grant, reserved at the free limit', async () => {
  const service = await startWithAi();
  try {
    const session = await service.signupThroughInvite({ email: 'beta-supporter@example.org' });
    // What the biller leaves behind a cancelled period, above a Beta
    // supporter's free grant.
    await database.db
      .update(accounts)
      .set({ dailyAiLimit: 200, allowanceExpiresAt: new Date(Date.now() - 60_000), freeDailyAiLimit: 10 })
      .where(eq(accounts.id, session.account.id));

    const answered = await complete(service, session.tokens.accessToken);
    assert.equal(answered.status, 200);
    assert.equal(answered.headers.get('x-quota-limit'), '10');
    assert.equal(upstreamCalls, 1);

    // THE CONTROL: the same row with no free grant is refused as expired,
    // with no usage row beyond the one the answered request wrote.
    await database.db.update(accounts).set({ freeDailyAiLimit: 0 }).where(eq(accounts.id, session.account.id));
    const refused = await complete(service, session.tokens.accessToken);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'allowance-expired');
    assert.equal(upstreamCalls, 1);
  } finally {
    await service.close();
  }
});

test('the old standing grant shape is ai-not-allowed and writes no usage row', async () => {
  const service = await startWithAi();
  try {
    const session = await service.signupThroughInvite({ email: 'cleared-by-hand@example.org' });
    // What clearing a paid date by hand used to leave: 200 a day for ever.
    await database.db
      .update(accounts)
      .set({ dailyAiLimit: 200, allowanceExpiresAt: null, freeDailyAiLimit: 0 })
      .where(eq(accounts.id, session.account.id));

    const refused = await complete(service, session.tokens.accessToken);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'ai-not-allowed');
    const rows = await database.db.select().from(aiUsageDays).where(eq(aiUsageDays.accountId, session.account.id));
    assert.deepEqual(rows, []);
    assert.equal(upstreamCalls, 0);
  } finally {
    await service.close();
  }
});
