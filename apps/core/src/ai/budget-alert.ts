/**
 * The low-budget mail to the operator, and the timer that reads the key when
 * nobody opens the console (2026-09-30).
 *
 * ── ONE MAIL PER RESET PERIOD, REMEMBERED IN THE DATABASE ───────────────────
 * When a key read shows less than `AI_BUDGET_ALERT_FRACTION` (default 0.2) of
 * the key's limit left, the operator gets one mail through the same operator
 * address the declaration alerts use (`MAIL_OPERATOR_EMAIL`). The claim on a
 * period is a row in `ai_budget_alerts` (`db/schema.ts`), taken with one
 * `INSERT ... ON CONFLICT DO NOTHING` before the send, so a restart, a second
 * replica or two overlapping reads send nothing more. A send that fails gives
 * the claim back, so the next read tries again rather than staying silent
 * for the rest of the month.
 *
 * ── THE PERIOD IS THE PROVIDER'S, IN UTC ────────────────────────────────────
 * OpenRouter resets a limit at 00:00 UTC, weekly on Monday, monthly on the
 * first. {@link budgetAlertPeriod} names the window a read falls in by that
 * rule. A key with no reset gets a period per limit value, so raising the
 * limit arms the alert again. If the provider's boundary were a day off, the
 * cost is one mail early or late, never a stream of them.
 *
 * ── NO MAIL CONFIGURED IS A LOG LINE ────────────────────────────────────────
 * An instance without mail cannot send, so it warns once per period in its
 * log and claims nothing. Configuring mail later then sends the alert on the
 * next read of the same period.
 */
import type { Logger } from '../logger.js';
import type { Mailer } from '../mail/mailer.js';
import { utcDayKey } from '../lib/utc-day.js';
import type { UpstreamBudgetRead, UpstreamBudgetSource, UpstreamKeyBudget } from './upstream-budget.js';
import { errorFields } from '../log-error.js';

/** Alert when less than this share of the limit is left, unless `AI_BUDGET_ALERT_FRACTION` says otherwise. */
export const DEFAULT_AI_BUDGET_ALERT_FRACTION = 0.2;

/** How often the timer reads the key when nobody opens the console. */
export const BUDGET_WATCH_INTERVAL_MS = 15 * 60 * 1000;

const MS_PER_DAY = 86_400_000;

/** Whether this budget is under the alert line. A key with no limit, or no remainder reported, never is. */
export function isBudgetLow(input: { budget: UpstreamKeyBudget; fraction: number }): boolean {
  const { limitUsd, remainingUsd } = input.budget;
  if (limitUsd === null || remainingUsd === null) return false;
  return remainingUsd < limitUsd * input.fraction;
}

/** The UTC Monday of the week `instant` falls in, as `YYYY-MM-DD`. */
function utcWeekStart(instant: Date): string {
  const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
  return utcDayKey(new Date(instant.getTime() - daysSinceMonday * MS_PER_DAY));
}

/** The name of the reset window a read made at `now` falls in. See the module header. */
export function budgetAlertPeriod(input: { budget: UpstreamKeyBudget; now: Date }): string {
  const { budget, now } = input;
  switch (budget.reset) {
    case 'daily':
      return `daily:${utcDayKey(now)}`;
    case 'weekly':
      return `weekly:${utcWeekStart(now)}`;
    case 'monthly':
      return `monthly:${utcDayKey(now).slice(0, 7)}`;
    case null:
      return `limit:${budget.limitUsd ?? 'none'}`;
  }
}

/** The claim on a period. `claimed: false` is a period somebody already alerted for. */
export interface BudgetAlertStore {
  claimPeriod(input: { period: string; now: Date }): Promise<{ claimed: boolean }>;
  /** Gives a claim back after a failed send, so the next read tries again. */
  releasePeriod(input: { period: string }): Promise<void>;
}

export interface BudgetAlerter {
  /** Sends the alert when this budget is low and its period has none yet. Never throws. */
  check(budget: UpstreamKeyBudget): Promise<void>;
}

