/**
 * The low-budget alert (2026-09-30): when it fires, how often, and what the
 * letter says.
 *
 * ── ONCE PER PERIOD, AND NOT AGAIN AFTER A RESTART ───────────────────────
 *
 * A restart is a NEW alerter over the SAME store, which is what `main.ts`
 * builds on every boot. The in-memory store here holds claims the way the
 * table does (one per period, first writer wins); the integration file
 * `tests/integration/ai-budget.test.ts` runs the same restart against Postgres.
 *
 * ── THE CONTROLS ─────────────────────────────────────────────────────────
 *
 * Every "no mail" assertion sits beside a case that mails: a budget above the
 * line, a new period, and a store that forgot its claims (the defect a
 * process-memory flag would be). An alerter that never sent would fail the
 * first; one that always sent would fail the rest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetAlertPeriod,
  createBudgetAlerter,
  isBudgetLow,
  startBudgetWatch,
  type BudgetAlertStore,
} from '../../src/ai/budget-alert.js';
import type { UpstreamBudgetRead, UpstreamKeyBudget } from '../../src/ai/upstream-budget.js';
import { buildAiBudgetAlertMessage } from '../../src/mail/ai-budget-message.js';
import { createNoopMailer, type Mailer, type SendAiBudgetAlertInput } from '../../src/mail/mailer.js';
import { createCapturingLogger } from './admin-harness.js';

const LOW: UpstreamKeyBudget = {
  limitUsd: 5,
  remainingUsd: 0.8,
  reset: 'monthly',
  usageDailyUsd: 0.12,
  usageWeeklyUsd: 0.9,
  usageMonthlyUsd: 4.2,
};

const HEALTHY: UpstreamKeyBudget = { ...LOW, remainingUsd: 3.94, usageMonthlyUsd: 1.06 };

const SEPT_30 = new Date('2026-09-30T10:00:00.000Z');

/** One claim per period, first writer wins: the table's rule, in memory. */
class MemoryClaimStore implements BudgetAlertStore {
  readonly periods = new Set<string>();
  async claimPeriod(input: { period: string }): Promise<{ claimed: boolean }> {
    if (this.periods.has(input.period)) return { claimed: false };
    this.periods.add(input.period);
    return { claimed: true };
  }
  async releasePeriod(input: { period: string }): Promise<void> {
    this.periods.delete(input.period);
  }
}

/** The no-op mailer, recording the one letter this file is about. */
class BudgetMailer {
  readonly sent: SendAiBudgetAlertInput[] = [];
  shouldFail = false;
  readonly mailer: Mailer = {
    ...createNoopMailer(),
    sendAiBudgetAlert: async (input: SendAiBudgetAlertInput): Promise<void> => {
      if (this.shouldFail) throw new Error('mail API responded 503');
      this.sent.push(input);
    },
  };
}

function alerterOver(input: {
  store: BudgetAlertStore;
  mail: BudgetMailer;
  now?: () => Date;
  mailConfigured?: boolean;
}): ReturnType<typeof createBudgetAlerter> {
  return createBudgetAlerter({
    store: input.store,
    mailer: input.mail.mailer,
    mailConfigured: input.mailConfigured ?? true,
    fraction: 0.2,
    logger: createCapturingLogger().logger,
    now: input.now ?? (() => SEPT_30),
  });
}

test('the line: below 20 percent of the limit is low, at it or above is not, no limit never is', () => {
  assert.equal(isBudgetLow({ budget: LOW, fraction: 0.2 }), true);
  assert.equal(isBudgetLow({ budget: { ...LOW, remainingUsd: 1 }, fraction: 0.2 }), false);
  assert.equal(isBudgetLow({ budget: HEALTHY, fraction: 0.2 }), false);
  assert.equal(isBudgetLow({ budget: { ...LOW, limitUsd: null, remainingUsd: null }, fraction: 0.2 }), false);
});

test('the period follows the reset: a UTC day, the Monday of the week, the month, or the limit', () => {
  // 2026-09-30 is a Wednesday; its week starts on Monday 2026-09-28.
  assert.equal(budgetAlertPeriod({ budget: { ...LOW, reset: 'daily' }, now: SEPT_30 }), 'daily:2026-09-30');
  assert.equal(budgetAlertPeriod({ budget: { ...LOW, reset: 'weekly' }, now: SEPT_30 }), 'weekly:2026-09-28');
  assert.equal(
    budgetAlertPeriod({ budget: { ...LOW, reset: 'weekly' }, now: new Date('2026-09-28T00:00:00.000Z') }),
    'weekly:2026-09-28',
  );
  assert.equal(
    budgetAlertPeriod({ budget: { ...LOW, reset: 'weekly' }, now: new Date('2026-10-04T23:59:59.000Z') }),
    'weekly:2026-09-28',
  );
  assert.equal(budgetAlertPeriod({ budget: LOW, now: SEPT_30 }), 'monthly:2026-09');
  assert.equal(budgetAlertPeriod({ budget: { ...LOW, reset: null }, now: SEPT_30 }), 'limit:5');
});

