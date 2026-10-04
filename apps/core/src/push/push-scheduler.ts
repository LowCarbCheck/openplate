/**
 * The minute tick: the only thing on this service that decides a push should
 * happen.
 *
 * MODELLED ON `pulse/pulse-retention.ts` and `ai/usage-retention.ts`, down to
 * the unrefed timer, the injected clock and the failure that is logged rather
 * than thrown out of the callback. It differs from both in its period, and the
 * period is the point: the sweeps are hourly because a row deleted at 14:59
 * instead of 14:00 is the same deletion, and a catch-up that arrives at 08:59
 * instead of 08:00 is a different notification.
 *
 * THE DECISION IS PURE AND THE SENDING IS NOT. `planPushSends` takes the rows
 * and an instant and answers what should go out; `runPushTick` sends it, prunes
 * what the push service disowned, and writes the marks. That split is what lets
 * `tests/unit/push-schedule-dst.test.ts` walk both Berlin changeovers minute by
 * minute in milliseconds, and it is the half of this feature most likely to be
 * wrong.
 *
 * AND ONE GATE BEFORE THE RULES (M266, 2026-09-29): an account that does not
 * hold the instance's current health-data consent is sent nothing. See
 * `runPushTick`.
 *
 * THREE RULES, all of them in ADR-0008:
 *
 *  1. The catch-up goes out once per LOCAL day, when the subscription's own
 *     clock has passed its minute and it has not already gone out today there.
 *  2. A subscription whose `last_seen_day` is more than seven local days old
 *     receives no catch-up. Somebody who stopped using the app is not chased.
 *  3. At most two sends per subscription per UTC day, counted in the row. It is
 *     what bounds the damage a clock bug can do, and a clock bug is the most
 *     likely defect here.
 *
 * AND FOUR BOUNDS ON WHAT ONE ROW CAN COST EVERYBODY ELSE (2026-09-30). Before
 * them, one account could stall every delivery on the instance and make this
 * service POST to an internal host every minute:
 *
 *  - A row whose endpoint the {@link PushEndpointPolicy} refuses is never sent
 *    to, and is deleted. Rows written before registration checked the
 *    endpoint are what this catches.
 *  - Sends run {@link PUSH_SEND_CONCURRENCY} endpoints at a time, and the
 *    sender itself gives up after ten seconds (`push/web-push-sender.ts`), so
 *    one slow endpoint holds one slot, not the tick.
 *  - A failure that is not a 404 or a 410 backs the row off: the next try is
 *    one minute later, then two, then four, up to a day
 *    ({@link pushRetryDelayMs}). After {@link PUSH_FAILED_SENDS_LIMIT} failures
 *    in a row, about four and a half days of them, the row is deleted. That is long enough
 *    that a push service outage deletes nothing, which is the reason `send.ts`
 *    refuses to prune on anything but 404 and 410.
 *  - A tick that is still running when the next minute comes is not joined by
 *    a second one, see {@link startPushScheduler}.
 */
import { utcDayKey } from '../lib/utc-day.js';
import type { Logger } from '../logger.js';
import { holdsHealthConsent } from '../accounts/health-consent.js';
import type { InstanceHealthConsent } from '../protocol.js';
import { localClock, localDaysBetween } from './local-day.js';
import type { PushEndpointPolicy } from './endpoint-policy.js';
import type { PushSubscriptionRow, PushStore } from './push-store.js';
import { isGoneStatus, pushPayload, sendErrorStatus, sendOptionsFor, type PushKind, type PushSender } from './send.js';
import { errorFields } from '../log-error.js';

/** At most this many pushes reach one subscription in one UTC day. ADR-0008 states the number. */
export const PUSH_DAILY_SEND_CAP = 2;

/** How many LOCAL days of silence stop the catch-up. A device seen 7 days ago still gets one; 8 does not. */
export const PUSH_LAST_SEEN_DAYS = 7;

/** A minute, because the catch-up is due at a minute. See the module header on why this is not the sweeps' hour. */
export const PUSH_TICK_INTERVAL_MS = 60 * 1000;

/** How many endpoints one tick sends to at once. One endpoint's sends stay in order, see `runPushTick`. */
export const PUSH_SEND_CONCURRENCY = 8;

/** Failed deliveries in a row after which a subscription is deleted. With {@link pushRetryDelayMs}, about four and a half days. */
export const PUSH_FAILED_SENDS_LIMIT = 15;

/** The longest a failing subscription waits between two tries. */
const PUSH_MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a subscription waits after its `failedSends`-th failure in a row:
 * one minute after the first, doubling, and never more than a day. Pure, and
 * exported for the test that walks it.
 */
