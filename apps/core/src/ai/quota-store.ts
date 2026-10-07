/**
 * The AI spend control: a per-account, per-UTC-day counter that is RESERVED
 * before the upstream call and released only when the provider cannot have
 * billed us.
 *
 * WHY RESERVE-BEFORE RATHER THAN COUNT-AFTER. Counting after the fact has a
 * window in which N parallel requests all read the old count and all go
 * through: the check and the increment are two statements, and a client that
 * retries on error is precisely the client that will fire them together. The
 * reservation is ONE statement whose `WHERE` is the limit, so the database
 * decides, once, per request.
 *
 * ```sql
 * INSERT INTO ai_usage_days (account_id, day, count) VALUES ($1, $2, $weight)
 * ON CONFLICT (account_id, day) DO UPDATE SET count = ai_usage_days.count + $weight
 * WHERE ai_usage_days.count + $weight <= $3
 * RETURNING count
 * ```
 *
 * Zero rows back means the limit would be passed. The `WHERE` on the
 * `DO UPDATE` is the whole guarantee: two concurrent requests near the limit
 * serialise on the row lock, and only the ones that still fit get a row back.
 *
 * A REQUEST WEIGHS ONE UNIT OR MORE (2026-09-30), by the input it carries
 * (`ai/chat-input-bounds.ts`): a plate scan is one, a body near the text bound
 * is two. Every reserve and release here takes the weight, and a release gives
 * back exactly what its reserve took.
 *
 * THE INSERT BRANCH IS NOT GUARDED BY THE STATEMENT, so it is guarded in code:
 * it only fires when no row exists for the day, which means a count of zero,
 * and a weight above the limit is refused before the statement runs. A caller
 * with `limit = 0` is refused by the route before it ever reaches here
 * (`403 ai-not-allowed`), and the weight check refuses it here too.
 *
 * THE RELEASE IS FLOORED AT ZERO. `GREATEST(count - weight, 0)` and
 * `WHERE count > 0` stop a double release (a retry, a future bug) from driving
 * the counter negative, which would hand out free requests rather than merely
 * miscounting.
 *
 * A WEEKLY LIMIT (2026-10-07) IS THE SAME COUNTER, SUMMED. The rows stay one
 * per account per UTC day, so the admin activity strip, the retention sweep
 * and the daily path are untouched. {@link AiQuotaStore.reserveWindow} sums
 * the days of the week up to today and adds the weight to today's row, under
 * a per-account advisory lock in one transaction: the check and the write are
 * two statements there, and the lock is what makes them one decision, the
 * way the `WHERE` makes the daily upsert one. A daily account never takes
 * that lock: it keeps the one-statement reserve above, byte for byte.
 *
 * THE SAME STORE OWNS THE INSTANCE-WIDE CEILING (M212 spec 02), in its own
 * section at the bottom of this file. It is the same one-statement upsert
 * against a table of one row per day, and the doc block down there says why
 * the obvious alternative, a `SUM` over `ai_usage_days`, is a statistic and
 * not a limit. It is here rather than in a second store because both halves
 * write counters this module is the only writer of.
 */
