/**
 * The one push table, behind one port.
 *
 * THE UPSERT IS ONE STATEMENT, for the reason `ai/quota-store.ts` and
 * `pulse/pulse-store.ts` both give at length: a read followed by a write has a
 * window, and a device re-registering on wake is precisely the client that
 * lands in it. `endpoint` carries the unique index, so the conflict IS the
 * "this device is already here" answer.
 *
 * NOTHING IN THIS FILE LOGS, and no method returns a sending credential to a
 * caller that did not already hold the endpoint. See ADR-0008 on what a row is
 * allowed to hold at all.
 */
import { and, count, desc, eq, isNotNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { accounts, pushSubscriptions } from '../db/schema.js';
import type { InstanceLanguage } from '../protocol.js';

/** One subscription row, as every caller in this service sees it. */
export interface PushSubscriptionRow {
  id: number;
  accountId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  timeZone: string;
  locale: InstanceLanguage;
  /** A minute of the local day, 0 to 1439, or `null` for "no catch-up on this device". */
  catchUpMinute: number | null;
  fastTargetEnabled: boolean;
  lastCatchUpDay: string | null;
  lastSeenDay: string;
  wakeAt: Date | null;
  sendsTodayDay: string | null;
  sendsToday: number;
  /** Deliveries that failed in a row. See `push/push-scheduler.ts` on the backoff it drives. */
  failedSends: number;
  /** No delivery before this instant, or `null`. */
  retryAt: Date | null;
  createdAt: Date;
}

/**
 * How many subscriptions one account may hold. A new registration past it
 * replaces the account's oldest ones, so a person with a new phone every week
 * is never refused, and a script cannot fill the table under one account
 * (2026-09-30). Ten is every browser a person plausibly uses, twice.
 */
export const PUSH_SUBSCRIPTIONS_PER_ACCOUNT = 10;

/**
 * The advisory-lock namespace for the per-account cap, so two registrations of
 * one account cannot both count nine and both insert. The value only has to
 * differ from every other namespace in this service (`feedback-store.ts`,
 * `db/trial-mailbox.ts`).
 */
const PUSH_CAP_LOCK_NAMESPACE = 200_223;

/**
 * A subscription the minute tick may send to, with the one account fact the
 * tick needs beside the schedule: the health-data consent version the account
 * holds, or `null` for none. Read in the same query as the row, so the tick
 * costs no second read (M266, see `push/push-scheduler.ts`).
 */
export interface SchedulableSubscription extends PushSubscriptionRow {
  healthConsentVersion: string | null;
}

/** What a registration writes. Everything the device knows about itself, plus the day it is being seen on. */
export interface PushSubscriptionUpsert {
  accountId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  timeZone: string;
  locale: InstanceLanguage;
  catchUpMinute: number | null;
  fastTargetEnabled: boolean;
  /** The local day of the registration, which is what the seven day pause reads. */
  lastSeenDay: string;
  createdAt: Date;
}

/**
 * Whether a registration created a row or refreshed one, which is what decides
 * `201` against `200`.
 *
 * A VALUE RATHER THAN AN EXCEPTION, because a re-registration is the ordinary
 * case: a service worker mints a new endpoint on every reinstall, and the same
 * endpoint arriving again is a device saying it is still here.
 */
export type PushUpsertOutcome = 'created' | 'refreshed';

/** A schedule change. Every field is optional, and an absent one is left exactly as it was. */
export interface PushSchedulePatch {
  accountId: number;
  endpoint: string;
  timeZone?: string;
  locale?: InstanceLanguage;
  catchUpMinute?: number | null;
  fastTargetEnabled?: boolean;
  wakeAt?: Date | null;
  /** Always written: a device that changed its schedule was here today. */
  lastSeenDay: string;
}

/** What the operator's stats report, and the only aggregate this table answers. */
export interface PushStats {
  subscriptions: number;
  /** Pushes delivered on the given UTC day, summed over every subscription. */
  sentToday: number;
}

export interface PushStore {
  /**
   * Registers a device, or refreshes the row it already has. One statement,
   * see the module header, and then the per-account cap: past
   * {@link PUSH_SUBSCRIPTIONS_PER_ACCOUNT}, the account's oldest OTHER rows go.
   * A refresh also clears the failure count, because a device that registers
   * again has handed over fresh keys.
   */
  upsert(input: PushSubscriptionUpsert): Promise<PushUpsertOutcome>;
  /**
   * Deletes the predecessor a re-registration named, and ONLY when it belongs
   * to the same account.
   *
   * THE ACCOUNT IS IN THE PREDICATE AND MUST STAY THERE. `replaces` is a string
   * a client chose; without the account id, any signed-in caller could unhook
   * anybody else's phone by naming their endpoint. Answers how many rows went,
   * so a caller can tell "not mine" from "already gone" only by not caring,
   * which is the correct amount to care.
   */
  deleteSupersededEndpoint(input: { accountId: number; endpoint: string }): Promise<number>;
  /** The person's own unsubscribe. Same predicate, same reason. */
  deleteOwnEndpoint(input: { accountId: number; endpoint: string }): Promise<number>;
  /**
   * The 404/410 prune, by endpoint alone.
   *
   * NO ACCOUNT IN THE PREDICATE, deliberately and unlike the two above: the
   * push service has just told us this endpoint is gone, and the caller is the
   * tick rather than a client. An endpoint is globally unique, so there is
   * nothing else this could reach.
   */
  deleteGoneEndpoint(input: { endpoint: string }): Promise<number>;
  /** One row by endpoint, for this account. `null` when it is not theirs or not here. */
  findOwn(input: { accountId: number; endpoint: string }): Promise<PushSubscriptionRow | null>;
  /** Applies a schedule change and answers the row as it now stands, or `null` when there is nothing to change. */
  patch(input: PushSchedulePatch): Promise<PushSubscriptionRow | null>;
  /**
   * Every row that could possibly be due: one with a catch-up minute, or one
   * with a wake instant.
   *
   * FILTERED IN THE QUERY rather than in the tick, because a row with neither
   * is a device that asked for nothing and reading it every minute would be a
   * full table scan a minute for nothing.
   */
  listSchedulable(): Promise<SchedulableSubscription[]>;
  /** Records a catch-up: the local day it went out, and the day's send count. One statement. */
  markCatchUpSent(input: { endpoint: string; localDay: string; sendsDay: string; sends: number }): Promise<void>;
  /** Records a fast target alert and CLEARS `wake_at` in the same write, so it can never fire twice. */
  markFastTargetSent(input: { endpoint: string; sendsDay: string; sends: number }): Promise<void>;
  /**
   * Records a delivery that failed with anything but a 404 or a 410: the
   * failure count it now has, and the instant before which the tick tries
   * nothing. Both marks above reset the two columns.
   */
  markSendFailed(input: { endpoint: string; failedSends: number; retryAt: Date }): Promise<void>;
  /** The two numbers `GET /v1/admin/stats` reports. Never a row, never an endpoint. */
  stats(input: { day: string }): Promise<PushStats>;
}

/** The row Drizzle hands back, mapped once, here, so no caller reads a column name. */
function toRow(row: typeof pushSubscriptions.$inferSelect): PushSubscriptionRow {
  return {
    id: row.id,
    accountId: row.accountId,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.userAgent,
    timeZone: row.timeZone,
    locale: row.locale,
    catchUpMinute: row.catchUpMinute,
    fastTargetEnabled: row.fastTargetEnabled,
    lastCatchUpDay: row.lastCatchUpDay,
    lastSeenDay: row.lastSeenDay,
    wakeAt: row.wakeAt,
    sendsTodayDay: row.sendsTodayDay,
    sendsToday: row.sendsToday,
    failedSends: row.failedSends,
    retryAt: row.retryAt,
    createdAt: row.createdAt,
  };
}

export function createDrizzlePushStore(db: Database): PushStore {
  return {
    async upsert(input: PushSubscriptionUpsert): Promise<PushUpsertOutcome> {
      return db.transaction(async (tx) => {
        // Serialises this account's registrations, so the cap below counts
        // what is really there. Released when the transaction ends.
        await tx.execute(sql`select pg_advisory_xact_lock(${PUSH_CAP_LOCK_NAMESPACE}, ${input.accountId})`);

        const rows = await tx
          .insert(pushSubscriptions)
          .values({
            accountId: input.accountId,
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
            timeZone: input.timeZone,
            locale: input.locale,
            catchUpMinute: input.catchUpMinute,
            fastTargetEnabled: input.fastTargetEnabled,
            lastSeenDay: input.lastSeenDay,
            createdAt: input.createdAt,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: {
              // THE OWNER IS REWRITTEN TOO, and a real flow needs it. The app
              // reuses the browser's existing subscription when it was minted
              // for this instance's key (`subscribeInBrowser` in the app's
              // `lib/push.ts`), and the device erase that drops it is best
              // effort: offline, or with a session that already expired, the
              // browser keeps its subscription. The next account to sign in
              // on that browser then registers the SAME endpoint, and a
              // refusal here would leave that person with no notifications on
              // their own device while the previous owner's row kept waking
              // it. What moving costs: a caller holding somebody's endpoint
              // (a capability that is never logged or returned) can take the
              // row over and silence that device. It cannot read or send
              // anything with it, because the keys are replaced with its own.
              accountId: input.accountId,
              p256dh: input.p256dh,
              auth: input.auth,
              userAgent: input.userAgent,
              timeZone: input.timeZone,
              locale: input.locale,
              catchUpMinute: input.catchUpMinute,
              fastTargetEnabled: input.fastTargetEnabled,
              lastSeenDay: input.lastSeenDay,
              // Fresh keys from a device that is here: whatever failed before
              // is no evidence against them.
              failedSends: 0,
              retryAt: null,
            },
          })
          // `xmax = 0` IS POSTGRES SAYING "THIS ROW IS NEW". On a row an upsert
          // inserted, the system column holds 0; on one it updated, it holds the
          // transaction that locked it. It is the only honest answer available
          // from one statement, and the alternative, comparing the returned
          // `created_at` with the one this call asked for, is wrong on any
          // instance whose clock did not move between two registrations, which is
          // every test with a frozen clock and every device that retries fast.
          .returning({ inserted: sql<boolean>`(xmax = 0)` });

        // THE CAP. The row just written always stays; of the account's other
        // rows, the newest `cap - 1` stay and the rest go.
        const keep = tx
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(and(eq(pushSubscriptions.accountId, input.accountId), ne(pushSubscriptions.endpoint, input.endpoint)))
          .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
          .limit(PUSH_SUBSCRIPTIONS_PER_ACCOUNT - 1);
        await tx
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.accountId, input.accountId),
              ne(pushSubscriptions.endpoint, input.endpoint),
              notInArray(pushSubscriptions.id, keep),
            ),
          );

        const [row] = rows;
        return row?.inserted === true ? 'created' : 'refreshed';
      });
    },

    async deleteSupersededEndpoint(input: { accountId: number; endpoint: string }): Promise<number> {
      const rows = await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.accountId, input.accountId), eq(pushSubscriptions.endpoint, input.endpoint)))
        .returning({ id: pushSubscriptions.id });
      return rows.length;
    },

    async deleteOwnEndpoint(input: { accountId: number; endpoint: string }): Promise<number> {
      const rows = await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.accountId, input.accountId), eq(pushSubscriptions.endpoint, input.endpoint)))
        .returning({ id: pushSubscriptions.id });
      return rows.length;
    },

    async deleteGoneEndpoint(input: { endpoint: string }): Promise<number> {
      const rows = await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .returning({ id: pushSubscriptions.id });
      return rows.length;
    },

    async findOwn(input: { accountId: number; endpoint: string }): Promise<PushSubscriptionRow | null> {
      const [row] = await db
        .select()
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.accountId, input.accountId), eq(pushSubscriptions.endpoint, input.endpoint)));
      return row === undefined ? null : toRow(row);
    },

    async patch(input: PushSchedulePatch): Promise<PushSubscriptionRow | null> {
      const [row] = await db
        .update(pushSubscriptions)
        .set({
          // Absent means unchanged, which is what `undefined` already means to
          // Drizzle's `set`. There is no conditional spread here on purpose:
          // the column list IS the contract, and a spread would hide it.
          timeZone: input.timeZone,
          locale: input.locale,
          catchUpMinute: input.catchUpMinute,
          fastTargetEnabled: input.fastTargetEnabled,
          wakeAt: input.wakeAt,
          lastSeenDay: input.lastSeenDay,
        })
        .where(and(eq(pushSubscriptions.accountId, input.accountId), eq(pushSubscriptions.endpoint, input.endpoint)))
        .returning();
      return row === undefined ? null : toRow(row);
    },

    async listSchedulable(): Promise<SchedulableSubscription[]> {
      // JOINED, NOT LOOKED UP. The tick has to know each account's consent,
      // and one query per account every minute would be the full scan this
      // method's predicate exists to avoid, many times over. An inner join is
      // exact: a subscription cannot outlive its account (the foreign key
      // cascades).
      const rows = await db
        .select({ subscription: pushSubscriptions, healthConsentVersion: accounts.healthConsentVersion })
        .from(pushSubscriptions)
        .innerJoin(accounts, eq(accounts.id, pushSubscriptions.accountId))
        .where(or(isNotNull(pushSubscriptions.catchUpMinute), isNotNull(pushSubscriptions.wakeAt)));
      return rows.map((row) =>
        Object.assign(toRow(row.subscription), { healthConsentVersion: row.healthConsentVersion }),
      );
    },

    async markCatchUpSent(input: {
      endpoint: string;
      localDay: string;
      sendsDay: string;
      sends: number;
    }): Promise<void> {
      await db
        .update(pushSubscriptions)
        .set({
          lastCatchUpDay: input.localDay,
          sendsTodayDay: input.sendsDay,
          sendsToday: input.sends,
          failedSends: 0,
          retryAt: null,
        })
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
    },

    async markFastTargetSent(input: { endpoint: string; sendsDay: string; sends: number }): Promise<void> {
      await db
        .update(pushSubscriptions)
        // CLEARED IN THE SAME WRITE as the count is recorded. A wake instant
        // that survived the send would fire again on the next tick, and the cap
        // would be the only thing stopping it.
        .set({ wakeAt: null, sendsTodayDay: input.sendsDay, sendsToday: input.sends, failedSends: 0, retryAt: null })
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
    },

    async markSendFailed(input: { endpoint: string; failedSends: number; retryAt: Date }): Promise<void> {
      await db
        .update(pushSubscriptions)
        .set({ failedSends: input.failedSends, retryAt: input.retryAt })
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
    },

    async stats(input: { day: string }): Promise<PushStats> {
      const [total] = await db.select({ total: count() }).from(pushSubscriptions);
      const [sent] = await db
        .select({ total: sql<number>`coalesce(sum(${pushSubscriptions.sendsToday}), 0)::int` })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.sendsTodayDay, input.day));
      return { subscriptions: total?.total ?? 0, sentToday: sent?.total ?? 0 };
    },
  };
}