export function pushRetryDelayMs(failedSends: number): number {
  const exponent = Math.max(0, failedSends - 1);
  return Math.min(PUSH_TICK_INTERVAL_MS * 2 ** exponent, PUSH_MAX_RETRY_DELAY_MS);
}

/** One push the tick decided on, with the two marks the store writes after it lands. */
export interface PlannedPush {
  endpoint: string;
  kind: PushKind;
  /** The subscription's own local day, which is what `last_catch_up_day` records. */
  localDay: string;
  /** The UTC day the cap counts over, and the count this send makes it. */
  sendsDay: string;
  sends: number;
}

/** One push that was due and was not sent, so the tick can log a number instead of silently dropping it. */
export interface SkippedPush {
  endpoint: string;
  kind: PushKind;
  reason: 'daily-cap';
}

export interface PushPlan {
  sends: PlannedPush[];
  skipped: SkippedPush[];
}

/** How many sends this subscription has already spent on `utcDay`. A different day is a fresh two. */
function sendsUsedOn(row: PushSubscriptionRow, utcDay: string): number {
  return row.sendsTodayDay === utcDay ? row.sendsToday : 0;
}

/** Whether the catch-up is due on this subscription's own clock right now. Pure, and the whole of rules 1 and 2. */
function catchUpIsDue(input: { row: PushSubscriptionRow; localDay: string; localMinute: number }): boolean {
  const { row } = input;
  if (row.catchUpMinute === null) return false;
  if (input.localMinute < row.catchUpMinute) return false;
  // ALREADY GONE OUT TODAY, where today is this device's today. A UTC
  // comparison here is the defect the DST test exists to catch.
  if (row.lastCatchUpDay === input.localDay) return false;

  const silentDays = localDaysBetween({ from: row.lastSeenDay, to: input.localDay });
  // An unreadable stored day is treated as silence rather than as permission:
  // the failure mode of the other choice is pushing somebody forever.
  if (silentDays === null) return false;
  return silentDays <= PUSH_LAST_SEEN_DAYS;
}

/** Whether the fast target alert is due: the instant has passed and this device asked for it. */
function fastTargetIsDue(input: { row: PushSubscriptionRow; now: Date }): boolean {
  const { row } = input;
  if (!row.fastTargetEnabled) return false;
  if (row.wakeAt === null) return false;
  return row.wakeAt.getTime() <= input.now.getTime();
}

/**
 * What should go out at this instant, given these rows. Pure: no clock, no
 * store, no library.
 */
export function planPushSends(input: { subscriptions: readonly PushSubscriptionRow[]; now: Date }): PushPlan {
  const sendsDay = utcDayKey(input.now);
  const sends: PlannedPush[] = [];
  const skipped: SkippedPush[] = [];

  for (const row of input.subscriptions) {
    const local = localClock(input.now, row.timeZone);
    let spent = sendsUsedOn(row, sendsDay);

    const due: PushKind[] = [];
    if (catchUpIsDue({ row, localDay: local.day, localMinute: local.minuteOfDay })) due.push('catch-up');
    if (fastTargetIsDue({ row, now: input.now })) due.push('fast-target');

    for (const kind of due) {
      if (spent >= PUSH_DAILY_SEND_CAP) {
        // SKIPPED, NEVER QUEUED. A postponed notification is a notification
        // that arrives at the wrong hour, which is worse than none.
        skipped.push({ endpoint: row.endpoint, kind, reason: 'daily-cap' });
        continue;
      }
      spent += 1;
      sends.push({ endpoint: row.endpoint, kind, localDay: local.day, sendsDay, sends: spent });
    }
  }

  return { sends, skipped };
}

/** What one tick did, so the caller can log counts and a test can assert them. */
export interface PushTickResult {
  sent: number;
  skipped: number;
  /** Subscriptions the push service disowned with a 404 or a 410, and which this tick deleted. */
  pruned: number;
  /** Deliveries that failed for any other reason. The row is backed off, and kept until the limit. */
  failed: number;
  /** Subscriptions deleted because the endpoint policy refuses their endpoint. Nothing was sent to them. */
  refused: number;
  /** Subscriptions deleted because they reached {@link PUSH_FAILED_SENDS_LIMIT}. */
  abandoned: number;
  /** Subscriptions not tried this tick because they are backing off from a failure. */
  deferred: number;
}

export interface PushTickOptions {
  store: PushStore;
  sender: PushSender;
  logger: Logger;
  /** Injected, like every clock in this repo, so a test names the minute instead of waiting for it. */
  now(): Date;
  /**
   * The health-data consent this instance requires of every account
   * (`HEALTH_CONSENT_VERSION`), or `null` for an instance that asks for none,
   * which is every self-hoster and sends exactly as before.
   *
   * REQUIRED AND NULLABLE, like the AI proxy's ceilings: a wiring change that
   * forgot it must not compile into a scheduler that pushes to everybody.
   */
  healthConsent: InstanceHealthConsent | null;
  /**
   * Which endpoints may be sent to. REQUIRED, for the reason `healthConsent`
   * is: a wiring change that forgot it must not compile into a tick that
   * POSTs wherever a row says.
   */
  endpointPolicy: PushEndpointPolicy;
}

