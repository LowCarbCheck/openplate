/**
 * Drizzle implementation of `ActivityMailStore`, and the ONE SQL form of the
 * consent rule.
 *
 * THE DUE RULES TWICE, ON PURPOSE. `activity-mail/due-rules.ts` says them as
 * pure functions; this module says them as `WHERE` clauses, because the query
 * that finds due accounts and the UPDATE that claims one must both carry the
 * whole rule. The claim repeats the select's condition so that a row another
 * replica claimed in between is no longer matched, which is what makes the
 * claim safe without a lock. The sender checks every selected row against the
 * pure functions and throws on a disagreement, and the integration tier holds
 * both forms to the same cases.
 *
 * EVERY INSTANT IS BOUND THROUGH A COLUMN OPERATOR (`lte`, `gt`, `lt`), so
 * drizzle encodes it the way the column expects. A `Date` interpolated into a
 * bare `sql` template would be sent in the machine's zone against a
 * `timestamp without time zone` column.
 */
import { and, eq, exists, gt, isNotNull, isNull, lt, lte, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { AiLimitWindow } from '../accounts/ai-allowance.js';
import { daysBefore, DUE_WINDOW_DAYS } from '../activity-mail/due-rules.js';
import type {
  ActivityMailStats,
  ActivityMailStore,
  ClaimResult,
  DueFirstScanRow,
  DueQuietRow,
  FirstScanQuery,
  QuietQuery,
} from '../activity-mail/store.js';
import type { Database } from './client.js';
import { accounts, aiUsageDays } from './schema.js';

/**
 * Consent is ACTIVE: an opt-in exists and no opt-out came after it. The SQL
 * twin of `isActivityMailConsentActive` (`activity-mail/consent.ts`), and the
 * only place the rule is written for the database. Columns only, no bound
 * values, so it can sit in any statement on `accounts`.
 */
export const activeConsentSql: SQL = sql`(${accounts.activityMailOptInAt} IS NOT NULL AND (${accounts.activityMailOptOutAt} IS NULL OR ${accounts.activityMailOptOutAt} < ${accounts.activityMailOptInAt}))`;

/** The `ai_usage_days` rows of the account in the outer statement: any row is a photo or a request the proxy read. */
function aiUsageOfAccount(db: Database): SQL {
  return sql`${db
    .select({ one: sql`1` })
    .from(aiUsageDays)
    .where(eq(aiUsageDays.accountId, accounts.id))}`;
}

/**
 * The account's AI allowance is above zero at `now`: the SQL twin of
 * `hasUsableAiAllowance`. A standing instance default makes every account's
 * free grant positive, so the condition is then always true.
 */
function usableAllowanceSql(input: { now: Date; instanceDefaultFreeAiLimit: AiLimitWindow }): SQL | undefined {
  if (input.instanceDefaultFreeAiLimit.limit > 0) return undefined;
  return or(
    and(gt(accounts.allowanceExpiresAt, input.now), gt(accounts.dailyAiLimit, 0)),
    gt(accounts.freeDailyAiLimit, 0),
    and(
      isNull(accounts.allowanceExpiresAt),
      gt(accounts.dailyAiLimit, 0),
      isNotNull(accounts.trialScans),
      lt(accounts.trialScansUsed, accounts.trialScans),
      or(isNull(accounts.trialEndsAt), gt(accounts.trialEndsAt, input.now)),
    ),
  );
}

/** The first-scan rule as one condition. */
function firstScanDueSql(input: { db: Database } & FirstScanQuery): SQL | undefined {
  const opens = daysBefore({ now: input.now, days: input.days });
  const closes = daysBefore({ now: input.now, days: input.days + DUE_WINDOW_DAYS });
  return and(
    activeConsentSql,
    isNull(accounts.suspendedAt),
    isNull(accounts.firstScanMailSentAt),
    lte(accounts.createdAt, opens),
    gt(accounts.createdAt, closes),
    notExists(aiUsageOfAccount(input.db)),
    usableAllowanceSql(input),
  );
}

/** The quiet rule as one condition. */
function quietDueSql(input: QuietQuery): SQL | undefined {
  const opens = daysBefore({ now: input.now, days: input.days });
  const closes = daysBefore({ now: input.now, days: input.days + DUE_WINDOW_DAYS });
  return and(
    activeConsentSql,
    isNull(accounts.suspendedAt),
    isNotNull(accounts.lastSeenAt),
    lte(accounts.lastSeenAt, opens),
    gt(accounts.lastSeenAt, closes),
    or(isNull(accounts.quietMailSentAt), lt(accounts.quietMailSentAt, accounts.lastSeenAt)),
    or(isNull(accounts.firstScanMailSentAt), lt(accounts.firstScanMailSentAt, opens)),
  );
}

/** The recipient columns every due row carries. */
const recipientColumns = {
  accountId: accounts.id,
  email: accounts.email,
  language: accounts.mailLanguage,
  optInAt: accounts.activityMailOptInAt,
  optOutAt: accounts.activityMailOptOutAt,
  suspendedAt: accounts.suspendedAt,
  firstScanMailSentAt: accounts.firstScanMailSentAt,
};

/** `count(*) FILTER (WHERE ...)` as a JavaScript number. */
function countWhere(condition: SQL | undefined): SQL<number> {
  return sql<number>`count(*) FILTER (WHERE ${condition ?? sql`true`})::int`;
}

export function createDrizzleActivityMailStore(db: Database): ActivityMailStore {
  return {
    async findDueFirstScan(input: FirstScanQuery & { limit: number }): Promise<DueFirstScanRow[]> {
      const rows = await db
        .select({
          ...recipientColumns,
          createdAt: accounts.createdAt,
          dailyAiLimit: accounts.dailyAiLimit,
          aiLimitPeriod: accounts.aiLimitPeriod,
          freeDailyAiLimit: accounts.freeDailyAiLimit,
          allowanceExpiresAt: accounts.allowanceExpiresAt,
          trialScans: accounts.trialScans,
          trialScansUsed: accounts.trialScansUsed,
          trialEndsAt: accounts.trialEndsAt,
          // Read back rather than assumed, so the sender's check against the
          // pure rule sees what the row says and not what the WHERE meant.
          hasAiUsage: sql<boolean>`${exists(aiUsageOfAccount(db))}`,
        })
        .from(accounts)
        .where(firstScanDueSql({ db, ...input }))
        .orderBy(accounts.createdAt, accounts.id)
        .limit(input.limit);
      return rows.map((row): DueFirstScanRow => ({
        accountId: row.accountId,
        email: row.email,
        language: row.language,
        consent: { optInAt: row.optInAt, optOutAt: row.optOutAt },
        suspendedAt: row.suspendedAt,
        firstScanMailSentAt: row.firstScanMailSentAt,
        createdAt: row.createdAt,
        hasAiUsage: row.hasAiUsage,
        dailyAiLimit: row.dailyAiLimit,
        aiLimitPeriod: row.aiLimitPeriod,
        freeDailyAiLimit: row.freeDailyAiLimit,
        allowanceExpiresAt: row.allowanceExpiresAt,
        trialScans: row.trialScans,
        trialScansUsed: row.trialScansUsed,
        trialEndsAt: row.trialEndsAt,
      }));
    },

    async findDueQuiet(input: QuietQuery & { limit: number }): Promise<DueQuietRow[]> {
      const rows = await db
        .select({ ...recipientColumns, lastSeenAt: accounts.lastSeenAt, quietMailSentAt: accounts.quietMailSentAt })
        .from(accounts)
        .where(quietDueSql(input))
        .orderBy(accounts.lastSeenAt, accounts.id)
        .limit(input.limit);
      return rows.map((row): DueQuietRow => ({
        accountId: row.accountId,
        email: row.email,
        language: row.language,
        consent: { optInAt: row.optInAt, optOutAt: row.optOutAt },
        suspendedAt: row.suspendedAt,
        firstScanMailSentAt: row.firstScanMailSentAt,
        lastSeenAt: row.lastSeenAt,
        quietMailSentAt: row.quietMailSentAt,
      }));
    },

    async claimFirstScan(input: FirstScanQuery & { accountId: number }): Promise<ClaimResult> {
      const claimed = await db
        .update(accounts)
        .set({ firstScanMailSentAt: input.now })
        .where(and(eq(accounts.id, input.accountId), firstScanDueSql({ db, ...input })))
        .returning({ id: accounts.id });
      return claimed.length === 1 ? 'claimed' : 'taken';
    },

    async claimQuiet(input: QuietQuery & { accountId: number }): Promise<ClaimResult> {
      const claimed = await db
        .update(accounts)
        .set({ quietMailSentAt: input.now })
        .where(and(eq(accounts.id, input.accountId), quietDueSql(input)))
        .returning({ id: accounts.id });
      return claimed.length === 1 ? 'claimed' : 'taken';
    },

    async stats(): Promise<ActivityMailStats> {
      const [row] = await db
        .select({
          optedIn: countWhere(activeConsentSql),
          firstScanSent: countWhere(isNotNull(accounts.firstScanMailSentAt)),
          firstScanCameBack: countWhere(
            and(isNotNull(accounts.firstScanMailSentAt), gt(accounts.lastSeenAt, accounts.firstScanMailSentAt)),
          ),
          quietSent: countWhere(isNotNull(accounts.quietMailSentAt)),
          quietCameBack: countWhere(
            and(isNotNull(accounts.quietMailSentAt), gt(accounts.lastSeenAt, accounts.quietMailSentAt)),
          ),
        })
        .from(accounts);
      if (row === undefined) throw new Error('activity mail stats returned no row');
      return {
        optedIn: row.optedIn,
        firstScan: { sent: row.firstScanSent, cameBack: row.firstScanCameBack },
        quiet: { sent: row.quietSent, cameBack: row.quietCameBack },
      };
    },
  };
}
