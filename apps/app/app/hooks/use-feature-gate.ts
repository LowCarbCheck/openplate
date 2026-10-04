/**
 * WHETHER A FEATURE IS OPEN FOR THIS PERSON, decided once per visit (ADR-0024).
 *
 * A gated entry point must never FLIP after it has painted: a start button that
 * turns into a lock note a second later is the worst of both. So the answer is
 * read from memory in the FIRST render (`isFeatureOpenNow`) and held for the
 * life of the component:
 *
 * - known in the first render: that answer, closed or open, from first paint;
 * - not known (a cold boot straight onto the screen, before the session has
 *   reopened and the account view has landed): OPEN, and it stays open for this
 *   visit. The next navigation to the screen mounts it again and reads what is
 *   held by then. The core's AI proxy is what refuses a request, so a person
 *   who got the open form past a closed feature gets the closed-feature note
 *   from the proxy's `403 capability-required`, never a charge.
 *
 * The answer is re-read in one case only: the signed-in account CHANGES to
 * another account, which is a different person looking at the screen.
 *
 * Fails open everywhere else too (`capabilities.ts`): no plans door, no list, a
 * person on their own AI key.
 */
import { useState } from 'react';

import { useSyncSession } from '#app/components/sync-status';
import type { FeatureLabel } from '#app/lib/plans/capabilities';
import { isFeatureOpenNow } from '#app/lib/plans/feature-gate-now';

/** What a screen draws a gated entry point from. */
export interface FeatureGateState {
  /** `true` draws the feature as it is, `false` draws the closed-feature note. Never changes after the first paint. */
  isOpen: boolean;
}

/** The held answer, and the account it was held for (`null` while no account has been read). */
interface HeldAnswer {
  accountId: number | null;
  isOpen: boolean;
}

/**
 * @param feature - the feature word.
 * @param options.isOwnKey - `true` for an AI feature on the person's own key,
 *   which is never gated. Read at the time of the first render.
 */
export function useFeatureGate(feature: FeatureLabel, { isOwnKey = false }: { isOwnKey?: boolean } = {}): FeatureGateState {
  const accountId = useSyncSession().account?.id ?? null;
  const [held, setHeld] = useState<HeldAnswer>(() => ({ accountId, isOpen: isFeatureOpenNow({ feature, isOwnKey }) }));
  if (accountId === null || held.accountId === accountId) return { isOpen: held.isOpen };

  // THE ACCOUNT ARRIVED, or CHANGED. Arriving after an open first paint keeps
  // the open answer (it must not flip); another account re-reads, because it is
  // another person looking at the screen.
  const isAnotherPerson = held.accountId !== null;
  const next: HeldAnswer = {
    accountId,
    isOpen: isAnotherPerson ? isFeatureOpenNow({ feature, isOwnKey }) : held.isOpen,
  };
  setHeld(next);
  return { isOpen: next.isOpen };
}
