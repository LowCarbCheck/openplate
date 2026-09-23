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
 *    without a reload.
 */
import { useEffect, useState } from 'react';

import { useSyncSession } from '#app/components/sync-status';
import { useNow } from '#app/hooks/use-now';
import { useServerInstance } from '#app/hooks/use-server-instance';
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

/**
 * Reads `GET /plans/me` for the signed-in account, once per mount and again
 * when the account changes.
 *
 * @param input.isEnabled - `false` holds the read at `loading` and sends
 *   nothing. A placement passes the door here, so an instance with no biller
 *   never receives the request.
 */
export function usePlanRead({ isEnabled }: { isEnabled: boolean }): PlanReadState {
  const session = useSyncSession();
  const [state, setState] = useState<PlanReadState>({ kind: 'loading' });
  const accountId = session.account?.id ?? null;

  useEffect(() => {
    if (!isEnabled) return;
    if (accountId === null) {
      setState({ kind: 'signed-out' });
      return;
    }
    let isMounted = true;
    const read = async (): Promise<void> => {
      const client = currentPlansClient();
      if (client === null) {
        if (isMounted) setState({ kind: 'signed-out' });
        return;
      }
      try {
        const outcome = await client.readPlan();
        if (!isMounted) return;
        setState(outcome.status === 'ok' ? { kind: 'ready', plan: outcome.value } : { kind: 'absent' });
      } catch {
        if (isMounted) setState({ kind: 'failed' });
      }
    };
    void read();
    return () => {
      isMounted = false;
    };
  }, [isEnabled, accountId]);

  return state;
}

/**
 * Where this person stands with a plan, for a placement that reads nothing
 * else about plans.
 *
 * A screen that also draws the plan itself (the plan page) calls
 * {@link usePlanRead} once and {@link planStanding} on its result, rather than
 * this hook, so one mount never sends two reads.
 */
export function usePlanStanding(): PlanStanding {
  const instance = useServerInstance();
  const session = useSyncSession();
  const read = usePlanRead({ isEnabled: hasPlansDoor(instance) });
  const nowMs = useNow({ intervalMs: STANDING_CLOCK_MS });
  return planStanding({
    instance,
    account: session.account,
    planView: planViewOf(read),
    now: new Date(nowMs),
  });
}
