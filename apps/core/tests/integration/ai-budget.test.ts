/**
 * The budget read and the low-budget claim against a real Postgres
 * (2026-09-30).
 *
 * ── WHAT ONLY A DATABASE CAN PROVE ───────────────────────────────────────
 *
 *  1. `GET /v1/admin/ai/budget` reports the two counters the proxy writes, for
 *     the day the ceilings key on. The counters are taken through the real
 *     quota store, the proxy's own writer, so this reads what a request left.
 *  2. The alert's claim survives a restart. A restart is a new alerter over a
 *     new store on the same database, which is what `main.ts` builds on every
 *     boot. The control is the next period on the same database, which mails.
 *  3. Two alerters racing for one period mail once between them.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type ServiceHarness } from './service-harness.js';
import { createDrizzleAiQuotaStore } from '../../src/ai/quota-store.js';
import { createBudgetAlerter } from '../../src/ai/budget-alert.js';
import type { UpstreamKeyBudget } from '../../src/ai/upstream-budget.js';
import { createDrizzleBudgetAlertStore } from '../../src/db/budget-alert-store.js';
import { aiBudgetAlerts } from '../../src/db/schema.js';
import { createNoopMailer, type SendAiBudgetAlertInput } from '../../src/mail/mailer.js';
import { createSilentLogger } from '../../src/logger.js';
import { utcDayKey } from '../../src/lib/utc-day.js';

const ADMIN_TOKEN = 'integration-admin-token-budget-0123456789abcdef';

const LOW: UpstreamKeyBudget = {
  limitUsd: 5,
  remainingUsd: 0.5,
  reset: 'monthly',
  usageDailyUsd: 0.2,
  usageWeeklyUsd: 1,
  usageMonthlyUsd: 4.5,
};

let database: TestDatabase;
let service: ServiceHarness;

before(async () => {
  database = await setupTestDatabase();
  service = await startService({
    db: database.db,
    adminToken: ADMIN_TOKEN,
    ai: {
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'never-called',
      instanceDailyLimit: 2000,
      trialInstanceDailyLimit: 300,
    },
  });
});

after(async () => {
  await service.close();
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

interface BudgetBody {
  day: string;
  capacity: { paid: { used: number; limit: number | null }; trial: { used: number; limit: number | null } };
  upstream: null;
}

test('the route reports the units the proxy counters hold for today, against both ceilings', async () => {
  const quota = createDrizzleAiQuotaStore(database.db);
  const day = utcDayKey(new Date());
  await quota.reserveInstance({ day, limit: 2000, weight: 3 });
  await quota.reserveInstance({ day, limit: 2000, weight: 2 });
  await quota.reserveTrialInstance({ day, limit: 300, weight: 4 });
  // Yesterday's units are not today's.
  await quota.reserveInstance({ day: '2026-01-01', limit: 2000, weight: 9 });

  const response = await service.request<BudgetBody>({
    method: 'GET',
    path: '/v1/admin/ai/budget',
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.day, day);
  assert.deepEqual(response.body.capacity, { paid: { used: 5, limit: 2000 }, trial: { used: 4, limit: 300 } });
  assert.equal(response.body.upstream, null, 'a loopback upstream is not OpenRouter');
});

test('a day with no row reports zero used, not an error', async () => {
  const response = await service.request<BudgetBody>({
    method: 'GET',
    path: '/v1/admin/ai/budget',
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.capacity, { paid: { used: 0, limit: 2000 }, trial: { used: 0, limit: 300 } });
});

/** One boot's alerter over the shared database, recording what it mailed. */
function bootAlerter(input: { sent: SendAiBudgetAlertInput[]; now: Date }): ReturnType<typeof createBudgetAlerter> {
  return createBudgetAlerter({
    store: createDrizzleBudgetAlertStore(database.db),
    mailer: {
      ...createNoopMailer(),
      sendAiBudgetAlert: async (letter: SendAiBudgetAlertInput): Promise<void> => {
        input.sent.push(letter);
      },
    },
    mailConfigured: true,
    fraction: 0.2,
    logger: createSilentLogger(),
    now: () => input.now,
  });
}

test('the alert goes out once per period, and not again after a restart', async () => {
  const sent: SendAiBudgetAlertInput[] = [];
  const september = new Date('2026-09-30T10:00:00.000Z');

  await bootAlerter({ sent, now: september }).check(LOW);
  assert.equal(sent.length, 1);

  // A restart: a new alerter and a new store, the same database.
  await bootAlerter({ sent, now: september }).check(LOW);
  assert.equal(sent.length, 1, 'the claim in the table held across the restart');

  const rows = await database.db.select().from(aiBudgetAlerts);
  assert.deepEqual(
    rows.map((row) => row.period),
    ['monthly:2026-09'],
  );

  // The control: October is a new period on the same database, and it mails.
  await bootAlerter({ sent, now: new Date('2026-10-01T00:05:00.000Z') }).check(LOW);
  assert.equal(sent.length, 2);
});

test('two alerters racing for one period mail once between them', async () => {
  const sent: SendAiBudgetAlertInput[] = [];
  const now = new Date('2026-09-30T10:00:00.000Z');
  await Promise.all([bootAlerter({ sent, now }).check(LOW), bootAlerter({ sent, now }).check(LOW)]);
  assert.equal(sent.length, 1);
});

test('a released claim lets the next boot send', async () => {
  const store = createDrizzleBudgetAlertStore(database.db);
  assert.deepEqual(await store.claimPeriod({ period: 'monthly:2026-09', now: new Date() }), { claimed: true });
  assert.deepEqual(await store.claimPeriod({ period: 'monthly:2026-09', now: new Date() }), { claimed: false });
  await store.releasePeriod({ period: 'monthly:2026-09' });
  assert.deepEqual(await store.claimPeriod({ period: 'monthly:2026-09', now: new Date() }), { claimed: true });
});
