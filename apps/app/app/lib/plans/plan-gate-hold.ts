/**
 * THE PAYWALL'S ONE FACT THAT SURVIVES A RELOAD (M265 spec 10).
 *
 * `plan-gate-facts.ts` keeps what the paywall read in module memory, gone with
 * the tab. A cold start runs the `_personal` loader before the session has
 * reopened, so the loader has no account to ask about and the gate answers
 * open. The sign-off of the paid launch saw what that costs: a locked person
 * opening the app from cold saw the diary for about a second, the time the
 * session and the plan read took, before `PlanGateWatcher` sent them to the
 * plan page.
 *
 * Holding EVERY cold start until the network has answered would close that
 * and make everybody else pay for it: the diary of a person with a working
 * plan would wait for four round trips it does not need. So this module keeps
 * one fact on the device instead, the instant from which a cold start may no
 * longer assume the app is open, and the loader holds the first paint on the
 * boot splash only once that instant has come.
 *
 * - A standing that locks holds from the moment it was read.
 * - A standing that will lock by the clock alone holds from that instant: a
 *   day trial from its end date, a subscription that will not renew from the
 *   end of its paid period.
 * - Every other standing, and an instance that sells nothing, never holds,
 *   and the marker is removed.
 *
 * ── It makes a start WAIT, it never locks one ────────────────────────────
 *
 * The marker decides nothing about access. A held start asks the gate again
 * once the session is open, with a fresh read, and the gate's own rules
 * answer: a plan bought on another device opens the app, a read that fails or
 * outlasts its timeout opens it, and an offline device is never held at all.
 * A stale marker costs a moment more of the splash, once, and the next read
 * rewrites it.
 *
 * ── What it cannot know ──────────────────────────────────────────────────
 *
 * A change made elsewhere since the last read on this device: free scans spent
 * on another phone, a plan the biller ended early. Those still draw the diary
 * until the session is open, and `PlanGateWatcher` sends the person on as
 * before. Knowing them would mean holding every cold start for the network,
 * which is the trade this module exists to refuse.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import type { PlanView } from '#app/lib/sync/engine/client/plans-wire';
import { hasDeviceSyncSession } from '#app/lib/sync/session-cache';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { deviceStorage, type KeyValueStorage } from '#app/lib/sync/sync-state';

import { isLockingStanding, isPlanGateExempt, planGateStanding, type PlanGateAccount } from './plan-gate';
import { isDeviceOnline, type PlanGateFacts } from './plan-gate-facts';
import type { PlanStanding } from './plan-standing';
import { hasPlansDoor } from './plans-door';

/** Where the marker lives: epoch milliseconds, as a decimal string. */
export const PLAN_GATE_HOLD_KEY = 'openplate.plan-gate.hold-from';