import { and, eq, gt, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.js';
import {
  accounts,
  aiFreeNetworkDays,
  aiInstanceDays,
  aiTrialIntakes,
  aiTrialNetworkDays,
  aiUsageDays,
} from '../db/schema.js';
import { INTAKE_REUSE_WINDOW_MS } from '../accounts/scan-trial.js';

/**
 * The advisory-lock namespace of the window reserve. Postgres advisory locks
 * share ONE space per database, so the first argument keeps an account id
 * here from colliding with an account id another feature locks on. The value
 * is arbitrary and only has to stay put and differ from the others
 * (`feedback-store.ts`, `push-store.ts`, `trial-mailbox.ts`).
 */
const AI_WINDOW_LOCK_NAMESPACE = 200_710;

/**
 * The outcome of a reservation.
 *
 * `used` is the count AFTER a successful reserve, so it is what
 * `X-Quota-Used` reports; on a refusal it is the limit, because that is what
 * the caller has spent.
 */
export type ReserveResult = { ok: true; used: number; limit: number } | { ok: false; used: number; limit: number };

/**
 * Refuses a weight that is not a whole number of units. Every weight comes
 * from `REQUEST_WEIGHT`, which is one; anything else is a wiring
 * bug, and a zero or a fraction reaching an upsert would reserve nothing.
 */
function assertWeight(weight: number): void {
  if (!Number.isInteger(weight) || weight < 1)
    throw new Error(`a reservation weight must be a whole unit, got ${weight}`);
}

export interface AiQuotaStore extends AiInstanceCeilingStore, AiTrialScanStore, AiFreeBoundStore {
  /**
   * Takes `weight` units of the account's allowance for the given UTC day,
   * atomically, or none when they do not all fit under `limit`.
   *
   * Callers MUST have refused a `limit` of 0 before reaching here, see the
   * module header on the insert branch.
   */
  reserve(input: { accountId: number; day: string; limit: number; weight: number }): Promise<ReserveResult>;
  /**
   * Takes `weight` units of a limit that counts over several days (a week,
   * 2026-10-07): the days from `fromDay` to `day`, both included, are summed,
   * and the weight is added to `day`'s row only when the sum plus the weight
   * fits under `limit`. `used` is that sum after the reserve, or the limit on
   * a refusal, exactly as {@link reserve} reports it.
   *
   * ONE DECISION PER ACCOUNT AT A TIME: a transaction-scoped advisory lock on
   * the account is held from the sum to the write, so two parallel requests
   * near the limit cannot both read the old sum. The give-back is the
   * ordinary {@link release} on `day`, which lowers the sum by the same units.
   */
  reserveWindow(input: {
    accountId: number;
    fromDay: string;
    day: string;
    limit: number;
    weight: number;
  }): Promise<ReserveResult>;
  /** Gives `weight` units back. Floored at zero, and never throws out of the proxy's hands (see its `releaseQuietly`). */
  release(input: { accountId: number; day: string; weight: number }): Promise<void>;
  /** How many requests every account together spent on the given day. An operator statistic, never a limit. */
  countRequestsOn(day: string): Promise<number>;
  /**
   * Deletes every counter row before the given UTC day, and answers how many
   * went. The retention half of this table, driven by
   * `ai/usage-retention.ts`.
   *
   * IT LIVES ON THE STORE THAT WRITES THE TABLE, on purpose. The reserve above
   * is the only thing that creates these rows, and putting the delete anywhere
   * else would leave two modules holding one table between them. It is NOT on
   * the admin metadata store, which is a read contract by construction.
   */
  purgeUsageBefore(input: { day: string }): Promise<number>;
}

export function createDrizzleAiQuotaStore(db: Database): AiQuotaStore {
  return {
    // The instance-wide half, from the bottom of this file. Spread in rather
    // than re-declared, so there is exactly one implementation of each and one
    // store the proxy has to be handed.
    ...createDrizzleAiInstanceCeiling(db),
    // The scan trial's half (M253), from the bottom of this file, for the same
    // reason: one implementation of each, one store handed to the proxy.
    ...createDrizzleAiTrialScans(db),
    // The opt-in free bounds (2026-10-07), the same way.
    ...createDrizzleAiFreeBound(db),

    async reserve(input: { accountId: number; day: string; limit: number; weight: number }): Promise<ReserveResult> {
      assertWeight(input.weight);
      // THE INSERT BRANCH'S GUARD, see the module header: a weight that can
      // never fit is refused before a first row of the day could take it.
      if (input.weight > input.limit) return { ok: false, used: input.limit, limit: input.limit };
      const rows = await db
        .insert(aiUsageDays)
        .values({ accountId: input.accountId, day: input.day, count: input.weight })
        .onConflictDoUpdate({
          target: [aiUsageDays.accountId, aiUsageDays.day],
          set: { count: sql`${aiUsageDays.count} + ${input.weight}` },
          // THE LIMIT IS THE PREDICATE, which is what makes this one statement
          // rather than a read and a write with a race between them.
          where: sql`${aiUsageDays.count} + ${input.weight} <= ${input.limit}`,
        })
        .returning({ count: aiUsageDays.count });

      const row = rows[0];
      // Zero rows means the `WHERE` was false: the weight does not fit, and
      // the refusal reports the limit as spent, as it always has.
      if (!row) return { ok: false, used: input.limit, limit: input.limit };
      return { ok: true, used: row.count, limit: input.limit };
    },

    async reserveWindow(input: {
      accountId: number;
      fromDay: string;
      day: string;
      limit: number;
      weight: number;
    }): Promise<ReserveResult> {
      assertWeight(input.weight);
      // The guard the daily reserve has, for the same reason: a weight that
      // can never fit is refused before anything is locked or written.
      if (input.weight > input.limit) return { ok: false, used: input.limit, limit: input.limit };
      return await db.transaction(async (tx): Promise<ReserveResult> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${AI_WINDOW_LOCK_NAMESPACE}, ${input.accountId})`);
        const sums = await tx
          .select({ total: sql<number>`coalesce(sum(${aiUsageDays.count}), 0)::int` })
          .from(aiUsageDays)
          .where(
            and(
              eq(aiUsageDays.accountId, input.accountId),
              gte(aiUsageDays.day, input.fromDay),
              lte(aiUsageDays.day, input.day),
            ),
          );
        const spent = sums[0]?.total ?? 0;
        if (spent + input.weight > input.limit) return { ok: false, used: input.limit, limit: input.limit };
        await tx
          .insert(aiUsageDays)
          .values({ accountId: input.accountId, day: input.day, count: input.weight })
          .onConflictDoUpdate({
            target: [aiUsageDays.accountId, aiUsageDays.day],
            set: { count: sql`${aiUsageDays.count} + ${input.weight}` },
          });
        return { ok: true, used: spent + input.weight, limit: input.limit };
      });
    },

    async release(input: { accountId: number; day: string; weight: number }): Promise<void> {
      assertWeight(input.weight);
      await db
        .update(aiUsageDays)
        .set({ count: sql`greatest(${aiUsageDays.count} - ${input.weight}, 0)` })
        // Floored at zero: a double release must miscount upward, never
        // downward, because a negative counter is free requests.
        .where(
          and(eq(aiUsageDays.accountId, input.accountId), eq(aiUsageDays.day, input.day), gt(aiUsageDays.count, 0)),
        );
    },

    async countRequestsOn(day: string): Promise<number> {
      const rows = await db
        .select({ total: sql<number>`coalesce(sum(${aiUsageDays.count}), 0)::int` })
        .from(aiUsageDays)
        .where(eq(aiUsageDays.day, day));
      return rows[0]?.total ?? 0;
    },

    async purgeUsageBefore(input: { day: string }): Promise<number> {
      // `returning` a column rather than trusting a driver row count, so the
      // number the sweep logs is rows this statement actually removed. The
      // predicate is a day and not a cursor, which is what makes a second run
      // in the same hour a no-op rather than a partial repeat.
      const deleted = await db
        .delete(aiUsageDays)
        .where(lt(aiUsageDays.day, input.day))
        .returning({ accountId: aiUsageDays.accountId });
      return deleted.length;
    },
  };
}

// =============================================================================
// The instance-wide ceiling (M212 spec 02)
// =============================================================================

/**
 * The instance-wide half of `createDrizzleAiQuotaStore`, which spreads this in.
 *
 * WHY THERE IS A SECOND COUNTER AT ALL. Every other guard in this service is
 * per account: the minute limiter and the daily quota above both key on the
 * caller. Ten accounts at 200 requests a day is 2000 requests a day, and until
 * M212 nothing in the process said no. Invitations multiply accounts; they do
 * not multiply the bound, because there was no bound.
 *
 * ONE STATEMENT WHOSE `WHERE` IS THE CEILING, for exactly the reason `reserve`
 * above is one: a read followed by a write has a window in which N parallel
 * requests all see the old total, and this is the counter that stands between
 * five invitations per member and the operator's provider bill.
 *
 * ```sql
 * INSERT INTO ai_instance_days (day, count) VALUES ($1, $weight)
 * ON CONFLICT (day) DO UPDATE SET count = ai_instance_days.count + $weight
 * WHERE ai_instance_days.count + $weight <= $2
 * RETURNING count
 * ```
 *
 * A `SUM` OVER `ai_usage_days` WAS REFUSED, and it is the arrangement a reader
 * reaches for first, because that table already holds every number this one
 * does. Two independent reasons, either of them fatal:
 *
 *  1. THE SUM IS NOT MONOTONIC. `ai_usage_days.account_id` cascades on delete
 *     (`db/schema.ts`), so erasing an account removes the days it spent and
 *     today's total FALLS. A ceiling read off it would refund the instance's
 *     spend to whoever deletes their account, which is a free request tap
 *     rather than a miscount.
 *  2. THE SUM SCANS. That table is keyed `(account_id, day)` with no index on
 *     `day` alone, and this number is wanted on every single request.
 *
 * `ai_instance_days` references nothing, so no cascade can reach it and a
 * day's total only ever goes up.
 *
 * THE INSERT BRANCH IS GUARDED IN CODE, exactly as `reserve`'s is, and for the
 * same reason: it fires only when the day has no row, which means a total of
 * zero, so a weight above the ceiling is refused before the statement runs.
 * `config.ts` still refuses `AI_INSTANCE_DAILY_LIMIT=0` at boot rather than
 * reading it as "off".
 *
 * THE RELEASE IS FLOORED AT ZERO for the reason the per-account one is: a
 * double release must miscount upward, because a negative counter would be
 * free requests for the whole instance.
 */
export function createDrizzleAiInstanceCeiling(db: Database): AiInstanceCeilingStore {
  return {
    async reserveInstance(input: { day: string; limit: number; weight: number }): Promise<ReserveResult> {
      assertWeight(input.weight);
      if (input.weight > input.limit) return { ok: false, used: input.limit, limit: input.limit };
      const rows = await db
        .insert(aiInstanceDays)
        .values({ day: input.day, count: input.weight })
        .onConflictDoUpdate({
          target: aiInstanceDays.day,
          set: { count: sql`${aiInstanceDays.count} + ${input.weight}` },
          // THE CEILING IS THE PREDICATE, which is what makes this one
          // statement rather than a read and a write with a race between them.
          where: sql`${aiInstanceDays.count} + ${input.weight} <= ${input.limit}`,
        })
        .returning({ count: aiInstanceDays.count });

      const row = rows[0];
      // Zero rows means the `WHERE` was false: the instance is at its ceiling,
      // so it has spent exactly `limit` today.
      if (!row) return { ok: false, used: input.limit, limit: input.limit };
      return { ok: true, used: row.count, limit: input.limit };
    },

    async releaseInstance(input: { day: string; weight: number }): Promise<void> {
      assertWeight(input.weight);
      await db
        .update(aiInstanceDays)
        .set({ count: sql`greatest(${aiInstanceDays.count} - ${input.weight}, 0)` })
        .where(and(eq(aiInstanceDays.day, input.day), gt(aiInstanceDays.count, 0)));
    },

    async addInstanceCost(input: { day: string; costMicroUsd: number }): Promise<void> {
      if (!Number.isInteger(input.costMicroUsd) || input.costMicroUsd < 0) {
        throw new Error(`a cost is a whole number of micro dollars, got ${input.costMicroUsd}`);
      }
      await db
        .insert(aiInstanceDays)
        .values({ day: input.day, costMicroUsd: input.costMicroUsd })
        .onConflictDoUpdate({
          target: aiInstanceDays.day,
          set: { costMicroUsd: sql`${aiInstanceDays.costMicroUsd} + ${input.costMicroUsd}` },
        });
    },
  };
}

/**
 * One UTC day of the two instance counters, as `GET /v1/admin/ai/budget`
 * reports them: `paid` is `ai_instance_days.count`, the units taken against
 * `AI_INSTANCE_DAILY_LIMIT`, and `trial` is `trial_count`, the scan-trial
 * accounts' units. Both are zero for a day with no row.
 */
export interface AiDayCapacityUsage {
  paid: number;
  trial: number;
}

/**
 * A READ of the instance counters, apart from the store that writes them. The
 * console asks for a day; nothing here can take or give back a unit.
 */
export interface AiCapacityReader {
  readDay(input: { day: string }): Promise<AiDayCapacityUsage>;
}

export function createDrizzleAiCapacityReader(db: Database): AiCapacityReader {
  return {
    async readDay(input: { day: string }): Promise<AiDayCapacityUsage> {
      const [row] = await db
        .select({ paid: aiInstanceDays.count, trial: aiInstanceDays.trialCount })
        .from(aiInstanceDays)
        .where(eq(aiInstanceDays.day, input.day));
      return { paid: row?.paid ?? 0, trial: row?.trial ?? 0 };
    },
  };
}

/**
 * The operator's TOTAL daily bound, which every account shares. `AiQuotaStore`
 * extends this, so the proxy is handed one store and one factory builds both
 * halves.
 *
 * IT IS DECLARED BELOW ITS IMPLEMENTATION because the argument this feature is
 * made of is an argument about a single SQL statement, and it belongs beside
 * that statement rather than one screen away from it. Read
 * `createDrizzleAiInstanceCeiling` above first.
 */
export interface AiInstanceCeilingStore {
  /**
   * Takes `weight` units of THE WHOLE INSTANCE's daily ceiling for the given
   * UTC day, atomically, or none. Called only on an instance that configured one
   * (`AI_INSTANCE_DAILY_LIMIT`); unset means no ceiling and no statement.
   *
   * A refusal is the ceiling being reached, never an error: it is the same
   * `{ ok: false }` shape `reserve` uses, and the proxy answers it with a
   * `503` rather than a `429` because it is not the caller's fault and not the
   * caller's allowance.
   */
  reserveInstance(input: { day: string; limit: number; weight: number }): Promise<ReserveResult>;
  /**
   * Gives `weight` instance-wide units back. Floored at zero, and never throws out of
   * the proxy's hands, see its `releaseQuietly`.
   *
   * IT IS NOT A REFUND MECHANISM FOR A DELETED ACCOUNT. The only callers are
   * the proxy's own release paths, where the request the unit was taken for
   * demonstrably cost the operator nothing (see the spend/release table in
   * `ai/proxy.ts`).
   */
  releaseInstance(input: { day: string; weight: number }): Promise<void>;
  /**
   * Adds what the provider charged for one answer, in micro dollars, to the
   * instance's total for the UTC day. One statement, so two answers finishing
   * together both land. It creates the day's row when there is none, because
   * an instance with no ceiling has no row until now, and it touches neither
   * counter. A sum, never a log: nothing says whose request it was.
   *
   * THE PROXY CALLS IT AFTER THE ANSWER HAS BEEN RELAYED, and never lets a
   * failure here fail the request.
   */
  addInstanceCost(input: { day: string; costMicroUsd: number }): Promise<void>;
}

// =============================================================================
// The scan trial (M253)
// =============================================================================

/**
 * A claimed or reused scan: the intake it rides on, which claim on that intake
 * it is (M256/02), and the scans left after this request. `ok: false` is
 * either the last scan already used (`spent`) or an earlier request on the
 * same intake still in flight (`in-flight`, 2026-09-30).
 */
export type TrialClaim =
  { ok: true; intakeId: string; claim: number; left: number } | { ok: false; reason: 'spent' | 'in-flight' };

/**
 * Thrown inside the claim transaction to roll it back when no scan is left,
 * and caught right outside it. A `return` would COMMIT the placeholder intake
 * row, which is the half-write this signal exists to prevent. Never thrown out
 * of this module.
 */
class TrialScansSpentSignal extends Error {
  constructor() {
    super('trial scans spent');
    this.name = 'TrialScansSpentSignal';
  }
}

/**
 * The scan counter, written in the same discipline as the two counters above:
 * every bound is the `WHERE` of one statement, so the database decides once
 * per request, and a give-back is floored at zero.
 *
 * THE CLAIM IS ONE TRANSACTION OVER TWO ROWS.
 *
 *  1. The intake row is inserted with `requests = 0` if it is not there, and
 *     then locked (`FOR UPDATE`). Two parallel requests with one new id
 *     serialise here: the second one's insert waits for the first to commit,
 *     finds the row, and sees the first one in flight.
 *  2. A row whose request is IN FLIGHT (`requests > 0`, nothing delivered)
 *     and younger than {@link INTAKE_REUSE_WINDOW_MS} refuses the new request
 *     (`in-flight`, the proxy's `409 intake-in-flight`) and writes nothing.
 *     Until 2026-09-30 a second request rode on the first one's scan while it
 *     was still running, so two parallel requests got two answers for one
 *     scan. A request may use an intake again only once the earlier one
 *     SETTLED: a failed one gave its scan back and deleted the row (see the
 *     give-back below), so the next request claims afresh at no net cost; a
 *     delivered one is a new action (M256/02).
 *  3. An in-flight row OLDER than the window is a request that never settled:
 *     the process died, or its give-back could not be written. It is taken
 *     over WITHOUT a new scan, under a new claim number, so the dead
 *     request's late writes (if it was only slow) change nothing. No intake is
 *     stuck for longer than the window, and the hourly sweep deletes the row
 *     after a day in any case.
 *  4. Anything else claims one:
 *
 *     ```sql
 *     UPDATE accounts SET trial_scans_used = trial_scans_used + 1
 *     WHERE id = $1 AND trial_scans IS NOT NULL AND trial_scans_used < trial_scans
 *     RETURNING trial_scans, trial_scans_used
 *     ```
 *
 *     No row back is the last scan already used, and the whole transaction
 *     rolls back so no intake row is left behind. A claimed scan resets the
 *     row and moves its `claim` number up by one.
 *
 * THE GIVE-BACK undoes the request: `requests - 1`, and when that reaches zero
 * on an intake that never delivered an answer, the row goes and the scan is
 * returned, floored at zero like every release here. With one request in
 * flight per intake, that is every give-back of an undelivered request.
 *
 * THE CLAIM NUMBER TIES A GIVE-BACK AND A DELIVERY TO THEIR SCAN (M256/02).
 * Every request is handed the number its claim carried, and both writes match
 * it. Without it, a request still running when a newer request claimed a new
 * scan on the same id could return THAT scan by failing late, or mark it
 * delivered by succeeding late, and the newer request's own failure would
 * then return nothing. A write for an older claim changes nothing.
 */
export function createDrizzleAiTrialScans(db: Database): AiTrialScanStore {
  return {
    async claimTrialScan(input: { accountId: number; intakeId: string; now: Date }): Promise<TrialClaim> {
      try {
        return await db.transaction(async (tx): Promise<TrialClaim> => {
          await tx
            .insert(aiTrialIntakes)
            .values({ accountId: input.accountId, intakeId: input.intakeId, createdAt: input.now, requests: 0 })
            .onConflictDoNothing();
          const [intake] = await tx
            .select({
              requests: aiTrialIntakes.requests,
              createdAt: aiTrialIntakes.createdAt,
              delivered: aiTrialIntakes.delivered,
              claim: aiTrialIntakes.claim,
            })
            .from(aiTrialIntakes)
            .where(and(eq(aiTrialIntakes.accountId, input.accountId), eq(aiTrialIntakes.intakeId, input.intakeId)))
            .for('update');
          if (!intake) throw new Error('the intake row was not there after its insert');

          const isInFlight = intake.requests > 0 && !intake.delivered;
          const isWithinWindow = input.now.getTime() - intake.createdAt.getTime() < INTAKE_REUSE_WINDOW_MS;
          // NOTHING IS WRITTEN: the row was there, so the insert above did
          // nothing, and this refusal costs the caller nothing at all.
          if (isInFlight && isWithinWindow) return { ok: false, reason: 'in-flight' };
          if (isInFlight) {
            // THE ABANDONED REQUEST'S SCAN, under a new claim number, see the
            // section header.
            const claim = intake.claim + 1;
            await tx
              .update(aiTrialIntakes)
              .set({ requests: 1, delivered: false, createdAt: input.now, claim })
              .where(and(eq(aiTrialIntakes.accountId, input.accountId), eq(aiTrialIntakes.intakeId, input.intakeId)));
            const [account] = await tx
              .select({ granted: accounts.trialScans, used: accounts.trialScansUsed })
              .from(accounts)
              .where(eq(accounts.id, input.accountId));
            const left = Math.max(0, (account?.granted ?? 0) - (account?.used ?? 0));
            return { ok: true, intakeId: input.intakeId, claim, left };
          }

          const [claimed] = await tx
            .update(accounts)
            .set({ trialScansUsed: sql`${accounts.trialScansUsed} + 1` })
            .where(
              and(
                eq(accounts.id, input.accountId),
                isNotNull(accounts.trialScans),
                lt(accounts.trialScansUsed, accounts.trialScans),
              ),
            )
            .returning({ granted: accounts.trialScans, used: accounts.trialScansUsed });
          if (!claimed) throw new TrialScansSpentSignal();

          const claim = intake.claim + 1;
          await tx
            .update(aiTrialIntakes)
            .set({ requests: 1, delivered: false, createdAt: input.now, claim })
            .where(and(eq(aiTrialIntakes.accountId, input.accountId), eq(aiTrialIntakes.intakeId, input.intakeId)));
          return {
            ok: true,
            intakeId: input.intakeId,
            claim,
            left: Math.max(0, (claimed.granted ?? 0) - claimed.used),
          };
        });
      } catch (error) {
        if (error instanceof TrialScansSpentSignal) return { ok: false, reason: 'spent' };
        throw error;
      }
    },

    async releaseTrialScan(input: {
      accountId: number;
      intakeId: string;
      claim: number;
      undeliver: boolean;
    }): Promise<{ givenBack: boolean }> {
      return await db.transaction(async (tx): Promise<{ givenBack: boolean }> => {
        // THE CLAIM IS PART OF THE KEY: a give-back for an older claim finds
        // no row and returns nothing, see the section header.
        const where = and(
          eq(aiTrialIntakes.accountId, input.accountId),
          eq(aiTrialIntakes.intakeId, input.intakeId),
          eq(aiTrialIntakes.claim, input.claim),
        );
        const changes: PgUpdateSetSource<typeof aiTrialIntakes> = { requests: sql`${aiTrialIntakes.requests} - 1` };
        // The relay failed after the headers: the person got no answer after
        // all, so the delivery this request stamped does not count.
        if (input.undeliver) changes.delivered = false;
        const [intake] = await tx
          .update(aiTrialIntakes)
          .set(changes)
          .where(and(where, gt(aiTrialIntakes.requests, 0)))
          .returning({ requests: aiTrialIntakes.requests, delivered: aiTrialIntakes.delivered });
        if (!intake || intake.requests > 0 || intake.delivered) return { givenBack: false };

        await tx.delete(aiTrialIntakes).where(where);
        const returned = await tx
          .update(accounts)
          .set({ trialScansUsed: sql`${accounts.trialScansUsed} - 1` })
          // Floored at zero, like every give-back in this module.
          .where(and(eq(accounts.id, input.accountId), gt(accounts.trialScansUsed, 0)))
          .returning({ id: accounts.id });
        return { givenBack: returned.length > 0 };
      });
    },

    async markTrialScanDelivered(input: { accountId: number; intakeId: string; claim: number }): Promise<void> {
      await db
        .update(aiTrialIntakes)
        .set({ delivered: true })
        .where(
          and(
            eq(aiTrialIntakes.accountId, input.accountId),
            eq(aiTrialIntakes.intakeId, input.intakeId),
            eq(aiTrialIntakes.claim, input.claim),
          ),
        );
    },

    async purgeTrialIntakesBefore(input: { before: Date }): Promise<number> {
      const deleted = await db
        .delete(aiTrialIntakes)
        .where(lt(aiTrialIntakes.createdAt, input.before))
        .returning({ accountId: aiTrialIntakes.accountId });
      return deleted.length;
    },

    async reserveTrialInstance(input: { day: string; limit: number | null; weight: number }): Promise<ReserveResult> {
      // Counted on EVERY scan-trial request, so the operator's stats have a
      // number whether or not a sub-ceiling is set; bounded only when it is.
      // The insert branch is guarded in code for the reason `reserveInstance`'s
      // is, and `config.ts` refuses a limit of zero at boot.
      assertWeight(input.weight);
      if (input.limit !== null && input.weight > input.limit) {
        return { ok: false, used: input.limit, limit: input.limit };
      }
      const rows = await db
        .insert(aiInstanceDays)
        .values({ day: input.day, count: 0, trialCount: input.weight })
        .onConflictDoUpdate({
          target: aiInstanceDays.day,
          set: { trialCount: sql`${aiInstanceDays.trialCount} + ${input.weight}` },
          where:
            input.limit === null ? undefined : sql`${aiInstanceDays.trialCount} + ${input.weight} <= ${input.limit}`,
        })
        .returning({ count: aiInstanceDays.trialCount });
      const row = rows[0];
      const limit = input.limit ?? Number.MAX_SAFE_INTEGER;
      if (!row) return { ok: false, used: limit, limit };
      return { ok: true, used: row.count, limit };
    },

    async releaseTrialInstance(input: { day: string; weight: number }): Promise<void> {
      assertWeight(input.weight);
      await db
        .update(aiInstanceDays)
        .set({ trialCount: sql`greatest(${aiInstanceDays.trialCount} - ${input.weight}, 0)` })
        .where(and(eq(aiInstanceDays.day, input.day), gt(aiInstanceDays.trialCount, 0)));
    },

    // ONE NETWORK'S SHARE OF THE TRIAL CEILING (M270 spec 12), the same
    // one-statement upsert as every counter above: the bound is the `WHERE`
    // of the `DO UPDATE`, so parallel requests from one network serialise on
    // the row lock and only those that still fit get a row back. The insert
    // branch is guarded in code, for the reason `reserve`'s is.
    async reserveTrialNetwork(input: {
      day: string;
      networkHash: string;
      limit: number;
      weight: number;
    }): Promise<ReserveResult> {
      assertWeight(input.weight);
      if (input.weight > input.limit) return { ok: false, used: input.limit, limit: input.limit };
      const rows = await db
        .insert(aiTrialNetworkDays)
        .values({ day: input.day, networkHash: input.networkHash, count: input.weight })
        .onConflictDoUpdate({
          target: [aiTrialNetworkDays.day, aiTrialNetworkDays.networkHash],
          set: { count: sql`${aiTrialNetworkDays.count} + ${input.weight}` },
          where: sql`${aiTrialNetworkDays.count} + ${input.weight} <= ${input.limit}`,
        })
        .returning({ count: aiTrialNetworkDays.count });
      const row = rows[0];
      if (!row) return { ok: false, used: input.limit, limit: input.limit };
      return { ok: true, used: row.count, limit: input.limit };
    },

    async releaseTrialNetwork(input: { day: string; networkHash: string; weight: number }): Promise<void> {
      assertWeight(input.weight);
      await db
        .update(aiTrialNetworkDays)
        .set({ count: sql`greatest(${aiTrialNetworkDays.count} - ${input.weight}, 0)` })
        .where(
          and(
            eq(aiTrialNetworkDays.day, input.day),
            eq(aiTrialNetworkDays.networkHash, input.networkHash),
            gt(aiTrialNetworkDays.count, 0),
          ),
        );
    },

    async purgeTrialNetworkDaysBefore(input: { day: string }): Promise<number> {
      const deleted = await db
        .delete(aiTrialNetworkDays)
        .where(lt(aiTrialNetworkDays.day, input.day))
        .returning({ day: aiTrialNetworkDays.day });
      return deleted.length;
    },
  };
}

/**
 * The free bounds' counters (2026-10-07, `ai/free-bound.ts`), spread into
 * {@link createDrizzleAiQuotaStore} like the trial's.
 */
export function createDrizzleAiFreeBound(db: Database): AiFreeBoundStore {
  return {
    // THE FREE BOUNDS (2026-10-07, `ai/free-bound.ts`): the same one-statement
    // upserts as the trial's, on their own column and table. Called only where
    // the setting is set, so an instance that sets neither writes nothing.
    async reserveFreeInstance(input: { day: string; limit: number; weight: number }): Promise<ReserveResult> {
      assertWeight(input.weight);
      if (input.weight > input.limit) return { ok: false, used: input.limit, limit: input.limit };
      const rows = await db
        .insert(aiInstanceDays)
        .values({ day: input.day, count: 0, freeCount: input.weight })
        .onConflictDoUpdate({
          target: aiInstanceDays.day,
          set: { freeCount: sql`${aiInstanceDays.freeCount} + ${input.weight}` },
          where: sql`${aiInstanceDays.freeCount} + ${input.weight} <= ${input.limit}`,
        })
        .returning({ count: aiInstanceDays.freeCount });
      const row = rows[0];
      if (!row) return { ok: false, used: input.limit, limit: input.limit };
      return { ok: true, used: row.count, limit: input.limit };
    },

    async releaseFreeInstance(input: { day: string; weight: number }): Promise<void> {
      assertWeight(input.weight);
      await db
        .update(aiInstanceDays)
        .set({ freeCount: sql`greatest(${aiInstanceDays.freeCount} - ${input.weight}, 0)` })
        .where(and(eq(aiInstanceDays.day, input.day), gt(aiInstanceDays.freeCount, 0)));
    },

    async reserveFreeNetwork(input: {
      day: string;
      networkHash: string;
      limit: number;
      weight: number;
    }): Promise<ReserveResult> {
      assertWeight(input.weight);
      if (input.weight > input.limit) return { ok: false, used: input.limit, limit: input.limit };
      const rows = await db
        .insert(aiFreeNetworkDays)
        .values({ day: input.day, networkHash: input.networkHash, count: input.weight })
        .onConflictDoUpdate({
          target: [aiFreeNetworkDays.day, aiFreeNetworkDays.networkHash],
          set: { count: sql`${aiFreeNetworkDays.count} + ${input.weight}` },
          where: sql`${aiFreeNetworkDays.count} + ${input.weight} <= ${input.limit}`,
        })
        .returning({ count: aiFreeNetworkDays.count });
      const row = rows[0];
      if (!row) return { ok: false, used: input.limit, limit: input.limit };
      return { ok: true, used: row.count, limit: input.limit };
    },

    async releaseFreeNetwork(input: { day: string; networkHash: string; weight: number }): Promise<void> {
      assertWeight(input.weight);
      await db
        .update(aiFreeNetworkDays)
        .set({ count: sql`greatest(${aiFreeNetworkDays.count} - ${input.weight}, 0)` })
        .where(
          and(
            eq(aiFreeNetworkDays.day, input.day),
            eq(aiFreeNetworkDays.networkHash, input.networkHash),
            gt(aiFreeNetworkDays.count, 0),
          ),
        );
    },

    async purgeFreeNetworkDaysBefore(input: { day: string }): Promise<number> {
      const deleted = await db
        .delete(aiFreeNetworkDays)
        .where(lt(aiFreeNetworkDays.day, input.day))
        .returning({ day: aiFreeNetworkDays.day });
      return deleted.length;
    },
  };
}

/**
 * The scan trial's half of the quota store (M253). Declared below its
 * implementation for the reason `AiInstanceCeilingStore` is: read the
 * statements first.
 */
export interface AiTrialScanStore {
  /**
   * Claims a scan for this intake, refuses while an earlier request on it is
   * in flight, or takes over one abandoned past the reuse window. Called only
   * for an account the scan gate applies to, the `trial` grant
   * `accounts/ai-allowance.ts` picks. `intakeId` is the client's
   * `X-Intake-Id`, or a server-made one for a request that sent none.
   */
  claimTrialScan(input: { accountId: number; intakeId: string; now: Date }): Promise<TrialClaim>;
  /**
   * Gives one request back, and the scan with it when it was the last request
   * on an intake that delivered nothing. `undeliver` first clears the delivery
   * this request stamped, for an upstream body that failed after its headers.
   * `claim` is the number {@link claimTrialScan} answered: a give-back for an
   * older claim changes nothing (M256/02). Never throws out of the proxy's
   * hands (see its give-back).
   */
  releaseTrialScan(input: {
    accountId: number;
    intakeId: string;
    claim: number;
    undeliver: boolean;
  }): Promise<{ givenBack: boolean }>;
  /**
   * Stamps the intake delivered when an upstream 2xx's headers arrive: a
   * client disconnect after that keeps the scan, and the next request on the
   * id claims a new one. Only for the claim named, like the give-back.
   */
  markTrialScanDelivered(input: { accountId: number; intakeId: string; claim: number }): Promise<void>;
  /** Deletes intake rows older than `before`. Driven hourly by `ai/usage-retention.ts`. */
  purgeTrialIntakesBefore(input: { before: Date }): Promise<number>;
  /**
   * Counts one scan-trial request's `weight` against the day, bounded by
   * `AI_TRIAL_INSTANCE_DAILY_LIMIT` when it is set (`limit`), unbounded when it
   * is `null`. `ok: false` is the sub-ceiling reached.
   */
  reserveTrialInstance(input: { day: string; limit: number | null; weight: number }): Promise<ReserveResult>;
  /** Gives one scan-trial request's `weight` back to the day, floored at zero. */
  releaseTrialInstance(input: { day: string; weight: number }): Promise<void>;
  /**
   * Counts one scan-trial request's `weight` against its caller network's
   * share of the day (`AI_TRIAL_NETWORK_DAILY_LIMIT`, M270 spec 12), or none
   * when it does not fit. `networkHash` is the keyed name
   * `ai/trial-network.ts` makes, never an address. Called only where the
   * share is set.
   */
  reserveTrialNetwork(input: {
    day: string;
    networkHash: string;
    limit: number;
    weight: number;
  }): Promise<ReserveResult>;
  /** Gives one scan-trial request's `weight` back to its network's day, floored at zero. */
  releaseTrialNetwork(input: { day: string; networkHash: string; weight: number }): Promise<void>;
  /** Deletes every network row before the given UTC day. Driven hourly by `ai/usage-retention.ts`. */
  purgeTrialNetworkDaysBefore(input: { day: string }): Promise<number>;
}

/**
 * The counters of the opt-in free bounds (2026-10-07, `ai/free-bound.ts`).
 * {@link AiQuotaStore} extends this for the reason it extends the trial's.
 */
export interface AiFreeBoundStore {
  /**
   * Counts one free-grant request against `AI_FREE_INSTANCE_DAILY_LIMIT`
   * (`limit`), or none when it does not fit (2026-10-07). Called only where
   * the limit is set.
   */
  reserveFreeInstance(input: { day: string; limit: number; weight: number }): Promise<ReserveResult>;
  /** Gives one free-grant request back to the day, floored at zero. */
  releaseFreeInstance(input: { day: string; weight: number }): Promise<void>;
  /**
   * Counts one free-grant request against its caller network's
   * `AI_FREE_NETWORK_DAILY_LIMIT`, or none when it does not fit. Called only
   * where the limit is set. `networkHash` is never an address.
   */
  reserveFreeNetwork(input: {
    day: string;
    networkHash: string;
    limit: number;
    weight: number;
  }): Promise<ReserveResult>;
  /** Gives one free-grant request back to its network's day, floored at zero. */
  releaseFreeNetwork(input: { day: string; networkHash: string; weight: number }): Promise<void>;
  /** Deletes every free network row before the given UTC day. Driven hourly by `ai/usage-retention.ts`. */
  purgeFreeNetworkDaysBefore(input: { day: string }): Promise<number>;
}
