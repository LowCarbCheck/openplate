/**
 * The hourly activity reminder run, and the timer that starts it.
 *
 * ── ONE RUN ─────────────────────────────────────────────────────────────────
 * For each kind an administrator turned on: ONE query selects up to
 * {@link ACTIVITY_MAIL_BATCH} due accounts. For each one, the sender CLAIMS
 * first, a conditional UPDATE that stamps the kind's `*_mail_sent_at` only
 * while the row is still due, and only then sends. So two replicas, or a tick
 * that overlaps the last one, cannot mail the same person twice.
 *
 * A FAILED SEND IS NOT RETRIED, AND THE CLAIM STAYS. It is logged with the
 * account id and the kind, and the stamp means no later run sends that kind
 * for that spell again. A reminder that did not arrive is a lost nudge; the
 * same reminder arriving three times is a reason to turn them all off.
 *
 * THE COST OF ONE RUN is two indexed queries, one UPDATE per due account and
 * one mail API call per claimed account. Nothing repeats on an account
 * without progress: the stamp is written before the call, success or not.
 *
 * ── THE PURE RULES ARE THE CHECK ────────────────────────────────────────────
 * Every selected row is held against `due-rules.ts` before anything is
 * claimed. A row the SQL selected and the rule refuses is a drift between the
 * two forms of the rule, and the run THROWS rather than mail somebody the
 * rule excludes. The timer logs it as an error and tries again next hour.
 *
 * ── THE LOG ─────────────────────────────────────────────────────────────────
 * One summary line per run with three counts per kind, and one warning per
 * failed send with the account id. Never an address, a token or a link.
 */
import type { AiLimitWindow } from '../accounts/ai-allowance.js';
import { errorFields } from '../log-error.js';
import type { Logger } from '../logger.js';
import type { Mailer } from '../mail/mailer.js';
import type { InstanceLanguage } from '../protocol.js';
import { isFirstScanDue, isQuietDue, wholeDaysBetween, type ActivityMailKind } from './due-rules.js';
import type { ActivityMailSettings } from './settings.js';
import type { ActivityMailRecipient, ActivityMailStore, ClaimResult } from './store.js';
import { signUnsubscribeToken } from './unsubscribe-token.js';

/** The most accounts one kind mails in one run. A backlog drains over the next hours. */
export const ACTIVITY_MAIL_BATCH = 100;

/** How often the run starts. */
export const ACTIVITY_MAIL_INTERVAL_MS = 60 * 60 * 1000;

/** How long after boot the first run starts, so a deploy loop cannot keep the run from ever happening. */
export const ACTIVITY_MAIL_FIRST_RUN_DELAY_MS = 60 * 1000;

export interface ActivityMailSenderDeps {
  store: ActivityMailStore;
  mailer: Mailer;
  /** The process-local settings, read once per run. */
  settings: () => ActivityMailSettings;
  /** The key behind the unsubscribe token (`lib/server-secrets.ts`). */
  unsubscribeKey: string;
  /** `INSTANCE_LANGUAGE`, for an account that named no language. */
  defaultLanguage: InstanceLanguage;
  /** The instance's standing free default, which the first-scan allowance rule reads. */
  instanceDefaultFreeAiLimit: AiLimitWindow;
  /**
   * Whether this instance has an AI upstream at all. Without one, no photo can
   * be read, and the first-scan letter would promise what the app cannot do.
   */
  isAiAvailable: boolean;
  logger: Logger;
  now: () => Date;
}

/** One kind's counts for one run. */
export interface KindRunCounts {
  claimed: number;
  sent: number;
  failed: number;
}

export interface ActivityMailRunResult {
  firstScan: KindRunCounts;
  quiet: KindRunCounts;
}

const NOTHING: KindRunCounts = { claimed: 0, sent: 0, failed: 0 };

/** One due account, ready to claim and mail. */
interface DueMail {
  recipient: ActivityMailRecipient;
  /** The number of days the letter states. */
  days: number;
  claim: () => Promise<ClaimResult>;
}

