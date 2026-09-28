/**
 * The plan page's poll after a payment (2026-09-28).
 *
 * The decision is pure and lives in `#app/lib/plans/payment-return`; this hook
 * is the clock and the reads around it. It asks `GET /plans/me` at once and
 * every two seconds after, for up to a minute, keyed on the ACCOUNT ID so a
 * return that loads before the session has reopened waits for it instead of
 * asking nobody (the pulse tile's defect, 2026-09-12).
 *
 * A failed read is one more poll, never the end: the payment went through, and
 * a network blip must not tell the person otherwise.
 *
 * WHEN THE PLAN TURNS LIVE, EVERY CACHED PLAN FACT HEARS OF IT. The view is
 * handed to the paywall's facts, so the next navigation is decided from it and
 * the diary opens, and the header's standing (`usePlanStanding`) reads it from
 * there, so the trial countdown it read at mount is withdrawn instead of
 * greeting a subscriber on the diary with "See plans" (the buyer walk,
 * 2026-09-28). The account view is read again too: the biller has just moved
 * the allowance, and the session snapshot still holds the trial's numbers.
 *
 * NOT KEYED ON THE DESCRIPTOR. Taking the `checkout` marker off the address
 * revalidates the page's loader, which hands back a new descriptor object for
 * the same answer; a poll keyed on it would restart, and a return already
 * confirmed would flicker back to "checking". The descriptor is read through a
 * ref, and `confirmed` is never left once reached.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSyncSession } from '#app/components/sync-status';
import { notePlanViewForSession } from '#app/lib/plans/plan-gate-facts';
import { planStanding } from '#app/lib/plans/plan-standing';
import { currentPlansClient } from '#app/lib/plans/plans-session';
import {
  PAYMENT_POLL_INTERVAL_MS,
  confirmationAfterRead,
  type PaymentConfirmation,
} from '#app/lib/plans/payment-return';
import type { PlanView } from '#app/lib/sync/engine/client/plans-wire';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { refreshSyncAccount } from '#app/lib/sync/sync-actions';

/** Where the poll is, and the live plan it found. */
export interface PaymentConfirmationState {
  confirmation: PaymentConfirmation;
  /** The live plan view once `confirmed`, so the page draws the subscription at once. */
  confirmedPlan: PlanView | null;
  /** Starts another minute of asking, after `slow`. */
  checkAgain: () => void;
}

/** One read of the plan, or `null` when it could not be read. */
async function readPlanOnce(): Promise<PlanView | null> {
  const client = currentPlansClient();
  if (client === null) return null;
  try {
    const outcome = await client.readPlan();
    return outcome.status === 'ok' ? outcome.value : null;
  } catch {
    return null;
  }
}

/**
 * Polls the plan while a payment return is being confirmed.
 *
 * @param input.isReturning - `true` on a `?checkout=success` return. `false`
 *   sends nothing and stays `checking`, which no caller draws.
 * @param input.instance - the descriptor the page's gate passed.
 */
export function usePaymentConfirmation({
  isReturning,
  instance,
}: {
  isReturning: boolean;
  instance: InstanceDescriptor;
}): PaymentConfirmationState {
  const session = useSyncSession();
  const accountId = session.account?.id ?? null;
  const [round, setRound] = useState(0);
  const [confirmation, setConfirmation] = useState<PaymentConfirmation>('checking');
  const [confirmedPlan, setConfirmedPlan] = useState<PlanView | null>(null);
  const instanceRef = useRef(instance);
  const hasConfirmed = useRef(false);

  useEffect(() => {
    instanceRef.current = instance;
  }, [instance]);

  useEffect(() => {
    if (!isReturning || accountId === null || hasConfirmed.current) return;
    let isCurrent = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    setConfirmation('checking');

    const poll = async (): Promise<void> => {
      const readAt = Date.now();
      const plan = await readPlanOnce();
      if (!isCurrent) return;
      const door = instanceRef.current;
      const standing = planStanding({ instance: door, account: null, planView: plan, now: new Date() });
      const next = confirmationAfterRead({
        isSubscribed: standing.kind === 'subscribed',
        elapsedMs: Date.now() - startedAt,
      });
      if (next === 'confirmed' && plan !== null) {
        hasConfirmed.current = true;
        notePlanViewForSession({ instance: door, planView: plan, readAt });
        // Fail-open by its own contract: a refused read leaves the old numbers.
        void refreshSyncAccount();
        setConfirmedPlan(plan);
      }
      setConfirmation(next);
      if (next === 'checking') timer = setTimeout(() => void poll(), PAYMENT_POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [isReturning, accountId, round]);

  const checkAgain = useCallback(() => setRound((count) => count + 1), []);
  return { confirmation, confirmedPlan, checkAgain };
}