test('a low budget mails once, and a second read in the same period mails nothing', async () => {
  const store = new MemoryClaimStore();
  const mail = new BudgetMailer();
  const alerter = alerterOver({ store, mail });

  await alerter.check(LOW);
  await alerter.check(LOW);
  assert.equal(mail.sent.length, 1);
  assert.deepEqual(mail.sent[0], {
    limitUsd: 5,
    remainingUsd: 0.8,
    reset: 'monthly',
    usageDailyUsd: 0.12,
    usageMonthlyUsd: 4.2,
    fraction: 0.2,
  });
  assert.deepEqual([...store.periods], ['monthly:2026-09']);
});

test('a healthy budget mails nothing and claims nothing', async () => {
  const store = new MemoryClaimStore();
  const mail = new BudgetMailer();
  await alerterOver({ store, mail }).check(HEALTHY);
  assert.equal(mail.sent.length, 0);
  assert.equal(store.periods.size, 0);
});

test('a restart does not mail again in the same period, and the next period mails again', async () => {
  const store = new MemoryClaimStore();
  const mail = new BudgetMailer();
  await alerterOver({ store, mail }).check(LOW);

  // The process restarts: a new alerter, the same store.
  await alerterOver({ store, mail }).check(LOW);
  assert.equal(mail.sent.length, 1, 'the claim survived the restart');

  // The control: a store that forgot its claim is what a memory flag would be.
  await alerterOver({ store: new MemoryClaimStore(), mail }).check(LOW);
  assert.equal(mail.sent.length, 2, 'without the stored claim, the restart would mail again');

  // October is a new period.
  await alerterOver({ store, mail, now: () => new Date('2026-10-01T00:05:00.000Z') }).check(LOW);
  assert.equal(mail.sent.length, 3);
});

test('without mail configured, nothing is claimed, so configuring mail later still sends', async () => {
  const store = new MemoryClaimStore();
  const mail = new BudgetMailer();
  await alerterOver({ store, mail, mailConfigured: false }).check(LOW);
  assert.equal(mail.sent.length, 0);
  assert.equal(store.periods.size, 0);

  await alerterOver({ store, mail }).check(LOW);
  assert.equal(mail.sent.length, 1);
});

test('a failed send gives the claim back, so the next read tries again', async () => {
  const store = new MemoryClaimStore();
  const mail = new BudgetMailer();
  const alerter = alerterOver({ store, mail });

  mail.shouldFail = true;
  await alerter.check(LOW);
  assert.equal(store.periods.size, 0, 'the claim is given back');

  mail.shouldFail = false;
  await alerter.check(LOW);
  assert.equal(mail.sent.length, 1);
});

test('the watch tick reads the key and mails; a console read mails too, without waiting for it', async () => {
  const reads: UpstreamBudgetRead[] = [{ status: 'ok', budget: LOW, checkedAt: SEPT_30 }];
  const store = new MemoryClaimStore();
  const mail = new BudgetMailer();
  const watch = startBudgetWatch({
    source: { read: async () => reads[0] ?? { status: 'unavailable', checkedAt: SEPT_30 } },
    alerter: alerterOver({ store, mail }),
    logger: createCapturingLogger().logger,
    intervalMs: 3_600_000,
  });
  try {
    await watch.tick();
    assert.equal(mail.sent.length, 1);

    // An unavailable read never alerts.
    reads[0] = { status: 'unavailable', checkedAt: SEPT_30 };
    await watch.tick();
    assert.equal(mail.sent.length, 1);
  } finally {
    watch.stop();
  }

  const consoleStore = new MemoryClaimStore();
  const consoleMail = new BudgetMailer();
  const consoleWatch = startBudgetWatch({
    source: { read: async () => ({ status: 'ok', budget: LOW, checkedAt: SEPT_30 }) },
    alerter: alerterOver({ store: consoleStore, mail: consoleMail }),
    logger: createCapturingLogger().logger,
    intervalMs: 3_600_000,
  });
  try {
    const read = await consoleWatch.read();
    assert.equal(read.status, 'ok');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(consoleMail.sent.length, 1);
  } finally {
    consoleWatch.stop();
  }
});

test('the letter carries the numbers and no dash', () => {
  const message = buildAiBudgetAlertMessage({
    limitUsd: 5,
    remainingUsd: 0.8,
    reset: 'monthly',
    usageDailyUsd: 0.12,
    usageMonthlyUsd: 4.2,
    fraction: 0.2,
  });
  assert.equal(message.subject, 'AI budget low: $0.80 of $5.00 left');
  for (const figure of ['$0.80', '$5.00', '$0.12', '$4.20', '20 percent']) {
    assert.ok(message.text.includes(figure), figure);
    assert.ok(message.html.includes(figure), figure);
  }
  assert.doesNotMatch(`${message.subject}${message.text}`, /[–—]/);
  const once = buildAiBudgetAlertMessage({
    limitUsd: 5,
    remainingUsd: 0.8,
    reset: null,
    usageDailyUsd: 0,
    usageMonthlyUsd: 4.2,
    fraction: 0.125,
  });
  assert.ok(once.text.includes('12.5 percent'));
  assert.notEqual(once.text, message.text, 'a key with no reset reads differently');
});