/** Claims, then sends, each due mail in turn. A failed send is counted and logged, never retried. */
async function claimAndSend(input: {
  deps: ActivityMailSenderDeps;
  kind: ActivityMailKind;
  due: readonly DueMail[];
}): Promise<KindRunCounts> {
  const { deps, kind } = input;
  const counts = { claimed: 0, sent: 0, failed: 0 };
  for (const mail of input.due) {
    if ((await mail.claim()) === 'taken') continue;
    counts.claimed += 1;
    try {
      await deps.mailer.sendActivityReminder({
        email: mail.recipient.email,
        kind,
        days: mail.days,
        language: mail.recipient.language ?? deps.defaultLanguage,
        unsubscribeToken: signUnsubscribeToken({ key: deps.unsubscribeKey, accountId: mail.recipient.accountId }),
        isTest: false,
      });
      counts.sent += 1;
    } catch (cause) {
      counts.failed += 1;
      deps.logger.warn('Activity reminder send failed, not retried', {
        accountId: mail.recipient.accountId,
        kind,
        ...errorFields(cause),
      });
    }
  }
  return counts;
}

async function runFirstScan(deps: ActivityMailSenderDeps, now: Date): Promise<KindRunCounts> {
  const kind = deps.settings().firstScan;
  if (!kind.enabled || !deps.isAiAvailable) return NOTHING;
  const query = { now, days: kind.days, instanceDefaultFreeAiLimit: deps.instanceDefaultFreeAiLimit };
  const rows = await deps.store.findDueFirstScan({ ...query, limit: ACTIVITY_MAIL_BATCH });
  const drifted = rows.filter(
    (row) =>
      !isFirstScanDue({
        account: row,
        context: { now, days: kind.days },
        instanceDefaultFreeAiLimit: deps.instanceDefaultFreeAiLimit,
      }),
  );
  if (drifted.length > 0) {
    throw new Error(`first-scan query selected ${drifted.length} accounts the due rule refuses`);
  }
  return claimAndSend({
    deps,
    kind: 'first-scan',
    due: rows.map((row) => ({
      recipient: row,
      days: wholeDaysBetween({ from: row.createdAt, to: now }),
      claim: () => deps.store.claimFirstScan({ ...query, accountId: row.accountId }),
    })),
  });
}

async function runQuiet(deps: ActivityMailSenderDeps, now: Date): Promise<KindRunCounts> {
  const kind = deps.settings().quiet;
  if (!kind.enabled) return NOTHING;
  const query = { now, days: kind.days };
  const rows = await deps.store.findDueQuiet({ ...query, limit: ACTIVITY_MAIL_BATCH });
  const drifted = rows.filter((row) => !isQuietDue({ account: row, context: query }));
  if (drifted.length > 0) {
    throw new Error(`quiet query selected ${drifted.length} accounts the due rule refuses`);
  }
  return claimAndSend({
    deps,
    kind: 'quiet',
    due: rows.map((row) => {
      // The quiet rule refuses a row with no last-seen instant, and the check
      // above ran it, so this is a narrowing rather than a decision.
      if (row.lastSeenAt === null) throw new Error('a due quiet row has no last-seen instant');
      return {
        recipient: row,
        days: wholeDaysBetween({ from: row.lastSeenAt, to: now }),
        claim: () => deps.store.claimQuiet({ ...query, accountId: row.accountId }),
      };
    }),
  });
}

/** One run over both kinds, at one instant. Throws on a store failure or a rule drift. */
export async function runActivityMailOnce(deps: ActivityMailSenderDeps): Promise<ActivityMailRunResult> {
  const now = deps.now();
  const firstScan = await runFirstScan(deps, now);
  const quiet = await runQuiet(deps, now);
  deps.logger.info('Activity reminder run finished', {
    firstScanClaimed: firstScan.claimed,
    firstScanSent: firstScan.sent,
    firstScanFailed: firstScan.failed,
    quietClaimed: quiet.claimed,
    quietSent: quiet.sent,
    quietFailed: quiet.failed,
  });
  return { firstScan, quiet };
}

export interface ActivityMailSender {
  stop(): void;
}

/**
 * The timer: a first run a minute after boot, then one per hour. A tick that
 * finds the last run still going skips itself; the claims would make an
 * overlap safe, and skipping makes it quiet.
 */
export function startActivityMailSender(deps: ActivityMailSenderDeps): ActivityMailSender {
  let isRunning = false;
  function tick(): void {
    if (isRunning) return;
    isRunning = true;
    void runActivityMailOnce(deps)
      .catch((cause: unknown) => {
        deps.logger.error('Activity reminder run failed', { ...errorFields(cause) });
      })
      .finally(() => {
        isRunning = false;
      });
  }
  const first = setTimeout(tick, ACTIVITY_MAIL_FIRST_RUN_DELAY_MS);
  const interval = setInterval(tick, ACTIVITY_MAIL_INTERVAL_MS);
  // Never the reason the process stays alive, exactly like the sweeps.
  first.unref();
  interval.unref();
  return {
    stop(): void {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
}