/** An ISO instant as epoch milliseconds, or `null` for one that does not parse. */
function parseInstant(instant: string): number | null {
  const ms = Date.parse(instant);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The instant an open standing turns into a locking one by the clock alone,
 * or `null` when no date will lock it.
 */
function locksByTheClockAt(standing: PlanStanding): number | null {
  switch (standing.kind) {
    case 'trial':
      return standing.basis === 'days' ? parseInstant(standing.endsAt) : null;
    case 'subscribed':
      return standing.renews || standing.periodEnd === null ? null : parseInstant(standing.periodEnd);
    case 'no-plans':
    case 'trial-ended':
    case 'lapsed':
      return null;
  }
}

/**
 * From when a cold start waits for the paywall, for one set of facts.
 *
 * @param input.instance - the handshake's descriptor, or `null` while unread.
 * @param input.account - the session's account facts.
 * @param input.planView - `GET /plans/me`, or `null`.
 * @param input.now - the instant the facts are judged at.
 * @returns epoch milliseconds, `now` itself for a standing that locks already,
 *   or `null` for never.
 */
export function planGateHoldFrom({
  instance,
  account,
  planView,
  now,
}: {
  instance: InstanceDescriptor | null;
  account: PlanGateAccount;
  planView: PlanView | null;
  now: Date;
}): number | null {
  if (!hasPlansDoor(instance)) return null;
  const standing = planGateStanding({ instance, account, planView, now });
  if (isLockingStanding(standing)) return now.getTime();
  return locksByTheClockAt(standing);
}

/**
 * Writes the marker for the facts the gate holds about the open session's
 * account, or removes it when they never lock.
 *
 * NOTHING IS WRITTEN FROM HALF THE FACTS. An account view that has not been
 * read yet (`dailyAiLimit === null`) and facts read for another account both
 * say nothing about this person, and judging them would remove a marker the
 * next cold start needs.
 *
 * @param input.account - the session snapshot's account.
 * @param input.held - the gate's facts, from `getPlanGateFactsSnapshot`, or `null`.
 * @param input.now - the instant the facts are judged at.
 * @param input.storage - defaults to this device's storage; injected in tests.
 */
export function recordPlanGateHold({
  account,
  held,
  now,
  storage = deviceStorage(),
}: {
  account: PlanGateAccount & { id: number };
  held: PlanGateFacts | null;
  now: Date;
  storage?: KeyValueStorage;
}): void {
  if (account.dailyAiLimit === null) return;
  if (held === null || held.accountId !== account.id) return;
  const from = planGateHoldFrom({ instance: held.instance, account, planView: held.planView, now });
  if (from === null) {
    storage.removeItem(PLAN_GATE_HOLD_KEY);
    return;
  }
  storage.setItem(PLAN_GATE_HOLD_KEY, String(from));
}

/**
 * The marker, or `null` when there is none or it does not parse.
 *
 * @param storage - defaults to this device's storage; injected in tests.
 */
export function readPlanGateHold(storage: KeyValueStorage = deviceStorage()): number | null {
  const raw = storage.getItem(PLAN_GATE_HOLD_KEY);
  if (raw === null) return null;
  const from = Number(raw);
  return Number.isFinite(from) ? from : null;
}

/**
 * Whether this start holds its first paint for the paywall, from the facts at
 * hand. Pure.
 *
 * 1. **Only while the session is still reopening.** Once it has settled the
 *    gate itself decides, with an account or without one.
 * 2. **Never offline**, the rule `plan-gate-facts.ts` states: the gate opens
 *    offline, so a hold would only delay the diary it is about to show.
 * 3. **Never on an exempt page.** The export, the account page and the plan
 *    page itself are open to a locked person, and open at once.
 * 4. **Only once the marker's instant has come.**
 */
export function isStartHeldForPlanGate({
  pathname,
  isResuming,
  isOnline,
  holdFrom,
  now,
}: {
  pathname: string;
  isResuming: boolean;
  isOnline: boolean;
  holdFrom: number | null;
  now: Date;
}): boolean {
  if (!isResuming || !isOnline) return false;
  if (isPlanGateExempt(pathname)) return false;
  return holdFrom !== null && holdFrom <= now.getTime();
}

/**
 * Whether this start holds its first paint for the paywall, for the
 * `_personal` loader.
 *
 * Asks {@link isStartHeldForPlanGate} with this device's facts, and then, only
 * when that says hold, whether a saved session is there to reopen at all: a
 * device signed out since the marker was written has no account to be locked,
 * and holding it would only delay its diary. That read is IndexedDB, which is
 * why it comes last, so a start that is not held never pays for it.
 *
 * @param input.pathname - the address being opened.
 */
export async function shouldHoldStartForPlanGate({
  pathname,
  isResuming = getSyncSessionSnapshot().isResuming,
  isOnline = isDeviceOnline(),
  holdFrom = readPlanGateHold(),
  now = new Date(),
  hasSavedSession = hasDeviceSyncSession,
}: {
  pathname: string;
  isResuming?: boolean;
  isOnline?: boolean;
  holdFrom?: number | null;
  now?: Date;
  hasSavedSession?: () => Promise<boolean>;
}): Promise<boolean> {
  if (!isStartHeldForPlanGate({ pathname, isResuming, isOnline, holdFrom, now })) return false;
  return hasSavedSession();
}