export interface CreateBudgetAlerterOptions {
  store: BudgetAlertStore;
  mailer: Mailer;
  /** Whether mail is configured; the no-op mailer resolves, so it cannot say. */
  mailConfigured: boolean;
  /** `AI_BUDGET_ALERT_FRACTION`. */
  fraction: number;
  logger: Logger;
  now: () => Date;
}

export function createBudgetAlerter(options: CreateBudgetAlerterOptions): BudgetAlerter {
  const { store, mailer, logger } = options;
  /**
   * Periods this process already settled, so a read every minute does not ask
   * the database every minute. Memory only saves queries: the row is the rule.
   */
  const settled = new Set<string>();

  async function claimAndSend(input: { budget: UpstreamKeyBudget; period: string }): Promise<void> {
    const { claimed } = await store.claimPeriod({ period: input.period, now: options.now() });
    settled.add(input.period);
    if (!claimed) return;
    try {
      await mailer.sendAiBudgetAlert({
        limitUsd: input.budget.limitUsd ?? 0,
        remainingUsd: input.budget.remainingUsd ?? 0,
        reset: input.budget.reset,
        usageDailyUsd: input.budget.usageDailyUsd,
        usageMonthlyUsd: input.budget.usageMonthlyUsd,
        fraction: options.fraction,
      });
      logger.info('AI budget alert mailed', { period: input.period });
    } catch (cause) {
      settled.delete(input.period);
      await store.releasePeriod({ period: input.period });
      logger.warn('AI budget alert could not be mailed', { period: input.period, ...errorFields(cause) });
    }
  }

  return {
    async check(budget: UpstreamKeyBudget): Promise<void> {
      if (!isBudgetLow({ budget, fraction: options.fraction })) return;
      const period = budgetAlertPeriod({ budget, now: options.now() });
      if (settled.has(period)) return;
      if (!options.mailConfigured) {
        settled.add(period);
        logger.warn('AI budget is low and no mail is configured to say so', { period });
        return;
      }
      try {
        await claimAndSend({ budget, period });
      } catch (cause) {
        logger.warn('AI budget alert check failed', { period, ...errorFields(cause) });
      }
    },
  };
}

/** The key read with the alert behind it, and the timer that keeps reading. */
export interface BudgetWatch extends UpstreamBudgetSource {
  /** One timer tick: a read, then the alert check, both awaited. */
  tick(): Promise<void>;
  stop(): void;
}

/**
 * Wraps the cached source so every read, the console's included, feeds the
 * alert, and reads on a timer so the alert fires when nobody looks.
 *
 * A CONSOLE READ DOES NOT WAIT FOR THE MAIL. The check runs behind the answer:
 * a send can take fifteen seconds, and the operator asked for a number. The
 * timer's own tick awaits it, which is also what a test awaits.
 */
export function startBudgetWatch(input: {
  source: UpstreamBudgetSource;
  alerter: BudgetAlerter;
  logger: Logger;
  intervalMs?: number;
}): BudgetWatch {
  const { source, alerter, logger } = input;

  async function checkRead(read: UpstreamBudgetRead): Promise<void> {
    if (read.status !== 'ok') return;
    await alerter.check(read.budget);
  }

  async function tick(): Promise<void> {
    await checkRead(await source.read());
  }

  const timer = setInterval(() => {
    tick().catch((cause: unknown) => {
      logger.warn('AI budget watch tick failed', { ...errorFields(cause) });
    });
  }, input.intervalMs ?? BUDGET_WATCH_INTERVAL_MS);
  // Never the reason the process stays alive.
  timer.unref();

  return {
    async read(): Promise<UpstreamBudgetRead> {
      const read = await source.read();
      checkRead(read).catch((cause: unknown) => {
        logger.warn('AI budget alert check failed', { ...errorFields(cause) });
      });
      return read;
    },
    tick,
    stop(): void {
      clearInterval(timer);
    },
  };
}