/** Runs `work` over `items`, at most `limit` at a time. Resolves when all have finished; rejects on the first failure. */
async function runWithConcurrency<T>(input: {
  items: readonly T[];
  limit: number;
  work: (item: T) => Promise<void>;
}): Promise<void> {
  let next = 0;
  async function drain(): Promise<void> {
    while (next < input.items.length) {
      const item = input.items[next];
      next += 1;
      if (item !== undefined) await input.work(item);
    }
  }
  const workers = Math.min(input.limit, input.items.length);
  await Promise.all(Array.from({ length: workers }, () => drain()));
}

/** The planned sends grouped by endpoint, each group in plan order: catch-up before fast target. */
function groupByEndpoint(sends: readonly PlannedPush[]): PlannedPush[][] {
  const groups = new Map<string, PlannedPush[]>();
  for (const planned of sends) {
    const group = groups.get(planned.endpoint) ?? [];
    group.push(planned);
    groups.set(planned.endpoint, group);
  }
  return [...groups.values()];
}

/**
 * One tick: plan, send, prune, mark.
 *
 * THE MARK IS WRITTEN ONLY AFTER THE SEND RESOLVES, so a push service that was
 * unreachable for an hour does not cost somebody their catch-up: the row still
 * says it has not gone out today, and the next try, a backed-off minute or
 * more later, sends it. The cap and the backoff stop that retry becoming a
 * flood.
 *
 * A FAILED DELIVERY LEAVES THE ROW ALONE unless the status was 404 or 410. See
 * `push/send.ts` on why a 400 or a 403 must never prune: one VAPID slip would
 * otherwise delete every subscription on the instance in a single minute.
 */
export async function runPushTick(options: PushTickOptions): Promise<PushTickResult> {
  const now = options.now();
  // THE CONSENT GATE, BEFORE ANY RULE (M266). A catch-up says what somebody
  // logged today and a fast alert says when their fast ends, so both are
  // health data sent on the operator's behalf, and the routes already refuse
  // such an account a new subscription. One registered before the instance
  // asked, or before its wording changed, is still in the table, and this is
  // the one reader of the table. Withheld rows are simply not planned: no
  // mark is written, so a catch-up still due once the person agrees goes out
  // at the next tick.
  const consented = (await options.store.listSchedulable()).filter((row) =>
    holdsHealthConsent({ policy: options.healthConsent, consentedVersion: row.healthConsentVersion }),
  );

  const result: PushTickResult = {
    sent: 0,
    skipped: 0,
    pruned: 0,
    failed: 0,
    refused: 0,
    abandoned: 0,
    deferred: 0,
  };

  // THE ENDPOINT POLICY, BEFORE ANY SEND. A row the registration route would
  // refuse today was written before it checked, and it is deleted rather than
  // skipped forever. The log carries a count, never the endpoint.
  const subscriptions: PushSubscriptionRow[] = [];
  for (const row of consented) {
    if (options.endpointPolicy.isAllowed(row.endpoint)) {
      subscriptions.push(row);
      continue;
    }
    await options.store.deleteGoneEndpoint({ endpoint: row.endpoint });
    result.refused += 1;
  }
  if (result.refused > 0) {
    options.logger.warn('Deleted push subscriptions whose endpoint is not a known push service', {
      count: result.refused,
    });
  }

  // THE BACKOFF. A row that failed recently waits; it is not planned, so no
  // cap is spent and no mark is written.
  const due = subscriptions.filter((row) => row.retryAt === null || row.retryAt.getTime() <= now.getTime());
  result.deferred = subscriptions.length - due.length;

  const plan = planPushSends({ subscriptions: due, now });
  result.skipped = plan.skipped.length;

  const byEndpoint = new Map<string, PushSubscriptionRow>();
  for (const row of due) byEndpoint.set(row.endpoint, row);

  for (const skip of plan.skipped) {
    // DEBUG, and with no endpoint in it. An operator debugging a missing
    // notification needs to know the cap bit; nobody needs to know whose phone.
    options.logger.debug('Push skipped by the daily cap', { kind: skip.kind, reason: skip.reason });
  }

  // ENDPOINTS IN PARALLEL, EACH ENDPOINT IN ORDER. Two sends to one row carry
  // the counts 1 and 2 and each mark writes its own count, so they must land
  // in plan order or the cap would count backwards. Across rows nothing is
  // shared, and a slow endpoint holds one of the slots rather than the tick.
  await runWithConcurrency({
    items: groupByEndpoint(plan.sends),
    limit: PUSH_SEND_CONCURRENCY,
    work: async (group) => {
      for (const planned of group) {
        const row = byEndpoint.get(planned.endpoint);
        if (row === undefined) return;
        const delivered = await deliverOne({ options, row, planned, now, result });
        // A row that was deleted or backed off gets nothing more this tick.
        if (!delivered) return;
      }
    },
  });

  return result;
}

