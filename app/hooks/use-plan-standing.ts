/**
 * The plan read and the plan standing, for components (M250/01).
 *
 * `planStanding` (`app/lib/plans/plan-standing.ts`) is pure and takes every
 * fact as an argument. These two hooks gather those facts from where the app
 * already keeps them, so a placement asks one question and never re-derives
 * the answer:
 *
 *  - the handshake, through the one cached `/health` read the tab shares;
 *  - the session snapshot's account, never the vault;
 *  - `GET /plans/me`, read over the open session, and only on an instance
 *    whose handshake says a biller stands behind it. `PROTOCOL.md` §5.22
 *    forbids asking the path to find out;
 *  - the clock, re-read once a minute, so a countdown in days turns over
 *    without a reload;
 *  - the plan view the paywall holds, when it is newer than this mount's own
 *    read. A payment confirmed on the plan page is recorded there, and the
 *    header, mounted since before the payment, must draw the new standing on
 *    the next screen and not the one it read at mount (the buyer walk,
 *    2026-09-28).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import { useSyncSession } from '#app/components/sync-status';
import { useNow } from '#app/hooks/use-now';
import { useServerInstance } from '#app/hooks/use-server-instance';
import {
  currentPlanGateSession,
  getPlanGateFactsSnapshot,
  newerHeldPlanView,
  subscribePlanGateFacts,
} from '#app/lib/plans/plan-gate-facts';
import { planStanding, type PlanStanding } from '#app/lib/plans/plan-standing';
import { hasPlansDoor } from '#app/lib/plans/plans-door';
import { currentPlansClient } from '#app/lib/plans/plans-session';
import type { PlanView } from '#app/lib/sync/engine/client/plans-wire';

/** How often the standing re-reads the clock. Its smallest unit is a day, so a minute is plenty. */
const STANDING_CLOCK_MS = 60_000;

/**
 * Where the plan read is.
 *
 * `absent` IS ITS OWN STATE and not a failure: it is the biller answering 404
 * between the handshake and the read, which is an operator switching the door
 * off while a tab sat open. Saying "there is no plan here" is true; saying
 * "something went wrong" is not.
 */
export type PlanReadState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'absent' }
  | { kind: 'failed' }
  | { kind: 'ready'; plan: PlanView };

/** The plan view out of a read, or `null` for every state that is not an answer. */
export function planViewOf(state: PlanReadState): PlanView | null {
  return state.kind === 'ready' ? state.plan : null;
}

/** A plan read and the moment it started, so a newer read held elsewhere can win over it. */
interface PlanReadEntry {
  state: PlanReadState;
  /** Epoch ms the read that produced `state` started, or `null` before any read answered. */
  startedAt: number | null;
}

/**
 * Reads `GET /plans/me` for the signed-in account, once per mount and again
 * when the account changes, and says when that read started.
 *
 * @param input.isEnabled - `false` holds the read at `loading` and sends
 *   nothing. A placement passes the door here, so an instance with no biller
 *   never receives the request.
 * @param input.refresh - a counter; a new value reads the plan again, keeping
 *   the answer on screen until the new one is in. The order page bumps it when
 *   the biller says the account already pays (M245/04).
 */
function usePlanReadEntry({ isEnabled, refresh = 0 }: { isEnabled: boolean; refresh?: number }): PlanReadEntry {
  const session = useSyncSession();
  const [entry, setEntry] = useState<PlanReadEntry>({ state: { kind: 'loading' }, startedAt: null });
  const accountId = session.account?.id ?? null;

  useEffect(() => {
    if (!isEnabled) return;
    if (accountId === null) {
      setEntry({ state: { kind: 'signed-out' }, startedAt: null });
      return;
    }
    let isMounted = true;
    const read = async (): Promise<void> => {
      const startedAt = Date.now();
      const client = currentPlansClient();
      if (client === null) {
        if (isMounted) setEntry({ state: { kind: 'signed-out' }, startedAt: null });
        return;
      }
      try {
        const outcome = await client.readPlan();
        if (!isMounted) return;
        setEntry({
          state: outcome.status === 'ok' ? { kind: 'ready', plan: outcome.value } : { kind: 'absent' },
          startedAt,
        });
      } catch {
        if (isMounted) setEntry({ state: { kind: 'failed' }, startedAt });
      }
    };
    void read();
    return () => {
      isMounted = false;
    };
  }, [isEnabled, accountId, refresh]);

  return entry;
}

/**
 * Reads `GET /plans/me` for the signed-in account, once per mount and again
 * when the account changes.
 *
 * @param input.isEnabled - `false` holds the read at `loading` and sends
 *   nothing. A placement passes the door here, so an instance with no biller
 *   never receives the request.
 * @param input.refresh - a counter; a new value reads the plan again, keeping
 *   the answer on screen until the new one is in. The order page bumps it when
 *   the biller says the account already pays (M245/04).
 */
export function usePlanRead(input: { isEnabled: boolean; refresh?: number }): PlanReadState {
  return usePlanReadEntry(input).state;
}

/** The server snapshot of the paywall's facts: none, so a server render draws only its own read. */
function getNoHeldFacts(): null {
  return null;
}

/**
 * Where this person stands with a plan, for a placement that reads nothing
 * else about plans.
 *
 * A screen that also draws the plan itself (the plan page) calls
 * {@link usePlanRead} once and {@link planStanding} on its result, rather than
 * this hook, so one mount never sends two reads.
 *
 * THE NEWER PLAN VIEW WINS. This mount reads the plan once; the paywall's
 * facts are read on navigations and written by the plan page, and the payment
 * confirmation writes the live plan there the moment it sees it. Whichever
 * read started later is the one the standing is drawn from
 * (`newerHeldPlanView`).
 */
export function usePlanStanding(): PlanStanding {
  const instance = useServerInstance();
  const session = useSyncSession();
  const read = usePlanReadEntry({ isEnabled: hasPlansDoor(instance) });
  const held = useSyncExternalStore(subscribePlanGateFacts, getPlanGateFactsSnapshot, getNoHeldFacts);
  const nowMs = useNow({ intervalMs: STANDING_CLOCK_MS });
  const heldView = newerHeldPlanView({ held, who: currentPlanGateSession(), ownReadStartedAt: read.startedAt });
  return planStanding({
    instance,
    account: session.account,
    planView: heldView ?? planViewOf(read.state),
    now: new Date(nowMs),
  });
}