/**
 * Sends one planned push and writes what came of it. Answers whether it was
 * delivered, so the caller stops sending to a row that just failed.
 */
async function deliverOne(input: {
  options: PushTickOptions;
  row: PushSubscriptionRow;
  planned: PlannedPush;
  now: Date;
  result: PushTickResult;
}): Promise<boolean> {
  const { options, row, planned, result } = input;
  try {
    await options.sender(
      // `{ endpoint, keys }` and nothing else: the row also carries a
      // schedule, and a sender serialises what it is handed.
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      pushPayload(planned.kind),
      sendOptionsFor(planned.kind),
    );
  } catch (cause) {
    await recordFailure({ options, row, planned, now: input.now, result, cause });
    return false;
  }

  if (planned.kind === 'catch-up') {
    await options.store.markCatchUpSent({
      endpoint: row.endpoint,
      localDay: planned.localDay,
      sendsDay: planned.sendsDay,
      sends: planned.sends,
    });
  } else {
    await options.store.markFastTargetSent({
      endpoint: row.endpoint,
      sendsDay: planned.sendsDay,
      sends: planned.sends,
    });
  }
  result.sent += 1;
  return true;
}

/** A failed delivery: a 404 or a 410 deletes the row, anything else backs it off or, at the limit, deletes it. */
async function recordFailure(input: {
  options: PushTickOptions;
  row: PushSubscriptionRow;
  planned: PlannedPush;
  now: Date;
  result: PushTickResult;
  cause: unknown;
}): Promise<void> {
  const { options, row, result } = input;
  const status = sendErrorStatus(input.cause);
  if (isGoneStatus(status)) {
    await options.store.deleteGoneEndpoint({ endpoint: row.endpoint });
    result.pruned += 1;
    options.logger.info('Deleted a push subscription the push service disowned', { status });
    return;
  }

  result.failed += 1;
  const failedSends = row.failedSends + 1;
  options.logger.warn('Push delivery failed', {
    kind: input.planned.kind,
    failedSends,
    status,
    ...errorFields(input.cause),
  });
  if (failedSends >= PUSH_FAILED_SENDS_LIMIT) {
    await options.store.deleteGoneEndpoint({ endpoint: row.endpoint });
    result.abandoned += 1;
    options.logger.info('Deleted a push subscription after repeated failed deliveries', { failedSends });
    return;
  }
  await options.store.markSendFailed({
    endpoint: row.endpoint,
    failedSends,
    retryAt: new Date(input.now.getTime() + pushRetryDelayMs(failedSends)),
  });
}

export interface PushSchedulerOptions extends PushTickOptions {
  /** Defaults to {@link PUSH_TICK_INTERVAL_MS}. A test passes milliseconds so it does not wait a minute. */
  intervalMs?: number;
}

/** The handle `main.ts` holds. Same contract as the pulse sweep's, for the same reasons. */
export interface PushScheduler {
  /** Stops the timer. Idempotent, and safe on one that has already stopped. */
  stop(): void;
  /** Runs one tick now and resolves when it is done. The timer calls exactly this. */
  runOnce(): Promise<PushTickResult>;
}

export function startPushScheduler(options: PushSchedulerOptions): PushScheduler {
  async function runOnce(): Promise<PushTickResult> {
    return runPushTick(options);
  }

  // ONE TICK AT A TIME. A tick that outlives its minute (a push service
  // answering slowly for every endpoint) is not joined by a second one, which
  // would plan from the same unmarked rows and send every due push twice.
  let isTickRunning = false;
  const timer = setInterval(() => {
    if (isTickRunning) {
      options.logger.warn('Push tick skipped, the previous one is still running');
      return;
    }
    isTickRunning = true;
    void (async () => {
      try {
        await runOnce();
      } catch (cause) {
        options.logger.error('Push tick failed', {
          ...errorFields(cause),
        });
      } finally {
        isTickRunning = false;
      }
    })();
  }, options.intervalMs ?? PUSH_TICK_INTERVAL_MS);
  // Never the reason the process, or a test runner, stays alive.
  timer.unref();

  return {
    stop(): void {
      clearInterval(timer);
    },
    runOnce,
  };
}
